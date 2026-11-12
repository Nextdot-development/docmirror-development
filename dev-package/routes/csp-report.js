'use strict';

/**
 * POST /api/csp-report
 *
 * Receives Content-Security-Policy violation reports from browsers (the
 * `report-uri` in lib/security-headers.js) and writes a compact one-line
 * summary per report to the function log, where Vercel's log viewer picks it
 * up. Nothing is stored. The body is capped at 16 KB by the parser registered
 * in server.js, and at most 5 reports per request are logged so a noisy client
 * cannot flood the logs.
 *
 * Browsers send either the legacy `{ "csp-report": {...} }` object
 * (application/csp-report) or the Reporting API array (application/reports+json).
 */

const MAX_PER_REQUEST = 5;
const MAX_FIELD = 200;

function clip(v) {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, MAX_FIELD);
}

function normalize(body) {
  if (!body) return [];
  if (Array.isArray(body)) {
    return body.map(r => (r && r.body) || r).filter(Boolean);
  }
  if (body['csp-report']) return [body['csp-report']];
  if (typeof body === 'object') return [body];
  return [];
}

module.exports = function cspReportHandler(req, res) {
  try {
    const reports = normalize(req.body).slice(0, MAX_PER_REQUEST);
    for (const r of reports) {
      const directive = r['violated-directive'] || r.effectiveDirective || r['effective-directive'] || '';
      const blocked   = r['blocked-uri']        || r.blockedURL        || '';
      const doc       = r['document-uri']       || r.documentURL       || '';
      const source    = r['source-file']        || r.sourceFile        || '';
      const line      = r['line-number']        || r.lineNumber        || '';
      console.warn(`[csp] ${clip(directive)} blocked=${clip(blocked)} page=${clip(doc)}` +
                   (source ? ` src=${clip(source)}:${clip(line)}` : ''));
    }
  } catch (e) {
    console.warn(`[csp] unreadable report: ${e.message}`);
  }
  res.status(204).end();
};
