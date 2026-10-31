# SEO Audit Report: Resources Section

> Audit and recommendations only. No application code, content, database, redirects or URLs were changed. All files live in `dev-package/docs/seo-audit/`.

## 0. Scope and sources

- **Inventory:** 66 articles. The Resources section is a hybrid (`lib/resources.js`): 25 Markdown files in `content/resources/` plus 41 published CMS posts in Supabase `blog_posts`. Markdown wins on slug collisions. The 18 GSC resource URLs that do not exist as `.md` files are CMS posts. 74 URLs are in the sitemap.
- **Served metadata verified live** on the production site for sample pages: `<title>` and OG/Twitter titles equal `seoTitle`; description equals `metaDescription`; canonical is the clean `/resources/<slug>` URL.
- **Keyword source:** `The_Doc_Mirror_SEO_Keyword_Research_126.xlsx` (126 keywords). No volumes are quoted anywhere in these files. A keyword with no honest workbook match is marked REQUIRES VALIDATION.
- **Strategy source:** `The_Doc_Mirror_SEO_Growth_Strategy_2026.docx` (four clusters, pillar plus supporting structure, fix pages already at positions 5-20 before publishing more).
- **GSC source:** `thedocmirror.com-Performance-on-Search-2026-09-24/` (Last 7 days). Pages.csv and Queries.csv only; no query-by-page export exists.

### GSC caveats (read before acting)

- The whole window is 225 impressions and 3 clicks. Every resource article has 0 clicks, and 10 articles have 8+ impressions. A 0% CTR on 15 impressions is a signal, not proof.
- Zero clicks at positions 3-8 can mean an AI Overview or local pack is absorbing the click, so title changes are tests. Position is an average over very few impressions.
- 17 of the 23 visible queries are single impressions. The top query, "doctors suggestion cotaldihydo" (18 impressions), does not relate to any article and is ignored.
- US: 97 impressions at position 13.96, India: 54 impressions and 2 clicks at position 6.74. Mobile had 107 impressions and 0 clicks. Re-export 28 and 90 days before judging results.

## 1. Summary

- Articles inspected: **66** (plus the /resources hub).
- Title actions: KEEP 5, MINOR UPDATE 39, REWRITE 16, HIGH PRIORITY REWRITE 6.
- Description actions: KEEP 16, MINOR UPDATE 21, REWRITE 23, HIGH PRIORITY REWRITE 6.
- Priority: P0 11, P1 42, P2 13. P0 is deliberately limited to the pages with 8+ GSC impressions and 0 clicks, plus clinic-not-showing-on-google (same query family as clinic-not-on-google-maps).
- Content updates needed: **31** (thin pages, duplicate pairs, 404 links, regulatory review).
- Cannibalization: HIGH 9, MEDIUM 13, LOW 44.
- New content gaps: **8** (3 conditional).

## 2. Technical findings that affect the metadata work

**T1. Broken internal links (404).** 17 CMS articles link to slugs that do not exist. `/blog/doctor-visibility-score` alone is linked from 14 articles (the page is `/doctor-visibility-score`). Others: `/blog/merge-duplicate-google-listings-clinic` (4), `/blog/storefront-vs-service-area-medical-practice` (3), `/blog/reinstate-suspended-google-business-profile` (2), and one each of `/blog/reserve-with-google-online-booking`, `/blog/google-business-profile-primary-category-doctors`, `/blog/google-business-profile-video-verification-doctors`, `/blog/healthgrades-zocdoc-vitals-comparison`, `/blog/google-business-profile-address-change`. Fix the links, not the slugs. This is a content edit, listed per article in "Content Update Needed".
**T2. `/blog/` link hop.** 39 articles link with `/blog/...` (a 301 to `/resources/...`) instead of the final URL. It works but adds a redirect hop to every internal link; use `/resources/` directly.
**T3. Two `<h1>` tags on CMS pages.** The template renders an `<h1>` and the CMS body starts with the title as a second `<h1>` (verified on `/resources/track-ai-visibility`: 2; Markdown page: 1). Fix in the CMS renderer or content, not by editing 41 posts.
**T4. Markdown titles are truncated.** All 25 Markdown `seoTitle` values append `| The Doc Mirror`, so 23 of the 25 run 58-74 characters (all 23 titles over 60 are Markdown ones). CMS titles carry no suffix. Recommended titles drop the suffix (except the product-explainer page).
**T5. No updated date.** `dateModified` is written equal to `datePublished` for every article. For regulatory and statistics articles (HIPAA, FTC, NMC, No Surprises Act, KFF), a real "last reviewed" date is a trust signal.
**T6. Related posts are automatic** (category and tag score); none of the 41 CMS posts sets `relatedSlugs`, so "Related" blocks can point at loosely related pages. The related lists in the master file can be used to set them.
**T7. Description length.** 13 of 66 descriptions exceed 160 characters and are cut in results; 1 is under 120 (get-clinic-recommended-chatgpt-gemini, 111).
**T8. Formatting bug.** `track-ai-visibility` renders its closing paragraph inside an `<h2>`.

