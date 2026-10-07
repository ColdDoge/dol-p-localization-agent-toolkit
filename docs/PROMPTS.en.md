# Ready-to-send Agent Prompts

[中文提示词](PROMPTS.zh-CN.md) · [English README](../README.en.md) · [中文 README](../README.zh-CN.md)

These presets mirror the five public toolkit workflows. Each section has a
stable anchor so the repository landing page can link directly to the right
prompt.

Copy the **entire prompt block** for your task and send it to a coding agent.
The prompts are intentionally safe to use from an empty folder.

<a id="new-localization"></a>
## Start a localization from scratch

Use this when you have a target game build but no existing localization state.

```text
You are helping me start a new localization with the public toolkit:
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

Work safely and treat the public repository as the contract.

1. If the current directory does not already contain the toolkit:
   - if it is empty, clone the repository here;
   - if it contains unrelated files, create a dedicated subfolder and clone there;
   - never overwrite unrelated user files.
   If the toolkit is already present, fetch and fast-forward only. Do not rewrite
   local history or discard local changes.
   Git boundary: by default, Git write/sync operations are allowed only for
   this toolkit repository. Any game source, Mod project, third-party
   repository, or other user project I provide is read-only unless I
   explicitly ask you to modify that repository. Do not run git add, commit,
   push, change remotes, switch or rewrite branches/history, rebase, reset, or
   otherwise alter Git state in those repositories.

2. Read README.md, AGENTS.md, docs/TOOLKIT-OVERVIEW.md,
   docs/AGENT-WORKFLOW.md, and docs/LOCALIZATION-KIT.md before operating.

3. Run the offline self-test first:
   node core/src/selftest.mjs

4. Resolve the real target story. In this toolkit, "target story" means the
   target build's compiled `assets/www/index.html`; it is not a separate
   narrative file.
   - If I supplied an extracted game directory, use its
     `assets/www/index.html`.
   - If I supplied only an APK, use an ordinary archive tool to extract only
     `assets/www/index.html` into `_work/` and use that copy. Do not modify
     or rebuild the APK just to prepare this input.
   - Do not use the repository's `examples/story/index.html` for a real game;
     it is synthetic test data only.
   - If I supplied neither an APK, an extracted game directory, nor the real
     `index.html`, ask me for one of those inputs and do not guess.

5. Keep user data and generated work out of Git history. Prefer external input
   paths or the git-ignored _local/ and _work/ directories.

6. Inventory the target and export the complete localization kit with scope=all.
   If I supplied a glossary, include it. If I did not, continue without one.
   Do not generate, rewrite, or invent translations.
   For a large target (tens of thousands of segments), export it in one shot with
   --chunk-size <n> --output-dir <dir> so I get several independent kits plus an
   index.json, instead of an export-a-batch / upload / export-the-next loop.

7. If I have NOT supplied a filled localization kit, stop at the safe hand-off
   point and report:
   - target story identity/version information that was detected;
   - inventory/unit counts;
   - the exported kit path;
   - what file I need to fill and return.

8. If I HAVE already supplied a filled kit, import it, run QA, and attempt a
   strict build. Never silently fall back to a partial build. If strict fails,
   report the coverage counts and per-unit blockers instead.

9. Report final paths and coverage states clearly:
   translated-valid, untranslated, rejected-structure, superseded, unresolved,
   obsolete.

Do not push, publish, create a release, or commit my localization data.
```

<a id="audit-existing"></a>
## Audit or continue an existing localization

Use this when you already have localization data and want to know what is
missing, stale, structurally invalid, or still usable.

