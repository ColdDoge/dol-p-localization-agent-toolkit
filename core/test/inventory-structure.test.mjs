/*
 * Structural regression tests for the inventory / protection boundary.
 *
 * Every fixture here is synthetic; no real story text is used. The cases are
 * the ones from REAL-INVENTORY-FAILURES-001 §8, extended with the language
 * independence and tamper checks required by the fix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize } from '../src/lib/elements.mjs';
import { buildInventory } from '../src/lib/inventory.mjs';
import { collectVariables, isUrlLike, isStructuralLabel } from '../src/lib/structure-tokens.mjs';
import { checkKitEntry, segmentFromUnit } from '../src/lib/kit.mjs';
import { compareStructures } from '../src/lib/protection-v3.mjs';
import { restoreProtected } from '../src/lib/protect.mjs';
import { makeStory } from './helpers/fixture.mjs';

const PLACEHOLDER_RE = /\u27e6\d+\u27e7/g;

/** Test pseudo-language: replace every ASCII word with CJK, keep tokens. */
function cjk(text) {
  return String(text).replace(/[A-Za-z]+/g, () => '\u5929\u5730\u6587');
}

function unitsOf(inv, passage) {
  return inv.units.filter((u) => u.passage === passage);
}

// ---------------------------------------------------------------------------
// A. identifier / variable boundaries (M1, M5)
// ---------------------------------------------------------------------------

test('identifier boundary: an embedded _suffix never splits an identifier', () => {
  const text = tokenize('item_location and real_year and npc_moan_idle');
  assert.equal(text.length, 1);
  assert.equal(text[0].kind, 'text', JSON.stringify(text));
  assert.equal(collectVariables('item_location real_year 漢_bar').length, 0);
});

test('identifier boundary: real variables and dotted access stay tokens', () => {
  const els = tokenize('see $item_location and _item.name today');
  const vars = els.filter((e) => e.kind === 'variable').map((e) => e.text);
  assert.deepEqual(vars, ['$item_location', '_item.name']);
  assert.deepEqual(collectVariables('a _x $y.z b'), ['_x', '$y.z']);
});

test('variable detection is independent of the surrounding script', () => {
  // Latin and CJK neighbours must give the same answer: `_bar` is only a
  // variable where a variable can start.
  assert.deepEqual(collectVariables('foo_bar'), []);
  assert.deepEqual(collectVariables('漢_bar'), []);
  assert.deepEqual(collectVariables(' foo _bar'), ['_bar']);
  assert.deepEqual(collectVariables('漢 _bar'), ['_bar']);
});

test('V3 does not flag an identifier whose neighbour changed script', () => {
  assert.deepEqual(compareStructures('foo_bar', '\u6f22_bar').findings, []);
  assert.deepEqual(compareStructures('a real_year b', 'a \u672c_year b').findings, []);
});

test('V3 still rejects a variable that really appeared or vanished', () => {
  const removed = compareStructures('Hello $name', 'Hello');
  assert.ok(removed.blocking.some((f) => f.code === 'VARIABLE_CHANGED'), JSON.stringify(removed.blocking));
  const added = compareStructures('Hello', 'Hello _ignored');
  assert.ok(added.blocking.some((f) => f.code === 'VARIABLE_CHANGED'), JSON.stringify(added.blocking));
});

// ---------------------------------------------------------------------------
// B. inventory export (M2, M3, M4)
// ---------------------------------------------------------------------------

test('URLs and link targets are never translation units', () => {
  assert.equal(isUrlLike('example.org/wiki/Home_Page'), true);
  assert.equal(isUrlLike('https://example.org/x'), true);
  assert.equal(isUrlLike('gitgud.io/Andrest07/project/-/releases'), true);
  assert.equal(isUrlLike('Support the project'), false);
  assert.equal(isStructuralLabel('_overrides.left'), true);
  assert.equal(isStructuralLabel('$choice'), true);
  assert.equal(isStructuralLabel('Continue'), false);

  const inv = makeStory([
    ['Url', '[[example.org/wiki/Home_Page|"https://example.org/wiki/Home_Page"]]'],
    ['Keep', '[[Support the project|"https://example.org/support"]]'],
  ]);
  assert.equal(unitsOf(inv, 'Url').length, 0);
  const kept = unitsOf(inv, 'Keep');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].kind, 'link_label');
  assert.equal(kept[0].rawText, 'Support the project');
});

test('script bodies and widget JavaScript are not exported', () => {
  const inv = makeStory([
    ['Script', 'The room is quiet.\n<<script>>const a_b = 1; V.x_y.forEach(z => z.name_known);<</script>>\n'],
    ['WidgetTime', '<<widget "w">>The door is open. <<script>>V.real_year = 2;<</script>><</widget>>'],
  ]);
  for (const u of inv.units) {
    for (const leaked of ['const a_b', 'x_y', 'name_known', 'real_year = ']) {
      assert.ok(!u.rawText.includes(leaked), `${u.unitId} leaked ${leaked}`);
      assert.ok(!u.protectedText.includes(leaked), `${u.unitId} leaked ${leaked}`);
    }
  }
  const widget = unitsOf(inv, 'WidgetTime');
  assert.equal(widget.length, 1);
  assert.equal(widget[0].rawText.trim(), 'The door is open.');
});

