/*
 * Coverage state machine.
 *
 * Every unit of the *current* target is classified into exactly one state:
 *
 *   translated-valid    a user translation passed the current structural QA
 *   untranslated        the unit exists but has no usable translation
 *   rejected-structure  the supplied translation failed structural QA
 *   superseded          the source text changed, so the old translation is stale
 *   unresolved          a valid translation the planner could not place
 *   obsolete            the record no longer exists in the current target
 *
 * `missing` (export side) is the name for `untranslated`; `changed` (export
 * side) is the name for `superseded`. They are not extra persisted states.
 *
 * A `strict` build fails while any of the first four blocking states is
 * non-zero; `obsolete` never blocks, because it describes records for a target
 * that no longer exists.
 */

import { verifyEntry, verifyRawEntry } from './protect.mjs';
import { sourceFingerprint } from './structure-cache.mjs';

export const COVERAGE_STATES = [
  'translated-valid',
  'untranslated',
  'rejected-structure',
  'superseded',
  'unresolved',
  'obsolete',
];

/** States that make a `strict` build fail. */
export const STRICT_BLOCKING_STATES = [
  'untranslated',
  'rejected-structure',
  'superseded',
  'unresolved',
];

/**
 * A "structural identity" unit carries no translatable prose: every letter
 * lives inside a macro, html tag, entity, or a SugarCube wiki-link *target*
 * (`[[label|Passage Name]]`), which is an identifier the game looks up. Its
 * correct localization is the identity and no ReplacePatcher entry is emitted.
 */
export function isStructuralIdentitySource(raw) {
  let s = String(raw == null ? '' : raw);
  if (/<<\/?script>>/.test(s)) return true;
  s = s.replace(/\/%[\s\S]*?%\//g, ' ');
  s = s.replace(/\u27e6\d+\u27e7/g, ' ');
  s = s.replace(/\|[^\]]*\]\]/g, ' ');
  s = s.replace(/\[\[[^\]]*\]\]/g, ' ');
  s = s.replace(/<<[\s\S]*?>>/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&[a-zA-Z][a-zA-Z0-9]*;|&#\d+;|&#x[0-9a-fA-F]+;/g, ' ');
  s = s.replace(/"\s*"[^"]*"\s*>>/g, ' ');
  return !/[A-Za-z]/.test(s);
}

/**
 * Verify one user record against the current target unit. Uses the placeholder
 * domain when the record carries a protected translation, otherwise the raw
 * domain. Never supplies a translation on its own.
 */
export function verifyRecord(unit, record) {
  if (record.protectedTranslation != null && (unit.placeholders || []).length) {
    return verifyEntry({
      protectedText: unit.protectedText,
      placeholders: unit.placeholders,
      translatedProtected: record.protectedTranslation,
      fromRaw: unit.rawText,
      toRaw: record.translation,
      context: unit.context ?? null,
    });
  }
  return verifyRawEntry({ fromRaw: unit.rawText, toRaw: record.translation, context: unit.context ?? null });
}

/**
 * Classify every unit of the current target against the user localization
 * records (a Map of unitId -> record). Returns a full coverage report; the
 * `unresolved` state is filled in later from the planner.
 */
export function classifyCoverage({ units, records }) {
  const byUnitId = new Map();
  const counts = {
    'translated-valid': 0,
    untranslated: 0,
    'rejected-structure': 0,
    superseded: 0,
    unresolved: 0,
    obsolete: 0,
  };
  const matched = new Set();
  const details = [];

  for (const u of units) {
    const rec = records.get(u.unitId);
    if (!rec) {
      if (isStructuralIdentitySource(u.rawText)) {
        byUnitId.set(u.unitId, { state: 'translated-valid', identity: true, detail: 'structural-identity' });
        counts['translated-valid'] += 1;
      } else {
        byUnitId.set(u.unitId, { state: 'untranslated' });
        counts.untranslated += 1;
      }
      continue;
    }
    matched.add(u.unitId);

    if (rec.sourceFingerprint && rec.sourceFingerprint !== sourceFingerprint(u)) {
      byUnitId.set(u.unitId, { state: 'superseded', detail: 'source-changed' });
      counts.superseded += 1;
      details.push({ unitId: u.unitId, passage: u.passage, state: 'superseded' });
      continue;
    }
    const v = verifyRecord(u, rec);
    if (!v.ok) {
      byUnitId.set(u.unitId, { state: 'rejected-structure', codes: v.codes });
      counts['rejected-structure'] += 1;
      details.push({ unitId: u.unitId, passage: u.passage, state: 'rejected-structure', codes: v.codes });
      continue;
    }
    byUnitId.set(u.unitId, { state: 'translated-valid' });
    counts['translated-valid'] += 1;
  }

  const obsolete = [];
  for (const [unitId, rec] of records) {
    if (matched.has(unitId)) continue;
    obsolete.push({ unitId, passage: rec.passage || null });
  }
  counts.obsolete = obsolete.length;

  return { byUnitId, counts, obsolete, details };
}

/** Mark the given unit ids as `unresolved` (planner could not place them). */
export function markUnresolved(report, unresolved) {
  for (const item of unresolved) {
    const prev = report.byUnitId.get(item.unitId);
    if (prev && prev.state === 'translated-valid' && !prev.identity) {
      report.byUnitId.set(item.unitId, { state: 'unresolved', reason: item.reason || 'planner-uncovered' });
      report.counts['translated-valid'] -= 1;
      report.counts.unresolved += 1;
      report.details.push({ unitId: item.unitId, passage: item.passage || null, state: 'unresolved', reason: item.reason || 'planner-uncovered' });
    }
  }
  return report;
}

export function blockingTotal(counts) {
  return STRICT_BLOCKING_STATES.reduce((n, s) => n + (counts[s] || 0), 0);
}

export function strictPass(counts) {
  return blockingTotal(counts) === 0;
}

/** Export-side classification: `missing` = untranslated, `changed` = superseded. */
export function exportClassification(counts) {
  return {
    missing: counts.untranslated || 0,
    changed: counts.superseded || 0,
    rejected: counts['rejected-structure'] || 0,
    obsolete: counts.obsolete || 0,
  };
}
