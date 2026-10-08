/*
 * Canonical Text Inventory.
 *
 * One unified unit model for every translatable span. Fields may be added, but
 * there is exactly one candidate format for every text family.
 *
 *   unitId sourceFile passage widget startOffset endOffset absStart absEnd
 *   rawText protectedText placeholders family visibility riskLevel kind
 *   sourceVersion baseRelation oldTranslation translation qaStatus ruleHits
 */

import {
  tokenize, isReversible, conditionalDepth, linkLabel, macroLabel,
  isFlushMacro, isBlockHtml, LABEL_ARG_MACROS, CODE_BODY_MACROS, OUTPUT_MACROS,
} from './elements.mjs';
import {
  isUrlLike, isStructuralLabel, isTranslatableLabelText, hasLatinWord,
  looksLikeProseText, looksLikeDisplayArgument, extractDisplayStrings, collectLinkLabels, DISPLAY_STRING_KEYS,
  jsStringContext, macroArgContext, LINK_LABEL_CONTEXT,
} from './structure-tokens.mjs';
import { collectIdentifierSpace } from './identifier-space.mjs';

export function looksLikeEnglish(text) {
  // "Is there anything to translate here?" — deliberately just the presence of
  // Latin words, with a two-letter floor. The old length heuristic dropped
  // legitimate short text ("Go", "No", "Yes", "Buy", "Opt.", "fur", "You ")
  // while adding no code safety: what keeps code out of the kit is the element
  // model (structure becomes placeholders), the enclosing-context rules and the
  // residual-structure check, not a word-length test.
  return /[A-Za-z]{2,}/.test(String(text == null ? '' : text));
}

export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Structure left in the *payload* (what a translator sees) means the region
 * could not be parsed into protected tokens: a macro/tag/link/variable that
 * failed to tokenize is sitting in translatable text, where a translation
 * could silently destroy it. Such a literal is recorded as a pending issue
 * instead of being exported as plain text.
 */
const RESIDUAL_STRUCTURE_RE = /<{2}|>{2}|\[\[|\]\]|<[A-Za-z/]|(?<![\p{L}\p{N}_$])[$_][A-Za-z_]/u;

/** Macros whose body is a decision, not a message. */
const CONTROL_BODY_MACROS = new Set([
  'if', 'elseif', 'else', 'unless', 'case', 'switch', 'while', 'for',
  'default', 'break', 'return', 'continue',
]);

/** Macros whose quoted argument names something the game looks up. */
const IDENT_ARG_MACROS = new Set([
  'goto', 'display', 'include', 'widget', 'npc', 'npcappend', 'npcselect',
  'npcincr', 'unset', 'pass', 'image', 'audio', 'addinlineevent', 'storeon',
  'earnfeat', 'wearprop', 'add_link',
]);

/** Characters that mark a literal as code/plumbing rather than prose. */
const CODEISH_LITERAL_RE = /[=[\]{}<>+]/;

/**
 * A literal that *starts* with a variable, a CSS selector or an id is code
 * (`$estate.x gte 10`, `.wardrobe-action a`, `_x`). The same characters inside
 * a sentence are placeholders: "The _creatureType slowly approaches …" is display
 * text whose variables the unit machinery protects.
 */
