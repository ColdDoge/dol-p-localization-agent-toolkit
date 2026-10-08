/*
 * Runtime localization smoke harness (optional, on-device).
 *
 *   preflight -> baseline -> (backup) -> import -> reload -> verify-loaded ->
 *   scenarios -> teardown -> (inspect) -> cleanup -> reload -> restore check
 *
 * The artifact under test and the expectations both come from the offline
 * builder (`runtime/localization_smoke_build.mjs`), which reads the user's
 * localization data — never a private store. Assertions are language-agnostic
 * (`expectTargetAny` / `forbidSourceAny`); script ratios and word counts are
 * diagnostics only.
 *
 * Side effects are real (ModLoader import/removal + WebView reload) and only
 * run when the user explicitly invokes this command. User saves are never
 * touched. `--keep-installed` skips cleanup and is for debugging only.
 *
 * Usage:
 *   node runtime/android/test-localization-runtime.mjs [--level smoke|regression|exhaustive]
 *     [--story <index.html>] [--state <state.jsonl>] [--package <user.mod.zip>]
 *     [--scenarios <file>] [--session NAME] [--inspect] [--no-backup] [--json]
 *
 * If `--state`/`--package` is given, the smoke subset is rebuilt first; else the
 * existing `_work/localization-smoke/expectations.json` is used.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.mjs';
import { defaultRun } from './lib/exec.mjs';
import { connectGame } from './lib/connect.mjs';
import { evaluate as cdpEvaluate } from './lib/cdp.mjs';
import { createSessionDir, sessionStamp, writeJsonNoClobber } from './lib/session.mjs';
import { listDevices, selectDevice } from './lib/adb.mjs';
import { READY_EXPR, SCRIPT_RELOAD, SCRIPT_SNAPSHOT, scriptImport, scriptRemove, compareLists } from './lib/modloader-scripts.mjs';
import { scenariosForLevel } from './lib/localization-scenarios.mjs';
import { scriptLocalizationScenario, scriptLocalizationTeardown, summarizeLocalization } from './lib/localization-scripts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const SMOKE_DIR = path.join(REPO_ROOT, '_work', 'localization-smoke');

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseArgs(argv) {
  const args = {
    level: 'exhaustive', story: null, state: null, package: null, scenarios: null,
    session: null, inspect: null, backup: null, json: false, keepInstalled: false, timeoutMs: 90000,
    entryPassage: 'Start', setupPassage: 'Start2', readyFlag: 'intro', cheatWidget: '<<cheatStart>>',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--level') args.level = argv[++i];
    else if (a === '--story') args.story = argv[++i];
    else if (a === '--state') args.state = argv[++i];
    else if (a === '--package') args.package = argv[++i];
    else if (a === '--scenarios') args.scenarios = argv[++i];
    else if (a === '--session') args.session = argv[++i];
    else if (a === '--inspect') args.inspect = true;
    else if (a === '--no-inspect') args.inspect = false;
    else if (a === '--backup') args.backup = true;
    else if (a === '--no-backup') args.backup = false;
    else if (a === '--keep-installed') args.keepInstalled = true;
    else if (a === '--json') args.json = true;
    else if (a === '--timeout') args.timeoutMs = Number(argv[++i]) || args.timeoutMs;
    else if (a === '--entry-passage') args.entryPassage = argv[++i];
    else if (a === '--setup-passage') args.setupPassage = argv[++i];
    else if (a === '--ready-flag') args.readyFlag = argv[++i];
    else if (a === '--cheat-widget') args.cheatWidget = argv[++i];
  }
  if (args.level !== 'smoke' && args.level !== 'regression' && args.level !== 'exhaustive') {
    throw new Error(`unknown --level ${args.level} (expected smoke|regression|exhaustive)`);
  }
  return args;
}

/**
 * Which scenes this run should visit.
 *
 * An expectations file built at a wider level still carries every scene plus
 * the registry it came from, so `--level` selects from it. An older file has
 * no registry: it only ever held the scenes of its own build level, so the
 * stored list is used as-is (the historical behaviour) rather than silently
 * running nothing.
 */
export function scenariosForRun(expectations, level) {
  const stored = Array.isArray(expectations && expectations.scenarios) ? expectations.scenarios : [];
  const levels = expectations && expectations.levels;
  if (!levels || !Array.isArray(levels[level])) return { scenarios: stored, source: 'expectations-file' };
  const byId = new Map(stored.map((s) => [s.id, s]));
  const selected = levels[level].map((id) => byId.get(id)).filter(Boolean);
  if (!selected.length) return { scenarios: stored, source: 'expectations-file' };
  return { scenarios: selected, source: `levels.${level}` };
}

