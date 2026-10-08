# Runtime QA Levels

The localization family has one level scale: `smoke` / `regression` /
`exhaustive`. The scenario list and its level membership come from the scenario
file the smoke builder validated (`runtime/scenarios.example.json` ships a
synthetic template; real runs use the user's own scene list).

| level | use for | cost |
| --- | --- | --- |
| `smoke` | a quick "did the pack load and replace anything" check | cheapest |
| `regression` | the gate before shipping an updated pack | representative |
| `exhaustive` | release candidates and version upgrades | every scene |

## Mode semantics

```text
smoke        only the scenes listed under levels.smoke
regression   only the scenes listed under levels.regression
exhaustive   only the scenes listed under levels.exhaustive
```

The offline builder records the scenario file's full `levels` registry inside
`expectations.json`, so a run can select from a pack that was built at a wider
level (build once at `exhaustive`, then run `--level regression`). An
expectations file written before that registry existed only ever held the
scenes of its own build level, so it is used as-is rather than filtering
nothing out. `report.target.scenarioSource` says which of the two happened.

Scenes run without the game's own developer diagnostics: the harness leaves
`$options.debugdisable` at its shipped default instead of forcing it on. That
flag makes the game report its own state problems (its NaN scan over every
variable, undefined prints) as page errors, which a fresh cheat session
produces in every stateful passage; counted as `js-errors` they would fail
scenes the pack never touched. Real breakage still shows up — a malformed macro
or tag raises a SugarCube error regardless.

## Evidence flags

| flag | effect |
| --- | --- |
| `--backup` / `--no-backup` | run Paisley Park's app-data backup first (default: on) |
| `--baseline` / `--no-baseline` | run the control pass (same scenes with no pack) first (default: on) |
| `--inspect` / `--no-inspect` | capture screenshot / layout evidence via Paisley Park (default: off) |
| `--keep-installed` | skip cleanup (debugging only) |

Cleanup is never weakened: a failure after import still triggers best-effort
removal, reload, and restore verification.

## Verdict

```text
runtimeQa  = PASSED / FAILED   (any scenario failed -> FAILED)
cleanup    = RESTORED / FAILED / SKIPPED
```

Tier A asserts target text rendered and source text gone; tier C asserts only
that the screen still works. Non-ASCII ratio and word counts are diagnostics and
never affect the verdict.

### Page-visible errors and the control pass

The game can write error text straight into a passage (for example
`[ERROR: undefined pronoun in "He"]` from a pronoun / `<<person>>` widget that
has no target). That text is neither a `.error` node (so `bodyErrors` misses it)
nor `<<macro>>` syntax (so the `rawMacro` leak misses it), so it needs its own
detector.

Before importing the pack, the harness runs the same scenes once with **no pack
loaded** (the *control pass*) and keeps each scene's visible-error set as a
baseline. A scene fails only on a **pack-introduced** visible error — one that
did not appear in the control pass. Errors already present without the pack are
recorded as `preExistingVisibleErrors` and never fail a scene, so a
game/test-environment limitation (for example a pronoun widget with no target in
the disposable session) is not misreported as a localization defect. The report
keeps both lists (`visibleErrorsBaseline` per scene, then
`preExistingVisibleErrors` / `introducedVisibleErrors`), plus the
`visibleErrors` totals. `--no-baseline` skips the control pass; visible errors
are still recorded, they are just not classified (and so never fail a scene).

### Not covered (blocked) scenes

A scenario marked `"blocked": true` (with an optional `blockedReason`) cannot be
exercised without extra game state. It is never run and never counted as a pass:
the offline builder records it in `expectations.json` (`blocked`), and the report
lists it under `notCovered`.
