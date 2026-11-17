'use strict';
// World model worker: pull loop, request handler (fake fetch, no thread), then the main-thread client with a fake
// Worker and once against a real thread and a loopback fake of the plugin.
const assert = require('node:assert');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {encodeBatch, decodeBatch, encodeSection, sectionHash} = require('../worldsection');
const {openStore} = require('../worldstore');
const {makeModel} = require('../worldmodel-worker');
const {startWorldModel} = require('../worldmodel');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, what) {
  for (const end = Date.now() + 8000; Date.now() < end; await sleep(10)) if (f()) return; // wall clock: the suite blocks the loop while other parts run
  throw new Error('timeout: ' + what);
}
const sec = (state) => { const blob = encodeSection([state], null); return {hash: sectionHash(blob), blob}; };
const STONE = sec('minecraft:stone');
const frame = (boot, batch, records) => encodeBatch({boot, batch, records});
const chunk24 = (cx, cz, s = STONE) => Array.from({length: 24}, (_, i) => ({kind: 0, cx, sy: i - 4, cz, ...s}));
const area = {cx1: -37, cz1: -22, cx2: 3, cz2: 18};
const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'world-model-')); dirs.push(d); return d; };

// A fake fetch fed from a queue: Buffer = frame, Error = network failure, number = HTTP status.
function feed(replies) {
  const urls = [];
  return {urls, fetch: async (u, o) => {
    urls.push(u);
    assert.strictEqual(o.headers.authorization, 'Bearer t');
    const r = replies.shift();
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return {ok: false, status: r};
    return {ok: true, status: 200, arrayBuffer: async () => r};
  }};
}

async function inline() {
  const store = openStore(tmp());
  try {
    // two batches, then the plugin restarts
    const urls = [];
    const replies = [frame(1n, 1, chunk24(-37, -22)), frame(1n, 2, [{kind: 1, cx: 3, sy: 0, cz: 18}]), frame(2n, 1, chunk24(-37, -22))];
    const m = makeModel({store, url: 'http://p', token: 't', area: {cx1: -37, cz1: -22, cx2: 3, cz2: 18},
      fetch: async (u, o) => { urls.push(u); assert.strictEqual(o.headers.authorization, 'Bearer t'); return {ok: true, arrayBuffer: async () => replies.shift()}; }});
    assert.strictEqual(await m.pullOnce(), 24);
    assert.match(urls[0], /\/world\/pull\?ack=0&wait=25&area=-37,-22,3,18$/);
    await m.pullOnce(); assert.match(urls[1], /ack=1&/);
    const seq = store.seq();
    assert.strictEqual(await m.pullOnce(), 0);                 // new boot, same content: nothing changes
    assert.strictEqual(store.seq(), seq); assert.match(urls[2], /ack=2&/);
    replies.push(frame(2n, 2, [])); await m.pullOnce(); assert.match(urls[3], /ack=1&/);   // ack follows the new boot
    // requests
    let r = await m.handle('sections', {cx: -37, cz: -22, r: 1});
    const out = decodeBatch(zlib.gunzipSync(r.body));
    assert.strictEqual(out.records.filter((x) => x.kind === 0).length, 24);
    assert.strictEqual(out.records.filter((x) => x.kind === 2).length, 8);          // 3x3 minus the known one
    assert.strictEqual((await m.handle('sections', {cx: 0, cz: 0, r: 9})).status, 413);
    r = await m.handle('blocks', {x1: '-592', y1: '0', z1: '-352', x2: '-577', y2: '0', z2: '-337'});
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(JSON.parse(r.body).unknown, []);
    assert.strictEqual((await m.handle('blocks', {x1: 'x'})).status, 400);
    assert.strictEqual((await m.handle('materials', {x1: '0', y1: '-64', z1: '0', x2: '127', y2: '319', z2: '127'})).status, 413);
    assert.deepStrictEqual(JSON.parse((await m.handle('changes', {since: String(store.seq())})).body).sections, []);
    assert.strictEqual((await makeModel({store, url: 'http://p', token: 't', area, fetch: async () => { throw new Error('down'); }}).handle('stats', {})).status, 502);
    // LRU stays bounded
    const small = makeModel({store, fetch, url: 'http://p', token: 't', area, lru: 2});
    for (let sy = -4; sy < 4; sy++) await small.handle('blocks', {x1: '-592', y1: String(sy * 16), z1: '-352', x2: '-592', y2: String(sy * 16), z2: '-352'});
    assert.strictEqual(small.stats().lru, 2);

    // response shapes: sections is a gzipped frame with batch 0, the rest is JSON
    r = await m.handle('sections', {cx: '-37', cz: '-22', r: '0'});
    assert.deepStrictEqual([r.status, r.type, r.gzip], [200, 'application/octet-stream', true]);
    assert.strictEqual(decodeBatch(zlib.gunzipSync(r.body)).batch, 0);
    assert.strictEqual((await m.handle('sections', {cx: '-37', cz: '-22', r: '-1'})).status, 413);   // outside 0..8
    for (const bad of [{cx: 'x', cz: '0', r: '1'}, {cx: '0', cz: '0', r: '1.5'}, {cz: '0', r: '1'}, {cx: '99999999', cz: '0', r: '1'}]) assert.strictEqual((await m.handle('sections', bad)).status, 400);
    const ungen = decodeBatch(zlib.gunzipSync((await m.handle('sections', {cx: 3, cz: 18, r: 0})).body)).records;
    assert.deepStrictEqual(ungen, [{kind: 1, cx: 3, sy: 0, cz: 18}]);                          // marked above
    r = await m.handle('changes', {since: '0'});
    assert.deepStrictEqual([r.status, r.type, JSON.parse(r.body).sections.length], [200, 'application/json', 24]);
    assert.strictEqual((await m.handle('changes', {since: '-1'})).status, 400);
    assert.strictEqual(JSON.parse((await m.handle('changes', {since: '0', limit: '0'})).body).sections.length, 1);   // clamped to 1
    assert.strictEqual(JSON.parse((await m.handle('changes', {since: '0', limit: '99999'})).body).sections.length, 24); // clamped to 1024
    assert.strictEqual((await m.handle('nope', {})).status, 404);
    assert.strictEqual((await m.handle('constructor', {})).status, 404);
    assert.strictEqual((await m.handle('height', undefined)).status, 400);
    const st = m.stats();
    assert.deepStrictEqual([st.boot, st.ack, st.sections, st.ungenerated, st.seq, st.badRecords], ['2', 1, 24, 1, 24, 0]);
    JSON.stringify(st);                                                                       // plain JSON: no bigint left in it
  } finally { store.close(); }
}

