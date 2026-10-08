/*
 * Page-side scripts for the runtime localization smoke test.
 *
 * Everything here runs inside the game WebView. All game access goes through
 * the documented SugarCube surfaces:
 *   - SugarCube.Engine.play(passage)
 *   - wikifier("overlayReplace", '"options"')   (the game's own overlay API)
 *   - Wikifier.wikifyEval('<<...>>')             (same call the debug menu uses)
 *   - closeOverlay()
 *
 * The scripts are read-only with respect to storage: they only touch in-memory
 * test state, always set `$options.autosaveDisabled` first, and never call a
 * save API.
 *
 * Assertions are language-agnostic: a tier-A scenario requires at least one
 * `expectTargetAny` string to be present and no `forbidSourceAny` string to be
 * present. Script-ratio / word counters are diagnostics only and never fail a
 * scenario.
 */

/** Marker embedded in every generated script so offline tests can recognise it. */
export const LOCALIZATION_MARKER = 'TOOLKIT-LOCALIZATION-SMOKE';

const PREAMBLE = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const note = (s) => out.steps.push(s);

  if (!(window.SugarCube && SugarCube.Story && State.variables)) {
    out.fatal = 'game-not-ready';
    return out;
  }

  // Disable autosave for this disposable session before anything can navigate.
  try { if (State.variables.options) State.variables.options.autosaveDisabled = true; } catch {}
  try { State.variables.debug = 1; } catch {}
  // Leave the game's own developer diagnostics off (this option's shipped
  // default is "t"). Forcing "f" turns on the game's *state* checks — its NaN
  // scan over every variable, undefined-print reporting — which fire on a fresh
  // cheat session because combat variables start at zero. Those are page errors
  // unrelated to the pack under test: every stateful scene reported
  // js-errors, and the post-cleanup restore check could never see
  // bodyErrors === 0. Real breakage still shows — a malformed macro or tag
  // raises a SugarCube error regardless of this option.
  try { if (State.variables.options) State.variables.options.debugdisable = 't'; } catch {}
  try { if (typeof closeOverlay === 'function') closeOverlay(); } catch {}

  // Establish one disposable cheat session per page load. The "a run is under
  // way" flag is game-specific; it is supplied via SPEC.readyFlag.
  if (!window.__toolkitSmokeReady) {
    if (SPEC.entryPassage && Number(State.variables[SPEC.readyFlag]) !== 0) {
      SugarCube.Engine.play(SPEC.entryPassage);
      await sleep(900);
      if (SPEC.setupPassage) { SugarCube.Engine.play(SPEC.setupPassage); await sleep(1700); }
      note('session:setup');
    }
    try { Wikifier.wikifyEval(SPEC.cheatWidget); note('session:cheat'); }
    catch (e) { note('session:cheat-failed'); }
    window.__toolkitSmokeReady = true;
  }
`;

const READERS = `
  const passageText = () => {
    const nodes = document.querySelectorAll('#passages .passage');
    const el = nodes.length ? nodes[nodes.length - 1] : document.querySelector('#passages');
    return (el ? el.textContent : '').replace(/\\s+/g, ' ').trim();
  };
  const errors = () => [...document.querySelectorAll('.error')]
    .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').slice(0, 200));
  const leaksOf = (text) => ({
    rawMacro: /<<[^>]*?>>/.test(text),
    placeholder: /\\u27E6\\d+\\u27E7/.test(text),
    unresolvedLink: /\\[\\[|\\]\\]/.test(text),
    entityNoise: /&lt;&lt;|&amp;lt;|&amp;gt;/.test(text),
    templateLiteral: /\\$\\{[^}]*\\}/.test(text),
    dollarVariable: /\\$[A-Za-z_]/.test(text),
  });
  // Informational only. Non-ASCII ratio and common-language word counts let a
  // human see how much of the screen is still source text; they never gate.
  const diagnosticsOf = (text) => {
    const letters = text.replace(/[^\\p{L}]/gu, '');
    const nonAscii = (text.match(/[^\\x00-\\x7F]/g) || []).length;
    const words = text.split(/\\s+/).filter(Boolean);
    let nonAsciiRatio = null;
    try { const re = new RegExp('[^\\\\x00-\\\\x7F]', 'g'); nonAsciiRatio = text.length ? (text.match(re) || []).length / text.length : null; } catch {}
    return { chars: text.length, nonAscii, nonAsciiRatio, letters: letters.length, words: words.length };
  };
