/*
 * localization-kit.zip — a self-contained hand-off for external translation.
 *
 * The kit carries the protected source text, its placeholders, an optional
 * user glossary, and the run identity, so a translator (human, script, or AI)
 * can fill `translation` and hand the zip back. Import never trusts the
 * package: every returned string is re-run through placeholder integrity,
 * reversible restore, the V3 structural guard, and the ReplacePatcher replay
 * gate before it may enter the localization state.
 *
 *   manifest.json        identity + compatibility contract
 *   README.md            short, user-facing instructions
 *   TRANSLATION-RULES.md the rule sheet for the translator
 *   segments.jsonl       canonical machine format (one unit per line)
 *   segments.csv         convenience format for humans / spreadsheets
 *   glossary.csv         optional locked terms (user-provided)
 *
 * Store-only zip via `zip.mjs` — no external dependency, deterministic output.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createZip, readStoredEntry } from './zip.mjs';
import { sourceFingerprint, structuralKey, protectedHash } from './structure-cache.mjs';
import { restoreProtected, verifyEntry } from './protect.mjs';

export const KIT_SCHEMA_VERSION = '1.0.0';
export const KIT_KIND = 'dol-p-localization-kit';
export const TRANSLATION_QA_VERSION = '1.0.0';
export const PATCH_PLANNER_VERSION = '1.0.0';

export const KIT_FILES = {
  manifest: 'manifest.json',
  readme: 'README.md',
  rules: 'TRANSLATION-RULES.md',
  segmentsJsonl: 'segments.jsonl',
  segmentsCsv: 'segments.csv',
  glossaryCsv: 'glossary.csv',
  // Optional sidecar. Only a repair kit writes it; a normal kit and every
  // importer ignore it. It explains per-unit what an import could not accept.
  issues: 'issues.jsonl',
};

export const SEGMENT_CSV_COLUMNS = [
  'unitId', 'passage', 'kind', 'family', 'riskLevel',
  'protectedSource', 'rawSourceHash', 'protectedHash', 'sourceFingerprint', 'structuralFingerprint',
  'placeholders', 'contextBefore', 'contextAfter', 'translation',
];

function sha(text, n = 24) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text)).digest('hex').slice(0, n);
}

export function rawSourceHashOf(unit) { return sha(unit.rawText, 24); }

/** Hashes a kit entry may declare (jsonl is canonical, csv is a fallback). */
export function declaredHashesOf(entry) {
  const seg = entry.jsonlSeg || {};
  const row = entry.csvRow || {};
  return {
    rawSourceHash: seg.rawSourceHash || row.rawSourceHash || null,
    protectedHash: seg.protectedHash || row.protectedHash || null,
    sourceFingerprint: seg.sourceFingerprint || row.sourceFingerprint || null,
    structuralFingerprint: seg.structuralFingerprint || row.structuralFingerprint || null,
  };
}

/**
 * Validate ONE returned kit entry against the current unit. Pure: no I/O.
 * Returns one of:
 *   { status: 'missing' }                            (blank translation)
 *   { status: 'rejected', reason, codes? }           (bad entry, per-entry reason)
 *   { status: 'accepted', translatedProtected, toRaw, allowPronounOmission }
 */
export function checkKitEntry(unit, entry) {
  const raw = entry && entry.translation != null ? String(entry.translation) : '';
  if (raw.trim() === '') return { status: 'missing' };

  const d = declaredHashesOf(entry);
  if (d.rawSourceHash && d.rawSourceHash !== rawSourceHashOf(unit)) return { status: 'rejected', reason: 'source-hash-mismatch' };
  if (d.protectedHash && d.protectedHash !== protectedHash(unit)) return { status: 'rejected', reason: 'protected-hash-mismatch' };
  if (d.sourceFingerprint && d.sourceFingerprint !== sourceFingerprint(unit)) return { status: 'rejected', reason: 'source-fingerprint-mismatch' };
  if (d.structuralFingerprint && d.structuralFingerprint !== structuralKey(unit)) return { status: 'rejected', reason: 'structural-fingerprint-mismatch' };

  const toRaw = restoreProtected(raw, unit.placeholders);
  const v = verifyEntry({
    protectedText: unit.protectedText, placeholders: unit.placeholders,
    translatedProtected: raw, fromRaw: unit.rawText, toRaw,
  });
  if (!v.ok) return { status: 'rejected', reason: 'qa-failed', codes: v.codes };
  return { status: 'accepted', translatedProtected: raw, toRaw, allowPronounOmission: v.allowPronounOmission };
}

