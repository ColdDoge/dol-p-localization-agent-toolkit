/*
 * Synthetic test fixture. Builds a tiny SugarCube story with no game text and
 * a matching pseudo-language. Shared by the node:test suites.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseStory, indexStory } from '../../src/lib/story.mjs';
import { buildInventory } from '../../src/lib/inventory.mjs';
import { restoreProtected } from '../../src/lib/protect.mjs';
import { sourceFingerprint, structuralKey, protectedHash } from '../../src/lib/structure-cache.mjs';

export const FIXTURE_HTML = `<!DOCTYPE html><html><head><title>fixture</title></head><body>
<tw-storydata name="selftest" startnode="1" creator="selftest" creator-version="1.0" format="SugarCube" format-version="2.36.1" ifid="11111111-2222-3333-4444-555555555555">
<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>
<script role="script" id="twine-user-script" type="text/twine-javascript"></script>
<tw-passagedata pid="1" name="Start" tags="" position="100,100">Welcome to the quiet test town. The morning air is cool.</tw-passagedata>
<tw-passagedata pid="2" name="Room" tags="" position="200,100">You are in a small room. Your bed is by the window, and a lamp sits on the desk.</tw-passagedata>
<tw-passagedata pid="3" name="Street" tags="" position="300,100">You walk down the empty street. Consider visiting the market if you still have time.</tw-passagedata>
<tw-passagedata pid="4" name="Guarded" tags="" position="400,100">You greet &lt;&lt;print $name&gt;&gt; and step through the doorway of the old shop.</tw-passagedata>
</tw-storydata></body></html>
`;

/** Synthetic, non-Chinese pseudo-language: append 'x' to every ASCII word. */
export function pseudoProtected(protectedSource) {
  return String(protectedSource).replace(/[A-Za-z]+/g, (w) => `${w}x`);
}

export function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-test-'));
  const storyPath = path.join(dir, 'index.html');
  fs.writeFileSync(storyPath, FIXTURE_HTML);
  const story = parseStory(storyPath);
  const { byName } = indexStory(story);
  const inv = buildInventory(story, { sourceVersion: 'test' });
  const byUnitId = new Map(inv.units.map((u) => [u.unitId, u]));
  return { dir, storyPath, story, byName, units: inv.units, byUnitId };
}

/** A full, valid localization state for every unit. */
export function fullState(units, story) {
  const records = new Map();
  for (const u of units) {
    const protectedTarget = pseudoProtected(u.protectedText);
    records.set(u.unitId, {
      unitId: u.unitId,
      passage: u.passage,
      translation: restoreProtected(protectedTarget, u.placeholders || []),
      protectedTranslation: protectedTarget,
      sourceFingerprint: sourceFingerprint(u),
      structuralFingerprint: structuralKey(u),
      protectedHash: protectedHash(u),
      targetStorySha256: story.sha256,
    });
  }
  return records;
}

/**
 * A synthetic story with `count` independent one-unit passages, for chunked
 * export / repair-kit scale tests. Every passage yields exactly one unit, in
 * passage order, so unit counts are predictable.
 */
export function fixtureHtml(count) {
  const passages = [];
  for (let i = 1; i <= count; i += 1) {
    passages.push(
      `<tw-passagedata pid="${i}" name="P${i}" tags="" position="${i * 100},100">`
      + `Sentence number ${i} tells a small story about the quiet town and its people.`
      + '</tw-passagedata>',
    );
  }
  return `<!DOCTYPE html><html><head><title>fixture-${count}</title></head><body>
<tw-storydata name="selftest-${count}" startnode="1" creator="selftest" creator-version="1.0" format="SugarCube" format-version="2.36.1" ifid="11111111-2222-3333-4444-555555555555">
<style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style>
<script role="script" id="twine-user-script" type="text/twine-javascript"></script>
${passages.join('\n')}
</tw-storydata></body></html>
`;
}

/** Same shape as makeFixture(), but with `count` passages. */
export function makeFixtureWith(count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-test-'));
  const storyPath = path.join(dir, 'index.html');
  fs.writeFileSync(storyPath, fixtureHtml(count));
  const story = parseStory(storyPath);
  const { byName } = indexStory(story);
  const inv = buildInventory(story, { sourceVersion: 'test' });
  const byUnitId = new Map(inv.units.map((u) => [u.unitId, u]));
  return { dir, storyPath, story, byName, units: inv.units, byUnitId };
}