const CODE_START_RE = /^\s*[$_.#"']/;

/**
 * CSS/SVG function values (`hue-rotate(30deg) saturate(0.2)`, `rgb(1,2,3)`).
 * Parentheses alone are *not* a code signal — "Compact (24-Hour)",
 * "Hands (gloves)" and "… requirements for the engine (ES2020)" are display text.
 */
const CSS_FUNCTION_RE = /\b[a-z-]+\([^)]*(?:deg|px|em|rem|%|rgba?|hsla?|url|calc)\b/i;

/**
 * "Compact (24-Hour)", "Beech Street (Shopping centre)", "Try to talk to them
 * (0:20)": a label with a parenthetical. Parentheses are allowed only in this
 * shape, so an expression like `(V.x.includes("y") ? "a" : "b")` stays out.
 */
const PAREN_LABEL_RE = /^[-+0-9A-Za-z£$][^()?=$_,]*\([^()?=$_,]*\)[.!?…]?$/;

/**
 * Assignment targets that describe content rather than plumbing. A map
 * assigned to `setup.endingReasonText`, `setup.incidentDescs`, `setup.actorName`
 * holds player-facing strings under ids of its own, so the keys cannot be
 * allowlisted one by one; the *target name* is the durable signal.
 */
const DISPLAY_TARGET_RE = /(text|texts|string|strings|str|desc|descs|description|label|labels|message|messages|caption|title|journal|hint|prompt|note|reason|name)/i;
const ASSIGN_TARGET_RE = /^\s*(?:set|unset|run|capture|init|remember|forget)\s+([A-Za-z_$][\w$.[\]"']*)\s+(?:to|\+=|-=|=)\s*/;

const UI_HINTS = /(setting|option|menu|save|load|slot|panel|button|hud|footer|version|import|export|config)/i;
const WIDGET_HINT = /widget/i;
const NARRATIVE_HINT = /^(loc-|overworld|special-|story|passage)/i;

/**
 * A link label / macro label is translatable only when it is prose. URLs,
 * link targets and identifier-shaped arguments (`$var`, `_var.path`,
 * `_filters.type.normal`) are structure the game looks up, not text.
 */
export const isTranslatableLabel = isTranslatableLabelText;

export function classifyArea(passage) {
  const n = passage.name;
  if (passage.tags.includes('widget') || WIDGET_HINT.test(n)) return 'widgets';
  if (UI_HINTS.test(n)) return 'ui';
  if (NARRATIVE_HINT.test(n)) return 'narrative';
  return 'narrative';
}

/** Replace every non-text element of a payload run with a protected placeholder. */
function placeholdersOf(runElements) {
  const placeholders = [];
  const parts = [];
  for (const el of runElements) {
    if (el.kind === 'text') { parts.push(el.text); continue; }
    const ph = `⟦${placeholders.length}⟧`;
    placeholders.push({ placeholder: ph, raw: el.text, kind: el.kind, name: el.name ?? null });
    parts.push(ph);
  }
  return { protectedText: parts.join(''), placeholders };
}

function englishPayload(protectedText, placeholders) {
  return placeholders.reduce((acc, ph) => acc.split(ph.placeholder).join(' '), protectedText);
}

/**
 * Elements of a string literal's inner text.
 *
 * Move syntax that the writer had to escape (`<span class=\"pink\">`,
 * `<<if\t elementExists(\'#x\')>>`) without exposing the escape itself:
 * the structure is scanned on the *unescaped* text so a tag or macro that
 * contains an escape is still recognised as one protected token, and the
 * resulting spans are mapped back onto the raw text. Only plain text keeps
 * its escapes, which are then frozen as their own tokens: a translation must
 * never be able to drop the backslash of `\"` and turn a valid JS string into
 * a broken one.
 */
function literalElements(raw) {
  if (!raw.includes('\\')) return tokenize(raw);

  let un = '';
  const spans = [];
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      un += raw[i + 1];
      spans.push([i, i + 2]);
      i += 2;
    } else {
      un += raw[i];
      spans.push([i, i + 1]);
      i += 1;
    }
  }

  const mapped = [];
  for (const el of tokenize(un)) {
    if (el.end <= el.start) continue;
    const start = spans[el.start][0];
    const end = spans[el.end - 1][1];
    mapped.push({ ...el, start, end, text: raw.slice(start, end) });
  }

  // A structural token keeps its escapes inside it (already protected). Plain
  // text is split so each escape becomes its own frozen token.
  const out = [];
  for (const el of mapped) {
    if (el.kind !== 'text' || !raw.slice(el.start, el.end).includes('\\')) { out.push(el); continue; }
    let i = el.start;
    let seg = el.start;
    while (i < el.end) {
      if (raw[i] === '\\' && i + 1 < el.end) {
        if (i > seg) out.push({ kind: 'text', start: seg, end: i, text: raw.slice(seg, i) });
        out.push({ kind: 'escape', start: i, end: i + 2, text: raw.slice(i, i + 2) });
        i += 2;
        seg = i;
        continue;
      }
      i += 1;
    }
    if (seg < el.end) out.push({ kind: 'text', start: seg, end: el.end, text: raw.slice(seg, el.end) });
  }
  return out;
}

/**
 * Build the canonical inventory from a parsed compiled story.
 * Returns { units, stats, reversibility }.
 */
export function buildInventory(story, { sourceVersion = 'unknown' } = {}) {
  const units = [];
  const issues = [];
  const unitIds = new Map();
  const stats = {
    passages: story.passages.length,
    passagesWithText: 0,
    irreversiblePassages: 0,
    unitsByKind: {},
    unitsByRisk: {},
    unitsByArea: {},
    codeBlocks: 0,
    codeStrings: 0,
    pendingIssues: 0,
  };
  const reversibleErrors = [];
  // Strings the code uses as lookup keys: a data literal that happens to equal
  // one of them must not be translated, or the lookup copy would no longer
  // match the display copy.
  const identifierSpace = collectIdentifierSpace(story);

  const EMPTY_HITS = [];
  const issueGroups = new Map();
  const recordIssue = (code, passage, offset, detail, host = '') => {
    stats.pendingIssues += 1;
    const key = `${code}\u0000${host}`;
    let rec = issueGroups.get(key);
    if (!rec) {
      rec = { code, host, passage, offset, detail, count: 0 };
      issueGroups.set(key, rec);
      if (issues.length < 500) issues.push(rec);
    }
    rec.count += 1;
  };

  for (const p of story.passages) {
    const elements = tokenize(p.content);
    if (!isReversible(p.content, elements)) {
      stats.irreversiblePassages += 1;
      if (reversibleErrors.length < 20) {
        reversibleErrors.push({ passage: p.name, pid: p.pid });
      }
      continue;
    }
    const depth = conditionalDepth(elements);
    const area = classifyArea(p);
    let produced = 0;

    const pushUnit = (kind, start, end, rawText, protectedText, placeholders, riskLevel, extra = {}) => {
      // A unit must carry text a translator can actually work on. Structure
      // alone (`<span class='ui-icon'></span>`, `<<iconUi _file>>`) is not a
      // translation unit; exporting it would only manufacture NO_OP blockers.
      //
      // Labels are known display positions, so a short word ("No", "Yes",
      // "Buy", "Pay", "Yes (0:05)") counts; free text keeps the stricter
      // sentence heuristic that protects identifier-shaped payloads.
      const payload = englishPayload(protectedText, placeholders);
      const isLabel = kind === 'link_label' || kind === 'macro_label';
      if (!(isLabel ? hasLatinWord(payload) : looksLikeEnglish(payload))) return;
      // Two generators must never claim the same span: a duplicate unitId would
      // be silently collapsed by the kit's jsonl/CSV merge, losing one unit.
      const unitId = `${p.pid}:${start}-${end}`;
      if (unitIds.has(unitId)) {
        recordIssue('duplicate-unit-span', p.name, start, `${kind} vs ${unitIds.get(unitId)}`, unitId);
        return;
      }
      unitIds.set(unitId, kind);
      const unit = {
        unitId,
        sourceFile: extra.sourceFile ?? null,
        passage: p.name,
        widget: kind === 'widget' ? p.name : null,
        startOffset: start,
        endOffset: end,
        absStart: p.contentOffset + start,
        absEnd: p.contentOffset + end,
        rawText,
        protectedText,
        placeholders,
        family: area,
        visibility: extra.visibility ?? 'player',
        riskLevel,
        kind,
        origin: extra.origin ?? null,
        context: extra.context ?? null,
        sourceVersion,
        baseRelation: extra.baseRelation ?? null,
        oldTranslation: null,
        translation: null,
        qaStatus: 'pending',
        ruleHits: [],
      };
      units.push(unit);
      produced += 1;
      stats.unitsByKind[kind] = (stats.unitsByKind[kind] || 0) + 1;
      stats.unitsByRisk[riskLevel] = (stats.unitsByRisk[riskLevel] || 0) + 1;
      stats.unitsByArea[area] = (stats.unitsByArea[area] || 0) + 1;
    };

    // Payload runs span inline macros / HTML / variables as placeholders and
    // break only at block boundaries (control flow, code, links, block tags).
    let runStart = null;
    let runIndex = 0;
    let run = [];
    const flush = () => {
      if (runStart === null) return;
      const last = run[run.length - 1];
      const { protectedText, placeholders } = placeholdersOf(run);
      const payload = englishPayload(protectedText, placeholders);
      if (looksLikeEnglish(payload)) {
        // Structure left in the payload means this run could not be fully
        // tokenised into placeholders. Exporting it would hand a translator a
        // span that still contains raw markup (`>>`, `]]`, an unclosed tag, a
        // stray variable) which no placeholder protects, so a faithful
        // translation would silently destroy it. Same policy as code strings:
        // record the gap as a pending issue instead of exporting it.
        if (RESIDUAL_STRUCTURE_RE.test(payload)) {
          recordIssue('passage-text-unparsed', p.name, runStart, JSON.stringify(payload.slice(0, 80)), 'text');
          runStart = null;
          run = [];
          return;
        }
        const d = depth[runIndex];
        const riskLevel = d > 0 ? 'L2' : placeholders.length > 0 ? 'L1' : 'L0';
        pushUnit('passage_text', runStart, last.end, p.content.slice(runStart, last.end), protectedText, placeholders, riskLevel);
      }
      runStart = null;
      run = [];
    };

    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      let boundary = false;
      if (el.kind === 'comment') boundary = true;
      else if (el.kind === 'code') boundary = true;
      else if (el.kind === 'macro') boundary = isFlushMacro(el.name);
      else if (el.kind === 'link') boundary = true;
      else if (el.kind === 'html') boundary = isBlockHtml(el.text);

      // Which string literals inside this element are player-facing?
      //
      //   output macros (<<print>>/<<=>>)  every prose literal in the body
      //   code bodies (<<set>>, <<run>>,   prose literals with an embedded
      //     <<script>> blocks, …)          macro / HTML tag, plus values of a
      //                                    display key (`sentence`, `start`, …)
      //                                    or of a display-named map target
      //   any other macro                  prose with embedded markup, or a
      //                                    sentence-shaped argument that is
      //                                    neither a decision nor a lookup key
      //
      // Everything else stays out of the kit. Prose that we deliberately do
      // not export is recorded as a pending issue, never dropped silently.
      const isCode = el.kind === 'code';
      const isOpenMacro = el.kind === 'macro' && !el.isClose;
      if (isCode) {
        stats.codeBlocks += 1;
        if (!el.closed) recordIssue('code-block-unterminated', p.name, el.start, 'no <</script>> found');
      } else if (isOpenMacro && CODE_BODY_MACROS.has(el.name) && el.fallback) {
        recordIssue('macro-scan-fallback', p.name, el.start, 'unterminated string inside macro');
      }

      const loose = isOpenMacro && OUTPUT_MACROS.has(el.name);
      const prose = (isCode || isOpenMacro)
        ? extractDisplayStrings(p.content, el.bodyStart, el.bodyEnd)
        : EMPTY_HITS;
      let labelSpan = null;
      if (isOpenMacro && LABEL_ARG_MACROS.has(el.name)) {
        const lbl = macroLabel(el);
        if (lbl) labelSpan = { start: lbl.start, end: lbl.end };
      }

      // Link markup inside a macro body: `<<link [[Label|Target]]>>`,
      // `<<button [[Label|Target]]>>`, `<<fadetext [[…]]>>`. The label is
      // display text, the target is an identifier, and neither is visible to
      // the run scanner because the whole macro is one protected element.
      const linkLabels = isOpenMacro
        ? collectLinkLabels(p.content, el.bodyStart, el.bodyEnd).filter((l) => isTranslatableLabel(l.text))
        : EMPTY_HITS;

      // A label span (macro argument or link label) already owns the text it
      // contains; the prose scan must not emit a second, overlapping unit.
      const claimed = linkLabels.map((l) => ({ start: l.start, end: l.end }));
      if (labelSpan) claimed.push(labelSpan);

      // `<<set setup.endingReasonText = { id: "…" }>>`: a map assigned to a
      // display-named target holds player-facing strings under its own keys.
      const assignTarget = isOpenMacro || isCode
        ? ASSIGN_TARGET_RE.exec(p.content.slice(el.bodyStart, el.bodyEnd))
        : null;
      const displayTarget = Boolean(assignTarget && DISPLAY_TARGET_RE.test(assignTarget[1]));

      const hits = [];
      for (const hit of prose) {
        if (claimed.some((s) => hit.innerStart >= s.start && hit.innerEnd <= s.end)) continue;
        const keyed = hit.key !== null;
        let exportable;
        const codeShaped = CODEISH_LITERAL_RE.test(hit.inner)
          || CODE_START_RE.test(hit.inner)
          || CSS_FUNCTION_RE.test(hit.inner)
          || (/[()]/.test(hit.inner) && !PAREN_LABEL_RE.test(hit.inner.trim()));
        const notAnIdentifier = !identifierSpace.has(hit.inner.trim().toLowerCase());
        if (keyed) {
          exportable = DISPLAY_STRING_KEYS.has(hit.key)
            || (displayTarget
              && looksLikeDisplayArgument(hit.inner)
              && !codeShaped
              && notAnIdentifier);
        } else if (loose) {
          exportable = true;                         // <<print>> shows the argument
        } else if (hit.hasMarkup) {
          exportable = true;                         // a rendered template
        } else {
          // A bare string argument. It is display text only when nothing says
          // otherwise: not a decision, not a name the code looks up, and not
          // code-shaped plumbing (CSS values, log messages, expressions).
          const hostName = el.name || '';
          exportable = looksLikeDisplayArgument(hit.inner)
            && !CONTROL_BODY_MACROS.has(hostName)
            && !IDENT_ARG_MACROS.has(hostName)
            && !codeShaped
            && notAnIdentifier;
        }
        if (!exportable) {
          recordIssue('unexported-code-string', p.name, hit.innerStart,
            JSON.stringify(hit.inner.slice(0, 80)), `${el.name || el.kind}${keyed ? `:${hit.key}` : ''}`);
          continue;
        }
        hits.push(hit);
      }
      if (hits.length > 0) boundary = true;
      if (linkLabels.length > 0) boundary = true;

      if (boundary) {
        flush();
        const d = depth[i];
        for (const hit of hits) {
          if (labelSpan && hit.valueStart >= labelSpan.start && hit.valueEnd <= labelSpan.end) continue;
          const raw = p.content.slice(hit.innerStart, hit.innerEnd);
          const inner = literalElements(raw);
          if (!isReversible(raw, inner)) {
            recordIssue('code-string-irreversible', p.name, hit.innerStart, JSON.stringify(raw.slice(0, 60)));
            continue;
          }
          const { protectedText, placeholders } = placeholdersOf(inner);
          // The text that actually reaches a translator must read as English;
          // a literal that is all markup, macros and fragments is not a unit.
          const payload = englishPayload(protectedText, placeholders);
          if (!looksLikeEnglish(payload)) continue;
          if (RESIDUAL_STRUCTURE_RE.test(payload)) {
            recordIssue('code-string-unparsed', p.name, hit.innerStart,
              JSON.stringify(payload.slice(0, 80)), el.name || el.kind);
            continue;
          }
          // A data literal whose exact value is also a lookup key stays out of
          // the kit; see `identifier-space.mjs`.
          if (identifierSpace.has(raw.trim().toLowerCase())) {
            recordIssue('code-string-is-identifier', p.name, hit.innerStart,
              JSON.stringify(raw.slice(0, 60)), el.name || el.kind);
            continue;
          }
          const risk = d > 0 ? 'L2' : placeholders.length > 0 ? 'L1' : 'L0';
          pushUnit('passage_text', hit.innerStart, hit.innerEnd, raw, protectedText, placeholders, risk, {
            origin: 'code-string',
            context: jsStringContext(hit.quote),
          });
          stats.codeStrings += 1;
        }
        for (const label of linkLabels) {
          const inner = literalElements(label.text);
          const { protectedText, placeholders } = isReversible(label.text, inner)
            ? placeholdersOf(inner)
            : { protectedText: label.text, placeholders: [] };
          pushUnit('link_label', label.start, label.end, label.text, protectedText, placeholders, d > 0 ? 'L2' : 'L1', {
            origin: 'macro-link-label',
            context: label.quote ? jsStringContext(label.quote) : LINK_LABEL_CONTEXT,
          });
        }
        if (el.kind === 'link') {
          const label = linkLabel(el);
          if (label && isTranslatableLabel(label.text)) {
            const inner = literalElements(label.text);
            const { protectedText, placeholders } = isReversible(label.text, inner)
              ? placeholdersOf(inner)
              : { protectedText: label.text, placeholders: [] };
            pushUnit('link_label', label.start, label.end, label.text, protectedText, placeholders, d > 0 ? 'L2' : 'L1', {
              origin: 'link-markup',
              context: LINK_LABEL_CONTEXT,
            });
          }
        } else if (el.kind === 'macro' && LABEL_ARG_MACROS.has(el.name)) {
          const label = macroLabel(el);
          if (label && isTranslatableLabel(label.text)) {
            const inner = literalElements(label.text);
            const { protectedText, placeholders } = isReversible(label.text, inner)
              ? placeholdersOf(inner)
              : { protectedText: label.text, placeholders: [] };
            pushUnit('macro_label', label.start, label.end, label.text, protectedText, placeholders, d > 0 ? 'L2' : 'L1', {
              origin: 'macro-label',
              context: macroArgContext(label.quote),
            });
          }
        }
        continue;
      }
      if (runStart === null) { runStart = el.start; runIndex = i; }
      run.push(el);
    }
    flush();
    if (produced > 0) stats.passagesWithText += 1;
  }

  return { units, stats, issues, reversibility: { errors: reversibleErrors } };
}

/** Reconstruct a passage slice from a unit's protectedText + placeholders. */
export function restoreProtected(protectedText, placeholders) {
  let out = protectedText;
  for (const ph of placeholders) out = out.split(ph.placeholder).join(ph.raw);
  return out;
}
