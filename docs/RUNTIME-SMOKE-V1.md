# Runtime Localization Smoke v1

Goal: with a fixed, repeatable scene list, verify that a built localization pack
(1) really replaced the text it is supposed to replace, and (2) did not break
JavaScript-driven UI.

## Design

```text
offline: slice a small ReplacePatcher pack for the scene passages out of the
         user's localization data, and validate every expectation
device:  install it -> visit the fixed scenes -> uninstall it -> verify restore
verdict: tier A scenes must show target text and no source string;
         tier C scenes only have to still work.
```

The subset pack contains complete passages, so its `from`/`to` pairs are
byte-identical to a full build of the same data.

## Data source

The builder reads the user's localization state (`--state`) or a
user-provided localization package (`--package`). It never reads a private store.

## Assertions are language-agnostic

Each tier-A scene declares:

* `expectTargetAny` — at least one must appear in the rendered text;
* `forbidSourceAny` — none may appear in the rendered text.

The builder validates both against the user's translations and the target
source before a run, so the expectations are never hand-typed guesses. Non-ASCII
ratio and word counts are recorded as diagnostics only; they never gate.

## Scene file

See `runtime/scenarios.example.json` for the shape. A scene declares its id,
tier, passage or overlay, required selectors, optional interaction, and (tier A)
the two expectation lists. `levels` maps each level name to its scene ids.

## Known coverage limits

A narrative-only pack replaces passage text. Content rendered by widgets or JS
(pronoun macros, link-label buttons, generated names, settings / save / feats
overlays) is a different surface and stays in the source language; the tier-C
scenes exist to prove those screens still work, not that they are localized.
