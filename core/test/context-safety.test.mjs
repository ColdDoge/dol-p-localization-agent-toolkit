/*
 * Enclosing-context safety tests.
 *
 * A translatable span lives inside a JavaScript string literal, a quoted macro
 * argument or link markup. These tests check that a translation may contain
 * ordinary punctuation (including ASCII quotes, backslashes, newlines,
 * backticks and `${`) without breaking the generated source, and that contexts
 * with no escape syntax reject the delimiter they cannot absorb.
 *
 * Every fixture is synthetic.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkKitEntry, segmentFromUnit } from '../src/lib/kit.mjs';
import { makeStory } from './helpers/fixture.mjs';

/** Splice a unit's translation back into the passage, as the pack does. */
function splicePassage(inv, passageName, unit, translated) {
  const p = inv.byName.get(passageName);
  return p.content.slice(0, unit.startOffset) + translated + p.content.slice(unit.endOffset);
}

/** Source of a `<<script>>` block, ready to be evaluated as JavaScript. */
function scriptBody(content) {
  const m = /<<script>>([\s\S]*?)<<\/script>>/.exec(content);
  assert.ok(m, `no script block in ${JSON.stringify(content.slice(0, 80))}`);
  return m[1];
}

function importUnit(inv, passage, unit, translation) {
  const seg = segmentFromUnit(unit);
  const result = checkKitEntry(unit, { translation, jsonlSeg: seg });
  return { result, content: result.status === 'accepted' ? splicePassage(inv, passage, unit, result.toRaw) : null };
}

function codeStringUnit(inv, passage) {
  const unit = inv.units.find((u) => u.passage === passage && u.origin === 'code-string');
  assert.ok(unit, `no code-string unit in ${passage}`);
  return unit;
}

// ---------------------------------------------------------------------------
// JavaScript string literals: escaping keeps the code valid
// ---------------------------------------------------------------------------

test('a double-quoted code string survives quotes, backslashes and newlines', () => {
  const inv = makeStory([['Script', '<<script>>var m = { sentence: "Plain text here." };<</script>>']]);
  const unit = codeStringUnit(inv, 'Script');
  assert.equal(unit.rawText, 'Plain text here.');
  assert.equal(unit.context, 'js-double');

  const wanted = '他说"你好"。\\ 谢谢\n第二行';
  const { result, content } = importUnit(inv, 'Script', unit, wanted);
  assert.equal(result.status, 'accepted', JSON.stringify(result.codes));
  const body = scriptBody(content);
  const value = new Function(`${body}\nreturn m;`)();
  assert.equal(value.sentence, wanted, 'the generated source must hold the exact text');
});

test('a single-quoted code string survives apostrophes and backslashes', () => {
  const inv = makeStory([["Script", "<<script>>var m = { sentence: 'Plain text here.' };<</script>>"]]);
  const unit = codeStringUnit(inv, 'Script');
  assert.equal(unit.context, 'js-single');
  const wanted = "don't \\ stop";
  const { result, content } = importUnit(inv, 'Script', unit, wanted);
  assert.equal(result.status, 'accepted', JSON.stringify(result.codes));
  const value = new Function(`${scriptBody(content)}\nreturn m;`)();
  assert.equal(value.sentence, wanted);
});

test('a template code string survives backticks and new ${ expressions', () => {
  const inv = makeStory([['Script', '<<script>>var m = { sentence: `Template text here.` };<</script>>']]);
  const unit = codeStringUnit(inv, 'Script');
  assert.equal(unit.context, 'js-template');

  const wanted = '模板`文字 ${1+1} 结束';
  const { result, content } = importUnit(inv, 'Script', unit, wanted);
  assert.equal(result.status, 'accepted', JSON.stringify(result.codes));
  const value = new Function(`${scriptBody(content)}\nreturn m;`)();
  assert.equal(value.sentence, wanted, 'a new ${ must stay literal, not interpolate');
});

test('existing template holes are preserved and may be reordered with the text', () => {
  const inv = makeStory([['Script', '<<script>>var m = { sentence: `Hello ${"world"} again.` };<</script>>']]);
  const unit = codeStringUnit(inv, 'Script');
  assert.equal(unit.protectedText, 'Hello \u27e60\u27e7 again.');
  assert.equal(unit.placeholders[0].raw, '${"world"}');
  const { result, content } = importUnit(inv, 'Script', unit, '你好 ⟦0⟧ 再见');
  assert.equal(result.status, 'accepted', JSON.stringify(result.codes));
  const value = new Function(`${scriptBody(content)}\nreturn m;`)();
  assert.equal(value.sentence, '你好 world 再见');
});

