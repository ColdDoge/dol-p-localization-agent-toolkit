import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { makeFixtureWith, pseudoProtected } from './helpers/fixture.mjs';
import { runKitExportChunked, runKitExport, writeChunkedKitExport, writeKit, runKitImport, chunkFilename } from '../src/lib/kit-run.mjs';
import { importKitZip } from '../src/lib/kit.mjs';
import { sourceFingerprint, structuralKey, protectedHash } from '../src/lib/structure-cache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RUN = path.join(REPO, 'core', 'src', 'run.mjs');
const FIXED_TIME = '2026-01-01T00:00:00.000Z';

function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [RUN, ...args], { cwd: REPO, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

/** Run the library chunked export + write, returning the on-disk index. */
function chunked(fx, chunkSize, { scope = 'all', limit = 0, tag = '' } = {}) {
  const outputDir = path.join(fx.dir, `kits-${chunkSize}-${limit}${tag}`);
  const { chunks, totalSegments, inventoryFingerprint } = runKitExportChunked({
    story: fx.story, byName: fx.byName, units: fx.units, scope, limit, chunkSize,
    sourceVersion: 'test', targetLanguage: 'xx-pseudo', generatedAt: FIXED_TIME,
  });
  const written = writeChunkedKitExport({
    chunks, outputDir, scope, story: fx.story, chunkSize,
    sourceVersion: 'test', targetLanguage: 'xx-pseudo', inventoryFingerprint, generatedAt: FIXED_TIME,
  });
  return { outputDir, written, chunks, totalSegments, inventoryFingerprint };
}

function unitIdsOfChunks(chunks) {
  return chunks.flatMap((c) => c.segments.map((s) => s.unitId));
}

test('chunk export: single --output export is unchanged (no chunking)', () => {
  const fx = makeFixtureWith(4);
  const kitZip = path.join(fx.dir, 'single-kit.zip');
  const exp = cli(['kit', 'export', '--story', fx.storyPath, '--output', kitZip, '--scope', 'all', '--source-version', 'test']);
  assert.equal(exp.code, 0, exp.stderr);
  assert.ok(fs.existsSync(kitZip));
  const kit = importKitZip(kitZip);
  assert.equal(kit.units.length, fx.units.length);
  assert.equal(kit.manifest.exportedCount, fx.units.length);
  // A single export writes only the zip; no index.json sidecar.
  assert.equal(fs.existsSync(path.join(fx.dir, 'index.json')), false);
});

test('chunk export: exact division into chunks', () => {
  const fx = makeFixtureWith(10);
  const { written, chunks } = chunked(fx, 5);
  assert.equal(chunks.length, 2);
  assert.deepEqual(written.index.chunks.map((c) => c.segmentCount), [5, 5]);
  assert.equal(written.index.totalSegments, 10);
  assert.equal(written.index.chunkSize, 5);
});

test('chunk export: last chunk may be short', () => {
  const fx = makeFixtureWith(11);
  const { written } = chunked(fx, 5);
  assert.deepEqual(written.index.chunks.map((c) => c.segmentCount), [5, 5, 1]);
});

test('chunk export: --limit is applied before chunking', () => {
  const fx = makeFixtureWith(10);
  const { written, totalSegments } = chunked(fx, 3, { limit: 7 });
  assert.equal(totalSegments, 7);
  assert.deepEqual(written.index.chunks.map((c) => c.segmentCount), [3, 3, 1]);
  assert.equal(written.index.totalSegments, 7);
});

test('chunk export: every unit appears exactly once, no duplicates, no gaps, stable order', () => {
  const fx = makeFixtureWith(13);
  const expected = fx.units.map((u) => u.unitId);
  const first = chunked(fx, 4, { tag: '-a' });
  const second = chunked(fx, 4, { tag: '-b' });
  const idsA = unitIdsOfChunks(first.chunks);
  const idsB = unitIdsOfChunks(second.chunks);
  assert.equal(idsA.length, fx.units.length);
  assert.equal(new Set(idsA).size, idsA.length, 'no duplicate unit ids');
  assert.deepEqual(idsA, expected, 'stable inventory order preserved');
  assert.deepEqual(idsA, idsB, 'same order across runs');
});

test('chunk export: filenames are zero-padded to at least 3 digits', () => {
  const fx = makeFixtureWith(12);
  const { written } = chunked(fx, 1);
  assert.equal(written.index.chunkCount, 12);
  assert.equal(written.index.chunks[0].filename, 'localization-kit-001.zip');
  assert.equal(written.index.chunks[11].filename, 'localization-kit-012.zip');
});

test('chunk export: filename width grows past 999 chunks', () => {
  assert.equal(chunkFilename(0, 3), 'localization-kit-001.zip');
  assert.equal(chunkFilename(998, 999), 'localization-kit-999.zip');
  assert.equal(chunkFilename(0, 1000), 'localization-kit-0001.zip');
  assert.equal(chunkFilename(999, 1000), 'localization-kit-1000.zip');
  assert.equal(chunkFilename(0, 1500), 'localization-kit-0001.zip');
});

test('chunk export: every chunk carries the full kit file set', () => {
  const fx = makeFixtureWith(5);
  const { outputDir } = chunked(fx, 3);
  for (const filename of ['localization-kit-001.zip', 'localization-kit-002.zip']) {
    const kit = importKitZip(path.join(outputDir, filename));
    assert.equal(kit.hasJsonl, true);
    assert.equal(kit.hasCsv, true);
    assert.equal(typeof kit.files.readme, 'string');
    assert.equal(typeof kit.files.rules, 'string');
    assert.equal(typeof kit.files.glossaryCsv, 'string');
  }
});

test('chunk export: index.json has the required fields and per-chunk sha256', () => {
  const fx = makeFixtureWith(6);
  const { outputDir, written } = chunked(fx, 4);
  const onDisk = JSON.parse(fs.readFileSync(path.join(outputDir, 'index.json'), 'utf8'));
  assert.equal(onDisk.targetStory, fx.story.sha256);
  assert.equal(onDisk.scope, 'all');
  assert.equal(onDisk.totalSegments, 6);
  assert.equal(onDisk.chunkSize, 4);
  assert.equal(onDisk.chunkCount, 2);
  assert.deepEqual(onDisk.chunks.map((c) => c.filename), ['localization-kit-001.zip', 'localization-kit-002.zip']);
  assert.deepEqual(onDisk.chunks.map((c) => c.segmentCount), [4, 2]);
  for (const c of onDisk.chunks) assert.match(c.sha256, /^[0-9a-f]{64}$/);
  assert.equal(onDisk.inventoryFingerprint, written.index.inventoryFingerprint);
});

test('chunk export: each chunk is a valid, independently importable kit', () => {
  const fx = makeFixtureWith(9);
  const { chunks, outputDir } = chunked(fx, 4);
  const merged = new Map();
  let acceptedTotal = 0;
  chunks.forEach((c, i) => {
    const filename = `localization-kit-${String(i + 1).padStart(3, '0')}.zip`;
    const zipPath = path.join(outputDir, filename);
    const kit = importKitZip(zipPath);
    // Same shared identity as the run, own exportedCount.
    assert.equal(kit.manifest.targetStory.sha256, fx.story.sha256);
    assert.equal(kit.manifest.sourceVersion, 'test');
    assert.equal(kit.manifest.targetLanguage, 'xx-pseudo');
    assert.equal(kit.manifest.exportedCount, c.segments.length);

    const filled = kit.jsonl.map((s) => ({ ...s, translation: pseudoProtected(s.protectedSource) }));
    const filledZip = path.join(fx.dir, `filled-${i}.zip`);
    writeKit({ manifest: kit.manifest, segments: filled, glossary: [] }, filledZip);
    const imp = runKitImport({ story: fx.story, byUnitId: fx.byUnitId, kitZipPath: filledZip, requireComplete: true });
    assert.equal(imp.ok, true, JSON.stringify({ rejected: imp.rejected, deferred: imp.deferred, conflicts: imp.conflicts }));
    for (const r of imp.records) merged.set(r.unitId, r);
    acceptedTotal += imp.accepted.length;
  });
  assert.equal(acceptedTotal, fx.units.length);
  assert.equal(merged.size, fx.units.length);
});

test('chunk export CLI: writes multiple kits + index and reports each count', () => {
  const fx = makeFixtureWith(7);
  const outDir = path.join(fx.dir, 'cli-kits');
  const exp = cli([
    'kit', 'export', '--story', fx.storyPath, '--scope', 'all',
    '--chunk-size', '3', '--output-dir', outDir, '--source-version', 'test',
  ]);
  assert.equal(exp.code, 0, exp.stderr + exp.stdout);
  assert.ok(fs.existsSync(path.join(outDir, 'localization-kit-001.zip')));
  assert.ok(fs.existsSync(path.join(outDir, 'localization-kit-002.zip')));
  assert.ok(fs.existsSync(path.join(outDir, 'localization-kit-003.zip')));
  assert.ok(fs.existsSync(path.join(outDir, 'index.json')));
  const index = JSON.parse(fs.readFileSync(path.join(outDir, 'index.json'), 'utf8'));
  assert.deepEqual(index.chunks.map((c) => c.segmentCount), [3, 3, 1]);
  assert.equal(index.chunkCount, 3);
});

test('chunk export CLI: invalid argument combinations fail clearly', () => {
  const fx = makeFixtureWith(3);
  const out1 = cli(['kit', 'export', '--story', fx.storyPath, '--chunk-size', '0', '--output-dir', path.join(fx.dir, 'x')]);
  assert.equal(out1.code, 2, out1.stdout);
  assert.match(out1.stderr, /chunk-size/);

  const out2 = cli(['kit', 'export', '--story', fx.storyPath, '--chunk-size', '5']);
  assert.equal(out2.code, 2, out2.stdout);
  assert.match(out2.stderr, /output-dir/);

  const out3 = cli(['kit', 'export', '--story', fx.storyPath, '--output-dir', path.join(fx.dir, 'y')]);
  assert.equal(out3.code, 2, out3.stdout);
  assert.match(out3.stderr, /chunk-size/);

  const out4 = cli(['kit', 'export', '--story', fx.storyPath, '--chunk-size', '5', '--output-dir', path.join(fx.dir, 'z'), '--output', path.join(fx.dir, 'z.zip')]);
  assert.equal(out4.code, 2, out4.stdout);
  assert.match(out4.stderr, /output/i);

  const out5 = cli(['kit', 'export', '--story', fx.storyPath, '--chunk-size', 'nope', '--output-dir', path.join(fx.dir, 'w')]);
  assert.equal(out5.code, 2, out5.stdout);
  assert.match(out5.stderr, /chunk-size/);
});

test('chunk export: unknown --scope is rejected', () => {
  const fx = makeFixtureWith(3);
  const bad = cli(['kit', 'export', '--story', fx.storyPath, '--output', path.join(fx.dir, 'k.zip'), '--scope', 'nope']);
  assert.equal(bad.code, 2, bad.stdout);
  assert.match(bad.stderr, /scope/);
});

test('chunk export: scope=missing still chunks the untranslated remainder', () => {
  const fx = makeFixtureWith(5);
  // Mark two units as already translated, then export the missing ones.
  const records = new Map();
  for (const u of fx.units.slice(0, 2)) {
    records.set(u.unitId, {
      unitId: u.unitId, passage: u.passage,
      translation: pseudoProtected(u.protectedText), protectedTranslation: pseudoProtected(u.protectedText),
      sourceFingerprint: sourceFingerprint(u), structuralFingerprint: structuralKey(u), protectedHash: protectedHash(u),
    });
  }
  const outputDir = path.join(fx.dir, 'missing-kits');
  const { chunks, totalSegments, inventoryFingerprint } = runKitExportChunked({
    story: fx.story, byName: fx.byName, units: fx.units, records, scope: 'missing', chunkSize: 2, generatedAt: FIXED_TIME,
  });
  const written = writeChunkedKitExport({ chunks, outputDir, scope: 'missing', story: fx.story, chunkSize: 2, inventoryFingerprint, generatedAt: FIXED_TIME });
  assert.equal(totalSegments, 3);
  assert.deepEqual(written.index.chunks.map((c) => c.segmentCount), [2, 1]);
  assert.equal(written.index.scope, 'missing');
});

test('chunk export: runKitExport (single) still returns the same shape', () => {
  const fx = makeFixtureWith(4);
  const res = runKitExport({ story: fx.story, byName: fx.byName, units: fx.units, byUnitId: fx.byUnitId, scope: 'all' });
  assert.equal(res.exported, fx.units.length);
  assert.equal(res.kit.segments.length, fx.units.length);
});
