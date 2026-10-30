'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Admin CMS — SEO title / meta description scoring support

     GET  /api/admin/seo/corpus     every other page's SEO title + description
     POST /api/admin/seo/suggest    rewrite options for one field

   Behind requireAuth + requireAdmin via the /api/admin mount in server.js.

   The SCORE is computed by lib/seo/seo-score.js — in the browser for the live
   number, and here again for every option this route returns. A model may be
   asked for wording, but it never decides anything: each AI line is re-scored
   against the same rules and dropped unless it passes all of them, and the
   deterministic templates fill whatever is left. So the panel works the same
   with no API key at all — just with template wording.
   ────────────────────────────────────────────────────────────────────────── */

require('../../lib/env');
const { getSupabaseClient, withSupabaseRetry, formatFetchError } = require('../../lib/supabase-client');
const { getAllResources } = require('../../lib/resources');
const SeoScore = require('../../lib/seo/seo-score');

const AI_TIMEOUT_MS = 12_000;

function aiEnabled() {
  if (String(process.env.SEO_SUGGEST_AI || '').toLowerCase() === 'false') return false;
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * The SEO titles and descriptions of every page except the one being edited,
 * for the "unique" rules. Markdown articles and CMS rows of any status are
 * included — a draft that copies a live page's title is exactly the case to
 * catch before it publishes.
 */
async function loadCorpus(excludeId, excludeSlug) {
  const titles = [];
  const descriptions = [];
  const seen = new Set();

  try {
    for (const p of getAllResources()) {
      if (!p.slug || p.slug === excludeSlug || seen.has(p.slug)) continue;
      seen.add(p.slug);
      if (p.seoTitle) titles.push(p.seoTitle);
      if (p.metaDescription) descriptions.push(p.metaDescription);
    }
  } catch (e) {
    console.warn('[admin/seo] markdown corpus warn:', e.message);
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    let q = supabase.from('blog_posts').select('id, slug, title, seo_title, meta_description').limit(1000);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await withSupabaseRetry(() => q, { label: 'admin-seo-corpus', attempts: 2 });
    if (error) {
      console.warn(`[admin/seo] corpus query failed: ${formatFetchError(error)}`);
    } else {
      for (const r of data || []) {
        if (r.slug === excludeSlug || seen.has(r.slug)) continue;
        seen.add(r.slug);
        if (r.seo_title || r.title) titles.push(r.seo_title || r.title);
        if (r.meta_description) descriptions.push(r.meta_description);
      }
    }
  }

  return { titles, descriptions };
}

async function corpus(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const c = await loadCorpus(String(req.query.exclude || ''), String(req.query.slug || ''));
  return res.json(c);
}

// ── AI wording ──────────────────────────────────────────────────────────────

function buildPrompt(field, ctx) {
  const kw = ctx.focusKeyword || '(none set)';
  const about = ctx.excerpt || ctx.title;
  if (field === 'title') {
    return `Rewrite the SEO title for the page titled "${ctx.title}" about "${about}" targeting the keyword "${kw}". ` +
      'Return 3 options, each 50–60 characters, keyword in the first 30 characters, no ALL-CAPS, at most one ' +
      'separator (| : – —), include a number, a power word or a clear benefit, and do not copy the page title verbatim. ' +
      'Do not invent facts, statistics or claims the page does not make. ' +
      'Respond with JSON only, exactly: {"options": ["…", "…", "…"]}';
  }
  return `Rewrite the meta description for the page titled "${ctx.title}" about "${about}" targeting the keyword "${kw}". ` +
    'Return 3 options, each 120–160 characters, include the keyword exactly, include a call-to-action verb ' +
    '(Learn, Get, Discover, See…), active voice, describe this specific page, and do not start with "This article". ' +
    'Do not invent facts, statistics or claims the page does not make. ' +
    'Respond with JSON only, exactly: {"options": ["…", "…", "…"]}';
}

async function aiOptions(field, ctx) {
  if (!aiEnabled()) return [];
  const { runClaudePrompt } = require('../../lib/claude-client');
  const call = runClaudePrompt(buildPrompt(field, ctx), { label: `seo-suggest-${field}`, maxTokens: 600 });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), AI_TIMEOUT_MS));
  try {
    const out = await Promise.race([call, timeout]);
    const list = out && Array.isArray(out.options) ? out.options : [];
    return list.map((s) => String(s || '').replace(/^["'\s]+|["'\s]+$/g, '')).filter(Boolean).slice(0, 6);
  } catch (e) {
    console.warn(`[admin/seo] AI suggest unavailable (${e.message}) — using templates`);
    return [];
  }
}

/**
 * POST /api/admin/seo/suggest
 * body: { field: 'title'|'description', id, slug, title, excerpt, focus_keyword, value }
 *
 * Returns the current score (with every failing rule explained) and up to three
 * options, each of which passes every applicable rule.
 */
async function suggest(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const b = req.body || {};
  const field = b.field === 'description' ? 'description' : b.field === 'title' ? 'title' : null;
  if (!field) return res.status(400).json({ error: 'field must be "title" or "description".' });

  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Add a blog title first — suggestions are built from it.' });

  const c = await loadCorpus(String(b.id || ''), String(b.slug || ''));
  const ctx = {
    title,
    h1: title,
    excerpt: String(b.excerpt || '').trim(),
    focusKeyword: String(b.focus_keyword || '').trim(),
    otherTitles: c.titles,
    otherDescriptions: c.descriptions,
  };

  const scorer = field === 'title' ? SeoScore.scoreTitle : SeoScore.scoreDescription;
  const current = scorer(String(b.value || ''), ctx);

  const fromAi = SeoScore.filterPassing(await aiOptions(field, ctx), scorer, ctx, 'ai', 3);
  const templated = field === 'title' ? SeoScore.suggestTitles(ctx, 6) : SeoScore.suggestDescriptions(ctx, 6);

  const seen = new Set(fromAi.map((o) => o.text.toLowerCase()));
  const options = fromAi.slice();
  for (const o of templated) {
    if (options.length >= 3) break;
    if (seen.has(o.text.toLowerCase())) continue;
    seen.add(o.text.toLowerCase());
    options.push(o);
  }

  return res.json({
    field,
    current,
    options,
    ai_used: fromAi.length > 0,
    keyword_missing: !ctx.focusKeyword,
  });
}

module.exports = { corpus, suggest, loadCorpus, buildPrompt };
