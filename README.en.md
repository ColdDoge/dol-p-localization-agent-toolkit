# DoL/DoLP Localization Agent Toolkit

[中文说明](README.zh-CN.md) · [Prompt presets](docs/PROMPTS.en.md) · [中文提示词](docs/PROMPTS.zh-CN.md)

A local, offline-first toolkit for maintaining a SugarCube / ModI18N game
localization. It inventories a target story, exports text that needs work,
audits existing localization data, imports user translations, builds a
localization pack, migrates an older localization to a newer target, and can
optionally validate the result on a real Android device.

It is a **localization engineering** tool. It protects game structure and tracks
coverage; **you supply the translations**.

**[Project background, motivation & acknowledgements — Full English version](docs/PROJECT-BACKGROUND-AND-ACKNOWLEDGEMENTS.en.md)**

## Visual translation editor (single offline HTML)

**[Open / download the HTML editor](dolp-kit-translation-editor.html)** · [English user guide](docs/KIT-EDITOR-GUIDE.en.md) · [中文指南](docs/翻译编辑器使用指南.md) · [中文完整功能说明](docs/网页翻译工具使用指南.md)

Prefer not to edit `segments.csv` or `segments.jsonl` directly? Save `dolp-kit-translation-editor.html` from the repository root (**Download raw file** on GitHub), then open it locally in Chrome or Edge. The standalone page bundles its ZIP library, needs no server or installation, and does **not upload Kit files or translations**.

Basics: import a regular, chunked, or repair Kit ZIP; edit source/translation pairs with search, filters, pagination, original/untranslated-first sorting, theme and Chinese/English UI; copy one or all protected sources; keep a reusable keyword glossary with explicit per-entry replacement and JSON backup; merge a colleague's matching ZIP or `segments.jsonl` by `unitId`; export a new ZIP with synchronized `segments.jsonl` / `segments.csv` (the original is unchanged).

Added features — the nine capabilities of the current editor:

1. **Autosave & recovery** — debounced drafts with several recovery points, a save status that never fakes success, and a restore-draft / use-imported-file / export-backup-first choice when a draft exists; drafts are isolated per project.
2. **Safety check** — placeholder count / order / match plus stray macros, variables, HTML tags and links typed into a translation; reports, locates and never edits.
3. **Search & advanced filters** — untranslated / translated / needs proofreading / proofread / flagged / has safety issues / contains a term / translation conflict / duplicate source, combined as raw → search → filter → sort → page.
4. **Undo / redo** — single edits, copy source, keyword replace, batch import, status marks, hand-off merge and migration are recorded as undoable steps (`Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+Y`); the translation box keeps its native per-character undo.
5. **Safe hand-off merge** — fill blanks only (default) / keep current and skip conflicts / preview each conflict / overwrite after explicit confirmation, with pre-import statistics and an undoable result.
6. **Progress & status marks** — project-wide statistics (total / translated / untranslated / progress / needs proofreading / proofread / flagged / safety issues) plus per-entry unmarked / needs proofreading / proofread / flagged and a short note, kept out of the game pack.
7. **Terminology consistency** — checks your keyword glossary against each source term, offers the expected wording, and lets you ignore a warning or apply a confirmed replacement.
8. **Duplicate source** — groups identical protected sources and fills blanks only; a group with several different translations is skipped until you explicitly choose one.
9. **New-version migration** — matches old translations to the current Kit by stable ID + protected source, fills blanks only, and reports unchanged / added / removed / source-changed / ambiguous entries without silently overwriting.

**Pagination:** a top and a bottom bar share one page state and show up to nine centred page numbers (clamped at the first and last page), keep previous / next, and add a numeric jump box that accepts Enter and clamps out-of-range input.

**Important:** Copying source text is not equivalent to translation; the built-in checks are advisory, not a full structural validator. Status marks, notes and ignored terms live in a separate `*.dolpkit.json` project file and the browser draft, **never in the game pack**. Use the normal `kit import → qa → strict build` checks before publication. The toolkit **does not generate translations**.

More (Chinese): [translation data safety & recovery](docs/翻译数据安全与恢复说明.md) · [safe merge & version migration](docs/多人合并与版本迁移指南.md) · [feature test report](docs/功能增强测试报告.md).

## Start with a ready-to-send agent prompt

If you use a coding agent, you do not need to memorize the CLI first. Pick the
task that matches your situation and copy the whole prompt:

