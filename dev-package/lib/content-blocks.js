'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Markdown → structured blocks

   A one-way, best-effort mirror of content_md as a JSONB block array
   (heading/paragraph/list/blockquote/code/hr/table/image), built from the
   same `marked` lexer the renderer already depends on.

   NOT authoritative and NEVER rendered from: content_md stays the one thing
   routes/resources.js and lib/blog-post-mapper.js turn into HTML. This exists
   only so a structured representation is available to anything that wants
   blocks instead of Markdown — rewriting the editor and the renderer around
   it is a separate, much larger change this does not make.

   Any parse failure returns null rather than throwing, so a save can never
   fail because this derived column could not be built.
   ────────────────────────────────────────────────────────────────────────── */

const { marked } = require('marked');

function inlineText(tokenOrTokens) {
  if (tokenOrTokens == null) return '';
  if (typeof tokenOrTokens === 'string') return tokenOrTokens;
  if (Array.isArray(tokenOrTokens)) return tokenOrTokens.map(inlineText).join('');
  if (tokenOrTokens.tokens) return inlineText(tokenOrTokens.tokens);
  return String(tokenOrTokens.text || '');
}

function listItemBlocks(item) {
  return { text: inlineText(item.tokens || item.text) };
}

function tableCellText(cell) {
  return inlineText(cell.tokens || cell.text);
}

function tokenToBlock(token) {
  switch (token.type) {
    case 'heading':
      return { type: 'h' + Math.min(Math.max(token.depth || 1, 1), 6), text: inlineText(token.tokens || token.text) };

    case 'paragraph': {
      // A paragraph that is just one image (the common Markdown image idiom)
      // becomes an image block, not a paragraph wrapping one.
      const inline = token.tokens || [];
      if (inline.length === 1 && inline[0].type === 'image') {
        return { type: 'image', src: inline[0].href || '', alt: inline[0].text || '' };
      }
      return { type: 'p', text: inlineText(token.tokens || token.text) };
    }

    case 'list':
      return {
        type: token.ordered ? 'ol' : 'ul',
        items: (token.items || []).map(listItemBlocks),
      };

    case 'blockquote':
      return { type: 'blockquote', text: inlineText(token.tokens || token.text) };

    case 'code':
      return { type: 'code', lang: token.lang || '', text: token.text || '' };

    case 'hr':
      return { type: 'hr' };

    case 'table':
      return {
        type: 'table',
        header: (token.header || []).map(tableCellText),
        rows: (token.rows || []).map((row) => row.map(tableCellText)),
      };

    default:
      return null;              // 'space' and anything else carries no content
  }
}

/** Markdown string -> block array, or null if it could not be parsed. */
function markdownToBlocks(md) {
  const text = String(md || '').trim();
  if (!text) return [];
  try {
    const tokens = marked.lexer(text);
    const blocks = [];
    for (const t of tokens) {
      const b = tokenToBlock(t);
      if (b) blocks.push(b);
    }
    return blocks;
  } catch (err) {
    console.warn('[content-blocks] markdownToBlocks failed:', err.message);
    return null;
  }
}

module.exports = { markdownToBlocks };
