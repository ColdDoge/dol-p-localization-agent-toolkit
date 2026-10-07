/*
 * Read-only wrapper around the external DoL-Dev-Tools
 * `scripts/adb-backup-app-data.py`.
 *
 * It only reads app-private data through `run-as`; it never restores, roots,
 * clears or force-stops anything. The TAR stays in `_work/` and is never
 * committed.
 *
 * Usage: node runtime/android/backup.mjs --label before-run [--session NAME]
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
const LABEL_RE = /^[a-z0-9-]{1,40}$/;

export function parseArgs(argv) {
  const args = { label: 'before-test', session: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--label') args.label = argv[++i];
    else if (argv[i] === '--session') args.session = argv[++i];
  }
  return args;
}

/** Parse the external tool's final stdout line: "<path>\nbytes=.. members=.. sha256=..". */
export function summarizeBackup(stdout) {
  const text = String(stdout || '').trim();
  const bytes = /bytes=(\d+)/.exec(text);
  const members = /members=(\d+)/.exec(text);
  const sha256 = /sha256=([0-9a-f]{64})/i.exec(text);
  const tarPath = text.split(/\r?\n/)[0] || null;
  return {
    tar: tarPath,
    bytes: bytes ? Number(bytes[1]) : null,
    members: members ? Number(members[1]) : null,
    sha256: sha256 ? sha256[1] : null,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ repoRoot: REPO_ROOT });
  if (!config.devToolsPath) {
    console.error('DEVTOOLS_MISSING: set TOOLKIT_DEV_TOOLS or _local/android-config.local.json devToolsPath');
    process.exitCode = 1;
    return;
  }
  const report = { kind: 'backup', startedAt: new Date().toISOString(), device: { serial: config.serial }, package: { name: config.packageName } };
  let sessionAbs = null;

  const script = path.join(config.devToolsPath, 'scripts', 'adb-backup-app-data.py');
  if (!fs.existsSync(script)) {
    report.ok = false;
    report.code = 'DEVTOOLS_MISSING';
    report.message = `adb-backup-app-data.py not found at ${script}`;
  } else if (!LABEL_RE.test(args.label)) {
    report.ok = false;
    report.code = 'BAD_LABEL';
    report.message = 'label must be 1-40 lowercase letters, digits or hyphens';
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
      const sessionDir = createSessionDir(path.join(REPO_ROOT, '_work', 'android'), args.session || `backup-${sessionStamp()}`);
      sessionAbs = sessionDir;
      const outDir = path.join(sessionDir, 'backups');
      fs.mkdirSync(outDir, { recursive: true });
      const run = defaultRun(
        config.python,
        [script, '--adb', config.adb, '--serial', serial, '--package', config.packageName, '--out', outDir, '--label', args.label],
        { timeoutMs: 300000 },
      );
      report.session = path.relative(REPO_ROOT, sessionDir).replace(/\\/g, '/');
      report.exitCode = run.status;
      report.error = run.error;
      report.stderr = (run.stderr || '').trim().slice(0, 2000) || undefined;
      report.backup = summarizeBackup(run.stdout);
      report.ok = run.ok;
      if (!report.ok) {
        report.code = 'BACKUP_FAILED';
        report.message = 'run-as or tar failed; the app may not be debuggable';
      }
    }
  }

  const sessionDir = sessionAbs || createSessionDir(path.join(REPO_ROOT, '_work', 'android'), args.session || `backup-${sessionStamp()}`);
  fs.mkdirSync(sessionDir, { recursive: true });
  const written = writeJsonNoClobber(path.join(sessionDir, 'backup-wrapper.json'), report);
  console.log(`${report.ok ? 'ok' : 'FAIL'} backup -> ${path.relative(REPO_ROOT, written.path).replace(/\\/g, '/')}${written.written ? '' : ' (exists, not overwritten)'}`);
  if (report.ok && report.backup?.bytes) console.log(`  bytes=${report.backup.bytes} members=${report.backup.members}`);
  if (!report.ok) {
    console.error(`${report.code}: ${report.message || report.stderr || ''}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
