#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — blog CMS spec-parity acceptance tests (migration 031)

   Runs without a database — every function under test here is a pure,
   synchronous function, so no fake Supabase is needed.

     1. markdownToBlocks: each block type the spec asks for comes out shaped
        correctly, and a parse failure degrades to null, never a throw.
     2. blog-post-mapper: canonical/OG/Twitter overrides apply when set and
        fall back to the historical derived values when blank.
     3. admin/posts buildFields: the three URL overrides go through the same
        safeUrl() allowlist as every other URL field; an invalid timezone
        falls back instead of being stored; content_blocks is derived from
        content_md on every save.
     4. the slug-redirect decision: redirectFrom is set only when an existing,
        LIVE post's slug actually changes — never for a draft, never when the
        slug is unchanged, never for a brand new post.
     5. resolveStatus: re-publishing something already live keeps its
        original published_at (the one thing first_published_at's "only ever
        set once" rule in routes/admin/posts.js depends on).

   Usage:  node scripts/verify-blog-spec-parity.js
   ────────────────────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const group = (t) => console.log(`\n${t}`);

const { markdownToBlocks } = require('../lib/content-blocks');
const { mapRow } = require('../lib/blog-post-mapper');
const { buildFields, resolveStatus } = require('../routes/admin/posts');

// ── 1. content blocks ───────────────────────────────────────────────────────

group('1. markdownToBlocks — block shapes');

const blocks = markdownToBlocks(
  '# Title\n\n## Sub\n\nA paragraph with **bold**.\n\n- one\n- two\n\n1. first\n2. second\n\n' +
  '> a quote\n\n```js\nconsole.log(1)\n```\n\n---\n\n![alt text](https://img/x.png)\n\n' +
  '| a | b |\n|---|---|\n| 1 | 2 |\n'
);
const byType = (t) => blocks.filter((b) => b.type === t);

check('h1 heading captured', byType('h1').length === 1 && byType('h1')[0].text === 'Title');
check('h2 heading captured', byType('h2').length === 1 && byType('h2')[0].text === 'Sub');
check('paragraph captured with inline formatting flattened to text',
  byType('p').some((p) => p.text.indexOf('bold') !== -1));
check('unordered list with 2 items', byType('ul').length === 1 && byType('ul')[0].items.length === 2);
check('ordered list with 2 items', byType('ol').length === 1 && byType('ol')[0].items.length === 2);
check('blockquote captured', byType('blockquote').length === 1);
check('code block keeps language + text', byType('code')[0].lang === 'js' && byType('code')[0].text.indexOf('console.log') !== -1);
check('hr captured', byType('hr').length === 1);
check('an image-only paragraph becomes an image block, not a paragraph',
  byType('image').length === 1 && byType('image')[0].src === 'https://img/x.png' && byType('image')[0].alt === 'alt text');
check('table keeps header + rows', byType('table')[0].header.length === 2 && byType('table')[0].rows.length === 1);

check('empty content -> empty array, not null', Array.isArray(markdownToBlocks('')) && markdownToBlocks('').length === 0);
check('markdownToBlocks never throws on garbage input', (() => {
  try { markdownToBlocks(undefined); markdownToBlocks(12345); markdownToBlocks({}); return true; }
  catch (_) { return false; }
})());

// ── 2. mapper overrides ─────────────────────────────────────────────────────

group('2. blog-post-mapper — canonical/OG/Twitter overrides');

const baseRow = {
  slug: 'example-post', title: 'Example', content_md: 'Body.', status: 'published',
  published_at: new Date(Date.now() - 1000).toISOString(),
};

const noOverride = mapRow(baseRow);
check('no canonical_url -> derived canonical, unchanged from before this change',
  noOverride.canonical === `${require('../lib/resources-markdown').SITE}/resources/example-post`);
check('no og_image/twitter_image -> both overrides null', noOverride.ogImageOverride === null && noOverride.twitterImageOverride === null);

const withOverride = mapRow(Object.assign({}, baseRow, {
  canonical_url: 'https://other.example/custom',
  og_image: '/images/custom-og.png',
  twitter_image: '/images/custom-twitter.png',
}));
check('canonical_url override wins', withOverride.canonical === 'https://other.example/custom');
check('og_image override surfaces as ogImageOverride', withOverride.ogImageOverride === '/images/custom-og.png');
check('twitter_image override surfaces as twitterImageOverride', withOverride.twitterImageOverride === '/images/custom-twitter.png');

const withBlocksAndFirstPublished = mapRow(Object.assign({}, baseRow, {
  content_blocks: [{ type: 'p', text: 'Body.' }],
  first_published_at: '2026-01-01T00:00:00.000Z',
}));
check('content_blocks passed through as contentBlocks', Array.isArray(withBlocksAndFirstPublished.contentBlocks));
check('first_published_at passed through as firstPublishedAt', withBlocksAndFirstPublished.firstPublishedAt === '2026-01-01T00:00:00.000Z');

// ── 3. buildFields — overrides, timezone, blocks ────────────────────────────

group('3. admin/posts buildFields — SEO overrides, timezone, content_blocks');

const draft = buildFields({
  title: 'A Draft', content_md: '# Heading\n\nSome text.',
  canonical_url: 'https://www.thedocmirror.com/resources/a-draft',
  og_image: 'javascript:alert(1)',
  twitter_image: '/images/tw.png',
  timezone: 'Asia/Kolkata',
});
check('a safe canonical_url override survives', draft.fields.canonical_url === 'https://www.thedocmirror.com/resources/a-draft');
check('an unsafe og_image (javascript:) is dropped to null, same allowlist as every other URL field', draft.fields.og_image === null);
check('a safe twitter_image override survives', draft.fields.twitter_image === '/images/tw.png');
check('a valid IANA timezone is kept', draft.fields.time_zone === 'Asia/Kolkata');
check('content_blocks is derived from content_md on every save',
  Array.isArray(draft.fields.content_blocks) && draft.fields.content_blocks.some((b) => b.type === 'h1'));
check('no redirect on a brand-new post', draft.redirectFrom === null);

const badTz = buildFields({ title: 'A Draft', content_md: 'x', timezone: 'Not/AZone' });
check('an invalid timezone falls back to Asia/Kolkata rather than being stored', badTz.fields.time_zone === 'Asia/Kolkata');

// ── 4. slug-redirect decision ───────────────────────────────────────────────

group('4. slug-redirect decision — redirectFrom');

const liveExisting = {
  slug: 'old-slug', title: 'Live Post', content_md: 'x',
  published_at: new Date(Date.now() - 86400000).toISOString(),
};
const draftExisting = { slug: 'old-draft-slug', title: 'Draft Post', content_md: 'x', published_at: null };

check('changing the slug on a LIVE post sets redirectFrom to the old slug',
  buildFields({ title: 'Live Post', slug: 'new-slug', content_md: 'x' }, { existing: liveExisting }).redirectFrom === 'old-slug');
check('keeping the same slug on a live post never sets redirectFrom',
  buildFields({ title: 'Live Post', slug: 'old-slug', content_md: 'x' }, { existing: liveExisting }).redirectFrom === null);
check('changing the slug on a DRAFT (never live) never sets redirectFrom',
  buildFields({ title: 'Draft Post', slug: 'new-draft-slug', content_md: 'x' }, { existing: draftExisting }).redirectFrom === null);

// ── 5. resolveStatus — republish keeps its date ─────────────────────────────

group('5. resolveStatus — re-publishing keeps the original published_at');

const requiredBody = {};
const alreadyLive = {
  slug: 'x', title: 'X', featured_image: 'x', image_alt: 'x', category: 'x',
  seo_title: 'x', meta_description: 'x',
  published_at: '2026-01-01T00:00:00.000Z',
};
const republished = resolveStatus('publish', requiredBody, alreadyLive, alreadyLive);
check('re-publishing an already-live post does not advance published_at',
  republished.status === 'published' && republished.published_at === '2026-01-01T00:00:00.000Z');

console.log('\n' + '─'.repeat(74));
console.log(failures.length ? `${passed} passed, ${failures.length} FAILED\n` : `${passed} passed, 0 failed`);
if (failures.length) { failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
