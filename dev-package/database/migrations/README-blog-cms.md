# Blog CMS migrations (017–021)

Schema for the Doc Mirror blog scheduler / admin CMS.

**None of these have been executed.** They are written, statically checked, and
waiting. Run `npm run verify-migrations` to re-check them without a database.

The public site still renders from `content/resources/*.md`. Nothing in the
application reads these tables until Phase 3.

## Run order

Paste each file into **Supabase dashboard → SQL Editor** and run it, in this
order. Each is idempotent, so a re-run is safe.

| # | File | Creates |
|---|---|---|
| 017 | `017_blog_categories.sql` | `blog_categories` + the shared `updated_at` trigger function |
| 018 | `018_blog_posts.sql` | `blog_posts`, its indexes, the `blog_posts_public` view, two CHECK helper functions |
| 019 | `019_blog_media.sql` | `blog_media` (metadata only — no binary data) |
| 020 | `020_blog_storage.sql` | the `blog-media` Storage bucket + its policies |
| 021 | `021_profiles_admin_role.sql` | `profiles.role`, the trigger that stops self-promotion, and an optional grant lockdown |

Later additions, run after the above:

| # | File | Adds |
|---|---|---|
| 022 | `022_blog_schema_toggles.sql` | per-article BlogPosting / FAQPage switches |
| 023 | `023_blog_posts_public_view.sql` | view matches the read-time visibility rule |
| 030 | `030_blog_focus_keyword_revisions.sql` | `focus_keyword`, `version`, and the `blog_revisions` history table |

The app probes for 022 and 030 and keeps working without them (no schema
toggles / no focus keyword or history panel), so they can be run at any time.

017 must precede 018 and 019 (it defines `update_updated_at_column()`).
020 and 021 are independent of the rest.

**Read 021's comment blocks before running it.** It has two security layers,
and only the first is mandatory:

- **Step 4 — the `profiles_guard_role` trigger.** This is the actual
  guarantee: only `service_role` or the SQL-editor role may set or change
  `role`. It changes nothing about what existing flows are allowed to do, and
  it holds even if the table's grants are later restored.
- **Step 5 — `REVOKE INSERT, UPDATE, DELETE ... FROM anon, authenticated`.**
  Optional defence in depth. Safe, because no browser code writes to
  `profiles` — but it also closes a pre-existing self-service `plan` upgrade
  path, which is a change to current production behaviour. Comment it out if
  you want to decide on that separately; the admin invariant does not depend
  on it.

## Safety properties

- Additive only. No `DROP`, no `TRUNCATE`, no `DELETE`, no `RENAME` anywhere.
- No content data is written. No Markdown article is imported.
- Every new table: RLS enabled, a `service_role`-only policy, **and** the
  default `anon`/`authenticated` grants revoked. Two independent locks.
- The only anonymously readable surface is the `blog-media` bucket, and only
  for `SELECT` — because a hero image has to be fetchable by browsers, by
  Googlebot, and by social-card crawlers.

## After running

Create the first admin with the commented-out snippet at the bottom of 021,
then verify:

```sql
select email, plan, role from profiles where role = 'admin';
select count(*) from blog_posts;      -- 0
select id, public, file_size_limit from storage.buckets where id = 'blog-media';
```

## Revision history

`blog_revisions` (migration 030) stores the row as it was before each
deliberate save (Save Draft, Publish, Schedule, Archive). The 30-second
autosave does not write revisions. Restoring loads a version into the editor
unsaved — it never changes status or publish date on its own.
