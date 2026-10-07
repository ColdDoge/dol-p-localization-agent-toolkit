/*
 * Read-only source-provenance reader for a local clone of the game source.
 *
 * It deliberately reads *Git objects* (`git ls-tree`, `git cat-file --batch`,
 * `git rev-parse`) instead of files on disk: a Windows checkout can emit
 * case-collision warnings for asset paths, so the working tree is not a
 * reliable proof of completeness. Git objects are.
 *
 * It aligns a tagged upstream Twee/JS/CSS source with the compiled story inside
 * a target build (`assets/www/index.html`). Every changing input — the clone
 * path, the upstream ref/tag, the target `index.html`, and the version text the
 * build injects — is an argument or an environment default; nothing is pinned
 * to a specific game version here.
 *
 * The module is pure with respect to the localization repo: it never writes to
 * the upstream clone and never requires it to be committed.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

import { decodeEntities } from './sc2.mjs';

export const DEFAULT_UPSTREAM_DIR = process.env.TOOLKIT_UPSTREAM_DIR || null;
export const DEFAULT_UPSTREAM_TAG = process.env.TOOLKIT_UPSTREAM_TAG || null;
export const DEFAULT_TARGET_INDEX = process.env.TOOLKIT_TARGET_INDEX || null;
export const DEFAULT_VERSION_TEXT = process.env.TOOLKIT_BUILD_VERSION_TEXT || null;

function requireRef(ref) {
  if (!ref) {
    throw new Error('no upstream ref given; pass a tag/branch/commit or set TOOLKIT_UPSTREAM_TAG');
  }
  return ref;
}

const MAX_BUFFER = 512 * 1024 * 1024;

export function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

/** Run a git command against the upstream clone. Throws a clear error. */
export function gitRun(repoPath, args, { input, binary = false } = {}) {
  // Capture stderr instead of inheriting it: expected-throw paths would
  // otherwise print git's "fatal:" lines into the caller's output.
  const opts = { maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'] };
  if (!binary) opts.encoding = 'utf8';
  if (input !== undefined) opts.input = input;
  try {
    return execFileSync('git', ['-C', repoPath, ...args], opts);
  } catch (err) {
    const stderr = (err.stderr ? err.stderr.toString() : '').trim();
    throw new Error(`git ${args.join(' ')} failed in ${repoPath}: ${stderr || err.message}`);
  }
}

/** Fail loudly when the read-only upstream clone (or its Git dir) is absent. */
export function assertUpstream(repoPath = DEFAULT_UPSTREAM_DIR) {
  if (!repoPath) {
    throw new Error('no upstream clone path given; pass repoPath or set TOOLKIT_UPSTREAM_DIR');
  }
  try {
    gitRun(repoPath, ['rev-parse', '--git-dir']);
  } catch {
    throw new Error(
      `upstream clone not found or not a git repository: ${repoPath}\n` +
        'point TOOLKIT_UPSTREAM_DIR (or repoPath) at a read-only clone; it must not be committed into this repo.',
    );
  }
  return repoPath;
}

/** Resolve a tag/branch/commit to identity facts. Throws if the ref is absent. */
export function resolveRef(repoPath, ref = DEFAULT_UPSTREAM_TAG) {
  requireRef(ref);
  assertUpstream(repoPath);
  let sha;
  try {
    sha = gitRun(repoPath, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(
      `upstream ref "${ref}" not found in ${repoPath}; fetch the upstream clone or pick an existing tag.`,
    );
  }
  const objectType = gitRun(repoPath, ['cat-file', '-t', ref]).trim();
  const line = gitRun(repoPath, ['show', '-s', '--format=%H|%ci|%an|%s', sha]).trim();
  const [commit, date, author, subject] = line.split('|');
  return { ref, objectType, sha: gitRun(repoPath, ['rev-parse', ref]).trim(), commit, date, author, subject };
}

/** `git ls-tree -r -l <ref>` -> [{ mode, type, sha, bytes, path }] (sorted by path). */
export function listTree(repoPath, ref = DEFAULT_UPSTREAM_TAG) {
  assertUpstream(repoPath);
  const out = gitRun(repoPath, ['ls-tree', '-r', '-l', ref]);
  const entries = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const m = /^(\d+)\s+(\w+)\s+([0-9a-f]+)\s+(\d+|-)\t(.*)$/.exec(line);
    if (!m) continue;
    entries.push({
      mode: m[1],
      type: m[2],
      sha: m[3],
      bytes: m[4] === '-' ? null : Number(m[4]),
      path: m[5],
    });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/**
 * Read many blobs in one `git cat-file --batch` call.
 * specs are `"<ref>:<path>"`. Returns Map<spec, {sha, type, content: Buffer}>.
 */
export function readBlobs(repoPath, ref, paths) {
  assertUpstream(repoPath);
  if (paths.length === 0) return new Map();
  const input = paths.map((p) => `${ref}:${p}`).join('\n') + '\n';
  const buf = gitRun(repoPath, ['cat-file', '--batch'], { input, binary: true });
  const out = new Map();
  let offset = 0;
  for (let i = 0; i < paths.length; i += 1) {
    const nl = buf.indexOf(0x0a, offset);
    if (nl < 0) throw new Error(`cat-file --batch: truncated header after ${paths[i]}`);
    const header = buf.toString('utf8', offset, nl).trim();
    offset = nl + 1;
    const parts = header.split(/\s+/);
    if (parts[1] === 'missing') {
      out.set(`${ref}:${paths[i]}`, { missing: true });
      continue;
    }
    const size = Number(parts[2]);
    const content = buf.subarray(offset, offset + size);
    offset += size + 1; // trailing newline emitted by cat-file
    out.set(`${ref}:${paths[i]}`, { sha: parts[0], type: parts[1], content });
  }
  return out;
}

const TWEE_HEADER = /^::[ \t]*(.+?)[ \t]*(?:\[([^\]]*)\])?[ \t]*(?:\{[^}]*\})?[ \t]*$/;

/**
 * Parse a Twee 3 source file into passages.
 *
 * `raw` is the exact text after the header line (leading newlines included);
 * `body` is the *compiled-like* body after the empirically documented tweego
 * whitespace normalization (see normalizeCompiledBody).
 */
export function parseTwee(text, file = '<fixture>') {
  const lines = String(text).split('\n');
  const passages = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const raw = cur.lines.join('\n');
    passages.push({
      name: cur.name,
      tags: cur.tags,
      file,
      line: cur.line,
      raw,
      body: normalizeCompiledBody(raw),
    });
  };
  for (let i = 0; i < lines.length; i += 1) {
    const m = TWEE_HEADER.exec(lines[i]);
    if (m && lines[i].startsWith('::')) {
      flush();
      cur = {
        name: m[1].trim(),
        tags: (m[2] || '').split(/[ \t]+/).filter(Boolean),
        line: i + 1,
        lines: [],
      };
      continue;
    }
    if (cur) cur.lines.push(lines[i]);
  }
  flush();
  return passages;
}