`;

const DEFAULT_GAME_HOOKS = {
  entryPassage: 'Start',
  setupPassage: 'Start2',
  readyFlag: 'intro',
  cheatWidget: '<<cheatStart>>',
};

/** Build the one-shot page script for a single scenario. */
export function scriptLocalizationScenario(scenario, hooks = {}) {
  const g = { ...DEFAULT_GAME_HOOKS, ...hooks };
  const spec = {
    id: scenario.id,
    tier: scenario.tier,
    passage: scenario.passage ?? null,
    overlay: scenario.overlay ?? null,
    require: scenario.require ?? [],
    expectTargetAny: scenario.expectTargetAny ?? [],
    forbidSourceAny: scenario.forbidSourceAny ?? [],
    prelude: scenario.prelude ?? [],
    interaction: scenario.interaction ?? null,
    recordLength: Boolean(scenario.recordLength),
    captureSidebar: Boolean(scenario.captureSidebar),
    entryPassage: g.entryPassage,
    setupPassage: g.setupPassage,
    readyFlag: g.readyFlag,
    cheatWidget: g.cheatWidget,
  };
  return `/*${LOCALIZATION_MARKER} id=${scenario.id}*/
(async () => {
  const SPEC = ${JSON.stringify(spec)};
  const out = { id: SPEC.id, tier: SPEC.tier, steps: [], fatal: null };
${PREAMBLE}
${READERS}
  if (Array.isArray(SPEC.prelude) && SPEC.prelude.length) {
    try {
      try { Wikifier.wikifyEval('<<endcombat>>'); } catch {}
      for (const raw of SPEC.prelude) { Wikifier.wikifyEval(raw); note('prelude:' + String(raw).slice(0, 24)); }
      await sleep(350);
    } catch (error) {
      out.fatal = 'prelude:' + String(error && error.message || error);
      out.bodyErrors = errors().length;
      out.errorTexts = errors();
      return out;
    }
  }
  try {
    if (SPEC.overlay) {
      wikifier('overlayReplace', JSON.stringify(SPEC.overlay));
      await sleep(800);
      out.navigation = { kind: 'overlay', key: SPEC.overlay };
    } else {
      await Promise.resolve(SugarCube.Engine.play(SPEC.passage));
      await sleep(1000);
      out.navigation = { kind: 'passage', key: SPEC.passage, landed: String(State.passage) };
    }
  } catch (error) {
    out.fatal = 'navigation:' + String(error && error.message || error);
    out.bodyErrors = errors().length;
    out.errorTexts = errors();
    return out;
  }

  let text = passageText();
  const requireMissing = SPEC.require.filter((sel) => !document.querySelector(sel));
  const leaks = leaksOf(text);

  if (SPEC.overlay) {
    const ov = document.getElementById('customOverlay');
    const content = document.getElementById('customOverlayContent');
    const title = document.getElementById('customOverlayTitle');
    out.overlay = ov ? {
      open: !ov.classList.contains('hidden'),
      dataOverlay: ov.getAttribute('data-overlay') || null,
      titleLength: title ? (title.textContent || '').trim().length : 0,
      contentLength: content ? (content.textContent || '').trim().length : 0,
    } : null;
  }

  out.requireMissing = requireMissing;
  out.bodyErrors = errors().length;
  out.errorTexts = errors();
  out.leaks = leaks;
  out.diagnostics = diagnosticsOf(text);
  out.textLength = text.length;
  out.textSample = text.slice(0, 400);

  if (SPEC.tier === 'A') {
    out.targetFound = SPEC.expectTargetAny.filter((s) => text.includes(s));
    out.targetMissing = SPEC.expectTargetAny.filter((s) => !text.includes(s));
    out.sourcePresent = SPEC.forbidSourceAny.filter((s) => text.includes(s));
  }

  if (SPEC.captureSidebar) {
    const cap = document.querySelector('#storyCaptionContent');
    out.sidebar = { present: Boolean(cap), length: cap ? (cap.textContent || '').length : 0 };
  }

  if (SPEC.interaction) {
    const act = SPEC.interaction;
    try {
      if (act.kind === 'search') {
        let clicked = null;
        if (act.clickText || act.runWidget) {
          const candidates = [...document.querySelectorAll('a, button')];
          const needle = String(act.clickText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          const target = needle ? candidates.find((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase().includes(needle)) : null;
          if (target) { clicked = 'link'; target.click(); await sleep(1300); }
          else if (act.runWidget) { Wikifier.wikifyEval(act.runWidget); clicked = 'widget'; await sleep(1300); }
        }
        const input = document.querySelector(act.input);
        const before = act.countSelector ? document.querySelectorAll(act.countSelector).length : null;
        if (input) {
          input.value = act.value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(1400);
          text = passageText();
        }
        const after = act.countSelector ? document.querySelectorAll(act.countSelector).length : null;
        out.interaction = { kind: 'search', clicked, applied: Boolean(input), before, after, narrowed: after !== null ? after <= before : null };
      } else if (act.kind === 'endcombat') {
        const before = String(State.passage);
        Wikifier.wikifyEval('<<endcombat>>');
        await sleep(600);
        out.interaction = { kind: 'endcombat', from: before, to: String(State.passage) };
      } else {
        out.interaction = { kind: act.kind, applied: false, note: 'unknown interaction kind' };
      }
    } catch (error) {
      out.interaction = { kind: act.kind, applied: false, error: String(error && error.message || error) };
    }
    out.bodyErrorsAfterInteraction = errors().length;
  }

  if (SPEC.recordLength) out.finalTextLength = text.length;
  return out;
})()`;
}

/**
 * Leave the disposable session in a clean, error-free state. SugarCube restores
 * its session across a reload, so land the debug start page to keep the
 * post-cleanup resumption boring.
 */
export function scriptLocalizationTeardown(hooks = {}) {
  const g = { ...DEFAULT_GAME_HOOKS, ...hooks };
  return `/*${LOCALIZATION_MARKER} id=teardown*/
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { id: 'teardown', steps: [], fatal: null };
  try { Wikifier.wikifyEval('<<endcombat>>'); out.steps.push('endcombat'); }
  catch (e) { out.steps.push('endcombat-failed'); }
  try { SugarCube.Engine.play(${JSON.stringify(g.setupPassage || 'Start2')}); out.steps.push('landed'); }
  catch (e) { out.fatal = 'play:' + String(e && e.message || e); }
  await sleep(500);
  out.passage = String(State.passage);
  out.bodyErrors = document.querySelectorAll('.error').length;
  return out;
})()`;
}

/** Read-only, side-effect-free snapshot of the current passage. */
export function scriptLocalizationSnapshot() {
  return `/*${LOCALIZATION_MARKER} id=snapshot*/
