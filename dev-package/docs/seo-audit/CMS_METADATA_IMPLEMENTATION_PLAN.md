# CMS Metadata Implementation Plan (Supabase `blog_posts`)

> PLAN ONLY. Nothing in this file has been executed. No database write, no production API call, no application file change, no commit. Prepared 2026-09-24 from the repository and the approved audit files.

## 0. Bottom line

- **41 CMS articles** are accounted for (41 of 41 slugs exist in the live collection snapshot; none is also a Markdown file).
- **36 titles and 30 descriptions** change per the audit; **3 articles stay unchanged** (local-seo-new-practice-90-days, healthgrades-zocdoc-vitals, ai-visibility-myths-doctors).
- **37 posts** are ready to edit; **1 is on HOLD** (`track-ai-visibility`); **5 carry claims that need separate fact-checking** and are scheduled last.
- **Safe mechanism:** the existing admin editor at `/admin/blogs/:id/edit`, one post at a time, using **Publish Now** (never Save Draft). It calls `PATCH /api/admin/posts/:id`. There is **no bulk metadata endpoint**.
- **Authentication required:** a logged-in admin (Supabase session with `profiles.role = admin`). I do not have one and did not try to obtain one.
- **Biggest risk:** the PATCH rewrites the whole row from the form, and `Save Draft` on a live post unpublishes it. See sections 2 and 6.

## 1. Exact CMS metadata fields

| Layer | Title | Description |
|---|---|---|
| DB column (`blog_posts`) | `seo_title` | `meta_description` |
| Admin editor input | `#f-seotitle` (counter warns at 60) | `#f-metadesc` (counter warns at 160) |
| Request payload key | `seo_title` | `meta_description` |
| Public mapper (`lib/blog-post-mapper.js`) | `seoTitle = row.seo_title \|\| title` | `metaDescription = row.meta_description \|\| excerpt` |
| Rendered as | `<title>`, `og:title`, `twitter:title` | `<meta name="description">`, `og:description`, `twitter:description` |

Server rule (`buildFields`): each value is trimmed and an empty string is stored as `NULL`, in which case the page falls back to the article title / excerpt. Both fields are required to publish.

**Important about "current" values below:** they are the values the site *rendered* on 2026-09-24 (effective values, including the fallback). I made no database read in this phase, so I cannot say whether the raw column was set or `NULL`. Check the editor field before editing (step 3 of the workflow).

## 2. Existing admin flow (inspected, unchanged)

| Item | Finding |
|---|---|
| Editor page | `/admin/blogs/:id/edit` (`public/admin/editor.html` + `editor.js`); list at `/admin/blogs` (`blogs.html`) |
| Update endpoint | `PATCH /api/admin/posts/:id` (`routes/admin/posts.js`, `update`). Other routes: `GET /api/admin/posts` (list), `GET /api/admin/posts/:id`, `POST /api/admin/posts/:id/status` (status only), `DELETE` (permanent) |
| Auth | `app.use('/api/admin', requireAuth, requireAdmin)`: Supabase Bearer JWT (`Authorization: Bearer <token>`, kept in `localStorage` as `tdm_access_token`) plus `profiles.role = admin` re-read from the DB on every request |
| CSRF | None needed or present: the token travels in a header, not a cookie, so a cross-site form cannot ride on it |
| Bulk edit | **None.** `POST /api/admin/import/markdown` only parses a file into form fields and writes nothing. `setStatus` changes status only |
| How the form submits | `collect(action)` sends the **entire** article (title, slug, excerpt, `content_md`, author, category, tags, image, alt, seo fields, read time, FAQ, related slugs, schema toggles, dates) |
| What the server does | `buildFields` rebuilds **every** column from that body (trims, sanitises `content_md`, defaults author/category, regenerates excerpt/read time if empty, drops invalid related slugs), then `resolveStatus(action)` sets status. Then `UPDATE blog_posts SET <all fields>, status, published_at, updated_by WHERE id` |
| Slug lock | A post that has been live cannot change slug (server refuses), so URLs are protected |
| Status by button | `Publish Now` → `published` and **keeps the original `published_at`** for an already-live post. `Save Draft` → `draft` (**removes it from the site**). `Archive` → `archived`. `Schedule` → future date |
| Publish gate | Publishing requires title, slug, featured image, image ALT, category, SEO title and meta description all non-empty; a post missing any (for example an image ALT) cannot be re-saved with Publish Now until fixed |
| Freshness | Public CMS cache refreshes every `RESOURCES_CMS_TTL_MS` (default 60 s), so a change appears within about a minute per server instance |
| Sitemap | `lastmod` uses the publish date, so an edit does not change it |

## 3. Recommended workflow (manual, one post at a time)

Use the admin editor. It is the only supported write path, it enforces the slug lock and the publish checklist, and it needs no code change. Roughly 2 field edits per post.

For each post, in the order in section 5:

1. Sign in at `/admin/login` as an admin. Find the post in `/admin/blogs` by slug and open it (the URL contains the post ID; record it in the table).
2. **Before editing**, confirm the SEO Title and Meta Description in the form equal the "current" values in the plan. If they differ (or the field is empty), stop and re-check: the post has changed since the audit.
3. Change **only** the fields marked in the plan. Paste the recommended text exactly. Do not touch anything else, and never adjust wording (the audit text is the approved text).
4. Click **Publish Now**. **Never click Save Draft, Archive or Schedule on a live post.** Confirm the status chip still says Published.
5. Wait about 60 seconds, then verify: `curl -s https://www.thedocmirror.com/resources/<slug> | grep -oE "<title>[^<]*</title>|name=\"description\" content=\"[^\"]*\""` and compare with the plan. Confirm the URL, H1 and body are unchanged (open the page).
6. Tick the post off in the log (section 7). To roll back, re-enter the "current" values and Publish Now.