## 3. Brand voice, healthcare trust and what the new metadata does

- Existing style: plain, practical, doctor-directed; CMS titles use a problem or question plus a colon; Markdown titles use a benefit plus brand. The recommendations keep that voice: no "ultimate/complete guide" formulas, and titles are structured differently (questions, counts, comparisons, task phrases).
- The brand is not added to titles except where it names the product being described (whats-inside-doctor-visibility-report).
- Removed or softened claims a doctor could read as a guarantee: "pass on the first try", "get your practice named", "predict whether patients find you", "cited by Anthropic".
- Regulatory or legal topics (HIPAA/OCR, FTC, NMC, No Surprises Act) should be re-verified and dated before promotion: can-indian-doctors-advertise-online, respond-to-negative-patient-reviews, ethical-google-reviews-doctors, manage-online-reputation-doctor, insurance-find-a-doctor-directories.
- The brief's style example "Clinic Not on Google Maps? 12 Causes and Fixes" cannot be used as written: the article has five failure modes. The recommended title says 5. If a 12-cause title is wanted, the article needs expanding first.

## A. Existing articles: metadata optimization

63 of 66 articles need a title or description change. The full per-article data is in SEO_METADATA_MASTER.md and SEO_METADATA_AUDIT.csv. P0 pages:

- /resources/fix-wrong-google-maps-pin-clinic (21 imp / pos 4.62): MINOR UPDATE title, MINOR UPDATE description
- /resources/respond-to-negative-patient-reviews (9 imp / pos 5.78): MINOR UPDATE title, REWRITE description
- /resources/can-indian-doctors-advertise-online (14 imp / pos 7): MINOR UPDATE title, REWRITE description
- /resources/how-many-google-reviews-to-rank (15 imp / pos 3.07): MINOR UPDATE title, REWRITE description
- /resources/distance-vs-prominence-local-search (8 imp / pos 8.88): MINOR UPDATE title, MINOR UPDATE description
- /resources/ai-search-doctors-india (17 imp / pos 4.76): MINOR UPDATE title, MINOR UPDATE description
- /resources/gemini-ai-for-doctors (22 imp / pos 6.18): MINOR UPDATE title, REWRITE description
- /resources/how-chatgpt-chooses-doctors (28 imp / pos 5.18): MINOR UPDATE title, REWRITE description
- /resources/clinic-not-on-google-maps (19 imp / pos 7.79): REWRITE title, REWRITE description
- /resources/clinic-not-showing-on-google (4 imp / pos 6.5): REWRITE title, REWRITE description
- /resources/how-doctors-rank-in-chatgpt (9 imp / pos 12.78): REWRITE title, REWRITE description

## B. Existing articles: content update recommended

31 articles. The highest-leverage ones first:

- **ai-visibility-for-doctors** (280 words): Cluster B pillar and workbook P0 head keyword; the most-linked AI page. Expand before it is promoted. Do not use "Complete 2026 Guide" until it is.
- **google-visibility-guide** (267 words): Cluster A pillar linked from about ten articles. Same.
- **how-doctors-rank-in-chatgpt** (414 words, 9 GSC impressions, position 12.78) and **get-clinic-recommended-chatgpt-gemini** (558 words): thin, and in a HIGH cannibalization group.
- **chatgpt-doesnt-mention-your-clinic** (686 words): the most-linked AI page in the Markdown set.
- **manage-online-reputation-doctor** and **local-seo-for-doctors-google-maps**: pillars that should link out to their cluster articles (they link to almost none).
- **can-indian-doctors-advertise-online** and other regulatory pages: re-verify and add a review date.
- 17 articles with 404 body links (T1).

