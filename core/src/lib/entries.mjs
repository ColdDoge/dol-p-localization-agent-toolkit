/*
 * ModI18N entry assembly + offline QA (overlap / patchability).
 *
 * Output shape is the ReplacePatcher addon the game's mod loader consumes:
 *   { passageName, from, to, all }
 *
 * The derivation of `from` / `all`:
 *
 *   - the source span of a unit is a fact (unit.startOffset/endOffset), never
 *     inferred from `passage.content.indexOf(from)`, which would map later
 *     repeated text onto its first occurrence and manufacture false overlaps.
 *   - `all: true` is only emitted when every occurrence of `from` in the
 *     passage is a canonical site that must receive the *same* translation.
 *   - when a unit's `from` is ambiguous (repeated text, or text nested inside
 *     another entry's span) the entry is resolved with a minimal unique context
 *     anchor so the replacement lands exactly on the unit's own site. If no
 *     unique anchor exists the unit stays unresolved with an explicit reason.
 *   - the final entry set is simulated against the ReplacePatcher algorithm and
 *     compared with the intended span splice; a mismatch is a real patch
 *     conflict and is reported, never silently accepted.
 */

import { restoreProtected } from './protect.mjs';

export function encodeEntities(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * ModI18N / ReplacePatcher and the project's existing translations operate on
 * the *decoded* passage text (the game's runtime passage content), not on the
 * HTML-escaped form stored inside `<tw-passagedata>`. This helper returns the
 * decoded text a unit must be matched against.
 */
export function passageTextDomain(passage) {
  return passage.content;
}

export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) return n;
    n += 1;
    i = j + Math.max(1, needle.length);
  }
}

/** All occurrence offsets of `needle` in `haystack`. */
export function positionsOf(haystack, needle) {
  const out = [];
  if (!needle) return out;
  let i = 0;
  for (;;) {
    const j = haystack.indexOf(needle, i);
    if (j < 0) return out;
    out.push(j);
    i = j + Math.max(1, needle.length);
  }
}

/**
 * Max characters added on each side when looking for a unique context anchor.
 * The offline 5000-unit rebuild plateaus at ~66 unresolved for a cap of
 * 150-300; below that the search gives up on repeated conditional branches,
 * above it the enlarged anchors start colliding with neighbouring entries.
 */
export const MAX_ANCHOR_GROWTH = 200;

/**
 * Find the smallest contiguous expansion of [start,end) that occurs exactly
 * once in `content`. Returns null when no anchor within MAX_ANCHOR_GROWTH fits.
 * Preference: least total growth, then least left growth (keeps the anchor
 * closer to the sentence the unit belongs to).
 */
export function uniqueAnchor(content, start, end, maxGrowth = MAX_ANCHOR_GROWTH, forbidden = []) {
  const maxLeft = start;
  const maxRight = content.length - end;
  const limit = Math.min(maxGrowth, maxLeft + maxRight);
  for (let total = 0; total <= limit; total += 1) {
    for (let left = 0; left <= Math.min(total, maxLeft); left += 1) {
      const right = total - left;
      if (right > maxRight) continue;
      if (!spanIsFree(forbidden, start - left, end + right)) continue;
      const from = content.slice(start - left, end + right);
      const ps = positionsOf(content, from);
      // The anchor must be unique AND land on this unit's own site; a unique
      // string that only occurs elsewhere would rewrite the wrong characters.
      if (ps.length === 1 && ps[0] === start - left) {
        return {
          left,
          right,
          from,
          prefix: content.slice(start - left, start),
          suffix: content.slice(end, end + right),
          wrap: (to) => content.slice(start - left, start) + to + content.slice(end, end + right),
        };
      }
    }
  }
  return null;
}

/** The game's ReplacePatcher algorithm (see tools/qa.mjs simulateReplace). */
export function simulateReplaceParams(content, entries) {
  let out = content;
  for (const e of entries) {
    out = e.all === true ? out.split(e.from).join(e.to) : out.replace(e.from, () => e.to);
  }
  return out;
}

