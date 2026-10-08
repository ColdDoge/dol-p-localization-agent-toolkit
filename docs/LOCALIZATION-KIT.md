# Localization Kit

`localization-kit.zip` is a self-contained hand-off: the protected source, its
placeholders, an optional glossary, and the run identity, so a translator can
fill `translation` and hand the zip back.

## Visual editing (optional)

For translators who prefer source/translation pairs instead of editing CSV or
JSONL directly, the repository also includes a **standalone offline browser
editor**: [dolp-kit-translation-editor.html](../dolp-kit-translation-editor.html).
Read the [English guide](KIT-EDITOR-GUIDE.en.md) or the
[中文使用指南](翻译编辑器使用指南.md).

It reads a Kit ZIP, preserves manifest/immutable segment fields, exports a new
ZIP with matching `segments.jsonl` / `segments.csv` translations, and
accepts a teammate's complete matching ZIP or JSONL as a hand-off.
This is **not** a translation backend or a replacement for `kit import` / QA.
Keep exported ZIP and glossary JSON backups; browser drafts are local only.

## Contents

```text
manifest.json         identity + compatibility contract
README.md             user-facing instructions
TRANSLATION-RULES.md  rule sheet
segments.jsonl        canonical machine format (one unit per line)
segments.csv          convenience format for humans / spreadsheets
glossary.csv          optional locked terms (user-provided)
```

## Segment fields

`unitId`, `passage`, `kind`, `family`, `riskLevel`, `protectedSource`,
`rawSourceHash`, `protectedHash`, `sourceFingerprint`,
`structuralFingerprint`, `placeholders[]`, `contextBefore`, `contextAfter`,
`translation` (empty, for the translator).

## Export scopes

* `all` — every translatable unit.
* `untranslated` / `missing` — units with no valid translation yet.
* `changed` — units whose source text changed (`superseded`).

## One-shot chunked export

For a real target the candidate set can exceed 100,000 segments, which is
unfriendly to spreadsheets and to slow manual translation. One command can now
produce several independent kits instead of one giant file:

```bash
node core/src/run.mjs kit export \
  --story <index.html> \
  --scope all \
  --chunk-size 5000 \
  --output-dir _work/kits
```

```text
_work/kits/
  localization-kit-001.zip
  localization-kit-002.zip
  ...
  index.json
```

The whole current scope (after `--limit`) is split once, in the stable
inventory order, so every segment lands in exactly one chunk with no duplicates
and no gaps, and repeated runs keep the same order. Each chunk is a complete
kit with the usual files (`manifest.json`, `README.md`, `TRANSLATION-RULES.md`,
`segments.jsonl`, `segments.csv`, `glossary.csv`) and can be imported on its
own. Chunks share the same target story, source version, target language,
glossary and inventory fingerprint; only `exportedCount` reflects that chunk.
The last chunk may be shorter than `--chunk-size`, and the number width grows
past 3 digits when needed (`localization-kit-0001.zip`, ...).

`index.json` records the run and each chunk:

```json
{
  "targetStory": "…sha256…",
  "scope": "all",
  "totalSegments": 12345,
  "chunkSize": 5000,
  "chunkCount": 3,
  "chunks": [{ "filename": "localization-kit-001.zip", "segmentCount": 5000, "sha256": "…" }]
}
```

Chunk mode is opt-in. Without `--chunk-size` the export stays a single
`--output <kit.zip>`. `--output` and `--output-dir` cannot be combined.

## Import gates

Import never trusts the package. Per entry, in order: manifest schema + kind;
target story `sha256`; identity and declared hashes; placeholder integrity;
reversible restore; V3 structural guard; no-op check. JSONL is canonical; the
CSV value is used only when the JSONL value is empty, and a genuine conflict is
rejected rather than guessed. An empty translation is recorded as `deferred`
(a hard failure under `--require-complete`).

Accepted entries are written to the localization state (`state.jsonl`), which
the build reads. Import does not call a model and does not write a translation
cache.

Import always scans the whole kit: a rejected entry never stops the scan, so
accepted entries are still written and every problem is collected in one pass.

## Repair kit

When an import has blockers — `rejected`, `deferred`, or a JSONL/CSV
`conflict` — you can ask for a small **repair kit** that carries only those
units, so the user fixes a handful of entries instead of the whole run:

```bash
node core/src/run.mjs kit import _work/kit-filled.zip \
  --story <index.html> \
  --out _work/state.jsonl \
  --require-complete \
  --report _work/import-report.json \
  --repair-output _work/repair-kit.zip
```

The repair kit re-uses the localization-kit layout and adds an `issues.jsonl`
sidecar with one machine-readable line per problem:

```json
{ "unitId": "4:0-71", "status": "rejected", "reason": "qa-failed", "codes": ["V3_VARIABLE_CHANGED"] }
```

* **rejected** — the user's submitted translation is preserved so they can see
  and edit it; identity and hashes are regenerated from the current target so
  the repaired entry re-imports cleanly.
* **deferred** — `translation` stays empty for the user to fill.
* **conflict** — `translation` is empty in both `segments.jsonl` and
  `segments.csv` so the repair kit cannot conflict again; the two original
  values are recorded in `issues.jsonl` as `jsonlTranslation` / `csvTranslation`.

Fix only the `translation` field, then hand the same archive back to `kit
import`; the fixes merge into the existing `state.jsonl` and you never re-import
the original kit. `--require-complete` still fails while any blocker remains.
When there is nothing to repair, no file is written and the report sets
`noRepairNeeded: true` and `repairKit: null`.