/** One kit segment for a unit. `translation` starts empty (to be filled). */
export function segmentFromUnit(unit, { contextBefore = '', contextAfter = '' } = {}) {
  return {
    unitId: unit.unitId,
    passage: unit.passage,
    kind: unit.kind,
    family: unit.family,
    riskLevel: unit.riskLevel,
    protectedSource: unit.protectedText,
    rawSourceHash: rawSourceHashOf(unit),
    protectedHash: protectedHash(unit),
    sourceFingerprint: sourceFingerprint(unit),
    structuralFingerprint: structuralKey(unit),
    placeholders: (unit.placeholders || []).map((p) => ({ token: p.placeholder, type: p.kind || 'structure', raw: p.raw })),
    contextBefore: String(contextBefore || ''),
    contextAfter: String(contextAfter || ''),
    translation: '',
  };
}

/** Build the in-memory kit (manifest + segments + glossary). */
export function buildKit({
  story,
  sourceVersion = null,
  sourceCommit = null,
  inventoryFingerprint = null,
  targetLanguage = null,
  scope = 'all',
  segments = [],
  glossary = [],
  generatedAt = new Date().toISOString(),
}) {
  return {
    manifest: {
      schemaVersion: KIT_SCHEMA_VERSION,
      kind: KIT_KIND,
      generatedAt,
      targetStory: {
        sha256: story.sha256,
        bytes: story.size,
        passages: story.passages.length,
        format: story.storyAttrs ? `${story.storyAttrs.format} ${story.storyAttrs['format-version']}` : null,
      },
      sourceVersion,
      sourceCommit,
      inventoryFingerprint,
      targetLanguage,
      translationQaVersion: TRANSLATION_QA_VERSION,
      patchPlannerVersion: PATCH_PLANNER_VERSION,
      scope,
      exportedCount: segments.length,
    },
    segments,
    glossary,
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function serializeSegmentsJsonl(segments) {
  return segments.map((s) => JSON.stringify(s)).join('\n') + (segments.length ? '\n' : '');
}

function placeholdersCell(seg) {
  return (seg.placeholders || []).map((p) => p.token).join(' ');
}

export function serializeSegmentsCsv(segments) {
  const rows = [SEGMENT_CSV_COLUMNS.join(',')];
  for (const s of segments) {
    rows.push(SEGMENT_CSV_COLUMNS.map((c) => csvEscape(c === 'placeholders' ? placeholdersCell(s) : s[c])).join(','));
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

export function serializeGlossaryCsv(glossary) {
  const rows = ['from,to,note'];
  for (const g of glossary || []) rows.push([g.from, g.to, g.note || ''].map(csvEscape).join(','));
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

/** `issues.jsonl` — one machine-readable problem record per repair unit. */
export function serializeIssuesJsonl(issues) {
  const list = issues || [];
  return list.map((i) => JSON.stringify(i)).join('\n') + (list.length ? '\n' : '');
}

/** Parse a `glossary.csv` payload (columns `from,to,note`, RFC4180 quoting). */
export function parseGlossaryCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  const idx = (name) => header.indexOf(name);
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (cells.length === 1 && cells[0].trim() === '') continue;
    out.push({
      from: cells[idx('from')] || '',
      to: cells[idx('to')] || '',
      note: cells[idx('note')] || '',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing (import side)
// ---------------------------------------------------------------------------

/** Minimal CSV reader (RFC4180-ish): quotes, escaped quotes, commas, newlines, BOM. */
export function parseCsv(text) {
  const s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; }
      else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function parseSegmentsJsonl(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t));
  }
  return out;
}

export function parseSegmentsCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.length === 1 && r[0] === '') continue;
    const obj = {};
    for (let j = 0; j < header.length; j += 1) obj[header[j]] = r[j] == null ? '' : r[j];
    out.push(obj);
  }
  return out;
}

/**
 * Merge the canonical JSONL and the convenience CSV. JSONL is canonical; a CSV
 * value is only used when the JSONL value is empty. If BOTH carry a non-empty
 * but different translation for the same unitId the package is rejected for
 * that unit — never guessed.
 */
export function mergeSegmentTranslations({ jsonl = [], csv = [] }) {
  const byId = new Map();
  const order = [];
  const ensure = (id) => {
    if (!byId.has(id)) { byId.set(id, { unitId: id, jsonl: null, csv: null, jsonlSeg: null, csvRow: null }); order.push(id); }
    return byId.get(id);
  };
  for (const seg of jsonl) { const e = ensure(seg.unitId); e.jsonl = String(seg.translation == null ? '' : seg.translation); e.jsonlSeg = seg; }
  for (const row of csv) { if (!row.unitId) continue; const e = ensure(row.unitId); e.csv = String(row.translation == null ? '' : row.translation); e.csvRow = row; }

  const units = [];
  const conflicts = [];
  for (const id of order) {
    const e = byId.get(id);
    const j = (e.jsonl || '').trim();
    const c = (e.csv || '').trim();
    if (j && c && j !== c) {
      conflicts.push({
        unitId: id,
        reason: 'jsonl-csv-conflict',
        jsonlTranslation: e.jsonl == null ? '' : String(e.jsonl),
        csvTranslation: e.csv == null ? '' : String(e.csv),
      });
      continue;
    }
    units.push({ unitId: id, translation: j || c || '', source: j ? 'jsonl' : (c ? 'csv' : 'none'), jsonlSeg: e.jsonlSeg, csvRow: e.csvRow });
  }
  return { units, conflicts };
}

// ---------------------------------------------------------------------------
// Zip I/O
// ---------------------------------------------------------------------------

function dirnameOf(p) {
  return path.dirname(path.resolve(p));
}

/**
 * Write a kit to a store-only zip.
 *
 * `readme` / `rules` override the generated human text; `issues` adds the
 * optional `issues.jsonl` sidecar (a repair kit uses both). Everything else
 * keeps the exact v1 localization-kit layout.
 */
export function exportKitZip(kit, zipPath, { readme = null, rules = null, issues = null } = {}) {
  const entries = [
    { name: KIT_FILES.manifest, data: `${JSON.stringify(kit.manifest, null, 2)}\n` },
    { name: KIT_FILES.readme, data: readme != null ? readme : readmeText(kit) },
    { name: KIT_FILES.rules, data: rules != null ? rules : rulesText(kit) },
    { name: KIT_FILES.segmentsJsonl, data: serializeSegmentsJsonl(kit.segments) },
    { name: KIT_FILES.segmentsCsv, data: serializeSegmentsCsv(kit.segments) },
    { name: KIT_FILES.glossaryCsv, data: serializeGlossaryCsv(kit.glossary) },
  ];
  if (issues && issues.length) entries.push({ name: KIT_FILES.issues, data: serializeIssuesJsonl(issues) });
  const buf = createZip(entries);
  fs.mkdirSync(dirnameOf(zipPath), { recursive: true });
  fs.writeFileSync(zipPath, buf);
  return { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), segments: kit.segments.length };
}

