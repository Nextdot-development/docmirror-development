# CMS Metadata 3-Article Pilot Checklist

> DOCUMENTATION ONLY. None of the steps below has been performed. No admin session was used, no production API or database call was made, and no application file was changed to write this. Prepared 2026-09-24.

## 1. Purpose

Before changing the metadata of the remaining CMS Resources, prove on **3 articles** that editing **only** `seo_title` and `meta_description` in the existing admin editor and pressing **Publish Now** leaves everything else about the article and its live page unchanged. The repository code does **not** establish that this is true (section 3, "Body handling"), so the first three posts are a controlled pilot, not a routine edit. Only after all three pass the Go/No-Go rules (section 8) may the other 38 be touched.

## 2. Safety Constraints

**Prohibited** (for this task and for the pilot):
- Editing anything other than the SEO Title and Meta Description fields of the 3 pilot posts.
- Clicking **Save Draft**, **Archive**, **Schedule** or **Delete** on a live post.
- Direct SQL, Supabase dashboard edits, or any database write.
- Calling `PATCH /api/admin/posts/:id` (or any POST/PUT/PATCH/DELETE endpoint) by hand, with curl, a script or a browser console. The editor button is the only permitted route.
- Writing a script or bulk-update tool.
- Changing article body, H1, headings, links, images, ALT text, slug, author, category, tags, dates, status, schema toggles, FAQ or related posts.
- Changing URLs, redirects, canonical, sitemap, robots, schema or Open Graph implementation.
- Sharing or pasting an admin token or password anywhere (chat, files, git).
- Working around a validation error or server error. Stop and record it instead.
- Committing anything as part of the pilot.

## 3. Repository-Verified CMS Workflow

Everything here comes from reading the code. Where the code does not settle a question it says so.

