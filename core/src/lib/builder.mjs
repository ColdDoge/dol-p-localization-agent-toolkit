/*
 * Source-agnostic localization pack builder.
 *
 * Takes units that already carry a verified translation, plans ReplacePatcher
 * entries, runs the offline QA (presence / no-op / span / patchability /
 * replay), and returns the pack bytes plus a machine-readable build summary.
 *
 * There is no production loop and no store here: the caller supplies the
 * translations (from the user's localization state). Nothing is read from a
 * private store and no model is called.
 */

import crypto from 'node:crypto';

import { createZip } from './zip.mjs';
import { buildEntries, qaEntries } from './entries.mjs';

export const DEFAULT_PACK_NAME = 'localization-pack';
export const DEFAULT_PACK_VERSION = '1.0.0';

/**
 * Build the pack.
 *
 * @param {object}   args
 * @param {object}   args.story       parsed story ({ sha256, size, passages })
 * @param {Map}      args.byName      passage name -> passage (from indexStory)
 * @param {Array}    args.units       inventory units that should be built
 * @param {Map}      args.translations  unitId -> { translation } (raw target text)
 * @param {boolean}  [args.allowWholePassage]
 * @param {string}   [args.name]
 * @param {string}   [args.packVersion]
 */
export function buildPack({
  story,
  byName,
  units,
  translations,
  allowWholePassage = false,
  name = DEFAULT_PACK_NAME,
  packVersion = DEFAULT_PACK_VERSION,
}) {
  const accepted = [];
  for (const u of units) {
    const rec = translations.get(u.unitId);
    if (!rec) continue;
    accepted.push({ ...u, translation: rec.translation });
  }

  const built = buildEntries(accepted, byName, { allowWholePassage });
  const qa = qaEntries(built.entries, byName);
  const covered = new Set(built.coverage.keys());
  const unresolved = accepted
    .filter((u) => !covered.has(u.unitId))
    .map((u) => ({ unitId: u.unitId, passage: u.passage, reason: 'planner-uncovered' }));

  const boot = {
    name,
    version: packVersion,
    styleFileList: [],
    scriptFileList: [],
    tweeFileList: [],
    imgFileList: [],
    addonPlugin: [{
      modName: 'ReplacePatcher',
      addonName: 'ReplacePatcherAddon',
      modVersion: '^1.0.0',
      params: {
        twee: built.entries.map((e) => ({ passageName: e.passageName, from: e.from, to: e.to, all: e.all })),
      },
    }],
  };

  const zipBuf = createZip([
    { name: 'boot.json', data: `${JSON.stringify(boot, null, 2)}\n` },
    { name: 'README.md', data: packReadme({ story, name, packVersion, entries: built.entries.length }) },
  ]);

  return {
    boot,
    zipBuf,
    sha256: crypto.createHash('sha256').update(zipBuf).digest('hex'),
    bytes: zipBuf.length,
    entries: built.entries,
    entryCount: built.entries.length,
    skipped: built.skipped,
    planner: built.stats,
    coverage: covered,
    unresolved,
    qa: { ok: qa.ok, byCode: qa.byCode, overlaps: qa.overlaps, patchConflicts: qa.patchConflicts, entries: qa.entries },
  };
}

function packReadme({ story, name, packVersion, entries }) {
  return [
    `# ${name} ${packVersion}`,
    '',
    `Target story sha256: ${story.sha256}`,
    `ReplacePatcher entries: ${entries}`,
    '',
    'Built by the DoL/DoLP Localization Agent Toolkit. This pack contains',
    'ReplacePatcher replace pairs only; it ships no game text of its own',
    'beyond the strings the user supplied for localization.',
    '',
  ].join('\n');
}
