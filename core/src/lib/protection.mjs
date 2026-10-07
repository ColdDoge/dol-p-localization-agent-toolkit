/*
 * Tiered structural-protection analysis for translation pairs.
 *
 * Treating every protected-token difference as equally bad conflates real
 * structural breakage with legitimate target-language omission/reordering.
 * This check splits findings into four tiers:
 *
 *   HARD       - must not change; almost certainly breaks logic/jumps/saves
 *   STRUCTURAL - control/HTML structure; small justified changes are possible
 *                but must be reviewed
 *   SOFT       - natural-language output macros (pronouns, gendered forms);
 *                a target language may legitimately drop or rewrite these
 *   MANUAL     - heuristic flags for human review, not violations by themselves
 *
 * The library is intentionally small and explainable; it is not a Twine
 * compiler. Findings carry stable codes so later work can whitelist or regress.
 */

const HARD = 'hard';
const STRUCTURAL = 'structural';
const SOFT = 'soft';
const MANUAL = 'manual';

/**
 * Macros that only produce natural-language person/gender/number forms.
 * Changing these is a linguistic decision, not a structural one.
 */
export const SOFT_MACROS = new Set(
  [
    // Pure output macros: they emit text/values and never control flow, so
    // wrapping existing text in <<= ...>> / <<print ...>> is a display change,
    // not a structural one.
    'print', '=', '-',
    // player / NPC pronouns and gendered forms
    'he', 'hes', "he's", 'him', 'his', 'himself', 'hers', 'her', 'she', 'shes', 'they', 'them', 'their', 'theirs',
    'person', 'person1', 'person2', 'person3', 'persons', 'personsimple', 'personselect', 'someone', 'someones',
    'girl', 'boy', 'woman', 'women', 'man', 'men', 'lady', 'ladies', 'guy', 'guys', 'lad', 'lass', 'lassie',
    'sir', 'maam', 'ma', 'mum', 'mummy', 'dad', 'father', 'mother', 'grandpa', 'grandma', 'uncle', 'auntie', 'aunt',
    'master', 'mistress', 'lord', 'wife', 'husband', 'spouse', 'sister', 'brother', 'theowner', 'neutral',
    'npc_he', 'npc_his', 'npc_him', 'nnpc_he', 'nnpc_his', 'nnpc_him', 'phe', 'phim', 'pher', 'pshe',
    'steed_he', 'steed_his', 'steed_him', 'that', 'there', 'it', 'its',
    // Bird / child / fourth-person display pronouns.
    'bhe', 'bhes', 'bhis', 'bhim', 'bhimself', 'childhe', 'childshe', 'childhim', 'childhis',
    'babyis', 'person4', 'pcpetname', 'petname',
  ].map((s) => s.toLowerCase()),
);

/** Macros whose first quoted argument is shown to the player (label macros). */
export const LABEL_MACROS = new Set([
  'link', 'linkappend', 'linkprepend', 'linkreplace', 'button', 'cycle', 'listbox', 'option', 'textbox',
  'checkbox', 'radiobutton', 'note', 'tooltip',
]);

/** Macros that assign/tweak values; their string literals may be display data. */
const ASSIGN_MACROS = new Set(['set', 'unset', 'capture', 'remember', 'forget']);

/**
 * Paired/branching structural macros. `open`/`close` are matched for balance;
 * `branch` tokens (elseif/else/case/default) must keep their order and count.
 */
const BLOCK_MACROS = new Map([
  ['if', 'open'], ['elseif', 'branch'], ['else', 'branch'], ['endif', 'close'],
  ['for', 'open'], ['endfor', 'close'],
  ['while', 'open'], ['endwhile', 'close'],
  ['switch', 'open'], ['case', 'branch'], ['default', 'branch'], ['endswitch', 'close'],
  ['widget', 'open'], ['endwidget', 'close'],
  ['macro', 'open'], ['endmacro', 'close'],
  ['script', 'open'], ['endscript', 'close'],
  ['link', 'open'], ['endlink', 'close'],
  ['button', 'open'], ['endbutton', 'close'],
  ['replace', 'open'], ['endreplace', 'close'],
  ['append', 'open'], ['endappend', 'close'],
  ['prepend', 'open'], ['endprepend', 'close'],
  ['nobr', 'open'], ['endnobr', 'close'],
  ['silently', 'open'], ['endsilently', 'close'],
  ['timed', 'open'], ['endtimed', 'close'],
  ['repeat', 'open'], ['endrepeat', 'close'],
  ['type', 'open'], ['endtype', 'close'],
  ['addinlineevent', 'open'], ['endaddinlineevent', 'close'],
  ['css', 'open'], ['endcss', 'close'],
  ['audio', 'open'], ['endaudio', 'close'],
  ['nobr', 'open'], ['endnobr', 'close'],
]);