```text
You are helping me audit or continue an existing localization with:
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

1. If the current directory does not already contain the toolkit, clone it into
   an empty/dedicated folder. If it already exists, fetch and fast-forward only.
   Never overwrite unrelated files or discard local changes.
   Git boundary: by default, Git write/sync operations are allowed only for
   this toolkit repository. Any game source, Mod project, third-party
   repository, or other user project I provide is read-only unless I
   explicitly ask you to modify that repository. Do not run git add, commit,
   push, change remotes, switch or rewrite branches/history, rebase, reset, or
   otherwise alter Git state in those repositories.

2. Read README.md, AGENTS.md, docs/TOOLKIT-OVERVIEW.md,
   docs/AGENT-WORKFLOW.md, docs/OPTIONS.md, and docs/LOCALIZATION-KIT.md.
   Run node core/src/selftest.mjs before using my data.

3. Identify the current target story and the existing localization input.
   "Target story" means the real target build's compiled
   `assets/www/index.html`. If I supplied an APK instead of an extracted game
   directory, extract only that file into `_work/` with a normal archive tool;
   do not substitute `examples/story/index.html`, which is synthetic test data.

   Supported audit inputs are the public formats documented by the toolkit,
   especially state.jsonl or localization source JSON/JSONL / ModI18N TypeB
   fragment. If I only supplied a built .mod.zip or another unsupported format,
   do not invent a converter or silently reverse-engineer it. Tell me exactly
   what supported source/state file is needed.

4. Keep my files out of Git history and use _work/ / _local/ for generated or
   local-only artifacts.

5. Run the audit against the current target. Report at least:
   translated-valid, untranslated, rejected-structure, superseded, unresolved,
   obsolete, plus whether strict would pass.

6. Export separate work kits for items that still need attention:
   - scope=missing for untranslated units;
   - scope=changed for superseded units.
   Do not generate translations yourself.
   On a large target you may export the whole scope in one shot with
   --chunk-size <n> --output-dir <dir> rather than one oversized kit.

7. If there are structural rejections or unresolved planner items, report their
   concrete reasons instead of hiding them behind a total count.

8. If I also supplied a filled returned kit, import it, re-run QA, and attempt
   a strict build. Do not substitute a partial build unless I explicitly ask
   for an iteration build.

9. Finish with a compact status report: what is reusable, what still needs
   translation, what is blocked, and the paths to the exported reports/kits.

Do not push, publish, or commit my localization data.
```

<a id="version-migration"></a>
## Migrate to a new game version

Use this when the target game updated and you have an older toolkit
`state.jsonl` that should be carried forward safely.

```text
You are helping me migrate an existing localization to a newer target version
with https://github.com/ColdDoge/dol-p-localization-agent-toolkit

1. Start from a clean/dedicated folder. Clone the toolkit if needed; otherwise
   fetch and fast-forward only. Never delete or overwrite unrelated files.
   Git boundary: by default, Git write/sync operations are allowed only for
   this toolkit repository. Any game source, Mod project, third-party
   repository, or other user project I provide is read-only unless I
   explicitly ask you to modify that repository. Do not run git add, commit,
   push, change remotes, switch or rewrite branches/history, rebase, reset, or
   otherwise alter Git state in those repositories.

2. Read README.md, AGENTS.md, docs/VERSION-MIGRATION.md,
   docs/AGENT-WORKFLOW.md, and docs/OPTIONS.md. Run the offline self-test first.

3. I need to provide:
   - the NEW target build, either as the real compiled
     `assets/www/index.html`, an extracted game directory containing it, or an
     APK from which that file can be extracted into `_work/`;
   - the OLD localization state.jsonl produced by this toolkit.
   The target story is specifically that compiled `index.html`, not the
   repository's synthetic example. If either required input is missing, ask for
   it and stop. Do not fabricate a state file from unsupported inputs.

4. Keep all user inputs and migration outputs out of Git history.

5. Inventory the new target, then run migrate from the old state into a new
   state file. Migration may only re-home records when the toolkit's identity
   rules say it is safe; do not fuzzy-match or guess translations.

6. Audit the migrated state against the new target.

7. Export:
   - a missing kit for untranslated units;
   - a changed kit for superseded units.
   Do not generate translations.

8. Run QA. Attempt a strict build only if the migrated state has no blocking
   coverage states. Never silently ship a partial build.

9. Report migration counts (kept/moved/obsolete and any changed items), final
   coverage counts, exported kit paths, and whether strict build is currently
   possible.

Do not push, publish, or commit my localization data.
```

<a id="build-and-qa"></a>
## Build and QA an existing localization

Use this when translation work is already in a toolkit state/filled kit and you
mainly want validation and a build result.

