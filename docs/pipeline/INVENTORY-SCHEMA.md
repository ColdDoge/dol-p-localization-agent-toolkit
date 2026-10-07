# Inventory Schema

`inventory` produces one JSON document (see `schemas/inventory.schema.json`).

## Unit model

```text
unitId            "<pid>:<startOffset>-<endOffset>"  (position identity)
sourceFile        bundled JS/CSS file, when the unit comes from one
passage           passage name
widget            widget passage name, or null
startOffset        offset within the passage content
endOffset          end offset within the passage content
absStart/absEnd    absolute offsets within index.html
rawText            the decoded passage slice
protectedText      rawText with non-text elements replaced by placeholders
placeholders       [{ placeholder, raw, kind, name }]
family             area classification (narrative / ui / widgets)
visibility         player-facing by default
riskLevel          L0..L2 (conditional depth / placeholder presence)
kind               passage_text | link_label | macro_label
sourceVersion      the recorded source version
```

Risk levels: `L0` plain text, `L1` contains a placeholder, `L2` nested in a
conditional. Classification uses a source-language heuristic to decide which
units are worth exporting; it never rewrites the story.