async function pulls() {
  const store = openStore(tmp());
  try {
    // records are validated before they are stored: kind 0 sy -4..19, kind 1 and 2 sy 0
    let {urls, fetch: f} = feed([frame(1n, 1, [...chunk24(0, 0), {kind: 0, cx: 0, sy: 20, cz: 0, ...STONE}, {kind: 0, cx: 1, sy: -5, cz: 0, ...STONE},
      {kind: 1, cx: 5, sy: 3, cz: 5}, {kind: 2, cx: 6, sy: -1, cz: 6}, {kind: 2, cx: 7, sy: 0, cz: 7}])]);
    let m = makeModel({store, fetch: f, url: 'http://p', token: 't', area});
    assert.strictEqual(await m.pullOnce(), 24);
    assert.strictEqual(m.stats().badRecords, 4);
    assert.strictEqual(store.get(0, 20, 0), null); assert.strictEqual(store.chunk(5, 5), 'unknown'); assert.strictEqual(store.chunk(7, 7), 'unknown'); // kind 2 is hub -> browser only: not stored
    assert.strictEqual(store.chunk(0, 0), 'known');

    // a frame that does not decode, a non-ok reply and a network error leave ack alone; the next good frame moves it
    const q = [Buffer.from('garbage'), 503, new Error('down'), frame(1n, 1, [{kind: 1, cx: 9, sy: 0, cz: 9}]), frame(1n, 3, [{kind: 1, cx: 9, sy: 0, cz: 9}]).subarray(0, 20), frame(1n, 2, [])];
    ({urls, fetch: f} = feed(q));
    m = makeModel({store, fetch: f, url: 'http://p', token: 't', area});
    await assert.rejects(m.pullOnce(), /bad batch/); await assert.rejects(m.pullOnce(), /HTTP 503/); await assert.rejects(m.pullOnce(), /down/);
    assert.strictEqual(await m.pullOnce(), 1);                                                // acks batch 1
    await assert.rejects(m.pullOnce());                                                       // truncated: still ack 1
    assert.strictEqual(await m.pullOnce(), 0);                                                // empty frame, batch 2
    assert.deepStrictEqual(urls.map((u) => u.match(/ack=(\d+)/)[1]), ['0', '0', '0', '0', '1', '1']);

    // an empty frame of a new boot sends ack back to 0; an empty frame of the same boot leaves it
    ({urls, fetch: f} = feed([frame(1n, 5, [{kind: 1, cx: 9, sy: 0, cz: 9}]), frame(1n, 0, []), frame(2n, 0, []), frame(2n, 0, [])]));
    m = makeModel({store, fetch: f, url: 'http://p', token: 't', area});
    for (let i = 0; i < 4; i++) await m.pullOnce();
    assert.deepStrictEqual(urls.map((u) => u.match(/ack=(\d+)/)[1]), ['0', '5', '5', '0']);

    // all records of a batch go through one transaction; a failure inside rolls the batch back and does not ack
    let txs = 0, puts = 0;
    const spy = {...store, tx: (fn) => { txs++; return store.tx(fn); }, put: (...a) => { if (++puts === 3) throw new Error('disk full'); return store.put(...a); }};
    ({urls, fetch: f} = feed([frame(1n, 1, chunk24(20, 20)), frame(1n, 1, chunk24(20, 20))]));
    m = makeModel({store: spy, fetch: f, url: 'http://p', token: 't', area});
    await assert.rejects(m.pullOnce(), /disk full/);
    assert.strictEqual(txs, 1); assert.strictEqual(store.chunk(20, 20), 'unknown'); assert.strictEqual(store.get(20, -4, 20), null);
    assert.strictEqual(await m.pullOnce(), 24);                                              // the two puts before the failure were rolled back, so all 24 are new again
    assert.strictEqual(txs, 2); assert.match(urls[1], /ack=0&/);
  } finally { store.close(); }
}