| # | Question | Finding (source) |
|---|---|---|
| 1 | Admin URLs | Login `/admin/login`; list `/admin/blogs`; editor `/admin/blogs/:id/edit` (`server.js` static admin routes; `public/admin/blogs.html`). |
| 2 | How the post ID is obtained | The list page links each row to `/admin/blogs/<id>/edit` (`blogs.html`, `r.id`). The ID is the last-but-one segment of the editor URL. The editor loads the post by that ID. IDs are not stored in the audit files. |
| 3 | SEO title / meta description fields | Editor inputs `#f-seotitle` and `#f-metadesc` (`editor.html`, `editor.js` `collect()`); counters warn at 60 and 160 characters. Stored in `blog_posts.seo_title` and `blog_posts.meta_description`. |
| 4 | What Publish Now sends | `save("publish")` → `collect("publish")` → `PATCH /api/admin/posts/:id` with the **entire form**: `action`, `title`, `slug`, `excerpt`, `content_md`, `author`, `category`, `tags`, `featured_image`, `image_alt`, `seo_title`, `meta_description`, `read_time_minutes`, `faq`, `related_slugs`, `enable_article_schema`, `enable_faq_schema`, `publish_date`, `publish_time`, `timezone` (`editor.js` lines ~710-735, ~761-764). |
| 5 | Status preserved? | Yes for a post that is already live: `resolveStatus("publish")` returns `status: "published"` (`routes/admin/posts.js`). |
| 6 | Original publish date preserved? | Yes for a live post: it keeps `prevPublishedAt` when that date is in the past (code comment: "so its date and sitemap entry do not jump forward"). |
| 7 | Slug preserved? | Yes for a live post: the slug input is read-only once published (`applySlugLock`), and the server refuses and restores the stored slug if a different one is sent (`buildFields`, "slug lock"). |
| 8 | Does Save Draft unpublish a live post? | Yes. `save_draft` resolves to `status: "draft"`. The public collection loads only posts with status published/scheduled and a past publish date (`lib/resources-db.js`), so a draft leaves the site. **Never use it on a live post.** |
| 9 | Does the server rewrite the whole row? | Yes. `update` builds every column from the request body via `buildFields`, adds `status`, `published_at`, `updated_by`, then `supabase.from("blog_posts").update(row)`. `updated_at` is set by a database trigger named in migration 018 (whether it exists in production is not established from repository inspection). |
| 10 | Body handling: how content travels | On load the editor receives the article rendered to HTML (`renderMarkdown`, `blog-post-mapper.js`) and shows it in a rich-text (contenteditable) area. On save, `serialiseContent()` converts the DOM **back to Markdown** (`blockMd`/`inlineMd`). So the body is Markdown → HTML → Markdown on every save. |
| 11 | Body handling: server cleaning | `sanitiseMarkdown` (`routes/admin/posts.js`) deletes `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<svg>`, `<math>` with their contents; deletes every other raw HTML tag except `<u>`, `<br>`, `<sub>`, `<sup>` (keeping the text); rewrites `javascript:`, `vbscript:` and `data:` link targets to `#`. |
| 12 | Is the round trip lossless? | **Not established from repository inspection.** Nothing in the code proves that Markdown → editor → Markdown returns the original text, or that stored bodies contain no raw HTML the sanitiser would strip. This is the reason for the pilot. |
| 13 | Other fields recomputed or normalised | Trimmed and empty → `NULL` for both SEO fields; `author` defaults to "The Doc Mirror"; `category` defaults to "Guide"; `tags` deduplicated (max 30); `featured_image` kept only if http(s), mailto or starting with `/` (else blanked); `faq` entries missing a question or answer are dropped; `related_slugs` deduplicated, invalid ones dropped, max 6, self removed; `read_time_minutes` taken from the form or recomputed if blank; `excerpt` regenerated from the body if blank; schema toggles taken from the form. |
| 14 | Validation that can block Publish Now | Title required; slug must be valid; publish requires non-empty title, slug, featured image, image ALT, category, SEO title and meta description (`PUBLISH_REQUIRED`); slug-lock error if the slug differs; slug conflict (409) if changed. Errors return HTTP 400/409 with a message. |
| 15 | Where the two meta values appear publicly | `seoTitle` → `<title>`, `og:title`, `twitter:title`. `metaDescription` → `<meta name="description">`, `og:description`, `twitter:description` **and the Article JSON-LD `description`** (`routes/resources.js` lines ~342, 429-430). So the Article schema `description` is *expected* to change with the meta description; nothing else in schema should. |
| 16 | Freshness | Public CMS cache TTL is `RESOURCES_CMS_TTL_MS` (default 60 s) (`lib/resources-db.js`). CDN/edge caching in production is not established from repository inspection, so re-check after a minute and again later before judging. |
| 17 | Client safety | The editor warns on leaving with unsaved changes (`beforeunload`). Auth is a Supabase Bearer token plus `profiles.role = admin` checked on every request (`lib/admin-auth.js`). |
| 18 | Revision history / undo | None found. No revision or history table is referenced in the inspected migration and admin code, and `DELETE` is permanent. **Not established** beyond that; do not assume a rollback exists. |

## 4. Selected Pilot Articles

`CMS_METADATA_IMPLEMENTATION_PLAN.md` has **no explicit pilot order**, so the rule from the task applies: take the first 3 in the plan's order (section 5, item 1: P0 posts, then the numbered table) that have a recommended title and/or description change and are not `HOLD`, `FACT-CHECK FIRST` or audit-`KEEP`. The plan's first four rows are `ai-search-doctors-india`, `can-indian-doctors-advertise-online` (**FACT-CHECK FIRST**, skipped), `distance-vs-prominence-local-search`, `fix-wrong-google-maps-pin-clinic`.

| Order | Slug | Plan row | Priority | Title | Description |
|---|---|---|---|---|---|
| 1 | ai-search-doctors-india | 1 | P0 | CHANGE (MINOR UPDATE) | CHANGE (MINOR UPDATE) |
| 2 | distance-vs-prominence-local-search | 3 | P0 | CHANGE (MINOR UPDATE) | CHANGE (MINOR UPDATE) |
| 3 | fix-wrong-google-maps-pin-clinic | 4 | P0 | CHANGE (MINOR UPDATE) | CHANGE (MINOR UPDATE) |

Reason for selection (plan only): each is P0, has both a title and a description change, is not on HOLD, not FACT-CHECK FIRST and not unchanged, and is next in the plan's order.

**One consideration that is not in the plan (for your decision):** these three are P0 pages, meaning they already have search impressions. A bad save on them has more exposure than on a low-traffic page. The plan's order was followed as instructed; you may choose to start with a lower-priority page instead.

