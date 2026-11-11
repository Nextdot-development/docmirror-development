#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — blog CMS acceptance tests

   Runs without a database: Supabase is replaced by an in-memory fake that
   returns whatever rows a test hands it (and ignores the query's filters, so
   the code's OWN visibility check is what is being tested, not PostgREST's).

     1. draft / archived / future-scheduled → absent from listing, slug URL, sitemap
     2. scheduled whose time passed → public, with no status change and no cron
     3. Publish Now → live on the next cache refresh (and keeps the original date)
     4. posts sorted newest-first across Markdown + CMS; admin list defaults to publish date
     5. DB unreachable → pages still render, no 500
     6. no DB credential in any client-served file
     7. unknown slug → real 404
     8. SEO score: a 212-char description is red; Suggest returns 3 options, each
        120–160 chars containing the focus keyword
     +  Markdown import: comment block, Primary query, ## Related, FAQ shapes
     +  editor server rules: autosave is drafts-only, focus keyword never invented

   Usage:  npm run verify-cms
   ────────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0;
const failures = [];
function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const group = (t) => console.log(`\n${t}`);

// ── fake Supabase ───────────────────────────────────────────────────────────

/**
 * A chainable query builder. Every call is recorded; awaiting it resolves via
 * `resolver(table, ops)`. Throwing from the resolver simulates an outage.
 */
function fakeSupabase(resolver) {
  const calls = [];
  function builder(table) {
    const ops = [];
    const q = new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          return (ok, bad) => {
            calls.push({ table, ops });
            let out;
            try { out = resolver(table, ops); } catch (e) { return Promise.reject(e).then(ok, bad); }
            return Promise.resolve(out).then(ok, bad);
          };
        }
        return (...args) => { ops.push([prop, args]); return q; };
      },
    });
    return q;
  }
  return { from: (t) => builder(t), calls };
}

const supa = require('../lib/supabase-client');
const realGet = supa.getSupabaseClient;
let current = null;
supa.getSupabaseClient = () => current;

/** Fresh copies of the modules that hold the 60s cache, for each scenario. */
function freshModules() {
  for (const k of Object.keys(require.cache)) {
    if (/[\\/](lib[\\/](resources|resources-db|sitemap)|routes[\\/]resources)\.js$/.test(k)) delete require.cache[k];
  }
  return {
    resources: require('../lib/resources'),
    sitemap: require('../lib/sitemap'),
    routes: require('../routes/resources'),
  };
}

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: '' };
  r.status = (c) => { r.statusCode = c; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.setHeader = r.set;
  r.send = (b) => { r.body = String(b); return r; };
  r.json = (b) => { r.body = b; return r; };
  r.redirect = (c, u) => { r.statusCode = c; r.headers.Location = u; return r; };
  return r;
}

const HOUR = 3600 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

function row(slug, status, publishedAt, extra) {
  return Object.assign({
    id: 'id-' + slug, slug, status, published_at: publishedAt,
    title: 'Post ' + slug, excerpt: 'Excerpt for ' + slug, content_md: '## Heading\n\nBody text.',
    author: 'The Doc Mirror', category: 'Guide', tags: [], faq: [], related_slugs: [],
    featured_image: 'https://example.com/x.jpg', image_alt: 'alt', seo_title: null, meta_description: null,
    read_time_minutes: 3, created_at: iso(-48 * HOUR), updated_at: iso(-HOUR),
  }, extra || {});
}

// ── 1–3. visibility, one rule everywhere ────────────────────────────────────

