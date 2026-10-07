/*
 * Shared workspace helpers for the offline commands.
 *
 * Holds the on-disk defaults and the small utilities every command needs:
 * argument parsing, JSON writing, story loading, and a content-addressed read
 * of a unit-keyed cache file. Nothing here performs network, device, or model
 * access; all commands that use it are offline.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { parseStory } from './story.mjs';

/** Default scratch directory for regenerable artifacts (git-ignored). */
export const WORK_DIR = process.env.TOOLKIT_WORK
  ? path.resolve(process.env.TOOLKIT_WORK)
  : path.resolve(process.cwd(), '_work');

export function loadStory(storyPath) {
  if (!storyPath) {
    throw new Error('Missing --story <path to the compiled index.html>.');
  }
  if (!fs.existsSync(storyPath)) {
    throw new Error(`Story not found at ${storyPath}. Pass the compiled index.html (assets/www/index.html).`);
  }
  return parseStory(storyPath);
}

/** Load a unit-keyed JSONL cache into a Map (read-only, tolerates junk lines). */
export function readCacheByUnitId(file) {
  const map = new Map();
  if (!file || !fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && o.unitId) map.set(o.unitId, o);
    } catch { /* ignore malformed lines */ }
  }
  return map;
}

export function gitHead(cwd = process.cwd()) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim(); } catch { return null; }
}

export function nowIso() { return new Date().toISOString(); }

export function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

export function flag(name) { return process.argv.includes(`--${name}`); }

export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/** Relativise a path for reports (keeps reports portable). */
export function rel(p) {
  const r = path.relative(process.cwd(), p);
  return r.startsWith('..') ? p : r;
}

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text)).digest('hex');
}

/**
 * Normalise a source string for a content fingerprint: drop comments, collapse
 * macros / tags / entities / placeholders to a stable marker, and fold
 * whitespace. The result identifies a unit's translatable content independent
 * of its position in the story.
 */
const PH = '\u0001';
export function normalizeSource(text) {
  return String(text == null ? '' : text)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<<[\s\S]*?>>/g, `${PH}${PH}`)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-zA-Z][a-zA-Z0-9]*;|&#\d+;|&#x[0-9a-fA-F]+;/g, ' ')
    .replace(/\u27e6\d+\u27e7/g, `${PH}${PH}`)
    .replace(/\s+/g, ' ')
    .trim();
}