"Current" values are what the site rendered on 2026-09-24 (effective values); whether each database column was set or `NULL` is not established. All recommended values are copied from `SEO_METADATA_MASTER.md` (same in the CSV and before/after files).

### ai-search-doctors-india

- Public URL (must not change): https://www.thedocmirror.com/resources/ai-search-doctors-india
- Current SEO title (45): AI Search for Doctors in India: Beyond Practo
- Recommended SEO title (49): AI Search for Doctors in India: Is Practo Enough?
- Current meta description (148): AI search for doctors in India now draws on many sources, not one directory. Here is why a single Practo profile leaves you thin, and how to fix it.
- Recommended meta description (158): AI assistants name doctors by cross-checking many sources, so one Practo profile leaves you thin. See how AI picks, what to fix and how to stay NMC-compliant.

### distance-vs-prominence-local-search

- Public URL (must not change): https://www.thedocmirror.com/resources/distance-vs-prominence-local-search
- Current SEO title (48): Distance vs Prominence: How Google Ranks Clinics
- Recommended SEO title (58): Relevance, Distance, Prominence: Why a Farther Clinic Wins
- Current meta description (174): Why does a clinic further away outrank yours in Google's map pack? Because distance is only one of three factors. Here is how relevance, distance, and prominence really work.
- Recommended meta description (158): Why does a farther clinic outrank yours in the map pack? Google weighs relevance, distance and prominence. See how each works, with a 30-day plan to catch up.

### fix-wrong-google-maps-pin-clinic

- Public URL (must not change): https://www.thedocmirror.com/resources/fix-wrong-google-maps-pin-clinic
- Current SEO title (52): Clinic at the Wrong Spot on Google Maps? Fix the Pin
- Recommended SEO title (52): Wrong Google Maps Pin for Your Clinic? How to Fix It
- Current meta description (178): Your clinic pin is in the wrong place on Google Maps and patients are getting lost. Here is why it happens, how to move the marker safely, and how to keep it from drifting again.
- Recommended meta description (154): Clinic pin in the wrong place on Google Maps? Move the marker to your exact entrance, confirm it held and stop it drifting back. Step-by-step for doctors.

## 5. Before-Edit Checklist (repeat for each pilot article)

Do every item **before** opening the editor. Capture the public page with plain GET requests (no login needed). Use the values in section 4; write down anything the repository cannot supply.

For each article, in order:

1. Fetch the public page **twice** to learn what varies between identical requests: `curl -s https://www.thedocmirror.com/resources/<slug> -o before-<slug>-1.html` and again into `-2.html`, then `diff before-<slug>-1.html before-<slug>-2.html`. Any difference here is baseline noise and must not be counted as a change later. (Whether the page has such noise is not established.)
2. Keep `before-<slug>-1.html` unchanged as the reference. Take a full-page screenshot.
3. Complete the snapshot list below.

#### BEFORE: ai-search-doctors-india

- Slug: ai-search-doctors-india   Editor URL pattern: `/admin/blogs/<id>/edit`   Post ID source: list page link / editor URL   ID: ______
- Current SEO title (45): AI Search for Doctors in India: Beyond Practo
- Recommended SEO title (49): AI Search for Doctors in India: Is Practo Enough?
- Current meta description (148): AI search for doctors in India now draws on many sources, not one directory. Here is why a single Practo profile leaves you thin, and how to fix it.
- Recommended meta description (158): AI assistants name doctors by cross-checking many sources, so one Practo profile leaves you thin. See how AI picks, what to fix and how to stay NMC-compliant.

- [ ] Article title unchanged (record it): ______
- [ ] H1 unchanged (record it): ______
- [ ] Article body unchanged (saved copy of the public page: `before-<slug>.html`)
- [ ] Paragraph count noted: ______
- [ ] Images noted (count and file names): ______
- [ ] Image ALT text noted: ______
- [ ] Internal links noted (count and targets): ______
- [ ] External links noted (count and targets): ______
- [ ] Author noted: ______
- [ ] Category and tags noted: ______
- [ ] Slug noted (from the URL): ______
- [ ] Publish date noted (shown on the page and in JSON-LD `datePublished`): ______
- [ ] Published status confirmed (page loads at the public URL): ______
- [ ] Canonical URL noted (`<link rel="canonical">`): ______
- [ ] Structured data noted (all JSON-LD blocks saved in `before-<slug>.html`): ______
- [ ] Existing page `<title>` and meta description noted, and equal to the "current" values in section 4: ______

