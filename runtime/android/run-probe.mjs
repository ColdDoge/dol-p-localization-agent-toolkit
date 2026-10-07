/*
 * Run one project-owned probe inside the running game WebView (read-only).
 *
 * Usage:
 *   node runtime/android/run-probe.mjs runtime/android/probes/game-status.js
 *   node runtime/android/run-probe.mjs runtime/android/probes/localization-smoke.js --session probe-001
 *
 * Options: --out <file>  --session <name>  --context <file>  --no-forward  --json
 *
 * Output goes to _work/android/<session>/ and never overwrites an existing file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { defaultRun } from './lib/exec.mjs';
import { connectGame } from './lib/connect.mjs';
import { evaluate } from './lib/cdp.mjs';
import { createSessionDir, sessionStamp, writeJsonNoClobber } from './lib/session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
export const CONTEXT_PLACEHOLDER = '/*__INJECT_CONTEXT__*/';
export const CONTEXT_DEFAULT = '{}';

export function parseArgs(argv) {
  const args = { probe: null, out: null, session: null, context: null, noForward: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--session') args.session = argv[++i];
    else if (a === '--context') args.context = argv[++i];
    else if (a === '--no-forward') args.noForward = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help') args.help = true;
    else if (!args.probe) args.probe = a;
  }
  return args;
}

/**
 * Inject a JSON context object into a probe's placeholder, if present.
 *
 * Convention: the probe writes `/*__INJECT_CONTEXT__*\/{}`. The token plus the
 * empty-object default are replaced together, so the file stays valid JS when
 * read on its own and becomes valid JSON-initialised JS after injection.
 */
export function injectContext(source, context, placeholder = CONTEXT_PLACEHOLDER) {
  if (!source.includes(placeholder)) return source;
  const payload = JSON.stringify(context ?? {});
  const withDefault = placeholder + CONTEXT_DEFAULT;
  if (source.includes(withDefault)) return source.split(withDefault).join(payload);
  return source.split(placeholder).join(payload);
}

export function probeOutputName(probePath) {
  const base = path.basename(probePath, path.extname(probePath));
  return `probe-${base}.json`;
}

/** Probes that need data receive it via --context; there is no default file. */
function defaultContext() {
  return {};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.probe) {
    console.log(
      'Usage: node runtime/android/run-probe.mjs <probe.js> [--session NAME] [--out FILE] [--context FILE] [--no-forward] [--json]',
    );
    process.exitCode = args.probe ? 0 : 1;
    return;
  }

  const probePath = path.resolve(REPO_ROOT, args.probe);
  if (!fs.existsSync(probePath)) {
    console.error(`probe not found: ${probePath}`);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig({ repoRoot: REPO_ROOT });
  const sessionName = args.session || `probe-${sessionStamp()}`;
  const sessionDir = createSessionDir(path.join(REPO_ROOT, '_work', 'android'), sessionName);
  const report = {
    kind: 'probe',
    probe: path.relative(REPO_ROOT, probePath).replace(/\\/g, '/'),
    startedAt: new Date().toISOString(),
    device: { serial: config.serial },
    package: { name: config.packageName },
    cdp: { port: config.cdpPort },
  };

  const connection = await connectGame({ config, run: defaultRun, verifyTarget: !args.noForward });
  report.device = connection.device || report.device;
  report.cdp.forward = connection.forward?.actions ?? null;
  report.webview = connection.socket?.name ?? null;
  report.steps = connection.steps;

  if (!connection.ok) {
    report.ok = false;
    report.code = connection.code;
    report.message = connection.message;
    report.errors = [connection.code];
    const out = args.out ? path.resolve(REPO_ROOT, args.out) : path.join(sessionDir, probeOutputName(probePath));
    const written = writeJsonNoClobber(out, report);
    console.error(`${connection.code}: ${connection.message || ''}`);
    console.error(`report -> ${path.relative(REPO_ROOT, written.path).replace(/\\/g, '/')}${written.written ? '' : ' (exists, not overwritten)'}`);
    process.exitCode = 1;
    return;
  }

  const contextPath = args.context ? path.resolve(REPO_ROOT, args.context) : null;
  const context = contextPath ? JSON.parse(fs.readFileSync(contextPath, 'utf8')) : defaultContext();
  const source = injectContext(fs.readFileSync(probePath, 'utf8'), context);

  try {
    const value = await evaluate(connection.endpoint, source, { timeoutMs: 60000 });
    report.ok = true;
    report.value = value;
  } catch (error) {
    report.ok = false;
    report.code = error.code || 'PROBE_FAILED';
    report.message = String(error.message || error);
    report.errors = [report.code];
  }

  const out = args.out ? path.resolve(REPO_ROOT, args.out) : path.join(sessionDir, probeOutputName(probePath));
  const written = writeJsonNoClobber(out, report);
  report._output = path.relative(REPO_ROOT, written.path).replace(/\\/g, '/');

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${report.ok ? 'ok' : 'FAIL'} ${report.probe} -> ${report._output}${written.written ? '' : ' (exists, not overwritten)'}`);
    if (report.value) console.log(JSON.stringify(report.value));
  }
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error.message || error));
    process.exitCode = 1;
  });
}
