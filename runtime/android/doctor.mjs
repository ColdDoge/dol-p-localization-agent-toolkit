/*
 * Read-only Android diagnostic entry point.
 *
 * Runs: config check -> adb device -> package -> Android CLI -> DoL-Dev-Tools
 *       -> WebView socket -> loopback CDP forward -> game target
 *       -> game-status probe -> modloader-status probe -> optional inspect.
 *
 * It never launches, taps, imports, reloads or writes to the device.
 *
 * Usage: node runtime/android/doctor.mjs [--session NAME] [--inspect] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.mjs';
import { defaultRun, probeExecutable } from './lib/exec.mjs';
import { connectGame } from './lib/connect.mjs';
import { evaluate } from './lib/cdp.mjs';
import { createSessionDir, sessionStamp, writeJsonNoClobber } from './lib/session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

export function parseArgs(argv) {
  const args = { session: null, inspect: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--session') args.session = argv[++i];
    else if (argv[i] === '--inspect') args.inspect = true;
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

export function renderDoctorMarkdown(report) {
  const lines = ['# Android doctor', ''];
  lines.push(`- when: ${report.startedAt}`);
  lines.push(`- branch/session: ${report.session}`);
  lines.push(`- device: ${report.device?.model || '?'} (${report.device?.serial || 'unset'}) state=${report.device?.state || '?'}`);
  lines.push(`- package: ${report.package?.name} installed=${report.package?.installed}`);
  lines.push(`- android cli: ${report.androidCli?.available ? report.androidCli.version : 'unavailable'}`);
  lines.push(`- DoL-Dev-Tools: ${report.devTools?.exists ? 'found' : 'MISSING'}`);
  lines.push(`- webview socket: ${report.webview?.socket || '(none)'}`);
  lines.push(`- cdp: ${report.cdp?.ok ? 'ok' : `not ok (${report.cdp?.code || '-'})`}`);
  lines.push(`- game: ${report.game?.ok ? `passage=${report.game.value?.passage} errors=${report.game.value?.bodyErrors}` : `not read (${report.game?.code || '-'})`}`);
  lines.push(`- modLoader: ${report.modLoader?.ok ? JSON.stringify(report.modLoader.value) : `not read (${report.modLoader?.code || '-'})`}`);
  lines.push('');
  if (report.errors?.length) {
    lines.push('## Errors', '');
    for (const e of report.errors) lines.push(`- ${e}`);
    lines.push('');
  }
  lines.push('_Read-only run. No device state was modified._', '');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig({ repoRoot: REPO_ROOT });
  const sessionDir = createSessionDir(path.join(REPO_ROOT, '_work', 'android'), args.session || `doctor-${sessionStamp()}`);
  const rel = (p) => path.relative(REPO_ROOT, p).replace(/\\/g, '/');

  const report = {
    kind: 'doctor',
    startedAt: new Date().toISOString(),
    session: rel(sessionDir),
    config: { provenance: config.provenance, serial: config.serial, package: config.packageName, cdpPort: config.cdpPort, devToolsPath: config.devToolsPath ? rel(config.devToolsPath) : null },
    device: {},
    package: { name: config.packageName },
    androidCli: {},
    devTools: {},
    webview: {},
    cdp: {},
    game: {},
    modLoader: {},
    inspect: null,
    backup: null,
    errors: [],
  };

  report.androidCli = probeExecutable(defaultRun, config.androidCli);
  if (!report.androidCli.available) report.errors.push('ANDROID_CLI_UNAVAILABLE');

  report.devTools.exists = Boolean(config.devToolsPath) && fs.existsSync(path.join(config.devToolsPath, 'scripts', 'android-inspect.cjs'));
  if (!report.devTools.exists) report.errors.push('DEVTOOLS_MISSING');

  const connection = await connectGame({ config, run: defaultRun });
  report.device = connection.device || {};
  report.webview = { socket: connection.socket?.name ?? null, candidates: connection.candidates ?? null };
  report.cdp = {
    ok: Boolean(connection.ok || connection.endpoint),
    code: connection.code ?? null,
    port: config.cdpPort,
    forward: connection.forward?.actions ?? null,
    target: connection.target ? { title: connection.target.title, url: connection.target.url } : null,
  };
  report.package.installed = connection.steps?.find((s) => s.step === 'package')?.installed ?? false;

  if (!connection.ok) {
    report.errors.push(connection.code);
    report.game = { ok: false, code: connection.code };
    report.modLoader = { ok: false, code: connection.code };
  } else {
    for (const [name, file] of [
      ['game', 'game-status.js'],
      ['modLoader', 'modloader-status.js'],
    ]) {
      try {
        const source = fs.readFileSync(path.join(HERE, 'probes', file), 'utf8');
        const value = await evaluate(connection.endpoint, source, { timeoutMs: 60000 });
        report[name] = { ok: true, value };
        writeJsonNoClobber(path.join(sessionDir, `${name === 'game' ? 'GAME-STATUS' : 'MODLOADER-STATUS'}.json`), value);
      } catch (error) {
        report[name] = { ok: false, code: error.code || 'PROBE_FAILED', message: String(error.message || error) };
        report.errors.push(`${name.toUpperCase()}_PROBE_FAILED`);
      }
    }
  }

  if (args.inspect && report.devTools.exists && (config.serial || report.device.serial)) {
    const outDir = path.join(sessionDir, 'inspect');
    const script = path.join(config.devToolsPath, 'scripts', 'android-inspect.cjs');
    const run = defaultRun(process.execPath, [script, config.serial || report.device.serial, outDir], { timeoutMs: 180000 });
    report.inspect = { exitCode: run.status, artifactDir: rel(outDir), ok: run.ok };
  }

  const jsonPath = path.join(sessionDir, 'doctor.json');
  writeJsonNoClobber(jsonPath, report);
  writeJsonNoClobber(path.join(sessionDir, 'ANDROID-DOCTOR.md'), renderDoctorMarkdown(report));

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(renderDoctorMarkdown(report));
    console.log(`report -> ${rel(jsonPath)}`);
  }
  const fatal = ['DEVICE_MISSING', 'PACKAGE_NOT_INSTALLED', 'GAME_NOT_RUNNING', 'WEBVIEW_SOCKET_MISSING', 'ADB_FAILED'].some((c) => report.errors.includes(c));
  process.exitCode = fatal ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(String(error.message || error));
    process.exitCode = 1;
  });
}
