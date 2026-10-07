# Rule Catalog

The protection rules are implemented directly in code, not loaded from a
catalog. This document is the human-readable index of what the structural layers
consider a protected token.

## Placeholders

Every non-text element of a payload run becomes `⟦n⟧`:

* SugarCube macros `<<...>>` (including widget calls and their arguments);
* variables `$x` and temporary `_x` references inside those macros;
* HTML tags and entities;
* wiki-link targets `[[label|Target]]` (the target is an identifier).

## V3 token classes

`protection-v3.mjs` derives a per-branch token set: `macro:<name>`,
`pronoun:<name>` (context-writing selectors), `var:<name>`, `link:<target>`,
`html:<tag>`. `compareStructures` reports stable codes when a branch adds,
removes, moves, or swaps a token, and when a macro substitution is not
equivalent by signature (`context-semantics.mjs`).

## Codes

`PLACEHOLDER_COUNT_CHANGED`, `PLACEHOLDER_MISMATCH`,
`PLACEHOLDER_ORDER_CHANGED`, `PLACEHOLDER_DUPLICATED`, `PLACEHOLDER_ADDED`,
`REVERSIBLE_MISMATCH`, `EMPTY_TRANSLATION`, `NO_OP`, and the `V3_*` family.
