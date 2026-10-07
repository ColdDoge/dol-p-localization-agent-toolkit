# Version Migration

When the target game updates, source text and structure can change. Migration
moves an existing localization state onto the new target **without guessing**.

## Command

```bash
node core/src/run.mjs migrate --story <new-index.html> --state <old-state.jsonl> --out <new-state.jsonl> [--report <report.json>]
```

## Rules

* A record whose `unitId` still exists on the new target is kept as-is.
* A record whose source text **and** structure are identical on the new target
  (same source fingerprint and structural key) is re-homed to the new `unitId`.
  This is not translation reuse — it is the same record moving position — and it
  is only ever done by an explicit `migrate` run.
* A record whose text changed is reported (it will classify as `superseded` when
  the new state is audited).
* A record with no counterpart is reported as `obsolete` and dropped from the
  new state.

Migration never fills a missing unit from another project and never maintains a
translation memory.

## After migrating

Run `audit` on the new state, then `kit export --scope missing` / `--scope
changed` for whatever still needs attention, then a strict `build`.