/** Macros whose whole (string-stripped) body is a control expression. */
const CONDITION_MACROS = new Set(['if', 'elseif', 'unless', 'while', 'for']);

// `value` is deliberately absent: on <input type="button"> and <option> it is
// the player-visible label and must be translatable.
const PROTECTED_HTML_ATTRS = /^(id|class|src|href|name|for|action|method)$/i;
const PROTECTED_HTML_ATTR_PREFIX = /^data[-:]/i;
const HAS_HTML_TAG_RE = /<[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/;

// Also matches the print forms `<<= expr>>` and `<<- expr>>`, reported as `print`.
const MACRO_RE = /<{2}\s*(\/?)([A-Za-z_][A-Za-z0-9_-]*|=[-]?|-)([\s\S]*?)>{2}/g;
const LINK_RE = /\[\[([\s\S]*?)\]\]/g;
const HTML_TAG_RE = /<\/?([A-Za-z][A-Za-z0-9-]*)((?:\s+[^<>]*?)?)\/?>/g;
const HTML_ATTR_RE = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>=`]+))/g;
const VAR_RE = /(?<![\w$])[$_][A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_$]+|\[[^\]]+\])*/g;
const TEMPLATE_HOLE_RE = /\$\{[^}]*\}/g;
const PRINTF_RE = /%(?:\d+\$)?[sdif]/g;

function multiset(list) {
  const m = new Map();
  for (const x of list) m.set(x, (m.get(x) || 0) + 1);
  return m;
}

function diffMultiset(a, b) {
  const added = [];
  const removed = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const av = a.get(k) || 0;
    const bv = b.get(k) || 0;
    if (bv > av) added.push(`${k} x${bv - av}`);
    if (av > bv) removed.push(`${k} x${av - bv}`);
  }
  return { added, removed };
}

function sameMultiset(a, b) {
  const d = diffMultiset(a, b);
  return d.added.length === 0 && d.removed.length === 0;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function stripQuoted(text) {
  return text.replace(/"([^"]*)"/g, '""').replace(/'([^']*)'/g, "''");
}

/**
 * Remove macro text before HTML analysis. Without this, `<<set x>>` looks like
 * an HTML tag named `set` with attributes.
 */
function stripMacros(text) {
  return text.replace(/<{2}[\s\S]*?>{2}/g, ' ');
}

/** Collect macro occurrences with name, kind and body. */
export function extractMacros(text) {
  const out = [];
  MACRO_RE.lastIndex = 0;
  let m;
  while ((m = MACRO_RE.exec(text)) !== null) {
    const isClose = m[1].includes('/');
    let name = m[2].toLowerCase();
    if (name === '=' || name === '-' || name === '=-') name = 'print';
    out.push({ name: isClose ? `/${name}` : name, baseName: name, isClose, body: m[3], raw: m[0] });
  }
  return out;
}

export function extractLinkTargets(text) {
  const targets = [];
  LINK_RE.lastIndex = 0;
  let m;
  while ((m = LINK_RE.exec(text)) !== null) {
    const inner = m[1];
    // Skip JS array-of-arrays literals (e.g. grouped lookup tables) which
    // otherwise look like link markup. Only the `],[` separator
    // distinguishes them; a link label may legitimately start with a quote.
    if (/\],\s*\[/.test(inner)) continue;
    let target = inner;
    const pipe = inner.indexOf('|');
    if (pipe >= 0) target = inner.slice(pipe + 1);
    else if (inner.includes('->')) target = inner.slice(inner.indexOf('->') + 2);
    else if (inner.includes('<-')) target = inner.slice(0, inner.indexOf('<-'));
    else {
      const bracket = inner.indexOf('][');
      if (bracket >= 0) target = inner.slice(bracket + 2);
    }
    targets.push(norm(target));
  }
  return targets;
}

function extractVariables(text) {
  const out = [];
  VAR_RE.lastIndex = 0;
  let m;
  while ((m = VAR_RE.exec(text)) !== null) out.push(m[0].replace(/\s+/g, ''));
  return out;
}

function extractTemplateHoles(text) {
  // String literals inside a hole are display text and may legitimately be
  // translated; structural code changes are still detected because the
  // surrounding expression differs.
  return (text.match(TEMPLATE_HOLE_RE) || []).map((s) => stripQuoted(s).replace(/\s+/g, ''));
}

function extractPrintf(text) {
  return text.match(PRINTF_RE) || [];
}

function extractHtmlTags(text) {
  const tokens = [];
  HTML_TAG_RE.lastIndex = 0;
  let m;
  while ((m = HTML_TAG_RE.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    const raw = m[0];
    if (raw.startsWith('</')) tokens.push(`close:${name}`);
    else if (/\/>$/.test(raw)) tokens.push(`self:${name}`);
    else tokens.push(`open:${name}`);
  }
  return tokens;
}

function extractHtmlAttrs(text) {
  const protectedAttrs = [];
  const otherAttrs = [];
  HTML_ATTR_RE.lastIndex = 0;
  let m;
  while ((m = HTML_ATTR_RE.exec(text)) !== null) {
    const name = m[1];
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    if (PROTECTED_HTML_ATTRS.test(name) || PROTECTED_HTML_ATTR_PREFIX.test(name)) {
      protectedAttrs.push(`${name.toLowerCase()}=${norm(value)}`);
    } else {
      otherAttrs.push(name.toLowerCase());
    }
  }
  return { protectedAttrs, otherAttrs };
}

/** Condition expressions of control macros, normalised (whitespace collapsed). */
function extractConditions(macros) {
  const out = [];
  for (const mac of macros) {
    if (mac.isClose) continue;
    if (CONDITION_MACROS.has(mac.baseName)) out.push(norm(stripQuoted(mac.body)) + ' :: ' + norm(mac.body));
  }
  return out;
}

/**
 * Macros whose stripped body is purely numeric/punctuation: the argument is a
 * control value (money, time, stress...), not display text.
 */
function extractNumericMacroArgs(macros) {
  const out = [];
  for (const mac of macros) {
    if (mac.isClose) continue;
    if (SOFT_MACROS.has(mac.baseName) || LABEL_MACROS.has(mac.baseName) || ASSIGN_MACROS.has(mac.baseName)) continue;
    const body = stripQuoted(mac.body).replace(/\s+/g, '');
    if (!body) continue;
    if (/^[-\d.,:%+*/()=<>$_{}[\]]+$/.test(body) && /\d/.test(body)) out.push(`${mac.baseName}(${body})`);
  }
  return out;
}

function blockTokenSequence(macros) {
  const tokens = [];
  for (const mac of macros) {
    const kind = BLOCK_MACROS.get(mac.baseName);
    if (!kind) continue;
    if (mac.isClose && kind !== 'close') continue;
    tokens.push(`${kind}:${mac.baseName}`);
  }
  return tokens;
}

function blockBalance(tokens) {
  let depth = 0;
  let min = 0;
  for (const t of tokens) {
    if (t.startsWith('open:')) depth += 1;
    else if (t.startsWith('close:')) depth -= 1;
    if (depth < min) min = depth;
  }
  return { depth, min };
}

function macroNameMultiset(macros, filter) {
  const names = [];
  for (const mac of macros) if (filter(mac)) names.push(mac.name);
  return multiset(names);
}

function push(findings, tier, code, detail) {
  findings.push({ tier, code, detail });
}

/**
 * Classify one from -> to pair.
 * Returns { findings: [{tier, code, detail}], tiers: {hard,structural,soft,manual} }
 */
export function classifyPair(from, to) {
  const findings = [];
  const fMacros = extractMacros(from);
  const tMacros = extractMacros(to);

  // --- HARD -----------------------------------------------------------------
  const varDiff = diffMultiset(multiset(extractVariables(from)), multiset(extractVariables(to)));
  if (varDiff.added.length || varDiff.removed.length) {
    push(findings, HARD, 'HARD_VARIABLE_CHANGED', `added=[${varDiff.added.join(', ')}] removed=[${varDiff.removed.join(', ')}]`);
  }

  const holeDiff = diffMultiset(multiset(extractTemplateHoles(from)), multiset(extractTemplateHoles(to)));
  if (holeDiff.added.length || holeDiff.removed.length) {
    push(findings, HARD, 'HARD_TEMPLATE_HOLE_CHANGED', `added=[${holeDiff.added.join(', ')}] removed=[${holeDiff.removed.join(', ')}]`);
  }

  const printfDiff = diffMultiset(multiset(extractPrintf(from)), multiset(extractPrintf(to)));
  if (printfDiff.added.length || printfDiff.removed.length) {
    push(findings, HARD, 'HARD_PRINTF_CHANGED', `added=[${printfDiff.added.join(', ')}] removed=[${printfDiff.removed.join(', ')}]`);
  }

  const linkDiff = diffMultiset(multiset(extractLinkTargets(from)), multiset(extractLinkTargets(to)));
  if (linkDiff.added.length || linkDiff.removed.length) {
    push(findings, HARD, 'HARD_LINK_TARGET_CHANGED', `added=[${linkDiff.added.join(', ')}] removed=[${linkDiff.removed.join(', ')}]`);
  }

  const condDiff = diffMultiset(multiset(extractConditions(fMacros)), multiset(extractConditions(tMacros)));
  if (condDiff.added.length || condDiff.removed.length) {
    push(findings, HARD, 'HARD_CONDITION_CHANGED', `added=[${condDiff.added.slice(0, 3).join(' | ')}] removed=[${condDiff.removed.slice(0, 3).join(' | ')}]`);
  }

  const numDiff = diffMultiset(multiset(extractNumericMacroArgs(fMacros)), multiset(extractNumericMacroArgs(tMacros)));
  if (numDiff.added.length || numDiff.removed.length) {
    push(findings, HARD, 'HARD_CONTROL_MACRO_ARG_CHANGED', `added=[${numDiff.added.join(', ')}] removed=[${numDiff.removed.join(', ')}]`);
  }

  const fHtml = stripMacros(from);
  const tHtml = stripMacros(to);
  // Only look for HTML attributes when there is an actual tag; otherwise JS
  // assignments like `name = x;` would be parsed as attributes.
  const hasHtml = HAS_HTML_TAG_RE.test(fHtml) || HAS_HTML_TAG_RE.test(tHtml);
  const fAttr = hasHtml ? extractHtmlAttrs(fHtml) : { protectedAttrs: [], otherAttrs: [] };
  const tAttr = hasHtml ? extractHtmlAttrs(tHtml) : { protectedAttrs: [], otherAttrs: [] };
  const attrDiff = diffMultiset(multiset(fAttr.protectedAttrs), multiset(tAttr.protectedAttrs));
  if (attrDiff.added.length || attrDiff.removed.length) {
    push(findings, HARD, 'HARD_HTML_ATTR_CHANGED', `added=[${attrDiff.added.slice(0, 3).join(', ')}] removed=[${attrDiff.removed.slice(0, 3).join(', ')}]`);
  }

  // --- STRUCTURAL -----------------------------------------------------------
  const fBlocks = blockTokenSequence(fMacros);
  const tBlocks = blockTokenSequence(tMacros);
  if (fBlocks.join('|') !== tBlocks.join('|')) {
    const fb = blockBalance(fBlocks);
    const tb = blockBalance(tBlocks);
    push(
      findings,
      STRUCTURAL,
      'STRUCT_BLOCK_SEQUENCE_CHANGED',
      `fromDepth=${fb.depth} toDepth=${tb.depth} from=[${fBlocks.slice(0, 8).join(',')}] to=[${tBlocks.slice(0, 8).join(',')}]`,
    );
  }

  const fTags = hasHtml ? extractHtmlTags(fHtml) : [];
  const tTags = hasHtml ? extractHtmlTags(tHtml) : [];
  if (fTags.join('|') !== tTags.join('|')) {
    push(findings, STRUCTURAL, 'STRUCT_HTML_CHANGED', `from=[${fTags.slice(0, 8).join(',')}] to=[${tTags.slice(0, 8).join(',')}]`);
  }

  const fNames = macroNameMultiset(fMacros, (m) => !SOFT_MACROS.has(m.baseName));
  const tNames = macroNameMultiset(tMacros, (m) => !SOFT_MACROS.has(m.baseName));
  const nameDiff = diffMultiset(fNames, tNames);
  if (nameDiff.added.length || nameDiff.removed.length) {
    push(findings, STRUCTURAL, 'STRUCT_MACRO_NAME_CHANGED', `added=[${nameDiff.added.slice(0, 6).join(', ')}] removed=[${nameDiff.removed.slice(0, 6).join(', ')}]`);
  }

  // --- SOFT -----------------------------------------------------------------
  const fSoft = macroNameMultiset(fMacros, (m) => SOFT_MACROS.has(m.baseName));
  const tSoft = macroNameMultiset(tMacros, (m) => SOFT_MACROS.has(m.baseName));
  const softDiff = diffMultiset(fSoft, tSoft);
  if (softDiff.added.length || softDiff.removed.length) {
    push(findings, SOFT, 'SOFT_PRONOUN_MACRO_CHANGED', `added=[${softDiff.added.slice(0, 6).join(', ')}] removed=[${softDiff.removed.slice(0, 6).join(', ')}]`);
  }

  // --- MANUAL ---------------------------------------------------------------
  const otherDiff = diffMultiset(multiset(fAttr.otherAttrs), multiset(tAttr.otherAttrs));
  if (otherDiff.added.length || otherDiff.removed.length) {
    push(findings, MANUAL, 'MANUAL_HTML_ATTR_REVIEW', `added=[${otherDiff.added.join(', ')}] removed=[${otherDiff.removed.join(', ')}]`);
  }

  const tiers = { hard: 0, structural: 0, soft: 0, manual: 0 };
  for (const f of findings) tiers[f.tier] += 1;
  return { findings, tiers };
}

/**
 * Analyse a list of pairs and produce a summary with per-code tallies and
 * bounded samples. `pairs` = [{ where, pos, from, to }].
 */
export function analyzePairs(pairs, { sampleLimit = 25 } = {}) {
  const summary = {
    checked: 0,
    entriesWithFindings: 0,
    hardViolationCount: 0,
    structuralViolationCount: 0,
    softChangeCount: 0,
    manualReviewCount: 0,
    cleanCount: 0,
    byCode: {},
    findingsByTier: { hard: 0, structural: 0, soft: 0, manual: 0 },
    samples: {},
  };

  for (const p of pairs) {
    if (typeof p.from !== 'string' || typeof p.to !== 'string') continue;
    summary.checked += 1;
    const { findings } = classifyPair(p.from, p.to);
    if (findings.length === 0) {
      summary.cleanCount += 1;
      continue;
    }
    summary.entriesWithFindings += 1;
    const seenTiers = new Set();
    for (const f of findings) {
      summary.byCode[f.code] = (summary.byCode[f.code] || 0) + 1;
      summary.findingsByTier[f.tier] += 1;
      if (!summary.samples[f.code]) summary.samples[f.code] = [];
      if (summary.samples[f.code].length < sampleLimit) {
        summary.samples[f.code].push({
          where: p.where || '',
          pos: p.pos,
          detail: f.detail,
          from: String(p.from).slice(0, 160),
          to: String(p.to).slice(0, 160),
        });
      }
      if (!seenTiers.has(f.tier)) {
        seenTiers.add(f.tier);
        if (f.tier === 'hard') summary.hardViolationCount += 1;
        else if (f.tier === 'structural') summary.structuralViolationCount += 1;
        else if (f.tier === 'soft') summary.softChangeCount += 1;
        else if (f.tier === 'manual') summary.manualReviewCount += 1;
      }
    }
  }
  return summary;
}

export const TIERS = { HARD, STRUCTURAL, SOFT, MANUAL };
