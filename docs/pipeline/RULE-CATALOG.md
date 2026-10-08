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
| `<<script>> … <</script>>` | never exported as text (the closing marker may appear inside a script string) |
| `<<set>>` / `<<run>>` / `<<capture>>` / `<<init>>` bodies | display-keyed values; prose strings carrying embedded markup; and full sentences / capitalised phrases that are not lookup keys |
| `<<print>>` / `<<=>>` / `<<->>` bodies | every prose literal (the argument is shown) |
| other macro bodies | prose literals carrying embedded markup, or display-shaped arguments on macros that are neither decisions nor name-taking |
| `<<link [[Label\|Target]]>>` and friends | the label becomes a `link_label` unit; the target stays protected |
| link labels / macro labels | only prose; URLs, targets and identifier-shaped arguments are excluded |

Every prose literal the policy skips is recorded as a pending issue
(`code-string-unparsed`, `code-string-is-identifier`,
`unexported-code-string`, `duplicate-unit-span`, …) so the decision is visible
instead of silent. Strings the code uses as keys are tracked in
`identifier-space.mjs` and are never exported as data literals.

## Enclosing contexts and their remedies

| context | remedy for a dangerous character |
| --- | --- |
| `js-double` / `js-single` / `js-template` | escaped (`\"`, `\\`, `\n`, `\``, `\${`) — the translation may use ordinary punctuation |
| `arg-double` / `arg-single` | refused (`MACRO_ARG_DELIMITER_INSERTED`) |
| `link` | refused (`LINK_LABEL_DELIMITER_INSERTED` for `|`, `]]`, `->`, `<-`, `][`, `` ` ``) |
| free text | refused only for unpaired backticks (`TEXT_BACKTICK_UNBALANCED`) |

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