#### BEFORE: distance-vs-prominence-local-search

- Slug: distance-vs-prominence-local-search   Editor URL pattern: `/admin/blogs/<id>/edit`   Post ID source: list page link / editor URL   ID: ______
- Current SEO title (48): Distance vs Prominence: How Google Ranks Clinics
- Recommended SEO title (58): Relevance, Distance, Prominence: Why a Farther Clinic Wins
- Current meta description (174): Why does a clinic further away outrank yours in Google's map pack? Because distance is only one of three factors. Here is how relevance, distance, and prominence really work.
- Recommended meta description (158): Why does a farther clinic outrank yours in the map pack? Google weighs relevance, distance and prominence. See how each works, with a 30-day plan to catch up.

- [ ] Article title unchanged (record it): ______
- [ ] H1 unchanged (record it): ______
- [ ] Article body unchanged (saved copy of the public page: `before-<slug>.html`)
- [ ] Paragraph count noted: ______
- [ ] Images noted (count and file names): ______
- [ ] Image ALT text noted: ______
- [ ] Internal links noted (count and targets): ______
- [ ] External links noted (count and targets): ______
- [ ] Author noted: ______
- [ ] Category and tags noted: ______
- [ ] Slug noted (from the URL): ______
- [ ] Publish date noted (shown on the page and in JSON-LD `datePublished`): ______
- [ ] Published status confirmed (page loads at the public URL): ______
- [ ] Canonical URL noted (`<link rel="canonical">`): ______
- [ ] Structured data noted (all JSON-LD blocks saved in `before-<slug>.html`): ______
- [ ] Existing page `<title>` and meta description noted, and equal to the "current" values in section 4: ______

#### BEFORE: fix-wrong-google-maps-pin-clinic

- Slug: fix-wrong-google-maps-pin-clinic   Editor URL pattern: `/admin/blogs/<id>/edit`   Post ID source: list page link / editor URL   ID: ______
- Current SEO title (52): Clinic at the Wrong Spot on Google Maps? Fix the Pin
- Recommended SEO title (52): Wrong Google Maps Pin for Your Clinic? How to Fix It
- Current meta description (178): Your clinic pin is in the wrong place on Google Maps and patients are getting lost. Here is why it happens, how to move the marker safely, and how to keep it from drifting again.
- Recommended meta description (154): Clinic pin in the wrong place on Google Maps? Move the marker to your exact entrance, confirm it held and stop it drifting back. Step-by-step for doctors.

- [ ] Article title unchanged (record it): ______
- [ ] H1 unchanged (record it): ______
- [ ] Article body unchanged (saved copy of the public page: `before-<slug>.html`)
- [ ] Paragraph count noted: ______
- [ ] Images noted (count and file names): ______
- [ ] Image ALT text noted: ______
- [ ] Internal links noted (count and targets): ______
- [ ] External links noted (count and targets): ______
- [ ] Author noted: ______
- [ ] Category and tags noted: ______
- [ ] Slug noted (from the URL): ______
- [ ] Publish date noted (shown on the page and in JSON-LD `datePublished`): ______
- [ ] Published status confirmed (page loads at the public URL): ______
- [ ] Canonical URL noted (`<link rel="canonical">`): ______
- [ ] Structured data noted (all JSON-LD blocks saved in `before-<slug>.html`): ______
- [ ] Existing page `<title>` and meta description noted, and equal to the "current" values in section 4: ______

## 6. Manual Edit Procedure

For one article at a time (do not start the next until this one has passed section 8):

