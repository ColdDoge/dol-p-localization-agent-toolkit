import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFixture, fullState } from './helpers/fixture.mjs';
import { classifyCoverage, markUnresolved, strictPass, blockingTotal, exportClassification } from '../src/lib/coverage.mjs';
import { buildEntries } from '../src/lib/entries.mjs';
import { buildPack } from '../src/lib/builder.mjs';

const fx = makeFixture();

function classify(records) {
  return classifyCoverage({ units: fx.units, records });
}

test('full valid state is entirely translated-valid and passes strict', () => {
  const report = classify(fullState(fx.units, fx.story));
  assert.equal(report.counts['translated-valid'], fx.units.length, JSON.stringify(report.counts));
  assert.equal(strictPass(report.counts), true);
});

test('untranslated blocks a strict build', () => {
  const records = fullState(fx.units, fx.story);
  records.delete(fx.units[0].unitId);
  const report = classify(records);
  assert.equal(report.counts.untranslated, 1);
  assert.equal(strictPass(report.counts), false);
  assert.equal(exportClassification(report.counts).missing, 1);
});

test('superseded blocks a strict build and is the export-side `changed`', () => {
  const records = fullState(fx.units, fx.story);
  const id = fx.units[0].unitId;
  records.set(id, { ...records.get(id), sourceFingerprint: 'stale-fingerprint' });
  const report = classify(records);
  assert.equal(report.counts.superseded, 1);
  assert.equal(strictPass(report.counts), false);
  assert.equal(exportClassification(report.counts).changed, 1);
});

test('rejected-structure blocks a strict build', () => {
  const records = fullState(fx.units, fx.story);
  const target = fx.units.find((u) => (u.placeholders || []).length > 0) || fx.units[0];
  records.set(target.unitId, { ...records.get(target.unitId), protectedTranslation: 'x', translation: 'x' });
  const report = classify(records);
  assert.ok(report.counts['rejected-structure'] >= 1, JSON.stringify(report.counts));
  assert.equal(strictPass(report.counts), false);
});

test('unresolved blocks a strict build (planner could not place a valid unit)', () => {
  const report = classify(fullState(fx.units, fx.story));
  markUnresolved(report, [{ unitId: fx.units[0].unitId, passage: fx.units[0].passage, reason: 'planner-uncovered' }]);
  assert.equal(report.counts.unresolved, 1);
  assert.equal(strictPass(report.counts), false);
});

test('obsolete alone never blocks a strict build', () => {
  const records = fullState(fx.units, fx.story);
  records.set('999999:0-1', { unitId: '999999:0-1', passage: 'Gone', translation: 'x', protectedTranslation: 'x' });
  const report = classify(records);
  assert.equal(report.counts.obsolete, 1);
  assert.equal(strictPass(report.counts), true);
  assert.equal(blockingTotal(report.counts), 0);
});

test('partial build ships only translated-valid and reports the rest', () => {
  const records = fullState(fx.units, fx.story);
  records.delete(fx.units[0].unitId);
  const report = classify(records);
  const buildUnits = fx.units.filter((u) => (report.byUnitId.get(u.unitId) || {}).state === 'translated-valid');
  const built = buildPack({ story: fx.story, byName: fx.byName, units: buildUnits, translations: records });
  assert.equal(built.coverage.has(fx.units[0].unitId), false);
  assert.ok(built.entryCount >= 1);
  assert.equal(report.counts.untranslated, 1);
});

test('planner reports overlap for two units claiming the same span', () => {
  const passage = { name: 'P', content: 'Alpha beta. Alpha beta.' };
  const byName = new Map([['P', passage]]);
  const built = buildEntries([
    { unitId: 'u1', passage: 'P', startOffset: 0, endOffset: 11, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
    { unitId: 'u2', passage: 'P', startOffset: 0, endOffset: 11, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
  ], byName);
  assert.ok(built.coverage.size < 2 || built.skipped.some((s) => s.reason === 'overlap'), JSON.stringify(built.skipped));
});

test('planner unifies identical repeated text with identical translations', () => {
  const passage = { name: 'P', content: 'Alpha beta. Alpha beta.' };
  const byName = new Map([['P', passage]]);
  const built = buildEntries([
    { unitId: 'u1', passage: 'P', startOffset: 0, endOffset: 11, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
    { unitId: 'u2', passage: 'P', startOffset: 12, endOffset: 23, rawText: 'Alpha beta.', protectedText: 'Alpha beta.', placeholders: [], translation: 'Gamma delta.' },
  ], byName);
  assert.equal(built.coverage.size, 2, JSON.stringify(built.skipped));
});