async function cache() {
  const store = openStore(tmp());
  try {
    const DIRT = sec('minecraft:dirt');
    const {fetch: f} = feed([frame(1n, 1, chunk24(0, 0)), frame(1n, 2, [{kind: 0, cx: 0, sy: 0, cz: 0, ...DIRT}])]);
    const m = makeModel({store, fetch: f, url: 'http://p', token: 't', area});
    await m.pullOnce();
    const top = async () => JSON.parse((await m.handle('blocks', {x1: '0', y1: '0', z1: '0', x2: '0', y2: '0', z2: '0'})).body).palette;
    assert.deepStrictEqual(await top(), ['minecraft:stone']);
    assert.strictEqual(m.stats().lru, 1);
    await m.pullOnce();                                                                       // the section changes: the decoded copy must not outlive it
    assert.deepStrictEqual(await top(), ['minecraft:dirt']);
  } finally { store.close(); }
}

async function proxies() {
  const store = openStore(tmp());
  try {
    const calls = [];
    const plugin = (status, body) => async (u, o) => { calls.push({u, o}); return {ok: status < 400, status, arrayBuffer: async () => Buffer.from(JSON.stringify(body))}; };
    let m = makeModel({store, fetch: plugin(200, {importLeft: 0}), url: 'http://p', token: 't', area});
    let r = await m.handle('stats', {});
    assert.deepStrictEqual([r.status, JSON.parse(r.body).plugin, JSON.parse(r.body).hub.sections], [200, {importLeft: 0}, 0]);
    assert.strictEqual(calls[0].u, 'http://p/world/stats'); assert.strictEqual(calls[0].o.headers.authorization, 'Bearer t');
    m = makeModel({store, fetch: plugin(200, {samples: [], skipped: 0}), url: 'http://p', token: 't', area});
    r = await m.handle('sample', {n: '500', seed: '7', box: '1,2,3,4,5,6'});
    assert.deepStrictEqual([r.status, r.type, JSON.parse(r.body)], [200, 'application/json', {samples: [], skipped: 0}]);
    assert.strictEqual(calls[1].u, 'http://p/world/sample?n=500&seed=7&box=1%2C2%2C3%2C4%2C5%2C6');
    await m.handle('sample', {n: '5'}); assert.strictEqual(calls[2].u, 'http://p/world/sample?n=5');
    r = await m.handle('dirty', {box: {x1: '5', y1: '9', z1: '0', x2: '-5', y2: '0', z2: '0'}});
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([calls[3].u, calls[3].o.method, JSON.parse(calls[3].o.body)], ['http://p/world/dirty', 'POST', {x1: -5, y1: 0, z1: 0, x2: 5, y2: 9, z2: 0}]);
    assert.strictEqual((await m.handle('dirty', {box: {x1: 'x'}})).status, 400); assert.strictEqual((await m.handle('dirty', {})).status, 400);
    assert.strictEqual(calls.length, 4);                                                      // bad boxes never reach the plugin
    // plugin answers 400: passed through; plugin down: 502 for every proxied op
    m = makeModel({store, fetch: plugin(400, {error: 'n'}), url: 'http://p', token: 't', area});
    assert.strictEqual((await m.handle('sample', {n: '0'})).status, 400);
    m = makeModel({store, fetch: async () => { throw new Error('down'); }, url: 'http://p', token: 't', area});
    for (const [op, args] of [['sample', {n: '5'}], ['dirty', {box: {x1: 0, y1: 0, z1: 0, x2: 1, y2: 1, z2: 1}}], ['stats', {}]]) assert.strictEqual((await m.handle(op, args)).status, 502);
    assert.strictEqual(JSON.parse((await m.handle('stats', {})).body).hub.sections, 0);       // the hub half still shows
  } finally { store.close(); }
}