```text
You are helping me QA and build localization data with:
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

1. Clone the toolkit into an empty/dedicated folder if it is not already here.
   If it already exists, fetch and fast-forward only. Preserve all unrelated
   files and local changes.
   Git boundary: by default, Git write/sync operations are allowed only for
   this toolkit repository. Any game source, Mod project, third-party
   repository, or other user project I provide is read-only unless I
   explicitly ask you to modify that repository. Do not run git add, commit,
   push, change remotes, switch or rewrite branches/history, rebase, reset, or
   otherwise alter Git state in those repositories.

2. Read README.md, AGENTS.md, docs/TOOLKIT-OVERVIEW.md,
   docs/PROTECTION-RULES.md, and docs/OPTIONS.md. Run:
   node core/src/selftest.mjs

3. Identify the real target story and my localization state.jsonl.
   The target story means the target build's compiled
   `assets/www/index.html`. If I supplied an APK, extract only that file into
   `_work/` with an ordinary archive tool. Never use
   `examples/story/index.html` for a real build. If I supplied a filled
   localization kit instead of a state file, import it first using the
   documented kit workflow. If required input is still missing, ask me instead
   of guessing.

4. Keep all user data and generated packs/reports out of Git history.

5. Run QA and write a report. Surface structural-protection findings and
   planner/replay problems explicitly.
   When a kit import reports rejected / deferred / conflict entries, scan the
   ENTIRE kit (never stop at the first failure), pass --repair-output to collect
   only those units into a small repair kit, and report the problem counts and
   the repair-kit path. Do not ask me to redo the whole original kit.

6. Attempt a strict build.
   - If strict succeeds, report the pack path, entry count, coverage, and QA
     result.
   - If strict fails, do not create or present a partial pack as a release.
     Report the blocking states and concrete reasons.

7. Only make a partial build if I explicitly request one for iteration/testing;
   if you do, label it clearly as PARTIAL.

8. Do not weaken placeholder, reversible, V3 structural, duplicate/overlap, or
   replay checks just to make a build pass.

Do not push, publish, create a release, or commit my localization data.
```

<a id="runtime-validation"></a>
## Run optional on-device validation

Use this only when you intentionally want the Android runtime harness to touch
a connected device.

```text
You are helping me run the optional Android runtime validation in:
https://github.com/ColdDoge/dol-p-localization-agent-toolkit

Sending this prompt is explicit permission for the documented runtime-validation
steps below on the device I provide. It is NOT permission to uninstall the app,
clear app data, erase saves, factory-reset anything, or perform unrelated
device changes.

1. Clone/sync the toolkit safely. Read README.md, AGENTS.md,
   docs/RUNTIME-VALIDATION.md, docs/RUNTIME-SMOKE-V1.md, and
   docs/RUNTIME-QA-MODES.md before touching a device.
   Git boundary: by default, Git write/sync operations are allowed only for
   this toolkit repository. Any game source, Mod project, third-party
   repository, or other user project I provide is read-only unless I
   explicitly ask you to modify that repository. Do not run git add, commit,
   push, change remotes, switch or rewrite branches/history, rebase, reset, or
   otherwise alter Git state in those repositories.

2. Run the offline self-test and runtime unit tests first:
   node core/src/selftest.mjs
   node --test runtime/android/test/*.test.mjs

3. A real smoke run requires:
   - the real target story, meaning the target build's compiled
     `assets/www/index.html` (extract only that file from an APK into
     `_work/` if needed);
   - a toolkit state.jsonl OR a user-provided localization package;
   - the target package id and an ADB-visible device.
   Ask me for anything missing. The synthetic repository fixture is offline-only
   and must not be substituted for a real target.

4. Put package id, device serial, and local tool paths only in the documented
   git-ignored _local/android-config.local.json or environment variables.
   Never commit them. Do not print an unmasked device serial in the final report.

5. Run doctor first. Treat adb as required for a device run; Android CLI and
   Paisley Park are optional unless the chosen inspection/evidence step needs
   them.

6. Build the smoke subset only from my user localization state/package, then
   run level=smoke. Do not escalate to regression/exhaustive unless I explicitly
   request it.

7. For tier-A scenes, keep the language-agnostic verdict contract intact:
   expectTargetAny must hit and forbidSourceAny must remain absent.
   Script ratios / word counts / pronounCount are diagnostics only and must not
   be turned into PASS/FAIL gates.

8. Verify cleanup at the end: the temporary smoke pack is removed, ModLoader
   state/error count is restored, and no save-writing or destructive action was
   used.

9. Report doctor results, smoke result, assertion failures if any, cleanup
   result, report paths, and any toolkit bug discovered.

Do not weaken assertions to obtain a PASS. Do not push device data, publish, or
create a release.
```
