// Structural fingerprint V3.
//
// A flat token multiset cannot tell a legal re-ordering from a conditional
// branch being merged, dropped or moved. V3 parses the SugarCube markup into a
// lightweight conditional tree and fingerprints:
//   balance      macro open/close depth
//   branches     ordered branch skeleton (IF/ELSEIF/ELSE/CASE/DEFAULT) + conditions
//   perBranch    protected tokens per branch (macro names, pronouns, variables,
//                template holes, link targets, html tags)
// The comparison reports stable codes so a translation unit only passes if it
// keeps the same reachable branches, conditions and logic tokens. Chinese text
// may move freely inside a branch, but not across one.

import { extractMacros, extractLinkTargets, SOFT_MACROS } from './protection.mjs';
import { CONDITIONAL_OPEN, CONDITIONAL_BRANCH, CONDITIONAL_CLOSE, BLOCK_MACROS_V3 } from './protection-v3-blocks.mjs';
import { CONTEXT_WRITING_MACROS, equivalentSignatures, signatureOf } from './context-semantics.mjs';
import { collectVariables, collectTemplateHoles, stripQuotedText as stripQuoted } from './structure-tokens.mjs';

const HTML_TAG_RE = /<\/?([A-Za-z][A-Za-z0-9-]*)((?:\s+[^<>]*?)?)\/?>/g;
const SPLIT = ' \u0001 ';

/**
 * Non-identifier sentinel wrapped around every restored placeholder in the V3
 * domain. It gives a restored token back its identifier boundary without
 * hiding it from the scans below.
 */
const DOMAIN_BOUNDARY = '\u0002';

/**
 * Build the text V3 compares, from a *protected* payload plus its placeholders.
 *
 * `verifyEntry` restores the placeholders before comparing, so a variable
 * comes back as its original source (`$worn.face.name`, `_painting`, …) — and
 * `collectVariables` requires an identifier boundary in front of it. A
 * faithful translation that puts the variable where Chinese needs it
 * (`墙上贴满了_furniture.wallpaper.name的画像。`) leaves a CJK letter in front,
 * the boundary check fails, and the guard reports the variable as removed.
 * The answer ended up depending on the target language, which is exactly what
 * the shared token grammar exists to avoid.
 *
 * Wrapping each restored placeholder in {@link DOMAIN_BOUNDARY} fixes that
 * without weakening anything: the token is still in the text (so the branch,
 * macro, link and HTML scans keep seeing it) and it is now always preceded by
 * a non-identifier character. Translated text outside a placeholder is not
 * wrapped, so a `$variable` or `<<macro>>` a translation *adds* is still
 * caught, and a unit with no placeholders is returned unchanged — the
 * identifier rule (`foo_bar` is one identifier, not `foo` + a `_bar` variable)
 * keeps its meaning.
 */
