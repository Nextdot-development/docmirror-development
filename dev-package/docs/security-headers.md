# Security headers and Content-Security-Policy

Every response from the Express app (`dev-package/server.js`) carries the
headers set in `lib/security-headers.js`. This note records what is sent, why
each third-party origin is allowed, the deliberate trade-offs, and how to
loosen or tighten the policy without a code change.

## Headers sent

| Header | Value | Purpose |
| --- | --- | --- |
| `Content-Security-Policy` | see below | Limits where scripts, frames, connections, fonts and images may come from; blocks framing by other sites, `<base>` hijacking and plugins. |
| `X-Content-Type-Options` | `nosniff` | Browsers must honour the declared MIME type (no sniffing a text file into a script). |
| `X-Frame-Options` | `SAMEORIGIN` | Legacy clickjacking protection for browsers that ignore `frame-ancestors`. The homepage is framed by the pricing modal (`/?embed=1`), which is same-origin. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Full URL kept for same-origin navigation, origin only for cross-origin, nothing on HTTPS to HTTP. Same as the browser default, now explicit. |
| `Permissions-Policy` | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), usb=(), interest-cohort=(), browsing-topics=()` | Turns off sensors and media capture the site never uses, and opts out of FLoC/Topics. `payment`, `clipboard-write` and `fullscreen` are intentionally **not** listed so their defaults (same-origin, plus iframes that ask with `allow=`) keep the Razorpay/Cashfree iframes and the copy buttons working. |
| `X-Powered-By` | removed | No longer advertises Express (`app.disable('x-powered-by')`). The `Server: Vercel` header is added by the platform and cannot be removed from app code. |

`Strict-Transport-Security` is already added by Vercel for the custom domains
(`max-age=63072000`) and is left to the platform.

## The policy

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'self';
script-src 'self' 'unsafe-inline'
           https://www.googletagmanager.com https://cdn.jsdelivr.net
           https://checkout.razorpay.com https://*.razorpay.com
           https://sdk.cashfree.com https://*.cashfree.com
           https://aeomirror.onrender.com;
style-src  'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src   'self' data: https://fonts.gstatic.com;
img-src    'self' data: blob: https:;
connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co
           https://*.google-analytics.com https://*.analytics.google.com
           https://*.googletagmanager.com https://*.g.doubleclick.net
           https://*.google.com https://*.google.co.in
           https://*.razorpay.com https://*.cashfree.com
           https://aeomirror.onrender.com;
frame-src  'self' https://*.razorpay.com https://*.cashfree.com;
worker-src 'self' blob:;
manifest-src 'self';
media-src  'self' data: blob:;
report-uri /api/csp-report
```

`<project>.supabase.co` is read from `NEXT_PUBLIC_SUPABASE_URL` (fallback
`SUPABASE_URL`) at cold start; if neither is set the policy falls back to
`https://*.supabase.co wss://*.supabase.co`.

### Why each origin is there

| Origin | Directive(s) | Used by |
| --- | --- | --- |
| `*.supabase.co` (+ `wss:`) | connect | supabase-js on auth, dashboard, admin and checkout pages (auth, REST, storage uploads). |
| `cdn.jsdelivr.net` | script | `@supabase/supabase-js@2` UMD bundle and `chart.js@4` on the dashboard and admin pages. |
| `www.googletagmanager.com` | script, connect | `gtag.js` (GA4 property `G-QS7ZLTTZLF`) on every public page. |
| `*.google-analytics.com`, `*.analytics.google.com`, `*.g.doubleclick.net`, `*.google.com`, `*.google.co.in` | connect | GA4 collection beacons, including regional and Google-signals endpoints. Images from these hosts are covered by `img-src https:`. |
| `checkout.razorpay.com`, `*.razorpay.com` | script, frame, connect | Razorpay Checkout: `checkout.js` is loaded by the page, opens an iframe on `api.razorpay.com`, and reports to `lumberjack.razorpay.com`. |
| `sdk.cashfree.com`, `*.cashfree.com` | script, frame, connect | Cashfree JS SDK v3; the `_modal` checkout opens an iframe on a `*.cashfree.com` host. |
| `aeomirror.onrender.com` | script, connect | The AEO Mirror tracker (`/t/tracker.js`, beacons to `/t/collect`). |
| `fonts.googleapis.com`, `fonts.gstatic.com` | style, font | Fonts are now self-hosted under `/assets/fonts/` (see below), so public pages no longer request these. They stay allow-listed as a safety net for anything not yet migrated (for example the PDF report template rendered server-side). |
| `https:` | img | CMS cover images live on Supabase storage, Google place photos and analytics pixels come from Google; a host list would break the next CMS image host. Scripts and frames are still restricted. |
| `data:`, `blob:` | img, font, worker, media | Inline SVG data URIs, image previews in the admin media uploader (`URL.createObjectURL`), PDF/blob downloads. |

