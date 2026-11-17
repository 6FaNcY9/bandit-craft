'use strict';
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const codec = require('../worldsection');
const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The fake hub: every chunk stone for sy -4..3 and air above, chunk 1,1 unknown (kind 2); `table` answers by URL first.
const stone = codec.encodeSection(['minecraft:stone'], null), air = codec.encodeSection(['minecraft:air'], null);
const hub = {down: false, gate: null, air: new Set(), table: new Map()};
const rec = (cx, sy, cz) => { const blob = sy <= 3 && !hub.air.has(`${cx},${sy},${cz}`) ? stone : air; return {kind: 0, cx, sy, cz, hash: codec.sectionHash(blob), blob}; };
const batch = (cx, cz, r) => {
  const records = [];
  for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
    if (x === 1 && z === 1) records.push({kind: 2, cx: x, sy: 0, cz: z});
    else for (let sy = -4; sy <= 19; sy++) records.push(rec(x, sy, z));
  }
  return codec.encodeBatch({boot: 1n, batch: 1, records});
};
const json = (body, status = 200) => ({status, json: async () => body});
const planReply = {file: 'a.litematic', origin: {x: 0, y: 64, z: 0}, seq: 7, palette: ['stone_bricks', 'glass'],
  blocks: [[0, 64, 0, 0, 1], [1, 64, 0, 0, 0], [0, 65, 0, 1, 0], [1, 65, 0, 0, 2], [-1, 66, -2, 1, 3], [0, 66, 0, 0, 1]]};
const answer = (url) => {
  if (hub.table.has(url)) return hub.table.get(url)();
  const u = new URL(url, 'http://hub'), q = (k) => Number(u.searchParams.get(k));
  if (u.pathname === '/api/world/sections') {
    const b = batch(q('cx'), q('cz'), q('r'));
    return {status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length)};
  }
  return {status: 404};
};

// The worker's world: no require, no module; a message log, a URL log, and a count of fetches in flight.
const posts = [], urls = [];
let inflight = 0, last = Date.now();
const ctx = vm.createContext({
  TextDecoder,
  setTimeout: (f, ms) => setTimeout(f, ms).unref(), // the worker's 5 s plan timer must not hold the test process
  clearTimeout,
  postMessage: (msg, transfer) => { posts.push({msg, transfer}); last = Date.now(); },
  importScripts: (...files) => { for (const f of files) { const b = path.basename(f); vm.runInContext(fs.readFileSync(b === 'worldsection.js' ? path.join(root, b) : path.join(root, 'public', 'oneview', b), 'utf8'), ctx, {filename: b}); } },
  fetch: async (url) => {
    urls.push(url); inflight++;
    try {
      await (hub.gate || new Promise((r) => setImmediate(r)));
      if (hub.down) throw new TypeError('network down');
      return answer(url);
    } finally { inflight--; last = Date.now(); }
  },
});
ctx.self = ctx;
vm.runInContext(fs.readFileSync(path.join(root, 'public', 'oneview', 'worker.js'), 'utf8'), ctx, {filename: 'worker.js'});
const send = (msg) => { last = Date.now(); ctx.onmessage({data: msg}); };
const settle = async () => { for (;;) { await sleep(20); if (!inflight && Date.now() - last >= 50) return; } };
const lastMesh = () => { const m = new Map(); for (const {msg} of posts) if (msg.t === 'mesh') m.set(`${msg.cx},${msg.sy},${msg.cz}`, msg); return m; };
const faces = (m) => (m && m.pos ? m.idx.length / 6 : 0);
const of = (t, from = 0) => posts.slice(from).map((p) => p.msg).filter((m) => m.t === t);
const asked = (prefix, from = 0) => urls.slice(from).filter((u) => u.startsWith(prefix));