1. Sign in to `/admin/login` with your own admin account. (Do not share credentials or tokens.)
2. Open `/admin/blogs`, find the post by slug, click **Edit**.
3. Read the post ID from the editor URL (`/admin/blogs/<id>/edit`) and write it in the record above.
4. Compare the **SEO Title** and **Meta Description** fields with the "current" values in section 4. If either differs or is empty, **stop**: the post has changed since the audit or the column is `NULL`. Record it and ask before continuing.
5. Replace the SEO Title and Meta Description with the recommended text, copied exactly (no edits, no extra spaces, no brand suffix). Change nothing else. Do not click into or type in the body, and do not reformat anything.
6. Confirm the counters show at most 60 and 160.
7. Do **not** click **Save Draft**. Click **Publish Now**.
8. Confirm the status chip still says **Published** and no error banner appears. If any error appears, **stop** (section 8, No-Go).
9. Wait about one minute (default cache TTL, section 3).
10. Fetch the public page again: `curl -s https://www.thedocmirror.com/resources/<slug> -o after-<slug>.html`, and open it in a browser. If it still shows old metadata, wait and retry; do not re-save.
11. Run the comparison in section 7.

## 7. After-Edit Verification (repeat for each pilot article)

**Primary detector:** `diff before-<slug>-1.html after-<slug>.html` (ignoring anything found in the baseline-noise check). Because the public page is rendered from the stored body, any body/link/image/ALT change the save caused will show up here.

**The only differences allowed in the diff:**
- `<title>`
- `<meta property="og:title">` and `<meta name="twitter:title">`
- `<meta name="description">`, `og:description`, `twitter:description`
- the Article JSON-LD `"description"` value (it is fed from the meta description)

**Any other difference is a NO-GO.**

#### AFTER: ai-search-doctors-india

**SEO**
- [ ] New SEO title matches the recommended value exactly (character for character)
- [ ] New meta description matches the recommended value exactly

**Content**
- [ ] H1 unchanged
- [ ] Article body unchanged (diff shows no body difference)
- [ ] Paragraph structure unchanged (same paragraph count as recorded)
- [ ] Images unchanged
- [ ] Image ALT text unchanged
- [ ] Internal links unchanged (same count and targets)
- [ ] External links unchanged (same count and targets)

**Metadata**
- [ ] Slug unchanged
- [ ] Canonical unchanged
- [ ] Author unchanged
- [ ] Category and tags unchanged
- [ ] Publish date unchanged (page and JSON-LD `datePublished`)
- [ ] Published status remains live (page loads at the same URL)
- [ ] Structured data unchanged apart from the Article `description`

**Rendering**
- [ ] Public page loads normally
- [ ] No missing sections
- [ ] No broken images
- [ ] No broken internal links (note: existing 404 links from the audit, if any, are not new)
- [ ] No unexpected formatting changes (compare against the screenshot)
- [ ] Page title in the browser tab is correct
- [ ] Meta description in the page source is correct

- Result: GO / NO-GO   Checked by: ______   Time: ______

#### AFTER: distance-vs-prominence-local-search

**SEO**
- [ ] New SEO title matches the recommended value exactly (character for character)
- [ ] New meta description matches the recommended value exactly

**Content**
- [ ] H1 unchanged
- [ ] Article body unchanged (diff shows no body difference)
- [ ] Paragraph structure unchanged (same paragraph count as recorded)
- [ ] Images unchanged
- [ ] Image ALT text unchanged
- [ ] Internal links unchanged (same count and targets)
- [ ] External links unchanged (same count and targets)

**Metadata**
- [ ] Slug unchanged
- [ ] Canonical unchanged
- [ ] Author unchanged
- [ ] Category and tags unchanged
- [ ] Publish date unchanged (page and JSON-LD `datePublished`)
- [ ] Published status remains live (page loads at the same URL)
- [ ] Structured data unchanged apart from the Article `description`

**Rendering**
- [ ] Public page loads normally
- [ ] No missing sections
- [ ] No broken images
- [ ] No broken internal links (note: existing 404 links from the audit, if any, are not new)
- [ ] No unexpected formatting changes (compare against the screenshot)
- [ ] Page title in the browser tab is correct
- [ ] Meta description in the page source is correct

- Result: GO / NO-GO   Checked by: ______   Time: ______

#### AFTER: fix-wrong-google-maps-pin-clinic

**SEO**
- [ ] New SEO title matches the recommended value exactly (character for character)
- [ ] New meta description matches the recommended value exactly

