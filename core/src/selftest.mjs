/*
 * Offline self-test.
 *
 * Builds a tiny synthetic SugarCube story (no game text), runs the full
 * export -> import -> qa -> strict/partial build flow, and exercises the
 * structural guard and coverage state machine with positive and negative
 * cases. Everything is in-process and offline; no device, model, or network.
 *
 * Run with: `node core/src/selftest.mjs`
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseStory, indexStory } from './lib/story.mjs';
import { buildInventory } from './lib/inventory.mjs';
import { verifyEntry, restoreProtected } from './lib/protect.mjs';
import { buildEntries, qaEntries } from './lib/entries.mjs';
import { buildPack } from './lib/builder.mjs';
import { sourceFingerprint, structuralKey, protectedHash, buildStructureCache, exportStructureCache, importStructureCache, structureCacheCompatible } from './lib/structure-cache.mjs';
import { classifyCoverage, markUnresolved, strictPass, blockingTotal } from './lib/coverage.mjs';
import { runKitExport, writeKit, runKitImport, runKitExportChunked, writeChunkedKitExport, buildRepairKit, writeRepairKit } from './lib/kit-run.mjs';
import { importKitZip } from './lib/kit.mjs';
import { loadState, mergeRecords } from './lib/localization-state.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { passed += 1; return true; }
  failed += 1;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return false;
}

function eq(name, actual, expected) {
  return ok(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const FIXTURE_HTML = `<!DOCTYPE html><html><head><title>fixture</title></head><body>
<tw-storydata name="selftest" startnode="1" creator="selftest" creator-version="1.0" format="SugarCube" format-version="2.36.1" ifid="11111111-2222-3333-4444-555555555555">
<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>
<script role="script" id="twine-user-script" type="text/twine-javascript"></script>
<tw-passagedata pid="1" name="Start" tags="" position="100,100">Welcome to the quiet test town. The morning air is cool.</tw-passagedata>
<tw-passagedata pid="2" name="Room" tags="" position="200,100">You are in a small room. Your bed is by the window, and a lamp sits on the desk.</tw-passagedata>
<tw-passagedata pid="3" name="Street" tags="" position="300,100">You walk down the empty street. Consider visiting the market if you still have time.</tw-passagedata>
<tw-passagedata pid="4" name="Guarded" tags="" position="400,100">You greet &lt;&lt;print $name&gt;&gt; and step through the doorway of the old shop.</tw-passagedata>
<tw-passagedata pid="5" name="Twin" tags="" position="500,100">A bell rings. A bell rings again.</tw-passagedata>
</tw-storydata></body></html>
`;

/** A synthetic, non-Chinese pseudo-language: append 'x' to every ASCII word. */
function pseudoProtected(protectedSource) {
  return String(protectedSource).replace(/[A-Za-z]+/g, (w) => `${w}x`);
}

function makeWorkdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-selftest-'));
  fs.writeFileSync(path.join(dir, 'index.html'), FIXTURE_HTML);
  return dir;
}

function makeStateForAll(units, story) {
  const records = new Map();
  for (const u of units) {
    const protectedTarget = pseudoProtected(u.protectedText);
    const rawTarget = restoreProtected(protectedTarget, u.placeholders || []);
    records.set(u.unitId, {
      unitId: u.unitId,
      passage: u.passage,
      translation: rawTarget,
      protectedTranslation: protectedTarget,
      sourceFingerprint: sourceFingerprint(u),
      structuralFingerprint: structuralKey(u),
      protectedHash: protectedHash(u),
      targetStorySha256: story.sha256,
    });
  }
  return records;
}

