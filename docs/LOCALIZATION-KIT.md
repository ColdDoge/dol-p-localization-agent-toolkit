# Localization Kit

`localization-kit.zip` is a self-contained hand-off: the protected source, its
placeholders, an optional glossary, and the run identity, so a translator can
fill `translation` and hand the zip back.

## Contents

```text
manifest.json         identity + compatibility contract
README.md             user-facing instructions
TRANSLATION-RULES.md  rule sheet
segments.jsonl        canonical machine format (one unit per line)
segments.csv          convenience format for humans / spreadsheets
glossary.csv          optional locked terms (user-provided)
```

## Segment fields

`unitId`, `passage`, `kind`, `family`, `riskLevel`, `protectedSource`,
`rawSourceHash`, `protectedHash`, `sourceFingerprint`,
`structuralFingerprint`, `placeholders[]`, `contextBefore`, `contextAfter`,
`translation` (empty, for the translator).

## Export scopes

* `all` — every translatable unit.
* `untranslated` / `missing` — units with no valid translation yet.
* `changed` — units whose source text changed (`superseded`).

## Import gates

Import never trusts the package. Per entry, in order: manifest schema + kind;
target story `sha256`; identity and declared hashes; placeholder integrity;
reversible restore; V3 structural guard; no-op check. JSONL is canonical; the
CSV value is used only when the JSONL value is empty, and a genuine conflict is
rejected rather than guessed. An empty translation is recorded as `deferred`
(a hard failure under `--require-complete`).

Accepted entries are written to the localization state (`state.jsonl`), which
the build reads. Import does not call a model and does not write a translation
cache.
