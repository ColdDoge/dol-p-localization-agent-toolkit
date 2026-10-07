/*
 * Session directories for Android runs.
 *
 * Everything a run writes goes under `_work/android/<session>/`, which is
 * git-ignored. Session directories are never reused: a numeric suffix is added
 * instead of overwriting previous artifacts.
 */

import fs from 'node:fs';
import path from 'node:path';

export function sessionStamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Create (or pick the next free) session directory. */
export function createSessionDir(root, name, { fsImpl = fs } = {}) {
  fsImpl.mkdirSync(root, { recursive: true });
  let dir = path.join(root, name);
  let n = 2;
  while (fsImpl.existsSync(dir)) {
    dir = path.join(root, `${name}-${n}`);
    n += 1;
  }
  fsImpl.mkdirSync(dir);
  return dir;
}

/**
 * Write JSON without clobbering an existing file.
 * Returns { path, written } — written=false when the file already existed.
 */
export function writeJsonNoClobber(file, value, { fsImpl = fs } = {}) {
  const text = JSON.stringify(value, null, 2).replace(/\r\n/g, '\n') + '\n';
  if (fsImpl.existsSync(file)) return { path: file, written: false };
  fsImpl.writeFileSync(file, text, { flag: 'wx' });
  return { path: file, written: true };
}