test('player-visible strings inside code are extracted, keys and ids are not', () => {
  const inv = makeStory([
    ['Mixed', '<<set _rows.push({ sentence: "Hello there, friend", dialogueID: "npc_greet_idle" })>>'],
    ['Assembled', '<<set _m = { start: "You are carrying ", end: " today." }>>'],
    ['Output', '<<print either("A quiet morning.", "A loud evening.")>>'],
    ['Inner', '<<print `Say <<person1>>, have you seen the moon?`>>'],
  ]);
  const raws = inv.units.map((u) => u.rawText);
  assert.ok(raws.includes('Hello there, friend'), JSON.stringify(raws));
  assert.ok(raws.includes('You are carrying '));
  assert.ok(raws.includes(' today.'));
  assert.ok(raws.includes('A quiet morning.'));
  assert.ok(raws.includes('A loud evening.'));
  for (const u of inv.units) {
    assert.ok(!u.rawText.includes('dialogueID'), u.unitId);
    assert.ok(!u.rawText.includes('npc_greet_idle'), u.unitId);
    assert.ok(!u.rawText.includes('_rows'), u.unitId);
  }
  const inner = inv.units.find((u) => u.rawText.includes('Say '));
  assert.ok(inner, 'inner macro sentence missing');
  assert.equal(inner.protectedText, 'Say \u27e60\u27e7, have you seen the moon?');
  assert.equal(inner.placeholders[0].raw, '<<person1>>');
});

test('form controls bind a variable, not a label', () => {
  const inv = makeStory([['Form', '<<listbox "$choice" autoselect>><</listbox>>']]);
  for (const u of inv.units) {
    assert.ok(!u.rawText.includes('$choice'), JSON.stringify(u.rawText));
  }
});

test('a label is emitted once, never twice for the same span', () => {
  const inv = makeStory([
    ['Labels', '<<link "Steal <<icon>> the marked crate">><</link>>\n<<link "Continue">><</link>>\n'],
  ]);
  const ids = inv.units.map((u) => u.unitId);
  assert.equal(new Set(ids).size, ids.length, `duplicate unitIds: ${JSON.stringify(ids)}`);
  const labels = inv.units.filter((u) => u.kind === 'macro_label');
  assert.equal(labels.filter((u) => u.rawText.includes('Steal')).length, 1);
});

test('unparsable code soup is reported as a pending issue, not exported', () => {
  const inv = makeStory([
    ['Soup', '<<print `Try to <<= either("one","two")`>>'],
  ]);
  const leaked = inv.units.filter((u) => u.rawText.includes('<<=') || u.protectedText.includes('<<='));
  assert.equal(leaked.length, 0, JSON.stringify(leaked.map((u) => u.rawText)));
});

// ---------------------------------------------------------------------------
// C. round trip: export -> fill -> import
// ---------------------------------------------------------------------------

test('a structurally faithful translation of every unit is accepted', () => {
  const inv = makeStory([
    ['Story', 'You greet <<person1>> in the quiet hall.\n<<if $brave>>A warm light fills the room.<</if>>\n'],
    ['Mixed', '<<set _rows.push({ sentence: "Hello there, friend", dialogueID: "npc_greet_idle" })>>'],
    ['Output', '<<print either("A quiet morning.", "A loud evening.")>>'],
    ['Script', 'The street is empty.\n<<script>>V.a_b = V.c_d;<</script>>\n'],
  ]);
  assert.ok(inv.units.length >= 5, `expected several units, got ${inv.units.length}`);
  for (const unit of inv.units) {
    const seg = segmentFromUnit(unit);
    const translation = cjk(seg.protectedSource);
    const r = checkKitEntry(unit, { translation, jsonlSeg: seg });
    assert.equal(r.status, 'accepted', `${unit.unitId}: ${r.reason} ${JSON.stringify(r.codes)}`);
    assert.equal(r.toRaw, restoreProtected(translation, unit.placeholders));
  }
});

test('the same unit accepts a Latin and a CJK translation', () => {
  const inv = makeStory([['Story', 'You greet <<person1>> in the quiet hall.\n']]);
  const unit = inv.units[0];
  const seg = segmentFromUnit(unit);
  const cjkResult = checkKitEntry(unit, { translation: cjk(seg.protectedSource), jsonlSeg: seg });
  assert.equal(cjkResult.status, 'accepted', JSON.stringify(cjkResult.codes));
  const latin = seg.protectedSource.replace(/[A-Za-z]+/g, (w) => `${w}ish`);
  const latinResult = checkKitEntry(unit, { translation: latin, jsonlSeg: seg });
  assert.equal(latinResult.status, 'accepted', JSON.stringify(latinResult.codes));
});

