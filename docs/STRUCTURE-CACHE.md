# Structure Cache

The structure cache is a transparent accelerator. It is never a user-facing
mode and never stores a translation.

## What it holds

Machine-derived facts only:

* target story identity (`sha256`, bytes, passage count, `ifid`, format);
* canonical inventory fingerprint (unit count, kind/risk histogram,
  irreversible-passage count);
* provenance map and rule-catalog fingerprint (when present);
* the producing tool's identity.

## Reuse rule

Reuse requires an identical target story `sha256`. A mismatch makes the cache
unusable and the target is re-parsed. A hit skips parse / align time only.

## Wire format

Store-only zip (`core/src/lib/zip.mjs`):

```text
manifest.json     identity + compatibility contract
structure.json    structure payload
README.md         human-readable summary
```

There is no `verified-translations.jsonl` and no translation layer: this
toolkit does not keep a translation memory or a verified-translation cache.

## Commands

```bash
node core/src/run.mjs cache export --story <index.html> --output _work/structure-cache.zip --source-version <v>
node core/src/run.mjs cache import _work/structure-cache.zip --story <index.html> --report _work/cache.json
```
