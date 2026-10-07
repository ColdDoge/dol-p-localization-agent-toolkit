/*
 * Orchestration for the localization-kit export / import commands.
 *
 * Export builds the kit from the current inventory and the user's localization
 * state; import validates the returned kit against the current target, verifies
 * every entry, and produces the localization-state records to persist. Neither
 * side calls a model, reads a device, or reads a private store.
 */

import { buildKit, importKitZip, exportKitZip, segmentFromUnit, checkKitEntry } from './kit.mjs';
import { sourceFingerprint, structuralKey, protectedHash, inventoryFingerprintOf } from './structure-cache.mjs';
import { classifyCoverage } from './coverage.mjs';

const CONTEXT_CHARS = 160;

function contextSlices(unit, byName) {
  const p = unit && byName.get(unit.passage);
  if (!p) return { contextBefore: '', contextAfter: '' };
  const start = Math.max(0, unit.startOffset - CONTEXT_CHARS);
  const end = Math.min(p.content.length, unit.endOffset + CONTEXT_CHARS);
  return {
    contextBefore: p.content.slice(start, unit.startOffset),
    contextAfter: p.content.slice(unit.endOffset, end),
  };
}

/**
 * Export a kit.
 *
 * scope: `all` | `untranslated` | `missing` (= untranslated) | `changed` (= superseded)
 */
export function runKitExport({
  story,
  byName,
  units,
  byUnitId,
  records = new Map(),
  scope = 'all',
  limit = 0,
  sourceVersion = null,
  sourceCommit = null,
  targetLanguage = null,
  glossary = [],
}) {
  let candidates = units;
  if (scope !== 'all') {
    const report = classifyCoverage({ units, records });
    const wanted = scope === 'changed' ? 'superseded' : 'untranslated'; // missing === untranslated
    candidates = units.filter((u) => (report.byUnitId.get(u.unitId) || {}).state === wanted);
  }
  if (limit > 0) candidates = candidates.slice(0, limit);

  const segments = candidates.map((u) => segmentFromUnit(u, contextSlices(u, byName)));
  const kit = buildKit({
    story, sourceVersion, sourceCommit, targetLanguage,
    inventoryFingerprint: inventoryFingerprintOf(units),
    scope, segments, glossary,
  });
  return { kit, segments, exported: segments.length };
}

export function writeKit(kit, zipPath) {
  return exportKitZip(kit, zipPath);
}

/**
 * Import a kit and validate it against the current target.
 *
 * Returns per-entry results and the localization-state records to persist.
 * A kit entry is accepted only when identity + hashes + structural QA all pass.
 */
export function runKitImport({ story, byUnitId, kitZipPath, requireComplete = false, importedAt = new Date().toISOString() }) {
  const kit = importKitZip(kitZipPath);
  const targetStoryMatch = kit.manifest.targetStory && kit.manifest.targetStory.sha256 === story.sha256;
  if (!targetStoryMatch) {
    return {
      ok: false,
      reason: 'target-story-mismatch',
      manifestStory: kit.manifest.targetStory && kit.manifest.targetStory.sha256,
      currentStory: story.sha256,
      accepted: [], rejected: [], deferred: [], conflicts: kit.conflicts, records: [],
    };
  }

  const accepted = [];
  const rejected = [];
  const deferred = [];
  const records = [];
  const seen = new Set();

  for (const entry of kit.units) {
    const unit = byUnitId.get(entry.unitId);
    if (!unit) { rejected.push({ unitId: entry.unitId, reason: 'unit-not-in-target' }); continue; }
    if (seen.has(entry.unitId)) { rejected.push({ unitId: entry.unitId, reason: 'duplicate-unit' }); continue; }
    seen.add(entry.unitId);

    const r = checkKitEntry(unit, entry);
    if (r.status === 'missing') { deferred.push({ unitId: entry.unitId }); continue; }
    if (r.status === 'rejected') { rejected.push({ unitId: entry.unitId, reason: r.reason, codes: r.codes || [] }); continue; }

    accepted.push({ unitId: entry.unitId });
    records.push({
      unitId: unit.unitId,
      passage: unit.passage,
      translation: r.toRaw,
      protectedTranslation: r.translatedProtected,
      sourceFingerprint: sourceFingerprint(unit),
      structuralFingerprint: structuralKey(unit),
      protectedHash: protectedHash(unit),
      targetStorySha256: story.sha256,
      importedAt,
    });
  }

  const kitUnitCount = kit.units.length;
  const coverageOk = accepted.length + deferred.length + rejected.length + kit.conflicts.length === kitUnitCount;
  const ok = coverageOk && (!requireComplete || (deferred.length === 0 && rejected.length === 0 && kit.conflicts.length === 0));

  return {
    ok,
    reason: ok ? null : 'kit-not-complete',
    coverageOk,
    kitUnitCount,
    accepted, rejected, deferred,
    conflicts: kit.conflicts,
    records,
    manifest: kit.manifest,
  };
}
