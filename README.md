# DoL/DoLP Localization Agent Toolkit

A local, offline-first toolkit for maintaining a SugarCube / ModI18N game
localization: inventory the target story, export the text that needs
translating, audit an existing localization, import user translations, build a
localization pack, migrate an old localization to a new game version, and
(optionally) validate the pack on a real device.

It is a **localization engineering** tool. It protects the game's structure and
tracks translation coverage; you supply the actual translations.

## What it is not

* It does **not** generate translations. There is no machine translation, no AI
  translation backend, and no translation prompts.
* It does **not** ship any translation. No game text, no user translations, no
  translation memory, and no verified-translation cache are bundled or kept by
  the toolkit.
* User translations you import are treated as your local data. The toolkit
  never reuses them across projects and never turns them into a translation
  memory.

## The five workflows

| Mode | How | Purpose |
| --- | --- | --- |
| Export full text | `kit export --scope all` | Export every translatable unit of the current target |
| Audit existing localization | `audit`, then `kit export --scope untranslated\|missing\|changed` | Find missing / changed text and export only that |
| Import + build | `kit import`, then `build` | Validate your translations and build a pack |
| Version migration | `migrate` | Move an older localization onto a newer target version |
| Runtime validation (optional) | `runtime/android/test-localization-runtime.mjs` | Install the built pack on a device and check it renders |

Supporting (not user-facing modes): target/version detection, canonical
inventory, text classification, a deterministic structure cache, structural
protection (placeholders / macros / variables / HTML / reversible / V3), patch
planning with a ReplacePatcher replay gate, and coverage accounting.

## Requirements

* Node.js >= 22 (uses global `fetch` / `WebSocket`). No npm dependencies.
* Optional runtime validation: `adb` is required for on-device runs.
  Google Android CLI and
  [Paisley Park](https://github.com/102326/DoL-Dev-Tools-Paisley-Park) are
  optional and are used only for inspection / screenshot / backup evidence.

## Quick start (offline)

The v1 entry point is `node core/src/run.mjs ...`. Everything below is offline;
it never touches ADB, the Android SDK, Paisley Park, or a device.

```bash
node core/src/run.mjs selftest
node core/src/run.mjs --help

node core/src/run.mjs inventory --story <target>/assets/www/index.html --out _work/inventory.json
node core/src/run.mjs kit export --story <target>/assets/www/index.html --output _work/kit.zip --scope all

# open _work/kit.zip, fill the `translation` field of each segment, then:
node core/src/run.mjs kit import _work/kit-filled.zip --story <target>/assets/www/index.html --out _work/state.jsonl
node core/src/run.mjs build --story <target>/assets/www/index.html --state _work/state.jsonl --output _work/pack.mod.zip --mode strict
```

`--story` is the compiled `assets/www/index.html` of your target build (extracted
from your APK). See `docs/TOOLKIT-OVERVIEW.md` for the full command surface.

### Runnable end-to-end demo

The repository ships a synthetic, non-Chinese fixture so the whole flow can be
run without your game or your translations:

```bash
node examples/run-example.mjs
```

It runs inventory to audit to kit export to import to QA to strict build to
partial build against `examples/story/index.html`, writing to `examples/_work/`
(git-ignored). This fixture proves the offline pipeline; it is **not** a pack
you can inject into an arbitrary real target.

## Coverage and build modes

The toolkit classifies every unit of the current target into exactly one state:

```text
translated-valid   the user translation passed the current structural QA
untranslated       the unit exists in the target but has no valid translation
rejected-structure the supplied translation failed structural QA
superseded         the source text changed, so the old translation is stale
unresolved         a valid translation that the planner could not place
obsolete           the record no longer exists in the current target
```

`strict` build fails (non-zero exit, explicit coverage report) if any of
`untranslated`, `rejected-structure`, `superseded`, `unresolved` is non-zero,
and writes no pack. `obsolete` never blocks a strict build. `partial` build
ships only `translated-valid` units, always emits a coverage report, and marks
the result as partial (use it for iteration, not for release).

For export, `missing` is the export-side name for `untranslated` and `changed`
is the export-side name for `superseded`; they are not additional states.

## Concepts

* **Structure cache** - a deterministic accelerator holding only machine-derived
  facts about a target (story identity, inventory fingerprint, provenance map).
  It contains no translations, is reusable only for an identical target story,
  and saves parse time, nothing else.
* **Localization kit** (`kit.zip`) - the hand-off for external translation:
  protected source, placeholders, an optional user glossary. Import re-verifies
  every entry before it is accepted.
* **Localization state** (`state.jsonl`) - your imported translations plus
  provenance. Produced by `kit import`, read by `build` / `qa`. It is your data
  and is never shipped.
* **Pack** (`*.mod.zip`) - a ReplacePatcher addon the game's ModLoader installs.

## Runtime validation (optional, opt-in)

```bash
node runtime/localization_smoke_build.mjs --story <index.html> --state <state.jsonl> [--scenarios <file>]
node runtime/android/doctor.mjs
node runtime/android/test-localization-runtime.mjs --level smoke
```

The on-device harness is **optional** and needs your explicit go-ahead for each
run. It imports and removes the smoke pack through the ModLoader's own API and
never touches your saves. See [docs/RUNTIME-VALIDATION.md](docs/RUNTIME-VALIDATION.md).

Runtime notes:

* A device smoke needs a **real target story** plus your **localization data**
  (a state file or a user-provided localization package). The in-repo synthetic
  fixture is for offline end-to-end use only.
* Assertions are language-agnostic: `expectTargetAny` / `forbidSourceAny`.
  Script-ratio and word-count numbers are diagnostics and never gate.

## Targets and parameterization

The toolkit is built for SugarCube / ModI18N games. The inputs that change per
target are all user-supplied, not hard-coded: the compiled story `index.html`,
the source version tag, the target package id, the device serial, the CDP target
page title, the external dev-tools path, and the upstream/provenance refs. It
ships no built-in package id, device serial, or game title.

## Tests

```bash
node core/src/selftest.mjs
node --test core/test/*.test.mjs
node --test runtime/android/test/*.test.mjs
node examples/run-example.mjs
```

## Status and limitations

* v1 is a **source distribution**: run it with `node`; there is no npm release
  and no packaging step.
* Coverage is per unit of the current target. It does not claim to localize
  content that lives entirely inside widgets or JavaScript (button labels,
  generated names, settings / save / feats overlays). Those screens are why the
  runtime smoke has tier-C "still works" scenes.
* Runtime validation is validated on Android + ModLoader; the offline workflow
  is platform-independent.

## Layout

```text
core/src/lib/     structural core + localization workflow
core/src/run.mjs  CLI entry point
runtime/          optional on-device localization smoke harness
schemas/          JSON schemas for the artifacts the toolkit reads/writes
examples/         synthetic fixture (pseudo-language), no game text
docs/             contracts and workflow
```

See `docs/TOOLKIT-OVERVIEW.md` for the full interface.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for third-party references.