**Optional faster route (needs your explicit approval; not built):** a one-off script that, for an allowlist of slugs, calls `GET /api/admin/posts/:id`, then `PATCH`es the same payload with only the two fields replaced, using an admin token you supply. It must (a) run in dry-run first and diff every stored column against what the PATCH would write, because `buildFields` re-sanitises `content_md` and can normalise other fields, (b) send `action: "publish"`, (c) refuse any slug not on the allowlist, and (d) stop on the first unexpected diff. It would be a new application file, so it needs a separate go-ahead. I recommend doing the first 3 posts by hand and comparing the rendered HTML before and after; if identical, the round-trip is safe.

## 4. Summary by action

- **Title and description change:** 28 posts
- **Title change only:** 8 posts: hindi-vs-english-clinic-website, multiple-doctors-one-google-listing, clinic-address-change-google, nap-audit-doctor-listings, storefront-vs-service-area, gbp-primary-category-doctors, merge-duplicate-google-listings, check-ai-visibility-doctors
- **Description change only:** 2 posts: how-patients-in-india-find-doctors, doctor-online-presence-audit-checklist
- **No change (audit KEEP):** 3 posts: local-seo-new-practice-90-days, healthgrades-zocdoc-vitals, ai-visibility-myths-doctors
- **Titles changing:** 36. **Descriptions changing:** 30.
- **Already covered by the Markdown phase:** none of the 41 (Markdown handled its own 25).

## 5. Order of work and holds

1. **P0 posts** (GSC impressions, 0 clicks): ai-search-doctors-india, can-indian-doctors-advertise-online, distance-vs-prominence-local-search, fix-wrong-google-maps-pin-clinic, gemini-ai-for-doctors, how-chatgpt-chooses-doctors, how-many-google-reviews-to-rank, respond-to-negative-patient-reviews
2. **P1 then P2 posts** in the order of the table below.
3. **Regulatory / statistics posts last, after separate fact-check sign-off** (metadata only; the articles are not to be edited in this task):
   - `can-indian-doctors-advertise-online`: NMC regulations (regulatory claim)
   - `respond-to-negative-patient-reviews`: HIPAA / OCR penalties (legal claim)
   - `insurance-find-a-doctor-directories`: No Surprises Act; "up to half of listings are wrong" (legal + statistic)
   - `ai-visibility-statistics-doctors`: KFF and other statistics (sourcing)
   - `patient-star-rating-threshold`: "roughly three in four" rating-filter statistic (sourcing)
4. **HOLD:** `track-ai-visibility`. HOLD: audit marks the recommended text as FALLBACK ONLY; leave metadata untouched until the duplicate pair (with how-to-track-ai-visibility) is decided. Its sibling `how-to-track-ai-visibility` (lean survivor) can proceed, but note the two will then have different metadata while both exist.

## 6. Risks

- **Unpublishing by mistake.** `Save Draft` on a live post sets it to `draft` and removes it from the site and sitemap. Always use Publish Now.
- **Whole-row rewrite.** The PATCH rewrites every column from the form. If the editor mangles content (rich-text round-trip in `serialiseContent()`, or `sanitiseMarkdown` stripping something), an "SEO-only" save could change the article body. Mitigation: compare rendered HTML before/after on the first posts; stop if anything but the two meta tags differs.
- **Publish gate can block a save.** A live post missing (for example) an image ALT cannot be saved with Publish Now. Do not work around it with Save Draft; report the post instead.
- **Other columns touched:** `updated_by` and (if a trigger exists) `updated_at` change on every save; read time and excerpt may be regenerated if blank. Not visible to readers, but not "metadata only" in the database.
- **Stale "current" values.** The plan was built from rendered values on 2026-09-24; someone may have edited a post since. Step 2 of the workflow catches this.
- **Duplicate/near-duplicate metadata across sources.** The Markdown twin `reviews-ai-recommendation` was already given its fallback text; the CMS twin `patient-reviews-influence-ai` gets the primary text. They now differ, which is intended, but consolidation is still undecided.
- **Claims in descriptions.** Regulatory and statistics posts (section 5) contain claims in the approved text ("recent OCR penalties", "up to half"). Apply only after fact-check sign-off.
- **Cache lag.** Changes appear after about 60 s per instance; do not judge from the first reload.
- **Human error at scale.** 41 manual pastes; use the exact strings from this file and tick each one off.
- **Secrets.** Never paste an admin token into chat or commit it. If the optional script is approved, the token must come from an environment variable.

## 7. Per-article plan (41)

IDs: **not available**; reading them needs either a database read or the admin list API, and neither was done in this phase. Find each ID from the editor URL when opening the post by slug. "Current" = rendered value on 2026-09-24. Char counts in brackets.