function tryRead(buf, name) {
  try { return readStoredEntry(buf, name).toString('utf8'); } catch { return null; }
}

/** Read a kit back from disk. Validates kind + schema major. */
export function importKitZip(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const manifestText = tryRead(buf, KIT_FILES.manifest);
  if (!manifestText) throw new Error(`not a localization kit: missing ${KIT_FILES.manifest}`);
  let manifest;
  try { manifest = JSON.parse(manifestText); } catch (e) { throw new Error(`invalid manifest.json: ${e && e.message}`); }
  if (manifest.kind !== KIT_KIND) throw new Error(`not a localization kit: kind=${manifest.kind}`);
  const major = String(manifest.schemaVersion || '').split('.')[0];
  if (major !== KIT_SCHEMA_VERSION.split('.')[0]) throw new Error(`unsupported kit schemaVersion ${manifest.schemaVersion}`);

  const jsonlText = tryRead(buf, KIT_FILES.segmentsJsonl);
  const csvText = tryRead(buf, KIT_FILES.segmentsCsv);
  if (jsonlText == null && csvText == null) throw new Error('kit has neither segments.jsonl nor segments.csv');
  const jsonl = jsonlText ? parseSegmentsJsonl(jsonlText) : [];
  const csv = csvText ? parseSegmentsCsv(csvText) : [];
  const merged = mergeSegmentTranslations({ jsonl, csv });
  return {
    manifest,
    jsonl,
    csv,
    units: merged.units,
    conflicts: merged.conflicts,
    hasJsonl: jsonlText != null,
    hasCsv: csvText != null,
    files: {
      readme: tryRead(buf, KIT_FILES.readme),
      rules: tryRead(buf, KIT_FILES.rules),
      glossaryCsv: tryRead(buf, KIT_FILES.glossaryCsv),
      issuesJsonl: tryRead(buf, KIT_FILES.issues),
    },
  };
}