function defaultDeps() {
  const config = loadConfig({ repoRoot: REPO_ROOT });
  return {
    config,
    run: defaultRun,
    connect: () => connectGame({ config, run: defaultRun }),
    evaluate: (endpoint, source) => cdpEvaluate(endpoint, source, { timeoutMs: 90000 }),
    sleep: sleepReal,
    now: () => new Date(),
    backup: async (label) => {
      const r = defaultRun(process.execPath, [path.join(HERE, 'backup.mjs'), '--label', label], { timeoutMs: 300000 });
      return { ok: r.ok, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
    },
    inspect: async () => {
      const r = defaultRun(process.execPath, [path.join(HERE, 'inspect.mjs')], { timeoutMs: 300000 });
      return { ok: r.ok, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
    },
  };
}

export async function waitForReady(deps, { timeoutMs, pollMs = 1500 }) {
  const started = deps.now().getTime();
  let connection = null;
  let lastError = null;
  for (;;) {
    // A reload tears the WebView devtools socket down and a new pid comes up,
    // so both the connect and the evaluate below can fail transiently. Keep
    // retrying until the timeout instead of giving up on the first attempt.
    if (!connection || !connection.ok) {
      connection = await deps.connect();
      if (!connection.ok) lastError = connection.code || 'CONNECT_FAILED';
    }
    if (connection && connection.ok) {
      try {
        const ready = await deps.evaluate(connection.endpoint, READY_EXPR);
        if (ready === true) return { ok: true, waitedMs: deps.now().getTime() - started, lastError: null, connection };
      } catch (error) {
        lastError = String(error && error.message || error);
        connection = null; // force a fresh connect on the next attempt
      }
    }
    if (deps.now().getTime() - started > timeoutMs) return { ok: false, waitedMs: deps.now().getTime() - started, lastError, connection };
    await deps.sleep(pollMs);
  }
}

export async function runLocalizationRuntime(options, deps) {
  const startedAtMs = deps.now().getTime();
  const report = {
    schemaVersion: '1.0.0',
    kind: 'localization-runtime-report',
    family: 'localization',
    level: options.level,
    startedAt: deps.now().toISOString(),
    target: {},
    device: null,
    preflight: {},
    baseline: {},
    import: {},
    reload: {},
    localization: null,
    teardown: null,
    inspect: null,
    cleanup: null,
    restore: null,
    stages: [],
    errors: [],
    timings: { totalMs: null, preflightMs: null, backupMs: null, importMs: null, reloadMs: null, cleanupMs: null, scenarioMs: null },
    runtimeQa: 'FAILED',
    cleanupStatus: 'NOT_RUN',
  };
  const stage = (name, ok, detail) => {
    report.stages.push({ name, ok, detail });
    if (!ok) report.errors.push(`${name.toUpperCase().replace(/-/g, '_')}_FAILED`);
  };

  // -------------------------------------------------------------- expectations
  const expectationsPath = path.join(SMOKE_DIR, 'expectations.json');
  let expectations;
  try {
    expectations = JSON.parse(fs.readFileSync(expectationsPath, 'utf8'));
  } catch (error) {
    stage('preflight', false, `no smoke expectations at ${path.relative(REPO_ROOT, expectationsPath)}; run runtime/localization_smoke_build.mjs`);
    report.finishedAt = deps.now().toISOString();
    return report;
  }
  const picked = scenariosForRun(expectations, options.level);
  const scenarios = picked.scenarios.length
    ? picked.scenarios
    : scenariosForLevel({ scenarios: [], levels: {} }, options.level);
  report.target = {
    storySha256: expectations.targetStory || null,
    packagePath: (expectations.pack && expectations.pack.path) || null,
    scenarioSource: picked.source,
    scenarioIds: scenarios.map((s) => s.id),
  };
  const zipPath = path.resolve(REPO_ROOT, (expectations.pack && expectations.pack.path) || '');
  if (!expectations.pack || !fs.existsSync(zipPath)) {
    stage('preflight', false, 'smoke pack missing; run runtime/localization_smoke_build.mjs');
    return report;
  }
  const zipBuf = fs.readFileSync(zipPath);
  const boot = JSON.parse((await import('../../core/src/lib/zip.mjs')).readStoredEntry(zipBuf, 'boot.json').toString('utf8'));

  // ----------------------------------------------------------------- preflight
  let conn = await deps.connect();
  if (!conn.ok) {
    const devices = listDevices(deps.run, deps.config.adb);
    const picked = selectDevice(devices, deps.config.serial);
    if (picked.ok && deps.config.packageName) {
      const resolved = deps.run(deps.config.adb, ['-s', picked.device.serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', deps.config.packageName]);
      const component = (resolved.stdout || '').trim().split(/\r?\n/).pop();
      if (component && component.includes('/')) {
        deps.run(deps.config.adb, ['-s', picked.device.serial, 'shell', 'am', 'start', '-n', component]);
        await deps.sleep(9000);
        conn = await deps.connect();
      }
    }
  }
  report.preflight = { ok: conn.ok, code: conn.code ?? null, steps: conn.steps ?? null };
  report.device = conn.device ? { model: conn.device.model, serial: conn.device.serial } : null;
  report.target.packageId = deps.config.packageName || null;
  stage('preflight', conn.ok, conn.ok ? `connected (${conn.target?.title || 'target'})` : `${conn.code}`);
  report.timings.preflightMs = deps.now().getTime() - startedAtMs;
  if (!conn.ok) { report.finishedAt = deps.now().toISOString(); return report; }

  const snapBefore = await deps.evaluate(conn.endpoint, SCRIPT_SNAPSHOT);
  report.baseline = snapBefore;
  const mlv = snapBefore && snapBefore.modUtilsVersion;
  report.target.modLoaderVersion = (typeof mlv === 'string' || typeof mlv === 'number') ? String(mlv) : null;
  const ctrlOk = Boolean(snapBefore && Array.isArray(snapBefore.listModIndexDB));
  stage('baseline', ctrlOk, ctrlOk ? `list=${JSON.stringify(snapBefore.listModIndexDB)}` : 'ModLoader controller not readable');
  if (!ctrlOk) { report.finishedAt = deps.now().toISOString(); return report; }

  if (options.backup !== false) {
    const b0 = deps.now().getTime();
    const b = await deps.backup('before-localization-runtime');
    report.timings.backupMs = deps.now().getTime() - b0;
    report.backup = b;
    stage('backup', b.ok, b.ok ? 'ok' : 'failed (non-blocking)');
  } else {
    stage('backup', true, 'skipped');
  }

  // -------------------------------------------------------------------- import
  const b64 = zipBuf.toString('base64');
  const i0 = deps.now().getTime();
  const imported = await deps.evaluate(conn.endpoint, scriptImport(b64, boot.name));
  report.timings.importMs = deps.now().getTime() - i0;
  report.import = imported;
  const importOk = Boolean(imported && imported.ok && imported.after && imported.after.includes(boot.name));
  stage('import', importOk, importOk ? `added ${boot.name}` : `${imported && (imported.error || imported.stage)}`);
  if (!importOk) { report.finishedAt = deps.now().toISOString(); return report; }

  const cleanupPilot = async (reason) => {
    report.abortedAt = reason;
    try {
      const removed = await deps.evaluate(conn.endpoint, scriptRemove(boot.name));
      report.cleanup = removed;
      const gone = Boolean(removed && removed.removed);
      if (gone) { await deps.evaluate(conn.endpoint, SCRIPT_RELOAD).catch(() => null); await waitForReady(deps, { timeoutMs: 45000 }); }
      report.cleanupStatus = gone ? 'RESTORED' : 'FAILED';
      stage('cleanup', gone, `${reason} -> cleanup ${gone ? 'ok' : 'failed'}`);
    } catch (error) {
      report.cleanupStatus = 'FAILED';
      stage('cleanup', false, `${reason} -> cleanup error ${String(error.message || error)}`);
    }
    return report;
  };

  // ----------------------------------------------------------- reload + verify
  await deps.evaluate(conn.endpoint, SCRIPT_RELOAD).catch(() => null);
  const r0 = deps.now().getTime();
  const ready1 = await waitForReady(deps, { timeoutMs: 60000 });
  report.timings.reloadMs = deps.now().getTime() - r0;
  if (!ready1.ok) return cleanupPilot('reload failed');
  conn = ready1.connection;
  const snapLoaded = await deps.evaluate(conn.endpoint, SCRIPT_SNAPSHOT);
  const persisted = Array.isArray(snapLoaded.listModIndexDB) && snapLoaded.listModIndexDB.includes(boot.name);
  stage('verify-loaded', persisted, persisted ? `${boot.name} loaded` : 'pack not present after reload');
  if (!persisted) return cleanupPilot('pack not loaded');

  // ---------------------------------------------------------------- scenarios
  const hooks = { entryPassage: options.entryPassage, setupPassage: options.setupPassage, readyFlag: options.readyFlag, cheatWidget: options.cheatWidget };
  const s0 = deps.now().getTime();
  const results = [];
  for (const scenario of scenarios) {
    try {
      results.push(await deps.evaluate(conn.endpoint, scriptLocalizationScenario(scenario, hooks)));
    } catch (error) {
      results.push({ id: scenario.id, tier: scenario.tier, fatal: String(error && error.message || error) });
    }
  }
  report.localization = summarizeLocalization(scenarios, results);
  report.timings.scenarioMs = deps.now().getTime() - s0;
  stage('scenarios', report.localization.ok, report.localization.ok ? `A ${report.localization.tierA.passed}/${report.localization.tierA.total} · C ${report.localization.tierC.passed}/${report.localization.tierC.total}` : `failed: ${report.localization.failed.join(',')}`);

  // ----------------------------------------------------------------- teardown
  try { report.teardown = await deps.evaluate(conn.endpoint, scriptLocalizationTeardown(hooks)); } catch (error) { report.teardown = { fatal: String(error.message || error) }; }

  if (options.inspect) {
    const ins = await deps.inspect();
    report.inspect = ins;
    stage('inspect', ins.ok, ins.ok ? 'ok' : 'failed (non-blocking)');
  }

  report.runtimeQa = report.localization.ok ? 'PASSED' : 'FAILED';

  // ----------------------------------------------------------------- cleanup
  if (options.keepInstalled) {
    report.cleanupStatus = 'SKIPPED';
    stage('cleanup', true, 'skipped (--keep-installed)');
  } else {
    const c0 = deps.now().getTime();
    const removed = await deps.evaluate(conn.endpoint, scriptRemove(boot.name));
    report.cleanup = removed;
    const gone = Boolean(removed && removed.removed);
    if (gone) {
      await deps.evaluate(conn.endpoint, SCRIPT_RELOAD).catch(() => null);
      const ready2 = await waitForReady(deps, { timeoutMs: 60000 });
      const after = ready2.ok ? await deps.evaluate(ready2.connection.endpoint, SCRIPT_SNAPSHOT) : null;
      const listCmp = compareLists(report.baseline.listModIndexDB, after && after.listModIndexDB);
      report.restore = {
        ok: Boolean(ready2.ok && after && listCmp.same && !(after.listModIndexDB || []).includes(boot.name) && after.bodyErrors === 0),
        reloadOk: ready2.ok,
        listSame: listCmp.same,
        after: after ? { listModIndexDB: after.listModIndexDB, loadedModNames: after.loadedModNames, passage: after.passage, bodyErrors: after.bodyErrors } : null,
      };
      report.cleanupStatus = report.restore.ok ? 'RESTORED' : 'FAILED';
      stage('restore', report.restore.ok, report.restore.ok ? 'list restored' : `reloadOk=${ready2.ok} listSame=${listCmp.same}`);
    } else {
      report.cleanupStatus = 'FAILED';
      stage('cleanup', false, 'pack still present after removal');
    }
    report.timings.cleanupMs = deps.now().getTime() - c0;
  }

  report.finishedAt = deps.now().toISOString();
  report.timings.totalMs = deps.now().getTime() - startedAtMs;
  return report;
}

function printSummary(report) {
  console.log(`localization runtime: ${report.runtimeQa} · cleanup ${report.cleanupStatus}`);
  for (const s of report.stages) console.log(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
  if (report.localization) {
    console.log(`  tier A ${report.localization.tierA.passed}/${report.localization.tierA.total} · tier C ${report.localization.tierC.passed}/${report.localization.tierC.total}`);
    for (const e of report.localization.entries) {
      if (!e.ok) console.log(`    FAIL ${e.id}: ${e.failures.join(', ')}`);
    }
  }
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(String(error.message || error)); process.exitCode = 2; return; }

  // Rebuild the smoke subset if the caller supplied the localization data.
  if (options.story && (options.state || options.package)) {
    const buildArgs = [path.join(REPO_ROOT, 'runtime', 'localization_smoke_build.mjs'), '--story', options.story, '--level', options.level];
    buildArgs.push(options.state ? '--state' : '--package', options.state || options.package);
    if (options.scenarios) buildArgs.push('--scenarios', options.scenarios);
    const built = defaultRun(process.execPath, buildArgs, { timeoutMs: 300000 });
    process.stdout.write(built.stdout || '');
    if (!built.ok) { process.stderr.write(built.stderr || ''); process.exitCode = built.status || 1; return; }
  }

  const deps = defaultDeps();
  const report = await runLocalizationRuntime(options, deps);
  const sessionDir = createSessionDir(path.join(REPO_ROOT, '_work', 'android'), options.session || `localization-runtime-${sessionStamp()}`);
  const written = writeJsonNoClobber(path.join(sessionDir, 'RUNTIME-LOCALIZATION.json'), report);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else { printSummary(report); console.log(`report -> ${path.relative(REPO_ROOT, written.path).replace(/\\/g, '/')}`); }
  if (report.runtimeQa !== 'PASSED' || report.cleanupStatus === 'FAILED') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(String(error && error.stack || error)); process.exitCode = 1; });
}