// ---- main-thread client with a fake Worker ----
class FakeWorker extends EventEmitter {
  static all = [];
  constructor(file, opts) { super(); this.file = file; this.opts = opts; this.sent = []; FakeWorker.all.push(this); }
  postMessage(m) {
    if (this.throws) throw new Error('clone');
    this.sent.push(m);
    if (m.t === 'stop') setImmediate(() => this.emit('message', {t: 'stopped'}));
  }
  terminate() { setImmediate(() => this.emit('exit', 1)); return Promise.resolve(1); }
}

async function client() {
  const logs = [];
  const wm = startWorldModel({dir: '/x', url: 'http://p', token: 't', area, log: (m) => logs.push(m), Worker: FakeWorker, restartMs: 30, timeoutMs: 60});
  const w1 = FakeWorker.all[0];
  assert.strictEqual(path.basename(w1.file), 'worldmodel-worker.js');
  assert.deepStrictEqual(w1.opts.workerData, {dir: '/x', url: 'http://p', token: 't', area});
  assert.deepStrictEqual(w1.opts.execArgv, ['--disable-warning=ExperimentalWarning']);
  // answer: transferred ArrayBuffer comes back as a Buffer, gzip flag kept; seq and log messages are relayed
  const p = wm.request('height', {x1: '1'});
  assert.deepStrictEqual(w1.sent[0], {id: 1, op: 'height', args: {x1: '1'}});
  const ab = new ArrayBuffer(3); new Uint8Array(ab).set([1, 2, 3]);
  w1.emit('message', {id: 1, status: 200, type: 'application/octet-stream', body: ab, gzip: true});
  const a = await p;
  assert.deepStrictEqual([a.status, a.type, a.gzip, Buffer.isBuffer(a.body), [...a.body]], [200, 'application/octet-stream', true, true, [1, 2, 3]]);
  assert.strictEqual(wm.seq(), 0); w1.emit('message', {t: 'seq', seq: 24}); assert.strictEqual(wm.seq(), 24);
  w1.emit('message', {t: 'log', msg: 'hello'}); assert.deepStrictEqual(logs, ['hello']);
  w1.emit('message', {id: 99, status: 200}); w1.emit('message', {junk: true});                    // late or odd messages never throw
  wm.dirty({x1: 0}); assert.deepStrictEqual(w1.sent.at(-1), {t: 'dirty', box: {x1: 0}});
  // timeout: 503 and the slot is freed
  const t0 = Date.now(), late = await wm.request('blocks', {});
  assert.strictEqual(late.status, 503); assert.ok(Date.now() - t0 >= 50);
  w1.emit('message', {id: 2, status: 200, type: 'x', body: new ArrayBuffer(0)});               // answer after the timeout: ignored
  // a postMessage that throws answers 503 instead of throwing
  w1.throws = true; assert.strictEqual((await wm.request('blocks', {})).status, 503); wm.dirty({x1: 0}); w1.throws = false;
  // worker crash: pending requests answer 503 at once, requests while down too, a new worker starts after restartMs
  const pend = wm.request('materials', {});
  w1.emit('error', new Error('boom')); w1.emit('exit', 1);
  assert.strictEqual((await pend).status, 503);
  assert.strictEqual((await wm.request('blocks', {})).status, 503); wm.dirty({x1: 0});
  assert.strictEqual(FakeWorker.all.length, 1);
  await until(() => FakeWorker.all.length === 2, 'restart');
  assert.ok(logs.some((l) => /boom/.test(l)) && logs.some((l) => /exited/.test(l)));
  // a constructor that throws restarts later and never throws here
  const w2 = FakeWorker.all[1];
  const Boom = class extends FakeWorker { constructor() { throw new Error('no thread'); } };
  const wm2 = startWorldModel({dir: '/x', url: 'u', token: 't', area, log: (m) => logs.push(m), Worker: Boom, restartMs: 10});
  assert.strictEqual((await wm2.request('blocks', {})).status, 503); await wm2.stop();
  // stop: asks the worker to stop, resolves when it has exited, answers pending with 503, no restart afterwards
  const last = wm.request('blocks', {});
  await wm.stop();
  assert.deepStrictEqual(w2.sent.at(-1), {t: 'stop'}); assert.strictEqual((await last).status, 503);
  await sleep(80); assert.strictEqual(FakeWorker.all.length, 2);
  assert.strictEqual((await wm.request('blocks', {})).status, 503);
  await wm.stop();                                                                               // twice is fine
}

