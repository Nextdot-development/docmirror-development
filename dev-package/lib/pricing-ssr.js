'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Server-rendered pricing fallback for the static marketing pages (homepage,
// /pricing, agency-signup).
//
// Every price on those pages used to be filled ENTIRELY by a client-side fetch
// to /api/client-config (see public/js/pricing-display.js). That fetch has no
// fallback: if it is slow, blocked, or fails for any reason — a proxy, a flaky
// network, anything — every price (and the agency "Add up to N doctors" text)
// is stuck at its "—" placeholder forever, with no retry and no visible error.
//
// This module computes the SAME region + prices lib/pricing.js would, server
// side, at the moment the page is served, and the page's own route (see
// server.js) inlines it as window.TDM_PRICING_INLINE before the client script
// ever runs. pricing-display.js applies it immediately on boot — synchronously,
// before its own fetch even starts — so a price is ALWAYS correct on first
// paint. The client fetch still runs afterward and stays the authoritative
// source for a logged-in buyer's locked currency and the currency-switch
// toggle; this is only the fallback that makes the page never show "—".
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const { resolveRegion, ALLOWED_TIERS } = require('./region');
const pricing = require('./pricing');

/**
 * Which region to server-render for this request. Never throws — any failure
 * degrades to the IN default rather than breaking the page.
 *
 * ?preview_region=US&token=<ADMIN_HEALTH_TOKEN> overrides the normal
 * geo/switcher/default resolution for THIS render only — no cookie, no env
 * var, no effect on checkout or lib/region.js's own FORCE_REGION_TIER. Lets an
 * admin eyeball another region's rendered page from their own browser/country
 * without a VPN or proxy. Silently ignored unless the token exactly matches a
 * non-empty ADMIN_HEALTH_TOKEN env var, so it does nothing when that var is unset.
 */
function resolveRenderRegion(req) {
  try {
    const previewToken = process.env.ADMIN_HEALTH_TOKEN;
    const presented = req && req.query && req.query.token;
    if (previewToken && presented && presented === previewToken) {
      const want = String(req.query.preview_region || '').trim().toUpperCase();
      if (ALLOWED_TIERS.includes(want)) {
        return { tier: want, country: null, source: 'preview' };
      }
    }
    return resolveRegion(req);
  } catch (e) {
    console.error(`[pricing-ssr] region resolution failed (${e.message}) — falling back to IN`);
    return { tier: 'IN', country: null, source: 'default' };
  }
}

/** Prices for inline render. Never throws — falls back to IN pricing. */
function safeDisplayPrices(tier) {
  try {
    return pricing.displayPrices(tier);
  } catch (e) {
    console.error(`[pricing-ssr] displayPrices(${tier}) failed (${e.message}) — falling back to IN`);
    return pricing.displayPrices('IN');
  }
}

/**
 * Read a static page and inline its region-resolved prices as JSON, right
 * before </head> (so it runs before every deferred/body script, regardless of
 * their relative order). Read fresh every request, same as express.static /
 * res.sendFile — no caching, so local edits still show up without a restart.
 */
function renderPricingPage(absPath, req) {
  const region = resolveRenderRegion(req);
  const prices = safeDisplayPrices(region.tier);
  // Escape '</' so an env-configured display string can never prematurely
  // close this inline <script> tag.
  const payload = JSON.stringify({ region: region.tier, country: region.country, source: region.source, prices })
    .replace(/<\//g, '<\\/');
  const html = fs.readFileSync(absPath, 'utf8');
  const script = `<script>window.TDM_PRICING_INLINE=${payload};</script>\n</head>`;
  return html.includes('</head>') ? html.replace('</head>', script) : html;
}

module.exports = { renderPricingPage, resolveRenderRegion, safeDisplayPrices };
