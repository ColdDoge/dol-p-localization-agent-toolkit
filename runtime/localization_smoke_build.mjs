/*
 * Offline builder for the runtime localization smoke subset.
 *
 * It reads the target story and the *user's* localization data — either a
 * localization state (`--state`) or a user-provided localization package
 * (`--package`, a ReplacePatcher `.mod.zip`) — and produces:
 *
 *   _work/localization-smoke/<name>.mod.zip   a subset pack for the scenario passages
 *   _work/localization-smoke/expectations.json  the validated scenario expectations
 *
 * It never reads a private store, never calls a model, and never touches a
 * device. Every tier-A expectation is validated here: `expectTargetAny` must
 * appear in a translated-valid unit of that passage, and `forbidSourceAny`
 * must appear in the passage source. A missing expectation fails the build.
 *
 * Usage:
 *   node runtime/localization_smoke_build.mjs --story <index.html> --state <state.jsonl> [--scenarios <file>]
 *   node runtime/localization_smoke_build.mjs --story <index.html> --package <user.mod.zip> [--scenarios <file>]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { loadStory, writeJson, nowIso } from '../core/src/lib/workspace.mjs';
import { indexStory } from '../core/src/lib/story.mjs';
import { buildInventory } from '../core/src/lib/inventory.mjs';
import { createZip, readStoredEntry } from '../core/src/lib/zip.mjs';
import { classifyCoverage } from '../core/src/lib/coverage.mjs';
import { loadState, recordsFromLocalizationSource } from '../core/src/lib/localization-state.mjs';
import { buildEntries } from '../core/src/lib/entries.mjs';
import { loadScenarioSpec, validateScenario, scenariosForLevel, scenarioPassages, blockedScenarios } from './android/lib/localization-scenarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_SCENARIOS = path.join(HERE, 'scenarios.example.json');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function die(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(1); }

/** Relative to the repo when inside it, else absolute (reports stay usable). */
function repoRel(p) {
  const r = path.relative(REPO_ROOT, p);
  return (!r || r.startsWith('..') || path.isAbsolute(r)) ? p : r;
}

/** Read ReplacePatcher entries from a user-provided localization package. */
function recordsFromPackage(zipPath, units, story) {
  const buf = fs.readFileSync(zipPath);
  const boot = JSON.parse(readStoredEntry(buf, 'boot.json').toString('utf8'));
  const addon = (boot.addonPlugin || []).find((a) => a && a.addonName === 'ReplacePatcherAddon');
  const twee = (addon && addon.params && addon.params.twee) || [];
  const resolved = twee.map((e) => ({ passage: e.passageName, from: e.from, to: e.to, all: e.all === true }));
  const { records, unmatched } = recordsFromLocalizationSource({ resolved, units, story });
  return { records: new Map(records.map((r) => [r.unitId, r])), unmatched, packageName: boot.name || null, entryCount: twee.length };
}

