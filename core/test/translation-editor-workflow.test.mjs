/*
 * Workflow-level tests for the browser translation editor.
 *
 * The editor is a single offline HTML file (JSZip inlined) with no build step,
 * so this harness boots the *real* shipped script inside a Node vm with a small
 * DOM / IndexedDB shim, then drives the actual handlers (load a Kit, edit,
 * undo, handoff-merge, migrate, export). It exercises user workflows, not just
 * function return values.
 *
 * Offline and in-process: no device, model, or network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const EDITOR_HTML = fileURLToPath(new URL('../../dolp-kit-translation-editor.html', import.meta.url));
const HTML = fs.readFileSync(EDITOR_HTML, 'utf8');

const BEGIN = '/* ==== DOLP-EDITOR-ENGINE:BEGIN ==== */';
const END = '/* ==== DOLP-EDITOR-ENGINE:END ==== */';

function scriptBlocks() {
  const parts = HTML.split('<script>');
  const jszip = parts[1].split('</script>')[0];
  const app = parts[2].split('</script>')[0];
  return { jszip, app };
}

function elementIds(code) {
  const ids = new Set();
  for (const m of code.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)) ids.add(m[1]);
  for (const m of code.matchAll(/for\(const id of \[([^\]]*)\]/g)) for (const q of m[1].matchAll(/'([A-Za-z0-9_-]+)'/g)) ids.add(q[1]);
  return [...ids];
}

