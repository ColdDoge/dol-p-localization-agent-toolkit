import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { parseStory, indexStory } from '../../../core/src/lib/story.mjs';
import { buildInventory } from '../../../core/src/lib/inventory.mjs';
import { restoreProtected } from '../../../core/src/lib/protect.mjs';
import { sourceFingerprint, structuralKey, protectedHash } from '../../../core/src/lib/structure-cache.mjs';
import { loadScenarioSpec, validateScenario } from '../lib/localization-scenarios.mjs';
import { evaluateScenarioResult, scriptLocalizationScenario } from '../lib/localization-scripts.mjs';
import { scenariosForRun } from '../test-localization-runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const STORY = path.join(REPO, 'examples', 'story', 'index.html');
const BUILDER = path.join(REPO, 'runtime', 'localization_smoke_build.mjs');

const pseudo = (s) => String(s).replace(/[A-Za-z]+/g, (w) => `${w}x`);

function writeStateAndScenarios(dir) {
  const story = parseStory(STORY);
  const { byName } = indexStory(story);
  const inv = buildInventory(story, { sourceVersion: 'test' });
  const records = inv.units.map((u) => {
    const protectedTarget = pseudo(u.protectedText);
    return {
      unitId: u.unitId,
      passage: u.passage,
      translation: restoreProtected(protectedTarget, u.placeholders || []),
      protectedTranslation: protectedTarget,
      sourceFingerprint: sourceFingerprint(u),
      structuralFingerprint: structuralKey(u),
      protectedHash: protectedHash(u),
      targetStorySha256: story.sha256,
    };
  });
  const statePath = path.join(dir, 'state.jsonl');
  fs.writeFileSync(statePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const startUnit = inv.units.find((u) => u.passage === 'Start');
  const hallwayUnit = inv.units.find((u) => u.passage === 'Hallway');
  const startHead = restoreProtected(pseudo(startUnit.protectedText), startUnit.placeholders).split(/[.!?]/)[0].trim();
  const hallwayHead = restoreProtected(pseudo(hallwayUnit.protectedText), hallwayUnit.placeholders).split(/[.!?]/)[0].trim();
  const scenarioPath = path.join(dir, 'scenarios.json');
  fs.writeFileSync(scenarioPath, JSON.stringify({
    schemaVersion: '1.0.0',
    kind: 'localization-smoke-scenarios',
    scenarios: [
      { id: 'a1-start', tier: 'A', label: 'start', passage: 'Start', expectTargetAny: [startHead], forbidSourceAny: ['You wake in a narrow bed'], require: ['.passage'] },
      { id: 'a2-hallway', tier: 'A', label: 'hallway', passage: 'Hallway', expectTargetAny: [hallwayHead], forbidSourceAny: ['The hallway is quiet'], require: ['.passage'] },
      { id: 'c1-notice', tier: 'C', label: 'notice', passage: 'Notice', require: ['.passage'] },
    ],
    levels: { smoke: ['a1-start', 'c1-notice'], regression: ['a1-start', 'a2-hallway'], exhaustive: ['a1-start', 'a2-hallway', 'c1-notice'] },
  }, null, 2));
  return { statePath, scenarioPath, byName };
}

function runBuilder(args) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [BUILDER, ...args], { cwd: REPO, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

test('example scenario file is well-formed', () => {
  const spec = loadScenarioSpec(path.join(REPO, 'runtime', 'scenarios.example.json'));
  for (const s of spec.scenarios) assert.deepEqual(validateScenario(s), [], s.id);
});

test('scenario validation requires expectTargetAny / forbidSourceAny for tier A', () => {
  assert.ok(validateScenario({ id: 'x', tier: 'A', label: 'l', passage: 'P', require: ['.passage'] }).includes('tier A needs expectTargetAny[]'));
  assert.ok(validateScenario({ id: 'x', tier: 'C', label: 'l', passage: 'P', require: ['.passage'], expectTargetAny: ['a'] }).includes('tier C must not assert translated text'));
});

test('language-agnostic evaluation: target present + source absent passes', () => {
  const scenario = { id: 'a', tier: 'A', label: 'l', passage: 'P', require: ['.passage'], expectTargetAny: ['xyzzy'], forbidSourceAny: ['hello world'] };
  const good = evaluateScenarioResult(scenario, { requireMissing: [], bodyErrors: 0, leaks: {}, targetFound: ['xyzzy'], sourcePresent: [] });
  assert.equal(good.ok, true, JSON.stringify(good.failures));
  const bad = evaluateScenarioResult(scenario, { requireMissing: [], bodyErrors: 0, leaks: {}, targetFound: [], sourcePresent: ['hello world'] });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.includes('no-expected-target-text'));
});

test('tier C ignores residual source text', () => {
  const scenario = { id: 'c', tier: 'C', label: 'l', passage: 'P', require: ['.passage'] };
  const r = evaluateScenarioResult(scenario, { requireMissing: [], bodyErrors: 0, leaks: {}, targetFound: [], sourcePresent: ['hello world'] });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
});

test('scenario script carries expectTargetAny / forbidSourceAny and no language assumption', () => {
  const source = scriptLocalizationScenario({ id: 'a', tier: 'A', label: 'l', passage: 'P', require: ['.passage'], expectTargetAny: ['zzz'], forbidSourceAny: ['hello'] });
  assert.ok(source.includes('expectTargetAny'));
  assert.ok(source.includes('forbidSourceAny'));
  assert.ok(!/expectChineseAny|forbidEnglishAny/.test(source));
});

test('offline smoke builder validates expectations and writes a pack', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-smoke-'));
  const { statePath, scenarioPath } = writeStateAndScenarios(dir);
  const outDir = path.join(dir, 'out');
  const res = runBuilder(['--story', STORY, '--state', statePath, '--scenarios', scenarioPath, '--level', 'exhaustive', '--out-dir', outDir]);
  assert.equal(res.code, 0, res.stderr + res.stdout);
  assert.ok(fs.existsSync(path.join(outDir, 'expectations.json')));
  const expectation = JSON.parse(fs.readFileSync(path.join(outDir, 'expectations.json'), 'utf8'));
  assert.equal(expectation.kind, 'localization-smoke-expectations');
    // The level registry travels with the file so a later run can select from it.
    assert.deepEqual(expectation.levels, {
      smoke: ['a1-start', 'c1-notice'],
      regression: ['a1-start', 'a2-hallway'],
      exhaustive: ['a1-start', 'a2-hallway', 'c1-notice'],
    });
    assert.equal(expectation.scenarios.length, 3, 'built at exhaustive, so it carries every scene');
  assert.ok(fs.existsSync(path.resolve(REPO, expectation.pack.path)));
});

