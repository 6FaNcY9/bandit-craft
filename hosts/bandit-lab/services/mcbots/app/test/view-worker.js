'use strict';
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const codec = require('../worldsection');
const root = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The fake hub: every chunk stone for sy -4..3 and air above, chunk 1,1 unknown (kind 2); `table` answers by URL first,
// `secs` replaces single sections ('cx,sy,cz' -> blob), `grey` makes chunks ungenerated or unknown ('cx,cz' -> kind 1 or 2).
const stone = codec.encodeSection(['minecraft:stone'], null), air = codec.encodeSection(['minecraft:air'], null);
const hub = {down: false, gate: null, air: new Set(), table: new Map(), secs: new Map(), grey: new Map()};
const rec = (cx, sy, cz) => { const blob = hub.secs.get(`${cx},${sy},${cz}`) ?? (sy <= 3 && !hub.air.has(`${cx},${sy},${cz}`) ? stone : air); return {kind: 0, cx, sy, cz, hash: codec.sectionHash(blob), blob}; };
// a section of one block state with some cells replaced: [[x, y, z, state], ...] in local coordinates
const sectionOf = (base, cells) => {
  const pal = [base], idx = new Uint16Array(4096);
  for (const [x, y, z, s] of cells) { if (!pal.includes(s)) pal.push(s); idx[codec.cellIndex(x, y, z)] = pal.indexOf(s); }
  return codec.encodeSection(pal, idx);
};
const batch = (cx, cz, r) => {
  const records = [];
  for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
    const kind = x === 1 && z === 1 ? 2 : hub.grey.get(`${x},${z}`);
    if (kind) records.push({kind, cx: x, sy: 0, cz: z});
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

// The worker's world: no require, no module; a message log, a URL log (with each fetch's signal), and a count of fetches in flight.
const posts = [], urls = [], sigs = [], aborts = []; // aborts: one controller per AbortSignal.timeout() call, so a test can fire the timeout
let inflight = 0, last = Date.now(), manual = false, skew = 0; // skew moves the worker's clock forward
const timers = [];
const ctx = vm.createContext({
  TextDecoder,
  Date: {now: () => Date.now() + skew},
  AbortSignal: {timeout: (ms) => { const c = new AbortController(); c.ms = ms; aborts.push(c); return c.signal; }},
  // the worker's 5 s plan timer must not hold the test process; `manual` collects timers so a test can fire them and read their delays
  setTimeout: (f, ms) => { if (!manual) return setTimeout(f, ms).unref(); timers.push({f, ms}); return timers.length; },
  clearTimeout,
  postMessage: (msg, transfer) => { posts.push({msg, transfer}); last = Date.now(); },
  importScripts: (...files) => { for (const f of files) { const b = path.basename(f); vm.runInContext(fs.readFileSync(b === 'worldsection.js' ? path.join(root, b) : path.join(root, 'public', 'oneview', b), 'utf8'), ctx, {filename: b}); } },
  fetch: async (url, opt = {}) => {
    urls.push(url); sigs.push(opt.signal); inflight++;
    try {
      await new Promise((ok, no) => { (hub.gate || new Promise((r) => setImmediate(r))).then(ok); opt.signal?.addEventListener('abort', () => no(opt.signal.reason)); });
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
  // 3b a changes answer that lands after a reset belongs to the old world: dropped (else the cache would sit at 50 and never ask since=1)
  hub.table.set('/api/world/changes?since=2', () => json({seq: 50, sections: [], more: false}));
  hub.table.set('/api/world/changes?since=1', () => json({seq: 2, sections: [], more: false}));
  hub.gate = new Promise((r) => { hub.release = r; });
  send({t: 'seq', seq: 3}); send({t: 'seq', seq: 1}); n = posts.length;
  hub.gate = null; hub.release(); await settle();
  send({t: 'seq', seq: 2}); await settle();
  assert.ok(urls.includes('/api/world/changes?since=1')); assert.strictEqual(of('reset', n).length, 0);

  // 3c a changes reply is fresher than the /ws seq behind it (7 after 6): the next 6 is no reset and asks nothing
  hub.table.set('/api/world/changes?since=2', () => json({seq: 7, sections: [], more: false}));
  send({t: 'seq', seq: 6}); await settle();
  n = posts.length; const k = urls.length;
  send({t: 'seq', seq: 6}); await settle();
  assert.deepStrictEqual([of('reset', n).length, urls.length], [0, k]);

  // 3d a failing changes call backs off 2 s, 4 s, 8 s ... and asks nothing in between; a good one starts the count over
  manual = true;
  const fail = (since) => hub.table.set('/api/world/changes?since=' + since, () => json(null, 500));
  const asks = (since) => asked('/api/world/changes?since=' + since).length;
  fail(7); send({t: 'seq', seq: 8}); await settle();
  for (const ms of [2000, 4000, 8000]) {
    assert.deepStrictEqual([timers.length, timers[0].ms], [1, ms]);
    assert.strictEqual(asks(7), Math.log2(ms / 1000));
    send({t: 'seq', seq: 8}); await settle(); assert.strictEqual(asks(7), Math.log2(ms / 1000)); // more messages do not ask either
    timers.shift().f(); await settle();
  }
  hub.table.set('/api/world/changes?since=7', () => json({seq: 8, sections: [], more: false}));
  assert.deepStrictEqual([timers.length, timers[0].ms], [1, 16000]); timers.shift().f(); await settle();
  assert.deepStrictEqual([timers.length, asks(7)], [0, 5]);
  fail(8); send({t: 'seq', seq: 9}); await settle();
  assert.deepStrictEqual([timers.length, timers[0].ms], [1, 2000]);
  hub.table.set('/api/world/changes?since=8', () => json({seq: 9, sections: [], more: false}));
  timers.shift().f(); await settle(); assert.strictEqual(timers.length, 0);
  manual = false;

  // 4 Review Focus 2: every fetch fails: one net false and no exception; 2 s later it goes on
  hub.down = true; n = posts.length;
  send({t: 'view', cx: 30, cz: 0, viewR: 1}); await settle();
  assert.deepStrictEqual(of('net', n).map((x) => x.ok), [false]);
  hub.down = false; await sleep(2200); await settle();
  assert.deepStrictEqual(of('net', n).map((x) => x.ok), [false, true]);
  assert.ok(of('mesh', n).some((m) => m.cx >= 27 && m.cx <= 32 && m.pos));

  // 4b a request that never settles is cut by its 40 s timeout and takes the failure path: tiles and changes are asked again 2 s later
  hub.gate = new Promise(() => {}); n = posts.length; let k0 = urls.length, a0 = aborts.length;
  hub.table.set('/api/world/changes?since=9', () => json({seq: 10, sections: [], more: false}));
  send({t: 'view', cx: 300, cz: 0, viewR: 1}); send({t: 'seq', seq: 10}); await sleep(50);
  assert.deepStrictEqual([inflight, asked('/api/world/changes?since=9', k0).length, sigs.slice(k0).every(Boolean)], [3, 1, true], 'three hanging fetches, each with a signal');
  const hung = asked('/api/world/sections?', k0);
  hub.gate = null; aborts.slice(a0).forEach((c) => c.abort()); await settle();
  assert.deepStrictEqual([...hung.map((u) => asked(u, k0).length), asked('/api/world/changes?since=9', k0).length], [1, 1, 1], 'nothing asked again before the wait');
  await sleep(2200); await settle();
  assert.deepStrictEqual([...hung.map((u) => asked(u, k0).length), asked('/api/world/changes?since=9', k0).length], [2, 2, 2], 'asked again after the wait');
  assert.deepStrictEqual(of('net', n).map((x) => x.ok), [false, true]);
  assert.ok(of('mesh', n).some((m) => m.cx >= 297 && m.cx <= 302 && m.pos), 'tiles after the timeout');

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

  // 5b an unchanged plan is asked 5 s, 10 s, 20 s, 30 s, 30 s apart; a change brings it back to 5 s; never without a new worldSeq
  let S = 10; const k5 = urls.length;
  const later = async (ms) => { skew += ms; const s = S++; hub.table.set('/api/world/changes?since=' + s, () => json({seq: s + 1, sections: [], more: false})); send({t: 'seq', seq: s + 1}); await settle(); return asked('/api/plan/status?', k5).length; };
  send({t: 'plans', list: [{key: 'a.litematic@0,64,0', bot: 'bot1'}]}); await settle();
  assert.strictEqual(asked('/api/plan/status?', k5).length, 1);
  // "not yet" steps stop 1 s short: settle() runs in real time and a loaded builder must not tip them over
  const steps = [[4000, 1], [1000, 2], [9000, 2], [1000, 3], [19000, 3], [1000, 4], [29000, 4], [1000, 5], [30000, 6]];
  for (const [ms, want] of steps) assert.strictEqual(await later(ms), want, `after +${ms}`);
  hub.table.set('/api/plan/status?bot=bot1', () => json({...planReply, blocks: planReply.blocks.map((b) => [...b.slice(0, 4), 1])}));
  assert.deepStrictEqual([await later(30000), await later(4000), await later(1000)], [7, 7, 8], 'a change: back to 5 s');
  skew += 60000; send({t: 'pause', on: false}); await settle(); assert.strictEqual(asked('/api/plan/status?', k5).length, 8, 'no new worldSeq, no ask');
  send({t: 'plans', list: []}); await settle();

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

  // 7b the roof above a bot, in a fresh area with negative x (chunks -102..-97, 3..8): held without a fetch until its column is
  // loaded, the newest probe replaces an unanswered one, leaves are no roof, an ungenerated or unknown chunk answers 0
  hub.secs.set('-100,2,5', sectionOf('minecraft:stone', Array.from({length: 128}, (_, i) => [i & 7, 0, i >> 3, 'minecraft:air']))); // bottom layer air where x < 8
  hub.secs.set('-99,4,5', sectionOf('minecraft:air', [[5, 0, 5, 'minecraft:dirt']])); // one lone dirt on the stone
  hub.secs.set('-98,4,5', sectionOf('minecraft:air', [[9, 1, 5, 'minecraft:stone'], [9, 2, 5, 'minecraft:oak_leaves[distance=1,persistent=false,waterlogged=false]'],
    [9, 3, 5, 'minecraft:stone'], [9, 4, 5, 'minecraft:short_grass'], [9, 5, 5, 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]'],
    [9, 6, 5, 'minecraft:spruce_leaves[distance=7,persistent=true,waterlogged=false]'], [9, 7, 5, 'minecraft:stone'], [9, 10, 5, 'minecraft:stone']]));
  hub.grey.set('-97,8', 1); hub.grey.set('-102,3', 2);
  const probes = (from) => of('probe', from).map((p) => [p.x, p.y, p.z, p.roof]);
  n = posts.length; const u7 = urls.length;
  send({t: 'probe', x: -1558.5, y: 70, z: 85.5}); send({t: 'probe', x: -1558.5, y: 64.5, z: 85.5}); await settle();
  assert.deepStrictEqual([probes(n), urls.length], [[], u7], 'held, and nothing fetched for it');
  send({t: 'view', cx: -100, cz: 5, viewR: 1}); await settle();
  // block -1559 (chunk -98, local 9), feet 64, head 65: of 66..73 only the stone at 67 and 71 and the stairs at 69 count
  assert.deepStrictEqual(probes(n), [[-1558.5, 64.5, 85.5, 3]], 'only the newest, once its tile is there');
  n = posts.length;
  for (const [x, y, z] of [[-1548.5, 40, 131.5], [-1630.5, 40, 50.5], [-1580, 28.5, 90], [-1580, 315, 90]]) send({t: 'probe', x, y, z});
  assert.deepStrictEqual(probes(n).map((p) => p[3]), [0, 0, 8, 0], 'ungenerated, unknown, stone across two sections, nothing above 319');

  // 7c loose dirt: every mesh carries its count (0 without faces); the switch re-meshes only the section that has some
  const firstFace = (from) => of('mesh', from).map((x) => [x.cx, x.sy, x.cz, x.loose, ...x.col.slice(0, 3)]);
  assert.ok([...lastMesh()].every(([key, x]) => x.loose === (key === '-99,4,5' ? 1 : 0)), 'loose counts');
  assert.deepStrictEqual([...lastMesh().get('-99,4,5').col.slice(0, 3)], [204, 34, 34], 'red (its -x face)');
  n = posts.length; send({t: 'loose', on: false}); await settle();
  assert.deepStrictEqual(firstFace(n), [[-99, 4, 5, 1, 98, 66, 38]], 'brown, the count stays');
  n = posts.length; send({t: 'loose', on: true}); await settle();
  assert.deepStrictEqual(firstFace(n), [[-99, 4, 5, 1, 204, 34, 34]], 'red again');

  // 7d a cut at a section border: the re-meshes, then one ack; the sy 1 lid is dark under the stone above it and normal under the air
  n = posts.length; send({t: 'cut', y: 31}); await settle();
  const after = posts.slice(n).map((p) => p.msg), ack = after.findIndex((x) => x.t === 'cut');
  assert.ok(ack > 0 && after.slice(0, ack).every((x) => x.t === 'mesh'), 're-meshes before the ack');
  assert.deepStrictEqual(of('cut', n).map((x) => x.y), [31], 'one ack');
  const lid = lastMesh().get('-100,1,5'), shades = {};
  for (let i = 0; i < lid.col.length; i += 12) shades[lid.col[i]] = (shades[lid.col[i]] ?? 0) + 1; // the red channel of each face
  assert.deepStrictEqual(shades, {41: 128, 138: 128}, 'stone 138, x 0.3 = 41 under stone');
  send({t: 'cut', y: 319}); await settle();

  // 7e eviction and a reset forget the loose sections: the switch then re-meshes nothing
  send({t: 'view', cx: 700, cz: 0, viewR: 1}); await settle();
  n = posts.length; send({t: 'loose', on: false}); await settle();
  assert.strictEqual(of('mesh', n).length, 0, 'nothing evicted');
  send({t: 'view', cx: -100, cz: 5, viewR: 1}); await settle();
  assert.strictEqual(lastMesh().get('-99,4,5').loose, 1);
  n = posts.length; send({t: 'seq', seq: 3}); send({t: 'loose', on: true});
  assert.deepStrictEqual(posts.slice(n).map((p) => p.msg.t), ['reset'], 'nothing after a reset');
  await settle();

  // 8 only the three routes
  for (const u of urls) assert.ok(/^\/api\/(world\/sections|world\/changes|plan\/status)\?/.test(u), u);
  // ... and every one with its own 40 s timeout signal
  assert.ok(urls.length === sigs.length && sigs.every((s, i) => s === aborts[i].signal && aborts[i].ms === 40000), 'every fetch has a 40 s signal');

  // 9 no AbortSignal.timeout (Safari before 16): the fetches still go out, without a signal
  delete ctx.AbortSignal; n = posts.length;
  send({t: 'view', cx: 400, cz: 0, viewR: 1}); await settle();
  assert.ok(of('mesh', n).some((m) => m.cx >= 397 && m.cx <= 402 && m.pos) && sigs.at(-1) === undefined);
  console.log('view-worker ok');
})().catch((e) => { console.error(e); process.exit(1); });
