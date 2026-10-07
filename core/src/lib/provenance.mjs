/*
 * Git provenance.
 *
 * The known pit: `git ls-tree -r -l <ref>` on a `--filter=blob:none` partial
 * clone forces a per-blob lazy fetch (one promisor pack per object) because
 * `-l` needs every blob's size. This reader never does that.
 *
 * Path:
 *   1. `git ls-tree -r <ref>`            -> tree/path/object id, no sizes (fast)
 *   2. select only the .twee/.js text blobs that are actually needed
 *   3. `git cat-file --batch`            -> one bulk request for those blobs
 * Blob sizes, when ever needed, come from `git cat-file --batch-check`, never
 * from `ls-tree -l`.
 *
 * Everything is executed through `git` plumbing and never touches image blobs.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function git(repoDir, args) {
  return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
}

/** Fast: tree/path/oid only, no blob sizes, no lazy fetch. */
export function listTree(repoDir, ref) {
  const out = git(repoDir, ['ls-tree', '-r', ref]);
  const entries = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const [mode, type, oid] = line.slice(0, tab).split(' ');
    entries.push({ mode, type, oid, path: line.slice(tab + 1) });
  }
  return entries;
}

/** The old (slow) method, used only in the benchmark with a hard timeout. */
export function listTreeWithSize(repoDir, ref, { timeoutMs = 30000, subPath } = {}) {
  const args = ['ls-tree', '-r', '-l', ref];
  if (subPath) args.push('--', subPath);
  const r = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 * 256 });
  return { timedOut: r.error && r.error.code === 'ETIMEDOUT', status: r.status, stdout: r.stdout || '' };
}

/** Bulk blob read: one `git cat-file --batch` for every requested oid. */
export function readBlobs(repoDir, oids) {
  const input = `${oids.join('\n')}\n`;
  const r = spawnSync('git', ['cat-file', '--batch'], { cwd: repoDir, input, maxBuffer: 1024 * 1024 * 1024 });
  const buf = r.stdout;
  const out = new Map();
  let off = 0;
  while (off < buf.length) {
    let nl = buf.indexOf(0x0a, off);
    if (nl < 0) break;
    const header = buf.toString('utf8', off, nl);
    const parts = header.split(' ');
    if (parts.length < 3) break;
    const size = Number(parts[2]);
    const start = nl + 1;
    out.set(parts[0], buf.toString('utf8', start, start + size));
    off = start + size + 1;
  }
  return out;
}

/** Bulk size lookup: `git cat-file --batch-check` (no content transfer). */
export function readBlobSizes(repoDir, oids) {
  const input = `${oids.join('\n')}\n`;
  const out = spawnSync('git', ['cat-file', '--batch-check'], { cwd: repoDir, input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }).stdout;
  const map = new Map();
  for (const line of out.split('\n')) {
    const [oid, type, size] = line.split(' ');
    if (oid && type && size) map.set(oid, { type, size: Number(size) });
  }
  return map;
}

const PASSAGE_RE = /^::\s*([^\[\{\n]+?)\s*(?:\[[^\]]*\])?\s*(?:\{[^\n]*\})?\s*$/gm;

/** Extract `:: PassageName` headers -> { name, body } from a .twee source. */
export function parseTweePassages(content) {
  const heads = [];
  PASSAGE_RE.lastIndex = 0;
  let m;
  while ((m = PASSAGE_RE.exec(content)) !== null) heads.push({ name: m[1].trim(), start: m.index, headerEnd: PASSAGE_RE.lastIndex });
  const out = new Map();
  for (let i = 0; i < heads.length; i += 1) {
    const end = i + 1 < heads.length ? heads[i + 1].start : content.length;
    const body = content.slice(heads[i].headerEnd, end);
    if (!out.has(heads[i].name)) out.set(heads[i].name, { path: null, body });
  }
  return out;
}

function packFiles(repoDir) {
  const dir = path.join(repoDir, '.git', 'objects', 'pack');
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.pack')).length; } catch { return 0; }
}

/**
 * Benchmark old vs new provenance enumeration.
 *
 * The slow path is bounded to a small subtree that contains *non-materialized*
 * blobs, so the demonstration stays deterministic instead of trying to fetch
 * sizes for the whole (image-heavy) tree.
 */
export function benchmark(repoDir, ref, { slowTimeoutMs = 30000, slowSubPath = 'img' } = {}) {
  const packsBefore = packFiles(repoDir);
  const t1a = Date.now();
  const entries = listTree(repoDir, ref);
  const tFast = Date.now() - t1a;

  const needOids = entries.filter((e) => /\.(twee|js)$/i.test(e.path)).map((e) => e.oid);
  const t2a = Date.now();
  const sizes = readBlobSizes(repoDir, needOids);
  const tBatchCheck = Date.now() - t2a;
  const packsAfterNew = packFiles(repoDir);

  const slow = listTreeWithSize(repoDir, ref, { timeoutMs: slowTimeoutMs, subPath: slowSubPath });
  const packsAfterSlow = packFiles(repoDir);

  return {
    ref,
    treeEntries: entries.length,
    textOids: needOids.length,
    new: {
      lsTreeNoSizeMs: tFast,
      catFileBatchCheckMs: tBatchCheck,
      totalMs: tFast + tBatchCheck,
      newPacks: packsAfterNew - packsBefore,
      sizedBlobs: sizes.size,
    },
    old: {
      lsTreeWithSizeMs: slow.timedOut ? null : undefined,
      timedOut: !!slow.timedOut,
      timeoutMs: slowTimeoutMs,
      newPacks: packsAfterSlow - packsAfterNew,
      stdoutBytes: slow.stdout.length,
    },
  };
}

/** passageName -> upstream .twee path for one ref. */
export function passageFileIndex(repoDir, ref, entries) {
  const twee = entries.filter((e) => /\.twee$/i.test(e.path));
  const blobs = readBlobs(repoDir, twee.map((e) => e.oid));
  const byName = new Map();
  for (const e of twee) {
    const content = blobs.get(e.oid);
    if (content === undefined) continue;
    for (const [name, rec] of parseTweePassages(content)) {
      if (!byName.has(name)) byName.set(name, { path: e.path, body: rec.body });
    }
  }
  return byName;
}

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** sourceRelation per passage: base-identical / target-modified / target-added. */
export function passageRelations(upstreamIndex, baseIndex) {
  const rel = new Map();
  for (const [name, up] of upstreamIndex) {
    const base = baseIndex.get(name);
    if (!base) rel.set(name, 'target-added');
    else if (norm(up.body) === norm(base.body)) rel.set(name, 'base-identical');
    else rel.set(name, 'target-modified');
  }
  return rel;
}