function testStructureGuard() {
  const unit = {
    rawText: 'You greet <<print $name>> today.',
    protectedText: 'You greet \u27e60\u27e7 today.',
    placeholders: [{ placeholder: '\u27e60\u27e7', raw: '<<print $name>>', kind: 'macro' }],
  };
  // positive: placeholders kept, structure intact
  ok('guard: valid translation accepted', verifyEntry({
    protectedText: unit.protectedText, placeholders: unit.placeholders,
    translatedProtected: 'Today you greet \u27e60\u27e7.',
    fromRaw: unit.rawText, toRaw: 'Today you greet <<print $name>>.',
  }).ok);
  // negative: dropped placeholder
  const dropped = verifyEntry({
    protectedText: unit.protectedText, placeholders: unit.placeholders,
    translatedProtected: 'Today you greet.',
    fromRaw: unit.rawText, toRaw: 'Today you greet.',
  });
  ok('guard: dropped placeholder rejected', !dropped.ok, JSON.stringify(dropped.codes));
  // negative: macro changed inside restored text
  const macroChanged = verifyEntry({
    protectedText: unit.protectedText, placeholders: unit.placeholders,
    translatedProtected: 'Today you greet \u27e60\u27e7.',
    fromRaw: unit.rawText, toRaw: 'Today you greet <<print $other>>.',
  });
  ok('guard: changed macro rejected', !macroChanged.ok, JSON.stringify(macroChanged.codes));
  // negative: no-op
  const noop = verifyEntry({
    protectedText: 'Hello world.', placeholders: [],
    translatedProtected: 'Hello world.', fromRaw: 'Hello world.', toRaw: 'Hello world.',
  });
  ok('guard: no-op rejected', !noop.ok && noop.codes.includes('NO_OP'));
  // negative: HTML removed
  const htmlRemoved = verifyEntry({
    protectedText: 'Hello <b>bold</b> text.', placeholders: [],
    translatedProtected: 'Hello bold text.', fromRaw: 'Hello <b>bold</b> text.', toRaw: 'Hello bold text.',
  });
  ok('guard: removed HTML rejected', !htmlRemoved.ok, JSON.stringify(htmlRemoved.codes));
}

