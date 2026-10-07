# Example localization input

This folder is for your own localization data. The repository intentionally does
not ship any translation here.

Two input shapes are accepted:

1. A **localization source** (a quick, hand-edited file) — JSON array or
   `{ "entries": [...] }`, or JSONL, where each entry is:

   ```json
   { "passage": "Start", "from": "You wake in a narrow bed.", "to": "<your target text>" }
   ```

   Use it with: `node core/src/run.mjs audit --story examples/story/index.html --localization examples/localization/my-source.json`

2. A **localization state** (`state.jsonl`) produced by `kit import`, which the
   build reads directly.

Run `node examples/run-example.mjs` to see the whole flow with a synthetic
pseudo-language; it writes its generated files under `examples/_work/`
(git-ignored).
