/*
 * Loader / validator for a user-provided localization source file.
 *
 * A localization source is the single place a human edits translations.
 * Everything else (the localization state, the localization kit, the built
 * pack) is derived from it. Accepted inputs:
 *
 *   - JSON:  { "entries": [ { "passage": "...", "from": "...", "to": "..." } ] }
 *            or a bare array of such entries
 *   - JSONL: one entry object per line
 *
 * Validation is strict on purpose:
 *   - every entry must target an existing passage and an existing `from` string;
 *   - when `from` occurs more than once, `all: true` is required;
 *   - ids must be unique, and (passage, from) must not conflict;
 *   - HARD / STRUCTURAL protection findings are build errors unless pre-approved
 *     through an `allow: [{ code, reason }]` entry.
 *
 * This loader is deliberately limited to passage-targeted text. It carries no
 * display-layer, JS/UI, feats, or naming-table logic.
 */

import fs from 'node:fs';
import { classifyPair } from './protection.mjs';

function normalizeEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.entries)) return raw.entries;
  if (raw && raw.typeB && Array.isArray(raw.typeB.TypeBInputStoryScript)) {
    return raw.typeB.TypeBInputStoryScript.map((e) => ({
      passage: e.pN, from: e.f, to: e.t, all: e.all === true,
    }));
  }
  throw new Error('localization source must be a JSON array, a { entries: [...] } object, or a ModI18N TypeB fragment');
}

/** Load one localization source file (JSON or JSONL). */
export function loadLocalizationSource(file) {
  const text = fs.readFileSync(file, 'utf8');
  const trimmed = text.trim();
  if (!trimmed) return { file, entries: [], meta: {} };
  let raw;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    raw = JSON.parse(trimmed);
  } else {
    raw = trimmed.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  }
  const entries = normalizeEntries(raw);
  const meta = (!Array.isArray(raw) && raw && raw._meta) || {};
  return { file, entries, meta };
}

/**
 * Validate all entries against a parsed story. Returns
 * { errors, warnings, resolved } where each resolved entry carries its
 * occurrence count and first offset.
 */
export function validateLocalizationSource(sources, story) {
  const errors = [];
  const warnings = [];
  const resolved = [];
  const seenIds = new Map();
  const seenKeys = new Map();

  const byName = new Map();
  for (const p of story.passages) if (!byName.has(p.name)) byName.set(p.name, p);

  for (const src of sources) {
    for (const e of src.entries || []) {
      const where = `${src.file}#${e.id || '(no id)'}`;
      if (e.id) {
        if (seenIds.has(e.id)) errors.push(`${where}: duplicate id (also in ${seenIds.get(e.id)})`);
        else seenIds.set(e.id, src.file);
      }
      if (!e.passage) { errors.push(`${where}: missing passage`); continue; }
      if (typeof e.from !== 'string' || !e.from) { errors.push(`${where}: missing from`); continue; }
      if (typeof e.to !== 'string' || !e.to) { errors.push(`${where}: missing to`); continue; }

      const key = `${e.passage}\u0000${e.from}`;
      if (seenKeys.has(key)) errors.push(`${where}: duplicate (passage, from) (also in ${seenKeys.get(key)})`);
      else seenKeys.set(key, src.file);

      const passage = byName.get(e.passage);
      if (!passage) { errors.push(`${where}: target passage "${e.passage}" does not exist`); continue; }

      let count = 0;
      let firstPos = -1;
      for (let from = 0; ; ) {
        const at = passage.content.indexOf(e.from, from);
        if (at < 0) break;
        if (count === 0) firstPos = at;
        count += 1;
        from = at + e.from.length;
      }
      if (count === 0) {
        errors.push(`${where}: from string not found in passage "${e.passage}": ${JSON.stringify(e.from).slice(0, 90)}`);
        continue;
      }
      if (count > 1 && e.all !== true) {
        errors.push(`${where}: from occurs ${count}x in "${e.passage}" but all !== true`);
      }

      const { findings } = classifyPair(e.from, e.to);
      const allowed = new Set((e.allow || []).map((a) => a && a.code));
      for (const a of e.allow || []) {
        if (!a || !a.code || !a.reason) errors.push(`${where}: allow entries need both code and reason`);
      }
      for (const f of findings.filter((x) => x.tier === 'hard' || x.tier === 'structural')) {
        if (allowed.has(f.code)) { warnings.push(`${where}: allowed ${f.code}`); continue; }
        errors.push(`${where}: protection ${f.code} ${f.detail}`);
      }

      resolved.push({
        id: e.id || null,
        source: src.file,
        passage: e.passage,
        from: e.from,
        to: e.to,
        all: e.all === true,
        allowed: [...allowed],
        occurrences: count,
        firstPos,
      });
    }
  }
  return { errors, warnings, resolved };
}

/** ModI18N TypeBInputStoryScript fragment (portable, for merging later). */
export function toModI18nFragment(resolved) {
  return {
    typeB: {
      TypeBOutputText: [],
      TypeBInputStoryScript: resolved.map((r) => ({
        pos: r.firstPos,
        pN: r.passage,
        f: r.from,
        t: r.to,
        all: r.all,
      })),
    },
  };
}

/** ReplacePatcher addon params. */
export function toReplacePatcherParams(resolved) {
  return {
    twee: resolved.map((r) => ({ passageName: r.passage, from: r.from, to: r.to, all: r.all })),
  };
}
