/*
 * Connect to the running game WebView, read-only.
 *
 * Steps: device -> package -> WebView devtools socket -> loopback forward.
 * Returns structured results instead of throwing so callers (doctor) can
 * report exactly which step failed, e.g. GAME_NOT_RUNNING when the app has no
 * WebView devtools socket yet.
 */

import { listDevices, selectDevice, isPackageInstalled, discoverWebviewSockets, selectWebviewSocket, ensureForward } from './adb.mjs';
import { buildEndpoint, fetchTargets, resolveGameTargets } from './cdp.mjs';

export async function connectGame({ config, run, verifyTarget = true, timeoutMs = 15000, fetchImpl } = {}) {
  const steps = [];
  const result = { ok: false, steps };
  if (!config.packageName) {
    return { ...result, code: 'PACKAGE_UNSET', message: 'no target package configured (set TOOLKIT_PACKAGE or _local/android-config.local.json)' };
  }

  let devices;
  try {
    devices = listDevices(run, config.adb);
  } catch (error) {
    return { ...result, code: 'ADB_FAILED', message: String(error.message || error) };
  }
  steps.push({ step: 'adb-devices', count: devices.length });

  const picked = selectDevice(devices, config.serial);
  if (!picked.ok) return { ...result, code: picked.code, message: picked.message, candidates: picked.candidates };
  const device = picked.device;
  steps.push({ step: 'device', serial: device.serial, model: device.model, state: device.state });

  const pkg = isPackageInstalled(run, config.adb, device.serial, config.packageName);
  steps.push({ step: 'package', package: config.packageName, installed: pkg.installed });
  if (!pkg.installed) {
    return { ...result, code: 'PACKAGE_NOT_INSTALLED', message: `${config.packageName} is not installed on ${device.serial}`, device };
  }

  let sockets;
  try {
    sockets = discoverWebviewSockets(run, config.adb, device.serial);
  } catch (error) {
    return { ...result, code: 'ADB_FAILED', message: String(error.message || error), device };
  }
  const socketPick = selectWebviewSocket(sockets);
  steps.push({
    step: 'webview-socket',
    found: sockets.filter((s) => s.isWebviewDevtools).map((s) => s.name),
  });
  if (!socketPick.ok) {
    return { ...result, code: socketPick.code, message: 'No running game WebView found (is the game open?)', candidates: socketPick.candidates, device };
  }

  const forward = ensureForward(run, config.adb, device.serial, config.cdpPort, socketPick.socket.name);
  steps.push({ step: 'forward', ok: forward.ok, code: forward.code, actions: forward.actions, reused: forward.reused });
  if (!forward.ok) {
    return { ...result, code: forward.code, message: 'Could not establish a loopback CDP forward', device, socket: socketPick.socket, forward };
  }

  const endpoint = buildEndpoint(config.cdpPort);
  const connected = { ...result, device, socket: socketPick.socket, forward, endpoint };
  if (!verifyTarget) return { ...connected, ok: true };

  let targets;
  try {
    targets = await fetchTargets(endpoint, { timeoutMs, fetchImpl });
  } catch (error) {
    return { ...connected, code: 'CDP_UNREACHABLE', message: String(error.message || error) };
  }
  const resolved = resolveGameTargets(targets);
  steps.push({ step: 'cdp-target', ok: resolved.ok, code: resolved.code, title: resolved.target?.title ?? null });
  if (!resolved.ok) {
    return { ...connected, code: resolved.code, message: 'Could not uniquely identify the game page', candidates: resolved.candidates };
  }
  return { ...connected, ok: true, target: resolved.target };
}
