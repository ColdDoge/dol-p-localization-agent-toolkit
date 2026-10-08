/*
 * Lightweight SugarCube element / span model.
 *
 * Split decoded passage content into typed elements with exact `[start, end)`
 * spans, and prove the split is *reversible* (concatenating the element texts
 * reproduces the input byte-for-byte). The reversible check is what guarantees
 * the span model can be trusted to rebuild the story exactly.
 *
 * Element kinds:
 *   comment   HTML comments and C-style block comments
 *   macro     << ... >>          (quote-aware: `>>` in a string does not close)
 *   code      <<script>> ... <</script>>  (a whole JS block, never exported)
 *   link      [[ ... ]]
 *   html      <tag ...>  </tag>  &entity;
 *   variable  $var / _var / ${expr}  (dotted / indexed access)
 *   text      everything else
 *
 * Identifier and variable boundaries come from `structure-tokens.mjs`, which
 * the V3 guard uses too. That shared grammar is why `foo_bar` is a single
 * identifier in both the source and an arbitrary target language: the old rule
 * cut `_bar` out of `foo_bar` in the inventory, but the guard's ASCII
 * lookbehind did not, so a structurally faithful translation could be rejected
 * while the half-protected `foo` remained translatable (a real break).
 */

import { scanMacroEnd, scanTagEnd, isIdentifierChar, VAR_SOURCE } from './structure-tokens.mjs';

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

/**
 * Macros whose first quoted argument is shown to the player.
 * `listbox`/`cycle`/`textbox`/`checkbox`/`radiobutton` are deliberately absent:
 * their first argument is the *variable* the control binds to
 * (`<<listbox "_crOverrides.legFrontPosition" autoselect>>`), never a label.
 */
export const LABEL_ARG_MACROS = new Set([
  'link', 'linkappend', 'linkprepend', 'linkreplace', 'button', 'note',
  'tooltip', 'option',
]);

/** Form controls: first argument is a variable name, not display text. */
export const FORM_CONTROL_MACROS = new Set([
  'listbox', 'cycle', 'textbox', 'checkbox', 'radiobutton',
]);

/** Every macro whose payload stops at the macro (block / control / label). */
export const DISPLAY_MACROS = new Set([...LABEL_ARG_MACROS, ...FORM_CONTROL_MACROS]);

/**
 * Macros whose body is SugarCube/JavaScript code rather than markup. Their
 * text is never exported wholesale; only the player-facing strings declared by
 * `DISPLAY_STRING_KEYS` are lifted out (see `inventory.mjs`).
 */
export const CODE_BODY_MACROS = new Set([
  'set', 'unset', 'capture', 'remember', 'forget', 'run', 'init',
]);

/**
 * Macros whose argument is printed to the player: `<<print EXPR>>`, `<<= EXPR>>`
 * and `<<- EXPR>>`. Every string literal in the body is shown, so the whole
 * body is a display context.
 */
export const OUTPUT_MACROS = new Set(['print', '=', '-']);

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

const ENTITY_RE = /^&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#[xX][0-9a-fA-F]+);/;
const SCRIPT_CLOSE_RE = /^<{2}\s*(?:\/\s*script|endscript)\s*>{2}/i;