| # | Slug | ID | Priority | Title | Description | Done |
|---|---|---|---|---|---|---|
| 1 | ai-search-doctors-india | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 2 | can-indian-doctors-advertise-online FACT-CHECK FIRST | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 3 | distance-vs-prominence-local-search | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 4 | fix-wrong-google-maps-pin-clinic | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 5 | gemini-ai-for-doctors | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 6 | how-chatgpt-chooses-doctors | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 7 | how-many-google-reviews-to-rank | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 8 | respond-to-negative-patient-reviews FACT-CHECK FIRST | (from editor URL) | P0 | CHANGE | CHANGE | [ ] |
| 9 | aeo-vs-seo-vs-geo-doctors | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 10 | ai-crawlers-doctor-website | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 11 | ai-visibility-statistics-doctors FACT-CHECK FIRST | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 12 | check-ai-visibility-doctors | (from editor URL) | P1 | CHANGE | keep | [ ] |
| 13 | clinic-address-change-google | (from editor URL) | P1 | CHANGE | keep | [ ] |
| 14 | digital-pr-ai-authority-doctors | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 15 | directory-citations-ai-visibility | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 16 | doctor-online-presence-audit-checklist | (from editor URL) | P1 | keep | CHANGE | [ ] |
| 17 | entity-seo-for-doctors | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 18 | gbp-primary-category-doctors | (from editor URL) | P1 | CHANGE | keep | [ ] |
| 19 | gbp-video-verification | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 20 | google-rank-1-ai-search | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 21 | healthgrades-zocdoc-vitals | (from editor URL) | P1 | keep | keep | [ ] |
| 22 | how-patients-in-india-find-doctors | (from editor URL) | P1 | keep | CHANGE | [ ] |
| 23 | how-to-track-ai-visibility | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 24 | make-clinic-content-quotable-by-ai | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 25 | merge-duplicate-google-listings | (from editor URL) | P1 | CHANGE | keep | [ ] |
| 26 | multiple-doctors-one-google-listing | (from editor URL) | P1 | CHANGE | keep | [ ] |
| 27 | nap-audit-doctor-listings | (from editor URL) | P1 | CHANGE | keep | [ ] |
| 28 | patient-reviews-influence-ai | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 29 | patient-star-rating-threshold FACT-CHECK FIRST | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 30 | perplexity-ai-for-doctors | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 31 | reinstate-suspended-gbp | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 32 | track-ai-visibility HOLD | (from editor URL) | P1 | CHANGE | CHANGE | [ ] |
| 33 | ai-visibility-myths-doctors | (from editor URL) | P2 | keep | keep | [ ] |
| 34 | claude-ai-for-doctors | (from editor URL) | P2 | CHANGE | CHANGE | [ ] |
| 35 | clinic-photos-google-ranking | (from editor URL) | P2 | CHANGE | CHANGE | [ ] |
| 36 | hindi-vs-english-clinic-website | (from editor URL) | P2 | CHANGE | keep | [ ] |
| 37 | insurance-find-a-doctor-directories FACT-CHECK FIRST | (from editor URL) | P2 | CHANGE | CHANGE | [ ] |
| 38 | local-seo-new-practice-90-days | (from editor URL) | P2 | keep | keep | [ ] |
| 39 | storefront-vs-service-area | (from editor URL) | P2 | CHANGE | keep | [ ] |
| 40 | voice-search-ai-doctors | (from editor URL) | P2 | CHANGE | CHANGE | [ ] |
| 41 | zero-click-patient-ai | (from editor URL) | P2 | CHANGE | CHANGE | [ ] |

### 1. ai-search-doctors-india

- URL (must not change): https://www.thedocmirror.com/resources/ai-search-doctors-india
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (45): AI Search for Doctors in India: Beyond Practo
  - Recommended (49): AI Search for Doctors in India: Is Practo Enough?
- **meta_description: MINOR UPDATE**
  - Current (148): AI search for doctors in India now draws on many sources, not one directory. Here is why a single Practo profile leaves you thin, and how to fix it.
  - Recommended (158): AI assistants name doctors by cross-checking many sources, so one Practo profile leaves you thin. See how AI picks, what to fix and how to stay NMC-compliant.

### 2. can-indian-doctors-advertise-online

- URL (must not change): https://www.thedocmirror.com/resources/can-indian-doctors-advertise-online
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: LOW   Content update flagged by audit: YES | also fix 404 internal link(s): /blog/doctor-visibility
- **Fact-check first:** NMC regulations (regulatory claim). Do not edit the article body in this task.
- **seo_title: MINOR UPDATE**
  - Current (56): Can Indian Doctors Advertise Online? NMC Rules Explained
  - Recommended (59): Can Doctors Advertise in India? What NMC Rules Allow Online
- **meta_description: REWRITE**
  - Current (181): Can Indian doctors advertise online? Not in the promotional sense, but you can build a factual, accurate presence. Here is where the NMC line sits and how to stay on the right side.
  - Recommended (157): Advertising is off-limits, but an accurate, findable online presence is allowed. See where the NMC line sits, what is banned, what is fine and how to comply.

### 3. distance-vs-prominence-local-search

- URL (must not change): https://www.thedocmirror.com/resources/distance-vs-prominence-local-search
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: MEDIUM   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (48): Distance vs Prominence: How Google Ranks Clinics
  - Recommended (58): Relevance, Distance, Prominence: Why a Farther Clinic Wins
