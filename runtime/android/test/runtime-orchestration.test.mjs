import test from 'node:test';
import assert from 'node:assert/strict';

import { waitForReady, parseArgs } from '../test-localization-runtime.mjs';
import { SCRIPT_SNAPSHOT } from '../lib/modloader-scripts.mjs';

/** Fake deps with a virtual clock that advances on sleep. */
function fakeDeps({ connectResults, evaluate }) {
  let t = 0;
  let connectCalls = 0;
  return {
    deps: {
      now: () => ({ getTime: () => t }),
      sleep: async (ms) => { t += ms; },
      connect: async () => {
        const r = connectResults[Math.min(connectCalls, connectResults.length - 1)];
        connectCalls += 1;
        return typeof r === 'function' ? r() : r;
      },
      evaluate,
    },
    stats: () => ({ connectCalls, t }),
  };
}

test('waitForReady retries connect across a WebView reload gap', async () => {
  const { deps, stats } = fakeDeps({
    connectResults: [
      { ok: false, code: 'GAME_NOT_RUNNING' },
      { ok: false, code: 'GAME_NOT_RUNNING' },
      { ok: true, endpoint: 'ws://127.0.0.1:50806/devtools/page/1' },
    ],
    evaluate: async (_endpoint, expr) => expr.includes('modUtils'),
  });
  const r = await waitForReady(deps, { timeoutMs: 60000, pollMs: 1000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(stats().connectCalls >= 3, `expected >=3 connect attempts, got ${stats().connectCalls}`);
});

test('waitForReady reconnects when evaluate throws after a reload', async () => {
  let evalCalls = 0;
  const { deps } = fakeDeps({
    connectResults: [{ ok: true, endpoint: 'ws://x/1' }],
    evaluate: async () => {
      evalCalls += 1;
      if (evalCalls === 1) throw new Error('CDP_UNREACHABLE');
      return true;
    },
  });
  const r = await waitForReady(deps, { timeoutMs: 60000, pollMs: 1000 });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('waitForReady returns not-ok on timeout instead of hanging', async () => {
  const { deps } = fakeDeps({
    connectResults: [{ ok: false, code: 'ADB_FAILED' }],
    evaluate: async () => false,
  });
  const r = await waitForReady(deps, { timeoutMs: 5000, pollMs: 1000 });
  assert.equal(r.ok, false);
  assert.equal(r.lastError, 'ADB_FAILED');
});

test('parseArgs: level defaults to exhaustive and rejects an unknown level', () => {
  assert.equal(parseArgs([]).level, 'exhaustive');
  assert.throws(() => parseArgs(['--level', 'bogus']));
  assert.equal(parseArgs(['--level', 'smoke']).level, 'smoke');
});

test('SCRIPT_SNAPSHOT awaits modUtilsVersion (regression: a missing await yielded a Promise)', async () => {
  const controller = {
    listModIndexDB: async () => ['DOLI'],
    loadHiddenModList: async () => [],
  };
  const fakeWindow = {
    modUtils: {
      version: '9.9.9',
      getModListName: () => ['DOLI'],
      getModLoadController: () => controller,
    },
    State: { passage: 'Start2' },
  };
  const fakeDocument = { querySelectorAll: () => [] };
  // SCRIPT_SNAPSHOT is an async IIFE that only touches window/State/document.
  const run = new Function('window', 'State', 'document', `return ${SCRIPT_SNAPSHOT};`);
  const result = await run(fakeWindow, fakeWindow.State, fakeDocument);
  assert.equal(result.modUtilsVersion, '9.9.9');
  assert.equal(typeof result.modUtilsVersion, 'string');
  assert.deepEqual(result.listModIndexDB, ['DOLI']);
});
