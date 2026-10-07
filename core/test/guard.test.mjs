import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyEntry } from '../src/lib/protect.mjs';

test('placeholder integrity: a dropped placeholder is rejected', () => {
  const unit = {
    rawText: 'You greet <<print $name>> today.',
    protectedText: 'You greet \u27e60\u27e7 today.',
    placeholders: [{ placeholder: '\u27e60\u27e7', raw: '<<print $name>>', kind: 'macro', name: 'print' }],
  };
  const r = verifyEntry({
    protectedText: unit.protectedText, placeholders: unit.placeholders,
    translatedProtected: 'Today you greet.',
    fromRaw: unit.rawText, toRaw: 'Today you greet.',
  });
  assert.equal(r.ok, false);
  assert.ok(r.codes.length > 0);
});

test('macro rename is rejected by the V3 structural guard', () => {
  const r = verifyEntry({
    protectedText: 'You greet \u27e60\u27e7 today.',
    placeholders: [{ placeholder: '\u27e60\u27e7', raw: '<<print $name>>', kind: 'macro' }],
    translatedProtected: 'Today you greet \u27e60\u27e7.',
    fromRaw: 'You greet <<print $name>> today.',
    toRaw: 'Today you greet <<print $other>>.',
  });
  assert.equal(r.ok, false);
});

test('removed HTML is rejected', () => {
  const r = verifyEntry({
    protectedText: 'Hello <b>bold</b> text.', placeholders: [],
    translatedProtected: 'Hello bold text.', fromRaw: 'Hello <b>bold</b> text.', toRaw: 'Hello bold text.',
  });
  assert.equal(r.ok, false);
});

test('no-op and empty translations are rejected', () => {
  assert.equal(verifyEntry({
    protectedText: 'Hello world.', placeholders: [],
    translatedProtected: 'Hello world.', fromRaw: 'Hello world.', toRaw: 'Hello world.',
  }).ok, false);
  assert.equal(verifyEntry({
    protectedText: 'Hello world.', placeholders: [],
    translatedProtected: '   ', fromRaw: 'Hello world.', toRaw: '   ',
  }).ok, false);
});

test('a faithful, structure-preserving translation is accepted', () => {
  const r = verifyEntry({
    protectedText: 'You greet \u27e60\u27e7 today.',
    placeholders: [{ placeholder: '\u27e60\u27e7', raw: '<<print $name>>', kind: 'macro' }],
    translatedProtected: 'Today you greet \u27e60\u27e7.',
    fromRaw: 'You greet <<print $name>> today.',
    toRaw: 'Today you greet <<print $name>>.',
  });
  assert.equal(r.ok, true, JSON.stringify(r.codes));
});