function main() {
  const storyPath = arg('story');
  const statePath = arg('state');
  const packagePath = arg('package');
  const scenariosPath = arg('scenarios', DEFAULT_SCENARIOS);
  const level = arg('level', 'exhaustive');
  const outDir = path.resolve(arg('out-dir', path.join(REPO_ROOT, '_work', 'localization-smoke')));
  if (!storyPath) die('missing --story <index.html>');
  if (!statePath && !packagePath) die('pass --state <state.jsonl> or --package <user.mod.zip>');
  if (statePath && packagePath) die('pass either --state or --package, not both');
  if (!fs.existsSync(scenariosPath)) die(`scenario file not found: ${scenariosPath}`);

  const story = loadStory(storyPath);
  const { byName } = indexStory(story);
  const inv = buildInventory(story, { sourceVersion: arg('source-version') || 'unknown' });
  const byUnitId = new Map(inv.units.map((u) => [u.unitId, u]));
  const byUnitIdList = inv.units;

  let records;
  let sourceLabel;
  let packageName = 'localization-smoke';
  let unmatched = [];
  if (statePath) {
    records = loadState(statePath);
    sourceLabel = `state:${path.basename(statePath)}`;
  } else {
    const pkg = recordsFromPackage(packagePath, byUnitIdList, story);
    records = pkg.records;
    unmatched = pkg.unmatched;
    sourceLabel = `package:${path.basename(packagePath)}`;
    if (pkg.packageName) packageName = `${pkg.packageName}-smoke`;
  }

  const coverage = classifyCoverage({ units: byUnitIdList, records });
  const spec = loadScenarioSpec(scenariosPath);
  const problems = [];
  for (const scenario of spec.scenarios) {
    for (const p of validateScenario(scenario)) problems.push(`${scenario.id}: ${p}`);
  }
  const selected = scenariosForLevel(spec, level);
  const passages = new Set(scenarioPassages(spec));

  // Validate tier-A expectations against the user's translations and the source.
  const passageSource = new Map();
  for (const p of story.passages) passageSource.set(p.name, p.content);
  const passageTranslations = new Map();
  for (const u of byUnitIdList) {
    const state = coverage.byUnitId.get(u.unitId);
    if (!state || state.state !== 'translated-valid') continue;
    if (!passageTranslations.has(u.passage)) passageTranslations.set(u.passage, []);
    const rec = records.get(u.unitId);
    passageTranslations.get(u.passage).push(rec ? rec.translation : '');
  }
  for (const scenario of selected) {
    if (scenario.tier !== 'A') continue;
    const translations = passageTranslations.get(scenario.passage) || [];
    const source = passageSource.get(scenario.passage) || '';
    for (const needle of scenario.expectTargetAny || []) {
      if (!translations.some((t) => t.includes(needle))) problems.push(`${scenario.id}: expectTargetAny "${needle}" not found in a translated-valid unit of "${scenario.passage}"`);
    }
    for (const needle of scenario.forbidSourceAny || []) {
      if (!source.includes(needle)) problems.push(`${scenario.id}: forbidSourceAny "${needle}" not found in the source of "${scenario.passage}"`);
    }
  }
  if (problems.length) {
    for (const p of problems.slice(0, 30)) process.stderr.write(`  ${p}\n`);
    die(`${problems.length} scenario problem(s); refusing to build a smoke pack`);
  }

  // Build the subset pack: complete passages for the scenario scenes, using the
  // user's translated-valid units.
  const buildUnits = byUnitIdList
    .filter((u) => passages.has(u.passage) && (coverage.byUnitId.get(u.unitId) || {}).state === 'translated-valid')
    .map((u) => ({ ...u, translation: records.get(u.unitId) ? records.get(u.unitId).translation : '' }));
  const built = buildEntries(buildUnits, byName, { allowWholePassage: true });
  const boot = {
    name: packageName,
    version: '1.0.0',
    styleFileList: [], scriptFileList: [], tweeFileList: [], imgFileList: [],
    addonPlugin: [{
      modName: 'ReplacePatcher',
      addonName: 'ReplacePatcherAddon',
      modVersion: '^1.0.0',
      params: { twee: built.entries.map((e) => ({ passageName: e.passageName, from: e.from, to: e.to, all: e.all })) },
    }],
  };
  const zipBuf = createZip([
    { name: 'boot.json', data: `${JSON.stringify(boot, null, 2)}\n` },
    { name: 'README.md', data: 'Localization runtime smoke subset. ReplacePatcher addon; generated offline from user localization data.\n' },
  ]);
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, `${packageName.replace(/[^A-Za-z0-9._-]+/g, '-')}.mod.zip`);
  fs.writeFileSync(zipPath, zipBuf);

  const expectations = {
    generatedAt: nowIso(),
    kind: 'localization-smoke-expectations',
    level,
    targetStory: story.sha256,
    source: sourceLabel,
    pack: { name: boot.name, version: boot.version, path: repoRel(zipPath).replace(/\\/g, '/'), sha256: crypto.createHash('sha256').update(zipBuf).digest('hex'), entries: built.entries.length },
    scenarios: selected,
    // The full level registry, so the runtime harness can honour --level on
    // an expectations file that was built at a wider level than the run.
    levels: spec.levels,
    blocked: blockedScenarios(spec),
    counts: coverage.counts,
    unmatched: unmatched.length,
  };
  writeJson(path.join(outDir, 'expectations.json'), expectations);

  process.stdout.write(`localization smoke: ${built.entries.length} entries, ${selected.length} scenario(s), source=${sourceLabel}\n`);
  process.stdout.write(`  pack -> ${path.relative(REPO_ROOT, zipPath).replace(/\\/g, '/')}\n`);
  process.stdout.write(`  coverage=${JSON.stringify(coverage.counts)}\n`);
}

main();
