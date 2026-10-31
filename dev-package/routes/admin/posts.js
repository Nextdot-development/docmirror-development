'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Admin CMS — blog_posts CRUD

     GET   /api/admin/posts                 list (search + status filter)
     GET   /api/admin/posts/slug-check      is this slug free?
     GET   /api/admin/posts/related-search   pick "Related in this series"
     GET   /api/admin/posts/:id             load one for editing
     POST  /api/admin/posts                 create
     PATCH /api/admin/posts/:id             update

   All of it sits behind requireAuth + requireAdmin via the /api/admin mount in
   server.js. Every rule that matters is enforced HERE, not in the browser: the
   publish checklist, the slug lock, the timezone conversion and the content
   sanitiser all run server-side, because a form can be bypassed and a REST
   call cannot be trusted.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { getSupabaseClient, withSupabaseRetry, formatFetchError } = require('../../lib/supabase-client');
const { slugify, getAllResources, getResourceBySlug } = require('../../lib/resources');
const { readingTimeMinutes, autoExcerpt, renderMarkdown, BASE_PATH } = require('../../lib/blog-post-mapper');
const { stripInternalLinks } = require('../../lib/strip-internal-links');
const { markdownToBlocks } = require('../../lib/content-blocks');
// Reused rather than re-derived: the list, the dashboard counts and the public
// read must agree on what "published right now" means, down to the edge case of
// a row marked 'published' with a future date.
const { effectiveStatus, PUBLISHABLE } = require('./stats');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUSES = ['draft', 'scheduled', 'published', 'archived'];
const MAX_RELATED = 6;

// The fields that must be filled before an article may face the public. Kept
// as data so the editor's checklist and this gate cannot drift apart — the
// editor asks the server for nothing, it just mirrors the same list, and the
// server refuses regardless of what the browser believed.
const PUBLISH_REQUIRED = [
  ['title',            'Title'],
  ['slug',             'Slug'],
  ['featured_image',   'Featured Image'],
  ['image_alt',        'Featured Image ALT'],
  ['category',         'Category'],
  ['seo_title',        'SEO Title'],
  ['meta_description', 'Meta Description'],
];

const BASE_COLUMNS =
  'id, title, slug, excerpt, content_md, author, category, tags, read_time_minutes, ' +
  'featured_image, image_alt, seo_title, meta_description, faq, related_slugs, ' +
  'status, published_at, created_at, updated_at, created_by, updated_by';

// Added by migration 022. Probed once per process rather than assumed, so the
// editor keeps working on a database where 022 has not been applied yet — the
// same "harden the code against schema drift" approach migration 011 documents
// for the reports table. When the columns are missing the toggles simply
// default to on, which is the behaviour every article has today.
const SCHEMA_TOGGLE_COLUMNS = ['enable_article_schema', 'enable_faq_schema'];
let _togglesSupported = null;

async function togglesSupported(supabase) {
  if (_togglesSupported !== null) return _togglesSupported;
  const { error } = await supabase.from('blog_posts').select(SCHEMA_TOGGLE_COLUMNS[0]).limit(0);
  _togglesSupported = !error;
  if (!_togglesSupported) {
    console.warn('[admin/posts] migration 022 not applied — schema toggles disabled, both default to on');
  }
  return _togglesSupported;
}

// Added by migration 030, probed the same way: focus_keyword + version on
// blog_posts, and the blog_revisions table. Without them the editor simply has
// no keyword to persist and no history panel.
const V2_COLUMNS = ['focus_keyword', 'version'];
let _v2Supported = null;
let _revisionsSupported = null;

async function v2Supported(supabase) {
  if (_v2Supported !== null) return _v2Supported;
  const { error } = await supabase.from('blog_posts').select(V2_COLUMNS.join(', ')).limit(0);
  _v2Supported = !error;
  if (!_v2Supported) console.warn('[admin/posts] migration 030 not applied — focus keyword and version disabled');
  return _v2Supported;
}

async function revisionsSupported(supabase) {
  if (_revisionsSupported !== null) return _revisionsSupported;
  const { error } = await supabase.from('blog_revisions').select('id').limit(0);
  _revisionsSupported = !error;
  if (!_revisionsSupported) console.warn('[admin/posts] migration 030 not applied — revision history disabled');
  return _revisionsSupported;
}

// Added by migration 031: canonical/OG/Twitter overrides, the persisted
// timezone, the immutable first-publish stamp, and the structured-block
// mirror of content_md. Probed the same way as 022/030 — absent, the editor
// simply has no override fields and no blocks column to fill.
const V3_COLUMNS = ['canonical_url', 'og_image', 'twitter_image', 'time_zone', 'first_published_at', 'content_blocks'];
let _v3Supported = null;
let _redirectsSupported = null;

async function v3Supported(supabase) {
  if (_v3Supported !== null) return _v3Supported;
  const { error } = await supabase.from('blog_posts').select(V3_COLUMNS.join(', ')).limit(0);
  _v3Supported = !error;
  if (!_v3Supported) console.warn('[admin/posts] migration 031 not applied — SEO overrides, persisted timezone and blocks disabled');
  return _v3Supported;
}

async function redirectsSupported(supabase) {
  if (_redirectsSupported !== null) return _redirectsSupported;
  const { error } = await supabase.from('blog_redirects').select('old_slug').limit(0);
  _redirectsSupported = !error;
  if (!_redirectsSupported) console.warn('[admin/posts] migration 031 not applied — slug-change redirects disabled, slug stays locked once live');
  return _redirectsSupported;
}