test('an unclosed quote in the translation cannot escape the literal', () => {
  const inv = makeStory([['Script', '<<script>>var m = { sentence: "Plain text here." };<</script>>']]);
  const unit = codeStringUnit(inv, 'Script');
  const { result, content } = importUnit(inv, 'Script', unit, '他说"然后没有收尾');
  assert.equal(result.status, 'accepted', JSON.stringify(result.codes));
  const value = new Function(`${scriptBody(content)}\nreturn m;`)();
  assert.equal(value.sentence, '他说"然后没有收尾');
});

// ---------------------------------------------------------------------------
// Contexts without escape syntax: the delimiter is refused, not silently kept
// ---------------------------------------------------------------------------

test('a macro argument refuses a quote it cannot escape, but accepts 全角 quotes', () => {
  const inv = makeStory([['Link', '<<link "Continue">>Some text<</link>>']]);
  const unit = inv.units.find((u) => u.kind === 'macro_label');
  assert.ok(unit, 'macro label unit missing');
  assert.equal(unit.context, 'arg-double');

  const bad = importUnit(inv, 'Link', unit, '继"续"');
  assert.equal(bad.result.status, 'rejected');
  assert.ok(bad.result.codes.includes('MACRO_ARG_DELIMITER_INSERTED'), JSON.stringify(bad.result.codes));

  const good = importUnit(inv, 'Link', unit, '继“续”（确认）');
  assert.equal(good.result.status, 'accepted', JSON.stringify(good.result.codes));
  assert.ok(good.content.includes('<<link "继“续”（确认）">>'));
});

test('a link label refuses structural delimiters but accepts normal punctuation', () => {
  const inv = makeStory([['Link', '<<link [[Continue|Somewhere Else]]>>Some text<</link>>']]);
  const unit = inv.units.find((u) => u.kind === 'link_label');
  assert.ok(unit, 'link label unit missing');
  assert.equal(unit.context, 'link');
  assert.equal(unit.rawText, 'Continue');

  for (const bad of ['A|B', 'A]]B', 'A->B', 'A<-B']) {
    const r = importUnit(inv, 'Link', unit, bad);
    assert.equal(r.result.status, 'rejected', `${bad} should be rejected`);
    assert.ok(r.result.codes.includes('LINK_LABEL_DELIMITER_INSERTED'), JSON.stringify(r.result.codes));
  }

  const good = importUnit(inv, 'Link', unit, '继续（确认）…“好”');
  assert.equal(good.result.status, 'accepted', JSON.stringify(good.result.codes));
  assert.ok(good.content.includes('[[继续（确认）…“好”|Somewhere Else]]'));
});

test('a quoted label inside link markup is escaped, not refused', () => {
  const inv = makeStory([['Link', '<<link [[`Show <<him>> the box`|Target Place]]>>Text here.<</link>>']]);
  const label = inv.units.find((u) => u.kind === 'link_label');
  assert.ok(label, 'template link label missing');
  assert.equal(label.context, 'js-template');
  assert.equal(label.rawText, 'Show <<him>> the box');
  const { result, content } = importUnit(inv, 'Link', label, '展示`盒子 ${1}');
  assert.equal(result.status, 'accepted', JSON.stringify(result.codes));
  assert.ok(content.includes('`展示\\`盒子 \\${1}`'), content.slice(0, 120));
});

// ---------------------------------------------------------------------------
// Short text and identifiers
// ---------------------------------------------------------------------------

test('short labels and short fragments are exported, identifiers are not', () => {
  const inv = makeStory([
    ['Short', [
      '<<link [[Go|Somewhere]]>>next<</link>>',
      '<<button "No">>later<</button>>',
      '<p>Man</p>',
      '<p>fur</p>',
      '<<listbox "$pick" autoselect>><</listbox>>',
      '<<link "_overrides.left" "Somewhere">>later<</link>>',
    ].join('\n')],
  ]);
  const texts = inv.units.map((u) => u.rawText);
  for (const wanted of ['Go', 'No', 'Man', 'fur']) {
    assert.ok(texts.includes(wanted), `${wanted} not exported: ${JSON.stringify(texts)}`);
  }
  for (const u of inv.units) {
    assert.ok(!u.rawText.includes('$pick'), JSON.stringify(u.rawText));
    assert.ok(!u.rawText.includes('_overrides'), JSON.stringify(u.rawText));
  }
});