// ---------------------------------------------------------------------------
// Human-facing text
// ---------------------------------------------------------------------------

export function readmeText(kit) {
  const m = kit.manifest;
  const lang = m.targetLanguage ? ` (target language: ${m.targetLanguage})` : '';
  return [
    '# Localization kit',
    '',
    'This archive hands you the source text that still needs a translation,',
    'together with its structural placeholders. Fill in the **translation**',
    'field and hand the zip (or the filled `segments.jsonl` / `segments.csv`)',
    'back.',
    '',
    '## Identity',
    `- Target source version: ${m.sourceVersion}`,
    `- Target story sha256: ${m.targetStory.sha256}`,
    `- Scope: ${m.scope}${lang}`,
    `- Units: ${m.exportedCount}`,
    `- Translation QA version: ${m.translationQaVersion}; patch planner version: ${m.patchPlannerVersion}`,
    '',
    '## Rules',
    '1. Fill only the `translation` field; do not change any other field.',
    '2. Placeholders such as `\u27e60\u27e7` `\u27e61\u27e7` must be kept verbatim, in the same count and order.',
    '3. Do not translate code, macros (`<<...>>`), variables (`$x`), HTML tags, or link targets.',
    '4. Keep the original meaning, tone and specificity; never change facts, conditions, or numbers.',
    '5. Locked terms in `glossary.csv` (if present) take priority over free wording.',
    '6. Do not edit identity fields such as `unitId`, `rawSourceHash`, `protectedHash`.',
    '',
    '## Two ways to fill',
    '- `segments.jsonl`: canonical machine format, one JSON object per line.',
    '- `segments.csv`: convenience format. If the same unitId is filled in both with different values, import fails for that unit instead of guessing.',
    '',
    '## Returning the work',
    'Hand back the filled zip (or at least `segments.jsonl`). Import re-runs placeholder,',
    'structural, reversible, ReplacePatcher and coverage checks; entries that fail are',
    'rejected individually with a reason and are never packed silently.',
    '',
  ].join('\n');
}