/**
 * Max characters added per side when a cluster region is grown to
 * uniqueness. Independent of MAX_ANCHOR_GROWTH: the resolver here is allowed to
 * cross neighbours (it absorbs them), so the search window can be wider.
 */
export const MAX_CLUSTER_GROWTH = 4000;

/**
 * Minimal expansion of the source slice [lo,hi) to a string that occurs
 * exactly once in `content` and starts at `lo - left`. Unlike `uniqueAnchor`
 * this does not refuse to cross other entries — the cluster resolver absorbs
 * whatever it crosses — so the only objective is the smallest (left,right) that
 * is unique. Returns { left, right, from } or null.
 */
export function expandToUnique(content, lo, hi) {
  const base = content.slice(lo, hi);
  const occ = positionsOf(content, base);
  const others = occ.filter((p) => p !== lo);
  if (!others.length) return { left: 0, right: 0, from: base };
  const maxLeft = lo;
  const maxRight = content.length - hi;
  // For each competing occurrence q, Lq/Rq are the longest left/right context
  // that still matches the target site. `from` also occurs at q-left iff
  // left <= Lq && right <= Rq, so uniqueness only needs to defeat these pairs.
  const cons = others.map((q) => {
    let L = 0;
    while (L < maxLeft && L < q && content[lo - L - 1] === content[q - L - 1]) L += 1;
    let R = 0;
    while (R < maxRight && q + base.length + R < content.length && content[hi + R] === content[q + base.length + R]) R += 1;
    return { q, L, R };
  });
  let best = null;
  const leftLimit = Math.min(maxLeft, MAX_CLUSTER_GROWTH);
  for (let left = 0; left <= leftLimit; left += 1) {
    let needRight = 0;
    for (const c of cons) {
      if (c.q < left) continue; // an occurrence starting before the string cannot exist
      if (left <= c.L) needRight = Math.max(needRight, c.R + 1);
    }
    if (needRight > maxRight || needRight > MAX_CLUSTER_GROWTH) continue;
    const total = left + needRight;
    if (!best || total < best.total || (total === best.total && left < best.left)) best = { left, right: needRight, total };
  }
  if (!best) return null;
  const from = content.slice(lo - best.left, hi + best.right);
  const ps = positionsOf(content, from);
  if (ps.length !== 1 || ps[0] !== lo - best.left) return null;
  return { left: best.left, right: best.right, from };
}

/**
 * Render the slice [lo,hi) with a set of disjoint canonical edits applied.
 * Characters between edits are copied verbatim from the source — a cluster
 * never rewrites a region it has no translation for.
 */
export function applyEditsToSlice(content, lo, hi, edits) {
  let out = '';
  let cursor = lo;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    if (e.start < cursor) throw new Error(`cluster edits overlap at ${e.start} (<${cursor})`);
    out += content.slice(cursor, e.start) + e.to;
    cursor = e.end;
  }
  return out + content.slice(cursor, hi);
}

/**
 * Conflict-cluster resolver.
 *
 * After the planner has committed every entry it can, the units that
 * remain unresolved fail for one of two reasons:
 *   (a) their source text repeats, so a unique anchor would have to cross a
 *       neighbouring unit / already-planned entry;
 *   (b) their (unique) source span was swallowed by an earlier entry whose own
 *       anchor had to grow across it.
 *
 * Both are the same defect: a minimal contiguous run of canonical units needs a
 * single ReplacePatcher entry. This resolver merges such runs — together with
 * every planned entry they cross — into one cluster whose `from` is the exact
 * source slice, grown minimally left/right to uniqueness, and whose `to`
 * re-applies every member's canonical translation inside that slice. Distinct
 * translations are never unified and no QA is relaxed; a cluster that cannot be
 * made unique (or would need the whole passage) is left unresolved.
 */
