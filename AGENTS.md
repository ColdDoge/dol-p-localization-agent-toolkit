# Agent Notes

This repository is a localization engineering toolkit. Agents working here
should read `README.md` and `docs/TOOLKIT-OVERVIEW.md` first; the CLI, the JSON
schemas, and the examples are the actual contract.

## Ground rules

* **Never add translation content.** Do not commit game text, user
  translations, or any generated localization data. `translations/`,
  `production/`, `generated/`, `_work/`, and `*.mod.zip` are git-ignored on
  purpose.
* **Never reintroduce removed abilities.** There is no translation memory, no
  verified translation cache, no style / style-pack, no preferred-reference
  guidance, and no model translation pipeline. User-provided translations are
  local input only.
* **Keep the toolkit language-agnostic.** Runtime assertions compare expected
  target-language substrings against the rendered screen and forbidden source
  substrings against the source passage; they must not depend on Chinese or any
  other specific script.
* **Offline stays offline.** Inventory, audit, export, import, build, migrate,
  qa, and selftest must never probe ADB, Android CLI, Paisley Park, or a device.
  Only the explicit runtime validation entry points under `runtime/` may check
  those prerequisites.

## Working in this repo

1. Read the file you intend to change and its imports.
2. Keep the public interface small; prefer behavior-level changes over new
   parallel mechanisms.
3. Run `node core/src/selftest.mjs` and `node --test core/test` before finishing.
4. Run the `examples/` end-to-end flow if you touched export / import / build.

`docs/AGENT-WORKFLOW.md` describes the end-to-end workflow an agent should
follow when driving the toolkit for a user.
