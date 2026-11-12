#!/usr/bin/env node
'use strict';

/**
 * Security-header + CSP compatibility check.
 *
 *   node scripts/verify-security-headers.js [--base http://localhost:3000] [--browser]
 *
 * Part 1 (always): fetches a set of pages, assets and API responses and
 * asserts the headers set by lib/security-headers.js are present and sane,
 * that X-Powered-By is gone, that fonts are self-hosted and that the policy
 * still allow-lists every third-party origin the pages use.
 *
 * Part 2 (--browser): loads every public page in headless Chrome with the
 * CSP enforced, captures `securitypolicyviolation` events, console errors and
 * failed requests, and additionally exercises the pieces a plain page load
 * does not reach: the Razorpay checkout iframe, the Cashfree JS SDK, a
 * Supabase auth call and the analytics beacons. Exits 1 on any violation.
 *
 * Point --base at a server started with the policy you want to test
 * (CSP_MODE=enforce is the default). Chrome is resolved from CHROME_PATH or
 * puppeteer's own download.
 */

const args = process.argv.slice(2);
const argVal = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const BASE = argVal('--base', 'http://localhost:3000').replace(/\/$/, '');
const BROWSER = args.includes('--browser');

const { buildCspDirectives } = require('../lib/security-headers');

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; return true; }
  fail++; failures.push(msg); console.log('  FAIL ' + msg); return false;
}

const PAGES = [
  '/', '/pricing', '/resources', '/doctor-visibility-score', '/about', '/help-center',
  '/contact', '/privacy', '/terms', '/pages/auth.html', '/pages/reset-password.html',
  '/pages/checkout.html', '/pages/checkout-subscription.html', '/pages/agency-signup.html',
  '/pages/report-credit-checkout.html', '/pages/redeem-report.html', '/pages/preview-report.html',
  '/pages/audit-history.html', '/dashboard.html', '/admin/login.html', '/?embed=1',
  '/this-page-does-not-exist',
];
const ASSETS = ['/js/layout.js', '/assets/fonts/dm-sans-latin.woff2', '/site.webmanifest', '/sitemap.xml', '/robots.txt', '/api/client-config'];

async function get(path) {
  const res = await fetch(BASE + path, { redirect: 'manual' });
  const text = (res.headers.get('content-type') || '').match(/text|json|xml|javascript/) ? await res.text() : '';
  return { status: res.status, headers: res.headers, text };
}

async function articleUrls() {
  const { text } = await get('/resources');
  const hrefs = [...text.matchAll(/href="(\/resources\/[a-z0-9-]+)"/g)].map(m => m[1]);
  const uniq = [...new Set(hrefs)];
  // one bundled-image article + the first two others (usually CMS posts)
  const picks = [];
  if (uniq.includes('/resources/ai-visibility-for-doctors')) picks.push('/resources/ai-visibility-for-doctors');
  for (const h of uniq) { if (picks.length >= 3) break; if (!picks.includes(h)) picks.push(h); }
  return picks;
}

async function checkHeaders() {
  console.log(`\n[1] Response headers @ ${BASE}`);
  const articles = await articleUrls();
  ok(articles.length > 0, 'resources listing links to at least one article');
  const all = [...PAGES, ...articles, ...ASSETS];
  let cspSeen = null;
  for (const p of all) {
    const r = await get(p);
    const h = r.headers;
    const csp = h.get('content-security-policy') || h.get('content-security-policy-report-only');
    ok(csp, `${p}: CSP header present`);
    if (csp && !cspSeen) cspSeen = csp;
    ok(h.get('x-content-type-options') === 'nosniff', `${p}: X-Content-Type-Options nosniff`);
    ok(h.get('x-frame-options') === 'SAMEORIGIN', `${p}: X-Frame-Options SAMEORIGIN`);
    ok(h.get('referrer-policy') === 'strict-origin-when-cross-origin', `${p}: Referrer-Policy`);
    ok((h.get('permissions-policy') || '').includes('camera=()'), `${p}: Permissions-Policy`);
    ok(!h.get('x-powered-by'), `${p}: no X-Powered-By`);
    if (p.endsWith('.html') || PAGES.includes(p) || articles.includes(p)) {
      if (r.text && r.status === 200) {
        ok(!/fonts\.googleapis\.com\/css/.test(r.text), `${p}: no render-blocking Google Fonts stylesheet`);
        ok(/\/assets\/fonts\/dm-sans-latin\.woff2/.test(r.text), `${p}: self-hosted DM Sans wired in`);
      }
    }
    if (p.endsWith('.woff2')) {
      ok((h.get('content-type') || '').startsWith('font/woff2'), `${p}: font/woff2 content-type`);
      ok(/immutable/.test(h.get('cache-control') || ''), `${p}: immutable cache-control`);
    }
    if (p.endsWith('.js')) ok(/javascript/.test(h.get('content-type') || ''), `${p}: javascript content-type (nosniff-safe)`);
    if (p.endsWith('.webmanifest')) ok(/manifest\+json/.test(h.get('content-type') || ''), `${p}: manifest content-type`);
  }
  if (cspSeen) {
    console.log('  CSP: ' + cspSeen.slice(0, 160) + '…');
    const d = buildCspDirectives();
    ok(cspSeen.includes("frame-ancestors 'self'"), 'CSP has frame-ancestors');
    ok(cspSeen.includes("object-src 'none'"), 'CSP has object-src none');
    ok(cspSeen.includes("base-uri 'self'"), 'CSP has base-uri');
    ok(!/script-src[^;]*\s\*(\s|;|$)/.test(cspSeen), 'script-src has no bare * wildcard');
    ok(!/'unsafe-eval'/.test(cspSeen), "CSP does not use 'unsafe-eval'");
    // Every third-party host the pages reference must be allow-listed.
    const need = {
      'script-src': ['https://www.googletagmanager.com', 'https://cdn.jsdelivr.net', 'https://checkout.razorpay.com', 'https://sdk.cashfree.com', 'https://aeomirror.onrender.com'],
      'frame-src':  ['https://*.razorpay.com', 'https://*.cashfree.com'],
      'connect-src': ['https://*.google-analytics.com', 'https://*.razorpay.com', 'https://*.cashfree.com', 'https://aeomirror.onrender.com'],
    };
    for (const [dir, hosts] of Object.entries(need)) for (const host of hosts) ok(d[dir].includes(host), `CSP ${dir} allows ${host}`);
    ok(d['connect-src'].some(v => /supabase\.co$/.test(v)), 'CSP connect-src allows the Supabase project');
  }
  return articles;
}

