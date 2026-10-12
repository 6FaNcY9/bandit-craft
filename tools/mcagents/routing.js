'use strict';
// Which model backends a caller may use (owner, 2026-10-11). The lab GPU (Ollama, 11434) and the gaming PC
// "slayer" serve the live agents and the solver; "albert" (ANDY_OFFLINE_NAMES) is reserved for the idle
// replay, the judge and training. The same ANDY_URLS / ANDY_BACKEND_NAMES lists feed both paths; this
// file splits them, and both paths refuse the other's backends.
const OLLAMA_PORT = '11434';

// Offline work only ever talks to a loopback llama-server port, never Ollama.
function backendBase(url) {
  const u = new URL(url);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port === OLLAMA_PORT || !u.port) throw new Error(`Refusing backend ${url}: only loopback llama-server ports, never Ollama (${OLLAMA_PORT})`);
  return `http://${u.host}`;
}

const list = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const offlineNames = (env = process.env) => new Set(list(env.ANDY_OFFLINE_NAMES));

// [{name, url}] of the configured gaming PCs (not Ollama), in ANDY_URLS order.
function pcs(env = process.env) {
  const names = (env.ANDY_BACKEND_NAMES || '').split(',').map((s) => s.trim());
  return list(env.ANDY_URLS || env.ANDY_URL_2).map((url, i) => ({url, name: names[i] || new URL(url).host}));
}

// The backends of the offline path: only the ANDY_OFFLINE_NAMES ones (all PCs if none is named).
function offlineTargets(env = process.env) {
  const off = offlineNames(env);
  return pcs(env).filter((p) => !off.size || off.has(p.name)).map((p) => ({...p, url: backendBase(p.url)}));
}

// Batch work (replay, judge) takes only the GPU share a PC gives it, and waits while it gives none (owner
// 2026-10-12: Minecraft on slayer stuttered under a replay pass at 100 % GPU). The PC's watcher
// (tools/slayer/watch.ps1) publishes {share: 0..1, at, ...} as /gpu.json next to llama-server: what its own
// programs leave free, capped while someone uses the PC, and by the packet rule (albert). 1 for a PC that
// publishes nothing (404, an older watcher), 0 for a stale or unreadable status and below MIN_SHARE.
const MIN_SHARE = 0.15;
async function gpuShare(base, {timeoutMs = 3000, staleMs = 90000, now = Date.now()} = {}) {
  let res;
  try { res = await fetch(`${base}/gpu.json`, {redirect: 'error', signal: AbortSignal.timeout(timeoutMs)}); } catch { return 0; }
  if (res.status === 404) return 1;
  const s = res.status === 200 ? await res.json().catch(() => null) : null;
  if (!Number.isFinite(s?.share) || !(now - Date.parse(s.at) < staleMs)) return 0;
  const share = Math.min(1, s.share);
  return share < MIN_SHARE ? 0 : share;
}

// Call pace() before each request: it waits (polling, up to maxWaitMs) until the PC has GPU to spare and
// returns rest(), to await after the request: it idles so the batch keeps to that share (a 40 % share
// rests 600 ms per 400 ms of work). pace() returns null when nothing came free in time.
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
function gpuPacer(base, {maxWaitMs = 5 * 60000, pollMs = 15000, ...opts} = {}) {
  return async () => {
    const until = Date.now() + maxWaitMs;
    let share;
    while (!(share = await gpuShare(base, opts))) {
      if (Date.now() + pollMs > until) return null;
      await sleep(pollMs);
    }
    const t0 = Date.now();
    return () => sleep(share < 1 ? (Date.now() - t0) * (1 - share) / share : 0);
  };
}

module.exports = {OLLAMA_PORT, backendBase, offlineNames, offlineTargets, pcs, gpuShare, gpuPacer};
