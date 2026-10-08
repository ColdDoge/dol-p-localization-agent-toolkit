/*
 * Shared structural-token grammar.
 *
 * The inventory (producer) and the guards (V3 + tiered protection) must agree
 * on what counts as an unbreakable structural token. When they disagree, a
 * legal translation is reported as a change *and* a real change can slip
 * through; worse, the disagreement here was driven by the character *next to*
 * a token, which a translation is expected to rewrite.
 *
 * Everything in this module is deliberately language independent:
 *
 *   - identifier boundaries are decided by Unicode identifier characters, so
 *     `foo_bar` is one identifier no matter what precedes it. A rule such as
 *     "`_bar` is a variable when the preceding character is not `\w`" is
 *     ASCII-only and flips its answer once `foo` becomes `漢`.
 *   - macros, strings and HTML tags are scanned with a quote-aware state
 *     machine instead of a `[\s\S]*?` regex, so a `>>` inside a string literal
 *     no longer truncates a macro (which used to spill JS into translatable
 *     text) and a `<` `>` inside an attribute value no longer truncates a tag.
 *
 * Pure string helpers only: no I/O, no globals, no story knowledge.
 */

/** Characters that continue an identifier (Unicode letters/digits, `_`, `$`). */
const ID_CHAR_RE = /[\p{L}\p{N}_$]/u;

/** True when `ch` is an identifier character in any script. */
export function isIdentifierChar(ch) {
  return ch !== undefined && ch !== '' && ID_CHAR_RE.test(ch);
}

/**
 * Source fragment of a SugarCube variable / dotted-indexed access:
 * `$name`, `_name`, `$a.b`, `_a[0].c`. Scanning uses {@link collectVariables},
 * which additionally requires a non-identifier left boundary.
 */
export const VAR_SOURCE = String.raw`[$_][A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*|\[[^\]\n]*\])*`;

/**
 * Variable scanner. The lookbehind is Unicode-aware on purpose: `full_name`
 * and `漢_name` must both read as "an identifier that merely contains an
 * underscore", never as "an identifier followed by a `_name` variable".
 */
export const VAR_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_$])${VAR_SOURCE}`, 'gu');

/** All variables in `text`, whitespace-folded, in order. */
export function collectVariables(text) {
  VAR_RE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = VAR_RE.exec(String(text == null ? '' : text))) !== null) {
    out.push(m[0].replace(/\s+/g, ''));
  }
  return out;
}

/** Fold a quoted span to its delimiters, so only structure remains. */
export function stripQuotedText(text) {
  return String(text == null ? '' : text).replace(/"([^"]*)"/g, '""').replace(/'([^']*)'/g, "''");
}

/**
 * `${ … }` template holes, whitespace-folded and quote-stripped.
 *
 * Escape-aware: an *escaped* hole (`\${ … }`, produced when a JS template
 * string is escaped for a translation) is literal text, not an interpolation,
 * so it must not be counted as a structure change.
 */
export function collectTemplateHoles(text) {
  const s = String(text == null ? '' : text);
  const out = [];
  let i = 0;
  while (i < s.length - 1) {
    if (s[i] === '$' && s[i + 1] === '{') {
      let backslashes = 0;
      for (let k = i - 1; k >= 0 && s[k] === '\\'; k -= 1) backslashes += 1;
      if (backslashes % 2 === 0) {
        const close = s.indexOf('}', i + 2);
        if (close > 0) {
          out.push(stripQuotedText(s.slice(i, close + 1)).replace(/\s+/g, ''));
          i = close + 1;
          continue;
        }
      }
    }
    i += 1;
  }
  return out;
}

/**
 * Read a JS-ish string literal starting at `i` (`"`, `'` or `` ` ``).
 * Returns `{ start, end, quote, innerStart, innerEnd }` or null when `i` is
 * not a quote or the literal never closes. Escapes are honoured; the caller
 * decides what to do with them.
 */