async function selectColumns(supabase) {
  let cols = BASE_COLUMNS;
  if (await togglesSupported(supabase)) cols += ', ' + SCHEMA_TOGGLE_COLUMNS.join(', ');
  if (await v2Supported(supabase)) cols += ', ' + V2_COLUMNS.join(', ');
  if (await v3Supported(supabase)) cols += ', ' + V3_COLUMNS.join(', ');
  return cols;
}

/** Drops columns the database has not been migrated to hold yet. */
async function stripUnsupported(supabase, row) {
  if (!await togglesSupported(supabase)) SCHEMA_TOGGLE_COLUMNS.forEach((c) => { delete row[c]; });
  if (!await v2Supported(supabase)) V2_COLUMNS.forEach((c) => { delete row[c]; });
  if (!await v3Supported(supabase)) V3_COLUMNS.forEach((c) => { delete row[c]; });
  return row;
}

// ── revisions ───────────────────────────────────────────────────────────────

// What a revision keeps: everything the editor can change. Status and publish
// time are stored for context only — restoring never republishes anything.
const REVISION_FIELDS = [
  'title', 'slug', 'excerpt', 'content_md', 'author', 'category', 'tags', 'read_time_minutes',
  'featured_image', 'image_alt', 'seo_title', 'meta_description', 'focus_keyword', 'faq',
  'related_slugs', 'enable_article_schema', 'enable_faq_schema', 'status', 'published_at',
  'canonical_url', 'og_image', 'twitter_image', 'time_zone', 'content_blocks',
];

/**
 * Stores the row as it was BEFORE this save. Best effort: a failure to write
 * history is logged and never blocks the save itself.
 */
async function writeRevision(supabase, existing, adminId, reason) {
  if (!await revisionsSupported(supabase)) return;
  const snapshot = {};
  for (const k of REVISION_FIELDS) if (existing[k] !== undefined) snapshot[k] = existing[k];
  const { error } = await supabase.from('blog_revisions').insert({
    post_id: existing.id,
    version: existing.version || 1,
    snapshot,
    reason,
    created_by: adminId,
  });
  if (error) console.warn(`[admin/posts] revision write failed for ${existing.id}: ${error.message}`);
}

/**
 * Records that `oldSlug` now lives at `newSlug` (migration 031). Best effort,
 * same as writeRevision: a failure here is logged and never blocks the save
 * that already succeeded.
 *
 * Collapses chains so a lookup is always one hop: any earlier redirect that
 * pointed AT oldSlug (someone renamed A -> B, and now B -> C) is rewritten to
 * point straight at newSlug, instead of leaving A -> B -> C to be followed.
 */
async function writeRedirect(supabase, oldSlug, newSlug, postId) {
  try {
    await supabase.from('blog_redirects').update({ new_slug: newSlug }).eq('new_slug', oldSlug);
    const { error } = await supabase.from('blog_redirects')
      .upsert({ old_slug: oldSlug, new_slug: newSlug, post_id: postId }, { onConflict: 'old_slug' });
    if (error) throw error;
  } catch (error) {
    console.warn(`[admin/posts] redirect write failed (${oldSlug} -> ${newSlug}): ${error.message}`);
  }
}

/** Reads the toggles off a row, defaulting to on when the columns are absent. */
function readToggles(row) {
  return {
    enable_article_schema: row && row.enable_article_schema !== false,
    enable_faq_schema:     row && row.enable_faq_schema !== false,
  };
}

// ── timezone ────────────────────────────────────────────────────────────────

/** Offset of `timeZone` from UTC, in ms, at the instant `utcMs`. */
function tzOffsetMs(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asUtc - utcMs;
}

/**
 * "2026-08-10" + "09:30" in Asia/Kolkata → the correct UTC instant.
 *
 * Done on the server, not in the browser: published_at is what decides when an
 * article becomes public, so it must not depend on the machine that submitted
 * the form. Two passes settle zones whose offset changes across the boundary
 * being converted (Asia/Kolkata has no DST, so one pass would do — the second
 * is for the other zones the picker offers).
 */
function zonedWallClockToUtc(dateStr, timeStr, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
  const time = /^\d{2}:\d{2}$/.test(String(timeStr || '')) ? timeStr : '09:00';

  const naiveUtc = Date.parse(`${dateStr}T${time}:00Z`);
  if (!Number.isFinite(naiveUtc)) return null;

  let guess = naiveUtc;
  try {
    for (let i = 0; i < 2; i++) guess = naiveUtc - tzOffsetMs(guess, timeZone);
  } catch (_) {
    return null;                       // unknown IANA zone
  }
  const d = new Date(guess);
  return isNaN(d.getTime()) ? null : d;
}

// ── content safety ──────────────────────────────────────────────────────────

// Markdown is rendered with raw HTML passthrough, so the stored body is the
// only place to stop dangerous markup. The editor already emits nothing but
// Markdown plus <u>, but a hand-crafted PATCH could carry anything, so the
// same allowlist is applied here as well.
const ALLOWED_INLINE_HTML = /^<\/?(u|br|sub|sup)\s*\/?>$/i;

