-- ─────────────────────────────────────────────────────────────────────────
-- Migration 030: focus keyword, version counter, revision history
--
-- Run this in: Supabase dashboard → SQL Editor
-- Run after:   017 → … → 023
--
-- Adds three things the editor uses:
--
--   blog_posts.focus_keyword   the one query the article targets. Drives the
--                              rule-based SEO title / meta description score.
--                              Nullable: an empty keyword is "not set", and the
--                              editor says so rather than guessing one.
--   blog_posts.version         bumped on every save that writes a revision.
--   blog_revisions             a snapshot of the row as it was BEFORE each
--                              manual save, so an earlier version can be
--                              loaded back into the editor and re-saved.
--
-- The application probes for each of these and keeps working without them
-- (no keyword field, no history panel), so this is safe to run at any time.
--
-- Additive only: no DROP, no DELETE, no rewrite of existing rows.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS focus_keyword TEXT;

ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN blog_posts.focus_keyword IS
  'Primary query the article targets. Used only by the admin SEO score; never rendered.';
COMMENT ON COLUMN blog_posts.version IS
  'Incremented each time a revision of the previous state is written to blog_revisions.';

-- ── revisions ─────────────────────────────────────────────────────────────
-- `snapshot` holds the editable columns of the row at that version (title,
-- slug, content_md, SEO fields, faq, related_slugs …). Status and publish time
-- are recorded for context but are NOT restored — restoring loads content into
-- the editor, and the author decides how to save it.
CREATE TABLE IF NOT EXISTS blog_revisions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID        NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  version     INTEGER     NOT NULL,
  snapshot    JSONB       NOT NULL,
  reason      TEXT        NOT NULL DEFAULT 'save',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_blog_revisions_post
  ON blog_revisions (post_id, created_at DESC);

ALTER TABLE blog_revisions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'blog_revisions' AND policyname = 'service_role_blog_revisions'
  ) THEN
    CREATE POLICY "service_role_blog_revisions" ON blog_revisions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Same two locks as every blog table: RLS with a service_role-only policy, and
-- no grants for the browser roles at all.
REVOKE ALL ON TABLE blog_revisions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE blog_revisions TO service_role;

-- ── public view ───────────────────────────────────────────────────────────
-- SELECT * views freeze their column list, so re-create it to pick up the new
-- columns. Same rule as 023: scheduled posts whose time has passed are public.
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
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'blog_posts'
   AND column_name IN ('focus_keyword', 'version');
SELECT count(*) AS revisions FROM blog_revisions;
