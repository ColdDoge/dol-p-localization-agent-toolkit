# Toolkit Overview

The toolkit is a local, offline localization-engineering tool for SugarCube /
ModI18N games. It does not translate; you supply the translations and it
protects structure, tracks coverage, and builds a pack.

## Capabilities (v1)

User-facing modes:

1. **Export full text** — `kit export --scope all`.
2. **Audit existing localization** — `audit`, and `kit export --scope untranslated|missing|changed`.
3. **Import + build** — `kit import`, then `build` (strict or partial).
4. **Version migration** — `migrate`.
5. **Runtime validation** (optional) — `runtime/android/test-localization-runtime.mjs` (see `RUNTIME-VALIDATION.md`).

Supporting (not user modes): target/version detection, canonical inventory, text
classification, a deterministic structure cache, structural protection,
patch planning with a ReplacePatcher replay gate, and coverage accounting.

## CLI

Entry point: `node core/src/run.mjs <command>`. All commands are offline.

```text
inventory   --story <index.html> [--source-version <v>] [--out <inventory.json>]
audit       --story <index.html> [--state <state.jsonl>] [--localization <src>] [--report <report.json>]
kit export  --story <index.html> --output <kit.zip> [--scope all|untranslated|missing|changed]
            [--state <state.jsonl>] [--localization <src>] [--glossary <glossary.csv>]
            [--limit N] [--target-language <tag>] [--source-version <v>]
kit export  --story <index.html> --output-dir <dir> --chunk-size <n>
            [--scope ...] [--state <state.jsonl>] [--glossary <glossary.csv>] [--limit N]
            (one-shot chunked export: several independent kits + index.json)
kit import  <kit.zip> --story <index.html> --out <state.jsonl> [--require-complete]
            [--report <report.json>] [--repair-output <repair-kit.zip>]
build       --story <index.html> --state <state.jsonl> --output <pack.mod.zip>
            [--mode strict|partial] [--report <report.json>] [--name <n>] [--pack-version <v>]
qa          --story <index.html> --state <state.jsonl> [--report <report.json>]
migrate     --story <index.html> --state <old.jsonl> --out <new.jsonl> [--report <report.json>]
cache export --story <index.html> --output <structure-cache.zip> [--source-version <v>]
cache import <structure-cache.zip> --story <index.html> [--report <report.json>]
selftest
```

`--story` points at the target build's compiled `assets/www/index.html`.
This file is called the **target story** throughout the toolkit: it contains the
compiled SugarCube story/passages that inventory, audit, export, QA, build, and
migration use as the current-source baseline.

## Large localizations

Two export / import conveniences target real, large translations (a target can
exceed 100,000 segments) without changing the checks:

* **One-shot chunked export** — `kit export --chunk-size <n> --output-dir <dir>`
  splits the whole current scope into several independent kits (plus
  `index.json`) in one run, so a translator can work through batches without an
  "export a batch → upload → export the next batch" loop.
* **Repair kit** — `kit import ... --repair-output <repair-kit.zip>` always scans
  the entire kit, keeps accepted entries, and collects every rejected / deferred
  / JSONL-CSV conflict into a small repair kit (`issues.jsonl` included) that is
  filled and re-imported into the same `state.jsonl`.

Neither changes coverage semantics, the strict / `--require-complete` failure
rules, or the structural guards. `missing` / `changed` / `unresolved` keep their
existing meanings and are not folded into the repair kit.

If the user supplies an extracted game directory, use its
`assets/www/index.html` directly. If the user only supplies an APK, extracting
that one file with a normal archive tool into `_work/` is a valid preparation
step; APK extraction itself is not a toolkit CLI feature. The in-repository
`examples/story/index.html` is synthetic test data only and is not a substitute
for a real target story.

## Coverage states

Every unit of the current target is in exactly one state:

| state | meaning | strict |
| --- | --- | --- |
| `translated-valid` | the user translation passed the current structural QA | PASS |
| `untranslated` | the unit exists but has no usable translation (= export `missing`) | FAIL |
| `rejected-structure` | the supplied translation failed structural QA | FAIL |
| `superseded` | the source text changed, so the old translation is stale (= export `changed`) | FAIL |
| `unresolved` | a valid translation the planner could not place | FAIL |
| `obsolete` | the record no longer exists in the current target | not blocking |

`missing` and `changed` are export-side names for `untranslated` and
`superseded`; they are not extra persisted states.

## Build modes

* `strict` — if any blocking state is non-zero, no pack is written, a coverage
  report is emitted, and the process exits non-zero. A successful strict build
  is a complete pack.
* `partial` — builds only `translated-valid` units, always emits a coverage
  report, and marks the result `partial: true`. Never use it as a release pack.

## Inputs and outputs

* **Story**: the compiled target `assets/www/index.html` used as the source
  baseline. Never modified.
* **Localization source** (optional, hand-edited): JSON/JSONL of
  `{ passage, from, to }` entries.
* **Localization state** (`state.jsonl`): the user's imported translations +
  provenance. Produced by `kit import`; read by `build` / `qa`. This is the
  user's own data, not a translation memory, and is never shipped.
* **Localization kit** (`kit.zip`): the hand-off for external translation.
* **Pack** (`*.mod.zip`): a ReplacePatcher addon.

## What the toolkit never does

No translation generation, no translation memory, no verified-translation
cache, no style / preferred-reference guidance, no private store. It ships no
game text and no translation.