(async () => {
  // 1 one view: 35 known columns, each with its top section; the unknown column has a chunk message and no mesh
  send({t: 'view', cx: 0, cz: 0, viewR: 1}); await settle();
  assert.ok(of('chunk').some((m) => m.cx === 1 && m.cz === 1 && m.state === 2));
  let meshes = lastMesh(), solid = [...meshes.values()].filter((m) => m.pos);
  assert.strictEqual(solid.length, 35);
  for (const m of solid) assert.deepStrictEqual([m.sy, faces(m)], [3, 256]);
  assert.ok(![...meshes.values()].some((m) => m.cx === 1 && m.cz === 1));
  for (const {msg, transfer} of posts) if (msg.t === 'mesh' && msg.pos) assert.ok(transfer.length === 3 && transfer.every((b, i) => b === [msg.pos, msg.col, msg.idx][i].buffer), 'arrays are transferred');
  // 1b the height cut: the section above the cut is gone, the one below gets a lid
  send({t: 'cut', y: 47}); await settle();
  meshes = lastMesh(); assert.deepStrictEqual([meshes.get('0,3,0').pos, faces(meshes.get('0,2,0'))], [null, 256]);
  send({t: 'cut', y: 319}); await settle();
  meshes = lastMesh(); assert.deepStrictEqual([faces(meshes.get('0,3,0')), faces(meshes.get('0,2,0'))], [256, 0]);

  // 2 Review Focus 3: the first seq is a baseline and asks nothing; a newer one asks changes once, then the section once
  let n = urls.length;
  send({t: 'seq', seq: 5}); await settle(); assert.strictEqual(urls.length, n);
  hub.table.set('/api/world/changes?since=5', () => json({seq: 6, sections: [[0, 3, 0]], more: false}));
  hub.air.add('0,3,0');
  send({t: 'seq', seq: 6}); await settle();
  assert.deepStrictEqual(urls.slice(n), ['/api/world/changes?since=5', '/api/world/sections?cx=0&cz=0&r=0']);
  meshes = lastMesh(); assert.deepStrictEqual([meshes.get('0,3,0').pos, faces(meshes.get('0,2,0'))], [null, 256]);
  assert.ok(faces(meshes.get('1,3,0')) > 256);

  // 3 Review Focus 3: a changes answer with more resyncs the loaded tiles; a lower seq resets
  hub.table.set('/api/world/changes?since=6', () => json({seq: 10, sections: [], more: true}));
  n = urls.length; send({t: 'seq', seq: 9}); await settle();
  assert.deepStrictEqual(urls.slice(n, n + 1), ['/api/world/changes?since=6']);
  const resync = asked('/api/world/sections?', n); assert.strictEqual(resync.length, 4); assert.ok(resync.every((u) => u.endsWith('&r=1')));
  assert.strictEqual(asked('/api/world/changes?', n).length, 1);
  n = posts.length; send({t: 'seq', seq: 2}); await settle();
  assert.strictEqual(of('reset', n).length, 1);
  // 3b a changes answer that lands after a reset belongs to the old world: dropped (else seq 2 would reset again)
  hub.table.set('/api/world/changes?since=2', () => json({seq: 50, sections: [], more: false}));
  hub.table.set('/api/world/changes?since=1', () => json({seq: 2, sections: [], more: false}));
  hub.gate = new Promise((r) => { hub.release = r; });
  send({t: 'seq', seq: 3}); send({t: 'seq', seq: 1}); n = posts.length;
  hub.gate = null; hub.release(); await settle();
  send({t: 'seq', seq: 2}); await settle();
  assert.ok(urls.includes('/api/world/changes?since=1')); assert.strictEqual(of('reset', n).length, 0);

  // 4 Review Focus 2: every fetch fails: one net false and no exception; 2 s later it goes on
  hub.down = true; n = posts.length;
  send({t: 'view', cx: 30, cz: 0, viewR: 1}); await settle();
  assert.deepStrictEqual(of('net', n).map((x) => x.ok), [false]);
  hub.down = false; await sleep(2200); await settle();
  assert.deepStrictEqual(of('net', n).map((x) => x.ok), [false, true]);
  assert.ok(of('mesh', n).some((m) => m.cx >= 27 && m.cx <= 32 && m.pos));

  // 5 Review Focus 4: plans: 200 groups and percent, 404 gone, 413 big; a cut regroups without a fetch
  hub.table.set('/api/plan/status?bot=bot1', () => json(planReply));
  hub.table.set('/api/plan/status?bot=bot2', () => json(null, 404));
  hub.table.set('/api/plan/status?bot=bot3', () => json(null, 413));
  n = posts.length;
  send({t: 'plans', list: [{key: 'a.litematic@0,64,0', bot: 'bot1'}, {key: 'b.litematic@0,0,0', bot: 'bot2'}, {key: 'c.litematic@0,0,0', bot: 'bot3'}]}); await settle();
  let plan = of('plan', n);
  assert.deepStrictEqual(plan.map((m) => m.key).sort(), ['a.litematic@0,64,0', 'b.litematic@0,0,0', 'c.litematic@0,0,0']);
  const a = plan.find((m) => m.key[0] === 'a');
  assert.deepStrictEqual([a.percent, a.groups.length, a.file, a.counts.total], [33, 5, 'a.litematic', 6]);
  assert.deepStrictEqual([plan.find((m) => m.key[0] === 'b').state, plan.find((m) => m.key[0] === 'c').state], ['gone', 'big']);
  assert.ok(posts.some((p) => p.msg.t === 'plan' && p.msg.groups && p.transfer.length === 5 && p.transfer[0] === p.msg.groups[0].xyz.buffer), 'groups are transferred');
  n = posts.length; const m = urls.length;
  send({t: 'cut', y: 64}); await settle();
  plan = of('plan', n); assert.deepStrictEqual(plan.map((x) => [x.key, x.groups.length]), [['a.litematic@0,64,0', 2]]);
  assert.strictEqual(asked('/api/plan/status?', m).length, 0);
  send({t: 'plans', list: [{key: 'a.litematic@0,64,0', bot: 'bot1'}]}); await settle();
  assert.deepStrictEqual(of('plan', n).slice(1).map((x) => [x.key, x.state]), [['b.litematic@0,0,0', 'gone'], ['c.litematic@0,0,0', 'gone']]);
  send({t: 'plans', list: []}); send({t: 'cut', y: 319});

  // 6 hidden page: nothing starts; visible again: it does
  n = urls.length; send({t: 'pause', on: true}); send({t: 'view', cx: 60, cz: 0, viewR: 1}); await settle();
  assert.strictEqual(urls.length, n);
  send({t: 'pause', on: false}); await settle(); assert.ok(urls.length > n);

  // 7 a tile whose reply lands after the view left it makes no mesh (and no column outlives its chunk -1)
  hub.gate = new Promise((r) => { hub.release = r; });
  send({t: 'view', cx: 100, cz: 0, viewR: 1}); send({t: 'view', cx: 200, cz: 0, viewR: 1});
  n = posts.length; hub.gate = null; hub.release(); await settle();
  assert.ok(!of('mesh', n).some((x) => x.cx >= 99 && x.cx <= 101), 'late tile');
  const dead = new Set();
  for (const {msg} of posts) {
    const k = msg.cx + ',' + msg.cz;
    if (msg.t === 'chunk') { if (msg.state < 0) dead.add(k); else dead.delete(k); }
    if (msg.t === 'mesh') assert.ok(!dead.has(k), 'mesh after chunk -1: ' + k);
  }

  // 8 only the three routes
  for (const u of urls) assert.ok(/^\/api\/(world\/sections|world\/changes|plan\/status)\?/.test(u), u);
  console.log('view-worker ok');
})().catch((e) => { console.error(e); process.exit(1); });
