/*
 * Deterministic structure cache.
 *
 * The cache is a transparent accelerator, never a user-facing mode and never a
 * store of translations. It records only machine-derived facts about a target
 * story: the story identity, the canonical inventory fingerprint, the
 * provenance map, and the rule-catalog fingerprint. It is reusable only when
 * the target story SHA matches, and a hit merely skips parse / align time.
 *
 * There is deliberately no translation layer here: this toolkit does not keep
 * a translation memory or a verified-translation cache, and a cache hit can
 * never supply a translation.
 *
 * Wire format (store-only zip, produced with `zip.mjs`):
 *
 *   manifest.json     identity + compatibility contract
 *   structure.json    structure payload
 *   README.md         human-readable contract summary
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createZip, readStoredEntry } from './zip.mjs';
import { structuralFingerprint } from './protection-v3.mjs';
import { normalizeSource } from './workspace.mjs';

export const STRUCTURE_CACHE_SCHEMA_VERSION = '1.0.0';
export const STRUCTURE_CACHE_KIND = 'dol-p-structure-cache';

export const STRUCTURE_FILES = {
  manifest: 'manifest.json',
  structure: 'structure.json',
  readme: 'README.md',
};

function sha(text, n = 16) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text)).digest('hex').slice(0, n);
}

/** Content key of a unit — position independent. */
export function sourceFingerprint(unit) {
  return sha(normalizeSource(unit.protectedText));
}

/** Structural key of a unit — macro / conditional / link shape, position free. */
export function structuralKey(unit) {
  return sha(JSON.stringify(structuralFingerprint(unit.rawText)));
}

/** Protected-text hash of a unit. */
export function protectedHash(unit) {
  return sha(unit.protectedText, 24);
}

/** sha256 over the sorted (unitId, protectedHash) pairs — a target fingerprint. */
export function inventoryFingerprintOf(units) {
  const lines = units.map((u) => `${u.unitId}\u0000${protectedHash(u)}`).sort();
  return `sha256:${sha(lines.join('\n'), 32)}`;
}

export function buildStructureCache({
  story,
  sourceVersion = null,
  sourceCommit = null,
  pipeline = null,
  inventoryStats = null,
  provenance = null,
  ruleCatalog = null,
  generatedAt = new Date().toISOString(),
}) {
  return {
    manifest: {
      schemaVersion: STRUCTURE_CACHE_SCHEMA_VERSION,
      kind: STRUCTURE_CACHE_KIND,
      generatedAt,
      targetStory: {
        sha256: story.sha256,
        bytes: story.size,
        passages: story.passages.length,
        ifid: story.storyAttrs ? story.storyAttrs.ifid || null : null,
        format: story.storyAttrs ? `${story.storyAttrs.format} ${story.storyAttrs['format-version']}` : null,
      },
      source: { version: sourceVersion, commit: sourceCommit, pipeline },
    },
    structure: {
      story: { sha256: story.sha256, bytes: story.size, passages: story.passages.length },
      inventory: inventoryStats,
      provenance,
      ruleCatalog,
    },
  };
}

export function exportStructureCache(cache, zipPath) {
  const manifest = `${JSON.stringify(cache.manifest, null, 2)}\n`;
  const structure = `${JSON.stringify(cache.structure, null, 2)}\n`;
  const readme = [
    '# Structure cache',
    '',
    `schemaVersion: ${cache.manifest.schemaVersion}`,
    `target story sha256: ${cache.manifest.targetStory.sha256}`,
    `source version: ${cache.manifest.source.version}`,
    '',
    'This cache holds machine-derived structure facts only. It contains no',
    'translations. Reuse requires an identical target story sha256.',
    '',
  ].join('\n');
  const buf = createZip([
    { name: STRUCTURE_FILES.manifest, data: manifest },
    { name: STRUCTURE_FILES.structure, data: structure },
    { name: STRUCTURE_FILES.readme, data: readme },
  ]);
  fs.mkdirSync(path.dirname(path.resolve(zipPath)), { recursive: true });
  fs.writeFileSync(zipPath, buf);
  return { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

export function importStructureCache(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const manifest = JSON.parse(readStoredEntry(buf, STRUCTURE_FILES.manifest).toString('utf8'));
  if (manifest.kind !== STRUCTURE_CACHE_KIND) throw new Error(`not a structure cache: kind=${manifest.kind}`);
  const major = String(manifest.schemaVersion || '').split('.')[0];
  if (major !== STRUCTURE_CACHE_SCHEMA_VERSION.split('.')[0]) {
    throw new Error(`unsupported structure cache schemaVersion ${manifest.schemaVersion}`);
  }
  const structure = JSON.parse(readStoredEntry(buf, STRUCTURE_FILES.structure).toString('utf8'));
  return { manifest, structure };
}

/** True when a structure cache's payload is reusable for `story`. */
export function structureCacheCompatible(cache, story) {
  return Boolean(cache && cache.manifest && story && cache.manifest.targetStory.sha256 === story.sha256);
}
