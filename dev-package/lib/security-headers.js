'use strict';

/**
 * Security response headers for every response the Express app serves.
 *
 * Mounted first in server.js so pages, static assets and API responses all
 * carry the same headers. Everything here was derived from an inventory of
 * what the pages actually load (see docs/security-headers.md for the full
 * list and the reasoning behind each allowance):
 *
 *   - Supabase (auth, storage, REST)         -> connect-src (from env)
 *   - supabase-js + chart.js from jsDelivr     -> script-src cdn.jsdelivr.net
 *   - Google Analytics (gtag.js, GA4 beacons)  -> script/connect/img Google hosts
 *   - Razorpay Checkout (script + iframe)      -> script/frame/connect *.razorpay.com
 *   - Cashfree JS SDK v3 (script + modal)      -> script/frame/connect *.cashfree.com
 *   - AEO Mirror tracker (aeomirror.onrender)  -> script-src + connect-src
 *   - Fonts: self-hosted; Google Fonts kept    -> style-src / font-src (safety net)
 *   - CMS cover images on Supabase storage     -> img-src https:
 *
 * 'unsafe-inline' (script-src and style-src) is deliberate and documented:
 * the public pages are static HTML with 46 inline <script> blocks, 88 inline
 * on*= handlers and 400+ style="" attributes. Moving those to nonces/hashes is
 * a separate refactor; the policy still blocks every non-allow-listed script
 * origin, framing by other sites, <base> hijacking, plugins and data
 * exfiltration to unknown hosts.
 *
 * CSP_MODE env (optional, read at cold start):
 *   enforce      (default) send Content-Security-Policy
 *   report-only  send Content-Security-Policy-Report-Only instead (soak mode)
 *   off          send no CSP header at all (kill switch; other headers stay)
 * Violations are POSTed by browsers to /api/csp-report (see routes/csp-report.js)
 * and show up in the Vercel function logs as "[csp]" lines.
 */

const CSP_REPORT_PATH = '/api/csp-report';

function supabaseOrigins() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  try {
    const { host } = new URL(raw);
    if (host) return [`https://${host}`, `wss://${host}`];
  } catch (_) { /* fall through to the wildcard */ }
  return ['https://*.supabase.co', 'wss://*.supabase.co'];
}

function buildCspDirectives() {
  const supabase = supabaseOrigins();
  return {
    'default-src':     ["'self'"],
    'base-uri':        ["'self'"],
    'object-src':      ["'none'"],
    'frame-ancestors': ["'self'"],
    'script-src': [
      "'self'", "'unsafe-inline'",
      'https://www.googletagmanager.com',
      'https://cdn.jsdelivr.net',
      'https://checkout.razorpay.com', 'https://*.razorpay.com',
      'https://sdk.cashfree.com', 'https://*.cashfree.com',
      'https://aeomirror.onrender.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src':  ["'self'", 'data:', 'https://fonts.gstatic.com'],
    // Covers CMS cover images (Supabase storage), Google place photos, GA pixels.
    'img-src':   ["'self'", 'data:', 'blob:', 'https:'],
    'connect-src': [
      "'self'", ...supabase,
      'https://*.google-analytics.com', 'https://*.analytics.google.com',
      'https://*.googletagmanager.com', 'https://*.g.doubleclick.net',
      'https://*.google.com', 'https://*.google.co.in',
      'https://*.razorpay.com',
      'https://*.cashfree.com',
      'https://aeomirror.onrender.com',
    ],
    'frame-src':    ["'self'", 'https://*.razorpay.com', 'https://*.cashfree.com'],
    'worker-src':   ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src':    ["'self'", 'data:', 'blob:'],
    'report-uri':   [CSP_REPORT_PATH],
  };
}

function serialize(directives) {
  return Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

function buildCsp() {
  return serialize(buildCspDirectives());
}

function cspMode() {
  const m = String(process.env.CSP_MODE || 'enforce').trim().toLowerCase();
  return m === 'report-only' || m === 'off' ? m : 'enforce';
}

const PERMISSIONS_POLICY = [
  'accelerometer=()', 'camera=()', 'geolocation=()', 'gyroscope=()',
  'magnetometer=()', 'microphone=()', 'usb=()',
  'interest-cohort=()', 'browsing-topics=()',
].join(', ');
// Not listed on purpose: payment (Razorpay/Cashfree iframes), clipboard-write
// (copy buttons), fullscreen - their defaults already allow same-origin only.

function securityHeaders() {
  const csp  = buildCsp();
  const mode = cspMode();
  const cspHeader = mode === 'report-only' ? 'Content-Security-Policy-Report-Only'
                  : mode === 'enforce'     ? 'Content-Security-Policy'
                  : null;

  return function securityHeadersMiddleware(_req, res, next) {
    if (cspHeader) res.setHeader(cspHeader, csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    next();
  };
}

module.exports = { securityHeaders, buildCsp, buildCspDirectives, cspMode, CSP_REPORT_PATH, PERMISSIONS_POLICY };
