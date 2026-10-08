/*
 * The story's identifier space.
 *
 * Some strings are display text in one place and a lookup key in another:
 * DoL stores an item's `name` in a data table (and shows it), then finds the
 * item again with `<<wearProp "…">>`, `$known.includes("…")`, `case "…"`,
 * `type: "…"`, a passage name, or a link target. Translating the display copy
 * while the lookup copy stays put silently breaks the lookup.
 *
 * This module collects every string the *code* uses as a key, so the inventory
 * can refuse to export a data literal whose exact value is one of them. It is
 * a read-only pass over the decoded story; it never rewrites anything.
 */

import { extractLinkTargets } from './protection.mjs';

/** Object keys whose string values are keys/ids rather than prose. */
const DATA_KEYS = new Set([
  'type', 'variable', 'key', 'name_lower', 'startpassage', 'endpassage',
  'passage', 'passages', 'id', 'tag', 'tags', 'short', 'colour', 'color',
  'style', 'class', 'icon', 'pattern',
]);

/** Calls whose string argument is compared or matched, not displayed. */
const KEY_CALLS = ['includes', 'startswith', 'endswith', 'indexof', 'lastindexof',
  'has', 'get', 'delete', 'push', 'unshift', 'remove', 'add'];

/** Macros whose first quoted argument names something. */
const IDENT_MACROS = ['goto', 'display', 'include', 'widget', 'npc', 'npcappend',
  'npcselect', 'npcincr', 'wearprop', 'earnfeat', 'pass', 'image', 'audio',
  'addinlineevent', 'add_link', 'storeon', 'unset'];

const keyValueRe = /(?<![A-Za-z0-9_$])["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*("[^"\n]*"|'[^'\n]*'|\[[^\]\n]*\])/g;
const callRe = new RegExp(`\\.(?:${KEY_CALLS.join('|')})\\s*\\(\\s*("[^"\\n]*"|'[^'\\n]*')`, 'gi');
const caseRe = /\bcase\s+("[^"\n]*"|'[^'\n]*')/g;
const macroArgRe = new RegExp(`<<\\s*(?:${IDENT_MACROS.join('|')})\\s+("[^"\\n]*"|'[^'\\n]*')`, 'gi');
/** TwineScript / JS equality operands: the value must match stored data. */
const compareRe = /(?:^|[\s(!,])(?:is|isnot|eq|neq|==|===|!=|!==)\s*("[^"\n]*"|'[^'\n]*')/g;

const unquote = (raw) => String(raw).slice(1, -1);
const clean = (s) => String(s == null ? '' : s).trim();

/**
 * Every string the code treats as a key. `story` is the parsed story from
 * `parseStory` (decoded passage content).
 */
export function collectIdentifierSpace(story) {
  const out = new Set();
  const add = (value) => {
    const t = clean(value);
    // Keys are compared case-insensitively on purpose: a display name
    // ("Red Potion") and its lookup key ("red potion") must not diverge.
    if (t.length >= 2 && t.length <= 160) out.add(t.toLowerCase());
  };

  for (const p of story.passages) add(p.name);

  for (const p of story.passages) {
    const c = p.content;
    for (const target of extractLinkTargets(c)) add(target);

    keyValueRe.lastIndex = 0;
    let m;
    while ((m = keyValueRe.exec(c)) !== null) {
      if (!DATA_KEYS.has(m[1].toLowerCase())) continue;
      const raw = m[2];
      if (raw.startsWith('[')) {
        for (const item of raw.slice(1, -1).split(',')) {
          const t = clean(item);
          if (t.startsWith('"') || t.startsWith("'")) add(unquote(t));
        }
      } else {
        add(unquote(raw));
      }
    }

    for (const re of [callRe, caseRe, macroArgRe, compareRe]) {
      re.lastIndex = 0;
      while ((m = re.exec(c)) !== null) add(unquote(m[1]));
    }
  }
  return out;
}