Full list of B pages:

- /resources/insurance-find-a-doctor-directories: YES - fix 404 internal link(s): /blog/doctor-visibility-score, /blog/reserve-with-google-online-booking
- /resources/make-clinic-content-quotable-by-ai: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/patient-star-rating-threshold: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/how-patients-in-india-find-doctors: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/doctor-online-presence-audit-checklist: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/clinic-photos-google-ranking: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/can-indian-doctors-advertise-online: YES | also fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/how-many-google-reviews-to-rank: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/multiple-doctors-one-google-listing: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/clinic-address-change-google: YES | also fix 404 internal link(s): /blog/merge-duplicate-google-listings-clinic, /blog/reinstate-suspended-google-business-profile
- /resources/local-seo-new-practice-90-days: YES | also fix 404 internal link(s): /blog/doctor-visibility-score, /blog/google-business-profile-primary-category-doctors, /blog/google-business-profile-video-verification-doctors, /blog/healthgrades-zocdoc-vitals-comparison, /blog/storefront-vs-service-area-medical-practice
- /resources/healthgrades-zocdoc-vitals: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/reinstate-suspended-gbp: YES | also fix 404 internal link(s): /blog/doctor-visibility-score, /blog/google-business-profile-address-change, /blog/merge-duplicate-google-listings-clinic, /blog/storefront-vs-service-area-medical-practice
- /resources/nap-audit-doctor-listings: YES - fix 404 internal link(s): /blog/doctor-visibility-score, /blog/merge-duplicate-google-listings-clinic
- /resources/storefront-vs-service-area: YES | also fix 404 internal link(s): /blog/reinstate-suspended-google-business-profile
- /resources/gbp-primary-category-doctors: YES - fix 404 internal link(s): /blog/doctor-visibility-score
- /resources/gbp-video-verification: YES - fix 404 internal link(s): /blog/merge-duplicate-google-listings-clinic, /blog/storefront-vs-service-area-medical-practice
- /resources/ai-visibility-statistics-doctors: YES
- /resources/how-to-track-ai-visibility: YES
- /resources/patient-reviews-influence-ai: YES
- /resources/claude-ai-for-doctors: YES
- /resources/track-ai-visibility: YES
- /resources/reviews-ai-recommendation: YES
- /resources/local-seo-for-doctors-google-maps: YES
- /resources/manage-online-reputation-doctor: YES
- /resources/whats-inside-doctor-visibility-report: YES
- /resources/get-clinic-recommended-chatgpt-gemini: YES
- /resources/chatgpt-doesnt-mention-your-clinic: YES
- /resources/google-visibility-guide: YES
- /resources/ai-visibility-for-doctors: YES
- /resources/how-doctors-rank-in-chatgpt: YES

## C. Existing articles: cannibalization risk

No redirects or deletions were made or should be made automatically. Every HIGH item needs a manual look at rankings, backlinks and content before acting.