- **meta_description: MINOR UPDATE**
  - Current (174): Why does a clinic further away outrank yours in Google's map pack? Because distance is only one of three factors. Here is how relevance, distance, and prominence really work.
  - Recommended (158): Why does a farther clinic outrank yours in the map pack? Google weighs relevance, distance and prominence. See how each works, with a 30-day plan to catch up.

### 4. fix-wrong-google-maps-pin-clinic

- URL (must not change): https://www.thedocmirror.com/resources/fix-wrong-google-maps-pin-clinic
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (52): Clinic at the Wrong Spot on Google Maps? Fix the Pin
  - Recommended (52): Wrong Google Maps Pin for Your Clinic? How to Fix It
- **meta_description: MINOR UPDATE**
  - Current (178): Your clinic pin is in the wrong place on Google Maps and patients are getting lost. Here is why it happens, how to move the marker safely, and how to keep it from drifting again.
  - Recommended (154): Clinic pin in the wrong place on Google Maps? Move the marker to your exact entrance, confirm it held and stop it drifting back. Step-by-step for doctors.

### 5. gemini-ai-for-doctors

- URL (must not change): https://www.thedocmirror.com/resources/gemini-ai-for-doctors
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: HIGH   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (50): Gemini AI for Doctors: Get Your Clinic Recommended
  - Recommended (60): Gemini AI for Doctors: How Clinics Get Named in AI Overviews
- **meta_description: REWRITE**
  - Current (130): Learn how Gemini AI for doctors and Google AI Overviews pick which clinics to name, and the practical steps to become one of them.
  - Recommended (154): How Gemini and Google AI Overviews decide which clinics to name for a medical search, what influences them and a practical checklist for the US and India.

### 6. how-chatgpt-chooses-doctors

- URL (must not change): https://www.thedocmirror.com/resources/how-chatgpt-chooses-doctors
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: HIGH   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (47): How ChatGPT Chooses Doctors to Recommend (2026)
  - Recommended (56): How ChatGPT Chooses Which Doctor to Recommend in 5 Steps
- **meta_description: REWRITE**
  - Current (157): How ChatGPT chooses doctors: the real mechanism behind which one to three practices it names, from training data to live web retrieval and entity confidence.
  - Recommended (156): ChatGPT does not rank doctors like Google. See how it picks the one to three practices it names, from training data to live retrieval and entity confidence.

### 7. how-many-google-reviews-to-rank

- URL (must not change): https://www.thedocmirror.com/resources/how-many-google-reviews-to-rank
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: MINOR UPDATE**
  - Current (51): How Many Google Reviews Does a Clinic Need to Rank?
  - Recommended (56): Google Reviews to Rank a Clinic: How Many, and How Fast?
- **meta_description: REWRITE**
  - Current (178): How many Google reviews does a clinic need to rank in the local pack? Here is what the data shows about review count, the real threshold, and why velocity beats a big old number.
  - Recommended (155): No review count guarantees a rank, but about 50 is a working target and steady recent reviews beat a big old number. See the data, math and a review habit.

### 8. respond-to-negative-patient-reviews

- URL (must not change): https://www.thedocmirror.com/resources/respond-to-negative-patient-reviews
- CMS post ID: (not available in this phase)
- Priority: P0   Audit cannibalization: MEDIUM   Content update flagged by audit: NO
- **Fact-check first:** HIPAA / OCR penalties (legal claim). Do not edit the article body in this task.
- **seo_title: MINOR UPDATE**
  - Current (51): Responding to Negative Patient Reviews (HIPAA-Safe)
  - Recommended (55): How to Respond to Negative Patient Reviews (HIPAA-Safe)
- **meta_description: REWRITE**
  - Current (166): How to respond to negative patient reviews without a HIPAA violation. The rule, real OCR penalties, a safe response template, and what never to put in a public reply.
  - Recommended (151): A reply to a bad review can itself be a HIPAA violation. See the one rule, recent OCR penalties, a safe reply template and what never to say in public.

### 9. aeo-vs-seo-vs-geo-doctors

- URL (must not change): https://www.thedocmirror.com/resources/aeo-vs-seo-vs-geo-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: REWRITE**
  - Current (41): AEO vs SEO vs GEO: A Doctor's Plain Guide
  - Recommended (48): AEO vs SEO vs GEO: What Doctors Should Fix First
- **meta_description: REWRITE**
  - Current (133): AEO vs SEO vs GEO explained for doctors. The one-line difference, a clear comparison table, and which to fix first for AI visibility.
  - Recommended (160): SEO ranks your links, AEO gets your answers quoted and GEO builds the authority that makes AI recommend you. See the comparison table and which to tackle first.

### 10. ai-crawlers-doctor-website

- URL (must not change): https://www.thedocmirror.com/resources/ai-crawlers-doctor-website
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (53): AI Crawlers and Your Doctor Website: GPTBot Explained
  - Recommended (58): Can AI Crawlers Read Your Clinic Website? GPTBot, llms.txt
- **meta_description: MINOR UPDATE**
  - Current (140): Can AI crawlers read your doctor website? Learn GPTBot, llms.txt, robots.txt for AI, and how to let AI read your site and index your clinic.
  - Recommended (157): GPTBot, llms.txt and robots.txt decide whether AI can read your clinic site. Learn which crawlers matter, how to avoid blocking them and how to check access.

### 11. ai-visibility-statistics-doctors