/**
 * Documented build normalization, verified against all 16,610 target passages:
 *
 *   - leading blank lines are dropped by the compiler;
 *   - when the passage header is *immediately* followed by content (no blank
 *     line), the compiler also drops the leading indentation of that first line.
 *
 * Applying this to every v0.772 passage body reproduces the compiled body of
 * every target passage exactly (0 mismatches).
 */
export function normalizeCompiledBody(raw) {
  let body = raw.replace(/^\n+/, '');
  if (raw[0] !== '\n') body = body.replace(/^[ \t]+/, '');
  return body;
}

/** Trailing whitespace is not significant when comparing passage bodies. */
export function canonicalBody(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\s+$/, '');
}

/** Split a `twine-user-script #N: "path"` section header off a compiled block. */
export function stripBuildHeader(content) {
  return String(content).replace(/^\/\*[\s\S]*?\*\/\r?\n?/, '');
}

const isTwee = (p) => p.startsWith('game/') && p.toLowerCase().endsWith('.twee');
const isJs = (p) => p.startsWith('game/') && p.toLowerCase().endsWith('.js');
const isCss = (p) => p.startsWith('game/') && p.toLowerCase().endsWith('.css');
const isFont = (p) => p.startsWith('game/') && /\.(ttf|otf|woff2?)$/i.test(p);

/**
 * Build a deterministic, hash-only source map of the upstream tag:
 * passages, build-included JS/CSS/font files (Tweego `game/` tree only).
 */
export function buildSourceMap(repoPath, ref = DEFAULT_UPSTREAM_TAG) {
  const identity = resolveRef(repoPath, ref);
  const tree = listTree(repoPath, ref);
  const tweePaths = tree.filter((e) => isTwee(e.path)).map((e) => e.path);
  const jsPaths = tree.filter((e) => isJs(e.path)).map((e) => e.path);
  const cssPaths = tree.filter((e) => isCss(e.path)).map((e) => e.path);
  const fontPaths = tree.filter((e) => isFont(e.path)).map((e) => e.path);

  const blobByPath = new Map(tree.map((e) => [e.path, e]));
  const textPaths = [...tweePaths, ...jsPaths, ...cssPaths];
  const blobs = readBlobs(repoPath, ref, textPaths);

  const passages = [];
  for (const file of tweePaths) {
    const blob = blobs.get(`${ref}:${file}`);
    const text = blob.content.toString('utf8');
    for (const p of parseTwee(text, file)) {
      passages.push({
        name: p.name,
        tags: p.tags,
        file,
        line: p.line,
        sha: sha1(p.body),
        bytes: Buffer.byteLength(p.body, 'utf8'),
        special: p.name === 'StoryData' || p.name === 'StoryTitle',
      });
    }
  }
  passages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const filesOf = (paths) =>
    paths.map((p) => ({
      path: p,
      blob: blobByPath.get(p).sha,
      bytes: blobByPath.get(p).bytes,
      sha: sha1(blobs.get(`${ref}:${p}`).content.toString('utf8')),
    }));

  return {
    ref,
    identity,
    counts: {
      treeFiles: tree.length,
      twee: tweePaths.length,
      passages: passages.length,
      js: jsPaths.length,
      css: cssPaths.length,
      fonts: fontPaths.length,
    },
    passages,
    js: filesOf(jsPaths),
    css: filesOf(cssPaths),
    fonts: fontPaths.map((p) => ({ path: p, blob: blobByPath.get(p).sha, bytes: blobByPath.get(p).bytes })),
  };
}

