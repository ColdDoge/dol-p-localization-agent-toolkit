#!/usr/bin/env node
/*
 * Toolkit CLI.
 *
 * Every command here is offline. Inventory, audit, export, import, build,
 * migrate and qa never probe ADB, Android CLI, Paisley Park, or a device; the
 * optional runtime harness under `runtime/` is a separate entry point.
 *
 * Usage:
 *   node core/src/run.mjs inventory   --story <index.html> [--source-version <v>] [--out <inventory.json>]
 *   node core/src/run.mjs audit       --story <index.html> [--state <state.jsonl>] [--localization <src.json>] [--report <report.json>]
 *   node core/src/run.mjs kit export  --story <index.html> --output <kit.zip> [--scope all|untranslated|missing|changed]
 *                                     [--state <state.jsonl>] [--localization <src.json>] [--glossary <glossary.csv>]
 *                                     [--limit N] [--target-language <tag>] [--source-version <v>]
 *   node core/src/run.mjs kit import  <kit.zip> --story <index.html> --out <state.jsonl> [--require-complete] [--report <report.json>]
 *   node core/src/run.mjs build       --story <index.html> --state <state.jsonl> --output <pack.mod.zip>
 *                                     [--mode strict|partial] [--report <report.json>] [--name <n>] [--pack-version <v>]
 *   node core/src/run.mjs qa          --story <index.html> --state <state.jsonl> [--report <report.json>]
 *   node core/src/run.mjs migrate     --story <index.html> --state <old.jsonl> --out <new.jsonl> [--report <report.json>]
 *   node core/src/run.mjs cache export --story <index.html> --output <structure-cache.zip> [--source-version <v>]
 *   node core/src/run.mjs cache import <structure-cache.zip> --story <index.html> [--report <report.json>]
 *   node core/src/run.mjs selftest
 */

import fs from 'node:fs';
import path from 'node:path';

import { arg, flag, loadStory, writeJson, nowIso, rel } from './lib/workspace.mjs';
import { indexStory } from './lib/story.mjs';
import { buildInventory } from './lib/inventory.mjs';
import { classifyCoverage, markUnresolved, strictPass, blockingTotal, exportClassification } from './lib/coverage.mjs';
import { buildPack } from './lib/builder.mjs';
import { loadState, writeState, mergeRecords, recordsFromLocalizationSource, migrateRecords } from './lib/localization-state.mjs';
import { loadLocalizationSource, validateLocalizationSource } from './lib/localization-source.mjs';
import { runKitExport, writeKit, runKitImport } from './lib/kit-run.mjs';
import { parseCsv } from './lib/kit.mjs';
import { buildStructureCache, exportStructureCache, importStructureCache, structureCacheCompatible } from './lib/structure-cache.mjs';

const USAGE = `DoL/DoLP Localization Agent Toolkit — offline entry point

Usage: node core/src/run.mjs <command> [options]

Commands:
  inventory    --story <index.html> [--source-version <v>] [--out <inventory.json>]
  audit        --story <index.html> [--state <state.jsonl>] [--localization <src>] [--report <report.json>]
  kit export   --story <index.html> --output <kit.zip> [--scope all|untranslated|missing|changed]
               [--state <state.jsonl>] [--localization <src>] [--glossary <glossary.csv>]
               [--limit N] [--target-language <tag>] [--source-version <v>]
  kit import   <kit.zip> --story <index.html> --out <state.jsonl> [--require-complete] [--report <report.json>]
  build        --story <index.html> --state <state.jsonl> --output <pack.mod.zip>
               [--mode strict|partial] [--report <report.json>] [--name <n>] [--pack-version <v>]
  qa           --story <index.html> --state <state.jsonl> [--report <report.json>]
  migrate      --story <index.html> --state <old.jsonl> --out <new.jsonl> [--report <report.json>]
  cache export --story <index.html> --output <structure-cache.zip> [--source-version <v>]
  cache import <structure-cache.zip> --story <index.html> [--report <report.json>]
  selftest

All commands above are offline and never touch a device. --story points at the
compiled assets/www/index.html of your target build.

Optional on-device validation lives under runtime/:
  node runtime/localization_smoke_build.mjs --story <index.html> --state <state.jsonl>
  node runtime/android/doctor.mjs
  node runtime/android/test-localization-runtime.mjs --level smoke

See docs/TOOLKIT-OVERVIEW.md and docs/RUNTIME-VALIDATION.md for details.
`;

