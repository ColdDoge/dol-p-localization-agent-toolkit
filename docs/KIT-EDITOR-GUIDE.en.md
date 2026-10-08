# DoL / DoLP Kit Translation Editor — User Guide

[Repository home](../README.md) · [Download the HTML editor](../dolp-kit-translation-editor.html) · [中文指南](翻译编辑器使用指南.md)

The standalone `dolp-kit-translation-editor.html` is a **local, offline browser
editor** for translation Kits exported by this toolkit. It does not translate
text automatically, call an external API, or require Node.js or a web server.
It bundles the ZIP reader/writer and works best in Chrome or Edge.

## Getting started

1. Open [the HTML file](../dolp-kit-translation-editor.html) in the repository
   root. On GitHub, choose **Download raw file**, save it locally, then open it
   in your browser.
2. Drop a `localization-kit-001.zip` (or another regular, chunked, or repair
   Kit ZIP) into the page. **Do not unzip first.**
3. Translate each `protectedSource` entry in the corresponding large
   translation field. The `⟦0⟧` / `⟦1⟧` markers represent protected
   structure; they must not be translated, removed or reordered.
4. Choose **Export translated ZIP**, then hand the resulting
   `*-translated.zip` to the toolkit operator. JSONL-only export is also
   available. The original archive remains unchanged.

The editor preserves the Kit's identity fields and other files. When exporting
a ZIP it updates both `segments.jsonl` and `segments.csv` to avoid conflicting
translations.

## Editing controls

- Search source, translated text or passage; filter by all, untranslated,
  translated or placeholder warnings.
- Sort by **original order** (default) or **untranslated first**; this does
  not change the order of entries exported in the ZIP.
- Use 20/40/80-entry pages, scalable text, dark/light theme and Chinese/English UI.
- **Copy this source** inserts that entry's exact protected source into its
  translation field. **Copy all sources** does the same for the whole Kit;
  confirmations protect existing work.
- Source copying is a convenience for editing and test setups, **not a
  substitute for an actual translation**. The toolkit may reject unchanged
  text or any structurally invalid translation.

## Keyword glossary

Open the **Glossary** sidebar to add source→translated keyword pairs.
Click **Replace keywords** beside a translation to apply matching rules **only
to that one translation**, never automatically to the source or entire Kit.
English keywords are case-sensitive and matched as whole words.

Use **Export glossary JSON** for a portable backup, and **Import JSON (merge)**
to bring entries from another person. Deleting an entry or clearing the
glossary requires two confirmations.

The optional browser glossary is kept in **IndexedDB** separately from Kits,
and is **not** bundled in exported translation ZIPs. It is different from
the toolkit's `glossary.csv` of locked translation terms. Browser storage
can be unavailable or lost when site data is cleared, especially with local
`file://` access. Export the keyword JSON regularly.

## Handoff: import someone else's translations

First load the **base Kit ZIP**. Then choose **Import translated ZIP / JSONL**:

- **Fill blanks only (recommended):** imported strings populate empty fields.
  Your existing translations are kept; different imported values are
  reported as skipped conflicts.
- **Overwrite different translations:** imported values replace existing
  values after a separate confirmation.
- The handoff must contain **exactly the same complete set of `unitId`s**
  with matching protected source and immutable fields. A ZIP additionally
  checks the story SHA-256, inventory fingerprint, target language and schema.
  Different export timestamps (and informational version labels) are allowed.
- Incorrect identity, duplicate/missing entries or conflicting ZIP JSONL/CSV
  will cause the **entire handoff to be rejected** without a partial merge.

To combine **different Kit chunks**, ask the toolkit operator to import each
chunk into the same `state.jsonl`; the editor's handoff feature is intended
for people editing the **same** chunk.

## Drafts, privacy and limitations

Where the browser allows it, draft translations are saved to IndexedDB for
optional restoration when reopening the same Kit. **Always export ZIP and
glossary JSON backups**, especially before changing browsers or clearing data.

All processing happens locally in the browser; the page bundles JSZip and
does not upload your files. ZIP output is saved with **STORE** compression
so the toolkit's current importer can read it.

Prefer chunks of about **200–5,000 units**. For larger work, use the CLI's
`--chunk-size` export. Placeholder warnings in the page are a convenience,
not a comprehensive safety test.

## Final validation by the toolkit

Use the **same target story** that produced the Kit:

```bash
node core/src/run.mjs kit import <filled-kit.zip> --story <target-index.html> --out _work/state.jsonl --require-complete --report _work/import-report.json --repair-output _work/repair-kit.zip
node core/src/run.mjs qa --story <target-index.html> --state _work/state.jsonl --report _work/qa.json
node core/src/run.mjs build --story <target-index.html> --state _work/state.jsonl --output _work/pack.mod.zip --mode strict --report _work/build.json
```

A `strict build` will fail as expected when most of a full story remains
untranslated. `partial` is available for iteration and should never be
presented as a complete release. Fix rejected entries using the generated
repair Kit; do not weaken the toolkit's safety checks.

Never commit private game files, user translations or device data to this
public repository.