function sanitiseMarkdown(md) {
  let out = String(md || '');

  // Whole dangerous elements, content included.
  out = out.replace(/<(script|style|iframe|object|embed|form|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '');
  out = out.replace(/<(script|style|iframe|object|embed|form|svg|math)\b[^>]*>/gi, '');

  // Any other raw tag that is not on the inline allowlist is dropped; its text
  // survives because only the tag itself is removed.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => (ALLOWED_INLINE_HTML.test(tag) ? tag : ''));

  // Markdown links/images pointing at an executable scheme.
  out = out.replace(/\]\(\s*(javascript|vbscript|data)\s*:[^)]*\)/gi, '](#)');

  return out;
}

/** Only http(s), mailto and site-relative destinations survive. */
function safeUrl(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^(javascript|vbscript|data|file):/i.test(v)) return '';
  if (/^https?:\/\//i.test(v) || /^mailto:/i.test(v) || v.startsWith('/')) return v;
  return '';
}

/** Is this a zone Intl actually knows, e.g. "Asia/Kolkata"? */
function isValidTimeZone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

// ── payload normalisation ───────────────────────────────────────────────────

function cleanStringArray(value, { max = 50, asSlug = false } = {}) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  const out = [];
  for (let item of raw) {
    item = String(item == null ? '' : item).trim();
    if (asSlug) item = slugify(item);
    if (!item) continue;
    if (asSlug && !SLUG_RE.test(item)) continue;
    if (!out.includes(item)) out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function cleanFaq(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((f) => ({
      question: String((f && f.question) || '').trim(),
      answer:   String((f && f.answer) || '').trim(),
    }))
    .filter((f) => f.question && f.answer)
    .slice(0, 50);
}

/**
 * Builds the column values from a request body. Returns { fields, errors }.
 * `existing` is the current row on update, so unchanged rules (slug lock)
 * can be applied against what is actually stored.
 */
function buildFields(body, { existing = null } = {}) {
  const errors = [];
  const f = {};

  f.title = String(body.title || '').trim();
  // Enforced by the blog_posts CHECK too — surfaced here so the admin gets a
  // sentence instead of a Postgres constraint error.
  if (!f.title) errors.push('A title is required to save, even as a draft.');

  // An empty slug auto-fills from the title, so a draft never blocks on it.
  let slug = slugify(String(body.slug || '').trim() || f.title);
  if (!slug || !SLUG_RE.test(slug)) {
    errors.push('Could not build a valid URL slug — use letters, numbers and hyphens.');
  }
  f.slug = slug;

  f.excerpt          = String(body.excerpt || '').trim();
  // Strip the editorial "Internal Links" planning section at save time too —
  // same rule lib/blog-post-mapper.js applies at read time — so a post is
  // stored clean from the moment it's created/published, not just rendered
  // clean. Sanitise first (strip dangerous markup), then strip the section.
  f.content_md       = stripInternalLinks(sanitiseMarkdown(body.content_md));
  f.author           = String(body.author || '').trim() || 'The Doc Mirror';
  f.category         = String(body.category || '').trim() || 'Guide';
  f.tags             = cleanStringArray(body.tags, { max: 30 });
  f.featured_image   = safeUrl(body.featured_image);
  f.image_alt        = String(body.image_alt || '').trim();
  f.seo_title        = String(body.seo_title || '').trim() || null;
  f.meta_description = String(body.meta_description || '').trim() || null;
  // Never derived from anything — an empty keyword means "not set".
  f.focus_keyword    = String(body.focus_keyword || '').trim().slice(0, 120) || null;
  f.faq              = cleanFaq(body.faq);

  // Optional overrides (migration 031). Blank means "keep deriving it",
  // exactly as every post has behaved until now.
  f.canonical_url = safeUrl(body.canonical_url) || null;
  f.og_image      = safeUrl(body.og_image) || null;
  f.twitter_image = safeUrl(body.twitter_image) || null;

  // The zone the author picked, for the editor to show back correctly. Display
  // only — resolveStatus() below still converts it to a UTC published_at,
  // which is the only thing that gates or sorts anything.
  const tz = String(body.timezone || '').trim();
  f.time_zone = isValidTimeZone(tz) ? tz : (existing ? existing.time_zone : null) || 'Asia/Kolkata';

  // Best-effort structured-block mirror of the body (migration 031). Never
  // blocks a save: a parse failure just leaves this column null.
  f.content_blocks = markdownToBlocks(f.content_md);

  f.related_slugs = cleanStringArray(body.related_slugs, { max: MAX_RELATED, asSlug: true })
    .filter((s) => s !== f.slug);              // an article is not related to itself

  // Structured-data switches (migration 022). Absent means on, so a payload
  // from an older client cannot silently strip an article's schema.
  f.enable_article_schema = body.enable_article_schema !== false;
  f.enable_faq_schema     = body.enable_faq_schema !== false;

  const rt = parseInt(body.read_time_minutes, 10);
  f.read_time_minutes = Number.isFinite(rt) && rt > 0
    ? rt
    : (readingTimeMinutes(f.content_md) || null);

  // Excerpt drives the listing card and the meta description fallback; deriving
  // it matches what the Markdown layer does for a post with no `description`.
  if (!f.excerpt) f.excerpt = autoExcerpt(f.content_md);

  // ── slug change on a live article (migration 031) ────────────────────────
  // Once a URL has been live it is indexed and linked, so changing it must
  // never silently 404 the old address. Rather than freezing the field, the
  // caller writes a redirect (old -> new) alongside the save — see
  // `redirectFrom` below and update(). Without migration 031 the table does
  // not exist, so the slug stays frozen exactly as it did before this change.
  let redirectFrom = null;
  if (existing) {
    const wasLive = existing.published_at && Date.parse(existing.published_at) <= Date.now();
    if (wasLive && f.slug !== existing.slug) redirectFrom = existing.slug;
  }

  return { fields: f, errors, redirectFrom };
}

/** Which publish-required fields are still empty. */
function missingForPublish(fields) {
  return PUBLISH_REQUIRED.filter(([key]) => {
    const v = fields[key];
    return v === null || v === undefined || String(v).trim() === '';
  }).map(([, label]) => label);
}

/**
 * Resolves status + published_at from the requested action.
 * Never mutates anything; returns { status, published_at, errors }.
 */
function resolveStatus(action, body, fields, existing) {
  const errors = [];
  const prevPublishedAt = existing ? existing.published_at : null;

  switch (action) {
    case 'publish': {
      const missing = missingForPublish(fields);
      if (missing.length) {
        errors.push('Complete these before publishing: ' + missing.join(', '));
        break;
      }
      // Keep the original publish instant when re-publishing something that was
      // already live, so its date and sitemap entry do not jump forward.
      const wasLive = prevPublishedAt && Date.parse(prevPublishedAt) <= Date.now();
      return {
        status: 'published',
        published_at: wasLive ? prevPublishedAt : new Date().toISOString(),
        errors,
      };
    }

    case 'schedule': {
      const missing = missingForPublish(fields);
      if (missing.length) {
        errors.push('Complete these before scheduling: ' + missing.join(', '));
        break;
      }
      const when = zonedWallClockToUtc(body.publish_date, body.publish_time, body.timezone || 'Asia/Kolkata');
      if (!when) { errors.push('Pick a valid publish date and time to schedule.'); break; }
      if (when.getTime() <= Date.now()) {
        errors.push('The scheduled time is in the past. Pick a future time, or use Publish Now.');
        break;
      }
      return { status: 'scheduled', published_at: when.toISOString(), errors };
    }

    case 'archive':
      // published_at is kept: it records when the article WAS live, and the
      // status alone is what removes it from the public site.
      return { status: 'archived', published_at: prevPublishedAt, errors };

    case 'autosave':          // the editor's 30s timer — drafts only, see update()
    case 'save_draft':
    default: {
      // A draft may carry an intended date without being scheduled yet, so the
      // editor does not lose what the admin typed.
      let intended = prevPublishedAt;
      if (body.publish_date) {
        const when = zonedWallClockToUtc(body.publish_date, body.publish_time, body.timezone || 'Asia/Kolkata');
        if (when) intended = when.toISOString();
      }
      return { status: 'draft', published_at: intended, errors };
    }
  }

  return { status: null, published_at: null, errors };
}

// ── shared helpers ──────────────────────────────────────────────────────────

function db(res) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    res.status(500).json({ error: 'Database is not configured' });
    return null;
  }
  return supabase;
}

