/*
 * Orchestration for the localization-kit export / import commands.
 *
 * Export builds the kit from the current inventory and the user's localization
 * state; import validates the returned kit against the current target, verifies
 * every entry, and produces the localization-state records to persist. Neither
 * side calls a model, reads a device, or reads a private store.
 */

import { buildKit, importKitZip, exportKitZip, segmentFromUnit, checkKitEntry, repairReadmeText } from './kit.mjs';
import fs from 'node:fs';
import path from 'node:path';

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
 * Select the units an export should carry: apply the scope filter first, then
 * the `--limit` cap, over the stable inventory order. Pure and deterministic.
 *
 * scope: `all` | `untranslated` | `missing` (= untranslated) | `changed` (= superseded)
 */
export function selectExportCandidates({ units, records = new Map(), scope = 'all', limit = 0 }) {
  let candidates = units;
  if (scope !== 'all') {
    const report = classifyCoverage({ units, records });
    const wanted = scope === 'changed' ? 'superseded' : 'untranslated'; // missing === untranslated
    candidates = units.filter((u) => (report.byUnitId.get(u.unitId) || {}).state === wanted);
  }
  if (limit > 0) candidates = candidates.slice(0, limit);
  return candidates;
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
  const candidates = selectExportCandidates({ units, records, scope, limit });
  const segments = candidates.map((u) => segmentFromUnit(u, contextSlices(u, byName)));
  const kit = buildKit({
    story, sourceVersion, sourceCommit, targetLanguage,
    inventoryFingerprint: inventoryFingerprintOf(units),
    scope, segments, glossary,
  });
  return { kit, segments, exported: segments.length };
}

/**
 * Split one export run into several self-contained kits, in stable inventory
 * order. Every candidate lands in exactly one chunk; the last chunk may be
 * short. Each chunk shares the run identity (target story, source version,
 * language, glossary, inventory fingerprint) but reports its own
 * `exportedCount`. Pure: callers write the files.
 */
export function runKitExportChunked({
  story,
  byName,
  units,
  records = new Map(),
  scope = 'all',
  limit = 0,
  chunkSize,
  sourceVersion = null,
  sourceCommit = null,
  targetLanguage = null,
  glossary = [],
  generatedAt = new Date().toISOString(),
}) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  const candidates = selectExportCandidates({ units, records, scope, limit });
  const inventoryFingerprint = inventoryFingerprintOf(units);
  const chunks = [];
  for (let i = 0; i < candidates.length; i += chunkSize) {
    const slice = candidates.slice(i, i + chunkSize);
    const segments = slice.map((u) => segmentFromUnit(u, contextSlices(u, byName)));
    const kit = buildKit({
      story, sourceVersion, sourceCommit, targetLanguage,
      inventoryFingerprint, scope, segments, glossary, generatedAt,
    });
    chunks.push({ kit, segments, exported: segments.length });
  }
  return { chunks, totalSegments: candidates.length, candidates, inventoryFingerprint };
}

export function writeKit(kit, zipPath) {
  return exportKitZip(kit, zipPath);
}

/**
 * Write a chunked export to `outputDir`:
 *   localization-kit-001.zip, localization-kit-002.zip, ... , index.json
 *
 * The number width is at least 3 and grows with the chunk count. Returns the
 * written index plus its path.
 */
export function writeChunkedKitExport({
  chunks,
  outputDir,
  scope,
  story,
  chunkSize,
  sourceVersion = null,
  targetLanguage = null,
  inventoryFingerprint = null,
  generatedAt = new Date().toISOString(),
}) {
  if (!outputDir) throw new Error('writeChunkedKitExport needs an outputDir');
  fs.mkdirSync(outputDir, { recursive: true });
  const entries = [];
  let totalSegments = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const filename = chunkFilename(i, chunks.length);
    const written = exportKitZip(chunks[i].kit, path.join(outputDir, filename));
    entries.push({ filename, segmentCount: chunks[i].segments.length, sha256: written.sha256 });
    totalSegments += chunks[i].segments.length;
  }
  const index = {
    kind: 'dol-p-localization-kit-index',
    generatedAt,
    targetStory: story.sha256,
    scope,
    sourceVersion,
    targetLanguage,
    inventoryFingerprint,
    totalSegments,
    chunkSize,
    chunkCount: chunks.length,
    chunks: entries,
  };
  const indexPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  return { index, indexPath, chunkCount: chunks.length, totalSegments };
}

/**
 * Stable chunk filename. The number is zero-padded to at least 3 digits and
 * grows automatically once the chunk count exceeds 999.
 */