- URL (must not change): https://www.thedocmirror.com/resources/ai-visibility-statistics-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES
- **Fact-check first:** KFF and other statistics (sourcing). Do not edit the article body in this task.
- **seo_title: MINOR UPDATE**
  - Current (55): Doctor AI Visibility Statistics for 2026: The Real Data
  - Recommended (58): AI Visibility Statistics for Doctors in 2026, With Sources
- **meta_description: HIGH PRIORITY REWRITE**
  - Current (152): The ai visibility statistics that matter for doctors in 2026, with real sources. See how many patients use AI to find doctors and what it means for you.
  - Recommended (159): How many patients ask AI for a doctor, and does it change who they choose? The 2026 statistics that matter for practices, each with a named source such as KFF.

### 12. check-ai-visibility-doctors

- URL (must not change): https://www.thedocmirror.com/resources/check-ai-visibility-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: MEDIUM   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (48): Check AI Visibility: Does ChatGPT Recommend You?
  - Recommended (60): Does ChatGPT Recommend Your Practice? A Free 10-Minute Check
- **meta_description: NO CHANGE** (audit KEEP). Current: Check AI visibility yourself in 10 minutes. Exact prompts to test ChatGPT, Gemini, Claude, and Perplexity to see if they recommend your practice by name.

### 13. clinic-address-change-google

- URL (must not change): https://www.thedocmirror.com/resources/clinic-address-change-google
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES | also fix 404 internal link(s): /blog/merge-duplicate-g
- **seo_title: MINOR UPDATE**
  - Current (50): Moved Your Clinic? Google Address Change Checklist
  - Recommended (55): Moved Your Clinic? How to Change Your Address on Google
- **meta_description: NO CHANGE** (audit KEEP). Current: A complete checklist for changing your clinic's address on Google without losing ranking: update the profile, re-verify, and fix every directory in order.

### 14. digital-pr-ai-authority-doctors

- URL (must not change): https://www.thedocmirror.com/resources/digital-pr-ai-authority-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (42): Digital PR for Doctors: Build AI Authority
  - Recommended (51): Digital PR for Doctors: Earn the Mentions AI Trusts
- **meta_description: MINOR UPDATE**
  - Current (167): Digital PR for doctors and AI works by earning third-party mentions. Learn how being written about elsewhere gets you named by ChatGPT, Gemini, Claude, and Perplexity.
  - Recommended (160): AI models weigh who writes about you. See how earning third-party mentions helps ChatGPT, Gemini, Claude and Perplexity name your practice, in the US and India.

### 15. directory-citations-ai-visibility

- URL (must not change): https://www.thedocmirror.com/resources/directory-citations-ai-visibility
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: MEDIUM   Content update flagged by audit: NO
- **seo_title: REWRITE**
  - Current (49): Directory Citations and AI Visibility for Doctors
  - Recommended (55): Directory Citations for Doctors: Why 6+ Listings Matter
- **meta_description: REWRITE**
  - Current (168): Directory citations tell AI your practice is real. Learn why 6+ consistent listings across medical directories get you named by ChatGPT, Gemini, Claude, and Perplexity.
  - Recommended (158): AI trusts details it can confirm across sources. See why six or more consistent medical-directory listings help ChatGPT, Gemini and Claude name your practice.

### 16. doctor-online-presence-audit-checklist

- URL (must not change): https://www.thedocmirror.com/resources/doctor-online-presence-audit-checklist
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: NO CHANGE** (audit KEEP). Current: Doctor Online Presence Audit: A 15-Point Self-Check
- **meta_description: MINOR UPDATE**
  - Current (166): A practical 15-point checklist to audit your clinic's online presence yourself, across Google, AI, directories, reviews, and your website, and find what to fix first.
  - Recommended (149): Audit your own clinic's online presence in 15 checks across Google, AI assistants, directories, reviews and your website, then see what to fix first.

### 17. entity-seo-for-doctors

- URL (must not change): https://www.thedocmirror.com/resources/entity-seo-for-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (45): Entity SEO for Doctors: Make AI Recognize You
  - Recommended (59): Entity SEO for Doctors: Help AI and Google Know Who You Are
- **meta_description: REWRITE**
  - Current (141): Entity SEO for doctors is how you make AI and Google's Knowledge Graph identify your practice unambiguously. Here is exactly how to build it.
  - Recommended (152): Entity SEO helps AI and Google identify your practice unambiguously. Build the basics, link profiles with sameAs and stand apart from same-name doctors.

### 18. gbp-primary-category-doctors

- URL (must not change): https://www.thedocmirror.com/resources/gbp-primary-category-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: MINOR UPDATE**
  - Current (56): Right Google Business Profile Category for Your Practice
  - Recommended (58): Primary Google Business Category for Doctors, by Specialty
- **meta_description: NO CHANGE** (audit KEEP). Current: How to choose the correct primary category for your medical practice on Google, a full list by specialty, and how to use secondary categories.

### 19. gbp-video-verification

- URL (must not change): https://www.thedocmirror.com/resources/gbp-video-verification
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/merge-duplicate-google
- **seo_title: MINOR UPDATE**
  - Current (54): Google Business Profile Video Verification for Doctors
  - Recommended (58): Google Business Profile Video Verification: What to Record
- **meta_description: MINOR UPDATE**
  - Current (144): What to record for Google Business Profile video verification as a doctor, why medical practices get rejected, and how to pass on the first try.
  - Recommended (153): What to record for Google Business Profile video verification as a doctor, why medical practices get rejected and how to improve your chances of passing.

