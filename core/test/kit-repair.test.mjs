import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { makeFixture, pseudoProtected } from './helpers/fixture.mjs';
import { runKitExport, writeKit } from '../src/lib/kit-run.mjs';
import { importKitZip, KIT_FILES, serializeSegmentsJsonl, serializeSegmentsCsv, serializeGlossaryCsv } from '../src/lib/kit.mjs';
import { createZip } from '../src/lib/zip.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RUN = path.join(REPO, 'core', 'src', 'run.mjs');

// A translation guaranteed to fail the structural guard for ANY unit in the
// fixture: it adds an HTML tag the source never had.
const BROKEN = 'Broken <b>tag</b> here.';

function cli(args) {
  try {
    const stdout = execFileSync(process.execPath, [RUN, ...args], { cwd: REPO, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

function baseExport(fx) {
  const res = runKitExport({
    story: fx.story, byName: fx.byName, units: fx.units, byUnitId: fx.byUnitId,
    records: new Map(), scope: 'all', sourceVersion: 'test',
  });
  return { manifest: res.kit.manifest, segments: res.segments };
}

/** Write a filled kit whose translation comes from `fill(segment)` ('' = deferred). */
function writeFilled(fx, name, fill) {
  const { manifest, segments } = baseExport(fx);
  const filled = segments.map((s) => {
    const t = fill(s);
    return { ...s, translation: t == null ? '' : String(t) };
  });
  const zipPath = path.join(fx.dir, name);
  writeKit({ manifest, segments: filled, glossary: [] }, zipPath);
  return zipPath;
}

/** Write a kit whose JSONL and CSV translations differ (a raw conflict). */
function writeConflictingKit(fx, name, conflictUnitId) {
  const { manifest, segments } = baseExport(fx);
  const jsonl = segments.map((s) => ({ ...s, translation: pseudoProtected(s.protectedSource) }));
  const csv = segments.map((s) => ({
    ...s,
    translation: s.unitId === conflictUnitId ? `${pseudoProtected(s.protectedSource)} X` : pseudoProtected(s.protectedSource),
  }));
  const zipPath = path.join(fx.dir, name);
  const buf = createZip([
    { name: KIT_FILES.manifest, data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: KIT_FILES.readme, data: '# kit\n' },
    { name: KIT_FILES.rules, data: '# rules\n' },
    { name: KIT_FILES.segmentsJsonl, data: serializeSegmentsJsonl(jsonl) },
    { name: KIT_FILES.segmentsCsv, data: serializeSegmentsCsv(csv) },
    { name: KIT_FILES.glossaryCsv, data: serializeGlossaryCsv([]) },
  ]);
  fs.writeFileSync(zipPath, buf);
  return zipPath;
}

function readIssues(repairZip) {
  const kit = importKitZip(repairZip);
  const text = (kit.files.issuesJsonl || '').trim();
  return text ? text.split('\n').map((l) => JSON.parse(l)) : [];
}

function importCmd(fx, { filled, repair, out = 'state.jsonl', report = 'report.json', requireComplete = true }) {
  const outPath = path.join(fx.dir, out);
  const reportPath = path.join(fx.dir, report);
  const repairPath = repair ? path.join(fx.dir, repair) : null;
  const args = ['kit', 'import', filled, '--story', fx.storyPath, '--out', outPath, '--report', reportPath];
  if (requireComplete) args.push('--require-complete');
  if (repairPath) args.push('--repair-output', repairPath);
  const res = cli(args);
  const reportJson = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
  return { res, outPath, reportPath, repairPath, report: reportJson };
}

test('repair: a fully accepted import writes no repair kit and reports noRepairNeeded', () => {
  const fx = makeFixture();
  const filled = writeFilled(fx, 'ok.zip', (s) => pseudoProtected(s.protectedSource));
  const { res, report, repairPath } = importCmd(fx, { filled, repair: 'repair.zip', requireComplete: true });
  assert.equal(res.code, 0, res.stderr + res.stdout);
  assert.equal(fs.existsSync(repairPath), false, 'no repair kit should be written');
  assert.equal(report.noRepairNeeded, true);
  assert.equal(report.repairKit, null);
  assert.equal(report.blockerTotal, 0);
  assert.equal(report.ok, true);
});

test('repair: a single rejected entry is collected, preserved, and repaired', () => {
  const fx = makeFixture();
  const bad = fx.units.find((u) => (u.placeholders || []).length > 0) || fx.units[0];
  const filled = writeFilled(fx, 'one-bad.zip', (s) => (s.unitId === bad.unitId ? BROKEN : pseudoProtected(s.protectedSource)));
  const { res, report, repairPath } = importCmd(fx, { filled, repair: 'repair.zip' });
  assert.equal(res.code, 1, res.stdout); // require-complete fails
  assert.equal(report.rejected.length, 1);
  assert.equal(report.blockerTotal, 1);
  assert.equal(report.noRepairNeeded, false);
  assert.ok(report.repairKit && report.repairKit.path);

  const rk = importKitZip(repairPath);
  assert.equal(rk.units.length, 1);
  assert.equal(rk.units[0].unitId, bad.unitId);
  // The user's rejected translation is preserved for editing, not cleared.
  assert.equal(rk.units[0].translation, BROKEN);
  // Identity is regenerated from the current target so re-import is consistent.
  assert.equal(rk.manifest.targetStory.sha256, fx.story.sha256);

  const issues = readIssues(repairPath);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].unitId, bad.unitId);
  assert.equal(issues[0].status, 'rejected');
  assert.ok(Array.isArray(issues[0].codes) && issues[0].codes.length > 0);
});

test('repair: multiple rejected entries are all collected', () => {
  const fx = makeFixture();
  const badIds = new Set([fx.units[0].unitId, fx.units[2].unitId]);
  const filled = writeFilled(fx, 'two-bad.zip', (s) => (badIds.has(s.unitId) ? BROKEN : pseudoProtected(s.protectedSource)));
  const { res, report, repairPath } = importCmd(fx, { filled, repair: 'repair2.zip' });
  assert.equal(res.code, 1, res.stdout);
  assert.equal(report.rejected.length, 2);
  const rk = importKitZip(repairPath);
  assert.deepEqual(new Set(rk.units.map((u) => u.unitId)), badIds);
  for (const u of rk.units) assert.equal(u.translation, BROKEN);
});

test('repair: a deferred entry is collected with an empty translation', () => {
  const fx = makeFixture();
  const deferredUnit = fx.units[1];
  const filled = writeFilled(fx, 'deferred.zip', (s) => (s.unitId === deferredUnit.unitId ? '' : pseudoProtected(s.protectedSource)));
  const { res, report, repairPath } = importCmd(fx, { filled, repair: 'repair-def.zip' });
  assert.equal(res.code, 1, res.stdout);
  assert.equal(report.deferred.length, 1);
  const rk = importKitZip(repairPath);
  assert.equal(rk.units.length, 1);
  assert.equal(rk.units[0].unitId, deferredUnit.unitId);
  assert.equal(rk.units[0].translation, '');
  const issues = readIssues(repairPath);
  assert.equal(issues[0].status, 'deferred');
});

test('repair: rejected + deferred mix is collected together', () => {
  const fx = makeFixture();
  const badUnit = fx.units[0];
  const deferredUnit = fx.units[2];
  const filled = writeFilled(fx, 'mixed.zip', (s) => {
    if (s.unitId === badUnit.unitId) return BROKEN;
    if (s.unitId === deferredUnit.unitId) return '';
    return pseudoProtected(s.protectedSource);
  });
  const { res, report, repairPath } = importCmd(fx, { filled, repair: 'repair-mixed.zip' });
  assert.equal(res.code, 1, res.stdout);
  assert.equal(report.rejected.length, 1);
  assert.equal(report.deferred.length, 1);
  assert.equal(report.blockerTotal, 2);
  const issues = readIssues(repairPath);
  assert.equal(issues.length, 2);
  assert.deepEqual(new Set(issues.map((i) => i.unitId)), new Set([badUnit.unitId, deferredUnit.unitId]));
  assert.deepEqual(new Set(issues.map((i) => i.status)), new Set(['rejected', 'deferred']));
});

test('repair: a JSONL/CSV conflict is collected, never re-conflicts, and records both values', () => {
  const fx = makeFixture();
  const conflictUnit = fx.units[0];
  const filled = writeConflictingKit(fx, 'conflict.zip', conflictUnit.unitId);
  const { res, report, repairPath } = importCmd(fx, { filled, repair: 'repair-conflict.zip' });
  assert.equal(res.code, 1, res.stdout);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].unitId, conflictUnit.unitId);

  const rk = importKitZip(repairPath);
  const seg = rk.units.find((u) => u.unitId === conflictUnit.unitId);
  assert.ok(seg, 'conflict unit present in repair kit');
  // Both files are consistent and empty, so the repair kit cannot re-conflict.
  assert.equal(seg.translation, '');
  assert.equal(rk.conflicts.length, 0);

  const rawSeg = rk.jsonl.find((s) => s.unitId === conflictUnit.unitId);
  const issues = readIssues(repairPath);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].status, 'conflict');
  assert.equal(issues[0].jsonlTranslation, pseudoProtected(rawSeg.protectedSource));
  assert.equal(issues[0].csvTranslation, `${pseudoProtected(rawSeg.protectedSource)} X`);

  // Re-import the untouched repair kit: no conflict is reproduced.
  const re = importCmd(fx, { filled: repairPath, repair: null, out: 'state-conflict.jsonl', report: 'report-conflict.jsonl' });
  assert.equal(re.report.conflicts.length, 0, JSON.stringify(re.report.conflicts));
});

