/*
 * The user's localization state.
 *
 * This is the user's own localization data — imported translations and their
 * provenance — kept as a JSONL workspace file. It is NOT a translation memory:
 * the toolkit never treats it as a reusable cross-project cache, never fills
 * missing units from it automatically, and never ships it.
 *
 * Record shape (one JSON object per line):
 *   { unitId, passage, translation, protectedTranslation,
 *     sourceFingerprint, structuralFingerprint, protectedHash,
 *     targetStorySha256, importedAt }
 */

import fs from 'node:fs';
import path from 'node:path';

import { sourceFingerprint, structuralKey, protectedHash } from './structure-cache.mjs';

export function loadState(file) {
  const map = new Map();
  if (!file || !fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && o.unitId) map.set(o.unitId, o);
    } catch { /* skip malformed line */ }
  }
  return map;
}

export function writeState(file, records) {
  const list = Array.isArray(records) ? records : [...records.values()];
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, list.map((r) => JSON.stringify(r)).join('\n') + (list.length ? '\n' : ''));
  return list.length;
}

/** Merge imported records into an existing state map (imported records win). */
export function mergeRecords(existing, imported) {
  const merged = new Map(existing);
  for (const r of imported) merged.set(r.unitId, r);
  return merged;
}

/**
 * Turn a validated localization source (passage/from/to entries) into state
 * records by matching each entry to the unit it replaces. Entries that match no
 * current unit are returned as `unmatched` (they may be obsolete or use a
 * different granularity than the inventory).
 */
export function recordsFromLocalizationSource({ resolved, units, story }) {
  const byPassage = new Map();
  for (const u of units) {
    if (!byPassage.has(u.passage)) byPassage.set(u.passage, []);
    byPassage.get(u.passage).push(u);
  }
  const records = [];
  const unmatched = [];
  for (const entry of resolved) {
    const pool = byPassage.get(entry.passage) || [];
    const matches = pool.filter((u) => u.rawText === entry.from);
    if (!matches.length) { unmatched.push({ passage: entry.passage, from: entry.from }); continue; }
    for (const u of matches) {
      records.push({
        unitId: u.unitId,
        passage: u.passage,
        translation: entry.to,
        protectedTranslation: null,
        sourceFingerprint: sourceFingerprint(u),
        structuralFingerprint: structuralKey(u),
        protectedHash: protectedHash(u),
        targetStorySha256: story.sha256,
        importedAt: null,
        origin: 'localization-source',
      });
    }
  }
  return { records, unmatched };
}

/**
 * Explicit migration: move records that already exist for an older target onto
 * the new target when — and only when — the source text AND structure are
 * byte-identical (same source fingerprint and structural key). This is not
 * translation reuse: it re-homes an identical, already-present record. Records
 * whose text changed are reported as `changed`, and records with no match as
 * `obsolete`.
 */
export function migrateRecords({ records, units }) {
  const byUnitId = new Map(units.map((u) => [u.unitId, u]));
  const byContentKey = new Map();
  for (const u of units) byContentKey.set(`${sourceFingerprint(u)}|${structuralKey(u)}`, u);

  const out = [];
  const kept = [];
  const moved = [];
  const changed = [];
  const obsolete = [];

  for (const rec of records.values()) {
    const direct = byUnitId.get(rec.unitId);
    if (direct) { out.push(rec); kept.push(rec.unitId); continue; }
    const key = `${rec.sourceFingerprint}|${rec.structuralFingerprint}`;
    const target = byContentKey.get(key);
    if (target) {
      out.push({
        ...rec,
        unitId: target.unitId,
        passage: target.passage,
        protectedHash: protectedHash(target),
        targetStorySha256: undefined,
        origin: 'migrated',
      });
      moved.push({ from: rec.unitId, to: target.unitId });
      continue;
    }
    // A record for a unit that still exists but whose source text changed.
    if (byUnitId.has(rec.unitId) === false && looksLikeSamePosition(rec, units)) changed.push(rec.unitId);
    else obsolete.push(rec.unitId);
  }
  return { records: out, kept, moved, changed, obsolete };
}

function looksLikeSamePosition(rec, units) {
  return units.some((u) => u.passage === rec.passage);
}
