/*
 * Tests for the browser translation editor's pure engine.
 *
 * The editor is a single, offline HTML file with no build step, so instead of
 * importing a module we extract the marked DOLP-EDITOR-ENGINE region out of
 * the shipped HTML and evaluate it. This guarantees the tests exercise exactly
 * the source that ships, with no duplicated logic.
 *
 * Everything here is in-process and offline: no device, model, or network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDITOR_HTML = fileURLToPath(new URL('../../dolp-kit-translation-editor.html', import.meta.url));
const BEGIN = '/* ==== DOLP-EDITOR-ENGINE:BEGIN ==== */';
const END = '/* ==== DOLP-EDITOR-ENGINE:END ==== */';

function loadEngine() {
  const html = fs.readFileSync(EDITOR_HTML, 'utf8');
  const start = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  assert.ok(start >= 0, 'engine BEGIN marker present');
  assert.ok(end > start, 'engine END marker present');
  const code = html.slice(start + BEGIN.length, end);
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${code}\n;return EditorEngine;`);
  return factory();
}

const E = loadEngine();

const PH = '\u27e6'; // ⟦
const PHc = '\u27e7'; // ⟧
const seg = (over) => ({ unitId: 'u', passage: 'P', protectedSource: '', translation: '', ...over });

test('placeholders: extracts numbered tokens in order', () => {
  assert.deepEqual(E.placeholders(`a ${PH}0${PHc} b ${PH}1${PHc} c ${PH}0${PHc}`), [`${PH}0${PHc}`, `${PH}1${PHc}`, `${PH}0${PHc}`]);
  assert.deepEqual(E.placeholders('no tokens'), []);
  assert.deepEqual(E.placeholders(null), []);
});

test('placeholder integrity: valid, reordered, missing, extra', () => {
  const src = `greet ${PH}0${PHc} and ${PH}1${PHc}`;
  assert.equal(E.placeholderIssues(src, `欢迎 ${PH}0${PHc} 和 ${PH}1${PHc}`).length, 0);

  const order = E.placeholderIssues(src, `${PH}1${PHc} ${PH}0${PHc}`);
  assert.equal(order[0].severity, 'error');
  assert.equal(order[0].code, 'PLACEHOLDER_ORDER_CHANGED');

  const missing = E.placeholderIssues(src, `${PH}0${PHc}`);
  assert.equal(missing[0].code, 'PLACEHOLDER_COUNT_CHANGED');

  // Same count, different identity -> multiset mismatch (not merely reorder).
  const swapped = E.placeholderIssues(`${PH}0${PHc} ${PH}1${PHc}`, `${PH}2${PHc} ${PH}3${PHc}`);
  assert.equal(swapped[0].code, 'PLACEHOLDER_MISMATCH');
});

test('safety check: valid translation passes with no errors', () => {
  const s = seg({ protectedSource: `You greet ${PH}0${PHc} today.`, translation: `今天你向 ${PH}0${PHc} 问好。` });
  const issues = E.checkSegmentSafety(s);
  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
});

test('safety check: dropped placeholder is an error; empty translation is silent', () => {
  const dropped = E.checkSegmentSafety(seg({ protectedSource: `Hi ${PH}0${PHc}`, translation: 'Hi' }));
  assert.equal(dropped[0].severity, 'error');
  assert.equal(E.checkSegmentSafety(seg({ protectedSource: `Hi ${PH}0${PHc}`, translation: '' })).length, 0);
});

test('safety check: hand-typed macro is flagged, plain punctuation is not', () => {
  const typed = E.checkSegmentSafety(seg({ protectedSource: 'plain source text', translation: 'naughty <<print $x>> text' }));
  assert.ok(typed.some((i) => i.code === 'UNEXPECTED_STRUCTURE' && i.severity === 'warn'));
  const percent = E.checkSegmentSafety(seg({ protectedSource: '50% of it, {x} and <not a tag>', translation: '其中的 50%，{x} 以及 <not a tag>' }));
  assert.equal(percent.filter((i) => i.code === 'UNEXPECTED_STRUCTURE').length, 0, 'plain braces/percent must not be treated as variables');
});

test('safety check: a copy of the source is only an info hint', () => {
  const issues = E.checkSegmentSafety(seg({ protectedSource: 'Hello world', translation: 'Hello world' }));
  assert.ok(issues.some((i) => i.code === 'SAME_AS_SOURCE' && i.severity === 'info'));
  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
});

test('hasBlocking distinguishes real problems from hints', () => {
  assert.equal(E.hasBlocking([{ severity: 'info', code: 'SAME_AS_SOURCE' }]), false);
  assert.equal(E.hasBlocking([{ severity: 'warn', code: 'TERM_MISSING' }]), true);
  assert.equal(E.hasBlocking([{ severity: 'error', code: 'PLACEHOLDER_COUNT_CHANGED' }]), true);
});

test('terminology: whole-word Latin terms, case-sensitive, ignore-able', () => {
  const terms = [{ source: 'Robin', target: '罗宾' }, { source: 'Rob', target: '抢' }];
  // "Robin" must not be satisfied by the sub-term "Rob"; whole word, case-sensitive.
  const miss = E.checkSegmentTerminology(seg({ unitId: 'a', protectedSource: 'You see Robin.', translation: '你看到 rob。' }), terms);
  assert.deepEqual(miss.map((i) => i.code), ['TERM_MISSING']);
  assert.equal(miss[0].term, 'Robin');

  const ok = E.checkSegmentTerminology(seg({ unitId: 'b', protectedSource: 'You see Robin.', translation: '你看到罗宾。' }), terms);
  assert.equal(ok.length, 0);

  const ignored = E.checkSegmentTerminology(seg({ unitId: 'b', protectedSource: 'You see Robin.', translation: '你看到罗宾。' }), terms, new Set(['b\u0001Robin']));
  assert.equal(ignored.length, 0);
});

test('duplicate groups: only identical non-empty sources, divergence detected', () => {
  const segments = [
    seg({ unitId: '1', protectedSource: 'The bell rings.', translation: '铃响了。' }),
    seg({ unitId: '2', protectedSource: 'The bell rings.', translation: '铃声响起。' }),
    seg({ unitId: '3', protectedSource: 'The bell rings.', translation: '' }),
    seg({ unitId: '4', protectedSource: 'Unique line.', translation: 'x' }),
    seg({ unitId: '5', protectedSource: '   ', translation: 'y' }),
  ];
  const groups = E.duplicateGroups(segments);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].divergent, true);
  assert.equal(groups[0].emptyCount, 1);
  assert.deepEqual(groups[0].unitIds, ['1', '2', '3']);
});

test('view pipeline: search -> filter -> sort, without touching the data', () => {
  const segments = [
    seg({ unitId: 'a', passage: 'Start', protectedSource: 'Alpha', translation: '甲' }),
    seg({ unitId: 'b', passage: 'Room', protectedSource: 'Beta', translation: '' }),
    seg({ unitId: 'c', passage: 'Room', protectedSource: 'Gamma', translation: '丙' }),
  ];
  const before = JSON.stringify(segments);
  assert.deepEqual(E.computeView(segments, { filter: 'todo' }).map((r) => r.s.unitId), ['b']);
  assert.deepEqual(E.computeView(segments, { filter: 'done' }).map((r) => r.s.unitId), ['a', 'c']);
  assert.deepEqual(E.computeView(segments, { query: 'room' }).map((r) => r.s.unitId), ['b', 'c']);
  assert.deepEqual(E.computeView(segments, { sort: 'todo' }).map((r) => r.s.unitId), ['b', 'a', 'c']);
  // passages: Room, Room, Start -> Room entries first, stable within the tie.
  assert.deepEqual(E.computeView(segments, { sort: 'passage' }).map((r) => r.s.unitId), ['b', 'c', 'a']);
  assert.deepEqual(E.computeView(segments, { filter: 'term', term: 'Gamma' }).map((r) => r.s.unitId), ['c']);
  assert.equal(JSON.stringify(segments), before, 'view pipeline must not mutate data');
});

test('view pipeline: status/issue/duplicate/conflict filters', () => {
  const segments = [
    seg({ unitId: 'a', protectedSource: 'X', translation: 'x', status: 'proofread' }),
    seg({ unitId: 'b', protectedSource: 'X', translation: 'y', status: 'reviewed' }),
    seg({ unitId: 'c', protectedSource: 'Y', translation: 'z', status: 'flagged' }),
    seg({ unitId: 'd', protectedSource: 'Y', translation: '', status: 'unmarked' }),
  ];
  const issues = new Map([['b', [{ severity: 'error' }]], ['c', [{ severity: 'info' }]]]);
  const dups = new Set(['a', 'b', 'c', 'd']); // both X vs Y -> divergent group members
  assert.deepEqual(E.computeView(segments, { filter: 'proofread' }).map((r) => r.s.unitId), ['a']);
  assert.deepEqual(E.computeView(segments, { filter: 'reviewed' }).map((r) => r.s.unitId), ['b']);
  assert.deepEqual(E.computeView(segments, { filter: 'flagged' }).map((r) => r.s.unitId), ['c']);
  assert.deepEqual(E.computeView(segments, { filter: 'issues', issuesByUnit: issues }).map((r) => r.s.unitId), ['b'], 'info-only issues are not counted');
  assert.deepEqual(E.computeView(segments, { filter: 'duplicate', duplicateUnits: dups }).map((r) => r.s.unitId), ['a', 'b', 'c', 'd']);
  assert.deepEqual(E.computeView(segments, { filter: 'conflict', conflictUnits: new Set(['c']) }).map((r) => r.s.unitId), ['c']);
});

test('stats: translated rule is trim-non-empty; statuses bucket independently', () => {
  const segments = [
    seg({ unitId: 'a', translation: '甲', status: 'reviewed' }),
    seg({ unitId: 'b', translation: '  ', status: 'proofread' }),
    seg({ unitId: 'c', translation: '', status: 'flagged' }),
    seg({ unitId: 'd', translation: 'raw==source' }),
  ];
  const stats = E.statusStats(segments, new Map([['d', [{ severity: 'error' }]]]));
  assert.deepEqual(
    { total: stats.total, translated: stats.translated, untranslated: stats.untranslated, percent: stats.percent },
    { total: 4, translated: 2, untranslated: 2, percent: 50 },
  );
  assert.equal(stats.reviewed, 1);
  assert.equal(stats.proofread, 1);
  assert.equal(stats.flagged, 1);
  assert.equal(stats.issues, 1);
});

test('handoff plan: fill fills blanks only, overwrite replaces conflicts, keep never mutates', () => {
  const current = [
    seg({ unitId: 'a', protectedSource: 'S', translation: '' }),
    seg({ unitId: 'b', protectedSource: 'S', translation: 'mine' }),
    seg({ unitId: 'c', protectedSource: 'S', translation: 'same' }),
  ];
  const incoming = new Map([['a', 'new-a'], ['b', 'other-b'], ['c', 'same']]);

  const fill = E.planHandoff(current, incoming, 'fill');
  assert.deepEqual(fill.changes.map((c) => c.unitId), ['a']);
  assert.equal(fill.conflicts.length, 1);
  assert.equal(fill.conflicts[0].unitId, 'b');

  const preview = E.planHandoff(current, incoming, 'preview');
  assert.deepEqual(preview.changes.map((c) => c.unitId), ['a'], 'preview still plans blanks; conflicts resolved by UI');
  assert.equal(preview.conflicts.length, 1);

  const overwrite = E.planHandoff(current, incoming, 'overwrite');
  assert.deepEqual(overwrite.changes.map((c) => c.unitId).sort(), ['a', 'b']);
  assert.equal(overwrite.conflicts.length, 0);

  const keep = E.planHandoff(current, incoming, 'keep');
  assert.deepEqual(keep.changes.map((c) => c.unitId), ['a'], 'keep is non-destructive: blanks only, conflicts kept');
  assert.equal(keep.stats.identical, 1);
});

test('migration: A/B/C/D classification with no false auto-apply', () => {
  const oldEntries = [
    { unitId: '1', protectedSource: 'Line one.', translation: '第一行。' },   // A unchanged + safe (new blank)
    { unitId: '2', protectedSource: 'Old two.', translation: '旧二。' },       // C id same, source changed
    { unitId: '7', protectedSource: 'Moved line.', translation: '移动行。' },  // B unique source match, id differs
    { unitId: '8', protectedSource: 'Ambig.', translation: '甲。' },
    { unitId: '9', protectedSource: 'Ambig.', translation: '乙。' },           // ambiguous source
    { unitId: '10', protectedSource: 'Gone.', translation: '已删。' },         // deleted
  ];
  const newSegments = [
    seg({ unitId: '1', protectedSource: 'Line one.', translation: '' }),
    seg({ unitId: '2', protectedSource: 'New two.', translation: '' }),
    seg({ unitId: '3', protectedSource: 'Brand new.', translation: '' }),
    seg({ unitId: '7x', protectedSource: 'Moved line.', translation: '' }),
    seg({ unitId: '8x', protectedSource: 'Ambig.', translation: '' }),
    seg({ unitId: '8y', protectedSource: 'Ambig.', translation: '' }),
  ];
  const plan = E.planMigration(oldEntries, newSegments);
  assert.deepEqual(plan.safe.map((x) => x.unitId), ['1']);
  assert.equal(plan.suggestions.length, 1);
  assert.equal(plan.suggestions[0].unitId, '7x');
  assert.deepEqual(plan.modified.map((x) => x.unitId), ['2']);
  assert.ok(plan.ambiguous.length >= 1, 'shared source is ambiguous');
  assert.deepEqual(plan.added.map((x) => x.unitId), ['3']);
  assert.deepEqual(plan.deleted.map((x) => x.unitId).sort(), ['10']);
  assert.equal(plan.counts.safe, 1);
});

test('migration: never auto-migrates a modified (same id, changed source) entry', () => {
  const oldEntries = [{ unitId: '1', protectedSource: 'Before.', translation: '之前。' }];
  const plan = E.planMigration(oldEntries, [seg({ unitId: '1', protectedSource: 'After.', translation: '' })]);
  assert.equal(plan.safe.length, 0);
  assert.deepEqual(plan.modified.map((x) => x.unitId), ['1']);
});

test('duplicate fill: a multi-translation group is skipped, never auto-filled', () => {
  const segments = [
    seg({ unitId: '1', protectedSource: 'Same.', translation: '译文。' }),
    seg({ unitId: '2', protectedSource: 'Same.', translation: '' }),
    seg({ unitId: '3', protectedSource: 'Same.', translation: '另一译文。' }),
  ];
  const groups = E.duplicateGroups(segments);
  const plan = E.planDuplicateFill(groups);
  assert.deepEqual(plan.changes, [], 'ambiguous group must not be filled without an explicit choice');
  assert.equal(plan.divergentGroups, 1);
  assert.equal(plan.skippedDivergent, 1);
  assert.equal(plan.ambiguousMembers, 1);
});

test('duplicate fill: a uniform group fills blanks, and an explicit choice resolves ambiguity', () => {
  const uniform = [
    seg({ unitId: '1', protectedSource: 'Same.', translation: '译文。' }),
    seg({ unitId: '2', protectedSource: 'Same.', translation: '' }),
  ];
  const p1 = E.planDuplicateFill(E.duplicateGroups(uniform));
  assert.deepEqual(p1.changes.map((c) => c.unitId), ['2']);
  assert.equal(p1.changes[0].after, '译文。');

  const divergent = [
    seg({ unitId: '1', protectedSource: 'Same.', translation: '甲' }),
    seg({ unitId: '2', protectedSource: 'Same.', translation: '' }),
    seg({ unitId: '3', protectedSource: 'Same.', translation: '乙' }),
  ];
  const groups = E.duplicateGroups(divergent);
  assert.equal(E.planDuplicateFill(groups).changes.length, 0);
  const chosen = E.planDuplicateFill(groups, { choices: new Map([[groups[0].key, '乙']]) });
  assert.deepEqual(chosen.changes.map((c) => c.unitId), ['2']);
  assert.equal(chosen.changes[0].after, '乙');
  assert.equal(chosen.skippedDivergent, 0);
});

test('pageWindow: total 1/5/9 shows all pages; 10/100 centres the current page', () => {
  const r = (a, b) => { const o = []; for (let p = a; p <= b; p += 1) o.push(p); return o; };
  assert.deepEqual(E.pageWindow(1, 1, 9), [1]);
  assert.deepEqual(E.pageWindow(3, 5, 9), r(1, 5));
  assert.deepEqual(E.pageWindow(5, 9, 9), r(1, 9));
  // total 10: current centred where possible, clamped at both ends
  assert.deepEqual(E.pageWindow(1, 10, 9), r(1, 9));
  assert.deepEqual(E.pageWindow(2, 10, 9), r(1, 9));
  assert.deepEqual(E.pageWindow(5, 10, 9), r(1, 9));
  assert.deepEqual(E.pageWindow(6, 10, 9), r(2, 10));
  assert.deepEqual(E.pageWindow(10, 10, 9), r(2, 10));
  // total 100: a 9-wide window centred on the current page
  assert.deepEqual(E.pageWindow(1, 100, 9), r(1, 9));
  assert.deepEqual(E.pageWindow(50, 100, 9), r(46, 54));
  assert.deepEqual(E.pageWindow(100, 100, 9), r(92, 100));
  assert.deepEqual(E.pageWindow(99, 100, 9), r(92, 100));
  assert.equal(E.pageWindow(50, 100, 9).length, 9);
});

test('migration: an entry without a protected source is never matched by source', () => {
  const plan = E.planMigration(
    [{ unitId: 'old', translation: 'x' }],
    [seg({ unitId: 'new', protectedSource: 'Brand.', translation: '' })],
  );
  assert.deepEqual(plan.added.map((x) => x.unitId), ['new']);
  assert.equal(plan.suggestions.length, 0);
});

test('project: validates format/version and sanitizes records', () => {
  assert.equal(E.isProject({ format: 'dolp-kit-editor-project', version: 1 }), true);
  assert.equal(E.isProject({ format: 'something-else', version: 1 }), false);
  const v = E.projectValidate({
    format: 'dolp-kit-editor-project',
    version: 1,
    records: { u1: { status: 'reviewed', note: 'ok' }, u2: { status: 'bogus', note: 5 }, bad: null },
    ignoredTerms: ['u1\u0001Robin', 7],
  });
  assert.equal(v.ok, true);
  assert.deepEqual(v.records.u1, { status: 'reviewed', note: 'ok' });
  assert.deepEqual(v.records.u2, { status: 'unmarked', note: '' });
  assert.equal(v.records.bad, undefined);
  assert.deepEqual(v.ignoredTerms, ['u1\u0001Robin']);
});

test('project: rejects an unrelated JSON document', () => {
  assert.equal(E.projectValidate({ hello: 'world' }).ok, false);
  assert.equal(E.projectValidate(null).ok, false);
});
