/*
 * Structural protection for a source/translation pair.
 *
 * Three layers, cheapest first:
 *   1. placeholder integrity — the `⟦n⟧` token multiset and order survive;
 *   2. reversible reconstruction — restoring the tokens yields the raw text;
 *   3. V3 structural guard — conditional tree + per-branch token analysis
 *      (see `protection-v3.mjs`), so a translation cannot silently drop, add,
 *      move, or swap a macro, variable, link target, or HTML tag.
 *
 * Every check is a pure function over strings; nothing here touches the
 * filesystem, a device, or a model.
 */

import { compareStructures, placeholderDomain } from './protection-v3.mjs';
import { CONTEXT_WRITING_MACROS } from './context-semantics.mjs';
import { SOFT_MACROS } from './protection.mjs';
import { contextDelimiterFindings } from './structure-tokens.mjs';

const PLACEHOLDER_RE = /\u27e6\d+\u27e7/g;

export function placeholdersIn(text) {
  return (text.match(PLACEHOLDER_RE) || []);
}

/** Placeholder multiset + order must be identical between source and translation. */
export function placeholderIntegrity(source, translation) {
  const a = placeholdersIn(source);
  const b = placeholdersIn(translation);
  const findings = [];
  if (a.length !== b.length) findings.push({ code: 'PLACEHOLDER_COUNT_CHANGED', detail: `${a.length}->${b.length}` });
  const ca = new Map();
  const cb = new Map();
  for (const x of a) ca.set(x, (ca.get(x) || 0) + 1);
  for (const x of b) cb.set(x, (cb.get(x) || 0) + 1);
  for (const k of new Set([...ca.keys(), ...cb.keys()])) {
    if ((ca.get(k) || 0) !== (cb.get(k) || 0)) findings.push({ code: 'PLACEHOLDER_MISMATCH', detail: `${k} ${ca.get(k) || 0}->${cb.get(k) || 0}` });
  }
  if (a.join('\u0001') !== b.join('\u0001')) findings.push({ code: 'PLACEHOLDER_ORDER_CHANGED', detail: `${a.join(',')}->${b.join(',')}` });
  return { ok: findings.length === 0, findings };
}

export function restoreProtected(protectedText, placeholders) {
  let out = protectedText;
  for (const ph of placeholders) out = out.split(ph.placeholder).join(ph.raw);
  return out;
}

/** Macro names (`<<name ...>>`), lowercased, in order. */
export function macroNames(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/<<\s*([^>]*?)>>/g)) {
    const name = (m[1].trim().split(/[\s(]/)[0] || '').toLowerCase().replace(/^-+/, m[1].trim().startsWith('-') ? '-' : '');
    out.push(name || '-');
  }
  return out;
}

/**
 * Pronoun omission registration.
 *
 * Some target languages drop pronoun macros that the source spelled out. That
 * is sanctioned only for the omitted forms, and never for context-writing
 * selectors (`personselect/person1/2/3/…`), whose state writes must be
 * preserved. This derives the omission set from the source/target macro delta.
 *
 * Only `SOFT_MACROS` (pronouns and pure output macros) can be registered: the
 * concept is "this sentence does not need the word", and restricting it keeps
 * a structural macro (`<<if>>`, `<<set>>`, a renamed macro the target parser
 * no longer recognises) from ever being read as an omitted pronoun.
 */
export function derivePronounOmissions(fromRaw, toRaw) {
  const a = macroNames(fromRaw);
  const b = macroNames(toRaw);
  const counts = new Map();
  for (const n of b) counts.set(n, (counts.get(n) || 0) + 1);
  const omitted = new Set();
  const seen = new Map();
  for (const n of a) {
    seen.set(n, (seen.get(n) || 0) + 1);
    if (CONTEXT_WRITING_MACROS.has(n)) continue;
    if (!SOFT_MACROS.has(n)) continue;
    if ((counts.get(n) || 0) < seen.get(n)) omitted.add(n);
  }
  return [...omitted];
}

function placeholderNameOf(index, placeholders) {
  const ph = placeholders.find((p) => p.placeholder === `\u27e6${index}\u27e7`);
  if (!ph) return '';
  if (ph.name) return String(ph.name).toLowerCase();
  const names = macroNames(ph.raw);
  return names.length ? names[0] : '';
}

