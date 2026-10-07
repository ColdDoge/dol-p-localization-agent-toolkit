/*
 * Offline tests for the Android tooling. No device, no adb, no network:
 * parsers, planners and session helpers are pure, and everything that shells
 * out receives a fake runner.
 *
 * Run: node --test runtime/android/test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseAdbDevices, selectDevice, parseUnixSockets, selectWebviewSocket, parseForwards, planForward } from '../lib/adb.mjs';
import { resolveGameTargets } from '../lib/cdp.mjs';
import { loadConfig, maskSerial, DEFAULT_CDP_PORT } from '../lib/config.mjs';
import { createSessionDir, writeJsonNoClobber } from '../lib/session.mjs';
import { injectContext, probeOutputName, parseArgs as parseProbeArgs } from '../run-probe.mjs';
import { summarizeBackup } from '../backup.mjs';
import { summarizeInspect } from '../inspect.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-android-test-'));

// ---------------------------------------------------------------- adb parsing

test('parseAdbDevices reads serial/state/model', () => {
  const devices = parseAdbDevices('List of devices attached\nTESTSERIAL0            device product:a34xks model:SM_A346N device:a34x transport_id:3\n');
  assert.equal(devices.length, 1);
  assert.deepEqual(devices[0], { serial: 'TESTSERIAL0', state: 'device', product: 'a34xks', model: 'SM_A346N', device: 'a34x', transportId: '3' });
});

test('selectDevice: explicit serial ok', () => {
  const devices = [{ serial: 'A1', state: 'device' }];
  assert.equal(selectDevice(devices, 'A1').ok, true);
});

test('selectDevice: missing serial -> DEVICE_MISSING', () => {
  assert.equal(selectDevice([], 'NOPE').code, 'DEVICE_MISSING');
});

test('selectDevice: no serial and no devices -> DEVICE_MISSING', () => {
  assert.equal(selectDevice([], undefined).code, 'DEVICE_MISSING');
});

test('selectDevice: no serial and multiple devices -> DEVICE_AMBIGUOUS', () => {
  const r = selectDevice([{ serial: 'A', state: 'device' }, { serial: 'B', state: 'device' }], undefined);
  assert.equal(r.code, 'DEVICE_AMBIGUOUS');
  assert.deepEqual(r.candidates, ['A', 'B']);
});

test('selectDevice: unauthorised device -> DEVICE_NOT_READY', () => {
  assert.equal(selectDevice([{ serial: 'A', state: 'unauthorized' }], 'A').code, 'DEVICE_NOT_READY');
});

// ------------------------------------------------------------ socket discovery

const UNIX_FIXTURE = [
  'Num       RefCount Protocol Flags    Type St Inode Path',
  '0000000000000000: 00000002 00000000 00010000 0001 01 43791 @webview_devtools_remote_16736',
  '0000000000000000: 00000002 00000000 00010000 0001 01 43792 /dev/socket/other',
].join('\n');

test('parseUnixSockets finds webview devtools sockets only', () => {
  const sockets = parseUnixSockets(UNIX_FIXTURE);
  assert.equal(sockets.filter((s) => s.isWebviewDevtools).length, 1);
  assert.equal(sockets.find((s) => s.isWebviewDevtools).name, 'webview_devtools_remote_16736');
});

test('selectWebviewSocket: 0 / 1 / many', () => {
  assert.equal(selectWebviewSocket([]).code, 'WEBVIEW_SOCKET_MISSING');
  assert.equal(selectWebviewSocket(parseUnixSockets(UNIX_FIXTURE)).ok, true);
  const many = [
    { name: 'webview_devtools_remote_1', isWebviewDevtools: true },
    { name: 'webview_devtools_remote_2', isWebviewDevtools: true },
  ];
  const r = selectWebviewSocket(many);
  assert.equal(r.code, 'WEBVIEW_SOCKET_AMBIGUOUS');
  assert.deepEqual(r.candidates, ['webview_devtools_remote_1', 'webview_devtools_remote_2']);
});

// --------------------------------------------------------------- forward plan

test('parseForwards + planForward reuses our own matching forward', () => {
  const forwards = parseForwards('TESTSERIAL0 tcp:50806 localabstract:webview_devtools_remote_16736\n');
  const plan = planForward(forwards, { serial: 'TESTSERIAL0', port: 50806 });
  assert.equal(plan.reuse, true);
  assert.equal(plan.conflict, false);
});

test('planForward replaces a stale forward for our device', () => {
  const forwards = parseForwards('TESTSERIAL0 tcp:50806 tcp:1234\n');
  const plan = planForward(forwards, { serial: 'TESTSERIAL0', port: 50806 });
  assert.equal(plan.reuse, false);
  assert.equal(plan.removeMine.length, 1);
});

test('planForward replaces a forward left over from a previous app pid', () => {
  // The devtools socket name embeds the app pid, so it changes on every restart.
  const forwards = parseForwards('TESTSERIAL0 tcp:50806 localabstract:webview_devtools_remote_5179\n');
  const stale = planForward(forwards, { serial: 'TESTSERIAL0', port: 50806, socketName: 'webview_devtools_remote_17857' });
  assert.equal(stale.reuse, false, 'a socket from the old pid must not be reused');
  assert.equal(stale.removeMine.length, 1);
  const live = planForward(forwards, { serial: 'TESTSERIAL0', port: 50806, socketName: 'webview_devtools_remote_5179' });
  assert.equal(live.reuse, true, 'the live socket is still reused without touching adb');
});

test('planForward reports conflicts with another device instead of removing them', () => {
  const forwards = parseForwards('OTHERDEV tcp:50806 localabstract:webview_devtools_remote_1\n');
  const plan = planForward(forwards, { serial: 'TESTSERIAL0', port: 50806 });
  assert.equal(plan.conflict, true);
  assert.equal(plan.removeMine.length, 0);
  assert.equal(plan.foreign.length, 1);
});

// ---------------------------------------------------------------- cdp targets

const page = (title, extra = {}) => ({ type: 'page', title, url: 'https://localhost/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:50806/devtools/page/1', id: '1', ...extra });

test('resolveGameTargets accepts a page matching the supplied title prefix', () => {
  const r = resolveGameTargets([page('My Game')], { titlePrefix: 'My' });
  assert.equal(r.ok, true);
  assert.equal(r.target.title, 'My Game');
});

test('resolveGameTargets: no matching page', () => {
  const r = resolveGameTargets([page('Other'), { type: 'other', title: 'My Game' }], { titlePrefix: 'My' });
  assert.equal(r.code, 'CDP_TARGET_MISSING');
});

test('resolveGameTargets: multiple matching pages is ambiguous, not a guess', () => {
  const r = resolveGameTargets([page('My Game'), page('My Game Plus')], { titlePrefix: 'My' });
  assert.equal(r.code, 'CDP_TARGET_AMBIGUOUS');
  assert.equal(r.candidates.length, 2);
});

test('resolveGameTargets rejects a non-loopback websocket', () => {
  const r = resolveGameTargets([page('Some Game', { webSocketDebuggerUrl: 'ws://10.0.0.5/devtools/page/1' })], { titlePrefix: 'Some' });
  assert.equal(r.code, 'CDP_SOCKET_NOT_LOCAL');
});

// --------------------------------------------------------------------- config

test('config: defaults when nothing is configured', () => {
  const cfg = loadConfig({ repoRoot: 'C:/repo', env: {}, localConfig: {} });
  // No built-in package id or external-tool path: both are user-supplied.
  assert.equal(cfg.packageName, undefined);
  assert.equal(cfg.devToolsPath, undefined);
  assert.equal(cfg.cdpPort, DEFAULT_CDP_PORT);
  assert.equal(cfg.serial, undefined);
  assert.equal(cfg.provenance.package, 'unset');
});

test('config: env overrides, then file, then cli override wins', () => {
  const file = { serial: 'FILE', package: 'com.file.pkg', cdpPort: 1111 };
  const env = { TOOLKIT_DEVICE_SERIAL: 'ENV' };
  const cfg = loadConfig({ repoRoot: 'C:/repo', env, localConfig: file, overrides: { serial: 'CLI' } });
  assert.equal(cfg.serial, 'CLI');
  assert.equal(cfg.packageName, 'com.file.pkg');
  assert.equal(cfg.cdpPort, 1111);
  assert.equal(cfg.provenance.serial, 'cli');
  assert.equal(cfg.provenance.package, 'file');
});

test('maskSerial hides the middle', () => {
  assert.equal(maskSerial('TESTSERIAL0'), 'TES***L0');
  assert.equal(maskSerial(null), null);
});

// -------------------------------------------------------------------- session

test('createSessionDir never reuses a directory', () => {
  const root = tmp();
  const a = createSessionDir(root, 'run');
  const b = createSessionDir(root, 'run');
  assert.notEqual(a, b);
  assert.match(path.basename(b), /^run-2$/);
});

test('writeJsonNoClobber writes once and reports existing files', () => {
  const root = tmp();
  const file = path.join(root, 'out.json');
  assert.equal(writeJsonNoClobber(file, { a: 1 }).written, true);
  assert.equal(writeJsonNoClobber(file, { a: 2 }).written, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
});

test('writeJsonNoClobber emits stable LF-terminated JSON', () => {
  const root = tmp();
  const file = path.join(root, 'stable.json');
  writeJsonNoClobber(file, { b: 1, a: [1, 2] });
  assert.equal(fs.readFileSync(file, 'utf8'), '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');
});

// ------------------------------------------------------------------ probe glue

test('injectContext replaces the placeholder plus its default object with JSON', () => {
  const out = injectContext('const CTX = /*__INJECT_CONTEXT__*/{};', { x: 1 });
  assert.equal(out, 'const CTX = {"x":1};');
  assert.doesNotThrow(() => new Function(out.replace('const', 'var')));
});

