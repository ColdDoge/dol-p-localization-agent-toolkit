/*
 * V3 variable boundary regression tests (defect 005).
 *
 * `verifyEntry` restores the placeholders before V3 compares, so the raw text
 * V3 sees spells a variable out (`$worn.face.name`, `_painting`). Variable
 * recognition requires an identifier boundary in front of it, and a natural
 * Chinese translation puts a CJK character there (Chinese has no word spaces),
 * which used to read as "the variable was removed" and rejected a faithful
 * translation. The fix compares in a placeholder-aware domain instead of
 * loosening the variable grammar.
 *
 * Every fixture is synthetic. Prefix `x` marks a translated pseudo-word so no
 * real game text is used.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkKitEntry, segmentFromUnit } from '../src/lib/kit.mjs';
import { compareStructures, placeholderDomain } from '../src/lib/protection-v3.mjs';
import { collectVariables } from '../src/lib/structure-tokens.mjs';
import { makeStory } from './helpers/fixture.mjs';

const PH = (n) => `\u27e6${n}\u27e7`;

function onlyUnit(inv, passage) {
  const list = inv.units.filter((u) => u.passage === passage);
  assert.equal(list.length, 1, `expected 1 unit in ${passage}, got ${list.length}`);
  return list[0];
}

function entry(unit, translation) {
  return checkKitEntry(unit, { translation, jsonlSeg: segmentFromUnit(unit) });
}

// ---------------------------------------------------------------------------
// The defect: CJK directly against a restored variable
// ---------------------------------------------------------------------------

test('defect 005: a CJK letter directly before a restored variable is not a removed variable', () => {
  const inv = makeStory([['Bedroom', 'Images of _furniture.wallpaper.name cover the walls.\n']]);
  const unit = onlyUnit(inv, 'Bedroom');
  assert.equal(unit.placeholders.length, 1);
  assert.equal(unit.placeholders[0].raw, '_furniture.wallpaper.name');

  const r = entry(unit, `\u5899\u4e0a\u8d34\u6ee1\u4e86${PH(0)}\u7684\u753b\u50cf\u3002`);
  assert.equal(r.status, 'accepted', `${r.reason} ${JSON.stringify(r.codes)}`);
});

test('defect 005: same for a $ variable, and for a variable with no space on either side', () => {
  const inv = makeStory([['Hallway', 'You trip over your $worn.feet.name and land badly.\n']]);
  const unit = onlyUnit(inv, 'Hallway');
  assert.equal(unit.placeholders[0].raw, '$worn.feet.name');

  const tight = entry(unit, `\u4f60\u88ab\u81ea\u5df1\u7684${PH(0)}\u7eca\u5012\u4e86\u3002`);
  assert.equal(tight.status, 'accepted', JSON.stringify(tight.codes));

  const withSpace = entry(unit, `\u4f60\u88ab ${PH(0)} \u7eca\u5012\u4e86\u3002`);
  assert.equal(withSpace.status, 'accepted', JSON.stringify(withSpace.codes));
});

test('defect 005: consecutive placeholders keep their order and their variables', () => {
  const inv = makeStory([[
    'Hallways',
    'You step in when <<npc Winter>><<person1>>a stranger and <<his>> friends surround you.\n',
  ]]);
  const unit = onlyUnit(inv, 'Hallways');
  assert.equal(unit.placeholders.length, 3);
  const r = entry(unit, `${PH(0)}${PH(1)}\u4e00\u4e2a\u964c\u751f\u4eba\u548c${PH(2)}\u670b\u53cb\u56f4\u4e86\u4e0a\u6765\u3002`);
  assert.equal(r.status, 'accepted', `${r.reason} ${JSON.stringify(r.codes)}`);
});

test('defect 005: the fix is in the comparison domain, not in the variable grammar', () => {
  // `collectVariables` deliberately keeps the Unicode identifier rule: an
  // identifier that merely contains an underscore stays one identifier, and a
  // variable behind a CJK letter is still not a *new* variable in raw text.
  // The domain supplies the boundary for tokens that came from a placeholder.
  assert.deepEqual(collectVariables('\u5899\u4e0a\u8d34\u6ee1\u4e86_furniture.wallpaper.name\u7684\u753b\u50cf\u3002'), []);
  assert.deepEqual(collectVariables('foo_bar'), []);
  assert.deepEqual(collectVariables('\u6f22_bar'), []);

  const placeholders = [{ placeholder: PH(0), raw: '_furniture.wallpaper.name', kind: 'variable' }];
  const domain = placeholderDomain(` X ${PH(0)} Y `, placeholders);
  assert.equal(domain, ' X \u0002_furniture.wallpaper.name\u0002 Y ');
  assert.deepEqual(collectVariables(domain), ['_furniture.wallpaper.name']);
  // No placeholders -> the domain is the text itself.
  assert.equal(placeholderDomain('plain text', []), 'plain text');
});

test('defect 005: an identifier that contains an underscore still compares equal across scripts', () => {
  assert.deepEqual(compareStructures('foo_bar', '\u6f22_bar').blocking, []);
});

// ---------------------------------------------------------------------------
// The guard must keep every check it had
// ---------------------------------------------------------------------------

test('a dropped pronoun placeholder is still allowed, a dropped variable is not', () => {
  const inv = makeStory([['Story', 'You greet <<him>> beside the <<iconUi _file>> stand.\n']]);
  const unit = onlyUnit(inv, 'Story');
  const pronoun = unit.placeholders.find((p) => p.name === 'him');
  const other = unit.placeholders.find((p) => p.name !== 'him');
  assert.ok(pronoun && other);
  const base = `\u4f60\u5728 ${PH(0)} \u65c1\u8fb9\u95ee\u597d\u4e86 ${PH(1)}\u3002`;

  const omitted = entry(unit, base.replace(PH(0), '').replace(/\s+/g, ' '));
  assert.equal(omitted.status, 'accepted', JSON.stringify(omitted.codes));

  const droppedOther = entry(unit, base.replace(PH(1), ''));
  assert.equal(droppedOther.status, 'rejected', JSON.stringify(droppedOther.codes));
});

test('an injected variable outside a placeholder is still rejected', () => {
  const inv = makeStory([['Story', 'The room is quiet and warm today.\n']]);
  const unit = onlyUnit(inv, 'Story');
  const r = entry(unit, '\u623f\u95f4\u5b89\u9759\u53c8\u6e29\u6696\u3002 $injectedVar');
  assert.equal(r.status, 'rejected');
  assert.ok(r.codes.includes('V3_VARIABLE_CHANGED'), JSON.stringify(r.codes));

  // No separator needed when the preceding character is punctuation: the
  // identifier boundary is there either way.
  const tight = entry(unit, '\u623f\u95f4\u5b89\u9759\u53c8\u6e29\u6696\u3002$injectedVar');
  assert.equal(tight.status, 'rejected');
  assert.ok(tight.codes.includes('V3_VARIABLE_CHANGED'), JSON.stringify(tight.codes));
});

test('a variable injected right after a CJK letter keeps the documented raw-text rule', () => {
  // Pre-existing behaviour of the shared variable grammar, not a regression:
  // `_bar` after a letter is read as part of one identifier (that is what
  // keeps `foo_bar` intact), so the same rule applies to a CJK letter. The
  // domain fix only restores the boundary for tokens that came from a
  // placeholder; text a translation appends has no placeholder.
  assert.deepEqual(collectVariables('\u6ee1$injectedVar'), []);
  assert.deepEqual(collectVariables('\u6ee1$injectedVar'.replace('\u6ee1', '\u3002')), ['$injectedVar']);
  assert.deepEqual(compareStructures('The room is quiet.', '\u6ee1$injectedVar').blocking, []);
});

test('an injected macro or HTML tag is still rejected', () => {
  const inv = makeStory([['Story', 'The room is quiet and warm today.\n']]);
  const unit = onlyUnit(inv, 'Story');
  const macro = entry(unit, '\u623f\u95f4\u5b89\u9759 <<if injected>>');
  assert.equal(macro.status, 'rejected');
  assert.ok(macro.codes.some((c) => c === 'V3_MACRO_BALANCE_CHANGED' || c === 'V3_COND_BRANCH_COUNT_CHANGED'), JSON.stringify(macro.codes));

  const html = entry(unit, '\u623f\u95f4\u5b89\u9759 <span>');
  assert.equal(html.status, 'rejected');
  assert.ok(html.codes.includes('V3_HTML_NESTING_CHANGED'), JSON.stringify(html.codes));
});

test('a placeholder swap is still rejected', () => {
  const inv = makeStory([['Story', 'One <<person1>> two <<person2>> three.\n']]);
  const unit = onlyUnit(inv, 'Story');
  assert.equal(unit.placeholders.length, 2);
  const r = entry(unit, `\u4e00 ${PH(1)} \u4e8c ${PH(0)} \u4e09\u3002`);
  assert.equal(r.status, 'rejected');
  assert.ok(r.codes.includes('PLACEHOLDER_ORDER_CHANGED'), JSON.stringify(r.codes));
});

test('a faithful Chinese translation of a placeholder-heavy unit is accepted', () => {
  const inv = makeStory([[
    'Museum Shackle',
    '<<npc Winter>><<person1>> Winter examines the $worn.feet.name. "I have just the thing," <<he>> says.<br><br><<He>> leads you away.\n',
  ]]);
  const unit = onlyUnit(inv, 'Museum Shackle');
  const r = entry(
    unit,
    `${PH(0)}${PH(1)}\u6e29\u7279\u68c0\u67e5\u4e86${PH(2)}\u3002\u201c\u6211\u6b63\u597d\u6709\u529e\u6cd5\u3002\u201d${PH(3)}\u8bf4\u3002${PH(4)}${PH(5)}${PH(6)}\u5e26\u4f60\u8d70\u4e86\u3002`,
  );
  assert.equal(r.status, 'accepted', `${r.reason} ${JSON.stringify(r.codes)}`);
});
