'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Strips the "Internal Links" editorial planning section (a heading followed
// by a Target page | Anchor text used | Reason table, written by whatever
// produces these articles) from raw post content. This is a NOTE FOR EDITORS,
// never meant to render — the real internal links already live inline in the
// article body as normal markdown links ([anchor](/resources/...)) and this
// function never touches those; it only ever removes a HEADING that says
// exactly "Internal Links" and everything after it.
//
// Matches both forms, anchored to the start of a line so a stray "#" or
// "<h2>" inside ordinary body prose can never trigger this by accident:
//   - Markdown heading, any level: "## Internal Links" (optional closing ##'s)
//   - Raw HTML heading, any level: "<h2>Internal Links</h2>" (content can
//     carry raw HTML passthrough — see routes/admin/posts.js's sanitiseMarkdown)
//
// Removes from that heading to the END of the content, plus any blank lines
// immediately before it — unconditionally. This runs on every post on every
// read (and on save), so "whatever follows this heading" is never rendered,
// not just today's known table shape.
// ─────────────────────────────────────────────────────────────────────────────

const HEADING_RE = /^[ \t]*(?:#{1,6}[ \t]*Internal Links[ \t]*#{0,6}|<h[1-6][^>]*>\s*Internal Links\s*<\/h[1-6]>)[ \t]*$/im;

function stripInternalLinks(content) {
  if (!content) return content;
  const str = String(content);
  const m = HEADING_RE.exec(str);
  if (!m) return content;
  return str.slice(0, m.index).replace(/[ \t]*\n+$/, '');
}

module.exports = { stripInternalLinks };