### 20. google-rank-1-ai-search

- URL (must not change): https://www.thedocmirror.com/resources/google-rank-1-ai-search
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: REWRITE**
  - Current (59): Why Ranking #1 on Google No Longer Guarantees Patients Find
  - Recommended (54): Ranked #1 on Google but Missing in ChatGPT? Here's Why
- **meta_description: REWRITE**
  - Current (153): Google ranking vs AI search explained for doctors. Learn why you can rank #1 on Google and still be invisible to ChatGPT, Gemini, Claude, and Perplexity.
  - Recommended (160): You can rank #1 on Google and still go unnamed by ChatGPT, Gemini, Claude and Perplexity. Two scoreboards, two games: what differs and what to do about the gap.

### 21. healthgrades-zocdoc-vitals

- URL (must not change): https://www.thedocmirror.com/resources/healthgrades-zocdoc-vitals
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: NO CHANGE** (audit KEEP). Current: Healthgrades vs Zocdoc vs Vitals: Which Drives Patients?
- **meta_description: NO CHANGE** (audit KEEP). Current: How Healthgrades, Zocdoc, and Vitals differ for doctors, which drives real bookings, and why a consistent listing on each matters more than the choice.

### 22. how-patients-in-india-find-doctors

- URL (must not change): https://www.thedocmirror.com/resources/how-patients-in-india-find-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: NO CHANGE** (audit KEEP). Current: How Patients in India Find Doctors Online in 2026
- **meta_description: MINOR UPDATE**
  - Current (178): How do patients in India find doctors online? Most start with a search engine, check Google and Practo reviews, and decide in minutes. Here is the real journey and where you fit.
  - Recommended (155): Most patients in India start on a search engine, check Google and Practo reviews, and decide in minutes. See the real journey and where a clinic drops out.

### 23. how-to-track-ai-visibility

- URL (must not change): https://www.thedocmirror.com/resources/how-to-track-ai-visibility
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: HIGH   Content update flagged by audit: YES
- **seo_title: HIGH PRIORITY REWRITE**
  - Current (41): How to Track Your AI Visibility Over Time
  - Recommended (51): Track Your AI Visibility: What to Log and How Often
- **meta_description: HIGH PRIORITY REWRITE**
  - Current (160): Learn how to track AI visibility over time: what to log, how often to check ChatGPT, Gemini, Claude, and Perplexity, and why 90 days of data beats one snapshot.
  - Recommended (159): Check the same patient questions on ChatGPT, Gemini, Claude and Perplexity on a schedule and log five things each time. Why 90 days of data beats one snapshot.

### 24. make-clinic-content-quotable-by-ai

- URL (must not change): https://www.thedocmirror.com/resources/make-clinic-content-quotable-by-ai
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: MEDIUM   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: MINOR UPDATE**
  - Current (56): Make Your Clinic's Content Quotable by AI: Writing Moves
  - Recommended (56): Make Your Clinic's Pages Quotable by AI: 4 Writing Moves
- **meta_description: MINOR UPDATE**
  - Current (165): AI assistants quote content that is structured, sourced, and fact-dense. Here are the specific writing moves, backed by research, that make a clinic's pages citable.
  - Recommended (157): AI assistants quote pages that answer fast, cite sources and use clean structure. Four research-backed writing moves, plus a before-and-after clinic rewrite.

### 25. merge-duplicate-google-listings

- URL (must not change): https://www.thedocmirror.com/resources/merge-duplicate-google-listings
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (56): Find and Merge Duplicate Google Listings for Your Clinic
  - Recommended (57): Duplicate Google Listings for Your Clinic: Find and Merge
- **meta_description: NO CHANGE** (audit KEEP). Current: How to find duplicate Google Business Profiles for your clinic, report them, and merge or remove the extras so your reviews and ranking stop splitting.

### 26. multiple-doctors-one-google-listing

- URL (must not change): https://www.thedocmirror.com/resources/multiple-doctors-one-google-listing
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: MINOR UPDATE**
  - Current (51): Multiple Doctors, One Address: Google Listing Setup
  - Recommended (59): Multiple Doctors, One Address: Set Up Google Listings Right
- **meta_description: NO CHANGE** (audit KEEP). Current: Multiple doctors at one address on Google? Here is how to set up practitioner and practice listings the right way, so they stop competing and start ranking.

### 27. nap-audit-doctor-listings

- URL (must not change): https://www.thedocmirror.com/resources/nap-audit-doctor-listings
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: MEDIUM   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: MINOR UPDATE**
  - Current (51): The NAP Audit: Find Every Inconsistent Listing Fast
  - Recommended (57): NAP Audit for Doctors: Find Mismatched Listings in 30 Min
- **meta_description: NO CHANGE** (audit KEEP). Current: A 30-minute NAP audit for doctors: find every listing where your name, address, or phone conflicts, and fix the inconsistencies dragging your ranking.

### 28. patient-reviews-influence-ai

- URL (must not change): https://www.thedocmirror.com/resources/patient-reviews-influence-ai
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: HIGH   Content update flagged by audit: YES
- **seo_title: HIGH PRIORITY REWRITE**
  - Current (46): Reviews and AI Recommendation: Do They Matter?
  - Recommended (60): Do Patient Reviews Affect Whether AI Recommends Your Clinic?
