/*
 * Runtime-harness configuration.
 *
 * Resolution order (first hit wins) for every field:
 *   1. explicit override object (used by callers/tests)
 *   2. environment variable
 *   3. _local/android-config.local.json  (git-ignored, holds the real values)
 *
 * Nothing here touches a device; it only decides which values to use. There is
 * no built-in package id, device serial, or external-tool path: everything that
 * identifies a specific target is user-supplied, so the harness stays
 * target-agnostic.
 */

import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CDP_PORT = 50806;
export const LOCAL_CONFIG_FILENAME = 'android-config.local.json';

const ENV = {
  serial: ['TOOLKIT_DEVICE_SERIAL'],
  package: ['TOOLKIT_PACKAGE'],
  devToolsPath: ['TOOLKIT_DEV_TOOLS'],
  cdpPort: ['TOOLKIT_CDP_PORT'],
  androidCli: ['TOOLKIT_ANDROID_CLI'],
  androidSdk: ['TOOLKIT_ANDROID_SDK'],
};

function firstEnv(names, env) {
  for (const name of names) {
    const v = env[name];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

/** Where the real (git-ignored) local config lives. */
export function localConfigPath(repoRoot, cwd = process.cwd()) {
  return path.join(repoRoot, '_local', LOCAL_CONFIG_FILENAME);
}

export function readLocalConfig(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid local android config ${file}: ${error.message}`);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.repoRoot
 * @param {object} [opts.overrides]  e.g. { serial, packageName, devToolsPath, cdpPort, androidCli }
 * @param {object} [opts.env]
 * @param {object} [opts.localConfig] explicit local config (else read from disk)
 * @returns {object} resolved config + provenance
 */
export function loadConfig({ repoRoot, overrides = {}, env = process.env, localConfig } = {}) {
  const localFile = localConfigPath(repoRoot);
  const file = localConfig ?? readLocalConfig(localFile);
  const pick = (key, fallback) => {
    if (overrides[key] !== undefined && overrides[key] !== '') return { value: overrides[key], from: 'cli' };
    const e = firstEnv(ENV[key] || [], env);
    if (e !== undefined) return { value: key === 'cdpPort' ? Number(e) : e, from: 'env' };
    if (file[key] !== undefined && file[key] !== '') return { value: file[key], from: 'file' };
    return { value: fallback, from: fallback === undefined ? 'unset' : 'default' };
  };

  const serial = pick('serial');
  const packageName = pick('package');
  const devToolsPath = pick('devToolsPath');
  const cdpPort = pick('cdpPort', DEFAULT_CDP_PORT);
  const androidCli = pick('androidCli', 'android');
  const androidSdk = pick('androidSdk');

  return {
    repoRoot,
    localConfigFile: localFile,
    serial: serial.value,
    packageName: packageName.value,
    devToolsPath: devToolsPath.value,
    cdpPort: Number(cdpPort.value),
    androidCli: androidCli.value,
    androidSdk: androidSdk.value,
    adb: overrides.adb || 'adb',
    python: overrides.python || 'python',
    provenance: {
      serial: serial.from,
      package: packageName.from,
      devToolsPath: devToolsPath.from,
      cdpPort: cdpPort.from,
      androidCli: androidCli.from,
      androidSdk: androidSdk.from,
    },
  };
}

/** Never print/commit the raw serial in prose; this is for report files in _work only. */
export function maskSerial(serial) {
  if (!serial || typeof serial !== 'string') return null;
  if (serial.length <= 4) return '*'.repeat(serial.length);
  return `${serial.slice(0, 3)}***${serial.slice(-2)}`;
}
