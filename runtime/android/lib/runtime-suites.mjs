/*
 * Runtime suite registry.
 *
 * v1 ships a single self-contained family: `localization`. It has one level
 * scale (smoke / regression / exhaustive) and no dependency on any other game
 * family.
 */

export const QA_LEVELS = ['smoke', 'regression', 'exhaustive'];

export const RUNTIME_SUITES = {
  localization: {
    key: 'localization',
    label: 'Runtime localization smoke (fixed scenes)',
    navigation: 'localization',
    levels: QA_LEVELS,
  },
};

export const SUITE_KEYS = Object.keys(RUNTIME_SUITES);

export function isKnownLevel(level) {
  return QA_LEVELS.includes(level);
}

export function isKnownFamily(family) {
  return Object.prototype.hasOwnProperty.call(RUNTIME_SUITES, family);
}

export function defaultLevel() {
  return 'exhaustive';
}