export function readStringLiteral(text, i) {
  const q = text[i];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') { j += 2; continue; }
    if (c === q) {
      return { start: i, end: j + 1, quote: q, innerStart: i + 1, innerEnd: j };
    }
    j += 1;
  }
  return null;
}

/**
 * End index (exclusive) of the `<< ... >>` macro starting at `i`, or -1 when
 * the body never closes. `>>` inside a string literal does not close the
 * macro; an unterminated string makes the scan fail so the caller can fall
 * back to the naive first-`>>` rule instead of swallowing the whole passage.
 *
 * A single quote is only a string delimiter in *value position* (after an
 * operator, bracket, comma…). SugarCube markup is prose full of apostrophes
 * (`[[Say that you're busy|Target]]`), and treating every `'` as a quote made
 * the scanner swallow whole passages while hunting for the closing quote.
 */
export function scanMacroEnd(text, i) {
  let j = i + 2;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'" || c === '`') {
      if (c !== "'" || !isApostrophe(text, j)) {
        let k = j + 1;
        let closed = false;
        while (k < text.length) {
          if (text[k] === '\\') { k += 2; continue; }
          if (text[k] === c) { closed = true; k += 1; break; }
          k += 1;
        }
        if (!closed) return -1;
        j = k;
        continue;
      }
    }
    // Link markup inside a macro body may itself contain macros
    // (`<<link [[Compliment <<him>>|Target]]>>`). The `>>` of the inner macro
    // must not close the outer one, so skip the whole `[[ … ]]` span. A `[[`
    // with no closing `]]` is left to the normal scan so an unbalanced source
    // still falls back to the naive close instead of swallowing the passage.
    if (c === '[' && text[j + 1] === '[') {
      const close = text.indexOf(']]', j + 2);
      if (close >= 0) { j = close + 2; continue; }
    }
    if (c === '>' && text[j + 1] === '>') return j + 2;
    j += 1;
  }
  return -1;
}

const WORD_CHAR_RE = /[A-Za-z0-9_$]/;

/**
 * True when the `'` at `q` is an apostrophe inside a word (`you're`, `don't`)
 * rather than a string delimiter. SugarCube markup is prose full of
 * apostrophes, and treating every `'` as a quote made the scanner hunt for a
 * closing quote far away and swallow whole passages.
 */
export function isApostrophe(text, q) {
  return WORD_CHAR_RE.test(text[q - 1] || '') && WORD_CHAR_RE.test(text[q + 1] || '');
}

/** End index (exclusive) of the HTML tag starting at `i`, or -1. */
export function scanTagEnd(text, i) {
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '"' || c === "'") {
      const lit = readStringLiteral(text, j);
      if (!lit) return -1;
      j = lit.end;
      continue;
    }
    if (c === '>') return j + 1;
    j += 1;
  }
  return -1;
}