export function chunkFilename(index, chunkCount) {
  const width = Math.max(3, String(chunkCount).length);
  return `localization-kit-${String(index + 1).padStart(width, '0')}.zip`;
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
      accepted: [], rejected: [], deferred: [], conflicts: kit.conflicts, blockers: [], records: [],
      manifest: kit.manifest,
      files: kit.files,
    };
  }

  const accepted = [];
  const rejected = [];
  const deferred = [];
  const records = [];
  const blockers = [];
  const seen = new Set();

  for (const entry of kit.units) {
    const unit = byUnitId.get(entry.unitId);
    if (!unit) {
      const b = { unitId: entry.unitId, status: 'rejected', reason: 'unit-not-in-target' };
      rejected.push({ unitId: entry.unitId, reason: b.reason });
      blockers.push(b);
      continue;
    }
    if (seen.has(entry.unitId)) {
      const b = { unitId: entry.unitId, status: 'rejected', reason: 'duplicate-unit' };
      rejected.push({ unitId: entry.unitId, reason: b.reason });
      blockers.push(b);
      continue;
    }
    seen.add(entry.unitId);

    const r = checkKitEntry(unit, entry);
    if (r.status === 'missing') {
      deferred.push({ unitId: entry.unitId });
      blockers.push({ unitId: entry.unitId, status: 'deferred', reason: 'empty-translation' });
      continue;
    }
    if (r.status === 'rejected') {
      rejected.push({ unitId: entry.unitId, reason: r.reason, codes: r.codes || [] });
      blockers.push({
        unitId: entry.unitId,
        status: 'rejected',
        reason: r.reason,
        codes: r.codes || [],
        // Keep the submitted (rejected) translation so the repair kit shows the
        // user exactly what they wrote instead of silently clearing it.
        submittedTranslation: entry.translation == null ? '' : String(entry.translation),
      });
      continue;
    }

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

  // A JSONL/CSV conflict never produced a usable unit, so it is a blocker too.
  for (const c of kit.conflicts) {
    blockers.push({
      unitId: c.unitId,
      status: 'conflict',
      reason: c.reason || 'jsonl-csv-conflict',
      codes: [],
      jsonlTranslation: c.jsonlTranslation == null ? '' : String(c.jsonlTranslation),
      csvTranslation: c.csvTranslation == null ? '' : String(c.csvTranslation),
    });
  }

  // Every distinct kit input is either a merged unit (accepted / deferred /
  // rejected) or a JSONL/CSV conflict. A conflict is *classified and recorded*,
  // not silently dropped, so it must not make `coverageOk` false. `coverageOk`
  // means "the whole input was accounted for", not "there were no problems" —
  // blocking is expressed through `blockers` and `blockerTotal`.
  const kitUnitCount = kit.units.length + kit.conflicts.length;
  const classifiedTotal = accepted.length + deferred.length + rejected.length + kit.conflicts.length;
  const coverageOk = classifiedTotal === kitUnitCount;
  const blockerTotal = rejected.length + deferred.length + kit.conflicts.length;
  const ok = coverageOk && (!requireComplete || blockerTotal === 0);

  return {
    ok,
    reason: ok ? null : 'kit-not-complete',
    coverageOk,
    kitUnitCount,
    accepted, rejected, deferred,
    conflicts: kit.conflicts,
    blockers,
    blockerTotal,
    records,
    manifest: kit.manifest,
    files: kit.files,
  };
}

/**
 * Build an in-memory repair kit from import blockers.
 *
 * Only entries the import could not accept are carried: rejected (with the
 * user's submitted translation kept for editing), deferred (empty), and
 * JSONL/CSV conflicts (empty in both files so the repair kit cannot re-conflict;
 * the two original values go to `issues.jsonl`). Identity and hashes are
 * regenerated from the CURRENT target unit, so the repaired kit re-imports
 * cleanly against the same target. Pure: does not touch the filesystem.
 */
export function buildRepairKit({
  story,
  byName = null,
  byUnitId,
  sourceManifest = {},
  blockers = [],
  glossary = [],
  generatedAt = new Date().toISOString(),
}) {
  const allowedScopes = ['all', 'untranslated', 'missing', 'changed'];
  const scope = allowedScopes.includes(sourceManifest.scope) ? sourceManifest.scope : 'all';
  const segments = [];
  const issues = [];
  const skipped = [];
  for (const b of blockers) {
    const unit = byUnitId.get(b.unitId);
    if (!unit) { skipped.push({ unitId: b.unitId, reason: b.reason || 'unit-not-in-target' }); continue; }
    const seg = segmentFromUnit(unit, byName ? contextSlices(unit, byName) : {});
    // rejected: keep what the user wrote. deferred / conflict: leave empty.
    seg.translation = b.status === 'rejected' && b.submittedTranslation != null ? String(b.submittedTranslation) : '';
    segments.push(seg);
    const issue = { unitId: b.unitId, status: b.status, reason: b.reason, codes: b.codes || [] };
    if (b.status === 'conflict') {
      issue.jsonlTranslation = b.jsonlTranslation == null ? '' : String(b.jsonlTranslation);
      issue.csvTranslation = b.csvTranslation == null ? '' : String(b.csvTranslation);
    }
    issues.push(issue);
  }
  const kit = buildKit({
    story,
    sourceVersion: sourceManifest.sourceVersion == null ? null : sourceManifest.sourceVersion,
    sourceCommit: sourceManifest.sourceCommit == null ? null : sourceManifest.sourceCommit,
    inventoryFingerprint: sourceManifest.inventoryFingerprint == null ? null : sourceManifest.inventoryFingerprint,
    targetLanguage: sourceManifest.targetLanguage == null ? null : sourceManifest.targetLanguage,
    scope,
    segments,
    glossary,
    generatedAt,
  });
  return { kit, segments, issues, skipped };
}

/** Write a repair kit to a store-only zip (localization-kit layout + issues.jsonl). */
export function writeRepairKit(repair, zipPath) {
  return exportKitZip(repair.kit, zipPath, {
    readme: repairReadmeText(repair.kit, repair.issues),
    issues: repair.issues,
  });
}