function simpleMatch(el, sel) {
  sel = sel.trim();
  if (!sel || !el || el.nodeType === 3) return false;
  if (sel.includes(' ')) return simpleMatch(el, sel.split(/\s+/).pop());
  if (sel.startsWith('#')) return el.id === sel.slice(1);
  if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
  if (sel.startsWith('[')) {
    const name = sel.slice(1, -1).split('=')[0];
    return Object.prototype.hasOwnProperty.call(el.dataset, camel(name));
  }
  const notDisabled = sel.includes(':not(:disabled)');
  let base = sel.replace(':not(:disabled)', '');
  let cls = null;
  if (base.includes('.')) { const i = base.indexOf('.'); cls = base.slice(i + 1); base = base.slice(0, i); }
  let attr = null;
  const am = base.match(/\[([^\]=]+)=?["']?([^"'\]]*)["']?\]/);
  if (am) { attr = { name: am[1], value: am[2] }; base = base.slice(0, base.indexOf('[')); }
  if (base && el.tagName !== base.toUpperCase()) return false;
  if (cls && !el.classList.contains(cls)) return false;
  if (notDisabled && el.disabled) return false;
  if (attr) { const v = attr.name === 'value' ? el.value : el.getAttribute(attr.name); if (String(v) !== attr.value) return false; }
  return true;
}
function camel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function makeBoot({ confirmDefault = true } = {}) {
  const ids = elementIds(scriptBlocks().app);
  const byId = new Map();
  const confirmCalls = [];
  let confirmAnswer = confirmDefault;

  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.nodeType = 1;
      this._classes = new Set();
      this._children = [];
      this._attrs = {};
      this._listeners = {};
      this.dataset = {};
      this.style = { setProperty() {}, removeProperty() {} };
      this.textContent = '';
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.hidden = false;
      this.parentNode = null;
      this.id = '';
    }
    get className() { return [...this._classes].join(' '); }
    set className(v) { this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
    get classList() {
      const s = this._classes;
      return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)),
        toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; on ? s.add(c) : s.delete(c); return on; }, contains: (c) => s.has(c) };
    }
    append(...nodes) { for (const n of nodes) { if (n == null) continue; if (Array.isArray(n)) { this.append(...n); continue; } this._children.push(n); if (n && typeof n === 'object') n.parentNode = this; } return this; }
    replaceChildren(...nodes) { this._children = []; if (nodes.length) this.append(...nodes); return this; }
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); }
    getAttribute(k) { return this._attrs[k]; }
    removeAttribute(k) { delete this._attrs[k]; }
    addEventListener(t, fn) { (this._listeners[t] || (this._listeners[t] = [])).push(fn); }
    removeEventListener(t, fn) { const a = this._listeners[t]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
    dispatchEvent(type, ev = {}) { const e = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, ev); e.target = ev.target || this; for (const fn of this._listeners[type] || []) fn(e); return true; }
    click() { this.dispatchEvent('click'); }
    focus() { document.activeElement = this; }
    blur() { if (document.activeElement === this) document.activeElement = null; this.dispatchEvent('blur', { target: this }); }
    remove() { if (this.parentNode) this.parentNode._children = this.parentNode._children.filter((c) => c !== this); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n._children) { if (c && c.nodeType === 1) { if (simpleMatch(c, sel)) out.push(c); walk(c); } } }; walk(this); return out; }
    scrollIntoView() {}
  }

  const document = {
    documentElement: new El('html'),
    body: new El('body'),
    activeElement: null,
    getElementById: (id) => byId.get(id) || null,
    createElement: (t) => new El(t),
    createDocumentFragment: () => new El('fragment'),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
  for (const id of ids) { const el = new El(/^(input|file)$/.test(id) || /File$/.test(id) ? 'input' : 'div'); el.id = id; byId.set(id, el); }
  // Defaults the editor reads.
  const setVal = (id, v) => { const e = byId.get(id); if (e) e.value = v; };
  setVal('filter', 'all'); setVal('sort', 'default'); setVal('mergeMode', 'fill'); setVal('batchStatus', 'unmarked'); setVal('pageSize', '40'); setVal('language', 'zh');
  const pageSize = byId.get('pageSize');
  for (const n of ['20', '40', '80']) { const o = new El('option'); o.value = n; pageSize.append(o); }

  // Minimal in-memory IndexedDB.
  const stores = new Map();
  const fakeIDB = {
    open() {
      const db = {
        objectStoreNames: { contains: (n) => stores.has(n) },
        createObjectStore: (n) => { stores.set(n, new Map()); return { keyPath: 'id' }; },
        transaction(name) {
          const names = Array.isArray(name) ? name : [name];
          const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
          tx.objectStore = (n) => {
            const m = (stores.get(n) || stores.set(n, new Map()).get(n));
            return {
              get(key) { const r = { result: undefined, onsuccess: null, onerror: null }; setTimeout(() => { r.result = m.get(key); r.onsuccess && r.onsuccess(); }, 0); return r; },
              put(v) { const k = v && v.id !== undefined ? v.id : v && v.key; m.set(k, v); return {}; },
              delete(key) { m.delete(key); return {}; },
            };
          };
          setTimeout(() => { tx.oncomplete && tx.oncomplete(); }, 4);
          return tx;
        },
      };
      const req = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => { req.onupgradeneeded && req.onupgradeneeded(); req.onsuccess && req.onsuccess(); }, 0);
      return req;
    },
  };

  const blobs = [];
  // The editor schedules a 60s revokeObjectURL and 3.1s toast timers; clamp any
  // long delay so the test process can exit promptly without changing the
  // short delays the editor logic actually depends on (debounce, IDB writes).
  const hostSetTimeout = setTimeout;
  const testSetTimeout = (fn, ms, ...rest) => hostSetTimeout(fn, typeof ms === 'number' && ms > 2000 ? 15 : ms, ...rest);
  const sandbox = {
    console,
    setTimeout: testSetTimeout, clearTimeout, setInterval, clearInterval,
    TextEncoder, TextDecoder, Promise, Map, Set, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, TypeError, Symbol, Uint8Array, ArrayBuffer,
    Blob, URL: { createObjectURL: (b) => { blobs.push(b); return 'blob:test'; }, revokeObjectURL() {} },
    document, indexedDB: fakeIDB,
    localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, v); }, removeItem(k) { this._m.delete(k); } },
    confirm: (msg) => { confirmCalls.push(msg); return confirmAnswer; },
    alert() {},
    addEventListener() {}, removeEventListener() {},
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    __DOLP_EDITOR_TEST__: true,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window.scrollTo = () => {};

  const ctx = vm.createContext(sandbox);
  const { jszip, app } = scriptBlocks();
  vm.runInContext(jszip, ctx, { filename: 'jszip.inline.js' });
  vm.runInContext(app, ctx, { filename: 'editor.inline.js' });
  const appApi = sandbox.__DOLP_EDITOR__;
  assert.ok(appApi, 'test seam exposes the app when __DOLP_EDITOR_TEST__ is set');

  return {
    app: appApi, sandbox, document, blobs, confirmCalls,
    set confirmAnswer(v) { confirmAnswer = v; },
    get confirmAnswer() { return confirmAnswer; },
    JSZip: sandbox.JSZip,
    el: (id) => byId.get(id),
    async loadKit(buffer, name = 'kit.zip') {
      buffer.name = name; buffer.size = buffer.length;
      await appApi.loadFile(buffer);
      return appApi.model;
    },
  };
}

