/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — SEO title + meta description score

   Deterministic and rule-based: the same input always gives the same score,
   and every point is traceable to one rule with a stated reason. No model is
   involved in SCORING — a model may only propose rewrites (routes/admin/seo.js),
   and every proposal is re-scored here and dropped unless it passes.

   One file, two runtimes. The server requires it (routes/admin/seo.js, the
   verify script); the editor loads the very same file at /admin/seo-score.js,
   so the live score in the browser and the server's judgement cannot drift.

   The focus keyword is never guessed. With no keyword, the keyword rules are
   reported as skipped and the score is taken over the remaining rules.
   ────────────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeoScore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TITLE_RANGE = [50, 60];
  var DESC_RANGE = [120, 160];
  var EARLY_CHARS = 30;

  var STOP = ['a', 'an', 'and', 'or', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'by', 'at', 'from',
    'is', 'are', 'your', 'you', 'how', 'what', 'why', 'this', 'that', 'it', 'its', 'as', 'be', 'can'];

  // Words that lift click-through without being clickbait. A digit also counts.
  var POWER_WORDS = ['guide', 'complete', 'ultimate', 'essential', 'proven', 'simple', 'easy', 'quick',
    'fast', 'best', 'top', 'free', 'step-by-step', 'step by step', 'checklist', 'tips', 'ways', 'mistakes',
    'explained', 'how to', 'why', 'vs', 'boost', 'increase', 'improve', 'grow', 'get', 'avoid', 'fix',
    'save', 'rank', 'win', 'faster', 'better', 'practical', 'what you need to know'];

  // Imperative verbs that ask for the click.
  var CTA_VERBS = ['learn', 'discover', 'find', 'get', 'see', 'explore', 'read', 'check', 'compare',
    'fix', 'boost', 'improve', 'book', 'download', 'start', 'understand', 'know', 'protect', 'avoid',
    'grow', 'increase', 'build', 'create', 'try', 'follow', 'use', 'rank', 'win', 'stop'];

  var BOILERPLATE_RE = /^(this (article|post|blog|page|guide)|in this (article|post|blog|guide)|welcome to|click here|read (this|more)|here (is|are)|lorem ipsum|description\b|meta description)/i;
  var PASSIVE_RE = /\b(is|are|was|were|be|been|being)\s+\w+ed\s+by\b/i;

  // ── text helpers ────────────────────────────────────────────────────────

  function len(s) { return Array.from(String(s || '')).length; }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function hasPhrase(text, phrase) {
    var p = norm(phrase);
    if (!p) return false;
    return (' ' + norm(text) + ' ').indexOf(' ' + p + ' ') !== -1;
  }

  function countPhrase(text, phrase) {
    var p = norm(phrase);
    if (!p) return 0;
    var hay = ' ' + norm(text) + ' ';
    var needle = ' ' + p + ' ';
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length - 1; }
    return n;
  }

  /** Keyword begins within the first ~30 characters. */
  function keywordEarly(text, kw) {
    return hasPhrase(Array.from(String(text)).slice(0, EARLY_CHARS + len(kw)).join(''), kw);
  }

  function separators(s) {
    return (String(s).match(/\||·|–|—|:|\s-\s/g) || []).length;
  }

  function shouting(s) {
    var letters = String(s).replace(/[^A-Za-z]/g, '');
    if (letters.length >= 8 && letters === letters.toUpperCase()) return true;
    return (String(s).match(/\b[A-Z]{5,}\b/g) || []).length > 0;
  }

  function hasWordFrom(text, list) {
    var t = ' ' + norm(text) + ' ';
    for (var i = 0; i < list.length; i++) {
      if (t.indexOf(' ' + norm(list[i]) + ' ') !== -1) return list[i];
    }
    return null;
  }

  function significantWords(s) {
    return norm(s).split(' ').filter(function (w) { return w.length >= 4 && STOP.indexOf(w) === -1; });
  }

  function band(score) {
    if (score >= 80) return { key: 'good', label: 'Good' };
    if (score >= 50) return { key: 'warn', label: 'Needs work' };
    return { key: 'poor', label: 'Poor' };
  }

  function equalsAny(text, list) {
    var n = norm(text);
    if (!n) return false;
    return (list || []).some(function (x) { return norm(x) === n; });
  }

  function finish(rules, length, range) {
    var earned = 0, max = 0;
    rules.forEach(function (r) {
      if (r.skipped) return;
      earned += r.points; max += r.max;
    });
    var score = max ? Math.round((earned / max) * 100) : 0;
    return {
      score: score,
      band: band(score),
      length: length,
      range: range,
      rules: rules,
      keywordMissing: rules.some(function (r) { return r.skipped; }),
    };
  }

  // ── SEO title ───────────────────────────────────────────────────────────

  /**
   * ctx: { focusKeyword, h1, otherTitles: [] }
   *   h1           the article's own title (printed as its H1)
   *   otherTitles  SEO titles of every other page on the site
   */
  function scoreTitle(text, ctx) {
    ctx = ctx || {};
    var t = String(text || '').trim();
    var kw = String(ctx.focusKeyword || '').trim();
    var n = len(t);
    var rules = [];

    var lenPts = (n >= 50 && n <= 60) ? 30
      : ((n >= 40 && n <= 49) || (n >= 61 && n <= 65)) ? 20
      : ((n >= 30 && n <= 39) || (n >= 66 && n <= 70)) ? 10 : 0;
    rules.push({
      id: 'length', label: 'Length 50–60 characters', max: 30, points: lenPts, passed: lenPts === 30,
      problem: !t ? 'The SEO title is empty.' : 'The SEO title is ' + n + ' characters.',
      why: n > 60
        ? 'Google truncates the title at about 600px (~60 characters) and adds "…", so the end of yours is cut off. Aim for 50–60.'
        : 'Google shows about 60 characters; a title under ~50 wastes space that could carry the keyword or a benefit. Aim for 50–60.',
    });

    if (!kw) {
      rules.push({ id: 'keyword', label: 'Focus keyword present', max: 25, points: 0, passed: false, skipped: true,
        problem: 'No focus keyword set.', why: 'Add a focus keyword to score keyword rules.' });
      rules.push({ id: 'keyword_early', label: 'Keyword in the first ~30 characters', max: 15, points: 0, passed: false, skipped: true,
        problem: 'No focus keyword set.', why: 'Add a focus keyword to score keyword rules.' });
    } else {
      var present = hasPhrase(t, kw);
      rules.push({
        id: 'keyword', label: 'Focus keyword present', max: 25, points: present ? 25 : 0, passed: present,
        problem: 'The title does not contain the focus keyword "' + kw + '".',
        why: 'The query the page targets must appear in the title — it is the strongest on-page relevance signal.',
      });
      var early = present && keywordEarly(t, kw);
      rules.push({
        id: 'keyword_early', label: 'Keyword in the first ~30 characters', max: 15,
        points: early ? 15 : (present ? 5 : 0), passed: early,
        problem: present ? 'The focus keyword appears after the first 30 characters.' : 'The focus keyword is missing, so it cannot appear early.',
        why: 'Earlier words weigh more and survive truncation on narrow screens.',
      });
    }

    var dupOther = equalsAny(t, ctx.otherTitles);
    var dupH1 = !!ctx.h1 && norm(t) === norm(ctx.h1);
    var unique = !!t && !dupOther && !dupH1;
    rules.push({
      id: 'unique', label: 'Unique (not another page\'s title, not a copy of the H1)', max: 10,
      points: unique ? 10 : 0, passed: unique,
      problem: dupOther ? 'Another page already uses this exact SEO title.'
        : dupH1 ? 'The SEO title is a verbatim copy of the article\'s H1.' : 'The SEO title is empty.',
      why: 'Duplicate titles compete with each other and dilute both pages. The SEO title should be written for the results page, not copied from the heading.',
    });

    var power = /\d/.test(t) ? 'a number' : hasWordFrom(t, POWER_WORDS);
    rules.push({
      id: 'ctr', label: 'A number, power word or clear benefit', max: 10, points: power ? 10 : 0, passed: !!power,
      problem: 'The title has no number, power word or stated benefit.',
      why: 'A concrete number or benefit ("Guide", "5 Ways", "Fix", "Step-by-Step") improves click-through rate — without resorting to clickbait.',
    });

    var stuffed = kw ? countPhrase(t, kw) >= 3 : false;
    var caps = shouting(t);
    var seps = separators(t);
    var clean = !!t && !stuffed && !caps && seps <= 1;
    rules.push({
      id: 'hygiene', label: 'No stuffing, no ALL-CAPS, at most one separator', max: 10, points: clean ? 10 : 0, passed: clean,
      problem: stuffed ? 'The focus keyword is repeated 3 or more times.'
        : caps ? 'The title is written in ALL-CAPS.'
        : seps > 1 ? 'The title uses ' + seps + ' separators (| : – —).' : 'The SEO title is empty.',
      why: 'Keyword stuffing and shouting lower click-through and can be flagged as spam; more than one separator reads as a keyword list.',
    });

    return finish(rules, n, TITLE_RANGE);
  }

  // ── meta description ────────────────────────────────────────────────────

  /**
   * ctx: { focusKeyword, title, excerpt, otherDescriptions: [] }
   */
  function scoreDescription(text, ctx) {
    ctx = ctx || {};
    var d = String(text || '').trim();
    var kw = String(ctx.focusKeyword || '').trim();
    var n = len(d);
    var rules = [];

    var lenPts = (n >= 120 && n <= 160) ? 30
      : ((n >= 70 && n <= 119) || (n >= 161 && n <= 170)) ? 15 : 0;
    rules.push({
      id: 'length', label: 'Length 120–160 characters', max: 30, points: lenPts, passed: lenPts === 30,
      problem: !d ? 'The meta description is empty.' : 'Meta description is ' + n + ' characters.',
      why: n > 160
        ? 'Google truncates around 160 characters on desktop (~920px), so your call-to-action is cut off. Aim for 120–160.'
        : 'Google shows ~155–160 characters on desktop and ~120 on mobile; a shorter description wastes the space that earns the click. Aim for 120–160.',
    });

    if (!kw) {
      rules.push({ id: 'keyword', label: 'Focus keyword present', max: 25, points: 0, passed: false, skipped: true,
        problem: 'No focus keyword set.', why: 'Add a focus keyword to score keyword rules.' });
    } else {
      var present = hasPhrase(d, kw);
      rules.push({
        id: 'keyword', label: 'Focus keyword present', max: 25, points: present ? 25 : 0, passed: present,
        problem: 'The description does not contain the focus keyword "' + kw + '".',
        why: 'Google bolds the words that match the search in the snippet, which lifts click-through.',
      });
    }

    var cta = hasWordFrom(d, CTA_VERBS);
    rules.push({
      id: 'cta', label: 'Value proposition / call-to-action', max: 20, points: cta ? 20 : 0, passed: !!cta,
      problem: 'There is no call-to-action verb ("Learn how…", "Get…", "Discover…").',
      why: 'The description\'s only job is to earn the click — say what the reader gets and invite them to get it.',
    });

    var boiler = BOILERPLATE_RE.test(d);
    var passive = PASSIVE_RE.test(d);
    var topicWords = significantWords((ctx.title || '') + ' ' + (ctx.excerpt || '') + ' ' + kw);
    var onTopic = !topicWords.length || significantWords(d).some(function (w) { return topicWords.indexOf(w) !== -1; });
    var specific = !!d && !boiler && !passive && onTopic;
    rules.push({
      id: 'specific', label: 'Specific and in active voice', max: 15, points: specific ? 15 : 0, passed: specific,
      problem: boiler ? 'The description opens with boilerplate ("This article…", "Welcome to…").'
        : passive ? 'The description uses passive voice ("…is explained by…").'
        : !onTopic ? 'The description shares no words with the title or excerpt — it does not describe this page.'
        : 'The meta description is empty.',
      why: 'Generic descriptions are rewritten by Google and lower click-through. Describe THIS page, actively.',
    });

    var unique = !!d && !equalsAny(d, ctx.otherDescriptions);
    rules.push({
      id: 'unique', label: 'Unique across pages', max: 10, points: unique ? 10 : 0, passed: unique,
      problem: d ? 'Another page already uses this exact meta description.' : 'The meta description is empty.',
      why: 'Google drops duplicate descriptions and writes its own snippet instead.',
    });

    return finish(rules, n, DESC_RANGE);
  }

  // ── deterministic rewrite options ───────────────────────────────────────

  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function lcFirst(s) {
    s = String(s || '');
    // Leave acronyms and proper-looking words ("Google", "AI") alone.
    if (/^[A-Z]{2,}/.test(s) || /^[A-Z][a-z]+[A-Z]/.test(s)) return s;
    if (/^(Google|ChatGPT|Gemini|Perplexity|Bing|India)\b/.test(s)) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function titleCase(s) {
    return String(s).split(/\s+/).map(function (w, i) {
      if (/[A-Z]/.test(w)) return w;                       // keep author casing / acronyms
      if (i > 0 && STOP.indexOf(w.toLowerCase()) !== -1) return w.toLowerCase();
      return cap(w);
    }).join(' ');
  }

  /** The keyword as the page itself writes it, or null when the page never does. */
  function displayKeyword(kw, sources) {
    var p = norm(kw);
    var re = new RegExp('(^|[^\\p{L}\\p{N}])(' + kw.trim().split(/\s+/).map(function (w) {
      return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('[^\\p{L}\\p{N}]+') + ')(?=$|[^\\p{L}\\p{N}])', 'iu');
    for (var i = 0; i < sources.length; i++) {
      var m = String(sources[i] || '').match(re);
      if (m && norm(m[2]) === p) return m[2];
    }
    return null;
  }

  function stripTrailing(s) {
    var out = String(s).replace(/[\s,;:–—|\-·]+$/, '').trim();
    var words = out.split(/\s+/);
    while (words.length > 1 && STOP.indexOf(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '')) !== -1) words.pop();
    return words.join(' ').replace(/[\s,;:–—|\-·]+$/, '');
  }

  /** Cuts to `max` on a word boundary, never mid-word. */
  function trimTo(s, max) {
    s = String(s).trim();
    if (len(s) <= max) return s;
    var cut = Array.from(s).slice(0, max + 1).join('');
    var sp = cut.lastIndexOf(' ');
    return stripTrailing(sp > 0 ? cut.slice(0, sp) : cut.slice(0, max));
  }

  function firstClause(s) {
    var c = String(s || '').split(/(?<=[.!?;])\s|\s[—–]\s|:\s/)[0] || '';
    return c.replace(/[.!?;]+$/, '').trim();
  }

  function removePhrase(text, kw) {
    if (!kw) return String(text || '');
    var words = kw.trim().split(/\s+/).map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var re = new RegExp(words.join('[^\\p{L}\\p{N}]+'), 'giu');
    return String(text || '').replace(re, ' ').replace(/\s{2,}/g, ' ').trim()
      .replace(/^[\s,;:–—|\-·]+/, '').replace(/^(for|of|and|the|in|to|with)\s+/i, '');
  }

  function uniq(list) {
    var seen = {};
    return list.filter(function (s) {
      var k = norm(s);
      if (!k || seen[k]) return false;
      seen[k] = true; return true;
    });
  }

  function allPassed(result) {
    return result.rules.every(function (r) { return r.skipped || r.passed; });
  }

  function packOption(text, result, source) {
    return {
      text: text,
      length: result.length,
      score: result.score,
      source: source || 'template',
      rules: result.rules.filter(function (r) { return !r.skipped; })
        .map(function (r) { return { id: r.id, label: r.label, passed: r.passed }; }),
    };
  }

  /** Re-scores candidates and keeps only those that pass every applicable rule. */
  function filterPassing(candidates, scorer, ctx, source, limit) {
    var out = [];
    uniq(candidates).forEach(function (c) {
      if (out.length >= (limit || 3)) return;
      var r = scorer(c, ctx);
      if (allPassed(r)) out.push(packOption(c, r, source));
    });
    return out;
  }

  /**
   * ctx: { title, excerpt, focusKeyword, h1, otherTitles, year }
   * Front-loads the keyword, adds a benefit from the page's own title/excerpt,
   * fits to 50–60 on a word boundary.
   */
  function titleCandidates(ctx) {
    var year = String(ctx.year || new Date().getFullYear());
    var kwRaw = String(ctx.focusKeyword || '').trim();
    var title = String(ctx.title || '').trim();
    var kw = kwRaw ? (displayKeyword(kwRaw, [title, ctx.excerpt]) || titleCase(kwRaw)) : '';
    if (kw && !/[A-Z]/.test(kw.charAt(0))) kw = titleCase(kw);
    var rest = stripTrailing(titleCase(removePhrase(title, kwRaw)));
    var benefit = stripTrailing(titleCase(firstClause(removePhrase(ctx.excerpt, kwRaw))));
    var head = kw || title;

    // [text, mayTakeFiller] — the page-derived bases may be padded; the generic
    // ones are already complete phrases and must not have words bolted on.
    var bases = [];
    var words3 = function (x) { return x.split(' ').length >= 3; };   // "India" alone is not a benefit
    if (kw && words3(rest)) bases.push([kw + ': ' + rest, true]);
    if (kw && words3(benefit)) bases.push([kw + ': ' + benefit, true]);
    [
      ': What You Need to Know in ' + year,
      ': A Practical Step-by-Step Guide',
      ': The Complete ' + year + ' Guide',
      ': Proven Steps to Get Better Results',
      ': A Practical Guide to Getting It Right',
      ': What It Is and How to Get Started',
      ': The Complete Step-by-Step Guide for ' + year,
      ': Proven Steps to Get Better Results in ' + year,
      // shorter tails, for a long keyword that leaves little room
      ': Common Mistakes to Avoid',
      ': A Practical ' + year + ' Guide',
      ': What to Know in ' + year,
      ': Step-by-Step Guide',
      ': How to Get Started',
      ': Tips That Work',
    ].forEach(function (tail) { bases.push([head + tail, false]); });
    if (kw && words3(rest)) bases.push([kw + ' Guide: ' + rest, true]);
    if (!kw && title) bases.push([title, true]);

    var fillers = ['', ' (' + year + ' Guide)', ' in ' + year, ' Explained'];
    var whole = [], cut = [];
    bases.forEach(function (pair) {
      var b = pair[0];
      var trimmed = trimTo(b, 60);
      var wasCut = trimmed !== b.trim();
      if (wasCut && !pair[1]) return;            // a generic phrase cut short is nonsense
      (pair[1] ? fillers : ['']).forEach(function (f) {
        if (f.indexOf(year) !== -1 && trimmed.indexOf(year) !== -1) return;   // never "2026 … 2026"
        var c = len(trimmed) < 50 ? trimmed + f : trimmed;
        if (len(c) >= 50 && len(c) <= 60) (wasCut ? cut : whole).push(c);
      });
    });
    // A title cut mid-phrase reads worse than a complete one, so complete ones go first.
    return whole.concat(cut);
  }

  function suggestTitles(ctx, limit) {
    return filterPassing(titleCandidates(ctx), scoreTitle, ctx, 'template', limit || 3);
  }

  /**
   * ctx: { title, excerpt, focusKeyword, otherDescriptions }
   * Keyword + the excerpt's own benefit + a CTA verb, fitted to 120–160.
   */
  function descriptionCandidates(ctx) {
    var kwRaw = String(ctx.focusKeyword || '').trim();
    var title = String(ctx.title || '').trim();
    // Mid-sentence the keyword is written the way the page writes it, else as typed.
    var kwMid = kwRaw ? (displayKeyword(kwRaw, [ctx.excerpt, title]) || kwRaw) : '';
    var excerpt = String(ctx.excerpt || '').replace(/\s+/g, ' ').trim() || title;
    var excerptHasKw = kwRaw && hasPhrase(excerpt, kwRaw);
    var topic = kwMid || lcFirst(title);

    // Each template takes the (possibly shortened) excerpt and returns a sentence.
    var templates = [
      function (e) { return 'Learn about ' + topic + ': ' + lcFirst(e) + '.'; },
      function (e) { return cap(e) + '. Learn what to do about ' + topic + ' next.'; },
      function (e) { return 'Discover ' + topic + ' — ' + lcFirst(e) + '.'; },
      function (e) { return 'Get clear answers on ' + topic + ': ' + lcFirst(e) + '.'; },
    ];
    if (excerptHasKw) templates.unshift(function (e) { return cap(e) + '. Learn what to do next.'; });

    var tails = ['', ' Read the full guide.', ' See what to do next.', ' Get practical steps you can use today.',
      ' Get practical steps you can use today and see what to fix first.'];

    // Shortened excerpts to try, best first: whole sentences, then word cuts.
    var sentences = excerpt.match(/[^.!?]+[.!?]*/g) || [excerpt];
    var pieces = [];
    for (var s = sentences.length; s >= 1; s--) {
      pieces.push(sentences.slice(0, s).join('').trim().replace(/[.!?]+$/, ''));
    }
    var words = sentences[0].replace(/[.!?]+$/, '').trim().split(' ');
    for (var k = words.length - 1; k >= 4; k--) pieces.push(stripTrailing(words.slice(0, k).join(' ')));

    var whole = [], cut = [];
    templates.forEach(function (tpl) {
      for (var i = 0; i < pieces.length; i++) {
        var base = tpl(pieces[i]);
        if (len(base) > 160) continue;
        var hit = null;
        for (var t = 0; t < tails.length && !hit; t++) {
          var c = base + tails[t];
          if (len(c) >= 120 && len(c) <= 160) hit = c;
        }
        if (hit) { (i < sentences.length ? whole : cut).push(hit); break; }
      }
    });
    return whole.concat(cut);
  }

  function suggestDescriptions(ctx, limit) {
    return filterPassing(descriptionCandidates(ctx), scoreDescription, ctx, 'template', limit || 3);
  }

  return {
    scoreTitle: scoreTitle,
    scoreDescription: scoreDescription,
    suggestTitles: suggestTitles,
    suggestDescriptions: suggestDescriptions,
    filterPassing: filterPassing,
    band: band,
    TITLE_RANGE: TITLE_RANGE,
    DESC_RANGE: DESC_RANGE,
    // exported for tests
    _norm: norm, _hasPhrase: hasPhrase, _trimTo: trimTo,
  };
});