function fail(res, label, error) {
  console.error(`[admin/posts] ${label} FAILED: ${formatFetchError(error)}`);
  return res.status(503).json({
    error: 'The database could not complete that right now — please try again.',
    detail: error && error.message ? error.message : undefined,
    retryable: true,
  });
}

/** Is this slug already taken by a CMS row, or by a Markdown article? */
async function slugConflict(supabase, slug, ignoreId) {
  const markdownHit = getResourceBySlug(slug);
  if (markdownHit) {
    return { taken: true, source: 'markdown', title: markdownHit.title };
  }
  let q = supabase.from('blog_posts').select('id, title').eq('slug', slug).limit(1);
  if (ignoreId) q = q.neq('id', ignoreId);
  const { data, error } = await withSupabaseRetry(() => q, { label: 'admin-posts-slug', attempts: 2 });
  if (error) throw error;
  if (data && data.length) return { taken: true, source: 'cms', title: data[0].title };
  return { taken: false };
}

// ── handlers ────────────────────────────────────────────────────────────────

/*
 * The status filter follows the SAME rule the dashboard counts and the public
 * site use — effective status, not the raw column. Filtering on `status` alone
 * would put a due-and-live post under "Scheduled", which is the one thing the
 * whole read-time model exists to avoid.
 *
 * Only the columns the table draws are selected: content_md on fifty rows is
 * megabytes of body text nothing on the screen reads.
 */
const LIST_COLUMNS =
  'id, title, slug, excerpt, author, category, tags, read_time_minutes, featured_image, ' +
  'status, published_at, created_at, updated_at, created_by';

/** created_by holds a profile id; the list shows who that was. */
async function creatorEmails(supabase, rows) {
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await supabase.from('profiles').select('id, email').in('id', ids);
  if (error) { console.warn('[admin/posts] creator lookup failed:', error.message); return {}; }
  const out = {};
  for (const p of data || []) out[p.id] = p.email;
  return out;
}

function applyStatusFilter(query, status, nowIso) {
  switch (status) {
    case 'draft':     return query.eq('status', 'draft');
    case 'archived':  return query.eq('status', 'archived');
    case 'published': return query.in('status', PUBLISHABLE).lte('published_at', nowIso);
    case 'scheduled': return query.in('status', PUBLISHABLE).gt('published_at', nowIso);
    default:          return query;
  }
}