/**
 * Read every Twee passage body from the upstream tag.
 * Returns { map: Map<name, {name, tags, file, raw, body}>, duplicates }.
 */
export function collectUpstreamPassages(repoPath, ref = DEFAULT_UPSTREAM_TAG) {
  const tree = listTree(repoPath, ref);
  const tweePaths = tree.filter((e) => isTwee(e.path)).map((e) => e.path);
  const blobs = readBlobs(repoPath, ref, tweePaths);
  const map = new Map();
  const duplicates = [];
  for (const file of tweePaths) {
    const text = blobs.get(`${ref}:${file}`).content.toString('utf8');
    for (const p of parseTwee(text, file)) {
      if (map.has(p.name)) duplicates.push({ name: p.name, file });
      else map.set(p.name, p);
    }
  }
  return { map, duplicates };
}

/** Compare upstream passage bodies against the compiled target passages. */
export function alignPassages(upstreamPassages, targetPassages) {
  const up = upstreamPassages instanceof Map ? upstreamPassages : new Map(upstreamPassages.map((p) => [p.name, p]));
  const tg = new Map();
  for (const p of targetPassages) {
    const name = decodeEntities(p.name);
    if (!tg.has(name)) tg.set(name, p);
  }

  const exact = [];
  const normalized = [];
  const changed = [];
  const upstreamOnly = [];
  const targetOnly = [];
  const metadata = [];

  for (const p of up.values()) {
    if (p.name === 'StoryData' || p.name === 'StoryTitle') {
      metadata.push(p.name);
      continue;
    }
    const t = tg.get(p.name);
    if (!t) {
      upstreamOnly.push({ name: p.name, file: p.file, sha: sha1(p.body) });
      continue;
    }
    if (canonicalBody(t.content) === canonicalBody(p.raw)) exact.push(p.name);
    else if (canonicalBody(t.content) === canonicalBody(p.body)) normalized.push(p.name);
    else changed.push({ name: p.name, file: p.file, upstreamSha: sha1(p.body), targetSha: sha1(t.content) });
  }
  const upNames = new Set(up.keys());
  for (const [name] of tg) if (!upNames.has(name)) targetOnly.push(name);

  return {
    upstream: up.size,
    upstreamContent: up.size - metadata.length,
    target: tg.size,
    exact: exact.length,
    normalized: normalized.length,
    changed,
    upstreamOnly,
    targetOnly,
    metadata,
    exactNames: exact,
    normalizedNames: normalized,
  };
}

const VERSION_PLACEHOLDER = 'build version';

/** Compare upstream build-included JS files against compiled target sections. */
export function alignScripts(upstreamJs, targetScripts, { tag = DEFAULT_UPSTREAM_TAG, versionText = DEFAULT_VERSION_TEXT, readSource } = {}) {
  const substitutedText = versionText != null ? versionText : (tag || null);
  const target = new Map();
  for (const s of targetScripts) {
    if (!s.file) continue;
    target.set(s.file.replace(/[\\/]+/g, '/'), stripBuildHeader(s.content).replace(/\r\n/g, '\n'));
  }

  const exact = [];
  const versionSubstituted = [];
  const whitespace = [];
  const changed = [];
  const sourceOnly = [];
  const consumed = new Set();

  for (const f of upstreamJs) {
    const src = String(readSource(f.path)).replace(/\r\n/g, '\n');
    const t = target.get(f.path);
    if (t === undefined) {
      sourceOnly.push(f.path);
      continue;
    }
    consumed.add(f.path);
    if (t === src) exact.push(f.path);
    else if (substitutedText != null && t === src.replaceAll(VERSION_PLACEHOLDER, substitutedText)) versionSubstituted.push(f.path);
    else if (t.trimEnd() === src.trimEnd()) whitespace.push(f.path);
    else changed.push(f.path);
  }
  const targetOnly = [...target.keys()].filter((p) => !consumed.has(p));
  return { upstream: upstreamJs.length, target: target.size, exact, versionSubstituted, whitespace, changed, sourceOnly, targetOnly };
}

