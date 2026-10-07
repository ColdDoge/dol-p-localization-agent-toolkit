# Agent Workflow

How an agent should drive the toolkit for a user. The CLI, schemas, and
examples are the contract; this document is guidance, never a hidden dependency.

## Ground rules

* Never generate translations. Export text, let the user (or the user's chosen
  translator) fill it, then import.
* Never commit or ship the user's localization data.
* Offline commands must stay offline. Do not probe ADB / Android CLI / Paisley
  Park / a device unless the user explicitly asks for runtime validation.

## Standard loop

1. **Inventory** the target so you know the source version and unit count:

   ```bash
   node core/src/run.mjs inventory --story <index.html> --source-version <v> --out _work/inventory.json
   ```

2. **Audit** an existing localization (if the user has one) to find gaps:

   ```bash
   node core/src/run.mjs audit --story <index.html> --localization <user-source.json> --report _work/audit.json
   ```

   `missing` = needs a first translation, `changed` = the source moved on.

3. **Export** the text that needs work:

   ```bash
   node core/src/run.mjs kit export --story <index.html> --output _work/kit.zip --scope missing --state _work/state.jsonl
   ```

4. **Import** the filled kit. Import re-verifies every entry:

   ```bash
   node core/src/run.mjs kit import _work/kit-filled.zip --story <index.html> --out _work/state.jsonl --require-complete
   ```

5. **QA**, then **build**:

   ```bash
   node core/src/run.mjs qa    --story <index.html> --state _work/state.jsonl --report _work/qa.json
   node core/src/run.mjs build --story <index.html> --state _work/state.jsonl --output _work/pack.mod.zip --mode strict
   ```

   Only ship a pack when the strict build succeeds. A partial build is for
   iteration, and its report says so.

6. **Migrate** when the target version changes:

   ```bash
   node core/src/run.mjs migrate --story <new-index.html> --state _work/state.jsonl --out _work/state-next.jsonl
   ```

   Migration re-homes records whose source text and structure are identical on
   the new target; anything else is reported, not guessed.

7. **Runtime validation** only on explicit user request — see
   `RUNTIME-VALIDATION.md`.

## Reporting

Always surface the coverage counts (`translated-valid`, `untranslated`,
`rejected-structure`, `superseded`, `unresolved`, `obsolete`) and, for a failed
strict build, the per-unit reasons from the build report.