async function list(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const status = String(req.query.status || '').trim();
  const q      = String(req.query.q || '').trim();
  const cat    = String(req.query.category || '').trim();

  const now    = new Date();
  const nowIso = now.toISOString();
  const nowMs  = now.getTime();

  // Default is publish date, newest first — never updated_at, or a post that was
  // just re-published (keeping its original date) would jump to the top.
  const sort = ['updated_at', 'published_at', 'created_at', 'title', 'read_time_minutes', 'category', 'status']
    .includes(String(req.query.sort || '')) ? String(req.query.sort) : 'published_at';
  const dir = String(req.query.dir || '');
  const ascending = dir === 'asc' ? true : dir === 'desc' ? false : (sort === 'title' || sort === 'category');

  let query = supabase.from('blog_posts').select(LIST_COLUMNS, { count: 'exact' })
    .order(sort, { ascending, nullsFirst: false });
  // A stable tiebreak, so drafts with no publish date keep a predictable order.
  if (sort !== 'updated_at') query = query.order('updated_at', { ascending: false });
  query = query.limit(limit);

  query = applyStatusFilter(query, status, nowIso);
  if (cat) query = query.eq('category', cat);
  if (q) {
    const safe = q.replace(/[%,()]/g, ' ');
    query = query.or(`title.ilike.%${safe}%,slug.ilike.%${safe}%,excerpt.ilike.%${safe}%`);
  }

  const { data, error, count } = await withSupabaseRetry(
    () => query, { label: 'admin-posts-list', attempts: 2 }
  );
  if (error) return fail(res, 'list', error);

  const emails = await creatorEmails(supabase, data || []);
  const posts = (data || []).map((row) => {
    const eff = effectiveStatus(row, nowMs);
    return Object.assign({}, row, {
      effective_status: eff,
      is_public:        eff === 'published',
      url:              `${BASE_PATH}/${row.slug}`,
      created_by_email: row.created_by ? (emails[row.created_by] || null) : null,
    });
  });

  // `matched` is how many rows the filter found in total; `posts.length` is how
  // many came back under the limit. Reported separately so the screen can say
  // "showing 50 of 120" instead of implying it has everything.
  return res.json({ posts, matched: typeof count === 'number' ? count : posts.length, limit });
}

async function get(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const cols = await selectColumns(supabase);
  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').select(cols).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-posts-get', attempts: 2 }
  );
  if (error) return fail(res, 'get', error);
  if (!data) return res.status(404).json({ error: 'Blog not found' });

  const wasLive = data.published_at && Date.parse(data.published_at) <= Date.now();

  return res.json({
    post: Object.assign({}, data, readToggles(data)),
    schema_toggles_supported: await togglesSupported(supabase),
    focus_keyword_supported: await v2Supported(supabase),
    revisions_supported: await revisionsSupported(supabase),
    spec_parity_supported: await v3Supported(supabase),
    slug_redirects_supported: await redirectsSupported(supabase),
    // Rendered here so the editor can load an existing body into the visual
    // editor without needing a Markdown parser in the browser.
    content_html: require('../../lib/blog-post-mapper').renderMarkdown(data.content_md || ''),
    slug_locked: !!wasLive,
    missing_for_publish: missingForPublish(data),
  });
}

async function slugCheck(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const slug = slugify(String(req.query.slug || '').trim());
  if (!slug || !SLUG_RE.test(slug)) {
    return res.json({ slug, valid: false, available: false, reason: 'Not a valid URL slug.' });
  }

  try {
    const c = await slugConflict(supabase, slug, req.query.id || null);
    return res.json({
      slug,
      valid: true,
      available: !c.taken,
      reason: c.taken
        ? (c.source === 'markdown'
            ? `Already used by an existing article ("${c.title}").`
            : `Already used by another CMS blog ("${c.title}").`)
        : null,
    });
  } catch (error) {
    return fail(res, 'slug-check', error);
  }
}

/**
 * Candidates for "Related in this series".
 *
 * Covers BOTH content sources so the admin never types a URL by hand:
 *   • every existing Markdown article under content/resources/
 *   • every CMS post that is public now or will be (published + scheduled)
 *
 * An empty query returns the whole catalogue rather than nothing, so the
 * picker doubles as a browsable list of everything on the site. New articles —
 * Markdown or CMS — appear here automatically the moment they exist; there is
 * no list to maintain.
 *
 * Scheduled posts are included and labelled: linking to something that goes
 * live next week is a normal editorial choice, and the label makes it a
 * deliberate one rather than an accidental dead link.
 */
async function relatedSearch(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const q = String(req.query.q || '').trim().toLowerCase();
  const exclude = String(req.query.exclude || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 300);
  // "Auto-add latest" asks for one category's newest published/scheduled posts.
  const category = String(req.query.category || '').trim().toLowerCase();

  const matches = (title, slug, cat) =>
    (!category || String(cat || '').trim().toLowerCase() === category) &&
    (!q || String(title || '').toLowerCase().includes(q) || String(slug || '').includes(q));

  const results = [];

  try {
    for (const p of getAllResources()) {
      if (p.slug === exclude) continue;
      if (!matches(p.title, p.slug, p.category)) continue;
      results.push({
        slug: p.slug, title: p.title, category: p.category,
        url: p.url, source: 'article', status: 'published',
        date: p.date ? p.date.iso : '',
      });
    }
  } catch (e) {
    console.warn('[admin/posts] markdown related search warn:', e.message);
  }

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts')
      .select('slug, title, category, status, published_at')
      .in('status', ['published', 'scheduled'])
      .order('published_at', { ascending: false })
      .limit(300),
    { label: 'admin-posts-related', attempts: 2 }
  );
  if (!error) {
    const now = Date.now();
    for (const r of (data || [])) {
      if (r.slug === exclude) continue;
      if (!matches(r.title, r.slug, r.category)) continue;
      const live = r.published_at && Date.parse(r.published_at) <= now;
      results.push({
        slug: r.slug, title: r.title, category: r.category,
        url: `${BASE_PATH}/${r.slug}`, source: 'cms',
        status: live ? 'published' : 'scheduled',
        date: r.published_at ? String(r.published_at).slice(0, 10) : '',
      });
    }
  }

  // A Markdown article and a CMS row can share a slug during migration; the
  // Markdown one is what the public serves today, so it wins.
  const seen = new Set();
  const deduped = results.filter((r) => (seen.has(r.slug) ? false : (seen.add(r.slug), true)));

  deduped.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return res.json({ results: deduped.slice(0, limit), total: deduped.length });
}