**Content**
- [ ] H1 unchanged
- [ ] Article body unchanged (diff shows no body difference)
- [ ] Paragraph structure unchanged (same paragraph count as recorded)
- [ ] Images unchanged
- [ ] Image ALT text unchanged
- [ ] Internal links unchanged (same count and targets)
- [ ] External links unchanged (same count and targets)

**Metadata**
- [ ] Slug unchanged
- [ ] Canonical unchanged
- [ ] Author unchanged
- [ ] Category and tags unchanged
- [ ] Publish date unchanged (page and JSON-LD `datePublished`)
- [ ] Published status remains live (page loads at the same URL)
- [ ] Structured data unchanged apart from the Article `description`

**Rendering**
- [ ] Public page loads normally
- [ ] No missing sections
- [ ] No broken images
- [ ] No broken internal links (note: existing 404 links from the audit, if any, are not new)
- [ ] No unexpected formatting changes (compare against the screenshot)
- [ ] Page title in the browser tab is correct
- [ ] Meta description in the page source is correct

- Result: GO / NO-GO   Checked by: ______   Time: ______

## 8. Go / No-Go Criteria

**GO** (continue to the next pilot article, and finally to the remaining posts) only if **all** are true:
- SEO title is correct
- meta description is correct
- article remains published
- publish date is unchanged
- slug is unchanged
- body/content is unchanged (diff shows nothing beyond the allowed list)
- no unexpected rendering changes
- no images, ALT text, internal links or external links changed
- no other CMS field changed unexpectedly

**NO-GO** (stop immediately) if **any** occurs:
- body changes
- article becomes draft
- publish date changes
- slug changes
- images change
- ALT text changes
- links change
- schema or canonical change unexpectedly (anything beyond the Article `description`)
- article rendering changes
- metadata does not match the approved plan
- Publish Now causes an unexpected validation or server error

After a NO-GO: **do not attempt a workaround, do not use direct SQL, do not call the API manually, do not create a script.** Record the exact failure (section 9) and stop.

## 9. Rollback / Failure Handling

- **No rollback mechanism is established by the repository.** No revision history was found and deletion is permanent (section 3, last row). Do not assume one exists.
- If only the two metadata fields are wrong or missing: the plan's recovery is to re-enter the recorded "current" values in the editor and click Publish Now. This is a manual re-edit, not an undo, and it re-runs the same whole-row save, so it can repeat whatever caused the problem. Only do it if the cause is understood.
- If the **body, links, images, ALT text or another field changed**: stop. The stored original is not available in the repository for CMS posts, so the saved `before-<slug>-1.html` and screenshot are the only reference. Do not try to repair it by saving again; ask for a decision.
- If the post **became draft or disappeared**: stop and report immediately. Do not press Save Draft or Publish Now again until you know why.
- Write down for the report: article slug and ID, exact time, which button was pressed, the visible error text, and what differed (paste the diff). Keep the before/after HTML files.
- The remaining 38 posts stay untouched until the cause is understood and the pilot is re-planned.

## 10. Remaining 38 CMS Articles

The other **38** CMS articles must **not** be edited until all 3 pilot articles pass section 8. The plan's order, holds and fact-check rules then continue to apply to them unchanged.

## 11. Holds and Fact Checks

Terminology from `CMS_METADATA_IMPLEMENTATION_PLAN.md`. None of these is in the pilot:

- **HOLD:** `track-ai-visibility`. HOLD: audit marks the recommended text as FALLBACK ONLY; leave metadata untouched until the duplicate pair (with `how-to-track-ai-visibility`) is decided.
- **FACT-CHECK FIRST (5), scheduled last, metadata only, article bodies not edited:**
  - `can-indian-doctors-advertise-online`: NMC regulations (regulatory claim)
  - `respond-to-negative-patient-reviews`: HIPAA / OCR penalties (legal claim)
  - `insurance-find-a-doctor-directories`: No Surprises Act; "up to half of listings are wrong" (legal + statistic)
  - `ai-visibility-statistics-doctors`: KFF and other statistics (sourcing)
  - `patient-star-rating-threshold`: "roughly three in four" rating-filter statistic (sourcing)
- **No change (audit KEEP), 3:** `local-seo-new-practice-90-days`, `healthgrades-zocdoc-vitals`, `ai-visibility-myths-doctors`.
