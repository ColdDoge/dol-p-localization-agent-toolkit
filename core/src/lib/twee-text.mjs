/*
 * Heuristic extraction of *candidate player-visible text* out of SugarCube
 * passage markup. This is deliberately conservative and explainable rather
 * than clever: every item records which syntactic construct produced it, so a
 * human can check the classification instead of trusting a bare word list.
 *
 * Kinds produced:
 *   passage_text  - literal prose between macros/links/HTML tags
 *   link_text     - display label of [[ ... ]] markup
 *   macro_label   - first string argument of a display macro (<<link "x">> ...)
 *
 * Nothing here is a translation. It only classifies sources.
 */

// Macros whose first quoted argument is shown to the player.
const LABEL_MACROS = new Set([
  'link',
  'linkappend',
  'linkprepend',
  'linkreplace',
  'button',
  'cycle',
  'listbox',
  'option',
  'textbox',
  'checkbox',
  'radiobutton',
  'note',
  'tooltip',
]);

// Macros whose body is code/expressions, never literal display text.
const CODE_MACROS = new Set([
  'set',
  'if',
  'elseif',
  'else',
  'for',
  'while',
  'print',
  '=',
  'script',
  'widget',
  'init',
  'capture',
  'run',
  'audio',
  'goto',
  'display',
  'include',
  'endif',
  'endfor',
  'endwhile',
  'endscript',
  'endcapture',
  'endwidget',
]);

function stripHtmlTags(text) {
  return text.replace(/<\/?[A-Za-z][^>]*>/g, ' ');
}

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Remove SugarCube/JS interpolations so only literal prose remains. */
function stripExpressions(text) {
  return text
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/[$_][A-Za-z][A-Za-z0-9_$.]*/g, ' ')
    .replace(/\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$.]*/g, ' ');
}

export function looksLikeEnglish(text) {
  if (!/[A-Za-z]{3,}/.test(text)) return false;
  if (/[A-Za-z]{2,}[ \t][A-Za-z]{2,}/.test(text)) return true;
  return /\b[A-Za-z]{4,}\b/.test(text);
}

export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function extractLinkText(inner) {
  // [[display|target]] / [[display->target]] / [[target<-display]]
  // [[target]] (target doubles as the display) / [[display][setter]]
  let display = inner;
  const pipe = inner.indexOf('|');
  if (pipe >= 0) display = inner.slice(0, pipe);
  else if (inner.includes('->')) display = inner.slice(0, inner.indexOf('->'));
  else if (inner.includes('<-')) display = inner.slice(inner.indexOf('<-') + 2);
  else {
    const bracket = inner.indexOf('][');
    if (bracket >= 0) display = inner.slice(0, bracket);
  }
  return display;
}

/**
 * Extract candidate display items from one passage's decoded content.
 * Returns [{ kind, text }] in document order (duplicates preserved).
 */
export function extractPassageItems(content) {
  const items = [];
  const working = stripComments(content);

  let last = 0;
  const macroRe = /<<([\s\S]*?)>>/g;
  let m;

  const handlePlain = (segment) => {
    // Links first: their labels are display text, their targets are not.
    let s = segment;
    const linkRe = /\[\[([\s\S]*?)\]\]/g;
    let l;
    let cursor = 0;
    while ((l = linkRe.exec(s)) !== null) {
      const before = s.slice(cursor, l.index);
      const text = normalizeWhitespace(stripExpressions(stripHtmlTags(before)));
      if (text) items.push({ kind: 'passage_text', text });
      const label = normalizeWhitespace(stripHtmlTags(extractLinkText(l[1])));
      if (label) items.push({ kind: 'link_text', text: label });
      cursor = linkRe.lastIndex;
    }
    const rest = normalizeWhitespace(stripExpressions(stripHtmlTags(s.slice(cursor))));
    if (rest) items.push({ kind: 'passage_text', text: rest });
  };

  while ((m = macroRe.exec(working)) !== null) {
    handlePlain(working.slice(last, m.index));
    last = macroRe.lastIndex;

    const body = m[1].trim();
    const name = (body.split(/[\s(]/)[0] || '').toLowerCase();
    if (LABEL_MACROS.has(name)) {
      const q = /^\s*["']([^"']+)["']/.exec(body);
      if (q) {
        const text = normalizeWhitespace(q[1]);
        if (text) items.push({ kind: 'macro_label', text });
      }
    } else if (!CODE_MACROS.has(name) && /["'`]/.test(body)) {
      // Unknown macro that still carries a quoted literal: record it, flagged.
      const q = /["']([^"']{2,})["']/.exec(body);
      if (q) items.push({ kind: 'macro_unknown', text: normalizeWhitespace(q[1]) });
    }
  }
  handlePlain(working.slice(last));
  return items;
}

/**
 * Split a JS source file into string-literal candidates (rough, fast).
 * Escapes and nested templates are intentionally not modeled; this is a
 * candidate generator for human review, not a parser.
 */
export function extractJsStringLiterals(source) {
  const out = [];
  const re = /'([^'\\\n]{3,200})'|"([^"\\\n]{3,200})"|`([^`]{3,200})`/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const raw = m[1] || m[2] || m[3] || '';
    const text = normalizeWhitespace(raw);
    if (!text) continue;
    if (/^(?:[\w./@-]+)$/.test(text)) continue; // identifier / path / key
    if (/^[a-z][\w]*$/i.test(text)) continue; // single word, likely a key
    out.push(text);
  }
  return out;
}