test('tampering with the structure is still rejected', () => {
  const inv = makeStory([
    ['Story', 'You greet <<person1>> in the quiet hall, and wait.\n'],
    ['Two', 'One <<person1>> two <<person2>> three.\n'],
  ]);
  const unit = inv.units.find((u) => u.placeholders.length >= 2);
  assert.ok(unit, 'fixture should produce a unit with two placeholders');
  const seg = segmentFromUnit(unit);
  const base = cjk(seg.protectedSource);
  const ph = base.match(PLACEHOLDER_RE);

  const dropped = base.replace(ph[0], '');
  assert.equal(checkKitEntry(unit, { translation: dropped, jsonlSeg: seg }).status, 'rejected');

  const duplicated = base.replace(ph[0], ph[0] + ph[0]);
  assert.equal(checkKitEntry(unit, { translation: duplicated, jsonlSeg: seg }).status, 'rejected');

  const swapped = base.replace(ph[0], '\u0000').replace(ph[1], ph[0]).replace('\u0000', ph[1]);
  assert.equal(checkKitEntry(unit, { translation: swapped, jsonlSeg: seg }).status, 'rejected');

  const injectedVar = checkKitEntry(unit, { translation: `${base} $injected`, jsonlSeg: seg });
  assert.equal(injectedVar.status, 'rejected');
  assert.ok(injectedVar.codes.includes('V3_VARIABLE_CHANGED'), JSON.stringify(injectedVar.codes));

  const injectedHtml = checkKitEntry(unit, { translation: `${base} <span>`, jsonlSeg: seg });
  assert.equal(injectedHtml.status, 'rejected');
  assert.ok(injectedHtml.codes.includes('V3_HTML_NESTING_CHANGED'), JSON.stringify(injectedHtml.codes));

  const injectedMacro = checkKitEntry(unit, { translation: `${base} <<if injected>>`, jsonlSeg: seg });
  assert.equal(injectedMacro.status, 'rejected');

  const injectedLink = checkKitEntry(unit, { translation: `${base} [[Injected Target]]`, jsonlSeg: seg });
  assert.equal(injectedLink.status, 'rejected');
  assert.ok(injectedLink.codes.includes('V3_LINK_TARGET_CHANGED'), JSON.stringify(injectedLink.codes));
});

test('a dropped pronoun placeholder stays allowed, a dropped macro does not', () => {
  const inv = makeStory([['Story', 'You greet <<him>> beside the <<iconUi _file>> stand.\n']]);
  const unit = inv.units[0];
  const seg = segmentFromUnit(unit);
  const base = cjk(seg.protectedSource);
  const pronoun = unit.placeholders.find((p) => p.name === 'him');
  const other = unit.placeholders.find((p) => p.name !== 'him');
  assert.ok(pronoun && other);
  const dropped = base.replace(pronoun.placeholder, '');
  assert.equal(checkKitEntry(unit, { translation: dropped, jsonlSeg: seg }).status, 'accepted');
  const droppedOther = base.replace(other.placeholder, '');
  assert.equal(checkKitEntry(unit, { translation: droppedOther, jsonlSeg: seg }).status, 'rejected');
});

test('a context-writing selector may not be dropped even when a pronoun may', () => {
  // `<<person1>>` writes $index/$pronoun/... in the passage context, so its
  // state write must survive; `<<he>>` only emits a word.
  const inv = makeStory([['Story', 'You greet <<person1>> and <<he>> smiles.\n']]);
  const unit = inv.units[0];
  const seg = segmentFromUnit(unit);
  const base = cjk(seg.protectedSource);
  const selector = unit.placeholders.find((p) => p.name === 'person1');
  const pronoun = unit.placeholders.find((p) => p.name === 'he');
  assert.ok(selector && pronoun);
  assert.equal(checkKitEntry(unit, { translation: base.replace(pronoun.placeholder, ''), jsonlSeg: seg }).status, 'accepted');
  assert.equal(checkKitEntry(unit, { translation: base.replace(selector.placeholder, ''), jsonlSeg: seg }).status, 'rejected');
});

test('a unit that is all structure is not a translation unit', () => {
  const inv = makeStory([['Icons', "<span class='ui-icon ui-left'></span><span class='ui-icon ui-left'></span>"]]);
  assert.equal(unitsOf(inv, 'Icons').length, 0);
});

test('tokenizer output is always reversible (span model stays trustworthy)', () => {
  const samples = [
    'a < b and c > d',
    "[[Say that you're busy|Target]]",
    '<<if $x is "a>>b">>body<</if>>',
    "<<link 'Go'>>text<</link>>",
    '`tick ` nested ${x}',
    '<span class="a>b">x</span>',
  ];
  for (const s of samples) {
    const els = tokenize(s);
    assert.equal(els.map((e) => e.text).join(''), s, s);
  }
});

test('inventory stays reversible for every synthetic passage', () => {
  const inv = makeStory([
    ['A', 'Text <<if $x>>inside<</if>> and more text here.\n'],
    ['B', '<<widget "w">>A sentence with <<person1>> inside.<</widget>>\n'],
  ]);
  assert.equal(inv.stats.irreversiblePassages, 0);
  assert.ok(inv.units.length > 0);
});