function die(msg) { process.stderr.write(`error: ${msg}\n`); process.exit(2); }

function prepare(storyPath, sourceVersion) {
  const story = loadStory(storyPath);
  const { byName } = indexStory(story);
  const inv = buildInventory(story, { sourceVersion: sourceVersion || 'unknown' });
  const byUnitId = new Map(inv.units.map((u) => [u.unitId, u]));
  return { story, byName, units: inv.units, stats: inv.stats, byUnitId };
}

function loadRecords(story, units, { stateFile, localizationFile }) {
  if (stateFile && localizationFile) die('pass either --state or --localization, not both');
  if (localizationFile) {
    const src = loadLocalizationSource(localizationFile);
    const { errors, resolved } = validateLocalizationSource([src], story);
    if (errors.length) {
      for (const e of errors.slice(0, 20)) process.stderr.write(`  ${e}\n`);
      die(`${errors.length} localization-source error(s)`);
    }
    const { records, unmatched } = recordsFromLocalizationSource({ resolved, units, story });
    if (unmatched.length) process.stderr.write(`note: ${unmatched.length} localization entry/entries matched no inventory unit\n`);
    return { records: new Map(records.map((r) => [r.unitId, r])), errors, unmatched };
  }
  return { records: loadState(stateFile), errors: [], unmatched: [] };
}

function readGlossary(file) {
  if (!file) return [];
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  const idx = (name) => header.indexOf(name);
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (cells.length === 1 && cells[0].trim() === '') continue;
    out.push({
      from: cells[idx('from')] || '',
      to: cells[idx('to')] || '',
      note: cells[idx('note')] || '',
    });
  }
  return out;
}