/**
 * Resolves what the admin pasted into "add by URL" — a full address, a site
 * path, or a bare slug — and confirms the target actually exists, so a related
 * link can never be a typo pointing at a 404.
 */
async function resolveRelated(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  let raw = String(req.query.value || '').trim();
  if (!raw) return res.status(400).json({ error: 'Paste a URL or a slug.' });

  // https://www.thedocmirror.com/resources/foo  ·  /resources/foo  ·  foo
  raw = raw.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const tail = raw.split('/').filter(Boolean).pop() || '';
  const slug = slugify(tail);

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Could not read a slug from that. Paste the article URL or its slug.' });
  }

  const md = getResourceBySlug(slug);
  if (md) {
    return res.json({
      result: { slug, title: md.title, category: md.category, url: md.url, source: 'article', status: 'published' },
    });
  }

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').select('slug, title, category, status, published_at').eq('slug', slug).maybeSingle(),
    { label: 'admin-posts-resolve', attempts: 2 }
  );
  if (error) return fail(res, 'resolve-related', error);

  if (!data) {
    return res.status(404).json({
      error: `No article found at /resources/${slug}. Check the URL — a related link must point at a real page.`,
    });
  }
  if (data.status === 'draft' || data.status === 'archived') {
    return res.status(409).json({
      error: `"${data.title}" is ${data.status} and has no public URL yet, so it cannot be linked as related.`,
    });
  }

  const live = data.published_at && Date.parse(data.published_at) <= Date.now();
  return res.json({
    result: {
      slug, title: data.title, category: data.category,
      url: `${BASE_PATH}/${slug}`, source: 'cms',
      status: live ? 'published' : 'scheduled',
    },
  });
}

async function create(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const action = String((req.body && req.body.action) || 'save_draft');
  const { fields, errors } = buildFields(req.body || {});
  const st = resolveStatus(action, req.body || {}, fields, null);
  const allErrors = errors.concat(st.errors);

  if (allErrors.length) return res.status(400).json({ error: allErrors[0], errors: allErrors });

  try {
    const c = await slugConflict(supabase, fields.slug, null);
    if (c.taken) {
      return res.status(409).json({
        error: c.source === 'markdown'
          ? `That URL is already used by an existing article ("${c.title}"). Choose a different slug.`
          : `That URL is already used by another CMS blog ("${c.title}"). Choose a different slug.`,
        field: 'slug',
      });
    }
  } catch (error) { return fail(res, 'create/slug', error); }

  const row = {
    ...fields,
    status: st.status,
    published_at: st.published_at,
    first_published_at: st.status === 'published' ? st.published_at : null,
    created_by: req.admin.id,
    updated_by: req.admin.id,
  };
  // Drop columns from migrations 022/030/031 that have not been applied, so a
  // save fails on nothing more than a column the database has not been told
  // about.
  const cols = await selectColumns(supabase);
  await stripUnsupported(supabase, row);

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').insert(row).select(cols).single(),
    { label: 'admin-posts-create', attempts: 2 }
  );
  if (error) return fail(res, 'create', error);

  console.log(`[admin/posts] CREATED id=${data.id} slug=${data.slug} status=${data.status} by=${req.admin.email}`);
  return res.status(201).json({ post: Object.assign({}, data, readToggles(data)) });
}

async function update(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const cols = await selectColumns(supabase);
  const existingRes = await withSupabaseRetry(
    () => supabase.from('blog_posts').select(cols).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-posts-load', attempts: 2 }
  );
  if (existingRes.error) return fail(res, 'update/load', existingRes.error);
  if (!existingRes.data) return res.status(404).json({ error: 'Blog not found' });

  const existing = existingRes.data;
  const action = String((req.body && req.body.action) || 'save_draft');

  // Autosave may only ever touch a draft. Anything else would push half-typed
  // edits onto a live page, or silently unpublish it by saving it as a draft.
  if (action === 'autosave' && existing.status !== 'draft') {
    return res.status(409).json({ error: 'Autosave only runs on drafts.', autosave_skipped: true });
  }

  const { fields, errors, redirectFrom } = buildFields(req.body || {}, { existing });
  const st = resolveStatus(action, req.body || {}, fields, existing);
  const allErrors = errors.concat(st.errors);

  if (allErrors.length) return res.status(400).json({ error: allErrors[0], errors: allErrors });

  // Without migration 031 there is nowhere to record the redirect, so the old
  // URL would just 404 — same protective error the slug lock has always given.
  if (redirectFrom && !await redirectsSupported(supabase)) {
    return res.status(409).json({
      error: `The URL is locked because this article has been published. It stays /resources/${existing.slug}.`,
      field: 'slug',
    });
  }

  if (fields.slug !== existing.slug) {
    try {
      const c = await slugConflict(supabase, fields.slug, existing.id);
      if (c.taken) {
        return res.status(409).json({ error: `That URL is already taken ("${c.title}").`, field: 'slug' });
      }
    } catch (error) { return fail(res, 'update/slug', error); }
  }

  const row = {
    ...fields,
    status: st.status,
    published_at: st.published_at,
    updated_by: req.admin.id,
  };
  // Set once, on the save that first makes the post published, and never
  // overwritten after — see migration 031.
  if (st.status === 'published' && !existing.first_published_at) {
    row.first_published_at = st.published_at;
  }
  // Every deliberate save keeps the previous state; the 30s autosave does not,
  // or the history would be a wall of near-identical snapshots.
  if (action !== 'autosave') {
    await writeRevision(supabase, existing, req.admin.id, action);
    row.version = (existing.version || 1) + 1;
  }
  await stripUnsupported(supabase, row);

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').update(row).eq('id', existing.id).select(cols).single(),
    { label: 'admin-posts-update', attempts: 2 }
  );
  if (error) return fail(res, 'update', error);

  if (redirectFrom) await writeRedirect(supabase, redirectFrom, data.slug, data.id);

  console.log(`[admin/posts] UPDATED id=${data.id} slug=${data.slug} status=${data.status} by=${req.admin.email}`);
  return res.json({ post: Object.assign({}, data, readToggles(data)) });
}

