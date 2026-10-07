/*
 * End-to-end example: inventory -> kit export -> import -> qa -> strict/partial build.
 *
 * Uses a synthetic, non-Chinese pseudo-language ("append x to each word") so the
 * example proves the toolkit is language-agnostic and ships no game text or real
 * translation. All outputs land in examples/_work/ (git-ignored).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadStory } from '../core/src/lib/workspace.mjs';
import { indexStory } from '../core/src/lib/story.mjs';
import { buildInventory } from '../core/src/lib/inventory.mjs';
import { restoreProtected } from '../core/src/lib/protect.mjs';
import { runKitExport, writeKit, runKitImport } from '../core/src/lib/kit-run.mjs';
import { writeState } from '../core/src/lib/localization-state.mjs';
import { classifyCoverage, markUnresolved, strictPass } from '../core/src/lib/coverage.mjs';
import { buildPack } from '../core/src/lib/builder.mjs';
import { validateLocalizationSource } from '../core/src/lib/localization-source.mjs';
import { recordsFromLocalizationSource } from '../core/src/lib/localization-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORY = path.join(HERE, 'story', 'index.html');
const OUT = path.join(HERE, '_work');

function pseudo(protectedSource) {
  return String(protectedSource).replace(/[A-Za-z]+/g, (w) => `${w}x`);
}

const story = loadStory(STORY);
const { byName } = indexStory(story);
const inv = buildInventory(story, { sourceVersion: 'example-1.0' });
const byUnitId = new Map(inv.units.map((u) => [u.unitId, u]));
fs.mkdirSync(OUT, { recursive: true });

console.log(`inventory: ${inv.units.length} units`);

// 0) demonstrate auditing a hand-written localization source
const sourceEntries = inv.units.map((u) => ({
  passage: u.passage,
  from: u.rawText,
  to: (u.protectedText ? restoreProtected(pseudo(u.protectedText), u.placeholders) : pseudo(u.rawText)),
}));
const validated = validateLocalizationSource([{ file: 'example-source', entries: sourceEntries }], story);
const fromSource = recordsFromLocalizationSource({ resolved: validated.resolved, units: inv.units, story });
const audit = classifyCoverage({ units: inv.units, records: new Map(fromSource.records.map((r) => [r.unitId, r])) });
console.log(`audit(existing localization): ${JSON.stringify(audit.counts)}`);

// 1) export the full kit
const exported = runKitExport({ story, byName, units: inv.units, byUnitId, records: new Map(), scope: 'all', sourceVersion: 'example-1.0', targetLanguage: 'xx-pseudo' });
writeKit(exported.kit, path.join(OUT, 'kit.zip'));
console.log(`kit export: ${exported.exported} segments -> ${path.relative(HERE, path.join(OUT, 'kit.zip'))}`);

// 2) fill it in the pseudo-language and import it back
const filled = exported.segments.map((s) => ({ ...s, translation: pseudo(s.protectedSource) }));
writeKit({ manifest: exported.kit.manifest, segments: filled, glossary: [] }, path.join(OUT, 'kit-filled.zip'));
const imported = runKitImport({ story, byUnitId, kitZipPath: path.join(OUT, 'kit-filled.zip') });
console.log(`kit import: accepted=${imported.accepted.length} rejected=${imported.rejected.length} deferred=${imported.deferred.length}`);

// 3) persist the localization state and run the build
const records = new Map(imported.records.map((r) => [r.unitId, r]));
const statePath = path.join(OUT, 'state.jsonl');
writeState(statePath, records);

const report = classifyCoverage({ units: inv.units, records });
const strictUnits = inv.units.filter((u) => (report.byUnitId.get(u.unitId) || {}).state === 'translated-valid');
const strictBuild = buildPack({ story, byName, units: strictUnits, translations: records });
markUnresolved(report, strictBuild.unresolved);
const strictOk = strictPass(report.counts);
if (strictOk) {
  fs.writeFileSync(path.join(OUT, 'pack-strict.mod.zip'), strictBuild.zipBuf);
  console.log(`build(strict): BUILT ${strictBuild.entryCount} entries -> ${path.relative(HERE, path.join(OUT, 'pack-strict.mod.zip'))}`);
} else {
  console.log(`build(strict): FAILED coverage=${JSON.stringify(report.counts)}`);
}

// 4) drop one unit and show a partial build still works
const firstId = inv.units[0].unitId;
records.delete(firstId);
const partialReport = classifyCoverage({ units: inv.units, records });
const partialUnits = inv.units.filter((u) => (partialReport.byUnitId.get(u.unitId) || {}).state === 'translated-valid');
const partialBuild = buildPack({ story, byName, units: partialUnits, translations: records });
fs.writeFileSync(path.join(OUT, 'pack-partial.mod.zip'), partialBuild.zipBuf);
console.log(`build(partial): PARTIAL ${partialBuild.entryCount} entries, untranslated=${partialReport.counts.untranslated} -> ${path.relative(HERE, path.join(OUT, 'pack-partial.mod.zip'))}`);

console.log('\nexample complete. Outputs are under examples/_work/ (git-ignored).');
