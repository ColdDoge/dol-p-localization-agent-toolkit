# Rule Catalog

The protection rules are implemented directly in code, not loaded from a
catalog. This document is the human-readable index of what the structural layers
consider a protected token.

## Placeholders

Every non-text element of a payload run becomes `⟦n⟧`:

* SugarCube macros `<<...>>` (including widget calls and their arguments);
* variables `$x` and temporary `_x` references, recognised with a Unicode
  identifier boundary so `foo_bar` is one identifier, never `foo` + `_bar`;
* HTML tags and entities;
* escape sequences (`\"`) inside an extracted code string;
* wiki-link targets `[[label|Target]]` (the target is an identifier).

## What is not exported

`inventory.mjs` decides what may leave the story as translatable text:

| region | policy |
| --- | --- |
| markup runs | exported; non-text elements become placeholders |
| `<<script>> … <</script>>` | never exported as text |
| `<<set>>` / `<<run>>` / `<<capture>>` / `<<init>>` bodies | only display-keyed values and prose strings carrying embedded markup |
| `<<print>>` / `<<=>>` / `<<->>` bodies | every prose literal (the argument is shown) |
| other macro bodies | only prose literals carrying embedded markup |
| link labels / macro labels | only prose; URLs, targets and identifier-shaped arguments are excluded |

Every prose literal the policy skips is recorded as a pending issue
(`code-string-unparsed`, `unexported-code-string`, `duplicate-unit-span`, …) so
the decision is visible instead of silent.

## V3 token classes

`protection-v3.mjs` derives a per-branch token set: `macro:<name>`,
`pronoun:<name>` (context-writing selectors), `var:<name>`, `link:<target>`,
`html:<tag>`. `compareStructures` reports stable codes when a branch adds,
removes, moves, or swaps a token, and when a macro substitution is not
equivalent by signature (`context-semantics.mjs`). Macro balance is compared
between the source and the translation rather than against zero, because a unit
may legitimately be a fragment of a surrounding conditional; any asymmetry in
depth or in the lowest point still blocks.

## Codes

`PLACEHOLDER_COUNT_CHANGED`, `PLACEHOLDER_MISMATCH`,
`PLACEHOLDER_ORDER_CHANGED`, `PLACEHOLDER_DUPLICATED`, `PLACEHOLDER_ADDED`,
`REVERSIBLE_MISMATCH`, `EMPTY_TRANSLATION`, `NO_OP`, and the `V3_*` family.