test('injectContext leaves probes without the placeholder untouched', () => {
  assert.equal(injectContext('() => 1', { x: 1 }), '() => 1');
});

test('probeOutputName derives a stable filename', () => {
  assert.equal(probeOutputName('runtime/android/probes/game-status.js'), 'probe-game-status.json');
});

test('run-probe argument parsing accepts flags in any order', () => {
  const a = parseProbeArgs(['--session', 's1', 'p.js', '--json']);
  assert.equal(a.probe, 'p.js');
  assert.equal(a.session, 's1');
  assert.equal(a.json, true);
});

// ------------------------------------------------------------ external wrappers

test('summarizeBackup parses the external tool output', () => {
  const s = summarizeBackup('/tmp/x.tar\nbytes=44719104 members=284 sha256=' + 'a'.repeat(64));
  assert.equal(s.bytes, 44719104);
  assert.equal(s.members, 284);
  assert.equal(s.sha256.length, 64);
});

test('summarizeBackup tolerates unknown output', () => {
  assert.deepEqual(summarizeBackup('boom'), { tar: 'boom', bytes: null, members: null, sha256: null });
});

test('summarizeInspect reads complete/dimensions and tolerates noise', () => {
  assert.deepEqual(summarizeInspect('{"complete":true,"version":"1.0.0","checks":[{"name":"screen","dimensions":[1080,2340]}]}'), {
    complete: true,
    version: '1.0.0',
    dimensions: [1080, 2340],
  });
  assert.deepEqual(summarizeInspect('not json'), { complete: false, version: null, dimensions: null });
});