| Group | Pages | Risk | Recommendation |
|-------|-------|------|----------------|
| Duplicate: AI tracking | how-to-track-ai-visibility / track-ai-visibility | HIGH | CONSOLIDATE (REQUIRES MANUAL REVIEW). Identical title, meta title, description and H2 outline. Lean: keep how-to-track-ai-visibility (query-shaped slug, no H2 bug), 301 the other. Neither has GSC impressions. |
| Duplicate: reviews and AI | patient-reviews-influence-ai / reviews-ai-recommendation | HIGH | CONSOLIDATE / REDIRECT (REQUIRES MANUAL REVIEW). Identical title, meta and H2s. Lean: keep patient-reviews-influence-ai (2 GSC impressions, position 6.5). The Markdown twin wins slug collisions in code, so retiring it means deleting the .md file on purpose plus a 301 in server.js. |
| ChatGPT recommendation | how-chatgpt-chooses-doctors / how-doctors-rank-in-chatgpt / chatgpt-doesnt-mention-your-clinic / get-clinic-recommended-chatgpt-gemini | HIGH | REWRITE INTENT. Mechanism (chooses) vs signal list (rank) vs diagnosis (doesn't mention) vs action checklist (get recommended). KEEP SEPARATE only if each is differentiated and the two thin pages are expanded. The workbook itself lists "doctors rank in chatgpt", "how do doctors rank in chatgpt" and "how chatgpt chooses doctors" as separate P0 keywords. |
| Gemini | gemini-ai-for-doctors / rank-medical-practice-google-gemini | HIGH | REWRITE INTENT (explainer vs weekly routine) or CONSOLIDATE. GSC evidence (22 impressions) is on gemini-ai-for-doctors, the lean survivor. |
| Maps missing vs near-me | clinic-not-on-google-maps / clinic-not-showing-on-google | MEDIUM | REWRITE INTENT: not on Maps at all (listing faults) vs on Google but not in near-me results (ranking). Both are P0. |
| Why not ranking | medical-practice-not-ranking-google / why-competitor-doctor-outranks-you-google / distance-vs-prominence-local-search | MEDIUM | KEEP SEPARATE: general reasons vs competitor gaps vs mechanism. Link them to each other. |
| Reviews | manage-online-reputation-doctor / respond-to-negative-patient-reviews | MEDIUM | KEEP SEPARATE; the pillar links to the specific page. |
| Directories and NAP | nap-audit-doctor-listings / directory-citations-ai-visibility / healthgrades-zocdoc-vitals | MEDIUM | KEEP SEPARATE (local-ranking audit vs AI corroboration vs platform comparison). |
| AEO writing | aeo-for-doctors / make-clinic-content-quotable-by-ai / medical-faq-content-ai | MEDIUM | KEEP SEPARATE (definition vs writing moves vs FAQ format). |
| One-time vs ongoing | check-ai-visibility-doctors / how-to-track-ai-visibility | MEDIUM | KEEP SEPARATE. |
| Statistics | ai-visibility-statistics-doctors / doctor-online-visibility-statistics | LOW | KEEP SEPARATE (AI vs general). |

Per-article cannibalization status is in the master file.

## D. Existing articles: keep as is

Both title and description can stay:

- /resources/local-seo-new-practice-90-days
- /resources/healthgrades-zocdoc-vitals
- /resources/ai-visibility-myths-doctors

Title unchanged (description changes only): /resources/doctor-online-presence-audit-checklist, /resources/how-patients-in-india-find-doctors.

Description unchanged (title changes only): 13 articles (see master file).

## E. New content recommendations (gaps only)

Only where the 126-keyword plan has a real gap. Several workbook topics are already covered and are treated as expansions, not new pages: "ai overviews" (in gemini-ai-for-doctors), "chatgpt seo for doctors" (expand get-clinic-recommended-chatgpt-gemini), "llms.txt" (ai-crawlers-doctor-website), "faq schema" and "structured data" (medical-faq-content-ai, medical-schema-markup-ai). No new articles have been written.

### E1. Doctor Visibility Score: What It Measures, How to Raise It

- **Keyword:** doctor visibility score (P0) / visibility score (P0)
- **Intent:** Commercial Investigation / Informational
- **Why the current site does not satisfy it:** No article explains the score. Fourteen CMS articles link to /blog/doctor-visibility-score, which is a 404, so the intent to link to an explainer already exists. The product page /doctor-visibility-score is a tool, not an explanation.
- **Suggested title:** Doctor Visibility Score: What It Measures, How to Raise It (58 chars)
- **Suggested meta description:** What a Doctor Visibility Score measures across Google, Maps, reviews and AI assistants, how to read your result and which fixes move it first. (142 chars)
- **Target cluster:** Product / Foundations
- **Recommended pillar:** what-is-doctor-online-visibility
- **Internal links needed:** Repoint the 14 broken /blog/doctor-visibility-score links to the new article (or, as a zero-content quick win, to /doctor-visibility-score). Link out to what-is-doctor-online-visibility, doctor-online-presence-audit-checklist, whats-inside-doctor-visibility-report.
- **Status:** No

### E2. SEO for Doctors: How to Rank on Google, Maps and AI Search

- **Keyword:** seo for doctors (P0), medical seo (P0), healthcare seo (P0)
- **Intent:** Commercial Investigation / Informational
- **Why the current site does not satisfy it:** No page targets the head SEO terms; the site only covers local SEO and problem pages. Strategy calls for one pillar per cluster. Build it as a hub that summarises and links to existing articles, not a rewrite of local-seo-for-doctors-google-maps or medical-practice-not-ranking-google.
- **Suggested title:** SEO for Doctors: How to Rank on Google, Maps and AI Search (58 chars)
- **Suggested meta description:** A practical map of SEO for doctors: the Google, Google Maps and AI search work that moves a practice up, in the order to do it, with a link to each fix. (152 chars)
- **Target cluster:** D. Doctor Marketing & Foundations
- **Recommended pillar:** (is a pillar)
- **Internal links needed:** Needs links to local-seo-for-doctors-google-maps, medical-practice-not-ranking-google, ai-visibility-for-doctors, aeo-for-doctors, entity-seo-for-doctors, medical-schema-markup-ai; and inbound links from those.
- **Status:** No

### E3. How to Market a Medical Practice: A Search-First Plan

- **Keyword:** how to market a medical practice (P0), doctor marketing strategy (P0)
- **Intent:** Informational / Commercial Investigation
- **Why the current site does not satisfy it:** Cluster D (Doctor Marketing & Acquisition) has no pillar. Keep it search-first (Maps, reviews, website, AI answers) so it does not drift into generic marketing the Growth Strategy warns against.
- **Suggested title:** How to Market a Medical Practice: A Search-First Plan (53 chars)
- **Suggested meta description:** A search-first plan for marketing a medical practice: Google Maps, reviews, your website and AI answers, what to do in what order and what to skip. (147 chars)
- **Target cluster:** D. Doctor Marketing & Foundations
- **Recommended pillar:** (is a pillar)
- **Internal links needed:** Link to seo-for-doctors (new), manage-online-reputation-doctor, local-seo-for-doctors-google-maps, ai-visibility-for-doctors, how-patients-in-india-find-doctors. Consider merging with the SEO pillar if the two end up covering the same ground.
- **Status:** Conditional: decide whether this is separate from the SEO pillar

### E4. E-E-A-T for Doctors: Trust Signals Google and AI Look For

- **Keyword:** e-e-a-t for doctors (P0), e-e-a-t healthcare seo (P0)
- **Intent:** Informational
- **Why the current site does not satisfy it:** trust-signals-doctors covers what patients see, not how search and AI systems assess experience, expertise and trust for a medical practice. It also supports the Growth Strategy point that trust and sourcing are part of SEO for a health product.
- **Suggested title:** E-E-A-T for Doctors: Trust Signals Google and AI Look For (57 chars)
- **Suggested meta description:** What E-E-A-T means for a medical practice, which signals on your profile, site and citations show experience and trust, and how to strengthen them. (147 chars)
- **Target cluster:** C. Reputation & Reviews
- **Recommended pillar:** manage-online-reputation-doctor
- **Internal links needed:** Link to trust-signals-doctors, entity-seo-for-doctors, digital-pr-ai-authority-doctors, medical-schema-markup-ai. Must be sourced; no guarantees about rankings.
- **Status:** No

### E5. Review Monitoring for Doctors: What to Track Every Week

- **Keyword:** review monitoring for doctors (P0); GSC: reviews tool for doctors (pos 66)
- **Intent:** Commercial Investigation
- **Why the current site does not satisfy it:** The Monitor product is weekly monitoring, and the site has no page for the review-monitoring query. GSC already shows an impression for the tools query at position 66. Product-led, so it should sit next to the Monitor pricing page.
- **Suggested title:** Review Monitoring for Doctors: What to Track Every Week (55 chars)
- **Suggested meta description:** What a doctor should check each week across Google, Healthgrades and Zocdoc: new reviews, rating drift, replies due and duplicates, and how to stay HIPAA-safe. (159 chars)
- **Target cluster:** C. Reputation & Reviews
- **Recommended pillar:** manage-online-reputation-doctor
- **Internal links needed:** Link to respond-to-negative-patient-reviews, patient-star-rating-threshold, how-many-google-reviews-to-rank; product link to /pricing (Monitor).
- **Status:** No

### E6. Doctor Rating Websites: Where Patients Rate You and Why

- **Keyword:** doctor rating websites (P1), doctor ratings (P1); GSC: doctor rating websites (pos 65), doctor rating (pos 19)
- **Intent:** Informational
- **Why the current site does not satisfy it:** healthgrades-zocdoc-vitals compares three US sites, and patient-star-rating-threshold covers the 4-star filter. A broader page on where patients rate doctors may add little; validate demand first.
- **Suggested title:** Doctor Rating Websites: Where Patients Rate You and Why (55 chars)
- **Suggested meta description:** Where patients rate doctors online, what each rating site shows and which ones to claim and keep accurate first, without paying for or filtering reviews. (153 chars)
- **Target cluster:** C. Reputation & Reviews
- **Recommended pillar:** manage-online-reputation-doctor
- **Internal links needed:** Link to healthgrades-zocdoc-vitals, patient-star-rating-threshold, ethical-google-reviews-doctors.
- **Status:** Conditional: consider expanding healthgrades-zocdoc-vitals instead to avoid a near-duplicate

### E7. How Doctors Rank in "Doctor Near Me" Searches

- **Keyword:** doctor near me ranking (P0), doctor near me seo (P0)
- **Intent:** Informational / Local
- **Why the current site does not satisfy it:** No article explains how near-me results work. Only worth writing if clinic-not-showing-on-google is repositioned as recommended; otherwise the two would compete.
- **Suggested title:** How Doctors Rank in "Doctor Near Me" Searches (45 chars)
- **Suggested meta description:** How "doctor near me" results are chosen, what a practice controls (category, reviews, consistency, profile) and what it does not, with a simple checklist. (154 chars)
- **Target cluster:** A. Google & Local Visibility
- **Recommended pillar:** local-seo-for-doctors-google-maps
- **Internal links needed:** Link to distance-vs-prominence-local-search, clinic-not-showing-on-google, gbp-primary-category-doctors, nap-audit-doctor-listings.
- **Status:** Conditional: only after the clinic-not-showing-on-google rewrite

### E8. AI Visibility Tools for Doctors: What to Measure First

- **Keyword:** ai visibility tool (P1), ai search visibility tool (P0), ai rank tracker for doctors (P0)
- **Intent:** Commercial Investigation
- **Why the current site does not satisfy it:** Buyer-intent queries. how-to-track-ai-visibility covers doing it manually. A comparison of tools is better as a product/landing page than a blog post, so the article stays honest about alternatives.
- **Suggested title:** AI Visibility Tools for Doctors: What to Measure First (54 chars)
- **Suggested meta description:** What to measure in an AI visibility tool for doctors across ChatGPT, Gemini, Claude and Perplexity, how often, and how to spot a useful report. (143 chars)
- **Target cluster:** Product / Visibility
- **Recommended pillar:** ai-visibility-for-doctors
- **Internal links needed:** Link to how-to-track-ai-visibility, check-ai-visibility-doctors, ai-visibility-for-doctors; product link to /pricing (Monitor) and /doctor-visibility-score.
- **Status:** Conditional: decide blog vs product page

## Top 20

See TOP_20_METADATA_FIXES.md. Order: how-chatgpt-chooses-doctors, gemini-ai-for-doctors, fix-wrong-google-maps-pin-clinic, clinic-not-on-google-maps, ai-search-doctors-india, how-many-google-reviews-to-rank, can-indian-doctors-advertise-online, respond-to-negative-patient-reviews, how-doctors-rank-in-chatgpt, distance-vs-prominence-local-search, clinic-not-showing-on-google, gbp-video-verification, directory-citations-ai-visibility, clinic-address-change-google, patient-reviews-influence-ai, perplexity-ai-for-doctors, multiple-doctors-one-google-listing, aeo-vs-seo-vs-geo-doctors, medical-faq-content-ai, ai-crawlers-doctor-website.

## Final QA

- [x] All 66 Resource articles inspected (25 Markdown, 41 CMS); the hub page also covered
- [x] Every current meta title and description recorded, with character counts
- [x] Every URL recorded; no slug changes recommended (consolidation candidates flagged MANUAL REVIEW REQUIRED - DO NOT CHANGE WITHOUT REDIRECT PLAN)
- [x] Every article has a title and description action
- [x] No duplicate recommended titles or descriptions (checked programmatically, 66 of 66 unique)
- [x] Recommended titles are 43-60 characters (none over 60); changed descriptions are within the length checks (none over 160); KEEP items are unchanged
- [x] KEEP means byte-identical to the current text (checked programmatically)
- [x] No search volume quoted; no GSC numbers invented (all from Pages.csv, Queries.csv and the workbook GSC sheets)
- [x] No production code, database, routes, auth, payments or content modified
- [ ] Not verified: article body text was read through each article's headings and opening paragraphs, not word for word; medical, legal and statistical claims were not independently fact-checked
- [ ] Not verified: the Supabase content was read through the app's own data layer (read-only); drafts and unpublished posts are not included