| Task | Prompt |
| --- | --- |
| Start a localization from scratch | [Open prompt](docs/PROMPTS.en.md#new-localization) |
| Audit or continue an existing localization | [Open prompt](docs/PROMPTS.en.md#audit-existing) |
| Migrate to a new game version | [Open prompt](docs/PROMPTS.en.md#version-migration) |
| Build and QA an existing localization | [Open prompt](docs/PROMPTS.en.md#build-and-qa) |
| Run optional on-device validation | [Open prompt](docs/PROMPTS.en.md#runtime-validation) |

The prompts are written so an agent can begin in an empty folder, clone this
repository, read the public contract, and ask only for the user files that are
actually required.

## What it is not

- It does **not** generate translations. There is no built-in machine
  translation, AI translation backend, or translation prompt pipeline.
- It does **not** ship game text, user translations, translation memory, or a
  verified-translation cache.
- Imported user translations remain user data. The toolkit does not reuse them
  across projects or turn them into a cross-project translation memory.

## Requirements

- Node.js >= 22. The offline toolkit has no npm dependencies.
- The toolkit's actual target input is the compiled game page
  `assets/www/index.html`. In these docs this file is called the **target
  story**. It contains the compiled SugarCube story/passages the toolkit
  inventories and patches.
  - If you already have an extracted game directory, point `--story` directly
    at its `assets/www/index.html`.
  - If you only have an APK, a coding agent may use an ordinary archive tool to
    extract only `assets/www/index.html` into `_work/` and use that copy.
    APK extraction is an input-preparation step, not a toolkit CLI feature.
  - `examples/story/index.html` in this repository is synthetic test data. It
    is only for the offline demo and cannot replace a real target story.
- Optional on-device validation: `adb` is required for device runs.
  Google Android CLI and
  [Paisley Park](https://github.com/102326/DoL-Dev-Tools-Paisley-Park) are
  optional and are used only for inspection / screenshot / backup evidence.

## The five workflows

| Mode | Main command(s) | Purpose |
| --- | --- | --- |
| Export full text | `kit export --scope all` | Export every translatable unit of the current target |
| Audit existing localization | `audit`, then `kit export --scope missing` / `changed` | Find text that is missing or stale |
| Import + build | `kit import`, then `qa` and `build` | Re-validate user translations and build a pack |
| Version migration | `migrate` | Move an older localization state onto a newer target when identity is still safe |
| Runtime validation | runtime scripts under `runtime/` | Optionally install a smoke subset on a real device and verify rendering |

Supporting capabilities include target/version detection, canonical inventory,
text classification, deterministic structure cache, structural protection,
ReplacePatcher planning/replay checks, and coverage accounting.

## Quick start (offline CLI)

The v1 CLI entry point is:

```bash
node core/src/run.mjs ...
```

Everything in this section is offline and does not probe ADB or a device.

```bash
node core/src/run.mjs selftest
node core/src/run.mjs --help

node core/src/run.mjs inventory \
  --story <target>/assets/www/index.html \
  --out _work/inventory.json

node core/src/run.mjs kit export \
  --story <target>/assets/www/index.html \
  --output _work/kit.zip \
  --scope all

# Fill the translation fields in the exported kit, then:
node core/src/run.mjs kit import _work/kit-filled.zip \
  --story <target>/assets/www/index.html \
  --out _work/state.jsonl

node core/src/run.mjs qa \
  --story <target>/assets/www/index.html \
  --state _work/state.jsonl \
  --report _work/qa.json

node core/src/run.mjs build \
  --story <target>/assets/www/index.html \
  --state _work/state.jsonl \
  --output _work/pack.mod.zip \
  --mode strict
```

### Large localizations

A real target can exceed 100,000 segments. Two conveniences keep large manual
translation practical without changing any check:

```bash
# One-shot chunked export: several independent kits + index.json in one run.
node core/src/run.mjs kit export \
  --story <target>/assets/www/index.html \
  --scope all \
  --chunk-size 5000 \
  --output-dir _work/kits

# Import always scans the whole kit; collect every problem into a repair kit.
node core/src/run.mjs kit import _work/kit-filled.zip \
  --story <target>/assets/www/index.html \
  --out _work/state.jsonl \
  --require-complete \
  --report _work/import-report.json \
  --repair-output _work/repair-kit.zip
```

Chunked export is opt-in: without `--chunk-size` the export stays a single
`--output <kit.zip>`. A repair kit carries only the rejected / deferred /
conflict units plus an `issues.jsonl`; fix it and re-import it into the same
`state.jsonl`. Neither mode weakens placeholder, reversible, V3 structural,
planner or replay checks, and `--require-complete` still fails while blockers
remain.

For a no-game, no-translation demonstration:

```bash
node examples/run-example.mjs
```

The repository example uses a synthetic, non-Chinese pseudo-language. It proves
the offline pipeline only; it is not a real localization pack for DoL / DoLP.
Its `examples/story/index.html` is also only a synthetic test story and must
not be used as the `--story` input for a real game build.

## Coverage and build modes

Every unit of the current target is classified into one state:

| State | Meaning | Strict build |
| --- | --- | --- |
| `translated-valid` | User translation passed structural QA | PASS |
| `untranslated` | Current target has no valid translation for the unit | FAIL |
| `rejected-structure` | Translation failed placeholder / reversible / structural QA | FAIL |
| `superseded` | Source text changed and the old translation is stale | FAIL |
| `unresolved` | Translation is valid but the patch planner cannot place it safely | FAIL |
| `obsolete` | Record belongs to content no longer present in the current target | does not block |

`strict` writes no successful pack while any blocking state is non-zero and
returns a non-zero exit status. `partial` builds only `translated-valid` units,
always marks the report as partial, and is intended for iteration rather than
release.

For export, `missing` is the export-side name for `untranslated`, and `changed`
is the export-side name for `superseded`.

## Concepts

- **Structure cache** — deterministic machine-derived structure facts for one
  target story. It contains no translations and is reusable only when the
  target story identity matches.
- **Localization kit** (`kit.zip`) — protected source text, placeholders, an
  optional user glossary, and empty translation fields for external editing.
- **Localization state** (`state.jsonl`) — accepted user translations plus
  provenance. It is local user data, not a translation memory.
- **Pack** (`*.mod.zip`) — a ReplacePatcher addon generated from verified
  localization data.

## Runtime validation (optional)

Runtime validation is a separate, explicit opt-in path:

```bash
node runtime/localization_smoke_build.mjs --story <index.html> --state <state.jsonl>
node runtime/android/doctor.mjs
node runtime/android/test-localization-runtime.mjs --level smoke
```

A real device smoke requires a **real target story** plus user localization
data (`state.jsonl` or a user-provided localization package). The synthetic
repository example is offline-only.

Tier-A runtime assertions are language-agnostic:

- `expectTargetAny` — at least one expected target-language string must render.
- `forbidSourceAny` — forbidden source strings must not remain.

Script ratios and word/pronoun counts are diagnostics only and never decide
PASS / FAIL. See [Runtime Validation](docs/RUNTIME-VALIDATION.md).

## Targets and parameterization

The toolkit does not hard-code a package id, device serial, game installation
path, ModLoader version, or target identity. Target-specific values are
user-supplied through the CLI, local config, or environment variables.

## Tests

```bash
node core/src/selftest.mjs
node --test core/test/*.test.mjs
node --test runtime/android/test/*.test.mjs
node examples/run-example.mjs
```

## Status and limitations

- v1 is a source distribution. Run it with Node; there is no npm release.
- The canonical offline workflow is passage-text localization. Content rendered
  entirely by widgets / JavaScript can require separate runtime inspection.
- Runtime validation is implemented for Android + ModLoader; the offline core
  is platform-independent.

## Layout

```text
core/src/lib/     structural core + localization workflow
core/src/run.mjs  offline CLI entry point
runtime/          optional on-device localization validation
schemas/          JSON schemas for public artifacts
examples/         synthetic pseudo-language fixture
docs/             workflow and technical reference
```

Useful reference documents:

- [Toolkit overview](docs/TOOLKIT-OVERVIEW.md)
- [Agent workflow](docs/AGENT-WORKFLOW.md)
- [CLI options](docs/OPTIONS.md)
- [Localization kit](docs/LOCALIZATION-KIT.md)
- [Version migration](docs/VERSION-MIGRATION.md)
- [Protection rules](docs/PROTECTION-RULES.md)
- [Runtime validation](docs/RUNTIME-VALIDATION.md)
- [Translation editor user guide](docs/KIT-EDITOR-GUIDE.en.md) — download and basics
- [Full web-editor feature guide (中文)](docs/网页翻译工具使用指南.md) — all nine features and pagination
- [Translation data safety & recovery (中文)](docs/翻译数据安全与恢复说明.md)
- [Safe merge & version migration (中文)](docs/多人合并与版本迁移指南.md)
- [Feature test report (中文)](docs/功能增强测试报告.md)

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