function cmdInventory() {
  const storyPath = arg('story');
  const out = arg('out');
  const { story, units, stats } = prepare(storyPath, arg('source-version'));
  const result = {
    generatedAt: nowIso(),
    sourceVersion: arg('source-version') || null,
    story: { sha256: story.sha256, bytes: story.size, passages: story.passages.length },
    stats,
    unitCount: units.length,
    units: units.map((u) => ({
      unitId: u.unitId, passage: u.passage, kind: u.kind, family: u.family,
      riskLevel: u.riskLevel, startOffset: u.startOffset, endOffset: u.endOffset,
      rawText: u.rawText, protectedText: u.protectedText,
    })),
  };
  if (out) { writeJson(out, result); process.stdout.write(`inventory: ${units.length} units -> ${rel(out)}\n`); }
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function cmdAudit() {
  const { story, units } = prepare(arg('story'), arg('source-version'));
  const { records } = loadRecords(story, units, { stateFile: arg('state'), localizationFile: arg('localization') });
  const report = classifyCoverage({ units, records });
  const out = {
    generatedAt: nowIso(),
    kind: 'localization-audit',
    targetStory: story.sha256,
    counts: report.counts,
    blocking: blockingTotal(report.counts),
    strictPass: strictPass(report.counts),
    classifications: exportClassification(report.counts),
    obsolete: report.obsolete,
    details: report.details,
  };
  const reportFile = arg('report');
  if (reportFile) writeJson(reportFile, out);
  process.stdout.write(`audit: ${JSON.stringify(out.counts)}\n`);
  process.stdout.write(`  strictPass=${out.strictPass} blocking=${out.blocking} (missing=${out.classifications.missing} changed=${out.classifications.changed})\n`);
  if (!out.strictPass) process.exitCode = 1;
}

function cmdKitExport() {
  const { story, byName, units, byUnitId } = prepare(arg('story'), arg('source-version'));
  const { records } = loadRecords(story, units, { stateFile: arg('state'), localizationFile: arg('localization') });
  const output = arg('output');
  if (!output) die('kit export needs --output <kit.zip>');
  const scope = arg('scope', 'all');
  if (!['all', 'untranslated', 'missing', 'changed'].includes(scope)) die(`unknown --scope ${scope}`);
  const { kit, exported } = runKitExport({
    story, byName, units, byUnitId, records, scope,
    limit: Number(arg('limit', '0')) || 0,
    sourceVersion: arg('source-version') || null,
    sourceCommit: null,
    targetLanguage: arg('target-language') || null,
    glossary: readGlossary(arg('glossary')),
  });
  const written = writeKit(kit, output);
  process.stdout.write(`kit export: ${exported} segment(s), scope=${scope} -> ${rel(output)} (${written.bytes} bytes)\n`);
}

function cmdKitImport() {
  const zip = process.argv[4];
  if (!zip) die('kit import needs a <kit.zip> argument');
  const out = arg('out');
  if (!out) die('kit import needs --out <state.jsonl>');
  const { story, units, byUnitId } = prepare(arg('story'), arg('source-version'));
  const result = runKitImport({ story, byUnitId, kitZipPath: zip, requireComplete: flag('require-complete') });
  if (result.reason === 'target-story-mismatch') {
    die(`kit target story ${result.manifestStory} does not match current target ${result.currentStory}`);
  }
  const existing = loadState(out);
  const merged = mergeRecords(existing, result.records);
  writeState(out, merged);
  const reportFile = arg('report');
  const report = {
    generatedAt: nowIso(),
    kind: 'localization-kit-import',
    kitUnitCount: result.kitUnitCount,
    accepted: result.accepted.length,
    rejected: result.rejected,
    deferred: result.deferred,
    conflicts: result.conflicts,
    coverageOk: result.coverageOk,
    ok: result.ok,
    stateRecords: merged.size,
  };
  if (reportFile) writeJson(reportFile, report);
  process.stdout.write(`kit import: accepted=${report.accepted} deferred=${report.deferred.length} rejected=${report.rejected.length} conflicts=${report.conflicts.length}\n`);
  process.stdout.write(`  state=${rel(out)} (${merged.size} record(s)); requireComplete=${flag('require-complete')} ok=${result.ok}\n`);
  if (!result.ok) process.exitCode = 1;
}

function cmdBuild() {
  const { story, byName, units } = prepare(arg('story'), arg('source-version'));
  const stateFile = arg('state');
  const { records } = loadRecords(story, units, { stateFile, localizationFile: arg('localization') });
  const mode = arg('mode', 'strict');
  if (!['strict', 'partial'].includes(mode)) die(`unknown --mode ${mode}`);
  const output = arg('output');

  const report = classifyCoverage({ units, records });
  const buildUnits = units.filter((u) => {
    const st = report.byUnitId.get(u.unitId);
    return st && st.state === 'translated-valid' && !st.identity;
  });
  const built = buildPack({
    story, byName, units: buildUnits, translations: records,
    name: arg('name', undefined), packVersion: arg('pack-version', undefined),
  });
  markUnresolved(report, built.unresolved);

  const pass = strictPass(report.counts);
  const out = {
    generatedAt: nowIso(),
    kind: 'localization-build',
    mode,
    partial: mode === 'partial',
    targetStory: story.sha256,
    counts: report.counts,
    classifications: exportClassification(report.counts),
    blocking: blockingTotal(report.counts),
    strictPass: pass,
    unresolved: built.unresolved,
    entries: built.entryCount,
    planner: built.planner,
    qa: built.qa,
    pack: null,
  };

  if (mode === 'strict' && !pass) {
    out.result = 'FAILED';
    out.reason = 'strict build: blocking coverage states present; no pack written';
    const reportFile = arg('report');
    if (reportFile) writeJson(reportFile, out);
    process.stdout.write(`build(strict): FAILED — ${JSON.stringify(report.counts)}\n`);
    process.exitCode = 1;
    return;
  }

  if (!output) die('build needs --output <pack.mod.zip>');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, built.zipBuf);
  out.result = mode === 'partial' ? 'PARTIAL' : 'BUILT';
  out.pack = { path: rel(output), bytes: built.bytes, sha256: built.sha256, entries: built.entryCount };
  const reportFile = arg('report');
  if (reportFile) writeJson(reportFile, out);
  process.stdout.write(`build(${mode}): ${out.result} entries=${built.entryCount} qa=${built.qa.ok ? 'PASS' : 'FAIL'} -> ${rel(output)}\n`);
  process.stdout.write(`  coverage=${JSON.stringify(report.counts)}\n`);
  if (!built.qa.ok) process.exitCode = 1;
}

