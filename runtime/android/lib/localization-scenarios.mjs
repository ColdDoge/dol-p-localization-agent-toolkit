/*
 * Runtime localization scenario registry.
 *
 * A scenario is one screen the harness visits. It carries no target-language
 * or source-language strings of its own: expectations are supplied by the
 * caller (see `localization_smoke_build.mjs`) and are validated against the
 * user's localization state and the target source before a run.
 *
 * Tier A  asserts the target text rendered AND the source string is gone.
 * Tier C  asserts only that the screen still renders and still works; residual
 *         source text is expected and never a defect.
 *
 * Scenario file shape (JSON):
 *
 *   {
 *     "schemaVersion": "1.0.0",
 *     "kind": "localization-smoke-scenarios",
 *     "scenarios": [ { id, tier, label, passage|overlay, require[],
 *                      expectTargetAny[]?, forbidSourceAny[]?, interaction?,
 *                      prelude[]?, recordLength?, captureSidebar? } ],
 *     "levels": { "smoke": [id...], "regression": [id...], "exhaustive": [id...] }
 *   }
 */

import fs from 'node:fs';

export const SCENARIOS_SCHEMA_VERSION = '1.0.0';
export const SCENARIOS_KIND = 'localization-smoke-scenarios';
export const LOCALIZATION_TIERS = ['A', 'C'];
export const LOCALIZATION_LEVELS_NAMES = ['smoke', 'regression', 'exhaustive'];

export function loadScenarioSpec(file) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (spec.kind !== SCENARIOS_KIND) throw new Error(`not a scenario file: kind=${spec.kind}`);
  const major = String(spec.schemaVersion || '').split('.')[0];
  if (major !== SCENARIOS_SCHEMA_VERSION.split('.')[0]) throw new Error(`unsupported scenario schemaVersion ${spec.schemaVersion}`);
  if (!Array.isArray(spec.scenarios)) throw new Error('scenario file has no scenarios[]');
  return spec;
}

/** Defensive shape check used by offline tests and the harness preflight. */
export function validateScenario(scenario) {
  const problems = [];
  if (!scenario || typeof scenario !== 'object') return ['scenario is not an object'];
  const blocked = scenario.blocked === true;
  if (!scenario.id) problems.push('missing id');
  if (!LOCALIZATION_TIERS.includes(scenario.tier)) problems.push(`bad tier ${scenario.tier}`);
  if (!scenario.label) problems.push('missing label');
  if (!scenario.passage && !scenario.overlay) problems.push('needs passage or overlay');
  if (!Array.isArray(scenario.require) || scenario.require.length === 0) problems.push('missing require[]');
  if (scenario.tier === 'A' && !blocked) {
    if (!Array.isArray(scenario.expectTargetAny) || scenario.expectTargetAny.length === 0) problems.push('tier A needs expectTargetAny[]');
    if (!Array.isArray(scenario.forbidSourceAny)) problems.push('tier A needs forbidSourceAny[]');
  }
  if (scenario.tier === 'C' && !blocked && (scenario.expectTargetAny || scenario.forbidSourceAny)) {
    problems.push('tier C must not assert translated text');
  }
  if (scenario.interaction && scenario.interaction.kind === 'search') {
    if (!scenario.interaction.input || !scenario.interaction.value) problems.push('search interaction needs input + value');
  }
  if (scenario.prelude !== undefined) {
    if (!Array.isArray(scenario.prelude) || scenario.prelude.some((s) => typeof s !== 'string' || !s.startsWith('<<'))) {
      problems.push('prelude must be an array of <<widget>> strings');
    }
  }
  return problems;
}

/**
 * A blocked scenario cannot be exercised safely on the current target (it
 * needs game state the disposable test session does not establish). It is
 * recorded as NOT COVERED and never run, so it can never be counted as a pass.
 */
export function isBlockedScenario(scenario) {
  return Boolean(scenario && scenario.blocked === true);
}

/** Blocked scenarios, with their reason, for the report's "not covered" list. */
export function blockedScenarios(spec) {
  return (spec.scenarios || [])
    .filter(isBlockedScenario)
    .map((s) => ({ id: s.id, reason: s.blockedReason || null, passage: s.passage ?? null }));
}

export function getScenario(spec, id) {
  return (spec.scenarios || []).find((s) => s.id === id) || null;
}

/** Resolve scenario objects for one level, preserving registry order. */
export function scenariosForLevel(spec, level) {
  const ids = (spec.levels && spec.levels[level]) || (spec.scenarios || []).map((s) => s.id);
  if (!ids) throw new Error(`unknown localization level "${level}"`);
  return ids.map((id) => {
    const scenario = getScenario(spec, id);
    if (!scenario) throw new Error(`level ${level} references unknown scenario ${id}`);
    return scenario;
  });
}

/** All passages the smoke pack must cover. */
export function scenarioPassages(spec) {
  return [...new Set((spec.scenarios || []).filter((s) => !isBlockedScenario(s)).map((s) => s.passage).filter(Boolean))];
}