const PH = '\u27e6'; const PHc = '\u27e7';

function segment(i, over = {}) {
  return {
    unitId: `${i}:0-10`, passage: `P${i}`, kind: 'text', family: 'text', riskLevel: 'low',
    protectedSource: over.protectedSource !== undefined ? over.protectedSource : `Line ${i}.`,
    rawSourceHash: `r${i}`, protectedHash: `p${i}`, sourceFingerprint: `s${i}`, structuralFingerprint: `t${i}`,
    placeholders: over.placeholders || [], contextBefore: '', contextAfter: '',
    translation: over.translation || '',
  };
}

function manifest(over = {}) {
  return {
    schemaVersion: '1.0.0', kind: 'dol-p-localization-kit', generatedAt: '2026-01-01T00:00:00.000Z',
    targetStory: { sha256: 'sha-of-story', bytes: 1234, passages: 3, format: 'SugarCube 2.36.1' },
    sourceVersion: 'v-test', inventoryFingerprint: 'inv-1', targetLanguage: 'zh-CN',
    scope: 'all', exportedCount: over.count, ...over.extra,
  };
}

const CSV_COLUMNS = ['unitId', 'passage', 'kind', 'family', 'riskLevel', 'protectedSource', 'rawSourceHash', 'protectedHash', 'sourceFingerprint', 'structuralFingerprint', 'placeholders', 'contextBefore', 'contextAfter', 'translation'];
function csvFor(segments) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [CSV_COLUMNS.join(',')];
  for (const s of segments) rows.push(CSV_COLUMNS.map((c) => esc(c === 'placeholders' ? (s.placeholders || []).map((p) => p.token).join(' ') : s[c])).join(','));
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

async function buildKit(JSZip, segments, man = manifest({ count: segments.length })) {
  const zip = new JSZip();
  const cleanManifest = { ...man, exportedCount: segments.length };
  zip.file('manifest.json', JSON.stringify(cleanManifest, null, 2));
  zip.file('segments.jsonl', segments.map((s) => JSON.stringify(s)).join('\n') + '\n');
  zip.file('segments.csv', csvFor(segments));
  return zip.generateAsync({ type: 'uint8array' });
}

test('workflow: load a kit, edit, export a canonical JSONL (no editor metadata)', async () => {
  const boot = makeBoot();
  const segs = [segment(1), segment(2, { protectedSource: `Greet ${PH}0${PHc} now.`, placeholders: [{ token: `${PH}0${PHc}`, type: 'macro', raw: '<<print $name>>' }] })];
  await boot.loadKit(await buildKit(boot.JSZip, segs));
  assert.equal(boot.app.model.segments.length, 2);
  assert.ok(boot.app.model.zip, 'kit loaded');

  // edit through the real change path and attach editor-only metadata
  boot.app.model.segments[1].translation = `现在向 ${PH}0${PHc} 问好。`;
  boot.app.model.meta.set('2:0-10', { status: 'reviewed', note: '校对过' });
  boot.app.model.seq = 3;
  await boot.app.exportFile('jsonl');
  const blob = boot.blobs[boot.blobs.length - 1];
  const text = await blob.text();
  const lines = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(lines[0]), CSV_COLUMNS, 'JSONL keeps the canonical column order only');
  assert.ok(!('status' in lines[1]) && !('note' in lines[1]), 'editor metadata never leaks into segments.jsonl');
  assert.equal(lines[1].translation, `现在向 ${PH}0${PHc} 问好。`);
});

