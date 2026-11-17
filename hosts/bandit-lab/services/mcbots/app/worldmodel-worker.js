'use strict';
// World model, worker side: long-polls the BotUi plugin for section batches, keeps them in the SQLite store and
// answers requests. All decoding and SQLite of the world model happen here, never on the hub's main loop;
// worldmodel.js starts this file as a thread and only relays buffers.
const zlib = require('node:zlib');
const {setTimeout: sleepFor} = require('node:timers/promises');
const {isMainThread, parentPort, workerData} = require('node:worker_threads');
const {decodeBatch, encodeBatch, decodeSection, SY_MIN, SY_MAX} = require('./worldsection');
const {makeQuery, parseBox, BadQuery, TooBig} = require('./worldquery');
const {openStore} = require('./worldstore');

const JSON_TYPE = 'application/json';
const R_MAX = 8, CHANGES_LIMIT = 1024, CHUNK_MAX = 1875000; // 30M / 16
const PULL_WAIT_S = 25, PULL_TIMEOUT_MS = 35000, PLUGIN_TIMEOUT_MS = 33000; // under the client's 35 s request timeout
const RETRY_MS = 2000, SEQ_MS = 1000;

const json = (status, obj) => ({status, type: JSON_TYPE, body: Buffer.from(JSON.stringify(obj))});
function int(v) { // query strings arrive as strings, in-process callers as numbers
  const n = typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n)) throw new BadQuery('bad number');
  return n;
}
const chunkCoord = (v) => { const n = int(v); if (Math.abs(n) > CHUNK_MAX) throw new BadQuery('bad chunk'); return n; };
// kind 0 is a section; 1 an ungenerated chunk, 2 an unknown one (hub -> browser only); 1 and 2 sit at sy 0
const valid = (r) => (r.kind === 0 ? r.sy >= SY_MIN && r.sy <= SY_MAX : r.sy === 0);

function makeModel({store, fetch, url, token, area, now = Date.now, lru = 2048, signal}) {
  const cache = new Map(); // "cx,sy,cz" -> decoded section, least recently used first; never holds a frame
  const auth = {authorization: 'Bearer ' + token};
  const limit = (ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
  let boot = null, ack = 0, badRecords = 0, lastPull = null, lastChange = null;

  function section(cx, sy, cz) {
    const key = `${cx},${sy},${cz}`;
    let s = cache.get(key);
    if (s) cache.delete(key);
    else {
      const blob = store.get(cx, sy, cz);
      if (!blob) return null;
      s = decodeSection(blob);
    }
    cache.set(key, s);
    if (cache.size > lru) cache.delete(cache.keys().next().value);
    return s;
  }
  const query = makeQuery({section, chunk: (cx, cz) => store.chunk(cx, cz)});

  // One long poll. Returns how many records changed the store. A frame that does not decode, a non-ok reply or
  // a failed batch throws before ack moves, so the plugin sends the same batch again.
  async function pullOnce() {
    const res = await fetch(`${url}/world/pull?ack=${ack}&wait=${PULL_WAIT_S}&area=${area.cx1},${area.cz1},${area.cx2},${area.cz2}`, {headers: auth, signal: limit(PULL_TIMEOUT_MS)});
    if (!res.ok) throw new Error('pull: HTTP ' + res.status);
    const frame = decodeBatch(Buffer.from(await res.arrayBuffer()));
    const keep = frame.records.filter(valid);
    badRecords += frame.records.length - keep.length;
    let changed = 0;
    store.tx(() => { // the store copies what it binds, so nothing of the frame outlives this call
      for (const r of keep) {
        if (r.kind === 0 ? store.put(r.cx, r.sy, r.cz, r.hash, r.blob) : r.kind === 1 && store.markUngenerated(r.cx, r.cz)) changed++;
        if (r.kind === 0) cache.delete(`${r.cx},${r.sy},${r.cz}`);
      }
    });
    if (frame.boot !== boot) { boot = frame.boot; ack = 0; } // the plugin restarted: its batch numbers start over
    if (frame.records.length) ack = frame.batch;
    lastPull = now();
    if (changed) lastChange = lastPull;
    return changed;
  }

  const stats = () => ({boot: boot === null ? null : String(boot), ack, badRecords, seq: store.seq(), ...store.counts(), lru: cache.size, lastPull, lastChange});

  // GET (or POST a JSON body) to the plugin: {status, body}, or null when it did not answer.
  async function plugin(path, post) {
    try {
      const res = await fetch(`${url}/world/${path}`, {
        method: post === undefined ? 'GET' : 'POST',
        headers: post === undefined ? auth : {...auth, 'content-type': JSON_TYPE},
        body: post === undefined ? undefined : JSON.stringify(post),
        signal: limit(PLUGIN_TIMEOUT_MS),
      });
      return {status: res.status, type: JSON_TYPE, body: Buffer.from(await res.arrayBuffer())};
    } catch { return null; }
  }
  const down = (extra) => json(502, {error: 'plugin unreachable', ...extra});

  const ops = {
    sections(a) {
      const cx = chunkCoord(a.cx), cz = chunkCoord(a.cz), r = int(a.r);
      if (r < 0 || r > R_MAX) return json(413, {error: `r ${r} outside 0..${R_MAX}`});
      const records = [];
      for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
        const st = store.chunk(x, z);
        if (st === 'known') for (const {sy, hash, blob} of store.column(x, z)) records.push({kind: 0, cx: x, sy, cz: z, hash, blob});
        else records.push({kind: st === 'ungenerated' ? 1 : 2, cx: x, sy: 0, cz: z});
      }
      return {status: 200, type: 'application/octet-stream', body: zlib.gzipSync(encodeBatch({boot: boot ?? 0n, batch: 0, records})), gzip: true};
    },
    changes(a) {
      const since = int(a.since);
      if (since < 0) throw new BadQuery('bad since');
      return json(200, store.since(since, a.limit === undefined ? CHANGES_LIMIT : Math.min(CHANGES_LIMIT, Math.max(1, int(a.limit)))));
    },
    blocks: (a) => json(200, query.blocks(a)),
    height: (a) => json(200, query.height(a)),
    materials: (a) => json(200, query.materials(a)),
    async sample(a) {
      const p = new URLSearchParams(Object.entries({n: a.n, seed: a.seed, box: a.box}).filter(([, v]) => v !== undefined)).toString();
      return (await plugin('sample' + (p && '?' + p))) ?? down();
    },
    async stats() {
      const r = await plugin('stats');
      if (!r) return down({hub: stats()});
      try { return json(r.status, {hub: stats(), plugin: JSON.parse(r.body)}); } catch { return down({hub: stats()}); }
    },
    async dirty(a) { return (await plugin('dirty', parseBox(a.box ?? {}))) ?? down(); },
  };

  // Never rejects: every failure is an answer with a status.
  async function handle(op, args) {
    if (!Object.hasOwn(ops, op)) return json(404, {error: 'unknown op'});
    try { return await ops[op](args ?? {}); } catch (e) {
      if (e instanceof BadQuery) return json(400, {error: e.message});
      if (e instanceof TooBig) return json(413, {error: e.message});
      return json(500, {error: 'world model failed: ' + e.message});
    }
  }

  return {pullOnce, handle, stats};
}

