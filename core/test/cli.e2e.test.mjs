import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { makeFixture, pseudoProtected } from './helpers/fixture.mjs';
import { runKitExport, writeKit } from '../src/lib/kit-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const RUN = path.join(REPO, 'core', 'src', 'run.mjs');

function cli(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [RUN, ...args], { cwd: REPO, encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
  }
}

function exportFilledKit({ fx, fill }) {
  const res = runKitExport({ story: fx.story, byName: fx.byName, units: fx.units, byUnitId: fx.byUnitId, records: new Map(), scope: 'all', sourceVersion: 'test' });
  const segments = res.segments.map((s) => ({ ...s, translation: fill(s) }));
  const out = path.join(fx.dir, 'kit-filled.zip');
  writeKit({ manifest: res.kit.manifest, segments, glossary: [] }, out);
  return out;
}

test('E2E: export -> import -> strict build (PASS) -> partial build', () => {
  const fx = makeFixture();

  // export (CLI) writes a kit with empty translations
  const kitZip = path.join(fx.dir, 'kit.zip');
  const exp = cli(['kit', 'export', '--story', fx.storyPath, '--output', kitZip, '--scope', 'all', '--source-version', 'test']);
  assert.equal(exp.code, 0, exp.stderr);
  assert.ok(fs.existsSync(kitZip));

  // a filled kit with the pseudo-language
  const filled = exportFilledKit({ fx, fill: (s) => pseudoProtected(s.protectedSource) });

  const statePath = path.join(fx.dir, 'state.jsonl');
  const imp = cli(['kit', 'import', filled, '--story', fx.storyPath, '--out', statePath]);
  assert.equal(imp.code, 0, imp.stderr + imp.stdout);
  assert.ok(fs.existsSync(statePath));

  // strict build should pass and write a pack
  const pack = path.join(fx.dir, 'pack.mod.zip');
  const build = cli(['build', '--story', fx.storyPath, '--state', statePath, '--output', pack, '--mode', 'strict']);
  assert.equal(build.code, 0, build.stderr + build.stdout);
  assert.ok(fs.existsSync(pack));

  // remove one record -> strict build fails and writes NO pack
  const lines = fs.readFileSync(statePath, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(statePath, `${lines.slice(1).join('\n')}\n`);
  const pack2 = path.join(fx.dir, 'pack-strict-fail.mod.zip');
  const strictFail = cli(['build', '--story', fx.storyPath, '--state', statePath, '--output', pack2, '--mode', 'strict']);
  assert.equal(strictFail.code, 1, strictFail.stdout);
  assert.equal(fs.existsSync(pack2), false);

  // partial build still writes a pack and marks itself partial
  const reportFile = path.join(fx.dir, 'partial-report.json');
  const partial = cli(['build', '--story', fx.storyPath, '--state', statePath, '--output', path.join(fx.dir, 'pack-partial.mod.zip'), '--mode', 'partial', '--report', reportFile]);
  assert.equal(partial.code, 0, partial.stderr + partial.stdout);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.partial, true);
  assert.ok(report.counts.untranslated >= 1);
});

test('E2E: a structure-breaking translation is rejected at import', () => {
  const fx = makeFixture();
  const target = fx.units.find((u) => (u.placeholders || []).length > 0);
  assert.ok(target, 'fixture must contain a unit with a placeholder');
  const filled = exportFilledKit({
    fx,
    fill: (s) => (s.unitId === target.unitId ? 'broken' : pseudoProtected(s.protectedSource)),
  });
  const statePath = path.join(fx.dir, 'state.jsonl');
  const reportFile = path.join(fx.dir, 'import-report.json');
  const imp = cli(['kit', 'import', filled, '--story', fx.storyPath, '--out', statePath, '--report', reportFile, '--require-complete']);
  assert.equal(imp.code, 1, imp.stdout);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.ok(report.rejected.length >= 1, JSON.stringify(report));
});

test('E2E: audit classifies missing text', () => {
  const fx = makeFixture();
  const statePath = path.join(fx.dir, 'empty.jsonl');
  fs.writeFileSync(statePath, '');
  const reportFile = path.join(fx.dir, 'audit-report.json');
  const audit = cli(['audit', '--story', fx.storyPath, '--state', statePath, '--report', reportFile]);
  assert.equal(audit.code, 1, audit.stdout);
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.classifications.missing, fx.units.length);
  assert.equal(report.strictPass, false);
});

test('CLI: --help exits 0 and lists the public commands', () => {
  const help = cli(['--help']);
  assert.equal(help.code, 0, help.stderr);
  for (const cmd of ['inventory', 'audit', 'kit export', 'kit import', 'build', 'qa', 'migrate', 'selftest']) {
    assert.ok(help.stdout.includes(cmd), `help should mention: ${cmd}`);
  }
  assert.ok(!/pilot|Phase 2|production\/default/.test(help.stdout));
});

test('CLI: an unknown command exits non-zero without a stack trace', () => {
  const bad = cli(['frobnicate']);
  assert.equal(bad.code, 2, bad.stdout);
  assert.ok(!/\bat .*\.mjs:\d+/.test(bad.stderr), 'no internal stack trace on a bad command');
});