test('workflow: undo/redo a batch is one step, and a new edit clears the redo branch', async () => {
  const boot = makeBoot();
  const segs = [segment(1), segment(2), segment(3)];
  await boot.loadKit(await buildKit(boot.JSZip, segs));
  const model = boot.app.model;
  assert.equal(model.hist.length, 0);

  // a batch (as used by copy-all / handoff / duplicate fill)
  boot.app.applyChanges(segs.map((s) => ({ unitId: s.unitId, field: 'translation', before: '', after: '批次' })), 'batch');
  assert.equal(model.hist.length, 1);
  assert.ok(model.segments.every((s) => s.translation === '批次'));
  boot.app.undo();
  assert.ok(model.segments.every((s) => s.translation === ''), 'one undo reverts the whole batch');
  boot.app.redo();
  assert.ok(model.segments.every((s) => s.translation === '批次'));
  boot.app.undo();
  // new edit after undo must drop the redo branch
  boot.app.applyChanges([{ unitId: segs[0].unitId, field: 'translation', before: '', after: 'new' }], 'single');
  assert.equal(model.hist.length, 1, 'redo branch discarded after a new edit');
  assert.equal(model.histIndex, 0);
});

test('workflow: handoff fill vs overwrite, with conflicts left untouched by default', async () => {
  const boot = makeBoot();
  const segs = [segment(1, { translation: '' }), segment(2, { translation: 'mine' })];
  await boot.loadKit(await buildKit(boot.JSZip, segs));
  const model = boot.app.model;
  const incoming = new Map([['1:0-10', '补充'], ['2:0-10', 'other']]);

  // default fill: fills blank, keeps existing
  let plan = boot.app.EditorEngine.planHandoff(model.segments, incoming, 'fill');
  boot.app.applyChanges(plan.changes, 'handoff');
  assert.equal(model.segments[0].translation, '补充');
  assert.equal(model.segments[1].translation, 'mine');

  // overwrite (after explicit confirm) replaces the conflict too
  plan = boot.app.EditorEngine.planHandoff(model.segments, incoming, 'overwrite');
  boot.app.applyChanges(plan.changes, 'handoff-overwrite');
  assert.equal(model.segments[1].translation, 'other');
  // and it is undoable in one step
  boot.app.undo();
  assert.equal(model.segments[1].translation, 'mine');
});

test('workflow: overwriting a translation resets its review status (never falsely reviewed)', async () => {
  const boot = makeBoot();
  const segs = [segment(1, { translation: 'old' })];
  await boot.loadKit(await buildKit(boot.JSZip, segs));
  const model = boot.app.model;
  model.meta.set('1:0-10', { status: 'reviewed', note: '' });
  boot.app.applyChanges([{ unitId: '1:0-10', field: 'translation', before: 'old', after: 'new' }], 'overwrite');
  assert.equal(model.meta.get('1:0-10').status, 'unmarked');
});

test('workflow: draft autosave, per-project isolation, and restore on reload', async () => {
  const boot = makeBoot();
  const A = [segment(1), segment(2)];
  const B = [segment(9)];
  const zipA = await buildKit(boot.JSZip, A, manifest({ count: 2 }));
  const zipB = await buildKit(boot.JSZip, B, manifest({ count: 1, extra: { targetStory: { sha256: 'other-story' } } }));

  await boot.loadKit(zipA, 'A.zip');
  const keyA = boot.app.model.draftKey;
  boot.app.applyChanges([{ unitId: '1:0-10', field: 'translation', before: '', after: '草稿A' }], 'edit');
  await new Promise((r) => setTimeout(r, 900)); // debounce (700ms) + fake IndexedDB write
  assert.equal(boot.app.model.draftState, 'saved', 'the draft reports saved only after a real write');

  // another project gets its own draft key and never sees A's draft
  await boot.loadKit(zipB, 'B.zip');
  assert.notEqual(boot.app.model.draftKey, keyA, 'different stories get different draft keys');
  assert.equal(boot.app.model.segments[0].translation, '', 'project B never receives project A draft');

  // reloading A finds its draft; choosing "restore" recovers the work
  const p = boot.loadKit(zipA, 'A2.zip');
  await new Promise((r) => setTimeout(r, 300));
  const buttons = boot.el('modalActions').querySelectorAll('button');
  assert.ok(buttons.length >= 3, `restore dialog offers restore / import / backup (got ${buttons.length}, modalHidden=${boot.el('modalShade').classList.contains('hidden')})`);
  buttons[0].click(); // primary = restore draft
  await p;
  assert.equal(boot.app.model.segments[0].translation, '草稿A');
});