(() => {
  const out = { steps: [], fatal: null };
  const nodes = document.querySelectorAll('#passages .passage');
  const el = nodes.length ? nodes[nodes.length - 1] : document.querySelector('#passages');
  const text = (el ? el.textContent : '').replace(/\\s+/g, ' ').trim();
${READERS}
  return {
    passage: String(State.passage),
    bodyErrors: document.querySelectorAll('.error').length,
    textLength: text.length,
    textSample: text.slice(0, 400),
    leaks: leaksOf(text),
    diagnostics: diagnosticsOf(text),
  };
})()`;
}

/**
 * Pure evaluator: turn a raw per-scenario result into a verdict.
 *
 * Rules:
 *   - any scenario: navigation fatal / JS error / missing required container
 *     / leak in the rendered text -> failure
 *   - tier A: at least one `expectTargetAny` present AND no `forbidSourceAny`
 *     present -> otherwise failure
 *   - tier C: residual source text is expected; the interaction (if any) must
 *     have applied and must not have raised
 */
export function evaluateScenarioResult(scenario, result) {
  const failures = [];
  if (!result || typeof result !== 'object') return { ok: false, failures: ['no-result'] };
  if (result.fatal) failures.push(String(result.fatal));
  if (result.error && !result.fatal) failures.push(String(result.error));
  if (Number(result.bodyErrors) > 0) failures.push(`js-errors:${result.bodyErrors}`);
  if (Number(result.bodyErrorsAfterInteraction) > 0) failures.push(`js-errors-after-interaction:${result.bodyErrorsAfterInteraction}`);
  if (Array.isArray(result.requireMissing) && result.requireMissing.length) failures.push(`missing-selectors:${result.requireMissing.join('|')}`);
  const leaks = result.leaks || {};
  for (const key of ['rawMacro', 'placeholder', 'unresolvedLink', 'entityNoise', 'templateLiteral']) {
    if (leaks[key]) failures.push(`leak:${key}`);
  }
  if (scenario.tier === 'A') {
    if (!Array.isArray(result.targetFound) || result.targetFound.length === 0) failures.push('no-expected-target-text');
    if (Array.isArray(result.sourcePresent) && result.sourcePresent.length) failures.push(`source-still-present:${result.sourcePresent.join('|')}`);
  }
  if (scenario.overlay) {
    const ov = result.overlay;
    if (!ov) failures.push('overlay-not-found');
    else {
      if (!ov.open) failures.push('overlay-not-open');
      if (!(Number(ov.contentLength) > 0)) failures.push('overlay-empty');
      if (ov.dataOverlay && ov.dataOverlay !== scenario.overlay) failures.push(`overlay-mismatch:${ov.dataOverlay}`);
    }
  }
  if (scenario.interaction && scenario.interaction.kind === 'search') {
    const it = result.interaction || {};
    if (it.error) failures.push(`interaction-error:${it.error}`);
    else if (!it.applied) failures.push('interaction-not-applied');
    else if (it.narrowed === false) failures.push('filter-did-not-narrow');
  }
  if (scenario.interaction && scenario.interaction.kind === 'endcombat') {
    const it = result.interaction || {};
    if (it.error) failures.push(`interaction-error:${it.error}`);
  }
  return { ok: failures.length === 0, failures };
}

/** Aggregate the whole localization family run. Pure. */
export function summarizeLocalization(scenarios, results) {
  const byId = new Map((results || []).map((r) => [r && r.id, r]));
  const entries = scenarios.map((scenario) => {
    const result = byId.get(scenario.id) ?? null;
    const verdict = evaluateScenarioResult(scenario, result);
    return {
      id: scenario.id,
      tier: scenario.tier,
      label: scenario.label,
      passage: scenario.passage ?? null,
      overlay: scenario.overlay ?? null,
      ok: verdict.ok,
      failures: verdict.failures,
      diagnostics: (result && result.diagnostics) || null,
      result,
    };
  });
  const byTier = (tier) => entries.filter((e) => e.tier === tier);
  const passed = (list) => list.filter((e) => e.ok).length;
  return {
    ok: entries.every((e) => e.ok),
    entries,
    tierA: { total: byTier('A').length, passed: passed(byTier('A')) },
    tierC: { total: byTier('C').length, passed: passed(byTier('C')) },
    failed: entries.filter((e) => !e.ok).map((e) => e.id),
    maxTextLength: entries.reduce((m, e) => Math.max(m, Number(e.result && e.result.finalTextLength) || 0), 0),
  };
}