async function visibility() {
  group('1–2. Visibility — one rule for listing, article URL and sitemap');

  const rows = [
    row('cms-draft', 'draft', iso(-HOUR)),
    row('cms-archived', 'archived', iso(-HOUR)),
    row('cms-future', 'scheduled', iso(+24 * HOUR)),
    row('cms-due', 'scheduled', iso(-5 * 60 * 1000)),           // time passed, row never changed
    row('cms-live', 'published', iso(-2 * HOUR)),
  ];
  current = fakeSupabase((table) => (table === 'blog_posts' ? { data: rows, error: null } : { data: [], error: null }));

  const { resources, sitemap, routes } = freshModules();
  await resources.warmResources({}, fakeRes(), () => {});
  // warmResources may refresh behind the response; give it a tick to land.
  await new Promise((r) => setTimeout(r, 50));

  const slugs = resources.getAllResources().map((p) => p.slug);
  const xml = sitemap.buildSitemapXml();
  const listing = routes.renderListing();

  for (const hidden of ['cms-draft', 'cms-archived', 'cms-future']) {
    check(`${hidden}: absent from the collection`, !slugs.includes(hidden));
    check(`${hidden}: absent from the listing page`, !listing.includes(`/resources/${hidden}"`));
    check(`${hidden}: absent from the sitemap`, !xml.includes(`/resources/${hidden}<`));
    const res = fakeRes();
    routes.articleHandler({ params: { slug: hidden }, url: `/resources/${hidden}` }, res);
    check(`${hidden}: its URL is a real 404`, res.statusCode === 404, String(res.statusCode));
  }

  check('scheduled + time passed → in the collection', slugs.includes('cms-due'));
  check('scheduled + time passed → in the sitemap', xml.includes('/resources/cms-due<'));
  const due = fakeRes();
  routes.articleHandler({ params: { slug: 'cms-due' }, url: '/resources/cms-due' }, due);
  check('scheduled + time passed → its page renders 200', due.statusCode === 200, String(due.statusCode));
  check('…and the row was never written to (no cron, no status flip)', rows.find((r) => r.slug === 'cms-due').status === 'scheduled' &&
    !current.calls.some((c) => c.ops.some(([op]) => op === 'update' || op === 'upsert')));

  group('4. Newest first across Markdown + CMS');
  const all = resources.getAllResources();
  const sorted = all.every((p, i) => i === 0 || String(all[i - 1].date.sortKey || all[i - 1].date.iso) >= String(p.date.sortKey || p.date.iso));
  check('the whole public collection is sorted newest-first by publish date', sorted);
  check('the newest CMS post is first', all[0] && all[0].slug === 'cms-due', all[0] && all[0].slug);

  group('3. Publish Now');
  const posts = require('../routes/admin/posts');
  const fields = { title: 't', slug: 't', featured_image: '/x.jpg', image_alt: 'a', category: 'Guide', seo_title: 's', meta_description: 'm' };
  const first = posts.resolveStatus('publish', {}, fields, null);
  check('Publish Now → status published, publish time = now', first.status === 'published' &&
    Math.abs(Date.parse(first.published_at) - Date.now()) < 5000);
  check('the public read picks it up on the next refresh (published + time ≤ now)',
    require('../lib/blog-post-mapper').isPublic({ status: first.status, published_at: first.published_at }));
  const origin = iso(-30 * 24 * HOUR);
  const again = posts.resolveStatus('publish', {}, fields, { published_at: origin });
  check('re-publishing a live post keeps its original date (no sitemap jump)', again.published_at === origin);
  const past = posts.resolveStatus('schedule', { publish_date: '2020-01-01', publish_time: '09:00', timezone: 'Asia/Kolkata' }, fields, null);
  check('scheduling in the past is rejected', past.status === null && /past/.test(past.errors[0] || ''));
  const ist = posts.zonedWallClockToUtc('2030-01-01', '09:30', 'Asia/Kolkata');
  check('09:30 Asia/Kolkata is stored as 04:00 UTC', ist && ist.toISOString() === '2030-01-01T04:00:00.000Z', ist && ist.toISOString());
}

// ── 4b. admin list order ────────────────────────────────────────────────────

async function adminListOrder() {
  group('4b. Admin blog list defaults to publish date, newest first');
  current = fakeSupabase(() => ({ data: [], error: null, count: 0 }));
  delete require.cache[require.resolve('../routes/admin/posts')];
  const posts = require('../routes/admin/posts');
  await posts.list({ query: {} }, fakeRes());
  const q = current.calls.find((c) => c.table === 'blog_posts');
  const firstOrder = q && q.ops.find(([op]) => op === 'order');
  check('first ORDER BY is published_at', firstOrder && firstOrder[1][0] === 'published_at', JSON.stringify(firstOrder));
  check('…descending, undated drafts last', firstOrder && firstOrder[1][1].ascending === false && firstOrder[1][1].nullsFirst === false);
}

// ── 3b. autosave + focus keyword (server rules) ─────────────────────────────

async function editorRules() {
  group('Editor server rules');
  const existing = row('live-post', 'published', iso(-HOUR), { version: 3, focus_keyword: 'x' });
  current = fakeSupabase((table, ops) => {
    if (table === 'blog_posts' && ops.some(([op]) => op === 'maybeSingle')) return { data: existing, error: null };
    return { data: [], error: null };
  });
  delete require.cache[require.resolve('../routes/admin/posts')];
  const posts = require('../routes/admin/posts');

  const res = fakeRes();
  await posts.update({ params: { id: existing.id }, body: { action: 'autosave', title: 'Edited' }, admin: { id: 'a', email: 'a@x' } }, res);
  check('autosave on a published post is refused (409), nothing written', res.statusCode === 409 &&
    !current.calls.some((c) => c.ops.some(([op]) => op === 'update')), String(res.statusCode));

  const built = posts.buildFields({ title: 'A title', focus_keyword: '' });
  check('an empty focus keyword stays empty (never derived)', built.fields.focus_keyword === null);
  const built2 = posts.buildFields({ title: 'A title', focus_keyword: '  aeo for doctors ' });
  check('a focus keyword is stored trimmed', built2.fields.focus_keyword === 'aeo for doctors');
  check('the SEO title is never filled from the title', posts.buildFields({ title: 'A title' }).fields.seo_title === null);
  check('autosave resolves to draft', posts.resolveStatus('autosave', {}, built.fields, null).status === 'draft');
}