function resolveClusters({ passage, content, entries, unresolved, allowWholePassage }) {
  let working = [...entries];
  const clusters = [];
  const resolvedUnits = new Set();
  const absorbedEntryIds = new Set();
  const failReason = new Map();
  const stats = { cluster: 0, clusteredUnits: 0, clusterAbsorbedEntries: 0, clusterAbsorbedClusters: 0, clusterFailed: 0, clusterFailReasons: {} };

  const queue = [...unresolved].sort((a, b) => a.v.start - b.v.start);
  for (const item of queue) {
    if (resolvedUnits.has(item.v.u.unitId)) continue;
    const attempt = buildCluster({ passage, content, working, seed: item.v, unresolvedAll: unresolved, allowWholePassage });
    if (!attempt.ok) {
      stats.clusterFailed += 1;
      stats.clusterFailReasons[attempt.reason] = (stats.clusterFailReasons[attempt.reason] || 0) + 1;
      failReason.set(item.v.u.unitId, attempt.reason);
      continue;
    }
    working = working.filter((e) => !attempt.absorbedIds.has(e.unitId));
    working.push(attempt.entry);
    clusters.push(attempt.entry);
    for (const id of attempt.absorbedIds) absorbedEntryIds.add(id);
    for (const id of attempt.memberUnitIds) resolvedUnits.add(id);
    stats.cluster += 1;
    stats.clusteredUnits += attempt.memberUnitIds.length;
    stats.clusterAbsorbedEntries += attempt.absorbedIds.size;
    stats.clusterAbsorbedClusters += attempt.absorbedClusterIds.length;
  }
  // A unit that failed to seed a cluster may still have been absorbed by a
  // later one; only genuinely uncovered units stay unresolved.
  const remaining = unresolved
    .filter((it) => !resolvedUnits.has(it.v.u.unitId))
    .map((it) => (failReason.has(it.v.u.unitId)
      ? { ...it, detail: `${it.detail || ''}; cluster: ${failReason.get(it.v.u.unitId)}` }
      : it));
  return { entries: working, clusters, clusteredUnitIds: resolvedUnits, absorbedEntryIds, remaining, stats };
}

function buildCluster({ passage, content, working, seed, unresolvedAll, allowWholePassage }) {
  const memberUnits = new Map([[seed.u.unitId, seed]]);
  const memberEntries = new Map();
  let lo = seed.start;
  let hi = seed.end;
  for (let guard = 0; guard < 200; guard += 1) {
    for (const m of memberUnits.values()) { lo = Math.min(lo, m.start); hi = Math.max(hi, m.end); }
    for (const e of memberEntries.values()) {
      for (const c of (e.covers || [e.patchSpan])) { lo = Math.min(lo, c.start); hi = Math.max(hi, c.end); }
    }
    const exp = expandToUnique(content, lo, hi);
    if (!exp) return { ok: false, reason: 'cluster-not-unique' };
    const plo = lo - exp.left;
    const phi = hi + exp.right;
    if (!allowWholePassage && plo === 0 && phi === content.length) return { ok: false, reason: 'cluster-whole-passage' };
    let crossed = false;
    for (const e of working) {
      if (memberEntries.has(e.unitId)) continue;
      // An entry edits every one of its covers; a uniform all:true entry spans
      // several sites. Any cover inside the cluster's patch span must be
      // absorbed (the region then grows to include it) so no two entries ever
      // overlap under ReplacePatcher.
      if ((e.covers || [e.patchSpan]).some((c) => c.start < phi && plo < c.end)) {
        memberEntries.set(e.unitId, e);
        crossed = true;
      }
    }
    for (const it of unresolvedAll) {
      const id = it.v.u.unitId;
      if (memberUnits.has(id)) continue;
      // A unit already folded into an absorbed entry/cluster must not be added
      // again as a raw member — its edit would then overlap the entry's own.
      let covered = false;
      for (const e of memberEntries.values()) {
        if ((e.memberUnitIds || [e.unitId]).includes(id)) { covered = true; break; }
      }
      if (covered) continue;
      if (it.v.start < phi && plo < it.v.end) { memberUnits.set(id, it.v); crossed = true; }
    }
    if (crossed) continue;

    const edits = [];
    for (const m of memberUnits.values()) edits.push({ start: m.start, end: m.end, to: m.to });
    for (const e of memberEntries.values()) for (const ed of (e.memberEdits || [])) edits.push(ed);
    let rendered;
    try { rendered = applyEditsToSlice(content, plo, phi, edits); }
    catch { return { ok: false, reason: 'cluster-edit-overlap' }; }

    const allUnitIds = new Set(memberUnits.keys());
    for (const e of memberEntries.values()) for (const id of (e.memberUnitIds || [e.unitId])) allUnitIds.add(id);
    const absorbedIds = new Set(memberEntries.keys());
    const absorbedClusterIds = [...memberEntries.values()].filter((e) => e.isCluster).map((e) => e.unitId);
    const from = content.slice(plo, phi);
    const entry = {
      unitId: seed.u.unitId,
      passageName: passage,
      from, to: rendered, all: false,
      rawFrom: content.slice(lo, hi),
      anchored: true, left: exp.left, right: exp.right,
      translationRaw: rendered,
      isCluster: true,
      memberEdits: edits,
      span: { start: lo, end: hi },
      patchSpan: { start: plo, end: phi },
      covers: [{ start: plo, end: phi }],
      coversUnits: [...allUnitIds],
      memberUnitIds: [...allUnitIds],
      absorbedEntryIds: [...absorbedIds],
      cluster: {
        seedUnitId: seed.u.unitId, growthLeft: exp.left, growthRight: exp.right,
        fromLength: from.length, toLength: rendered.length,
        memberCount: allUnitIds.size, absorbedCount: absorbedIds.size,
      },
    };
    return { ok: true, entry, absorbedIds, memberUnitIds: [...allUnitIds], absorbedClusterIds };
  }
  return { ok: false, reason: 'cluster-loop' };
}