// ---- one real thread against a loopback fake of the plugin ----
async function thread() {
  const f = {calls: [], hold: false, held: 0};
  f.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      f.calls.push({path: u.pathname, auth: req.headers.authorization, query: u.search, body});
      if (u.pathname === '/world/pull') {
        res.setHeader('content-type', 'application/octet-stream');
        if (u.searchParams.get('ack') === '0') return res.end(frame(1n, 1, chunk24(-37, -22)));
        if (f.hold) { f.held++; return; }                                                       // a long poll the plugin never answers
        await sleep(20);
        return res.end(frame(1n, 1, []));
      }
      res.setHeader('content-type', 'application/json');
      res.end(u.pathname === '/world/stats' ? '{"importLeft":0}' : '{"ok":true}');
    });
  });
  await new Promise((r) => f.server.listen(0, '127.0.0.1', r));
  const logs = [];
  const dir = path.join(tmp(), 'world');
  const wm = startWorldModel({dir, url: `http://127.0.0.1:${f.server.address().port}`, token: 'tok', area, log: (m) => logs.push(m)});
  try {
    await until(() => wm.seq() === 24, 'seq 24');
    assert.strictEqual(f.calls[0].auth, 'Bearer tok'); assert.match(f.calls[0].query, /ack=0&wait=25&area=-37,-22,3,18$/);
    const h = await wm.request('height', {x1: '-592', z1: '-352', x2: '-577', z2: '-337'});
    assert.strictEqual(h.status, 200); assert.ok(Buffer.isBuffer(h.body));
    assert.deepStrictEqual([JSON.parse(h.body).heights.length, JSON.parse(h.body).unknown], [256, []]);
    const s = await wm.request('sections', {cx: -37, cz: -22, r: 1});
    assert.strictEqual(s.gzip, true); assert.strictEqual(decodeBatch(zlib.gunzipSync(s.body)).records.length, 24 + 8);
    const st = JSON.parse((await wm.request('stats', {})).body);
    assert.deepStrictEqual([st.hub.sections, st.hub.seq, st.plugin], [24, 24, {importLeft: 0}]);
    wm.dirty({x1: 1, y1: 2, z1: 3, x2: 4, y2: 5, z2: 6});
    await until(() => f.calls.some((c) => c.path === '/world/dirty'), 'dirty');
    assert.deepStrictEqual(JSON.parse(f.calls.find((c) => c.path === '/world/dirty').body), {x1: 1, y1: 2, z1: 3, x2: 4, y2: 5, z2: 6});
    // stop while a long poll hangs: the pull is cancelled, the store closes, the call returns quickly
    f.hold = true; await until(() => f.held > 0, 'held pull');
    const t0 = Date.now(); await wm.stop();
    assert.ok(Date.now() - t0 < 3000, 'stop took ' + (Date.now() - t0));
    assert.strictEqual((await wm.request('height', {})).status, 503);
    assert.deepStrictEqual(logs, []);                                                           // no warnings, errors or pull failures went to the log
    const again = openStore(dir);                                                               // the file is closed and complete
    assert.strictEqual(again.counts().sections, 24); again.close();
  } finally { await wm.stop(); f.server.closeAllConnections(); f.server.close(); }
}

(async () => {
  try {
    await inline(); await pulls(); await cache(); await proxies(); await client(); await thread();
    console.log('world-model: ok');
  } finally { for (const d of dirs) fs.rmSync(d, {recursive: true, force: true}); }
})().catch((e) => { console.error(e); process.exit(1); });