const URL_LIKE_RE = /^(?:https?:\/\/|\/\/)[^\s]+$/i;
const BARE_HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,})(?:[/?#][^\s]*)?$/i;

/**
 * True when `text` is really a URL / link target rather than display text:
 * `https://…`, `//host/…`, `example.org/wiki/Home_Page`,
 * `gitgud.io/Andrest07/…`, `discord.gg/abc`.
 */
export function isUrlLike(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s || /\s/.test(s)) return false;
  if (URL_LIKE_RE.test(s)) return true;
  // A bare host, optionally with a path. Require at least one dot so that a
  // single-word label ("Help", "Continue") is never mistaken for a host.
  return BARE_HOST_RE.test(s);
}

const IDENTIFIER_LABEL_RE = /[$_.[\]{}()]/;

/**
 * True when a quoted macro argument is a *structural* string rather than a
 * label: `$var`, `_var.path`, `$list[idx]`, `_outfitEditorFilter.type.normal`.
 * Single-word UI labels ("Help", "Enter", "Fast") and labels with spaces
 * ("Support the Project", "Export/Settings") stay translatable.
 */
export function isStructuralLabel(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return true;
  if (/\s/.test(s)) return false;
  return IDENTIFIER_LABEL_RE.test(s);
}

/**
 * Prose test for *labels* (link labels, macro label arguments). Labels are
 * known display positions, so a short word ("No", "Yes", "Buy", "Pay",
 * "Yes (0:05)") is text a translator should see. Identifier shapes, URLs and
 * paths are still rejected by {@link isStructuralLabel} / {@link isUrlLike}
 * before this is consulted; `hasLatinWord` only asks "is there anything to
 * translate at all".
 */
export function hasLatinWord(text, min = 2) {
  return new RegExp(`[A-Za-z]{${min},}`).test(String(text == null ? '' : text));
}

/** True when `text` is a translatable label: prose-ish, not a name or a URL. */
export function isTranslatableLabelText(text) {
  const s = String(text == null ? '' : text);
  if (isUrlLike(s)) return false;
  if (isStructuralLabel(s)) return false;
  return hasLatinWord(s);
}

/**
 * Stricter test for a *bare string argument* in a macro body (no display key,
 * no embedded markup). Such a literal is much more likely to be data than
 * prose, so require a fuller sentence signal: a sentence ending, three or more
 * words, or a capitalised phrase. "silver fox", "dark blue" and "input change"
 * stay out; "Genital sensitivity", "Keep it away with your cheeks" and
 * "P-please, Sydney," are kept.
 */
export function looksLikeDisplayArgument(inner) {
  const t = String(inner == null ? '' : inner).trim();
  if (!looksLikeProseText(t)) return false;
  if (/[.!?…]["')\]]*$/.test(t)) return true;
  if (t.split(/\s+/).filter(Boolean).length >= 3) return true;
  return /^[0-9£$]?[A-Z]/.test(t);
}

const LINK_MARKUP_RE = /\[\[([\s\S]*?)\]\]/g;

/**
 * Link markup inside an arbitrary range (a macro body is not a separate
 * element, so `[[Label|Target]]` inside `<<link …>>` would otherwise never be
 * seen). Returns `{ start, end, text }` for the *label* span of every link
 * that has a separate target. A link whose label doubles as its target is
 * skipped: the game looks that string up, so it must not be translated.
 */
export function collectLinkLabels(text, from = 0, to = text.length) {
  const out = [];
  LINK_MARKUP_RE.lastIndex = from;
  let m;
  while ((m = LINK_MARKUP_RE.exec(text)) !== null) {
    if (m.index >= to) break;
    if (m.index + m[0].length > to) break;
    const inner = m[1];
    // Skip JS array-of-arrays literals, which look like link markup.
    if (/\],\s*\[/.test(inner)) continue;
    let label = inner;
    const pipe = inner.indexOf('|');
    if (pipe >= 0) label = inner.slice(0, pipe);
    else if (inner.includes('->')) label = inner.slice(0, inner.indexOf('->'));
    else if (inner.includes('<-')) label = inner.slice(inner.indexOf('<-') + 2);
    else {
      const bracket = inner.indexOf('][');
      if (bracket >= 0) label = inner.slice(0, bracket);
      else continue; // target doubles as display; cannot localize safely
    }
    const start = m.index + 2;
    // A label may itself be a quoted/template literal (`[[\`Show <<him>>\`|X]]`).
    // Then the delimiters are syntax and only the inner text is displayed.
    const lit = readStringLiteral(label, 0);
    if (lit && lit.end === label.length && label.length >= 2) {
      out.push({ start: start + lit.innerStart, end: start + lit.innerEnd, text: label.slice(lit.innerStart, lit.innerEnd), quote: lit.quote });
    } else {
      out.push({ start, end: start + label.length, text: label, quote: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Enclosing-context safety
//
// A translatable span is not free-floating: it sits inside a JavaScript string
// literal, a quoted macro argument, or link markup. What is harmless in one
// context destroys the code in another — a `"` inside `"...<unit>..."` closes
// the JS string, a `|` inside `[[<unit>|Target]]` moves the link target.
//
// Two mechanisms, chosen by what the surrounding syntax can absorb:
//
//   javascript string literals  → ESCAPE the translation (`"` → `\"`), so a
//                                 translator may use ordinary ASCII quotes,
//                                 backslashes, newlines, backticks and `${`
//   SugarCube macro arguments,  → REJECT a delimiter the translation
//   link labels                   introduces (SugarCube has no escape syntax
//                                 we can rely on)
//
// Neither mechanism bans ordinary Chinese punctuation: full-width quotes and
// brackets are always free.
// ---------------------------------------------------------------------------

/** `context` → the delimiter that encloses the unit's span in the source. */
export const JS_STRING_CONTEXTS = new Map([
  ['js-double', '"'],
  ['js-single', "'"],
  ['js-template', '`'],
]);

/** `context` → the delimiter of the quoted macro argument that holds the unit. */
export const MACRO_ARG_CONTEXTS = new Map([
  ['arg-double', '"'],
  ['arg-single', "'"],
]);

/** Context label for a link label, i.e. the text inside `[[ … |Target]]`. */
export const LINK_LABEL_CONTEXT = 'link';

/** Context of a code string extracted from a JS literal with this delimiter. */
export function jsStringContext(quote) {
  if (quote === '"') return 'js-double';
  if (quote === "'") return 'js-single';
  if (quote === '`') return 'js-template';
  return null;
}

/** Context of a label taken from a quoted macro argument. */
export function macroArgContext(quote) {
  if (quote === '"') return 'arg-double';
  if (quote === "'") return 'arg-single';
  return null;
}

/**
 * Make `text` safe to place inside the unit's enclosing context by escaping
 * what the surrounding syntax would otherwise interpret.
 *
 * Only JavaScript string literals are escapable; for macro arguments and link
 * labels the guard is {@link contextDelimiterFindings} instead.
 */
export function escapeForContext(context, text) {
  const quote = JS_STRING_CONTEXTS.get(context);
  if (!quote) return String(text == null ? '' : text);
  const isTemplate = quote === '`';
  let out = '';
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') { out += '\\\\'; continue; }
    if (c === quote) { out += `\\${c}`; continue; }
    // `\$` is an identity escape in every JavaScript string flavour, so `${`
    // stays literal text in a plain string too — and the guard no longer reads
    // it as a template interpolation the translation "added".
    if (c === '$' && s[i + 1] === '{') { out += '\\$'; continue; }
    if (!isTemplate && c === '\n') { out += '\\n'; continue; }
    if (!isTemplate && c === '\r') { out += '\\r'; continue; }
    out += c;
  }
  return out;
}

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

/**
 * Findings for delimiters a translation must not introduce in its enclosing
 * context. Returns `{ code, detail }` records (empty when the translation adds
 * nothing dangerous). Sequences already present in the source are exempt:
 * only *new* structure breaks the code.
 */
export function contextDelimiterFindings(context, fromRaw, toRaw, quote = null) {
  const from = String(fromRaw == null ? '' : fromRaw);
  const to = String(toRaw == null ? '' : toRaw);
  const introduced = (needle) => countOf(to, needle) > countOf(from, needle);

  if (context == null) {
    // Free text has no delimiter to escape, but an odd number of backticks in
    // SugarCube markup opens a template literal that swallows what follows.
    const ticks = countOf(to, '`');
    if (ticks % 2 === 1) {
      return [{
        code: 'TEXT_BACKTICK_UNBALANCED',
        detail: 'translation introduces an unpaired "`" into passage markup',
      }];
    }
    return [];
  }

  if (JS_STRING_CONTEXTS.has(context)) return []; // escaping handles this

  if (MACRO_ARG_CONTEXTS.has(context)) {
    const delim = MACRO_ARG_CONTEXTS.get(context);
    if (introduced(delim)) {
      return [{
        code: 'MACRO_ARG_DELIMITER_INSERTED',
        detail: `translation introduces ${JSON.stringify(delim)} inside a ${delim}-quoted macro argument; use full-width quotes instead`,
      }];
    }
    if (introduced('>>')) {
      return [{ code: 'MACRO_ARG_DELIMITER_INSERTED', detail: 'translation introduces ">>" inside a macro argument' }];
    }
    return [];
  }

  if (context === LINK_LABEL_CONTEXT) {
    for (const needle of ['|', ']]', '->', '<-', '][', '`']) {
      if (introduced(needle)) {
        return [{
          code: 'LINK_LABEL_DELIMITER_INSERTED',
          detail: `translation introduces ${JSON.stringify(needle)} inside a link label`,
        }];
      }
    }
  }
  return [];
}

/**
 * Object property keys whose string value is player-facing prose assembled by
 * the story itself. DoL builds almost every "assembled message" this way
 * (`{ start, joiner, end, color }` lists and `{ sentence, dialogueID }`
 * dialogue rows). Keys, internal values, identifiers and code are never
 * exported — only these values, and only when they read as prose.
 */
/**
 * Keys whose string value the story assembles into a player-facing message
 * (`{ start, joiner, end }` lists, `{ sentence, dialogueID }` rows).
 */
export const DISPLAY_STRING_KEYS = new Set([
  'sentence', 'start', 'end', 'name', 'lockedmessage', 'description',
  'desc', 'desc1', 'desc2', 'text', 'label', 'title', 'message', 'hint',
  'name_cap', 'journal', 'journalname', 'pretext', 'posttext', 'caption', 'note',
  'warning', 'error',
]);

/** Tokens that make a following string literal a decision, not a message. */
const DISCRIMINATOR_TOKENS = new Set([
  'case', 'is', 'isnot', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'and', 'or',
  'not', 'in', 'typeof', 'instanceof', '===', '!==', '==', '!=', '<=', '>=', '<', '>',
]);

/** Calls whose string arguments name something rather than show something. */
const NON_DISPLAY_CALLS = new Set([
  'includes', 'startswith', 'endswith', 'indexof', 'lastindexof', 'search',
  'match', 'matchall', 'test', 'split', 'replace', 'replaceall', 'localecompare',
  'charat', 'slice', 'substring', 'getelementbyid', 'getelementsbyclassname',
  'queryselector', 'queryselectorall', 'getattribute', 'setattribute',
  'addeventlistener', 'createelement', 'parseint', 'parsefloat', 'json',
]);

/**
 * True when a string's inner text reads as prose a player could see, rather
 * than a key, identifier, path or enum value. Deliberately conservative:
 * anything that is a single token without sentence punctuation stays out.
 */
export function looksLikeProseText(inner) {
  const t = String(inner == null ? '' : inner).trim();
  if (!t) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  if (!/\s/.test(t) && (/[/\\]/.test(t) || /^[A-Za-z_$][\w$]*(\.[\w$]+)+$/.test(t))) return false; // path / dotted identifier
  if (/^</.test(t) && !/>/.test(t)) return false; // a tag fragment, not display text
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  if (words.length === 0) return false;
  // CSS class lists and identifier runs (" sewmap-block sewmap-room",
  // "lighting position-absolute z-hidden", "collar with leash") read as prose
  // to a naive word count but are data the game matches on.
  const lowerish = words.every((w) => /^[a-z0-9][a-z0-9_-]*$/.test(w));
  if (lowerish && words.length >= 3) return false;
  if (lowerish && words.some((w) => /[-_]/.test(w))) return false;
  if (words.length >= 2) return true;
  // A single word counts only as a finished sentence ("Locked.", "Yes!").
  // A trailing ":" is plumbing (`aspect-ratio:`), not prose.
  return /[.!?…]["')\]]*$/.test(t) && /[A-Za-z]{2,}/.test(t);
}

/**
 * Collect string / template literals inside a code region that are shown to
 * the player. The scan is a small lexer, not a regex over the whole region: it
 * walks the region skipping comments and string literals, so a `start:` inside
 * a comment or inside another string is never a candidate.
 *
 * A literal is skipped when
 *   - it is an object *key* (immediately followed by `:`), or
 *   - it is the right-hand side of a decision (`case "x"`, `is "x"`,
 *     `=== "x"`, `.includes("x")`), or
 *   - it does not read as prose (`looksLikeProseText`).
 * Each hit carries enough context for the caller to apply its own export
 * policy: `key` (the object key, or null), `hasMarkup` (HTML tag or embedded
 * `<<macro>>` — a rendered template rather than a bare name) and `hasEscape`.
 * Returns `{ key, valueStart, valueEnd, innerStart, innerEnd, hasMarkup,
 * hasEscape }` in order.
 */
export function extractDisplayStrings(text, from = 0, to = text.length) {
  const out = [];
  let i = from;
  /** Last significant token: { type: 'word'|'call'|'op'|'value'|'key', text }. */
  let prev = { type: 'op', text: '(start)' };
  while (i < to) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 || nl > to ? to : nl + 1;
      prev = { type: 'op', text: ';' };
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 || close > to ? to : close + 2;
      prev = { type: 'op', text: ';' };
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      if (c === "'" && isApostrophe(text, i)) { prev = { type: 'op', text: "'" }; i += 1; continue; }
      const lit = readStringLiteral(text, i);
      if (!lit || lit.end > to) { i += 1; prev = { type: 'op', text: '?' }; continue; }
      const after = skipSpace(text, lit.end, to);
      const isKey = text[after] === ':' && (prev.type === 'op'
        && (prev.text === '{' || prev.text === ',' || prev.text === '(' || prev.text === ';' || prev.text === '(start)'));
      if (isKey) {
        prev = { type: 'key', text: text.slice(lit.innerStart, lit.innerEnd) };
        i = lit.end;
        continue;
      }
      const key = prev.type === 'key' ? prev.text.toLowerCase() : null;
      const excluded = (prev.type === 'word' || prev.type === 'op') && DISCRIMINATOR_TOKENS.has(prev.text)
        || prev.type === 'call' && NON_DISPLAY_CALLS.has(prev.text);
      const inner = text.slice(lit.innerStart, lit.innerEnd);
      if (!excluded && looksLikeProseText(inner)) {
        out.push({
          key,
          valueStart: lit.start,
          valueEnd: lit.end,
          innerStart: lit.innerStart,
          innerEnd: lit.innerEnd,
          inner,
          quote: lit.quote,
          hasMarkup: /<{2}|<[A-Za-z/]/.test(inner),
          hasEscape: /\\/.test(inner),
        });
      }
      prev = { type: 'value', text: '__str__' };
      i = lit.end;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < to && /[A-Za-z0-9_$]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      let k = skipSpace(text, j, to);
      const isCall = text[k] === '(';
      prev = { type: isCall ? 'call' : 'word', text: word.toLowerCase() };
      i = j;
      continue;
    }
    if (/\s/.test(c)) { i += 1; continue; }
    const two = text.slice(i, i + 3);
    let op = c;
    for (const cand of ['===', '!==', '==', '!=', '<=', '>=', '=>', '&&', '||', '?.']) {
      if (two.startsWith(cand)) { op = cand; break; }
    }
    prev = op === ':' && (prev.type === 'word' || prev.type === 'key')
      ? { type: 'key', text: prev.text }
      : { type: 'op', text: op };
    i += op.length;
  }
  return out;
}

function skipSpace(text, i, to) {
  let j = i;
  while (j < to && /\s/.test(text[j])) j += 1;
  return j;
}
