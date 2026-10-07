# Architecture

```text
compiled index.html
  -> story.mjs        parse <tw-storydata> / passages / bundled JS+CSS files
  -> elements.mjs     reversible SugarCube element spans (comment/macro/link/html/variable/text)
  -> inventory.mjs    canonical units (kind/family/risk) with placeholders
  -> protect.mjs      placeholder integrity + reversible + V3 (via protection-v3.mjs)
  -> entries.mjs      ReplacePatcher planning (anchor + cluster) + replay gate + QA
  -> coverage.mjs     user-translation state machine
  -> builder.mjs      source-agnostic pack assembly
```

Supporting modules: `structure-cache.mjs` (deterministic accelerator),
`localization-source.mjs` (user localization loader/validator),
`localization-state.mjs` (user localization state), `kit.mjs` / `kit-run.mjs`
(external hand-off), `provenance.mjs` / `upstream-source.mjs` (source identity),
`zip.mjs` (store-only zip).

## Boundaries

* No translation generation, no translation memory, no style / preferred
  reference, no verified-translation cache, no production store.
* The structural guard, the planner, and the coverage machine are pure over
  their inputs; I/O happens only in the CLI and the I/O helpers.
* SugarCube passage semantics, ModI18N, DoLP provenance, and the DoL/DoLP
  runtime profile stay project-specific; only the changing inputs (package id,
  source path, target identity, ModLoader / version, version pins) are
  parameterised.

## Data flow of a build

```text
state.jsonl --> coverage.mjs (translated-valid) --> builder.mjs --> *.mod.zip
                     |                                  |
                     +--> coverage report               +--> planner + replay QA
```
