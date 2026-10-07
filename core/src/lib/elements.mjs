/*
 * Lightweight SugarCube element / span model.
 *
 * Split decoded passage content into typed elements with exact `[start, end)`
 * spans, and prove the split is *reversible* (concatenating the element texts
 * reproduces the input byte-for-byte).
 *
 * Element kinds:
 *   comment   HTML comments and C-style block comments
 *   macro     << ... >>
 *   link      [[ ... ]]
 *   html      <tag ...>  </tag>  &entity;
 *   variable  $var / _var / ${expr}  (dotted / indexed access)
 *   text      everything else
 *
 * The reversible check is what guarantees the span model can be trusted to
 * rebuild the story exactly.
 */

const TOKEN_RE = new RegExp([
  String.raw`<!--[\s\S]*?-->`,
  String.raw`/\*[\s\S]*?\*/`,
  String.raw`<<[\s\S]*?>>`,
  String.raw`\[\[[\s\S]*?\]\]`,
  String.raw`<\/?[A-Za-z][^>]*>`,
  String.raw`&[a-zA-Z][a-zA-Z0-9]*;`,
  String.raw`&#\d+;`,
  String.raw`&#x[0-9a-fA-F]+;`,
  String.raw`\$\{[^}]*\}`,
  String.raw`[$_][A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*|\[[^\]\n]*\])*`,
].join('|'), 'g');

// Macros that end a natural-language payload (block / control-flow / code).
const FLUSH_MACROS = new Set([
  'set', 'if', 'elseif', 'else', 'for', 'while', '=', 'script',
  'widget', 'init', 'capture', 'run', 'audio', 'goto', 'display', 'include',
  'endif', 'endfor', 'endwhile', 'endscript', 'endcapture', 'endwidget',
  'switch', 'case', 'default', 'break', 'endswitch', 'once', 'endonce', 'timed',
  // display macros whose first argument is translated as its own label unit
  'link', 'linkappend', 'linkprepend', 'linkreplace', 'button', 'cycle',
  'listbox', 'option', 'textbox', 'checkbox', 'radiobutton', 'note', 'tooltip',
]);

// Macros whose first quoted argument is shown to the player.
export const DISPLAY_MACROS = new Set([
  'link', 'linkappend', 'linkprepend', 'linkreplace', 'button', 'cycle',
  'listbox', 'option', 'textbox', 'checkbox', 'radiobutton', 'note', 'tooltip',
]);

// Block-level HTML tags end a payload; inline tags stay inside as placeholders.
const BLOCK_TAGS = new Set([
  'div', 'p', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'section', 'article',
  'header', 'footer', 'form', 'select', 'option', 'textarea', 'pre', 'style',
  'script', 'center', 'fieldset', 'nav', 'aside', 'main', 'figure',
]);

export function isFlushMacro(name) { return FLUSH_MACROS.has(name); }

export function isBlockHtml(raw) {
  const m = /^<\/?([A-Za-z][A-Za-z0-9]*)/.exec(raw);
  return m ? BLOCK_TAGS.has(m[1].toLowerCase()) : false;
}

const MACRO_CODE = FLUSH_MACROS;

function classify(raw) {
  const c = raw[0];
  if (raw.startsWith('<!--') || raw.startsWith('/*')) return 'comment';
  if (raw.startsWith('<<')) return 'macro';
  if (raw.startsWith('[[')) return 'link';
  if (raw.startsWith('&')) return 'html';
  if (c === '<') return 'html';
  if (c === '$' || c === '_') return 'variable';
  return 'text';
}

/** Split decoded content into typed elements with exact spans. */
export function tokenize(content) {
  const elements = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(content)) !== null) {
    if (m.index > last) {
      elements.push({ kind: 'text', start: last, end: m.index, text: content.slice(last, m.index) });
    }
    const raw = m[0];
    const kind = classify(raw);
    const el = { kind, start: m.index, end: m.index + raw.length, text: raw };
    if (kind === 'macro') el.name = (raw.slice(2, -2).trim().split(/[\s(]/)[0] || '').toLowerCase();
    elements.push(el);
    last = m.index + raw.length;
    if (raw.length === 0) TOKEN_RE.lastIndex += 1; // guard against empty match
  }
  if (last < content.length) elements.push({ kind: 'text', start: last, end: content.length, text: content.slice(last) });
  return elements;
}

/** True iff concatenating the element texts reproduces `content` exactly. */
export function isReversible(content, elements) {
  if (elements.length === 0) return content.length === 0;
  let i = 0;
  for (const el of elements) {
    if (el.start !== i) return false;
    if (content.slice(el.start, el.end) !== el.text) return false;
    i = el.end;
  }
  return i === content.length;
}

/** Conditional / control-flow nesting depth carried at `offset`. */
export function conditionalDepth(elements) {
  const depth = new Array(elements.length + 1).fill(0);
  let d = 0;
  for (let i = 0; i < elements.length; i += 1) {
    const el = elements[i];
    if (el.kind === 'macro') {
      const n = el.name;
      if (n === 'if' || n === 'for' || n === 'switch') d += 1;
      else if (n === 'endif' || n === 'endfor' || n === 'endswitch') d = Math.max(0, d - 1);
    }
    depth[i + 1] = d;
  }
  return depth;
}

/** Display label span of a link element, or undefined when it has none. */
export function linkLabel(el) {
  if (el.kind !== 'link') return undefined;
  const inner = el.text.slice(2, -2);
  let label = inner;
  const pipe = inner.indexOf('|');
  if (pipe >= 0) label = inner.slice(0, pipe);
  else if (inner.includes('->')) label = inner.slice(0, inner.indexOf('->'));
  else if (inner.includes('<-')) label = inner.slice(inner.indexOf('<-') + 2);
  else {
    const b = inner.indexOf('][');
    if (b >= 0) label = inner.slice(0, b);
  }
  if (label === inner) return undefined; // target doubles as display; cannot localize safely
  return { outerStart: el.start, outerEnd: el.end, start: el.start + 2, end: el.start + 2 + label.length, text: label };
}

/** First quoted string argument of a display macro, or undefined. */
export function macroLabel(el) {
  if (el.kind !== 'macro' || !DISPLAY_MACROS.has(el.name)) return undefined;
  const body = el.text.slice(2, -2);
  const nameMatch = /^\s*([^\s(]+)/.exec(body);
  const nameLen = nameMatch ? nameMatch[0].length : 0;
  const q = /^\s*(?:"([^"]*)"|'([^']*)')/.exec(body.slice(nameLen));
  if (!q) return undefined;
  const label = q[1] !== undefined ? q[1] : q[2];
  const offsetInBody = nameLen + q[0].length - label.length - 1;
  const start = el.start + 2 + offsetInBody;
  return { outerStart: el.start, outerEnd: el.end, start, end: start + label.length, text: label };
}

export { MACRO_CODE };
