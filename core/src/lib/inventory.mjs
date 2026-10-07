/*
 * Canonical Text Inventory.
 *
 * One unified unit model for every translatable span. Fields may be added, but
 * there is exactly one candidate format for every text family.
 *
 *   unitId sourceFile passage widget startOffset endOffset absStart absEnd
 *   rawText protectedText placeholders family visibility riskLevel kind
 *   sourceVersion baseRelation oldTranslation translation qaStatus ruleHits
 */

import {
  tokenize, isReversible, conditionalDepth, linkLabel, macroLabel,
  isFlushMacro, isBlockHtml, DISPLAY_MACROS,
} from './elements.mjs';

export function looksLikeEnglish(text) {
  if (!/[A-Za-z]{3,}/.test(text)) return false;
  if (/[A-Za-z]{2,}[ \t][A-Za-z]{2,}/.test(text)) return true;
  return /\b[A-Za-z]{4,}\b/.test(text);
}

export function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

const UI_HINTS = /(setting|option|menu|save|load|slot|panel|button|hud|footer|version|import|export|config)/i;
const WIDGET_HINT = /widget/i;
const NARRATIVE_HINT = /^(loc-|overworld|special-|story|passage)/i;

export function classifyArea(passage) {
  const n = passage.name;
  if (passage.tags.includes('widget') || WIDGET_HINT.test(n)) return 'widgets';
  if (UI_HINTS.test(n)) return 'ui';
  if (NARRATIVE_HINT.test(n)) return 'narrative';
  return 'narrative';
}

/** Replace every non-text element of a payload run with a protected placeholder. */
function placeholdersOf(runElements) {
  const placeholders = [];
  const parts = [];
  for (const el of runElements) {
    if (el.kind === 'text') { parts.push(el.text); continue; }
    const ph = `⟦${placeholders.length}⟧`;
    placeholders.push({ placeholder: ph, raw: el.text, kind: el.kind, name: el.name ?? null });
    parts.push(ph);
  }
  return { protectedText: parts.join(''), placeholders };
}

function englishPayload(protectedText, placeholders) {
  return placeholders.reduce((acc, ph) => acc.split(ph.placeholder).join(' '), protectedText);
}

/**
 * Build the canonical inventory from a parsed compiled story.
 * Returns { units, stats, reversibility }.
 */
export function buildInventory(story, { sourceVersion = 'unknown' } = {}) {
  const units = [];
  const stats = {
    passages: story.passages.length,
    passagesWithText: 0,
    irreversiblePassages: 0,
    unitsByKind: {},
    unitsByRisk: {},
    unitsByArea: {},
  };
  const reversibleErrors = [];

  for (const p of story.passages) {
    const elements = tokenize(p.content);
    if (!isReversible(p.content, elements)) {
      stats.irreversiblePassages += 1;
      if (reversibleErrors.length < 20) {
        reversibleErrors.push({ passage: p.name, pid: p.pid });
      }
      continue;
    }
    const depth = conditionalDepth(elements);
    const area = classifyArea(p);
    let produced = 0;

    const pushUnit = (kind, start, end, rawText, protectedText, placeholders, riskLevel, extra = {}) => {
      const unit = {
        unitId: `${p.pid}:${start}-${end}`,
        sourceFile: extra.sourceFile ?? null,
        passage: p.name,
        widget: kind === 'widget' ? p.name : null,
        startOffset: start,
        endOffset: end,
        absStart: p.contentOffset + start,
        absEnd: p.contentOffset + end,
        rawText,
        protectedText,
        placeholders,
        family: area,
        visibility: extra.visibility ?? 'player',
        riskLevel,
        kind,
        sourceVersion,
        baseRelation: extra.baseRelation ?? null,
        oldTranslation: null,
        translation: null,
        qaStatus: 'pending',
        ruleHits: [],
      };
      units.push(unit);
      produced += 1;
      stats.unitsByKind[kind] = (stats.unitsByKind[kind] || 0) + 1;
      stats.unitsByRisk[riskLevel] = (stats.unitsByRisk[riskLevel] || 0) + 1;
      stats.unitsByArea[area] = (stats.unitsByArea[area] || 0) + 1;
    };

    // Payload runs span inline macros / HTML / variables as placeholders and
    // break only at block boundaries (control flow, code, links, block tags).
    let runStart = null;
    let runIndex = 0;
    let run = [];
    const flush = () => {
      if (runStart === null) return;
      const last = run[run.length - 1];
      const { protectedText, placeholders } = placeholdersOf(run);
      if (looksLikeEnglish(englishPayload(protectedText, placeholders))) {
        const d = depth[runIndex];
        const riskLevel = d > 0 ? 'L2' : placeholders.length > 0 ? 'L1' : 'L0';
        pushUnit('passage_text', runStart, last.end, p.content.slice(runStart, last.end), protectedText, placeholders, riskLevel);
      }
      runStart = null;
      run = [];
    };

    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      let boundary = false;
      if (el.kind === 'comment') boundary = true;
      else if (el.kind === 'macro') boundary = isFlushMacro(el.name);
      else if (el.kind === 'link') boundary = true;
      else if (el.kind === 'html') boundary = isBlockHtml(el.text);

      if (boundary) {
        flush();
        if (el.kind === 'link') {
          const label = linkLabel(el);
          if (label && looksLikeEnglish(label.text)) {
            const d = depth[i];
            pushUnit('link_label', label.start, label.end, label.text, label.text, [], d > 0 ? 'L2' : 'L1');
          }
        } else if (el.kind === 'macro' && DISPLAY_MACROS.has(el.name)) {
          const label = macroLabel(el);
          if (label && looksLikeEnglish(label.text)) {
            const d = depth[i];
            pushUnit('macro_label', label.start, label.end, label.text, label.text, [], d > 0 ? 'L2' : 'L1');
          }
        }
        continue;
      }
      if (runStart === null) { runStart = el.start; runIndex = i; }
      run.push(el);
    }
    flush();
    if (produced > 0) stats.passagesWithText += 1;
  }

  return { units, stats, reversibility: { errors: reversibleErrors } };
}

/** Reconstruct a passage slice from a unit's protectedText + placeholders. */
export function restoreProtected(protectedText, placeholders) {
  let out = protectedText;
  for (const ph of placeholders) out = out.split(ph.placeholder).join(ph.raw);
  return out;
}