export function placeholderDomain(protectedText, placeholders) {
  let out = String(protectedText == null ? '' : protectedText);
  for (const ph of placeholders || []) {
    if (!ph || !ph.placeholder) continue;
    out = out.split(ph.placeholder).join(`${DOMAIN_BOUNDARY}${ph.raw}${DOMAIN_BOUNDARY}`);
  }
  return out;
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const withoutMacros = (t) => String(t || '').replace(/<{2}[\s\S]*?>{2}/g, SPLIT);

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

const collectHoles = collectTemplateHoles;
function collectHtml(text) {
  const out = [];
  HTML_TAG_RE.lastIndex = 0;
  let m;
  while ((m = HTML_TAG_RE.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    const raw = m[0];
    if (raw.startsWith('</')) out.push(`close:${name}`);
    else if (/\/>$/.test(raw)) out.push(`self:${name}`);
    else out.push(`open:${name}`);
  }
  return out;
}

/** Approximate argument count of a macro body (top-level commas). */
function argCount(body) {
  const t = String(body || '').trim();
  if (!t) return 0;
  let depth = 0;
  let quote = null;
  let n = 1;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (quote) { if (c === quote && t[i - 1] !== '\\') quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) n += 1;
  }
  return n;
}

function macroArgCounts(text, name) {
  const out = [];
  for (const mac of extractMacros(text)) {
    if (mac.isClose) continue;
    if (mac.baseName !== name && mac.name !== name) continue;
    out.push(argCount(mac.body));
  }
  return out.sort();
}

// Parse `text` into conditional branches.
export function parseStructure(text) {
  const macros = extractMacros(text);
  const branches = new Map();
  const order = [];
  let depth = 0;
  let min = 0;
  let conditionalIndex = 0;
  const stack = [];
  const topPath = 'top';
  branches.set(topPath, { kind: 'root', cond: '', tokens: [], parent: null, depth: 0 });
  order.push(topPath);
  const currentPath = () => (stack.length ? stack[stack.length - 1].path : topPath);
  const add = (tokens) => branches.get(currentPath()).tokens.push(...tokens);

  for (const mac of macros) {
    const name = mac.baseName;
    if (!mac.isClose && CONDITIONAL_OPEN.has(name)) {
      const path = `${conditionalIndex}.0`;
      stack.push({ id: conditionalIndex, index: 0, path });
      // Record the enclosing conditional and the nesting level so a
      // branch that is hoisted out of its parent (or pushed deeper) is detected
      // even though the flat pre-order skeleton is unchanged.
      branches.set(path, {
        kind: 'if',
        cond: norm(stripQuoted(mac.body)),
        tokens: [],
        parent: stack.length ? stack[stack.length - 1].id : null,
        depth: stack.length,
      });
      order.push(path);
      conditionalIndex += 1;
      depth += 1;
      min = Math.min(min, depth);
      continue;
    }
    if (!mac.isClose && CONDITIONAL_BRANCH.has(name) && stack.length) {
      const frame = stack[stack.length - 1];
      frame.index += 1;
      frame.path = `${frame.id}.${frame.index}`;
      branches.set(frame.path, {
        kind: name,
        cond: name === 'else' || name === 'default' ? '' : norm(stripQuoted(mac.body)),
        tokens: [],
        parent: stack.length >= 2 ? stack[stack.length - 2].id : null,
        depth: Math.max(0, stack.length - 1),
      });
      order.push(frame.path);
      continue;
    }
    // `extractMacros` strips the slash, so a close reports baseName 'if'.
    if (mac.isClose && CONDITIONAL_OPEN.has(name) && stack.length) {
      stack.pop();
      depth -= 1;
      continue;
    }
    if (mac.isClose) {
      // Closing macro: only conditional closes matter for branch tracking.
      const tokens = [SOFT_MACROS.has(name) ? `pronoun:${name}` : `macro:${mac.name}`];
      add(tokens);
      continue;
    }
    const tokens = [SOFT_MACROS.has(name) ? `pronoun:${name.replace(/^\//, '')}` : `macro:${mac.name}`];
    tokens.push(...collectVariables(mac.body));
    tokens.push(...collectHoles(mac.body));
    for (const target of extractLinkTargets(mac.body)) tokens.push(`link:${norm(target)}`);
    add(tokens);
  }
  for (const chunk of withoutMacros(text).split('\u0001')) {
    const tokens = [];
    tokens.push(...collectVariables(chunk));
    tokens.push(...collectHoles(chunk));
    tokens.push(...collectHtml(chunk));
    for (const target of extractLinkTargets(chunk)) tokens.push(`link:${norm(target)}`);
    add(tokens);
  }
  return { balance: { depth, min }, branches, order };
}

// Stable, serialisable fingerprint stored in the translation source of truth.
export function structuralFingerprint(text) {
  const parsed = parseStructure(text);
  const branchTokens = {};
  for (const path of parsed.order) branchTokens[path] = [...parsed.branches.get(path).tokens].sort();
  const links = [];
  for (const c of withoutMacros(text).split('\u0001')) links.push(...extractLinkTargets(c));
  return {
    balance: parsed.balance,
    branches: parsed.order.map((p) => ({ path: p, kind: parsed.branches.get(p).kind, cond: parsed.branches.get(p).cond })),
    branchTokens,
    links: links.map(norm).sort(),
  };
}

export function compareStructures(from, to, { allow = [], allowPronounOmission = [], allowedMacroSubstitutions = {} } = {}) {
  const findings = [];
  const push = (code, detail) => findings.push({ code, detail });
  const a = parseStructure(from);
  const b = parseStructure(to);

  // Balance is compared between the two sides, not against zero: a unit may be
  // a *fragment* that legitimately starts or ends inside a conditional (a
  // display string embedded in game code), in which case the source itself is
  // unbalanced. What must never change is the shape the translation sees, so
  // any asymmetry in depth or in the lowest point still blocks.
  if (a.balance.depth !== b.balance.depth || a.balance.min !== b.balance.min) {
    push('MACRO_BALANCE_CHANGED', `fromDepth=${a.balance.depth} toDepth=${b.balance.depth} fromMin=${a.balance.min} toMin=${b.balance.min}`);
  }

  const ab = a.order.map((p) => ({ ...a.branches.get(p), path: p }));
  const bb = b.order.map((p) => ({ ...b.branches.get(p), path: p }));
  if (ab.length !== bb.length) {
    push('COND_BRANCH_COUNT_CHANGED', `from=${ab.length} to=${bb.length} from=[${ab.map((x) => x.kind).join(',')}] to=[${bb.map((x) => x.kind).join(',')}]`);
  } else {
    for (let i = 0; i < ab.length; i += 1) {
      if (ab[i].kind !== bb[i].kind) { push('COND_ORDER_CHANGED', `#${i} from=${ab[i].kind} to=${bb[i].kind}`); break; }
    }
    for (let i = 0; i < ab.length; i += 1) {
      if (ab[i].cond !== bb[i].cond) { push('COND_EXPR_CHANGED', `#${i} from=[${ab[i].cond}] to=[${bb[i].cond}]`); break; }
    }
    // The flat branch list does not encode parentage, so compare the
    // enclosing conditional + nesting level per branch as well.
    for (let i = 0; i < ab.length; i += 1) {
      if (ab[i].parent !== bb[i].parent || ab[i].depth !== bb[i].depth) {
        push('COND_NESTING_CHANGED', `#${i} from=[parent=${ab[i].parent} depth=${ab[i].depth}] to=[parent=${bb[i].parent} depth=${bb[i].depth}]`);
        break;
      }
    }
  }

  const allowedOmissions = new Set(allowPronounOmission.map((s) => String(s).toLowerCase()));
  // Macro names are compared case-insensitively (extractMacros lowercases them).
  const subs = {};
  for (const [k, v] of Object.entries(allowedMacroSubstitutions || {})) {
    const helper = typeof v === 'string' ? v : v && v.helper;
    if (helper) subs[String(k).toLowerCase()] = String(helper).toLowerCase();
  }
  // Context-writing selectors must declare an equivalent context-effect
  // signature; a bare helper name is not enough.
  for (const [k, v] of Object.entries(allowedMacroSubstitutions || {})) {
    const form = String(k).toLowerCase();
    if (!CONTEXT_WRITING_MACROS.has(form)) continue;
    const declared = typeof v === 'object' && v ? v.contextSignature : null;
    const original = signatureOf(form);
    if (!declared) {
      push('MACRO_CONTEXT_SIGNATURE_MISSING', `${form} substituted without a contextSignature declaration`);
      continue;
    }
    if (!original || declared !== original.id) {
      push('MACRO_CONTEXT_HELPER_INCOMPATIBLE', `${form} declared signature ${declared} != ${original ? original.id : '(unknown macro)'}`);
      continue;
    }
    const helper = String((v && v.helper) || '').toLowerCase();
    const helperSig = signatureOf(helper);
    if (!helperSig || !equivalentSignatures(original, helperSig)) {
      push('MACRO_CONTEXT_HELPER_INCOMPATIBLE', `${form} -> ${helper} has a different context-effect signature`);
    }
  }
  const subTargets = new Set(Object.values(subs));
  if (ab.length === bb.length) {
    const removed = [];
    const added = [];
    for (let i = 0; i < ab.length; i += 1) {
      const diff = diffMultiset(multiset(ab[i].tokens), multiset(bb[i].tokens));
      for (const item of diff.removed) removed.push({ path: ab[i].path, key: item.split(' ')[0] });
      for (const item of diff.added) added.push({ path: bb[i].path, key: item.split(' ')[0] });
    }
    const consumed = new Set();
    const findAdded = (key, path) => added.findIndex((x, idx) => !consumed.has(idx) && x.key === key && (path === undefined || x.path === path));
    for (const r of removed) {
      if (r.key.startsWith('pronoun:')) {
        const form = r.key.slice(8);
        const target = subs[form] ? `macro:${subs[form].toLowerCase()}` : null;
        if (target) {
          const same = findAdded(target, r.path);
          if (same >= 0) { consumed.add(same); continue; }
          const elsewhere = findAdded(target);
          if (elsewhere >= 0) { consumed.add(elsewhere); push('MACRO_SUBSTITUTION_MOVED_ACROSS_BRANCH', `${form} -> ${subs[form]} at ${r.path}`); continue; }
        }
        if (allowedOmissions.has(form)) continue;
        const moved = added.some((x, idx) => !consumed.has(idx) && x.key === `pronoun:${form}` && x.path !== r.path);
        push(moved ? 'PRONOUN_MACRO_MOVED_ACROSS_BRANCH' : 'PRONOUN_MACRO_REMOVED', `${form} at ${r.path}`);
        continue;
      }
      if (r.key.startsWith('link:')) { push('LINK_TARGET_CHANGED', `${r.path} removed ${r.key}`); continue; }
      if (r.key.startsWith('${')) { push('TEMPLATE_EXPR_CHANGED', `${r.path} removed ${r.key}`); continue; }
      if (/^[$_]/.test(r.key)) { push('VARIABLE_CHANGED', `${r.path} removed ${r.key}`); continue; }
      if (/^(open|close|self):/.test(r.key)) { push('HTML_NESTING_CHANGED', `${r.path} removed ${r.key}`); continue; }
      push('MACRO_NAME_CHANGED', `${r.path} removed ${r.key}`);
    }
    for (let idx = 0; idx < added.length; idx += 1) {
      if (consumed.has(idx)) continue;
      const key = added[idx].key;
      if (key.startsWith('pronoun:')) continue; // handled above (moves)
      if (key.startsWith('macro:')) {
        const helper = key.slice(6);
        if (helper.startsWith('dolp_') && !subTargets.has(helper.toLowerCase())) { push('MACRO_SUBSTITUTION_MISMATCH', `${helper} at ${added[idx].path} is not a declared substitution target`); continue; }
        push('MACRO_NAME_CHANGED', `${added[idx].path} added ${key}`);
        continue;
      }
      if (key.startsWith('link:')) { push('LINK_TARGET_CHANGED', `${added[idx].path} added ${key}`); continue; }
      if (key.startsWith('${')) { push('TEMPLATE_EXPR_CHANGED', `${added[idx].path} added ${key}`); continue; }
      if (/^[$_]/.test(key)) { push('VARIABLE_CHANGED', `${added[idx].path} added ${key}`); continue; }
      if (/^(open|close|self):/.test(key)) { push('HTML_NESTING_CHANGED', `${added[idx].path} added ${key}`); continue; }
    }
  }

  const aLinks = [];
  const bLinks = [];
  for (const c of withoutMacros(from).split('\u0001')) aLinks.push(...extractLinkTargets(c).map(norm));
  for (const c of withoutMacros(to).split('\u0001')) bLinks.push(...extractLinkTargets(c).map(norm));
  for (const mac of extractMacros(from)) aLinks.push(...extractLinkTargets(mac.body).map(norm));
  for (const mac of extractMacros(to)) bLinks.push(...extractLinkTargets(mac.body).map(norm));
  const linkDiff = diffMultiset(multiset(aLinks), multiset(bLinks));
  if (!findings.some((f) => f.code === 'LINK_TARGET_CHANGED') && (linkDiff.added.length || linkDiff.removed.length)) {
    push('LINK_TARGET_CHANGED', `added=[${linkDiff.added.join(', ')}] removed=[${linkDiff.removed.join(', ')}]`);
  }
  const htmlOf = (t) => {
    const out = [];
    for (const c of withoutMacros(t).split('\u0001')) out.push(...collectHtml(c));
    return out;
  };
  const htmlDiff = diffMultiset(multiset(htmlOf(from)), multiset(htmlOf(to)));
  if (!findings.some((f) => f.code === 'HTML_NESTING_CHANGED') && (htmlDiff.added.length || htmlDiff.removed.length)) {
    push('HTML_NESTING_CHANGED', `added=[${htmlDiff.added.join(', ')}] removed=[${htmlDiff.removed.join(', ')}]`);
  }

  // Declared substitutions must keep their argument semantics.
  for (const [form, spec] of Object.entries(subs)) {
    const helper = typeof spec === 'string' ? spec : spec && spec.helper;
    if (!helper) continue;
    // Omission is allowed, so compare the set of distinct arities rather than
    // the call count.
    const before = [...new Set(macroArgCounts(from, form))];
    const after = [...new Set(macroArgCounts(to, helper))];
    if (before.length && after.length && before.join(',') !== after.join(',')) {
      push('MACRO_SUBSTITUTION_ARITY_CHANGED', `${form}(${before.join(',')}) -> ${helper}(${after.join(',')})`);
    }
  }

  const allowed = new Set(allow.map((x) => x && x.code));
  return { findings, blocking: findings.filter((f) => !allowed.has(f.code)), allowed: [...allowed] };
}

export const V3_CODES = [
  'MACRO_BALANCE_CHANGED',
  'COND_BRANCH_COUNT_CHANGED',
  'COND_ORDER_CHANGED',
  'COND_EXPR_CHANGED',
  'COND_NESTING_CHANGED',
  'PRONOUN_MACRO_REMOVED',
  'PRONOUN_MACRO_MOVED_ACROSS_BRANCH',
  'MACRO_NAME_CHANGED',
  'LINK_TARGET_CHANGED',
  'TEMPLATE_EXPR_CHANGED',
  'VARIABLE_CHANGED',
  'HTML_NESTING_CHANGED',
  'MACRO_SUBSTITUTION_MOVED_ACROSS_BRANCH',
  'MACRO_SUBSTITUTION_MISMATCH',
  'MACRO_CONTEXT_SIGNATURE_MISSING',
  'MACRO_CONTEXT_HELPER_INCOMPATIBLE',
  'MACRO_SUBSTITUTION_ARITY_CHANGED',
];

export { BLOCK_MACROS_V3 };