### Deliberate trade-offs

- **`'unsafe-inline'` in `script-src` and `style-src`.** The public site is
  static HTML with 46 inline `<script>` blocks, 88 inline `on*=` handlers and
  roughly 400 `style=""` attributes across 25 pages (plus the server-rendered
  Resources pages). A nonce or hash policy needs those moved into external
  files or nonced blocks page by page; that is a separate refactor. With
  `'unsafe-inline'` present, the policy does **not** stop an injected inline
  script, but it still blocks loading scripts from any origin not listed
  above, blocks framing by other sites, `<base>` tag injection, plugins, and
  `fetch`/XHR/WebSocket exfiltration to unknown hosts. `'unsafe-eval'` is not
  used anywhere.
- **No `form-action`.** The pages submit forms with JavaScript (`fetch`), but
  the payment SDKs may post or redirect to their own hosts during a checkout
  and Chrome also applies `form-action` to redirects after a submission.
  Restricting it was not worth the risk to a live payment flow.
- **No `upgrade-insecure-requests`.** Production is HTTPS-only with HSTS
  already; adding it would break plain-HTTP local development.
- **`Cross-Origin-Opener-Policy` not set.** It can detach the popup windows
  Razorpay opens for some bank/UPI flows and the OAuth round trip.

## Switching modes without a deploy of new code

`CSP_MODE` is read once at cold start (set it in Vercel project environment
variables, then redeploy):

| `CSP_MODE` | Effect |
| --- | --- |
| unset / `enforce` | `Content-Security-Policy` is sent (default). |
| `report-only` | The same policy is sent as `Content-Security-Policy-Report-Only`: nothing is blocked, violations are still reported. Use this to soak a policy change. |
| `off` | No CSP header at all. The other headers stay. |

## Violation reports

Browsers POST violations to `/api/csp-report` (`routes/csp-report.js`), which
logs one line per report to the function log and stores nothing:

```
[csp] script-src blocked=https://example.net/x.js page=https://thedocmirror.com/pricing src=…:12
```

Search the Vercel function logs for `[csp]` after a deploy. An empty result
after a few days of real traffic is the signal that a directive can be
tightened further. At most 5 reports per request are logged and the body is
capped at 16 KB.

## Fonts

DM Sans (variable, 400 to 700) and DM Mono (400, 500) are served from
`/assets/fonts/` with the exact woff2 files, weights, `unicode-range` subsets
and `font-display: swap` that Google Fonts served. Each page inlines the
`@font-face` rules and preloads `dm-sans-latin.woff2`, so there is no longer a
render-blocking cross-origin stylesheet in front of the first paint. The
files are served with `Cache-Control: public, max-age=31536000, immutable`;
if a font file ever needs to change, give it a new file name.

## Checking

```
npm run verify-security -- --base http://localhost:3000            # headers only
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npm run verify-security -- --base http://localhost:3000 --browser  # + headless CSP sweep
```

The browser sweep loads every public page with the policy enforced, records
`securitypolicyviolation` events, then loads the real Razorpay checkout
iframe, the real Cashfree SDK and makes a real Supabase auth request. It exits
non-zero on any violation.