/** Placeholder integrity, relaxed only for registered pronoun omissions. */
function placeholderIntegrityRelaxed(source, translation, placeholders, omitted) {
  const src = placeholdersIn(source);
  const dst = placeholdersIn(translation);
  const findings = [];
  const dstCounts = new Map();
  for (const x of dst) dstCounts.set(x, (dstCounts.get(x) || 0) + 1);

  const requiredSrc = [];
  const omittableSrc = [];
  for (const ph of src) {
    const idx = Number(ph.slice(1, -1));
    const name = placeholderNameOf(idx, placeholders);
    if (name && omitted.includes(name)) omittableSrc.push(ph);
    else requiredSrc.push(ph);
  }

  const requiredCounts = new Map();
  for (const x of requiredSrc) requiredCounts.set(x, (requiredCounts.get(x) || 0) + 1);
  for (const [k, v] of requiredCounts) {
    const got = dstCounts.get(k) || 0;
    if (got !== v) findings.push({ code: 'PLACEHOLDER_MISMATCH', detail: `${k} ${v}->${got}` });
  }
  for (const x of omittableSrc) {
    if ((dstCounts.get(x) || 0) > 1) findings.push({ code: 'PLACEHOLDER_DUPLICATED', detail: `${x}` });
  }
  const dstRequired = dst.filter((x) => requiredCounts.has(x));
  if (dstRequired.join('\u0001') !== requiredSrc.join('\u0001')) {
    findings.push({ code: 'PLACEHOLDER_ORDER_CHANGED', detail: 'required placeholder order differs' });
  }
  for (const x of dst) if (!src.includes(x)) findings.push({ code: 'PLACEHOLDER_ADDED', detail: x });
  return { ok: findings.length === 0, findings };
}

/**
 * Full V2 entry check: placeholder integrity -> reversible restore -> V3
 * structural guard -> no-op guard.
 */
export function verifyEntry({ protectedText, placeholders, translatedProtected, fromRaw, toRaw, allow = [], context = null }) {
  const findings = [];
  const omissions = derivePronounOmissions(fromRaw, toRaw);
  const pi = placeholderIntegrityRelaxed(protectedText, translatedProtected, placeholders, omissions);
  findings.push(...pi.findings);

  const restored = restoreProtected(translatedProtected, placeholders);
  if (restored !== toRaw) findings.push({ code: 'REVERSIBLE_MISMATCH', detail: 'restore != toRaw' });

  if (typeof toRaw !== 'string' || toRaw.trim() === '') findings.push({ code: 'EMPTY_TRANSLATION', detail: '' });
  if (fromRaw === toRaw) findings.push({ code: 'NO_OP', detail: '' });

  // The enclosing syntax must not be broken by the translation. JavaScript
  // string literals are escaped before we get here; macro arguments and link
  // labels have no escape syntax, so introducing their delimiter blocks.
  findings.push(...contextDelimiterFindings(context, fromRaw, toRaw));

  let structural = { blocking: [], findings: [] };
  try {
    // Compare in the placeholder-aware domain: a variable restored from a
    // placeholder must not lose its identifier boundary just because the
    // translation puts a CJK character directly in front of it (see
    // `placeholderDomain` in protection-v3.mjs). With no placeholders the
    // domain *is* the raw text, so a plain unit behaves exactly as before.
    structural = compareStructures(
      placeholderDomain(protectedText, placeholders),
      placeholderDomain(translatedProtected, placeholders),
      { allow, allowPronounOmission: omissions },
    );
  } catch (e) { findings.push({ code: 'V3_ERROR', detail: String(e && e.message) }); }
  for (const b of structural.blocking || []) findings.push({ code: `V3_${b.code}`, detail: b.detail });

  const codes = [...new Set(findings.map((f) => f.code))];
  return { ok: findings.length === 0, codes, findings, structural, allowPronounOmission: omissions };
}

/** Raw-domain check for a pair with no protected placeholders. */
export function verifyRawEntry({ fromRaw, toRaw, allow = [], context = null }) {
  const findings = [];
  const omissions = derivePronounOmissions(fromRaw, toRaw);
  if (typeof toRaw !== 'string' || toRaw.trim() === '') findings.push({ code: 'EMPTY_TRANSLATION', detail: '' });
  if (fromRaw === toRaw) findings.push({ code: 'NO_OP', detail: '' });
  findings.push(...contextDelimiterFindings(context, fromRaw, toRaw));
  let structural = { blocking: [] };
  try { structural = compareStructures(fromRaw, toRaw, { allow, allowPronounOmission: omissions }); } catch (e) { findings.push({ code: 'V3_ERROR', detail: String(e && e.message) }); }
  for (const b of structural.blocking || []) findings.push({ code: `V3_${b.code}`, detail: b.detail });
  const codes = [...new Set(findings.map((f) => f.code))];
  return { ok: findings.length === 0, codes, findings, structural, allowPronounOmission: omissions };
}
