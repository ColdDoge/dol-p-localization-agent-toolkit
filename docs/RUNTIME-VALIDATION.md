# Runtime Validation

On-device validation is **optional** and **explicitly opt-in**. The offline
workflow (inventory / audit / export / import / build / migrate / qa / selftest)
never probes ADB, Android CLI, Paisley Park, or a device. Only the commands below
do, and only after you ask for them.

## Prerequisites (checked only when you run a runtime command)

| item | purpose | notes |
| --- | --- | --- |
| a device with the target app installed | the artifact under test | user-supplied |
| `adb` (Android SDK Platform-Tools) | device / socket / loopback forward | required |
| Google Android CLI | screenshot / annotate / layout | optional (inspect only) |
| Paisley Park | `scripts/android-inspect.cjs`, `scripts/adb-backup-app-data.py` | optional (screenshot / backup evidence), external, not vendored. Setup, skill install and the DoLP-specific limits are recorded in [Paisley-Park-3.0.2-接入与验收.md](Paisley-Park-3.0.2-接入与验收.md) |
| Node.js >= 22 | the harness | required |

Configure with `_local/android-config.local.json` (git-ignored) or environment
variables. There is no built-in package id or tool path:

```jsonc
{
  "serial": "<device serial>",            // TOOLKIT_DEVICE_SERIAL
  "package": "<target package id>",        // TOOLKIT_PACKAGE
  "devToolsPath": "<path to Paisley Park>", // TOOLKIT_DEV_TOOLS
  "cdpPort": 50806,
  "androidCli": "android"
}
```

## Order of operations

```text
offline: build the smoke subset + expectations
   node runtime/localization_smoke_build.mjs --story <index.html> --state <state.jsonl> [--scenarios <file>]
   (or --package <user.mod.zip>)

device:  doctor (read-only) -> smoke -> regression -> exhaustive
   node runtime/android/doctor.mjs
   node runtime/android/test-localization-runtime.mjs --level smoke
   node runtime/android/test-localization-runtime.mjs --level exhaustive [--inspect]
```

`test-localization-runtime.mjs` rebuilds the smoke subset itself when you pass
`--story` plus `--state`/`--package`; otherwise it uses the existing
`_work/localization-smoke/expectations.json`.

## Safety

The harness only imports/removes the smoke subset through the ModLoader's own
API and reloads the WebView. It never uninstalls the app, clears app data, taps
coordinates, calls a save-writing API, or changes user saves. Every run ends by
removing the pack and verifying the ModLoader list and `.error` count are
restored.

## Permission

Any ADB / device operation needs your explicit go-ahead for that run. Reading
these docs, running the offline builder, or running the offline tests is not
permission to touch a device.