test('a script block may contain its own closing marker as a string', () => {
  const inv = makeStory([
    ['End', '<<script>>var s = "<</script>>"; V.x_y = 1; var t = 2;<</script>>\nAfter the script is a sentence.\n'],
  ]);
  const raws = inv.units.map((u) => u.rawText);
  assert.ok(raws.some((r) => r.includes('After the script')), JSON.stringify(raws));
  for (const u of inv.units) {
    assert.ok(!u.rawText.includes('x_y'), u.unitId);
    assert.ok(!u.protectedText.includes('x_y'), u.unitId);
    assert.ok(!u.rawText.includes('</script>'), u.unitId);
  }
  assert.equal(inv.stats.codeBlocks, 1);
});

test('a data literal that is also a lookup key is not exported', () => {
  const inv = makeStory([
    ['Data', '<<set $items to { "a": { name: "Red Potion", price: 5 }, "b": { name: "Bright Potion", price: 9 } }>>'],
    ['Use', '<<wearProp "Red Potion">>'],
  ]);
  const raws = inv.units.map((u) => u.rawText);
  assert.ok(!raws.includes('Red Potion'), `"Red Potion" is a lookup key: ${JSON.stringify(raws)}`);
  assert.ok(raws.includes('Bright Potion'), `"Bright Potion" is plain display text: ${JSON.stringify(raws)}`);
  assert.ok(inv.issues.some((i) => i.code === 'code-string-is-identifier'), JSON.stringify(inv.issues));
});

test('a display name that differs only in case from a lookup key is not exported', () => {
  const inv = makeStory([
    ['Data', '<<set $items to { "a": { name: "Silver Fox Hide", price: 5 } }>>'],
    ['Use', '<<if $hair.colour is "silver fox hide">>Some text here.<</if>>'],
  ]);
  const raws = inv.units.map((u) => u.rawText);
  assert.ok(!raws.includes('Silver Fox Hide'), JSON.stringify(raws));
});

test('a bare macro argument is exported only when it reads as display text', () => {
  const inv = makeStory([
    ['Args', [
      '<<muffledSpeech "Please don\'t leave me!">>',
      '<<tranceText "Genital sensitivity">>',
      '<<upperwear "silver fox">>',
      '<<wrapText "aspect-ratio:">>',
      '<<include "Chapter One Intro">>',
    ].join('\n')],
  ]);
  const raws = inv.units.map((u) => u.rawText);
  assert.ok(raws.includes("Please don't leave me!"), JSON.stringify(raws));
  assert.ok(raws.includes('Genital sensitivity'), JSON.stringify(raws));
  for (const skipped of ['silver fox', 'aspect-ratio:', 'Chapter One Intro']) {
    assert.ok(!raws.includes(skipped), `${skipped} must not be a unit: ${JSON.stringify(raws)}`);
  }
});

test('a map assigned to a display-named target exports its prose values', () => {
  const inv = makeStory([
    ['Map', '<<set setup.endingReasonText = { a: "Lost the wager", b: "Left the gathering early" }>>'],
    ['Other', '<<set setup.internalIds = { a: "Lost the wager" }>>'],
  ]);
  const raws = inv.units.map((u) => u.rawText);
  assert.ok(raws.includes('Lost the wager'), JSON.stringify(raws));
  assert.ok(raws.includes('Left the gathering early'), JSON.stringify(raws));
  // the same value under a plumbing name is not a display map
  assert.equal(inv.units.filter((u) => u.passage === 'Other').length, 0, JSON.stringify(raws));
});

test('labels inside macro bodies are exported with their own span', () => {
  const inv = makeStory([
    ['Nav', '<<link [[Confirm|Next Room]]>>Confirm<</link>>\n<<link [[No Target]]>>x<</link>>\n'],
  ]);
  const labels = inv.units.filter((u) => u.kind === 'link_label');
  assert.equal(labels.length, 1, JSON.stringify(inv.units.map((u) => `${u.kind}:${u.rawText}`)));
  const p = inv.byName.get('Nav');
  assert.equal(p.content.slice(labels[0].startOffset, labels[0].endOffset), 'Confirm');
});
