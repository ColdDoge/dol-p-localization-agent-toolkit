/*
 * Page-side ModLoader scripts shared by the runtime harness and the probes.
 *
 * Everything runs inside the game WebView and goes through the documented
 * SugarCube / ModLoader surfaces:
 *   - SugarCube.Engine.play / SugarCube.Story      (navigation)
 *   - modUtils.getModLoadController().{listModIndexDB, addModIndexDB,
 *     removeModIndexDB, checkModZipFileIndexDB}
 *
 * Read-only with respect to user storage: import/removal only touches the
 * ModLoader mod list, never a save API.
 */

export const READY_EXPR = `Boolean(window.modUtils && window.modModLoadController && window.State && State.passage)`;

export const SCRIPT_RELOAD = `(() => { location.reload(); return 'reloading'; })()`;

/** Baseline snapshot: ModLoader storage + game state. Read-only. */
export const SCRIPT_SNAPSHOT = `(async () => {
  const safe = async (fn, fb = null) => { try { return await fn(); } catch { return fb; } };
  const c = window.modUtils && window.modUtils.getModLoadController ? window.modUtils.getModLoadController() : null;
  const nameArray = () => {
    try {
      const n = window.modUtils.getModListName();
      if (typeof n === 'string') return [n];
      if (Array.isArray(n)) return n.map(String);
      if (n && typeof n.keys === 'function') return [...n.keys()].map(String);
      if (n && typeof n === 'object') return Object.keys(n);
      return null;
    } catch { return null; }
  };
  return {
    passage: window.State ? State.passage : null,
    modUtilsVersion: await safe(() => (window.modUtils && window.modUtils.version) ?? null),
    listModIndexDB: await safe(() => c.listModIndexDB()),
    listHiddenModIndexDB: await safe(() => c.loadHiddenModList()),
    loadedModNames: nameArray(),
    bodyErrors: document.querySelectorAll('.error').length,
    reloadCount: (window.__toolkitReloadCount = (window.__toolkitReloadCount || 0)),
  };
})()`;

export function scriptImport(base64, expectName) {
  return `(async () => {
    const B64 = ${JSON.stringify(base64)};
    const EXPECT = ${JSON.stringify(expectName)};
    const safe = async (fn, fb = null) => { try { return await fn(); } catch (e) { return fb === null ? String(e && e.message || e) : fb; } };
    const bin = atob(B64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
    const c = window.modUtils.getModLoadController();
    const before = await safe(() => c.listModIndexDB(), []);
    const checked = await safe(() => c.checkModZipFileIndexDB(u8));
    if (typeof checked === 'string') {
      return { ok: false, stage: 'check', error: checked, before };
    }
    const name = checked && checked.name;
    if (EXPECT && name !== EXPECT) {
      return { ok: false, stage: 'name-mismatch', expected: EXPECT, actual: name, before };
    }
    const existing = (before || []).includes(name);
    await safe(() => c.addModIndexDB(name, u8));
    const after = await safe(() => c.listModIndexDB(), []);
    return {
      ok: after.includes(name),
      stage: 'add',
      name,
      version: (checked && checked.version) || null,
      existedBefore: existing,
      before,
      after,
    };
  })()`;
}

export function scriptRemove(name) {
  return `(async () => {
    const NAME = ${JSON.stringify(name)};
    const safe = async (fn, fb = null) => { try { return await fn(); } catch (e) { return fb === null ? String(e && e.message || e) : fb; } };
    const c = window.modUtils.getModLoadController();
    const before = await safe(() => c.listModIndexDB(), []);
    await safe(() => c.removeModIndexDB(NAME));
    const after = await safe(() => c.listModIndexDB(), []);
    return { before, after, removed: !after.includes(NAME) };
  })()`;
}

/** Compare two ModLoader name lists for restore verification. */
export function compareLists(baseline, after) {
  const b = Array.isArray(baseline) ? baseline : null;
  const a = Array.isArray(after) ? after : null;
  if (!b || !a) return { comparable: false, same: false };
  const same = b.length === a.length && b.every((x, i) => x === a[i]);
  return { comparable: true, same, baseline: b, after: a };
}