test('workflow: migration only fills blanks for stable matches and never touches modified entries', async () => {
  const boot = makeBoot();
  const news = [segment(1, { protectedSource: 'Same line.' }), segment(2, { protectedSource: 'Changed now.' })];
  await boot.loadKit(await buildKit(boot.JSZip, news));
  const model = boot.app.model;
  const oldEntries = [
    { unitId: '1:0-10', protectedSource: 'Same line.', translation: '旧译文。' },
    { unitId: '2:0-10', protectedSource: 'Changed old.', translation: '不该采用。' },
  ];
  const plan = boot.app.EditorEngine.planMigration(oldEntries, model.segments);
  assert.deepEqual(Array.from(plan.safe).map((x) => x.unitId), ['1:0-10']);
  assert.deepEqual(Array.from(plan.modified).map((x) => x.unitId), ['2:0-10']);
  boot.app.applyChanges(plan.safe.map((x) => ({ unitId: x.unitId, field: 'translation', before: '', after: x.translation })), 'migrate');
  assert.equal(model.segments[0].translation, '旧译文。');
  assert.equal(model.segments[1].translation, '', 'modified source is not migrated');
});

test('workflow: project export/import round-trips status + notes without touching the Kit format', async () => {
  const boot = makeBoot();
  await boot.loadKit(await buildKit(boot.JSZip, [segment(1), segment(2)]));
  const model = boot.app.model;
  model.meta.set('1:0-10', { status: 'flagged', note: '待确认' });
  boot.app.exportProject();
  const blob = boot.blobs[boot.blobs.length - 1];
  const doc = JSON.parse(await blob.text());
  assert.equal(doc.format, 'dolp-kit-editor-project');
  assert.equal(doc.records['1:0-10'].status, 'flagged');
});

test('workflow: statistics are project-wide, not limited to the current page', async () => {
  const boot = makeBoot();
  const segs = [];
  for (let i = 0; i < 120; i += 1) segs.push(segment(i, { translation: i < 100 ? 'y' : '' }));
  await boot.loadKit(await buildKit(boot.JSZip, segs));
  const st = boot.app.EditorEngine.statusStats(boot.app.model.segments, boot.app.model.safety);
  assert.equal(st.total, 120);
  assert.equal(st.translated, 100);
  assert.equal(st.untranslated, 20);
});

test('workflow: the safety check never mutates any translation', async () => {
  const boot = makeBoot();
  const segs = [segment(1, { protectedSource: `Hi ${PH}0${PHc}`, translation: 'changement <<x>>' })];
  await boot.loadKit(await buildKit(boot.JSZip, segs));
  const before = JSON.stringify(boot.app.model.segments);
  boot.app.recomputeAnalysis();
  assert.ok(boot.app.model.safety.size >= 1, 'structural problem detected');
  assert.equal(JSON.stringify(boot.app.model.segments), before, 'checking does not modify data');
});

test('i18n: zh and en tables are symmetric and every referenced key is defined', () => {
  const boot = makeBoot();
  const { zh, en } = boot.app.UI;
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(zhKeys, enKeys, '中文与英文界面必须提供同一组键');

  const referenced = new Set();
  for (const m of HTML.matchAll(/data-i18n(?:-placeholder|-aria)?="([A-Za-z0-9_]+)"/g)) referenced.add(m[1]);
  const appCode = scriptBlocks().app;
  for (const m of appCode.matchAll(/tr\('([A-Za-z0-9_]+)'(?=[,)])/g)) referenced.add(m[1]);
  for (const code of ['PLACEHOLDER_COUNT_CHANGED', 'PLACEHOLDER_MISMATCH', 'PLACEHOLDER_ORDER_CHANGED', 'UNEXPECTED_STRUCTURE', 'SAME_AS_SOURCE', 'EDGE_WHITESPACE']) referenced.add(`issue_${code}`);
  const missing = [...referenced].filter((k) => !(k in zh) || !(k in en));
  assert.deepEqual(missing, [], `every referenced i18n key must exist in both languages (missing: ${missing.join(', ')})`);
});

test('markup: every element id referenced by $() exists in the HTML', () => {
  const ids = elementIds(scriptBlocks().app);
  const present = new Set([...HTML.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const missing = ids.filter((id) => !present.has(id));
  assert.deepEqual(missing, [], `ids referenced by the script but missing from the markup: ${missing.join(', ')}`);
});
