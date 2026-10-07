# Runtime Scene Candidates (template)

Use this template to pick the scenes for `runtime/scenarios.example.json`
(rename it for your own runs). Keep the set small, fixed, and repeatable.

## Selection rules

* Prefer scenes whose text is a single narrative passage that your pack covers.
* Include at least one long-text scene (wrapping / scroll worst case).
* Include a screen dominated by widget / JS text as a tier-C scene.
* Prefer scenes reachable from a normal new game without long play.
* Never assert exact full sentences: prefer short distinctive fragments.

## Checklist per scene

| field | guidance |
| --- | --- |
| `id` | stable, e.g. `a1-opening` |
| `tier` | `A` (text must be replaced) or `C` (function only) |
| `passage` / `overlay` | the navigation target |
| `require` | CSS selectors that must exist after navigation |
| `expectTargetAny` | 1–3 short target-language fragments (tier A) |
| `forbidSourceAny` | 1–3 short source-language fragments that must be gone (tier A) |
| `interaction` | optional `search` (`input`, `value`, `countSelector`) or `endcombat` |
| `prelude` | optional `<<...>>` widgets the game's own debug entry runs first |

## Levels

List scene ids under `levels.smoke` (fastest), `levels.regression`
(representative), and `levels.exhaustive` (everything).
