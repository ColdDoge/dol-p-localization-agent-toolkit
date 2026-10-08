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
  markup (`<span …>`, `<<pronoun>>`) and reads as prose, or when it is a
  full sentence / capitalised phrase that is *not* used as a lookup key;
* a map assigned to a display-named target (`<<set setup.endingReasonText = { … }>>`,
  `setup.incidentDescs`, `setup.actorName`) exports its prose values even though its
  own keys cannot be allowlisted — the target name is the durable signal;
* a literal that merely *starts* with code (`$…`, `_…`, `.#`, a quote, `Math.…`,
  `hue-rotate(30deg) …`) is not prose, while the same characters inside a
  sentence are placeholders ("The _creatureType slowly approaches …" is a unit);
* labels with a parenthetical ("Compact (24-Hour)", "Beech Street (Shopping
  centre)", "Try to talk to them (0:20)") stay translation units, but a
  parenthesised expression does not;
* link markup inside a macro body (`<<link [[Label|Target]]>>`,
  `<<button [[…]]>>`, `<<fadetext [[…]]>>`) yields a `link_label` unit for the
  label; the target stays inside the protected macro. A label that doubles as
  its own target is never exported;
* link labels and macro labels are exported only when they are prose: URLs,
  link targets, `$var` / `_var.path` arguments and other identifier-shaped
  labels stay out;
* a unit must carry text a translator can act on. Structure-only strings
  (`<span class='ui-icon'></span>`) are not units, so they cannot become
  `NO_OP` blockers.

Anything prose-like that the policy deliberately does not export is recorded as
a **pending issue** in the inventory (`inventory --out …` → `issues`), grouped
by code / host macro with a count. The gap is reviewable and never silent.

### Short text

The word-length heuristic that used to gate the export dropped legitimate short
text ("Go", "No", "Yes", "Buy", "Opt.", "fur", "You "). What keeps code out of
the kit is the element model, the enclosing-context rules and the
residual-structure check — not word length — so the gate now only asks for a
Latin word of at least two letters. Labels are additionally allowed any prose
shape that is not a URL or an identifier.

### Identifier space

`core/src/lib/identifier-space.mjs` collects every string the code uses as a
key (data-table fields such as `type` / `variable` / `name_lower` / `colour`,
`case` labels, membership calls such as `.includes("…")`, equality operands,
identifier-taking macro arguments, link targets and passage names). A data
literal and a bare macro argument are not exported when their value is in that
space (case-insensitively), because translating the display copy while the
lookup copy stays put would break the lookup. Such hits are reported as
`code-string-is-identifier`.

## Enclosing-context safety

A unit's span sits inside syntax, and what is harmless in one place destroys
another. Each unit therefore records its enclosing `context`
(`js-double`, `js-single`, `js-template`, `arg-double`, `arg-single`, `link`),
and the import applies the mechanism that context can absorb:

* **JavaScript string literals are escaped.** `"`, `\`, a raw newline, a
  backtick and `${` in a translation are escaped before the text is spliced
  back, so a translator may use ordinary ASCII punctuation and the generated
  source stays valid. The escaped form is what the state stores, so a build
  re-verifies exactly what the pack contains. `\` is doubled, `${` becomes
  `\${` (identity escape) and newlines become `\n` in `"…"` / `'…'` literals.
* **Macro arguments and link labels have no escape syntax we can rely on**, so
  introducing their delimiter is refused with a stable code
  (`MACRO_ARG_DELIMITER_INSERTED`, `LINK_LABEL_DELIMITER_INSERTED`) instead of
  producing broken markup. Full-width quotes and brackets are always free —
  nothing bans ordinary Chinese punctuation.
* Free passage text has no delimiter, but an unpaired backtick would open a
  SugarCube template, so `TEXT_BACKTICK_UNBALANCED` rejects that case.

Escaped template holes are literal text: `${ … }` written as `\${ … }` does not
count as a structure change.

## Stable codes

Findings carry stable codes, e.g. `PLACEHOLDER_MISMATCH`,
`PLACEHOLDER_ORDER_CHANGED`, `REVERSIBLE_MISMATCH`, `NO_OP`,
`EMPTY_TRANSLATION`, `V3_*`. A record whose verification fails is classified
`rejected-structure` and blocks a strict build.

## Pre-approvals

A localization source entry may pre-approve a specific finding with a written
reason (`allow: [{ code, reason }]`). Anything not explicitly allowed is a
build error.