test('repair: import keeps scanning after a rejection, accepting later valid entries', () => {
  const fx = makeFixture();
  const badUnit = fx.units[0];
  const filled = writeFilled(fx, 'scan.zip', (s) => (s.unitId === badUnit.unitId ? BROKEN : pseudoProtected(s.protectedSource)));
  const { res, report, outPath } = importCmd(fx, { filled, repair: null });
  assert.equal(res.code, 1, res.stdout);
  // The FIRST unit is rejected, yet every later unit is still checked + accepted.
  assert.equal(report.rejected.length, 1);
  assert.equal(report.rejected[0].unitId, badUnit.unitId);
  assert.equal(report.accepted, fx.units.length - 1);
  const state = fs.readFileSync(outPath, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(state.length, fx.units.length - 1);
});

test('repair: rejected is not a hard failure without --require-complete, but is with it', () => {
  const fx = makeFixture();
  const badUnit = fx.units[0];
  const filled = writeFilled(fx, 'soft.zip', (s) => (s.unitId === badUnit.unitId ? BROKEN : pseudoProtected(s.protectedSource)));
  const lenient = importCmd(fx, { filled, repair: null, out: 'soft-state.jsonl', report: 'soft-report.json', requireComplete: false });
  assert.equal(lenient.res.code, 0, lenient.res.stderr + lenient.res.stdout);
  assert.equal(lenient.report.ok, true);

  const strict = importCmd(fx, { filled, repair: null, out: 'strict-state.jsonl', report: 'strict-report.json', requireComplete: true });
  assert.equal(strict.res.code, 1, strict.res.stdout);
  assert.equal(strict.report.ok, false);
});

test('repair: issues.jsonl corresponds one-to-one with the blockers', () => {
  const fx = makeFixture();
  const badUnit = fx.units[0];
  const deferredUnit = fx.units[2];
  const filled = writeFilled(fx, 'combo.zip', (s) => {
    if (s.unitId === badUnit.unitId) return BROKEN;
    if (s.unitId === deferredUnit.unitId) return '';
    return pseudoProtected(s.protectedSource);
  });
  const { report, repairPath } = importCmd(fx, { filled, repair: 'repair-1to1.zip' });
  const issues = readIssues(repairPath);
  const blockerIds = new Set([
    ...report.rejected.map((r) => r.unitId),
    ...report.deferred.map((d) => d.unitId),
    ...report.conflicts.map((c) => c.unitId),
  ]);
  assert.equal(issues.length, blockerIds.size);
  assert.deepEqual(new Set(issues.map((i) => i.unitId)), blockerIds);
  assert.equal(report.blockerTotal, blockerIds.size);
});

test('repair: issues.jsonl stays one-to-one when a conflict is also present', () => {
  const fx = makeFixture();
  const conflictUnit = fx.units[1];
  const filled = writeConflictingKit(fx, 'combo-conflict.zip', conflictUnit.unitId);
  const { report, repairPath } = importCmd(fx, { filled, repair: 'repair-1to1-conflict.zip' });
  const issues = readIssues(repairPath);
  const blockerIds = new Set([
    ...report.rejected.map((r) => r.unitId),
    ...report.deferred.map((d) => d.unitId),
    ...report.conflicts.map((c) => c.unitId),
  ]);
  assert.equal(report.conflicts.length, 1);
  assert.equal(issues.length, blockerIds.size);
  assert.deepEqual(new Set(issues.map((i) => i.unitId)), blockerIds);
});

test('repair: buildRepairKit keeps the manifest identity and schema version', () => {
  const fx = makeFixture();
  const badUnit = fx.units[0];
  const filled = writeFilled(fx, 'identity.zip', (s) => (s.unitId === badUnit.unitId ? BROKEN : pseudoProtected(s.protectedSource)));
  const { repairPath } = importCmd(fx, { filled, repair: 'identity-repair.zip' });
  const rk = importKitZip(repairPath);
  assert.equal(rk.manifest.schemaVersion, '1.0.0');
  assert.equal(rk.manifest.kind, 'dol-p-localization-kit');
  assert.equal(rk.manifest.scope, 'all');
  assert.equal(rk.manifest.sourceVersion, 'test');
  assert.equal(rk.manifest.targetStory.sha256, fx.story.sha256);
});

test('repair: a filled repair kit re-imports with --require-complete and merges into the same state', () => {
  const fx = makeFixture();
  const badUnit = fx.units.find((u) => (u.placeholders || []).length > 0) || fx.units[0];
  const filled = writeFilled(fx, 'roundtrip.zip', (s) => (s.unitId === badUnit.unitId ? BROKEN : pseudoProtected(s.protectedSource)));
  const first = importCmd(fx, { filled, repair: 'roundtrip-repair.zip', out: 'roundtrip-state.jsonl', report: 'roundtrip-report.json' });
  assert.equal(first.res.code, 1, first.res.stdout);
  const beforeCount = fs.readFileSync(first.outPath, 'utf8').trim().split('\n').filter(Boolean).length;
  assert.equal(beforeCount, fx.units.length - 1);

  // Fix the repair kit: give every carried unit a valid pseudo translation.
  const rk = importKitZip(first.repairPath);
  const fixed = rk.jsonl.map((s) => ({ ...s, translation: pseudoProtected(s.protectedSource) }));
  const fixedZip = path.join(fx.dir, 'roundtrip-repair-fixed.zip');
  writeKit({ manifest: rk.manifest, segments: fixed, glossary: [] }, fixedZip);

  const second = importCmd(fx, { filled: fixedZip, repair: null, out: 'roundtrip-state.jsonl', report: 'roundtrip-report2.json', requireComplete: true });
  assert.equal(second.res.code, 0, second.res.stderr + second.res.stdout);
  assert.equal(second.report.ok, true);
  const afterCount = fs.readFileSync(first.outPath, 'utf8').trim().split('\n').filter(Boolean).length;
  assert.equal(afterCount, fx.units.length, 'fixed records merged into the same state');
});

test('repair: re-importing an unfixed repair kit still fails the structural guard', () => {
  const fx = makeFixture();
  const badUnit = fx.units.find((u) => (u.placeholders || []).length > 0) || fx.units[0];
  const filled = writeFilled(fx, 'guard.zip', (s) => (s.unitId === badUnit.unitId ? BROKEN : pseudoProtected(s.protectedSource)));
  const first = importCmd(fx, { filled, repair: 'guard-repair.zip', out: 'guard-state.jsonl', report: 'guard-report.json' });
  assert.equal(first.res.code, 1, first.res.stdout);
  // The repair kit still carries the broken translation; import rejects it again.
  const again = importCmd(fx, { filled: first.repairPath, repair: null, out: 'guard-state2.jsonl', report: 'guard-report2.json', requireComplete: true });
  assert.equal(again.res.code, 1, again.res.stdout);
  assert.equal(again.report.rejected.length, 1);
  assert.ok((again.report.rejected[0].codes || []).length > 0);
});

test('repair: a conflict is fully classified (coverageOk) yet still blocks under --require-complete', () => {
  const fx = makeFixture();
  const conflictUnit = fx.units[0];
  const filled = writeConflictingKit(fx, 'coverage-conflict.zip', conflictUnit.unitId);

  // Strict run: the conflict must still fail, but coverage accounting is complete
  // (a conflict is classified + recorded, not a dropped unit).
  const strict = importCmd(fx, {
    filled, repair: 'coverage-repair.zip',
    out: 'coverage-strict-state.jsonl', report: 'coverage-strict-report.json', requireComplete: true,
  });
  assert.equal(strict.res.code, 1, strict.res.stdout);
  assert.equal(strict.report.ok, false);
  assert.equal(strict.report.coverageOk, true, 'a recorded conflict must not break coverage accounting');
  assert.equal(strict.report.kitUnitCount, fx.units.length, 'kitUnitCount includes the conflicting unit');
  assert.equal(strict.report.accepted, fx.units.length - 1);
  assert.equal(strict.report.conflicts.length, 1);
  assert.equal(strict.report.conflicts[0].unitId, conflictUnit.unitId);
  assert.equal(strict.report.conflicts[0].jsonlTranslation, pseudoProtected(conflictUnit.protectedText));
  assert.equal(strict.report.conflicts[0].csvTranslation, `${pseudoProtected(conflictUnit.protectedText)} X`);
  assert.equal(strict.report.blockerTotal, 1);

  // A repair kit is still emitted, and it does not reproduce the same conflict.
  assert.ok(strict.report.repairKit && strict.report.repairKit.path, JSON.stringify(strict.report.repairKit));
  const rk = importKitZip(strict.repairPath);
  assert.equal(rk.conflicts.length, 0);
  const carried = rk.units.find((u) => u.unitId === conflictUnit.unitId);
  assert.ok(carried, 'conflict unit carried into the repair kit');
  assert.equal(carried.translation, '');

  // Without --require-complete a conflict now behaves like rejected / deferred:
  // fully reported, but not a hard failure on its own.
  const lenient = importCmd(fx, {
    filled, repair: null,
    out: 'coverage-lenient-state.jsonl', report: 'coverage-lenient-report.json', requireComplete: false,
  });
  assert.equal(lenient.res.code, 0, lenient.res.stderr + lenient.res.stdout);
  assert.equal(lenient.report.coverageOk, true);
  assert.equal(lenient.report.ok, true);
  assert.equal(lenient.report.conflicts.length, 1);
  assert.equal(lenient.report.accepted, fx.units.length - 1);
});