/**
 * POST /api/admin/posts/:id/status
 *
 * A status change on its own, for the blog list where the row is not being
 * edited. The full PATCH rebuilds every field from the request body, so using
 * it from a list would mean sending the whole article back just to press
 * Publish — and any field the list did not happen to carry would be blanked.
 *
 * The publish checklist still applies: a post cannot be published or scheduled
 * from here with fields missing, exactly as in the editor.
 */
async function setStatus(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const cols = await selectColumns(supabase);
  const loaded = await withSupabaseRetry(
    () => supabase.from('blog_posts').select(cols).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-posts-status-load', attempts: 2 }
  );
  if (loaded.error) return fail(res, 'status/load', loaded.error);
  if (!loaded.data) return res.status(404).json({ error: 'Blog not found' });

  const existing = loaded.data;
  const action = String((req.body && req.body.action) || '');
  if (!['publish', 'schedule', 'archive', 'save_draft'].includes(action)) {
    return res.status(400).json({ error: 'Unknown action.' });
  }

  // The row as it stands is what the checklist is judged against — this route
  // changes status, never content.
  const st = resolveStatus(action, req.body || {}, existing, existing);
  if (st.errors.length) return res.status(400).json({ error: st.errors[0], errors: st.errors });

  await writeRevision(supabase, existing, req.admin.id, action);
  const patch = await stripUnsupported(supabase, {
    status: st.status, published_at: st.published_at, updated_by: req.admin.id,
    version: (existing.version || 1) + 1,
    ...(st.status === 'published' && !existing.first_published_at
      ? { first_published_at: st.published_at } : {}),
  });

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts')
      .update(patch)
      .eq('id', existing.id).select(cols).single(),
    { label: 'admin-posts-status', attempts: 2 }
  );
  if (error) return fail(res, 'status', error);

  console.log(
    `[admin/posts] STATUS ${existing.status} -> ${data.status} id=${data.id} ` +
    `slug=${data.slug} by=${req.admin.email}`
  );
  return res.json({ post: Object.assign({}, data, readToggles(data)) });
}

/**
 * DELETE /api/admin/posts/:id
 *
 * Permanent. There is no soft-delete column and no undo — Archive is the
 * reversible option, and the UI says so.
 *
 * A post that is live right now needs an explicit `?confirm=live`. Deleting one
 * removes a URL that is indexed, may be linked from other articles, and may sit
 * in someone's bookmarks; that deserves a second, deliberate step rather than
 * the same click that removes an untouched draft.
 *
 * Uploaded images are deliberately NOT removed. blog_media is a shared library
 * and the same image may be the hero of another article.
 */
async function remove(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const loaded = await withSupabaseRetry(
    () => supabase.from('blog_posts')
      .select('id, title, slug, status, published_at')
      .eq('id', req.params.id).maybeSingle(),
    { label: 'admin-posts-delete-load', attempts: 2 }
  );
  if (loaded.error) return fail(res, 'delete/load', loaded.error);
  if (!loaded.data) return res.status(404).json({ error: 'Blog not found' });

  const post = loaded.data;
  const isLive = ['published', 'scheduled'].includes(post.status) &&
    post.published_at && Date.parse(post.published_at) <= Date.now();

  if (isLive && String(req.query.confirm || '') !== 'live') {
    return res.status(409).json({
      error: `"${post.title}" is live at /resources/${post.slug}. Deleting it will 404 that ` +
             'URL for anyone who has it bookmarked or linked. Archive removes it from the ' +
             'site and is reversible — delete only if you are sure.',
      requires_confirm: 'live',
      slug: post.slug,
    });
  }

  const { error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').delete().eq('id', post.id),
    { label: 'admin-posts-delete', attempts: 2 }
  );
  if (error) return fail(res, 'delete', error);

  console.warn(
    `[admin/posts] DELETED id=${post.id} slug=${post.slug} status=${post.status} ` +
    `wasLive=${isLive} by=${req.admin.email}`
  );

  return res.json({
    deleted: { id: post.id, title: post.title, slug: post.slug, status: post.status, wasLive: isLive },
  });
}