export function rulesText(kit) {
  const lines = [
    '# Translation rules (external translations must satisfy these)',
    '',
    '1. Fidelity: do not delete, add, or soften; keep tone and specificity.',
    '2. Placeholders `\u27e6n\u27e7`: verbatim, same count, same order. Hard structural requirement.',
    '3. Macros / variables / HTML / link targets: keep verbatim, do not translate.',
    '4. Conditional logic (`<<if>>` / `<<elseif>>` / `<<else>>` / `switch`) and numbers: do not modify.',
    '5. An empty translation is allowed: that unit is recorded as `deferred` (`--require-complete` turns it into a failure).',
    '6. Terms: the locked terms below (if any) must be used exactly.',
    '',
  ];
  if (kit.glossary && kit.glossary.length) {
    lines.push('| from | to | note |', '| --- | --- | --- |');
    for (const g of kit.glossary) lines.push(`| ${g.from} | ${g.to} | ${g.note || ''} |`);
  } else {
    lines.push('(No extra locked terms in this kit; follow the game\'s established names.)');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * README for a repair kit: a small, secondary kit that carries only the
 * entries a previous import could not accept (rejected / deferred / JSONL-CSV
 * conflict). It re-uses the localization-kit layout so the user fills
 * `translation` and hands the same archive back to `kit import`.
 */
export function repairReadmeText(kit, issues = []) {
  const m = kit.manifest;
  const counts = {};
  for (const i of issues) counts[i.status] = (counts[i.status] || 0) + 1;
  const summary = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || 'none';
  return [
    '# Localization repair kit',
    '',
    'This is a **repair kit**. It carries only the entries from your last import',
    'that could not be accepted: rejected, deferred, or JSONL/CSV conflicts.',
    'Everything that was already accepted has been written to your localization',
    'state and is deliberately **not** repeated here, so you only fix the small',
    'remainder.',
    '',
    '## What to do',
    '1. Read `issues.jsonl`. It explains, per unit, what was wrong:',
    '   `{ "unitId", "status", "reason", "codes": [...] }`, plus the two',
    '   conflicting values for a `conflict`.',
    '2. Fix each entry by editing **only** the `translation` field in',
    '   `segments.jsonl` (or `segments.csv`).',
    '3. Hand this archive straight back to the importer:',
    '',
    '   node core/src/run.mjs kit import <repair-kit.zip> --story <index.html> --out <state.jsonl>',
    '',
    '   The fixes merge into the same `state.jsonl`; you do **not** re-import the',
    '   original kit.',
    '',
    '## Rules',
    '- Edit **only** `translation`. Do not change `unitId`, `protectedSource`,',
    '  `rawSourceHash`, `protectedHash`, `sourceFingerprint`,',
    '  `structuralFingerprint`, `placeholders`, or any `context*` field.',
    '- Keep placeholders (`\u27e6n\u27e7`), macros, variables, HTML tags and link',
    '  targets exactly as they appear in `protectedSource`.',
    '- `issues.jsonl` is a read-only explanation; editing it fixes nothing.',
    '- An entry whose `translation` stays empty is reported as `deferred`',
    '  (`--require-complete` treats that as a failure).',
    '',
    '## Identity',
    `- Target story sha256: ${m.targetStory.sha256}`,
    `- Source version: ${m.sourceVersion}`,
    `- Target language: ${m.targetLanguage}`,
    `- Scope: ${m.scope}`,
    `- Units in this repair kit: ${m.exportedCount}`,
    `- Issues in this repair kit: ${summary}`,
    '',
    '## Why a conflict has an empty translation',
    'When `segments.jsonl` and `segments.csv` disagreed for the same unit, this',
    'repair kit leaves `translation` empty in **both** so it cannot conflict',
    'again on re-import. The two original values are recorded in `issues.jsonl`',
    'as `jsonlTranslation` and `csvTranslation`; pick one or write a new one.',
    '',
  ].join('\n');
}
