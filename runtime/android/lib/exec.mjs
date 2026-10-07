/*
 * Thin, injectable process runner.
 *
 * Everything that shells out goes through this so offline tests can substitute
 * a fake runner and never touch a device.
 */

import { spawnSync } from 'node:child_process';

/** Default runner: synchronous, no shell, bounded timeout. */
export function defaultRun(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30000,
    windowsHide: true,
    maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
    ...options.spawnOptions,
  });
  return {
    command,
    args,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error ? String(result.error.message || result.error) : undefined,
    ok: !result.error && result.status === 0,
  };
}

/** True when an executable exists and runs. Never throws. */
export function probeExecutable(run, command, args = ['--version']) {
  try {
    const r = run(command, args, { timeoutMs: 15000 });
    if (r.error) return { available: false, error: r.error, version: null };
    const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
    return { available: r.status === 0, version: text.split(/\r?\n/).pop() || null, status: r.status };
  } catch (error) {
    return { available: false, error: String(error.message || error), version: null };
  }
}
