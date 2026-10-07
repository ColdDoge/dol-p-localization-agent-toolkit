# Options

Flags accepted by the CLI, grouped by command.

## Global

* `--story <index.html>` — the compiled target story. Required by every command
  except `selftest`.
* `--source-version <v>` — informational source version recorded in reports and
  the kit manifest. Optional.

## inventory

* `--out <file>` — write the inventory JSON; otherwise it is printed.

## audit

* `--state <state.jsonl>` **or** `--localization <src.json>` — the localization
  to audit. Neither means "audit against an empty state" (everything is
  `untranslated`).
* `--report <file>` — write the audit report.

## kit export

* `--output <kit.zip>` — required.
* `--scope all|untranslated|missing|changed` — default `all`.
* `--state` / `--localization` — the current localization, used by the
  non-`all` scopes.
* `--glossary <glossary.csv>` — optional locked terms (columns `from,to,note`).
* `--limit <n>` — cap the exported segment count.
* `--target-language <tag>` — informational target-language tag.

## kit import

* positional `<kit.zip>`.
* `--out <state.jsonl>` — where to merge accepted records.
* `--require-complete` — fail if any entry is deferred or rejected.
* `--report <file>`.

## build

* `--state <state.jsonl>` — required.
* `--output <pack.mod.zip>` — required (unless a strict build fails).
* `--mode strict|partial` — default `strict`.
* `--name` / `--pack-version` — pack identity.
* `--report <file>`.

## qa

* `--state` / `--localization`, `--report`.

## migrate

* `--state <old.jsonl>`, `--out <new.jsonl>`, `--report`.

## cache

* `cache export --output <structure-cache.zip>`, `cache import <zip> --report`.

## Localization data and the glossary

The glossary is an optional, user-provided locked-term list. It is never
auto-generated, never stored as a translation memory, and the full workflow
works without one.