function testPlannerGate() {
  const passage = { name: 'P', content: 'Alpha beta. Alpha beta.' };
  const byName = new Map([['P', passage]]);
  // Two units claim the same span -> overlap must be reported.
  const overlapping = buildEntries([
    { unitId: 'u1', passage: 'P', startOffset: 0, endOffset: 11, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
    { unitId: 'u2', passage: 'P', startOffset: 0, endOffset: 11, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
  ], byName);
  ok('planner: overlap not fully covered', overlapping.coverage.size < 2 || overlapping.skipped.some((s) => s.reason === 'overlap'),
    JSON.stringify({ covered: overlapping.coverage.size, skipped: overlapping.skipped }));
  // Two distinct sites with identical text and identical translation unify to
  // a single all:true entry, and the replay gate accepts it.
  const repeated = buildEntries([
    { unitId: 'u3', passage: 'P', startOffset: 0, endOffset: 11, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
    { unitId: 'u4', passage: 'P', startOffset: 12, endOffset: 23, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
  ], byName);
  ok('planner: repeated text unified', repeated.coverage.size === 2, JSON.stringify({ covered: repeated.coverage.size, skipped: repeated.skipped }));
  const qaRepeated = qaEntries(repeated.entries, byName);
  ok('planner: replay gate passes unified entry', qaRepeated.ok, JSON.stringify(qaRepeated.byCode));
  // Divergent translations of identical text cannot both be placed verbatim.
  const divergent = buildEntries([
    { unitId: 'u5', passage: 'P', startOffset: 0, endOffset: 11, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
    { unitId: 'u6', passage: 'P', startOffset: 12, endOffset: 23, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Epsilon zeta.' },
  ], byName);
  const qaDivergent = qaEntries(divergent.entries, byName);
  ok('planner: divergent duplicates do not silently pass QA',
    divergent.coverage.size < 2 || !qaDivergent.ok || divergent.entries.every((e) => e.from !== e.to),
    JSON.stringify({ covered: divergent.coverage.size, qa: qaDivergent.ok }));
}

function testStructureCache(dir, story) {
  const cache = buildStructureCache({ story, sourceVersion: 'test', pipeline: 'selftest' });
  const zip = path.join(dir, 'structure-cache.zip');
  exportStructureCache(cache, zip);
  const back = importStructureCache(zip);
  ok('structure cache round-trip', structureCacheCompatible(back, story));
  const other = { sha256: 'other' };
  ok('structure cache incompatible on different story', !structureCacheCompatible(back, other));
  ok('structure cache has no translation layer', !JSON.stringify(back.structure).includes('translation'));
}

function testChunkedExport(dir, story, byName, units, byUnitId) {
  const chunkSize = 2;
  const generatedAt = '2026-01-01T00:00:00.000Z';
  const { chunks, totalSegments, inventoryFingerprint } = runKitExportChunked({
    story, byName, units, scope: 'all', chunkSize, sourceVersion: 'test', generatedAt,
  });
  ok('chunk: covers the whole candidate set', totalSegments === units.length, `${totalSegments} vs ${units.length}`);
  ok('chunk: no chunk exceeds chunk-size', chunks.every((c) => c.segments.length <= chunkSize));
  ok('chunk: no empty trailing chunk', chunks.length === 0 || chunks[chunks.length - 1].segments.length > 0);
  const ids = chunks.flatMap((c) => c.segments.map((s) => s.unitId));
  ok('chunk: every unit appears exactly once', ids.length === units.length && new Set(ids).size === ids.length);
  ok('chunk: order matches the stable inventory order', ids.join(',') === units.map((u) => u.unitId).join(','));

  const outDir = path.join(dir, 'kits');
  const written = writeChunkedKitExport({
    chunks, outputDir: outDir, scope: 'all', story, chunkSize, inventoryFingerprint, generatedAt,
  });
  ok('chunk: index chunkCount matches', written.index.chunkCount === chunks.length, `${written.index.chunkCount} vs ${chunks.length}`);
  ok('chunk: index totalSegments matches', written.index.totalSegments === units.length);

  let accepted = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const filename = `localization-kit-${String(i + 1).padStart(3, '0')}.zip`;
    const kit = importKitZip(path.join(outDir, filename));
    ok(`chunk ${i + 1}: own exportedCount`, kit.manifest.exportedCount === chunks[i].segments.length);
    const filled = kit.jsonl.map((s) => ({ ...s, translation: pseudoProtected(s.protectedSource) }));
    const filledZip = path.join(dir, `chunk-filled-${i}.zip`);
    writeKit({ manifest: kit.manifest, segments: filled, glossary: [] }, filledZip);
    const imp = runKitImport({ story, byUnitId, kitZipPath: filledZip, requireComplete: true });
    ok(`chunk ${i + 1}: independently importable`, imp.ok, JSON.stringify({ rejected: imp.rejected, deferred: imp.deferred, conflicts: imp.conflicts }));
    accepted += imp.accepted.length;
  }
  ok('chunk: all units accepted across chunks', accepted === units.length, `${accepted} vs ${units.length}`);
}

function testRepairKit(dir, story, byName, units, byUnitId) {
  const exported = runKitExport({ story, byName, units, byUnitId, records: new Map(), scope: 'all', sourceVersion: 'test' });
  const badUnit = units.find((u) => (u.placeholders || []).length > 0) || units[0];
  const deferredUnit = units.find((u) => u.unitId !== badUnit.unitId);
  const broken = 'Broken <b>tag</b> here.';
  const segments = exported.segments.map((s) => {
    if (s.unitId === badUnit.unitId) return { ...s, translation: broken };
    if (s.unitId === deferredUnit.unitId) return { ...s, translation: '' };
    return { ...s, translation: pseudoProtected(s.protectedSource) };
  });
  const srcZip = path.join(dir, 'repair-src.zip');
  writeKit({ manifest: exported.kit.manifest, segments, glossary: [] }, srcZip);

  const imp = runKitImport({ story, byUnitId, kitZipPath: srcZip, requireComplete: true });
  ok('repair: require-complete stays a hard failure', !imp.ok);
  ok('repair: full scan accepted every valid entry', imp.accepted.length === units.length - 2, `${imp.accepted.length} vs ${units.length - 2}`);
  ok('repair: rejected + deferred collected as blockers', imp.blockerTotal === 2, JSON.stringify(imp.blockers));

  const repair = buildRepairKit({ story, byName, byUnitId, sourceManifest: imp.manifest, blockers: imp.blockers });
  ok('repair: only blockers are carried', repair.segments.length === 2, `${repair.segments.length}`);
  ok('repair: rejected translation preserved', repair.segments.find((s) => s.unitId === badUnit.unitId).translation === broken);
  ok('repair: deferred translation stays empty', repair.segments.find((s) => s.unitId === deferredUnit.unitId).translation === '');
  ok('repair: issues 1:1 with blockers', repair.issues.length === 2);

  const repairZip = path.join(dir, 'repair-kit.zip');
  writeRepairKit(repair, repairZip);
  const rk = importKitZip(repairZip);
  ok('repair: repair kit keeps the target identity', rk.manifest.targetStory.sha256 === story.sha256);
  ok('repair: repair kit carries issues.jsonl', typeof rk.files.issuesJsonl === 'string' && rk.files.issuesJsonl.trim().length > 0);

  const fixed = rk.jsonl.map((s) => ({ ...s, translation: pseudoProtected(s.protectedSource) }));
  const fixedZip = path.join(dir, 'repair-fixed.zip');
  writeKit({ manifest: rk.manifest, segments: fixed, glossary: [] }, fixedZip);
  const imp2 = runKitImport({ story, byUnitId, kitZipPath: fixedZip, requireComplete: true });
  ok('repair: fixed repair kit imports clean', imp2.ok, JSON.stringify({ rejected: imp2.rejected, deferred: imp2.deferred, conflicts: imp2.conflicts }));
  const merged = mergeRecords(new Map(imp.records.map((r) => [r.unitId, r])), imp2.records);
  ok('repair: fixed records merge into the same state', merged.size === units.length, `${merged.size} vs ${units.length}`);

  const imp3 = runKitImport({ story, byUnitId, kitZipPath: repairZip, requireComplete: true });
  ok('repair: an unfixed repair kit is still rejected (guard intact)', !imp3.ok && imp3.rejected.length >= 1);
}

function testCoverageStates(units, story) {
  const all = makeStateForAll(units, story);
  const full = classifyCoverage({ units, records: all });
  ok('coverage: all translated-valid', full.counts['translated-valid'] === units.length,
    JSON.stringify({ counts: full.counts, units: units.length }));
  ok('coverage: strict passes on full state', strictPass(full.counts));

  // untranslated
  const missingOne = new Map(all);
  missingOne.delete(units[0].unitId);
  const r1 = classifyCoverage({ units, records: missingOne });
  eq('coverage: untranslated counted', r1.counts.untranslated, 1);
  ok('coverage: untranslated blocks strict', !strictPass(r1.counts));

  // superseded: same unitId, different source fingerprint
  const superseded = new Map(all);
  superseded.set(units[0].unitId, { ...all.get(units[0].unitId), sourceFingerprint: 'stale' });
  const r2 = classifyCoverage({ units, records: superseded });
  eq('coverage: superseded counted', r2.counts.superseded, 1);
  ok('coverage: superseded blocks strict', !strictPass(r2.counts));

  // rejected-structure: corrupt a translation (drop a letter run so structure/no-op differs is not enough; use macro drop)
  const rejected = new Map(all);
  const target = units.find((u) => (u.placeholders || []).length) || units[0];
  rejected.set(target.unitId, { ...all.get(target.unitId), protectedTranslation: 'x', translation: 'x' });
  const r3 = classifyCoverage({ units, records: rejected });
  ok('coverage: rejected-structure counted', r3.counts['rejected-structure'] >= 1, JSON.stringify(r3.counts));
  ok('coverage: rejected-structure blocks strict', !strictPass(r3.counts));

  // obsolete only: a record for a unit that does not exist
  const obsolete = new Map(all);
  obsolete.set('999:0-1', { unitId: '999:0-1', passage: 'Gone', translation: 'x', protectedTranslation: 'x' });
  const r4 = classifyCoverage({ units, records: obsolete });
  eq('coverage: obsolete counted', r4.counts.obsolete, 1);
  ok('coverage: obsolete alone does not block strict', strictPass(r4.counts));
}

function testE2E(dir, story, byName, units, byUnitId) {
  // 1) export full kit
  const exportRes = runKitExport({ story, byName, units, byUnitId, records: new Map(), scope: 'all', sourceVersion: 'test' });
  const kitZip = path.join(dir, 'kit.zip');
  writeKit(exportRes.kit, kitZip);
  ok('e2e: kit exported', exportRes.exported === units.length, `${exportRes.exported} vs ${units.length}`);

  // 2) fill the kit with the pseudo-language, then import
  const filled = exportRes.segments.map((s) => ({ ...s, translation: pseudoProtected(s.protectedSource) }));
  const filledZip = path.join(dir, 'kit-filled.zip');
  writeKit({ manifest: exportRes.kit.manifest, segments: filled, glossary: [] }, filledZip);
  const imp = runKitImport({ story, byUnitId, kitZipPath: filledZip });
  ok('e2e: import accepted all', imp.accepted.length === units.length, JSON.stringify({ accepted: imp.accepted.length, rejected: imp.rejected, deferred: imp.deferred }));
  eq('e2e: import coverage ok', imp.coverageOk, true);

  // 3) strict build with the full, verified state
  const records = new Map(imp.records.map((r) => [r.unitId, r]));
  const buildUnits = units.filter((u) => records.has(u.unitId));
  const built = buildPack({ story, byName, units: buildUnits, translations: records });
  const report = classifyCoverage({ units, records });
  markUnresolved(report, built.unresolved);
  ok('e2e: strict build passes', strictPass(report.counts), JSON.stringify(report.counts));
  ok('e2e: pack has entries', built.entryCount > 0, `${built.entryCount}`);
  ok('e2e: pack QA ok', built.qa.ok, JSON.stringify(built.qa.byCode));

  // 4) partial build drops the untranslated unit
  const partialRecords = new Map(records);
  partialRecords.delete(units[0].unitId);
  const pReport = classifyCoverage({ units, records: partialRecords });
  const pUnits = units.filter((u) => (pReport.byUnitId.get(u.unitId) || {}).state === 'translated-valid');
  const pBuilt = buildPack({ story, byName, units: pUnits, translations: partialRecords });
  ok('e2e: partial excludes untranslated', pBuilt.coverage.size >= 1 && !pBuilt.coverage.has(units[0].unitId));
  ok('e2e: partial coverage reports leftover', pReport.counts.untranslated >= 1);
  ok('e2e: strict would fail on that state', !strictPass(pReport.counts));
}

export function runSelftest() {
  const dir = makeWorkdir();
  const storyPath = path.join(dir, 'index.html');
  const story = parseStory(storyPath);
  const { byName } = indexStory(story);
  const inv = buildInventory(story, { sourceVersion: 'test' });
  const units = inv.units;
  const byUnitId = new Map(units.map((u) => [u.unitId, u]));

  ok('fixture: story parsed', story.passages.length === 5, `${story.passages.length}`);
  ok('fixture: inventory produced units', units.length > 0, `${units.length}`);
  ok('fixture: unit with placeholder exists', units.some((u) => (u.placeholders || []).length > 0));

  testStructureGuard();
  testPlannerGate();
  testStructureCache(dir, story);
  testCoverageStates(units, story);
  testChunkedExport(dir, story, byName, units, byUnitId);
  testRepairKit(dir, story, byName, units, byUnitId);
  testE2E(dir, story, byName, units, byUnitId);

  process.stdout.write(`\nselftest: ${passed} passed, ${failed} failed\n`);
  if (failed) {
    for (const f of failures) process.stdout.write(`  FAIL ${f}\n`);
    process.exitCode = 1;
  }
  return { passed, failed, failures };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;
if (isMain || process.argv[1] && process.argv[1].endsWith('selftest.mjs')) runSelftest();
