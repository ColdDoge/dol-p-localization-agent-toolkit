/*
 * ADB helpers: device discovery, package check, WebView devtools socket
 * discovery and localhost-only port-forward management.
 *
 * Pure parsing/planning functions are exported separately so they can be unit
 * tested without a device.
 */

const SERIAL_RE = /^[\w.:-]+$/;

/** Parse `adb devices -l` output. */
export function parseAdbDevices(text) {
  const devices = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue;
    const parts = line.split(/\s+/);
    const serial = parts.shift();
    if (!serial) continue;
    const state = parts.shift() || 'unknown';
    const extra = {};
    for (const p of parts) {
      const idx = p.indexOf(':');
      if (idx > 0) extra[p.slice(0, idx)] = p.slice(idx + 1);
    }
    devices.push({
      serial,
      state,
      product: extra.product,
      model: extra.model,
      device: extra.device,
      transportId: extra.transport_id,
    });
  }
  return devices;
}

/**
 * Pick the single usable device.
 * Returns { ok:true, device } or { ok:false, code, message, candidates }.
 */
export function selectDevice(devices, serial) {
  const usable = devices.filter((d) => d.state === 'device');
  if (serial) {
    if (!SERIAL_RE.test(serial)) return { ok: false, code: 'BAD_SERIAL', message: `Invalid serial: ${serial}` };
    const match = devices.find((d) => d.serial === serial);
    if (!match) return { ok: false, code: 'DEVICE_MISSING', message: `No device with serial ${serial}`, candidates: devices.map((d) => d.serial) };
    if (match.state !== 'device') return { ok: false, code: 'DEVICE_NOT_READY', message: `Device ${serial} is ${match.state}` };
    return { ok: true, device: match };
  }
  if (usable.length === 0) return { ok: false, code: 'DEVICE_MISSING', message: 'No authorised device connected', candidates: devices.map((d) => `${d.serial}:${d.state}`) };
  if (usable.length > 1) return { ok: false, code: 'DEVICE_AMBIGUOUS', message: `${usable.length} devices connected; set a serial`, candidates: usable.map((d) => d.serial) };
  return { ok: true, device: usable[0] };
}

export function listDevices(run, adb) {
  const r = run(adb, ['devices', '-l']);
  if (!r.ok) throw new Error(`adb devices failed: ${r.error || r.stderr || r.status}`);
  return parseAdbDevices(r.stdout);
}

export function isPackageInstalled(run, adb, serial, packageName) {
  const r = run(adb, ['-s', serial, 'shell', 'pm', 'path', packageName]);
  const stdout = (r.stdout || '').trim();
  return { installed: r.ok && stdout.startsWith('package:'), raw: stdout, error: r.ok ? undefined : r.error || r.stderr };
}

/** Parse `/proc/net/unix` and return the WebView devtools socket names (no leading @). */
export function parseUnixSockets(text) {
  const sockets = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const cols = raw.trim().split(/\s+/);
    if (cols.length < 8) continue;
    const path = cols[cols.length - 1];
    if (!path || (path[0] !== '@' && path[0] !== '/')) continue;
    const name = path.replace(/^@/, '');
    sockets.push({ path, name, isWebviewDevtools: /^webview_devtools_remote/.test(name) });
  }
  return sockets;
}

/**
 * Resolve the single WebView devtools socket.
 * Returns { ok, code, socket, candidates }.
 */
export function selectWebviewSocket(sockets) {
  const candidates = sockets.filter((s) => s.isWebviewDevtools);
  if (candidates.length === 0) return { ok: false, code: 'WEBVIEW_SOCKET_MISSING', candidates: [] };
  if (candidates.length > 1) return { ok: false, code: 'WEBVIEW_SOCKET_AMBIGUOUS', candidates: candidates.map((c) => c.name) };
  return { ok: true, socket: candidates[0] };
}

export function discoverWebviewSockets(run, adb, serial) {
  const r = run(adb, ['-s', serial, 'shell', 'cat', '/proc/net/unix']);
  if (!r.ok) throw new Error(`reading /proc/net/unix failed: ${r.error || r.stderr || r.status}`);
  return parseUnixSockets(r.stdout);
}

/** Parse `adb forward --list` (format: <serial> <local> <remote>). */
export function parseForwards(text) {
  const forwards = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const cols = raw.trim().split(/\s+/);
    if (cols.length < 3) continue;
    forwards.push({ serial: cols[0], local: cols[1], remote: cols.slice(2).join(' ') });
  }
  return forwards;
}

/**
 * Decide what to do about the local port. Only forwards belonging to our own
 * device + local port are ever removed; other devices/ports are reported and
 * left alone.
 */
export function planForward(forwards, { serial, port, socketName = null }) {
  const local = `tcp:${port}`;
  const mine = forwards.filter((f) => f.local === local && f.serial === serial);
  const foreign = forwards.filter((f) => f.local === local && f.serial !== serial);
  // A stale forward must not be reused. The WebView devtools socket name embeds
  // the app pid, so it changes every time the game restarts; matching only the
  // "localabstract:webview_devtools_remote*" shape would keep pointing the local
  // port at a socket that no longer exists (CDP_UNREACHABLE). When the caller
  // knows the live socket name, require an exact match.
  const desiredRemote = socketName ? `localabstract:${socketName}` : null;
  const mineMatchesDesired = mine.length === 1
    && /^localabstract:webview_devtools_remote/.test(mine[0].remote)
    && (!desiredRemote || mine[0].remote === desiredRemote);
  return {
    local,
    reuse: mineMatchesDesired,
    removeMine: mine,
    foreign,
    conflict: foreign.length > 0,
  };
}

export function listForwards(run, adb) {
  const r = run(adb, ['forward', '--list']);
  if (!r.ok) throw new Error(`adb forward --list failed: ${r.error || r.stderr || r.status}`);
  return parseForwards(r.stdout);
}

export function ensureForward(run, adb, serial, port, socketName) {
  const plan = planForward(listForwards(run, adb), { serial, port, socketName });
  const actions = [];
  if (plan.conflict) {
    actions.push({ action: 'blocked', reason: `local tcp:${port} is forwarded for another device` });
    return { ok: false, code: 'FORWARD_CONFLICT', plan, actions, foreign: plan.foreign };
  }
  if (plan.reuse) {
    actions.push({ action: 'reuse', local: plan.local, remote: plan.removeMine[0].remote });
    return { ok: true, reused: true, plan, actions };
  }
  for (const f of plan.removeMine) {
    const r = run(adb, ['-s', serial, 'forward', '--remove', f.local]);
    actions.push({ action: 'remove', local: f.local, ok: r.ok, error: r.error || r.stderr });
    if (!r.ok) return { ok: false, code: 'FORWARD_REMOVE_FAILED', plan, actions };
  }
  const remote = `localabstract:${socketName}`;
  const r = run(adb, ['-s', serial, 'forward', plan.local, remote]);
  actions.push({ action: 'forward', local: plan.local, remote, ok: r.ok, error: r.error || r.stderr });
  if (!r.ok) return { ok: false, code: 'FORWARD_CREATE_FAILED', plan, actions };
  return { ok: true, reused: false, plan, actions };
}

export const _internals = { SERIAL_RE };