/** Apply disjoint span edits directly — the intended (order-independent) output. */
export function renderSpanEdits(content, edits) {
  let out = '';
  let cursor = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    if (e.start < cursor) continue; // never happens for validated, disjoint spans
    out += content.slice(cursor, e.start) + e.to;
    cursor = e.end;
  }
  return out + content.slice(cursor);
}

/** True when [start,end) is untouched by every applied edit. */
export function spanIsFree(applied, start, end) {
  for (const e of applied) if (start < e.end && e.start < end) return false;
  return true;
}

/**
 * Plan the ReplacePatcher entries for one passage from its accepted units.
 *
 * `units` must carry canonical startOffset/endOffset, rawText and translation.
 * Returns { entries, skipped, stats }.
 */
function planPassage(passage, content, units, opts = {}) {
  const anchorGrowth = Number.isFinite(opts.anchorGrowth) ? opts.anchorGrowth : MAX_ANCHOR_GROWTH;
  const allowWholePassage = opts.allowWholePassage === true;
  const enableClusters = opts.cluster !== false;
  const finalEntries = [];
  const skipped = [];
  const coverage = new Map(); // unitId -> { entryId, via }
  const stats = {
    uniformAll: 0, anchored: 0, conflictMultiSite: 0, conflictPatch: 0,
    spanMismatch: 0, overlap: 0,
    cluster: 0, clusteredUnits: 0, clusterAbsorbedEntries: 0, clusterAbsorbedClusters: 0, clusterFailed: 0,
  };

  const valid = [];
  const ordered = [...units].sort((a, b) => a.startOffset - b.startOffset);
  for (const u of ordered) {
    const start = u.startOffset;
    const end = u.endOffset;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > content.length) {
      skipped.push({ unitId: u.unitId, passage, reason: 'span-mismatch', detail: `bad-span ${start}-${end}` });
      stats.spanMismatch += 1;
      continue;
    }
    if (content.slice(start, end) !== u.rawText) {
      skipped.push({ unitId: u.unitId, passage, reason: 'span-mismatch', detail: 'slice != rawText' });
      stats.spanMismatch += 1;
      continue;
    }
    valid.push({ u, start, end, from: u.rawText, to: restoreProtected(u.translation, u.placeholders) });
  }

  // Canonical spans of distinct units must never overlap. This is a real
  // source-coverage conflict: two units claim the same characters.
  const byStart = [...valid].sort((a, b) => a.start - b.start);
  for (let i = 1; i < byStart.length; i += 1) {
    if (byStart[i].start < byStart[i - 1].end) {
      skipped.push({
        unitId: byStart[i].u.unitId, passage, reason: 'overlap',
        detail: `canonical span [${byStart[i].start},${byStart[i].end}) overlaps [${byStart[i - 1].start},${byStart[i - 1].end})`,
      });
      stats.overlap += 1;
    }
  }
  const overlapping = new Set(skipped.filter((s) => s.reason === 'overlap').map((s) => s.unitId));
  const usable = valid.filter((v) => !overlapping.has(v.u.unitId));
  const vByUnitId = new Map(valid.map((v) => [v.u.unitId, v]));

  // Group units that share the same source text.
  const groups = new Map();
  for (const v of usable) {
    if (!groups.has(v.from)) groups.set(v.from, []);
    groups.get(v.from).push(v);
  }

  // Decide the shape of every group first: a group is "uniform" (one all=true
  // entry covers every site identically) only when the text repeats nowhere
  // else in the passage. Everything else is resolved per site.
  const decision = new Map(); // unitId -> {kind}
  const uniformHead = new Map(); // unitId -> {from, starts, group}
  for (const [from, group] of groups) {
    const positions = positionsOf(content, from);
    const starts = group.map((v) => v.start).sort((a, b) => a - b);
    const sameTo = group.every((v) => v.to === group[0].to);
    const allSitesAreUnits = positions.length === starts.length && positions.every((p, i) => p === starts[i]);
    if (group.length > 1 && sameTo && allSitesAreUnits) {
      const head = group.slice().sort((a, b) => a.start - b.start)[0];
      uniformHead.set(head.u.unitId, { from, starts, group });
      decision.set(head.u.unitId, { kind: 'uniform-head' });
      for (const v of group) if (v !== head) decision.set(v.u.unitId, { kind: 'duplicate', headId: head.u.unitId });
    } else {
      for (const v of group) decision.set(v.u.unitId, { kind: 'site' });
    }
  }

  // Walk the passage in canonical source order, committing entries as we go.
  // Every later entry must fit around the regions already committed, so the
  // ReplacePatcher result is byte-identical to the intended span splice.
  const applied = [];
  let patchText = content;
  const coversById = new Map();
  const unresolved = []; // { v, reason, detail }

  const tryCommit = (entry) => {
    if (!entry.covers.every((c) => spanIsFree(applied, c.start, c.end))) return false;
    const expected = renderSpanEdits(content, [...applied, ...entry.covers.map((c) => ({ start: c.start, end: c.end, to: entry.to }))]);
    const actual = entry.all === true
      ? patchText.split(entry.from).join(entry.to)
      : patchText.replace(entry.from, () => entry.to);
    if (actual !== expected) return false;
    for (const c of entry.covers) applied.push({ start: c.start, end: c.end, to: entry.to });
    patchText = actual;
    finalEntries.push(entry);
    coversById.set(entry.unitId, entry.covers);
    return true;
  };

  for (const v of usable) {
    const d = decision.get(v.u.unitId);
    if (d.kind === 'duplicate') continue;
    if (d.kind === 'uniform-head') {
      const info = uniformHead.get(v.u.unitId);
      const covers = info.starts.map((s) => ({ start: s, end: s + info.from.length }));
      const entry = {
        unitId: v.u.unitId, passageName: v.u.passage, from: info.from, to: v.to, all: true,
        rawFrom: info.from, anchored: false, left: 0, right: 0,
        translationRaw: v.to, memberEdits: covers.map((c) => ({ start: c.start, end: c.end, to: v.to })),
        span: { start: v.start, end: v.end }, patchSpan: { start: v.start, end: v.end },
        covers, coversUnits: info.group.map((g) => g.u.unitId), groupSize: info.group.length,
      };
      if (tryCommit(entry)) {
        stats.uniformAll += 1;
        coverage.set(entry.unitId, { entryId: entry.unitId, via: 'uniform-all' });
      } else {
        unresolved.push({ v, reason: 'patch-conflict', detail: 'uniform repeat collides with an earlier entry' });
      }
      continue;
    }

    // A single site. Simple when the text is unique and the span is free.
    const positions = positionsOf(content, v.from);
    if (positions.length === 1) {
      const entry = {
        unitId: v.u.unitId, passageName: v.u.passage, from: v.from, to: v.to, all: false,
        rawFrom: v.from, anchored: false, left: 0, right: 0,
        translationRaw: v.to, memberEdits: [{ start: v.start, end: v.end, to: v.to }],
        span: { start: v.start, end: v.end }, patchSpan: { start: v.start, end: v.end },
        covers: [{ start: v.start, end: v.end }], coversUnits: [v.u.unitId], groupSize: 1,
      };
      if (tryCommit(entry)) { coverage.set(entry.unitId, { entryId: entry.unitId, via: 'simple' }); continue; }
    }

    const anchor = uniqueAnchor(content, v.start, v.end, anchorGrowth, applied);
    if (!anchor) {
      unresolved.push({
        v,
        reason: positions.length > 1 ? 'patch-conflict-multi-site' : 'patch-conflict',
        detail: positions.length > 1
          ? `"${v.from.slice(0, 40)}" occurs ${positions.length}x and no free unique context anchor was found`
          : `"${v.from.slice(0, 40)}" occurs 1x but its span is already covered by an earlier entry's anchor`,
      });
      continue;
    }
    const entry = {
      unitId: v.u.unitId, passageName: v.u.passage,
      from: anchor.from, to: anchor.wrap(v.to), all: false,
      rawFrom: v.from, anchored: true, left: anchor.left, right: anchor.right,
      translationRaw: v.to, memberEdits: [{ start: v.start, end: v.end, to: v.to }],
      span: { start: v.start, end: v.end },
      patchSpan: { start: v.start - anchor.left, end: v.end + anchor.right },
      covers: [{ start: v.start - anchor.left, end: v.end + anchor.right }],
      coversUnits: [v.u.unitId], groupSize: groupSizeOf(groups, v.from),
    };
    if (tryCommit(entry)) {
      stats.anchored += 1;
      coverage.set(entry.unitId, { entryId: entry.unitId, via: 'anchored' });
    } else {
      unresolved.push({ v, reason: 'patch-conflict', detail: 'anchored entry collides with an earlier entry' });
    }
  }

  // Duplicate sites covered by a uniform entry: equivalent ones are superseded,
  // the rest are a real patch conflict (never silently unified).
  //
  // Defect fix: when the uniform head entry could NOT be committed (an
  // earlier anchored entry's uniqueness growth swallowed one of its sites) the
  // duplicate sites must not be stranded as a terminal `patch-conflict`. They
  // are exactly the case the cluster resolver exists for: a contiguous
  // run of canonical units that needs one entry. Hand the duplicate `v` to the
  // cluster stage (below) so each site can be re-applied inside a cluster, or
  // resolved per-site, instead of being reported unresolved by construction.
  for (const v of usable) {
    const d = decision.get(v.u.unitId);
    if (d.kind !== 'duplicate') continue;
    const headCovers = coversById.get(d.headId);
    if (headCovers) {
      skipped.push({ unitId: v.u.unitId, passage, reason: 'duplicate-passage-from', coveredBy: d.headId, span: { start: v.start, end: v.end } });
      const headV = vByUnitId.get(d.headId);
      if (headV && headV.to === v.to) coverage.set(v.u.unitId, { entryId: d.headId, via: 'duplicate-superseded' });
    } else {
      unresolved.push({ v, reason: 'patch-conflict', detail: `uniform head entry ${d.headId} was dropped` });
    }
  }

  // ---- second stage: conflict-cluster resolver ----
  let resolution = enableClusters
    ? resolveClusters({ passage, content, entries: finalEntries, unresolved, allowWholePassage })
    : { entries: finalEntries, clusters: [], clusteredUnitIds: new Set(), absorbedEntryIds: new Set(), remaining: unresolved, stats: { cluster: 0, clusteredUnits: 0, clusterAbsorbedEntries: 0, clusterAbsorbedClusters: 0, clusterFailed: unresolved.length, clusterFailReasons: {} } };
  // Replay gate: the cluster-augmented plan must reproduce the intended span
  // splice byte-for-byte under the game's ReplacePatcher semantics. If it does
  // not, keep the conservative result for this passage — never ship a
  // planner whose replay we cannot prove.
  const intended = renderSpanEdits(content, resolution.entries.flatMap((e) => (e.covers || [e.patchSpan]).map((c) => ({ start: c.start, end: c.end, to: e.to }))));
  const actual = simulateReplaceParams(content, resolution.entries);
  if (actual !== intended) {
    if (opts.debug) {
      let i = 0;
      while (i < Math.min(actual.length, intended.length) && actual[i] === intended[i]) i += 1;
      // eslint-disable-next-line no-console
      console.error(`[v23-replay] ${passage} mismatch@${i} entries=${resolution.entries.length} clusters=${resolution.clusters.length} | actual=${JSON.stringify(actual.slice(i, i + 60))} | intended=${JSON.stringify(intended.slice(i, i + 60))}`);
      for (const e of resolution.entries) {
        // eslint-disable-next-line no-console
        console.error(`   ${e.isCluster ? 'CLUSTER ' : ''}${e.unitId} span[${e.span.start},${e.span.end}) patch[${e.patchSpan.start},${e.patchSpan.end}) all=${e.all} fromLen=${e.from.length} covers=${JSON.stringify((e.covers || []).map((c) => [c.start, c.end]))} from=${JSON.stringify(e.from.slice(0, 30))}`);
      }
    }
    resolution = {
      entries: finalEntries, clusters: [], clusteredUnitIds: new Set(), absorbedEntryIds: new Set(),
      remaining: unresolved,
      stats: { cluster: 0, clusteredUnits: 0, clusterAbsorbedEntries: 0, clusterAbsorbedClusters: 0, clusterFailed: unresolved.length, clusterFailReasons: { 'replay-mismatch': 1 } },
    };
  }

  for (const item of resolution.remaining) {
    if (item.reason === 'patch-conflict-multi-site') stats.conflictMultiSite += 1;
    else stats.conflictPatch += 1;
    skipped.push({ unitId: item.v.u.unitId, passage, reason: item.reason, detail: item.detail });
  }
  for (const c of resolution.clusters) {
    for (const id of c.memberUnitIds) coverage.set(id, { entryId: c.unitId, via: 'cluster' });
  }
  const survivingClusters = resolution.entries.filter((e) => e.isCluster);
  stats.cluster = survivingClusters.length;
  stats.clusteredUnits = survivingClusters.reduce((a, c) => a + c.memberUnitIds.length, 0);
  stats.clusterAbsorbedEntries = resolution.stats.clusterAbsorbedEntries;
  stats.clusterAbsorbedClusters = resolution.stats.clusterAbsorbedClusters;
  stats.clusterFailed = resolution.stats.clusterFailed;

  const entries = resolution.entries;
  entries.sort((a, b) => a.patchSpan.start - b.patchSpan.start || a.patchSpan.end - b.patchSpan.end);
  return { entries, skipped, stats, coverage };
}