test('offline smoke builder fails when an expectation is not satisfied', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-smoke-bad-'));
  const { statePath, scenarioPath } = writeStateAndScenarios(dir);
  const bad = JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  bad.scenarios[0].expectTargetAny = ['this string is not in any translation'];
  fs.writeFileSync(scenarioPath, JSON.stringify(bad));
  const res = runBuilder(['--story', STORY, '--state', statePath, '--scenarios', scenarioPath, '--out-dir', path.join(dir, 'out')]);
  assert.equal(res.code, 1, res.stdout);
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'expectations.json')));
});

// ---------------------------------------------------------------------------
// --level selects from an expectations file that carries the level registry
// ---------------------------------------------------------------------------

const LEVEL_REGISTRY = {
  smoke: ['a1-start', 'c1-notice'],
  regression: ['a1-start', 'a2-hallway'],
  exhaustive: ['a1-start', 'a2-hallway', 'c1-notice'],
};
const STORED_SCENARIOS = [
  { id: 'a1-start', tier: 'A' },
  { id: 'a2-hallway', tier: 'A' },
  { id: 'c1-notice', tier: 'C' },
];

test('--level selects the scenes when the expectations file carries the registry', () => {
  const expectations = { scenarios: STORED_SCENARIOS, levels: LEVEL_REGISTRY };
  assert.deepEqual(scenariosForRun(expectations, 'smoke').scenarios.map((s) => s.id), ['a1-start', 'c1-notice']);
  assert.deepEqual(scenariosForRun(expectations, 'regression').scenarios.map((s) => s.id), ['a1-start', 'a2-hallway']);
  assert.deepEqual(scenariosForRun(expectations, 'exhaustive').scenarios.map((s) => s.id), ['a1-start', 'a2-hallway', 'c1-notice']);
  assert.equal(scenariosForRun(expectations, 'smoke').source, 'levels.smoke');
});

test('an older expectations file without a registry keeps its stored scenes', () => {
  const expectations = { scenarios: STORED_SCENARIOS };
  const picked = scenariosForRun(expectations, 'smoke');
  assert.equal(picked.scenarios.length, 3, 'nothing is filtered away when the registry is absent');
  assert.equal(picked.source, 'expectations-file');
});

test('a level that selects nothing falls back to the stored scenes', () => {
  const expectations = { scenarios: STORED_SCENARIOS, levels: { smoke: ['a1-start', 'c1-notice'], regression: ['missing-scene'], exhaustive: ['a1-start'] } };
  assert.equal(scenariosForRun(expectations, 'regression').scenarios.length, 3);
  assert.equal(scenariosForRun(expectations, 'regression').source, 'expectations-file');
  assert.equal(scenariosForRun(expectations, 'some-other-level').scenarios.length, 3);
});
