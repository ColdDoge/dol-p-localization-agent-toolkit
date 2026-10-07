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

## Evidence flags

| flag | effect |
| --- | --- |
| `--backup` / `--no-backup` | run Paisley Park's app-data backup first (default: on) |
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