function groupSizeOf(groups, from) {
  const g = groups.get(from);
  return g ? g.length : 1;
}

/**
 * Build ModI18N entries from units that already carry a translated protected
 * string. Returns { entries, skipped, stats }.
 */
export function buildEntries(units, passagesByName, opts = {}) {
  const entries = [];
  const skipped = [];
  const coverage = new Map(); // unitId -> { entryId, via }
  const stats = {
    uniformAll: 0, anchored: 0, conflictMultiSite: 0, conflictPatch: 0,
    spanMismatch: 0, overlap: 0,
    cluster: 0, clusteredUnits: 0, clusterAbsorbedEntries: 0, clusterAbsorbedClusters: 0, clusterFailed: 0,
  };
  let passageMissing = 0;

  const byPassage = new Map();
  for (const u of units) {
    if (!byPassage.has(u.passage)) byPassage.set(u.passage, []);
    byPassage.get(u.passage).push(u);
  }

  for (const [passageName, passageUnits] of byPassage) {
    const p = passagesByName.get(passageName);
    if (!p) {
      passageMissing += passageUnits.length;
      for (const u of passageUnits) skipped.push({ unitId: u.unitId, passage: passageName, reason: 'passage-missing' });
      continue;
    }
    const plan = planPassage(passageName, p.content, passageUnits, opts);
    for (const e of plan.entries) entries.push(e);
    for (const s of plan.skipped) skipped.push(s);
    for (const k of Object.keys(stats)) stats[k] += plan.stats[k] || 0;
    for (const [id, rec] of plan.coverage) coverage.set(id, rec);
  }

  return { entries, skipped, stats, passageMissing, coverage };
}