function macroNameOf(raw) {
  // Stop at the first argument delimiter. `<<print[`a`,`b`][0]>>` is a real
  // DoL idiom: without `[` here the name would be derived from the *argument
  // text*, which changes under translation and confuses every macro lookup.
  return (raw.slice(2, -2).trim().split(/[\s([{]/)[0] || '').toLowerCase();
}

function classify(raw) {
  if (raw.startsWith('<!--') || raw.startsWith('/*')) return 'comment';
  if (raw.startsWith('<<')) return 'macro';
  if (raw.startsWith('[[')) return 'link';
  if (raw[0] === '&') return 'html';
  if (raw[0] === '<') return 'html';
  if (raw[0] === '$' || raw[0] === '_') return 'variable';
  return 'text';
}

/**
 * End of the `<<script>>` block whose header ends at `openEnd`, or null.
 *
 * Quote- and comment-aware: a script body may legitimately *talk about* the
 * closing marker (`const s = "<</script>>";`), and a naive search would cut
 * the block there and spill the rest of the JavaScript into translatable text.
 */
function scriptBlockEnd(content, openEnd) {
  let i = openEnd;
  while (i < content.length) {
    const c = content[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i += 1;
      while (i < content.length) {
        if (content[i] === '\\') { i += 2; continue; }
        if (content[i] === q) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === '/' && content[i + 1] === '/') {
      const nl = content.indexOf('\n', i);
      i = nl < 0 ? content.length : nl + 1;
      continue;
    }
    if (c === '/' && content[i + 1] === '*') {
      const close = content.indexOf('*/', i + 2);
      i = close < 0 ? content.length : close + 2;
      continue;
    }
    if (c === '<' && content[i + 1] === '<') {
      const m = SCRIPT_CLOSE_RE.exec(content.slice(i, i + 24));
      if (m) return { closeStart: i, closeEnd: i + m[0].length };
    }
    i += 1;
  }
  return null;
}

/** End of a `${ ... }` template hole starting at `i` (at `$`), or -1. */
function scanHoleEnd(content, i) {
  if (content[i] !== '$' || content[i + 1] !== '{') return -1;
  let depth = 1;
  let j = i + 2;
  while (j < content.length) {
    const c = content[j];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      j += 1;
      let closed = false;
      while (j < content.length) {
        if (content[j] === '\\') { j += 2; continue; }
        if (content[j] === q) { closed = true; j += 1; break; }
        j += 1;
      }
      if (!closed) return -1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  return -1;
}

/**
 * Split decoded content into typed elements with exact spans.
 * Always covers `[0, content.length)` exactly once, so `isReversible` holds by
 * construction for any input (a scanner bug shows up as a failed reversibility
 * report, never as silently dropped story text).
 */
export function tokenize(content) {
  const elements = [];
  let i = 0;
  let textStart = 0;

  const pushText = (end) => {
    if (end > textStart) {
      elements.push({ kind: 'text', start: textStart, end, text: content.slice(textStart, end) });
    }
  };
  const pushElement = (el) => { pushText(el.start); elements.push(el); textStart = el.end; };

  while (i < content.length) {
    const c = content[i];

    if (c === '<') {
      if (content.startsWith('<!--', i)) {
        const close = content.indexOf('-->', i + 4);
        const end = close < 0 ? content.length : close + 3;
        pushElement({ kind: 'comment', start: i, end, text: content.slice(i, end) });
        i = end;
        continue;
      }
      if (content.startsWith('<<', i)) {
        let fallback = false;
        let end = scanMacroEnd(content, i);
        if (end < 0) {
          const naive = content.indexOf('>>', i + 2);
          end = naive < 0 ? -1 : naive + 2;
          fallback = end > i;
        }
        if (end > i) {
          const raw = content.slice(i, end);
          const name = macroNameOf(raw);
          const isClose = /^<{2}\s*\//.test(raw);
          if (name === 'script' && !isClose) {
            const block = scriptBlockEnd(content, end);
            const blockEnd = block ? block.closeEnd : content.length;
            pushElement({
              kind: 'code',
              start: i,
              end: blockEnd,
              text: content.slice(i, blockEnd),
              name: 'script',
              bodyStart: end,
              bodyEnd: block ? block.closeStart : content.length,
              closed: Boolean(block),
            });
            i = blockEnd;
            continue;
          }
          pushElement({
            kind: 'macro',
            start: i,
            end,
            text: raw,
            name,
            isClose,
            fallback,
            bodyStart: i + 2,
            bodyEnd: end - 2,
          });
          i = end;
          continue;
        }
      }
      if (/^<\/?[A-Za-z]/.test(content.slice(i, i + 3))) {
        const end = scanTagEnd(content, i);
        if (end > i) {
          pushElement({ kind: 'html', start: i, end, text: content.slice(i, end) });
          i = end;
          continue;
        }
      }
    } else if (c === '[' && content[i + 1] === '[') {
      const close = content.indexOf(']]', i + 2);
      const end = close < 0 ? content.length : close + 2;
      pushElement({ kind: 'link', start: i, end, text: content.slice(i, end) });
      i = end;
      continue;
    } else if (c === '&') {
      const m = ENTITY_RE.exec(content.slice(i, i + 32));
      if (m) {
        const end = i + m[0].length;
        pushElement({ kind: 'html', start: i, end, text: content.slice(i, end) });
        i = end;
        continue;
      }
    } else if (c === '/' && content[i + 1] === '*') {
      const close = content.indexOf('*/', i + 2);
      const end = close < 0 ? content.length : close + 2;
      pushElement({ kind: 'comment', start: i, end, text: content.slice(i, end) });
      i = end;
      continue;
    } else if (c === '$' && content[i + 1] === '{') {
      const end = scanHoleEnd(content, i);
      if (end > i) {
        pushElement({ kind: 'variable', start: i, end, text: content.slice(i, end) });
        i = end;
        continue;
      }
    } else if ((c === '$' || c === '_') && !isIdentifierChar(content[i - 1])) {
      const re = new RegExp(VAR_SOURCE, 'y');
      re.lastIndex = i;
      const m = re.exec(content);
      if (m && m[0].length > 0) {
        const end = i + m[0].length;
        pushElement({ kind: 'variable', start: i, end, text: content.slice(i, end) });
        i = end;
        continue;
      }
    }
    i += 1;
  }
  pushText(content.length);
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
  if (el.kind !== 'macro' || !LABEL_ARG_MACROS.has(el.name)) return undefined;
  const body = el.text.slice(2, -2);
  const nameMatch = /^\s*([^\s(]+)/.exec(body);
  const nameLen = nameMatch ? nameMatch[0].length : 0;
  const q = /^\s*(?:"([^"]*)"|'([^']*)')/.exec(body.slice(nameLen));
  if (!q) return undefined;
  const label = q[1] !== undefined ? q[1] : q[2];
  const quote = q[1] !== undefined ? '"' : "'";
  const offsetInBody = nameLen + q[0].length - label.length - 1;
  const start = el.start + 2 + offsetInBody;
  return { outerStart: el.start, outerEnd: el.end, start, end: start + label.length, text: label, quote };
}

export { MACRO_CODE };