/**
 * GET /api/admin/posts/title-check?title=&id=
 *
 * Is another article — CMS or Markdown — already using this exact title?
 * A warning, not a block: two pages with one headline compete in search, but
 * the author may be mid-rewrite.
 */
async function titleCheck(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const title = String(req.query.title || '').trim();
  const id = String(req.query.id || '').trim();
  if (!title) return res.json({ duplicate: false, matches: [] });

  const key = title.toLowerCase().replace(/\s+/g, ' ');
  const matches = [];

  for (const p of getAllResources()) {
    if (String(p.title || '').toLowerCase().replace(/\s+/g, ' ') === key) {
      matches.push({ title: p.title, slug: p.slug, source: 'article' });
    }
  }

  // ilike with no wildcard is a case-insensitive equality; escape the wildcard
  // characters so a title containing them matches only itself.
  const pattern = title.replace(/[\\%_]/g, (c) => '\\' + c);
  let q = supabase.from('blog_posts').select('id, title, slug, status').ilike('title', pattern).limit(5);
  if (id) q = q.neq('id', id);
  const { data, error } = await withSupabaseRetry(() => q, { label: 'admin-posts-title-check', attempts: 2 });
  if (error) return fail(res, 'title-check', error);
  for (const r of data || []) matches.push({ title: r.title, slug: r.slug, source: 'cms', status: r.status });

  return res.json({ duplicate: matches.length > 0, matches });
}

/**
 * POST /api/admin/posts/:id/duplicate
 *
 * A new DRAFT with the same content. It gets a fresh slug ("-copy", "-copy-2"…),
 * no publish date and no history — it is a new article, not a version.
 */
async function duplicate(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;

  const cols = await selectColumns(supabase);
  const loaded = await withSupabaseRetry(
    () => supabase.from('blog_posts').select(cols).eq('id', req.params.id).maybeSingle(),
    { label: 'admin-posts-dup-load', attempts: 2 }
  );
  if (loaded.error) return fail(res, 'duplicate/load', loaded.error);
  if (!loaded.data) return res.status(404).json({ error: 'Blog not found' });

  const src = loaded.data;
  let slug = null;
  try {
    for (let n = 1; n <= 20 && !slug; n++) {
      const candidate = `${src.slug}-copy${n === 1 ? '' : '-' + n}`;
      if (!(await slugConflict(supabase, candidate, null)).taken) slug = candidate;
    }
  } catch (error) { return fail(res, 'duplicate/slug', error); }
  if (!slug) return res.status(409).json({ error: 'Could not find a free slug for the copy.' });

  const row = {};
  for (const k of REVISION_FIELDS) if (src[k] !== undefined) row[k] = src[k];
  Object.assign(row, {
    title: `Copy of ${src.title}`.slice(0, 200),
    slug,
    status: 'draft',
    published_at: null,
    first_published_at: null,
    version: 1,
    created_by: req.admin.id,
    updated_by: req.admin.id,
  });
  await stripUnsupported(supabase, row);

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_posts').insert(row).select('id, title, slug, status').single(),
    { label: 'admin-posts-duplicate', attempts: 2 }
  );
  if (error) return fail(res, 'duplicate', error);

  console.log(`[admin/posts] DUPLICATED ${src.id} -> ${data.id} slug=${data.slug} by=${req.admin.email}`);
  return res.status(201).json({ post: data });
}

/** GET /api/admin/posts/:id/revisions — newest first, without the bodies. */
async function listRevisions(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;
  if (!await revisionsSupported(supabase)) return res.json({ supported: false, revisions: [] });

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_revisions')
      .select('id, version, reason, created_at, created_by, title:snapshot->>title, status:snapshot->>status')
      .eq('post_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(50),
    { label: 'admin-posts-revisions', attempts: 2 }
  );
  if (error) return fail(res, 'revisions', error);

  const emails = await creatorEmails(supabase, data || []);
  return res.json({
    supported: true,
    revisions: (data || []).map((r) => ({
      id: r.id, version: r.version, reason: r.reason, created_at: r.created_at,
      title: r.title, status: r.status,
      created_by_email: r.created_by ? (emails[r.created_by] || null) : null,
    })),
  });
}

/**
 * GET /api/admin/posts/:id/revisions/:revId
 *
 * One snapshot plus its body rendered to HTML, so the editor can load it into
 * the form. Restoring is deliberately client-side and unsaved: the author sees
 * the old version, then chooses Save Draft / Publish like any other edit.
 */
async function getRevision(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const supabase = db(res); if (!supabase) return;
  if (!await revisionsSupported(supabase)) return res.status(404).json({ error: 'Revision history is not enabled.' });

  const { data, error } = await withSupabaseRetry(
    () => supabase.from('blog_revisions').select('id, version, created_at, snapshot')
      .eq('post_id', req.params.id).eq('id', req.params.revId).maybeSingle(),
    { label: 'admin-posts-revision', attempts: 2 }
  );
  if (error) return fail(res, 'revision', error);
  if (!data) return res.status(404).json({ error: 'Revision not found' });

  return res.json({
    revision: data,
    content_html: renderMarkdown((data.snapshot && data.snapshot.content_md) || ''),
  });
}

module.exports = {
  list, get, create, update, remove, setStatus, slugCheck, relatedSearch, resolveRelated,
  titleCheck, duplicate, listRevisions, getRevision,
  // exported for tests and for the editor's mirrored checklist
  buildFields, resolveStatus, missingForPublish, sanitiseMarkdown,
  zonedWallClockToUtc, PUBLISH_REQUIRED, SLUG_RE,
};