/** Compare upstream CSS/font assets with the compiled target style sections. */
export function alignStyles(upstreamCss, upstreamFonts, targetStyles, { readSource } = {}) {
  const target = new Map();
  for (const s of targetStyles) {
    if (!s.file) continue;
    const key = s.file.replace(/[\\/]+/g, '/');
    target.set(key, stripBuildHeader(s.content).replace(/\r\n/g, '\n'));
  }
  const exact = [];
  const changed = [];
  const missing = [];
  for (const f of upstreamCss) {
    const src = String(readSource(f.path)).replace(/\r\n/g, '\n');
    const t = target.get(f.path);
    if (t === undefined) missing.push(f.path);
    else if (t === src) exact.push(f.path);
    else changed.push(f.path);
  }
  // Tweego registers fonts by basename, so match on basename.
  const targetBasenames = new Set([...target.keys()].map((p) => p.split('/').pop()));
  const fonts = upstreamFonts.map((f) => ({
    path: f.path,
    basename: f.path.split('/').pop(),
    present: targetBasenames.has(f.path.split('/').pop()),
  }));
  return { upstreamCss: upstreamCss.length, target: target.size, exact, changed, missing, fonts };
}

/* ------------------------------------------------------------------------- *
 * Provenance metadata for translation units
 * ------------------------------------------------------------------------- */

export const SOURCE_RELATIONS = [
  'base-identical',
  'upstream-added',
  'upstream-changed',
  'target-modified',
  'target-added',
];

export const APK_ALIGNMENT_STATUSES = ['exact', 'build-normalized'];

/**
 * Build a unit-level provenance index against a confirmed Git ancestry, given
 * the base, intermediate, and top refs by the caller.
 *
 * Every entry answers, for one target passage name + `from` string:
 *   upstreamPath / upstreamTag / upstreamCommit / sourceRelation / apkAlignmentStatus
 *
 * `classify()` returns null when the passage cannot be traced, or when the
 * target passage body does not reproduce from the tag source (an APK/upstream
 * mismatch, which callers must treat as a selection failure).
 */
export function buildProvenanceIndex({ repoPath = DEFAULT_UPSTREAM_DIR, tag = DEFAULT_UPSTREAM_TAG, baseRef = null, midRef = null, targetPassages = [] } = {}) {
  const base = baseRef ? collectUpstreamPassages(repoPath, baseRef).map : new Map();
  const mid = midRef ? collectUpstreamPassages(repoPath, midRef).map : new Map();
  const top = collectUpstreamPassages(repoPath, tag).map;
  const identity = resolveRef(repoPath, tag);

  const target = new Map();
  for (const p of targetPassages) target.set(decodeEntities(p.name), String(p.content));

  const passageInfo = new Map();
  for (const [name, p] of top) {
    const t = target.get(name);
    let apkAlignmentStatus = 'untracked';
    if (t !== undefined) {
      if (canonicalBody(t) === canonicalBody(p.raw)) apkAlignmentStatus = 'exact';
      else if (canonicalBody(t) === canonicalBody(p.body)) apkAlignmentStatus = 'build-normalized';
      else apkAlignmentStatus = 'mismatch';
    }
    passageInfo.set(name, { upstreamPath: p.file, apkAlignmentStatus });
  }

  const classify = (passage, from) => {
    const info = passageInfo.get(passage);
    if (!info) return null;
    if (info.apkAlignmentStatus !== 'exact' && info.apkAlignmentStatus !== 'build-normalized') return null;
    const needle = collapseWhitespace(from);
    const hasText = (m) => {
      const p = m.get(passage);
      return !!p && collapseWhitespace(p.body).includes(needle);
    };
    const inBase = base.has(passage);
    const inMid = mid.has(passage);
    const textInMid = hasText(mid);
    const passageChangedUpstream = inBase && inMid && canonicalBody(base.get(passage).body) !== canonicalBody(mid.get(passage).body);
    let sourceRelation;
    if (textInMid) {
      if (!inBase) sourceRelation = 'upstream-added';
      else if (!passageChangedUpstream) sourceRelation = 'base-identical';
      else sourceRelation = 'upstream-changed';
    } else if (!inMid) {
      sourceRelation = 'target-added';
    } else {
      sourceRelation = 'target-modified';
    }
    return {
      upstreamPath: info.upstreamPath,
      upstreamTag: tag,
      upstreamCommit: identity.commit,
      sourceRelation,
      apkAlignmentStatus: info.apkAlignmentStatus,
    };
  };

  return { tag, commit: identity.commit, commitDate: identity.date, passageInfo, classify };
}

function collapseWhitespace(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}