// A pooled Buffer shares its ArrayBuffer with others and cannot be transferred; only those are copied.
const transferable = (b) => (b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

function run() {
  const {dir, url, token, area} = workerData;
  const store = openStore(dir);
  const ac = new AbortController();
  const model = makeModel({store, fetch, url, token, area, signal: ac.signal});
  const post = (msg, transfer) => parentPort.postMessage(msg, transfer);
  let stopping = false, seqTimer = null, lastSeq = 0;

  // at most one seq message a second, the last change always gets through
  function postSeq() {
    if (seqTimer) return;
    seqTimer = setTimeout(() => { seqTimer = null; lastSeq = Date.now(); post({t: 'seq', seq: store.seq()}); }, Math.max(0, lastSeq + SEQ_MS - Date.now()));
  }

  const loop = (async () => {
    let failed = null;
    postSeq();
    while (!stopping) {
      try {
        const changed = await model.pullOnce();
        if (changed) postSeq();
        if (failed) post({t: 'log', msg: 'world: pull works again'});
        failed = null;
      } catch (e) {
        if (stopping) break;
        if (e.message !== failed) post({t: 'log', msg: 'world: pull failed, retrying: ' + e.message});
        failed = e.message;
        await sleepFor(RETRY_MS, undefined, {signal: ac.signal}).catch(() => {});
      }
    }
  })();

  async function stop() {
    if (stopping) return;
    stopping = true;
    ac.abort();
    clearTimeout(seqTimer);
    await loop;
    store.close();
    post({t: 'stopped'}); // the client terminates the thread now
  }

  parentPort.on('message', async (m) => {
    if (m.t === 'stop') return stop();
    if (stopping) return;
    if (m.t === 'dirty') { await model.handle('dirty', {box: m.box}); return; }
    const res = await model.handle(m.op, m.args);
    const body = transferable(res.body);
    post({id: m.id, status: res.status, type: res.type, gzip: res.gzip, body}, [body]);
  });
}

if (!isMainThread && require.main === module) run();

module.exports = {makeModel};