/**
 * Offline QA over entries: presence, no-op, span integrity, patchability and
 * the ReplacePatcher replay gate.
 */
export function qaEntries(entries, passagesByName) {
  const failures = [];
  const perPassage = new Map();
  for (const e of entries) {
    const p = passagesByName.get(e.passageName);
    if (!p) { failures.push({ code: 'PASSAGE_MISSING', unitId: e.unitId }); continue; }
    if (!p.content.includes(e.from)) failures.push({ code: 'FROM_MISSING', unitId: e.unitId });
    if (e.from === e.to) failures.push({ code: 'NO_OP', unitId: e.unitId });
    const span = e.span || { start: p.content.indexOf(e.from), end: p.content.indexOf(e.from) + e.from.length };
    const rawFrom = e.rawFrom != null ? e.rawFrom : e.from;
    if (typeof rawFrom === 'string' && p.content.slice(span.start, span.end) !== rawFrom) {
      failures.push({ code: 'SPAN_MISMATCH', unitId: e.unitId });
    }
    const occurrences = countOccurrences(p.content, e.from);
    if (occurrences > 1 && !e.all) failures.push({ code: 'ALL_FLAG_MISSING', unitId: e.unitId });
    if (occurrences < 1) failures.push({ code: 'FROM_MISSING', unitId: e.unitId });
    if (!perPassage.has(e.passageName)) perPassage.set(e.passageName, []);
    perPassage.get(e.passageName).push({ start: span.start, end: span.end, unitId: e.unitId });
  }

  let overlaps = 0;
  let patchConflicts = 0;
  for (const [passage, spans] of perPassage) {
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].start < sorted[i - 1].end) {
        overlaps += 1;
        failures.push({ code: 'OVERLAP', passage, a: sorted[i - 1].unitId, b: sorted[i].unitId });
      }
    }
    const content = passagesByName.get(passage).content;
    const passageEntries = entries.filter((e) => e.passageName === passage);
    const intended = renderSpanEdits(content, passageEntries.flatMap((e) => (e.covers || [e.patchSpan]).map((c) => ({ start: c.start, end: c.end, to: e.to }))));
    const actual = simulateReplaceParams(content, passageEntries);
    if (actual !== intended) {
      patchConflicts += 1;
      failures.push({ code: 'PATCH_REPLAY_MISMATCH', passage });
    }
  }

  const byCode = {};
  for (const f of failures) byCode[f.code] = (byCode[f.code] || 0) + 1;
  return { ok: failures.length === 0, failures, byCode, overlaps, patchConflicts, entries: entries.length };
}
