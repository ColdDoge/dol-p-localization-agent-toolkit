/*
 * Chrome DevTools Protocol helpers for the game WebView.
 *
 * The endpoint must always be loopback; we never expose CDP elsewhere.
 * `resolveGameTargets` matches the game page by a user-supplied title prefix
 * (there is no built-in game name) and refuses to guess when it is ambiguous.
 */

export const DEFAULT_TITLE_PREFIX = process.env.TOOLKIT_TARGET_TITLE_PREFIX || null;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isLoopbackUrl(raw, protocols) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (protocols && !protocols.includes(url.protocol)) return false;
  return LOOPBACK.has(url.hostname);
}

/**
 * Choose the single game page target.
 * @returns {{ok:boolean, code?:string, target?:object, candidates?:object[]}}
 */
export function resolveGameTargets(targets, { titlePrefix = DEFAULT_TITLE_PREFIX } = {}) {
  const list = Array.isArray(targets) ? targets : [];
  const allPages = list.filter((t) => t && t.type === 'page' && typeof t.title === 'string');
  const pages = titlePrefix
    ? allPages.filter((t) => t.title.startsWith(titlePrefix))
    : allPages;
  if (pages.length === 0) {
    return {
      ok: false,
      code: 'CDP_TARGET_MISSING',
      candidates: list.map((t) => ({ type: t?.type, title: t?.title, url: t?.url })),
    };
  }
  if (pages.length > 1) {
    return {
      ok: false,
      code: 'CDP_TARGET_AMBIGUOUS',
      candidates: pages.map((t) => ({ title: t.title, url: t.url, id: t.id })),
    };
  }
  const target = pages[0];
  if (target.webSocketDebuggerUrl && !isLoopbackUrl(target.webSocketDebuggerUrl, ['ws:', 'wss:'])) {
    return { ok: false, code: 'CDP_SOCKET_NOT_LOCAL', candidates: [{ title: target.title, url: target.webSocketDebuggerUrl }] };
  }
  return { ok: true, target };
}

export function buildEndpoint(port, host = '127.0.0.1') {
  const url = new URL(`http://${host}:${port}`);
  if (!LOOPBACK.has(url.hostname)) throw new Error('CDP endpoint must be loopback');
  return url;
}

export async function fetchTargets(endpoint, { timeoutMs = 15000, fetchImpl = globalThis.fetch } = {}) {
  const url = new URL('/json/list', endpoint);
  if (!LOOPBACK.has(url.hostname)) throw new Error('CDP endpoint must be loopback');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable in this Node runtime');
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`CDP target listing failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Evaluate JavaScript in the page and return the value.
 * @param {URL} endpoint  loopback http endpoint (already forwarded)
 * @param {string} source JS expression/IIFE to evaluate
 */
export async function evaluate(endpoint, source, { timeoutMs = 60000, fetchImpl, WebSocketImpl = globalThis.WebSocket } = {}) {
  const targets = await fetchTargets(endpoint, { timeoutMs, fetchImpl });
  const resolved = resolveGameTargets(targets);
  if (!resolved.ok) {
    const error = new Error(`${resolved.code}: ${JSON.stringify(resolved.candidates)}`);
    error.code = resolved.code;
    throw error;
  }
  const socketUrl = new URL(resolved.target.webSocketDebuggerUrl);
  if (!isLoopbackUrl(socketUrl.href, ['ws:', 'wss:'])) throw new Error('CDP WebSocket must be loopback');
  if (typeof WebSocketImpl !== 'function') throw new Error('WebSocket is unavailable in this Node runtime');

  const socket = new WebSocketImpl(socketUrl);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP evaluation timeout')), timeoutMs);
      const finish = (error, value) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      };
      socket.onerror = () => finish(new Error('CDP connection failed'));
      socket.onclose = () => finish(new Error('CDP connection closed before result'));
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: { expression: source, awaitPromise: true, returnByValue: true },
          }),
        );
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.id !== 1) return;
          if (message.error || message.result?.exceptionDetails) {
            finish(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
          } else {
            finish(null, message.result.result.value);
          }
        } catch (error) {
          finish(error);
        }
      };
    });
  } finally {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
  }
}