function cmdQa() {
  const { story, byName, units } = prepare(arg('story'), arg('source-version'));
  const { records } = loadRecords(story, units, { stateFile: arg('state'), localizationFile: arg('localization') });
  const report = classifyCoverage({ units, records });
  const buildUnits = units.filter((u) => {
    const st = report.byUnitId.get(u.unitId);
    return st && st.state === 'translated-valid' && !st.identity;
  });
  const built = buildPack({ story, byName, units: buildUnits, translations: records });
  markUnresolved(report, built.unresolved);
  const out = {
    generatedAt: nowIso(),
    kind: 'localization-qa',
    counts: report.counts,
    blocking: blockingTotal(report.counts),
    strictPass: strictPass(report.counts),
    planner: built.planner,
    qa: built.qa,
    unresolved: built.unresolved,
  };
  const reportFile = arg('report');
  if (reportFile) writeJson(reportFile, out);
  process.stdout.write(`qa: strictPass=${out.strictPass} entries=${built.entryCount} qa=${built.qa.ok ? 'PASS' : 'FAIL'}\n`);
  if (!out.strictPass || !built.qa.ok) process.exitCode = 1;
}

function cmdMigrate() {
  const { story, units } = prepare(arg('story'), arg('source-version'));
  const stateFile = arg('state');
  if (!stateFile) die('migrate needs --state <old.jsonl>');
  const out = arg('out');
  if (!out) die('migrate needs --out <new.jsonl>');
  const old = loadState(stateFile);
  const result = migrateRecords({ records: old, units });
  writeState(out, result.records);
  const report = {
    generatedAt: nowIso(),
    kind: 'localization-migration',
    targetStory: story.sha256,
    input: old.size,
    output: result.records.length,
    kept: result.kept.length,
    moved: result.moved.length,
    obsolete: result.obsolete.length,
    movedSamples: result.moved.slice(0, 20),
    obsoleteSamples: result.obsolete.slice(0, 20),
  };
  const reportFile = arg('report');
  if (reportFile) writeJson(reportFile, report);
  process.stdout.write(`migrate: kept=${report.kept} moved=${report.moved} obsolete=${report.obsolete} -> ${rel(out)}\n`);
}

function cmdCache() {
  const sub = process.argv[3];
  if (sub === 'export') {
    const { story, units, stats } = prepare(arg('story'), arg('source-version'));
    const output = arg('output');
    if (!output) die('cache export needs --output <structure-cache.zip>');
    const cache = buildStructureCache({ story, sourceVersion: arg('source-version') || null, inventoryStats: stats, pipeline: 'toolkit-v1' });
    const written = exportStructureCache(cache, output);
    process.stdout.write(`cache export: ${units.length} units -> ${rel(output)} (${written.bytes} bytes)\n`);
  } else if (sub === 'import') {
    const zip = process.argv[4];
    if (!zip) die('cache import needs a <structure-cache.zip> argument');
    const { story } = prepare(arg('story'), arg('source-version'));
    const cache = importStructureCache(zip);
    const compatible = structureCacheCompatible(cache, story);
    const report = { generatedAt: nowIso(), kind: 'structure-cache-import', compatible, targetStory: story.sha256 };
    const reportFile = arg('report');
    if (reportFile) writeJson(reportFile, report);
    process.stdout.write(`cache import: compatible=${compatible}\n`);
  } else {
    die('cache needs a subcommand: export | import');
  }
}

async function cmdSelftest() {
  const mod = await import('./selftest.mjs');
  return mod.runSelftest();
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) die('no command. Try: selftest | inventory | audit | kit | build | qa | migrate | cache (or --help)');
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { process.stdout.write(USAGE); return; }
  if (cmd === 'selftest') return cmdSelftest();
  if (cmd === 'inventory') return cmdInventory();
  if (cmd === 'audit') return cmdAudit();
  if (cmd === 'kit' && process.argv[3] === 'export') return cmdKitExport();
  if (cmd === 'kit' && process.argv[3] === 'import') return cmdKitImport();
  if (cmd === 'build') return cmdBuild();
  if (cmd === 'qa') return cmdQa();
  if (cmd === 'migrate') return cmdMigrate();
  if (cmd === 'cache') return cmdCache();
  die(`unknown command: ${process.argv.slice(2).join(' ')}`);
}

main().catch((e) => { process.stderr.write(`error: ${e && e.stack ? e.stack : e}\n`); process.exit(1); });
