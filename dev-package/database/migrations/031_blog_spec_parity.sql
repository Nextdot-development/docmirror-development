-- ─────────────────────────────────────────────────────────────────────────
-- Migration 031: external-spec parity for blog_posts
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run after:   017 → … → 030
--
-- Adds the columns a gap-analysis against an external blog-CMS spec found
-- missing, plus a slug-redirect table so a live article's URL can change
-- without 404ing the old one:
--
--   blog_posts.canonical_url     optional override; when blank the canonical
--                                 stays derived from the slug, as today.
--   blog_posts.og_image          optional Open Graph image override.
--   blog_posts.twitter_image     optional Twitter card image override
--                                 (falls back to og_image, then the
--                                 featured image, exactly as today).
--   blog_posts.time_zone         the IANA zone the author picked when they
--                                 last scheduled/saved a publish date, so the
--                                 editor can show it back correctly. Display
--                                 only — published_at (UTC) still gates and
--                                 sorts everything, unchanged.
--   blog_posts.first_published_at  set once, the first time a post ever
--                                 went live, and never overwritten again —
--                                 an immutable "first went live" record,
--                                 distinct from published_at (which is the
--                                 author-facing publish date used for
--                                 display/sort/gating and already does not
--                                 jump on a re-publish; see resolveStatus()
--                                 in routes/admin/posts.js).
--   blog_posts.content_blocks    a structured-block JSONB mirror of
--                                 content_md (headings/paragraphs/lists/
--                                 quote/code/hr/table/image), derived at
--                                 save time. content_md stays the one thing
--                                 the renderer reads — this is an additional,
--                                 read-only-by-the-app representation, kept
--                                 for anything that wants blocks instead of
--                                 Markdown. Never authoritative, never
--                                 rendered.
--
--   blog_redirects                old_slug -> new_slug, written automatically
--                                 when a live article's slug is changed in
--                                 the editor, so the old URL 301s instead of
--                                 404ing.
--
-- The application probes for all of this and keeps working without it
-- (no overrides, no persisted timezone, no blocks, no redirects), so this is
-- safe to run at any time, in any order relative to the app's deploys.
--
-- Additive only: no DROP, no DELETE, no rewrite of existing rows.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS canonical_url      TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS og_image           TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS twitter_image      TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS time_zone          TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS first_published_at TIMESTAMPTZ;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS content_blocks     JSONB;

COMMENT ON COLUMN blog_posts.canonical_url IS
  'Optional canonical <link> override. Blank = derived from the slug (the historical behaviour).';
COMMENT ON COLUMN blog_posts.og_image IS
  'Optional Open Graph image override. Blank = the featured image, as before.';
COMMENT ON COLUMN blog_posts.twitter_image IS
  'Optional Twitter card image override. Blank = og_image, then the featured image.';
COMMENT ON COLUMN blog_posts.time_zone IS
  'IANA zone last used to schedule/save a publish date, for the editor to display. Never used for gating.';
COMMENT ON COLUMN blog_posts.first_published_at IS
  'Set once on first publish; never overwritten after. Audit only — published_at remains the public date.';
COMMENT ON COLUMN blog_posts.content_blocks IS
  'Structured-block mirror of content_md, derived at save time. Never authoritative, never rendered.';

-- ── slug redirects ──────────────────────────────────────────────────────────
-- One row per renamed live slug. A chain collapses to a single hop: renaming
-- B (itself a redirect target of A) to C rewrites A's row to point at C
-- directly, so a lookup is always one step, never a chain to follow.
CREATE TABLE IF NOT EXISTS blog_redirects (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  old_slug    TEXT        NOT NULL UNIQUE
                          CHECK (old_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  new_slug    TEXT        NOT NULL
                          CHECK (new_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  post_id     UUID        REFERENCES blog_posts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blog_redirects_not_self CHECK (old_slug <> new_slug)
);

CREATE INDEX IF NOT EXISTS idx_blog_redirects_new_slug ON blog_redirects (new_slug);

ALTER TABLE blog_redirects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'blog_redirects' AND policyname = 'service_role_blog_redirects'
  ) THEN
    CREATE POLICY "service_role_blog_redirects" ON blog_redirects
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE blog_redirects FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE blog_redirects TO service_role;

-- ── public view ───────────────────────────────────────────────────────────
-- SELECT * views freeze their column list, so re-create it to pick up the
-- new columns. Same visibility rule as 030 — unchanged.
CREATE OR REPLACE VIEW blog_posts_public AS
  SELECT *
    FROM blog_posts
   WHERE status IN ('published', 'scheduled')
     AND published_at IS NOT NULL
     AND published_at <= NOW();

DO $$ BEGIN
  EXECUTE 'ALTER VIEW blog_posts_public SET (security_invoker = true)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'security_invoker not supported on this Postgres version — view is protected by REVOKE only';
END $$;

REVOKE ALL ON TABLE blog_posts_public FROM anon, authenticated;
GRANT SELECT ON TABLE blog_posts_public TO service_role;

NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'blog_posts'
   AND column_name IN ('canonical_url', 'og_image', 'twitter_image', 'time_zone',
                        'first_published_at', 'content_blocks');
SELECT count(*) AS redirects FROM blog_redirects;
