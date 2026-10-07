# Protection Rules

Every imported translation is checked against the current target before it may
be built. The checks are pure functions over strings; nothing here calls a
model or a device.

## Three layers

1. **Placeholder integrity** — the `⟦n⟧` tokens in the protected source must
   survive with the same multiset and order. A translation may not add, drop,
   duplicate, reorder, or rewrite a placeholder.
2. **Reversible reconstruction** — restoring the placeholders from the
   translation must yield exactly the raw text the user supplied.
3. **V3 structural guard** — the conditional tree and per-branch token set must
   match. This catches a dropped/added/moved/swapped macro, variable, link
   target, or HTML tag, including moves across an `<<if>>` branch.

## Registered pronoun omissions

Some target languages legitimately drop pronoun macros the source spelled out.
An omission is accepted only for the omitted forms and never for
context-writing selectors (`personselect` / `person1..3` / …), whose state
writes must be preserved. The V3 guard is the backstop if an omission would
change behaviour.

## Stable codes

Findings carry stable codes, e.g. `PLACEHOLDER_MISMATCH`,
`PLACEHOLDER_ORDER_CHANGED`, `REVERSIBLE_MISMATCH`, `NO_OP`,
`EMPTY_TRANSLATION`, `V3_*`. A record whose verification fails is classified
`rejected-structure` and blocks a strict build.

## Pre-approvals

A localization source entry may pre-approve a specific finding with a written
reason (`allow: [{ code, reason }]`). Anything not explicitly allowed is a
build error.