- **meta_description: HIGH PRIORITY REWRITE**
  - Current (148): Do patient reviews affect whether AI recommends your clinic? The honest answer. Reviews shape Google's local pack, but AI naming leans more on data.
  - Recommended (153): Reviews shape Google's local pack but only indirectly affect whether ChatGPT names you. See where reviews help AI visibility and where data matters more.

### 29. patient-star-rating-threshold

- URL (must not change): https://www.thedocmirror.com/resources/patient-star-rating-threshold
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **Fact-check first:** "roughly three in four" rating-filter statistic (sourcing). Do not edit the article body in this task.
- **seo_title: REWRITE**
  - Current (55): The 4-Star Filter: The Rating Patients Won't Book Below
  - Recommended (57): 4-Star Rating Filter: Do Patients Skip Doctors Below 4.0?
- **meta_description: REWRITE**
  - Current (166): Most patients filter out any doctor rated below 4 stars before reading a word. Here is what the rating threshold data shows and how to move a practice above the line.
  - Recommended (160): Roughly three in four patients avoid doctors rated under four stars. See where the rating threshold sits, why 3.8 costs more than it looks and how to cross 4.0.

### 30. perplexity-ai-for-doctors

- URL (must not change): https://www.thedocmirror.com/resources/perplexity-ai-for-doctors
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (54): Perplexity AI for Doctors: How to Get Listed and Cited
  - Recommended (55): Perplexity AI for Doctors: How Your Practice Gets Cited
- **meta_description: REWRITE**
  - Current (141): Perplexity cites its sources for every answer. Learn how doctors get listed in Perplexity AI search and become a cited source patients trust.
  - Recommended (150): Perplexity shows numbered sources under every answer. See which sources it trusts for doctors, how a practice earns a citation and how to check yours.

### 31. reinstate-suspended-gbp

- URL (must not change): https://www.thedocmirror.com/resources/reinstate-suspended-gbp
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: LOW   Content update flagged by audit: YES | also fix 404 internal link(s): /blog/doctor-visibility
- **seo_title: MINOR UPDATE**
  - Current (54): Google Business Profile Suspended? Reinstatement Guide
  - Recommended (58): Suspended Google Business Profile? How Doctors Get It Back
- **meta_description: MINOR UPDATE**
  - Current (144): How to reinstate a suspended Google Business Profile for a medical practice: find the cause, fix it, gather documents, and appeal the right way.
  - Recommended (155): How to reinstate a suspended Google Business Profile for a medical practice: find the cause, fix it, gather documents and appeal through the right channel.

### 32. track-ai-visibility

- URL (must not change): https://www.thedocmirror.com/resources/track-ai-visibility
- CMS post ID: (not available in this phase)
- Priority: P1   Audit cannibalization: HIGH   Content update flagged by audit: YES
- **HOLD: audit marks the recommended text as FALLBACK ONLY; leave metadata untouched until the duplicate pair (with how-to-track-ai-visibility) is decided.**
- **seo_title: HIGH PRIORITY REWRITE**
  - Current (41): How to Track Your AI Visibility Over Time
  - Recommended (58): Keep a Simple AI Visibility Log: A Doctor's 90-Day Routine
- **meta_description: HIGH PRIORITY REWRITE**
  - Current (160): Learn how to track AI visibility over time: what to log, how often to check ChatGPT, Gemini, Claude, and Perplexity, and why 90 days of data beats one snapshot.
  - Recommended (157): Which patient questions to ask ChatGPT, Gemini, Claude and Perplexity, the five things to log each time, and how 90 days of records show if you are slipping.

### 33. ai-visibility-myths-doctors

- URL (must not change): https://www.thedocmirror.com/resources/ai-visibility-myths-doctors
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: NO CHANGE** (audit KEEP). Current: 9 AI Visibility Myths Doctors Still Believe
- **meta_description: NO CHANGE** (audit KEEP). Current: The most common AI visibility myths for doctors, corrected. See why ranking on Google, reviews alone, and "AI just makes things up" quietly cost you patients.

### 34. claude-ai-for-doctors

- URL (must not change): https://www.thedocmirror.com/resources/claude-ai-for-doctors
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: YES
- **seo_title: HIGH PRIORITY REWRITE**
  - Current (52): Claude AI for Doctors: How to Get Cited by Anthropic
  - Recommended (59): Claude AI for Doctors: How to Get Cited in Claude's Answers
- **meta_description: REWRITE**
  - Current (128): Learn how Claude AI retrieves and cites medical sources, and how doctors in the US and India can become citation-worthy content.
  - Recommended (157): Claude cites practices whose details are clean, consistent and quotable across the web. Learn how it picks sources and how US and Indian doctors can qualify.

### 35. clinic-photos-google-ranking

- URL (must not change): https://www.thedocmirror.com/resources/clinic-photos-google-ranking
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **seo_title: MINOR UPDATE**
  - Current (44): Do Clinic Photos Affect Your Google Ranking?
  - Recommended (53): Do Clinic Photos Affect Google Ranking? What to Shoot
- **meta_description: MINOR UPDATE**
  - Current (166): Do clinic photos affect your Google ranking? Mostly indirectly, through engagement and trust. Here is what the data shows, how many to add, and exactly what to shoot.
  - Recommended (155): Clinic photos help Google ranking indirectly, through engagement and trust. See what the data says, how many to add and the exact shot list for a practice.