// ── 5. DB outage ────────────────────────────────────────────────────────────

async function outage() {
  group('5. Database unreachable → the site still renders');
  current = fakeSupabase(() => { throw new Error('ECONNREFUSED (simulated)'); });
  const { resources, sitemap, routes } = freshModules();

  let threw = null;
  try {
    const p = resources.warmResources({}, fakeRes(), () => {});
    if (p && p.then) await p;
  } catch (e) { threw = e; }
  check('warming the cache does not throw', !threw, threw && threw.message);

  const list = resources.getAllResources();
  check('the Markdown articles are still served', list.length > 0, String(list.length));
  const res = fakeRes();
  routes.listingHandler({}, res);
  check('the listing renders 200', res.statusCode === 200 && res.body.length > 1000);
  check('the sitemap still builds', /<urlset/.test(sitemap.buildSitemapXml()));
  if (list[0]) {
    const a = fakeRes();
    routes.articleHandler({ params: { slug: list[0].slug }, url: list[0].url }, a);
    check('an article renders 200', a.statusCode === 200);
  }
}

// ── 6. no credential in client-served files ─────────────────────────────────

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html|json|txt|webmanifest|css)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function credentials() {
  group('6. No database credential in any client-served file');
  // Everything under public/ is served as-is, plus the one lib file the
  // editor loads at /admin/seo-score.js.
  const files = walk(path.join(ROOT, 'public'), []).concat([path.join(ROOT, 'lib', 'seo', 'seo-score.js')]);
  const leaks = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    if (/SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|sk-ant-[A-Za-z0-9]/.test(text)) leaks.push(path.relative(ROOT, f) + ' (secret name/key)');
    for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || []) {
      try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
        if (payload.role === 'service_role') leaks.push(path.relative(ROOT, f) + ' (service_role JWT)');
      } catch (_) { /* not a JWT */ }
    }
  }
  check(`${files.length} client-served files scanned — no service-role key or API secret`, leaks.length === 0, leaks.join(', '));
}

// ── 8. SEO score ────────────────────────────────────────────────────────────

function seoScore() {
  group('8. SEO title + meta description score');
  const S = require('../lib/seo/seo-score');
  const ctx = {
    title: 'Why Your Clinic Is Not Showing on Google Maps',
    h1: 'Why Your Clinic Is Not Showing on Google Maps',
    excerpt: 'Most clinics vanish from Google Maps because of an unverified or incomplete Google Business Profile. Here is how to fix it in a week.',
    focusKeyword: 'clinic not on Google Maps',
    otherTitles: ['Local SEO for Doctors: Rank on Google Maps'],
    otherDescriptions: [],
  };

  const desc212 = 'This article covers everything about clinic not on Google Maps and the many reasons that can apply to a practice, ' +
    'including verification, categories, reviews, photos, hours, address formats and much more besides.';
  const r = S.scoreDescription(desc212, ctx);
  check('fixture is 212 characters', desc212.length === 212, String(desc212.length));
  check('a 212-char boilerplate description scores in the red band', r.band.key === 'poor' && r.score < 50, `${r.score} ${r.band.label}`);
  check('its length rule explains the truncation', /212 characters/.test(r.rules[0].problem) && /160/.test(r.rules[0].why));

  // The point table caps a too-long description that passes everything else at 70.
  const longButGood = 'Learn why your clinic not on Google Maps happens and how to fix it: verify your Google Business Profile, ' +
    'choose the right category, add real photos, set your hours and get patient reviews today.';
  const lg = S.scoreDescription(longButGood, ctx);
  check(`an over-long (${longButGood.length}) description passing every other rule is amber, not green`, lg.band.key === 'warn', `${lg.score}`);

  const opts = S.suggestDescriptions(ctx, 3);
  check('Suggest returns 3 description options', opts.length === 3, String(opts.length));
  check('…each 120–160 characters', opts.every((o) => o.length >= 120 && o.length <= 160), opts.map((o) => o.length).join(','));
  check('…each contains the focus keyword', opts.every((o) => S._hasPhrase(o.text, ctx.focusKeyword)));
  check('…each passes every rule (re-scored)', opts.every((o) => o.rules.every((x) => x.passed)));

  const t = S.suggestTitles(ctx, 3);
  check('Suggest returns 3 title options', t.length === 3, String(t.length));
  check('…each 50–60 characters with the keyword in the first 30', t.every((o) => o.length >= 50 && o.length <= 60 &&
    o.rules.find((x) => x.id === 'keyword_early').passed));
  check('…none is a copy of the H1', t.every((o) => o.text.toLowerCase() !== ctx.h1.toLowerCase()));

  const h1Copy = S.scoreTitle(ctx.title, ctx);
  check('a title copied verbatim from the H1 fails the unique rule', !h1Copy.rules.find((x) => x.id === 'unique').passed);
  const caps = S.scoreTitle('CLINIC NOT ON GOOGLE MAPS | FIX | GUIDE | 2026', ctx);
  check('ALL-CAPS with 3 separators fails the hygiene rule', !caps.rules.find((x) => x.id === 'hygiene').passed);

  const noKw = S.scoreTitle('A Practical Guide to Your Google Business Profile', Object.assign({}, ctx, { focusKeyword: '' }));
  check('no focus keyword → keyword rules skipped, not guessed', noKw.keywordMissing &&
    noKw.rules.filter((x) => x.skipped).length === 2);

  check('bands: 80 good, 79 needs work, 49 poor', S.band(80).key === 'good' && S.band(79).key === 'warn' && S.band(49).key === 'poor');
}

