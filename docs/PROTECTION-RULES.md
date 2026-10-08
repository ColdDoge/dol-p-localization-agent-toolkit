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

Only `SOFT_MACROS` (pronouns and pure output macros) can be registered as an
omission. A structural macro (`<<if>>`, `<<set>>`, or a macro name the target
no longer parses) is never read as an omitted pronoun.

## Shared structural-token grammar

The inventory (producer) and the guards (consumer) must agree on what a
protected token *is*, otherwise a legal translation is reported as a change and
a real change slips through. `core/src/lib/structure-tokens.mjs` is the single
source of that grammar:

* **Identifier boundaries are Unicode-aware.** `foo_bar`, `real_year` and
  `npc_moan_idle` are single identifiers in the source *and* after
  translation, so `foo_bar → 漢_bar` is not "a new `_bar` variable". A variable
  is only a variable where a variable can start, whatever script precedes it.
  This is why the guard's answer no longer depends on the target language.
* **Macros, HTML tags and string literals are scanned with a quote-aware state
  machine** instead of a `[\s\S]*?` regex: a `>>` inside a string no longer
  truncates a macro, a `>` inside an attribute value no longer truncates a tag,
  and an apostrophe inside prose (`[[Say that you're busy|Target]]`) is not
  mistaken for a string delimiter.
* **URLs and structural labels are recognised structurally** (`isUrlLike`,
  `isStructuralLabel`), not by keyword lists.

## What the inventory exports

The export policy lives in `core/src/lib/inventory.mjs` and is the reason the
guard rarely has to fire:

* markup runs become `passage_text` units, with macros / variables / HTML /
  entities / link targets turned into `⟦n⟧` placeholders;
* `<<script>> … <</script>>` bodies are never exported as a whole — they are
  code. Player-facing strings inside them are lifted out individually;
* inside code regions (`<<set>>`, `<<run>>`, `<<script>>`, …) a string literal
  becomes its own unit only when it is a value of a display key
  (`sentence`, `start`, `end`, `name`, `label`, …) or when it carries embedded
  markup (`<span …>`, `<<pronoun>>`) and reads as prose;
* link labels and macro labels are exported only when they are prose: URLs,
  link targets, `$var` / `_var.path` arguments and other identifier-shaped
  labels stay out;
* a unit must carry text a translator can act on. Structure-only strings
  (`<span class='ui-icon'></span>`) are not units, so they cannot become
  `NO_OP` blockers.

Anything prose-like that the policy deliberately does not export is recorded as
a **pending issue** in the inventory (`inventory --out …` → `issues`), grouped
by code / host macro with a count. The gap is reviewable and never silent.

## Stable codes

Findings carry stable codes, e.g. `PLACEHOLDER_MISMATCH`,
`PLACEHOLDER_ORDER_CHANGED`, `REVERSIBLE_MISMATCH`, `NO_OP`,
`EMPTY_TRANSLATION`, `V3_*`. A record whose verification fails is classified
`rejected-structure` and blocks a strict build.

## Pre-approvals

A localization source entry may pre-approve a specific finding with a written
reason (`allow: [{ code, reason }]`). Anything not explicitly allowed is a
build error.
