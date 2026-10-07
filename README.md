# DoL/DoLP Localization Agent Toolkit

A local, offline-first toolkit for maintaining a SugarCube / ModI18N game
localization: inventory the target story, export the text that needs
translating, audit an existing localization, import user translations, build a
localization pack, migrate an old localization to a new game version, and
(optionally) validate the pack on a real device.

This toolkit **does not generate translations** and **does not ship any
translation**. You supply the translations; the toolkit protects structure,
checks coverage, and builds the pack.

## What it does

| Mode | Command | Purpose |
| --- | --- | --- |
| Export full text | `kit export --scope all` | Export every translatable unit of the current target |
| Audit existing localization | `audit` + `kit export --scope untranslated\|missing\|changed` | Find missing / changed text and export only that |
| Import + build | `kit import` then `build` | Validate user translations and build a pack |
| Version migration | `migrate` | Move an older localization onto a newer target version |
| Runtime validation (optional) | `runtime` | Install the built pack on a device and check it renders |

Supporting, non-user-facing abilities: target/version detection, canonical
inventory, text classification, a deterministic structure cache, structural
protection (placeholders / macros / variables / HTML / reversible / V3),
patch planning with a ReplacePatcher replay gate, and coverage accounting.

## Quick start

```bash
node core/src/run.mjs selftest
node core/src/run.mjs inventory --story examples/story/index.html --out _work/inventory.json
node core/src/run.mjs kit export   --story examples/story/index.html --output _work/kit.zip --scope all
node core/src/run.mjs kit import   _work/kit.zip --story examples/story/index.html --state _work/state.json
node core/src/run.mjs build --story examples/story/index.html --state _work/state.json --output _work/pack --mode strict
```

Everything above is offline. No ADB, Android SDK, Paisley Park, or device is
touched unless you explicitly run a `runtime` command.

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
`untranslated`, `rejected-structure`, `superseded`, `unresolved` is non-zero.
`obsolete` never blocks a strict build. `partial` build ships only
`translated-valid` units, always emits a coverage report, and marks the result
as partial.

For export, `missing` is the export-side name for `untranslated` and `changed`
is the export-side name for `superseded`; they are not additional persisted
states.

## Requirements

* Node.js >= 22 (global `fetch` / `WebSocket`), no npm dependencies.
* Optional runtime validation: `adb`, Google Android CLI, and
  [Paisley Park](https://github.com/102326/DoL-Dev-Tools-Paisley-Park).

## Layout

```text
core/src/lib/     structural core + localization workflow
core/src/run.mjs  CLI entry point
runtime/          optional on-device localization smoke harness
schemas/          JSON schemas for the artifacts the toolkit reads/writes
examples/         synthetic fixture (pseudo-language), no game text
docs/             contracts and workflow
```

See `docs/TOOLKIT-OVERVIEW.md` for the full interface and `LICENSE` / `NOTICE`
for licensing.