// ── import ──────────────────────────────────────────────────────────────────

function importer() {
  group('Markdown import — comment block, focus keyword, Related, FAQ');
  const { parseMarkdownImport } = require('../lib/markdown-import');
  const md = [
    '<!--',
    'SEO title: AEO for Doctors: What It Is and Why It Matters Now',
    'Meta description: Learn what AEO for doctors means and how to get your clinic cited by AI answers.',
    'Primary query: aeo for doctors',
    '-->',
    '',
    '# What Is AEO? A Plain-English Guide',
    '',
    'Intro paragraph. <!-- editor: check this stat -->',
    '',
    '## FAQ',
    '',
    '**What is AEO?**',
    'It is answer engine optimisation.',
    '',
    '**Is it new?** Yes, fairly new.',
    '',
    '### Does it replace SEO?',
    'No, it builds on it.',
    '',
    '## Related',
    '',
    '- [GEO for doctors](/resources/geo-for-doctors)',
    '- https://thedocmirror.com/resources/medical-schema-markup-ai',
  ].join('\n');
  const f = parseMarkdownImport(md, {}).fields;

  check('SEO title taken verbatim from the comment line', f.seo_title === 'AEO for Doctors: What It Is and Why It Matters Now');
  check('SEO title is NOT the H1', f.seo_title !== f.title);
  check('meta description from the comment block', /^Learn what AEO/.test(f.meta_description));
  check('Primary query → focus keyword', f.focus_keyword === 'aeo for doctors');
  check('title from the H1', f.title === 'What Is AEO? A Plain-English Guide');
  check('3 FAQ items: bold Q (next line), bold Q (same line), ### heading', f.faq.length === 3 &&
    f.faq[1].question === 'Is it new?' && f.faq[1].answer === 'Yes, fairly new.', JSON.stringify(f.faq));
  check('## Related → related slugs, in order', JSON.stringify(f.related_slugs) === '["geo-for-doctors","medical-schema-markup-ai"]',
    JSON.stringify(f.related_slugs));
  check('HTML comments stripped from the body', !/<!--|-->/.test(f.content_md));
  check('FAQ and Related sections removed from the body', !/## FAQ|## Related/.test(f.content_md));

  const fm = parseMarkdownImport('---\ntitle: X Post Title\nfocus_keyword: local seo\nrelated:\n  - /resources/geo-for-doctors\n  - aeo-for-doctors\n---\nBody.', {}).fields;
  check('frontmatter focus_keyword', fm.focus_keyword === 'local seo');
  check('frontmatter related: list → slugs', JSON.stringify(fm.related_slugs) === '["geo-for-doctors","aeo-for-doctors"]');
  const none = parseMarkdownImport('# Just a title\n\nBody.', {}).fields;
  check('no keyword in the file → focus keyword left blank', none.focus_keyword === '');
  check('no SEO-title line → SEO title left blank (not the H1)', none.seo_title === '');
}

// ── run ─────────────────────────────────────────────────────────────────────

(async () => {
  const quiet = console.warn; const quietErr = console.error; const quietLog = console.log;
  // The modules under test log their own diagnostics; keep the report readable.
  const filter = (fn) => (...a) => { if (!/^\[(resources-db|admin\/posts|resources)\]/.test(String(a[0]))) fn(...a); };
  console.warn = filter(quiet); console.error = filter(quietErr); console.log = filter(quietLog);

  try {
    await visibility();
    await adminListOrder();
    await editorRules();
    await outage();
    credentials();
    seoScore();
    importer();
  } catch (e) {
    failures.push('crashed: ' + e.stack);
    console.log('  ✗ crashed: ' + e.stack);
  } finally {
    supa.getSupabaseClient = realGet;
  }

  console.log('\n' + '─'.repeat(72));
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
})();