async function checkBrowser(articles) {
  console.log('\n[2] Headless Chrome CSP sweep');
  let puppeteer;
  try { puppeteer = require('puppeteer'); } catch (e) { console.log('  puppeteer not installed - skipping browser sweep'); return; }
  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
  const browser = await puppeteer.launch(launchOpts);
  const violations = [];
  async function visit(path, extra) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.evaluateOnNewDocument(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', e => {
        window.__csp.push({ d: e.effectiveDirective, b: e.blockedURI, s: e.sourceFile, l: e.lineNumber, disp: e.disposition });
      });
    });
    const consoleErrs = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });
    page.on('pageerror', e => consoleErrs.push('pageerror: ' + String(e.message || e).slice(0, 160)));
    try {
      await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch (e) { consoleErrs.push('goto: ' + e.message.slice(0, 120)); }
    if (extra) { try { await extra(page); } catch (e) { consoleErrs.push('extra: ' + e.message.slice(0, 120)); } }
    await new Promise(r => setTimeout(r, 2500));
    const v = await page.evaluate(() => window.__csp || []).catch(() => []);
    for (const x of v) violations.push({ path, ...x });
    const cspConsole = consoleErrs.filter(t => /Content Security Policy|Refused to/.test(t));
    for (const t of cspConsole) violations.push({ path, d: 'console', b: t });
    console.log(`  ${path.padEnd(42)} violations=${v.length + cspConsole.length} consoleErrors=${consoleErrs.length}`);
    for (const t of consoleErrs.filter(t => !cspConsole.includes(t)).slice(0, 3)) console.log('      (non-CSP console) ' + t);
    await page.close();
  }

  for (const p of [...PAGES, ...articles]) await visit(p);

  // Razorpay: real checkout.js + real checkout iframe (bogus order -> error inside the iframe, which is fine).
  await visit('/pages/checkout.html', async page => {
    await page.evaluate(() => new Promise(resolve => {
      const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = () => { try { new window.Razorpay({ key: 'rzp_test_csp_probe', amount: 100, currency: 'INR', order_id: 'order_cspprobe', name: 'CSP probe' }).open(); } catch (e) {} resolve(); };
      s.onerror = () => resolve(); document.head.appendChild(s);
    }));
    await new Promise(r => setTimeout(r, 4000));
    const frames = page.frames().map(f => f.url()).filter(u => /razorpay/.test(u));
    ok(frames.length > 0, 'Razorpay checkout iframe loaded under the CSP (' + frames.length + ' frame(s))');
  });

  // Cashfree: real SDK + modal attempt (bogus session).
  await visit('/pages/checkout.html', async page => {
    await page.evaluate(() => new Promise(resolve => {
      const s = document.createElement('script'); s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js';
      s.onload = () => { try { window.Cashfree({ mode: 'sandbox' }).checkout({ paymentSessionId: 'session_cspprobe', redirectTarget: '_modal' }).catch(() => {}); } catch (e) {} setTimeout(resolve, 3000); };
      s.onerror = () => resolve(); document.head.appendChild(s);
    }));
    const loaded = await page.evaluate(() => typeof window.Cashfree === 'function');
    ok(loaded, 'Cashfree SDK script loaded under the CSP');
  });

  // Supabase: a real auth call from the auth page (connect-src).
  await visit('/pages/auth.html', async page => {
    const r = await page.evaluate(async () => {
      const cfg = await (await fetch('/api/client-config')).json();
      const res = await fetch(cfg.supabaseUrl + '/auth/v1/settings', { headers: { apikey: cfg.supabaseAnonKey } });
      return res.status;
    });
    ok(r > 0 && r < 500, 'Supabase auth endpoint reachable under the CSP (status ' + r + ')');
  });

  await browser.close();
  const real = violations.filter(v => v.disp !== 'report');
  ok(violations.length === 0, `no CSP violations in the sweep (${violations.length} found)`);
  if (violations.length) {
    console.log('\n  Violations:');
    for (const v of violations) console.log(`   ${v.path}  ${v.d}  blocked=${v.b}  ${v.s ? v.s + ':' + v.l : ''}`);
  }
  return real;
}

(async () => {
  const articles = await checkHeaders();
  if (BROWSER) await checkBrowser(articles);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