### 36. hindi-vs-english-clinic-website

- URL (must not change): https://www.thedocmirror.com/resources/hindi-vs-english-clinic-website
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (58): Hindi or English for Your Clinic Website? A Doctor's Guide
  - Recommended (52): Hindi or English for a Clinic Website? How to Decide
- **meta_description: NO CHANGE** (audit KEEP). Current: Should your clinic website be in Hindi, English, or both? Here is what India's language data says, how patients and AI read each, and a practical way to decide.

### 37. insurance-find-a-doctor-directories

- URL (must not change): https://www.thedocmirror.com/resources/insurance-find-a-doctor-directories
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: YES - fix 404 internal link(s): /blog/doctor-visibility-scor
- **Fact-check first:** No Surprises Act; "up to half of listings are wrong" (legal + statistic). Do not edit the article body in this task.
- **seo_title: MINOR UPDATE**
  - Current (55): Insurance 'Find a Doctor' Directories: Fix Your Listing
  - Recommended (59): Insurance Find-a-Doctor Directories: Is Your Listing Wrong?
- **meta_description: MINOR UPDATE**
  - Current (161): Insured patients find doctors through their health plan's directory, and studies show up to half of those listings are wrong. Here is how to audit and fix yours.
  - Recommended (151): Studies found up to half of insurer directory listings are wrong. See how patients use them, what the No Surprises Act requires and how to audit yours.

### 38. local-seo-new-practice-90-days

- URL (must not change): https://www.thedocmirror.com/resources/local-seo-new-practice-90-days
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: YES | also fix 404 internal link(s): /blog/doctor-visibility
- **seo_title: NO CHANGE** (audit KEEP). Current: Local SEO Checklist for New Practices: First 90 Days
- **meta_description: NO CHANGE** (audit KEEP). Current: A 90-day local SEO checklist for a new medical practice: verify your profile, build consistent listings, earn first reviews, and get found by patients and AI.

### 39. storefront-vs-service-area

- URL (must not change): https://www.thedocmirror.com/resources/storefront-vs-service-area
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: YES | also fix 404 internal link(s): /blog/reinstate-suspend
- **seo_title: MINOR UPDATE**
  - Current (52): Storefront vs Service Area: Which for Your Practice?
  - Recommended (60): Storefront or Service-Area Listing? What Doctors Should Pick
- **meta_description: NO CHANGE** (audit KEEP). Current: Should your practice show its address as a storefront or hide it as a service-area business on Google? How to choose correctly and avoid a suspension.

### 40. voice-search-ai-doctors

- URL (must not change): https://www.thedocmirror.com/resources/voice-search-ai-doctors
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: HIGH PRIORITY REWRITE**
  - Current (54): Voice Search Doctors: How Patients Ask AI for Care Now
  - Recommended (54): Voice Search for Doctors: How Patients Ask Siri and AI
- **meta_description: HIGH PRIORITY REWRITE**
  - Current (152): Voice search doctors differently than they type. See how spoken, conversational queries to Siri, Google, and AI assistants change how patients find you.
  - Recommended (158): Patients speak to Siri, Google and AI assistants in full questions, not keywords. See how spoken queries differ and how to make your clinic findable by voice.

### 41. zero-click-patient-ai

- URL (must not change): https://www.thedocmirror.com/resources/zero-click-patient-ai
- CMS post ID: (not available in this phase)
- Priority: P2   Audit cannibalization: LOW   Content update flagged by audit: NO
- **seo_title: MINOR UPDATE**
  - Current (50): Zero-Click Search for Doctors: The AI Answer Shift
  - Recommended (58): Zero-Click Search for Doctors: When AI Answers the Patient
- **meta_description: REWRITE**
  - Current (145): Zero click search for doctors explained. See how AI answers now decide who patients contact, and how to be inside the answer, not just on a page.
  - Recommended (160): A patient asks an AI for a dermatologist, reads one answer and never visits a website. See what zero-click search means for doctors and how to be in the answer.

## 8. Validation results

- 41 of 41 CMS articles present in the plan; 25 Markdown + 41 CMS = 66 total; no slug is in both sources.
- Every CMS slug exists in the live collection snapshot (`lib/resources.js`, read on 2026-09-24).
- Every recommended value was parsed from `SEO_METADATA_MASTER.md` and cross-checked against `SEO_METADATA_AUDIT.csv` and `META_BEFORE_AFTER.md`: **0 mismatches**. The "current" values also equal the rendered values in the snapshot.
- Duplicate recommended titles among the 41: none; duplicate recommended descriptions: none. Recommended CMS titles that equal an already-applied Markdown title: none.
- Identical *current* CMS titles (fixed by this plan): ['How to Track Your AI Visibility Over Time'].
- CMS articles marked KEEP for both fields: ['local-seo-new-practice-90-days', 'healthgrades-zocdoc-vitals', 'ai-visibility-myths-doctors'].
- Regulatory or statistics posts needing separate fact-checking: ['can-indian-doctors-advertise-online', 'respond-to-negative-patient-reviews', 'insurance-find-a-doctor-directories', 'ai-visibility-statistics-doctors', 'patient-star-rating-threshold']. Left unedited.
- Recommended lengths: titles max 60 chars, descriptions max 160 chars (editor limits 60 / 160).
- No database, API or application file was touched to produce this plan (only this document was written).
