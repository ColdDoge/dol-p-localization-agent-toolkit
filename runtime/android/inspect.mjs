/*
 * Wrapper around the external DoL-Dev-Tools `scripts/android-inspect.cjs`.
 *
 * The external tool is invoked as-is (never modified). Artifacts land in a fresh
 * directory under `_work/android/<session>/inspect/` and are never overwritten.
 *
 * Usage: node runtime/android/inspect.mjs [--session NAME]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { defaultRun } from './lib/exec.mjs';
import { listDevices, selectDevice } from './lib/adb.mjs';
import { createSessionDir, sessionStamp, writeJsonNoClobber } from './lib/session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

export function parseArgs(argv) {
  const args = { session: null };
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--session') args.session = argv[++i];
  return args;
}

/** Parse the external tool's stdout report if present; tolerant of failure. */
export function summarizeInspect(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return {
      complete: Boolean(parsed.complete),
      version: parsed.version ?? null,
      dimensions: (parsed.checks || []).map((c) => c.dimensions).find(Boolean) ?? null,
    };
  } catch {
    return { complete: false, version: null, dimensions: null };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ repoRoot: REPO_ROOT });
  if (!config.devToolsPath) {
    console.error('DEVTOOLS_MISSING: set TOOLKIT_DEV_TOOLS or _local/android-config.local.json devToolsPath');
    process.exitCode = 1;
    return;
  }
  const report = {
    kind: 'inspect',
    startedAt: new Date().toISOString(),
    device: { serial: config.serial },
    devToolsPath: path.relative(REPO_ROOT, config.devToolsPath).replace(/\\/g, '/'),
  };
  let sessionAbs = null;

  const script = path.join(config.devToolsPath, 'scripts', 'android-inspect.cjs');
  if (!fs.existsSync(script)) {
    report.ok = false;
    report.code = 'DEVTOOLS_MISSING';
    report.message = `android-inspect.cjs not found at ${script}`;
  } else {
    let serial = config.serial;
    if (!serial) {
      const picked = selectDevice(listDevices(defaultRun, config.adb), undefined);
      if (!picked.ok) {
        report.ok = false;
        report.code = picked.code;
        report.message = picked.message;
      } else serial = picked.device.serial;
    }
    if (serial) {
      const sessionDir = createSessionDir(path.join(REPO_ROOT, '_work', 'android'), args.session || `inspect-${sessionStamp()}`);
      sessionAbs = sessionDir;
      const outDir = path.join(sessionDir, 'inspect');
      report.session = path.relative(REPO_ROOT, sessionDir).replace(/\\/g, '/');
      report.artifactDir = path.relative(REPO_ROOT, outDir).replace(/\\/g, '/');
      const run = defaultRun(process.execPath, [script, serial, outDir], { timeoutMs: 180000 });
      report.exitCode = run.status;
      report.error = run.error;
      report.stderr = (run.stderr || '').trim().slice(0, 2000) || undefined;
      report.inspect = summarizeInspect(run.stdout);
      report.ok = run.ok && report.inspect.complete;
      if (!report.ok) report.code = report.code || 'INSPECT_FAILED';
    }
  }

  const outDir = sessionAbs || createSessionDir(path.join(REPO_ROOT, '_work', 'android'), args.session || `inspect-${sessionStamp()}`);
  fs.mkdirSync(outDir, { recursive: true });
  const written = writeJsonNoClobber(path.join(outDir, 'inspect-wrapper.json'), report);
  console.log(`${report.ok ? 'ok' : 'FAIL'} inspect -> ${path.relative(REPO_ROOT, written.path).replace(/\\/g, '/')}${written.written ? '' : ' (exists, not overwritten)'}`);
  if (!report.ok) {
    console.error(`${report.code}: ${report.message || report.stderr || ''}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
