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
origin             null | "code-string" (a string lifted out of a code region)
sourceVersion      the recorded source version
```

Risk levels: `L0` plain text, `L1` contains a placeholder, `L2` nested in a
conditional. Classification uses a source-language heuristic to decide which
units are worth exporting; it never rewrites the story.

## Export gates

* a unit is only produced when the text a translator sees (the protected text
  with placeholders blanked) contains natural-language words. A structure-only
  span is not a unit;
* one span is claimed by exactly one unit — two generators must never emit the
  same `unitId`, because the kit's jsonl/CSV merge would collapse the duplicate
  and lose an entry;
* `inventory --out` also writes an `issues` array: prose the export policy
  deliberately did not turn into a unit, grouped by `code` and host macro with a
  `count`. Reviewing it is how coverage gaps stay visible.
