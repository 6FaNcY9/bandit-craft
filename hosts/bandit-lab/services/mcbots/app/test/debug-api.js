'use strict';
const APP = require('node:path').join(__dirname, '..');
const assert = require('node:assert');
const {BotRunner} = require('../bots');
// ---- debug trace + /api/debug ----
{
  const {BotTrace} = require('../debug');
  let now = 1000000;
  const tr = new BotTrace(() => now);
  tr.sample({x: 1, y: 64, z: 2});
  now += 10000; tr.sample({x: 2.123456, y: 64, z: 3});
  tr.correction(); now += 1000; tr.correction();
  now += 25000; // the first sample is 36 s old, the corrections 26 s / 25 s
  tr.setError('boom');
  let s = tr.snapshot();
  assert.deepStrictEqual(s.positions, [{agoS: 26, x: 2.12, y: 64, z: 3}]); // 30 s window, 2 decimals
  assert.deepStrictEqual(s.corrections, {total: 2, last30s: 2, lastAgoS: 25});
  assert.deepStrictEqual(s.lastError, {message: 'boom', agoS: 0});
  now += 6000; // corrections age out of the window, the total stays
  s = tr.snapshot();
  assert.deepStrictEqual(s.corrections, {total: 2, last30s: 0, lastAgoS: 31});
  assert.strictEqual(tr.recentCorrections(), 0);
  tr.setError('');
  assert.strictEqual(tr.snapshot().lastError, null);

  // offline runner: nothing live, still a full shape
  const off = new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: null});
  off.lastError = 'kicked: test';
  let d = off.debug();
  assert.strictEqual(d.online, false);
  assert.strictEqual(d.pos, null);
  assert.strictEqual(d.physics, null);
  assert.strictEqual(d.pathfinder, null);
  assert.strictEqual(d.job, null);
  assert.strictEqual(d.lastError.message, 'kicked: test');
  assert.strictEqual(off.lastError, 'kicked: test'); // accessor keeps working for the old callers
  assert.strictEqual(off.snapshot().pullbacks, 0);

  // online runner with a stub bot: job step, pathfinder, physics, controls
  class GoalNear {}
  const on = new BotRunner('bot2', {host: 'x', port: 1, log: () => {}, world: null});
  on.online = true;
  on.bot = {
    entity: {position: {x: 1.234, y: 60, z: -3.5}, velocity: {x: 0, y: -0.0784, z: 0}, onGround: true, isCollidedHorizontally: true},
    game: {dimension: 'minecraft:overworld'},
    controlState: {forward: true, jump: false, back: false},
    pathfinder: {isMoving: () => true, isMining: () => false, isBuilding: () => false, goal: new GoalNear()},
  };
  on.current = {id: 3, type: 'goto', args: {x: 1, y: 2, z: 3}, status: 'running', progress: '12 blocks', startedAt: Date.now() - 2500};
  on.queue = [{id: 4, type: 'say', args: {text: 'hi'}}];
  on.trace.sample(on.bot.entity.position);
  on.trace.correction();
  d = on.debug();
  assert.deepStrictEqual(d.pos, [1.23, 60, -3.5]);
  assert.strictEqual(d.dimension, 'overworld');
  assert.deepStrictEqual(d.physics, {onGround: true, collidedHorizontally: true, velocity: [0, -0.078, 0], controls: ['forward'], air: null, inWater: false});
  assert.deepStrictEqual(d.pathfinder, {moving: true, mining: false, building: false, goal: 'GoalNear'});
  assert.strictEqual(d.job.type, 'goto');
  assert.strictEqual(d.job.progress, '12 blocks');
  assert.ok(d.job.runningS >= 2.4 && d.job.runningS < 4, String(d.job.runningS));
  assert.deepStrictEqual(d.queue, ['say hi']);
  assert.strictEqual(d.corrections.last30s, 1);
  assert.strictEqual(d.positions.length, 1);
  assert.doesNotThrow(() => JSON.stringify(d));
}

// GET /api/debug end to end: start the real server, hit it with and without a tailscale login.
{ // 3D map (voxels.js): the box is bounded and ordered; only blocks that touch something see-through are sent
  const V = require('../voxels');
  const ok = {x1: 5, y1: 0, z1: 5, x2: 1, y2: 3, z2: 1};
  assert.deepStrictEqual(V.parseBox(ok), {x1: 1, y1: 0, z1: 1, x2: 5, y2: 3, z2: 5});
  assert.deepStrictEqual(V.parseBox({...ok, x1: '5'}).x2, 5);
  for (const bad of [{x1: 'a'}, {x1: 1.5}, {x1: ''}, {y1: -65}, {y2: 320}, {x1: 100, x2: 0}, {y1: -64, y2: 150, x1: 0, x2: 79, z1: 0, z2: 79}]) assert.throws(() => V.parseBox({...ok, ...bad}), bad.y1 === -64 ? /box too big/ : undefined, JSON.stringify(bad));
  assert.throws(() => V.parseBox({...ok, x1: undefined}), /x1/);
  // a 3x3x3 stone cube in air with a water cell on top, a glass cell beside it, a torch and an unloaded column
  const m = (x, y, z) => {
    if (x === 9) return null;
    if (x >= 0 && x <= 2 && y >= 0 && y <= 2 && z >= 0 && z <= 2) return 'stone';
    if (x === 1 && y === 3 && z === 1) return 'water';
    if (x === 3 && y === 1 && z === 1) return 'glass';
    if (x === 1 && y === 3 && z === 2) return 'torch';
    return 'air';
  };
  const r = V.collect({x1: 0, y1: 0, z1: 0, x2: 2, y2: 3, z2: 2}, m);
  const of = (n) => r.blocks.filter((b) => r.names[b[3]] === n);
  assert.strictEqual(of('stone').length, 26, 'the buried middle of the cube is left out');
  assert.ok(!of('stone').some((b) => b[0] === 1 && b[1] === 1 && b[2] === 1));
  assert.strictEqual(of('water').length, 1, 'a fluid shown where it touches air');
  assert.strictEqual(of('torch').length + of('air').length, 0, 'air and torches are not drawn');
  assert.strictEqual(r.unloaded, 0);
  const g = V.collect({x1: 0, y1: 1, z1: 1, x2: 4, y2: 1, z2: 1}, m);
  assert.strictEqual(g.blocks.filter((b) => g.names[b[3]] === 'glass').length, 1, 'glass is drawn');
  const u = V.collect({x1: 8, y1: 0, z1: 0, x2: 9, y2: 0, z2: 0}, m);
  assert.strictEqual(u.unloaded, 1, 'unloaded cells are counted, never invented');
  // a fluid body shows only its surface; a block hidden by an unloaded neighbour is not "visible" through it
  const sea = V.collect({x1: 0, y1: 0, z1: 0, x2: 2, y2: 2, z2: 2}, (x, y) => (y < 2 ? 'water' : 'air'));
  assert.ok(sea.blocks.every((b) => b[1] === 1) && sea.blocks.length === 9);
  // surroundings: the top visible block per column; plants skipped, water kept, unloaded columns skipped and counted
  assert.deepStrictEqual(V.parseSurface({x1: '5', z1: 5, x2: 1, z2: 1}), {x1: 1, z1: 1, x2: 5, z2: 5});
  assert.doesNotThrow(() => V.parseSurface({x1: 0, z1: 0, x2: 159, z2: 159}));
  for (const bad of [{x1: 'a'}, {x1: 1.5}, {z2: ''}, {x2: 160}, {z2: 160}]) assert.throws(() => V.parseSurface({x1: 0, z1: 0, x2: 1, z2: 1, ...bad}), undefined, JSON.stringify(bad));
  const sf = V.surface({x1: 0, z1: 0, x2: 3, z2: 0}, (x, y) => x === 3 ? null : x === 2 ? (y > 10 ? 'air' : 'water') : y > 20 ? 'air' : y === 20 ? 'short_grass' : y > 5 ? 'stone' : 'bedrock');
  assert.deepStrictEqual(sf.cols.map((c) => [c[0], c[1], sf.names[c[3]]]), [[0, 19, 'stone'], [1, 19, 'stone'], [2, 10, 'water']]);
  assert.strictEqual(sf.unloaded, 1);
}
(async () => { // the async drivers (what the server uses) give the same answers and really hand control back
  const V = require('../voxels');
  let turns = 0; const t = setInterval(() => turns++, 0);
  const at = (x, y, z) => (y < 30 ? 'stone' : 'air');
  const box = {x1: 0, z1: 0, x2: 59, z2: 59};
  assert.deepStrictEqual(await V.surfaceAsync(box, at), V.surface(box, at));
  const b3 = {x1: 0, y1: 0, z1: 0, x2: 39, y2: 39, z2: 39};
  assert.deepStrictEqual(await V.collectAsync(b3, at), V.collect(b3, at));
  clearInterval(t); assert.ok(turns > 0, 'the event loop got turns during the read');
})().catch((e) => { console.error(e); process.exit(1); });
(async () => {
  const {spawn} = require('node:child_process');
  const net = require('node:net');
  const port = await new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  // fake BlueMap: one tile, records every path asked for
  const asked = [];
  const bm = require('node:http').createServer((q, s) => { asked.push(q.url); if (q.url === '/maps/world/tiles/1/x-1/z0.png') { s.writeHead(200); s.end('PNGDATA'); } else { s.writeHead(404); s.end(); } });
  await new Promise((res) => bm.listen(0, '127.0.0.1', res));
  const child = spawn(process.execPath, [require('node:path').join(APP, 'server.js')], {
    env: {PATH: process.env.PATH, NODE_PATH: process.env.NODE_PATH || '', BOT_NAMES: 'bot1,bot2', WORKER_PORT: String(port + 1 < 65535 ? port + 1 : port - 1), WORKER_TOKEN: 'c0ffee11'.repeat(5), DASHBOARD_PORT: String(port), DASHBOARD_HOST: '127.0.0.1', ALLOWED_TS_LOGINS: 'a@github', MC_HOST: '127.0.0.1', MC_PORT: '1', BOT_PASSWORD_SEED: 'test', BLUEMAP_URL: `http://127.0.0.1:${bm.address().port}`},
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('server did not start')), 8000);
      child.stdout.on('data', (b) => { if (String(b).includes('listening')) { clearTimeout(to); res(); } });
      child.on('exit', (c) => rej(new Error(`server exited early (${c})`)));
    });
    const base = `http://127.0.0.1:${port}/api/debug`;
    assert.strictEqual((await fetch(base)).status, 403, 'no login -> 403');
    assert.strictEqual((await fetch(base, {headers: {'tailscale-user-login': 'evil@github'}})).status, 403);
    const r = await fetch(base, {headers: {'tailscale-user-login': 'a@github'}});
    assert.strictEqual(r.status, 200);
    assert.ok(/json/.test(r.headers.get('content-type')));
    const j = await r.json();
    assert.strictEqual(j.windowS, 30);
    assert.ok(!Number.isNaN(Date.parse(j.generatedAt)));
    assert.deepStrictEqual(j.bots.map((b) => b.name), ['bot1', 'bot2']);
    for (const b of j.bots) {
      assert.strictEqual(b.online, false);
      assert.deepStrictEqual(Object.keys(b.corrections).sort(), ['last30s', 'lastAgoS', 'total']);
      assert.deepStrictEqual(b.claims, {granted: 0, refused: 0, timedOut: 0});
      assert.ok(Array.isArray(b.positions) && Array.isArray(b.queue));
    }
    assert.strictEqual((await fetch(base, {method: 'POST', headers: {'tailscale-user-login': 'a@github'}})).status, 404);
    // the hub inside the real server: a worker joins, "all" reaches it, and an absent worker never blocks a Stop
    const wport = port + 1 < 65535 ? port + 1 : port - 1;
    const WebSocket = require('ws');
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/job`, {method: 'POST', headers: {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'tailscale-user-login': 'a@github'}, body: JSON.stringify(body)});
    const state = async () => (await (await fetch(`http://127.0.0.1:${port}/api/state`, {headers: {'tailscale-user-login': 'a@github'}})).json()).bots;
    const wsOpen = (headers) => new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${wport}/worker`, {headers}); ws.on('open', () => res(ws)); ws.on('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); ws.on('error', () => {}); });
    await assert.rejects(wsOpen({}), /401/);
    const wk = await wsOpen({Authorization: `Bearer ${'c0ffee11'.repeat(5)}`});
    const got = [];
    wk.on('message', (d) => got.push(JSON.parse(String(d))));
    wk.send(JSON.stringify({t: 'hello', v: 1, host: 'laptop', bots: ['bot5']}));
    wk.send(JSON.stringify({t: 'status', bots: [{name: 'bot5', online: true, pos: [1, 2, 3]}]}));
    const poll = async (f, what) => { for (let i = 0; i < 100; i++) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } throw new Error(`timed out: ${what}`); };
    const b5 = await poll(async () => (await state()).find((b) => b.name === 'bot5' && b.online), 'bot5 listed online');
    assert.deepStrictEqual([b5.host, b5.remote, b5.connected], ['laptop', true, true]);
    assert.strictEqual((await post({bots: 'all', type: 'stop'})).status, 200);
    await poll(() => got.find((m) => m.t === 'job' && m.type === 'stop'), 'stop reached the worker');
    assert.strictEqual((await post({bots: ['bot5'], type: 'goto', args: {x: 1, y: 2, z: 3}})).status, 200);
    // events: the worker's own (only for its bots, kinds and sizes cleaned) and the hub's "worker connected"
    wk.send(JSON.stringify({t: 'status', bots: [], events: [{bot: 'bot5', kind: 'done', text: 'finished: goto 1 2 3'}, {bot: 'bot1', kind: 'done', text: 'not my bot'}, {bot: 'bot5', kind: 'weird', text: 'x'.repeat(500)}, 7]}));
    const ev = await poll(async () => { const j = await (await fetch(`http://127.0.0.1:${port}/api/events?since=0`, {headers: {'tailscale-user-login': 'a@github'}})).json(); return j.events.length >= 3 && j; }, 'events arrived');
    assert.deepStrictEqual(ev.events.map((e) => [e.bot, e.kind]), [['bot5', 'hub'], ['bot5', 'done'], ['bot5', 'info']]);
    assert.strictEqual(ev.events[2].text.length, 200);
    assert.strictEqual(ev.lastId, ev.events.at(-1).id);
    const after = await (await fetch(`http://127.0.0.1:${port}/api/events?since=${ev.lastId}`, {headers: {'tailscale-user-login': 'a@github'}})).json();
    assert.deepStrictEqual(after.events, []);
    // the page may only run its own two inline blocks and the app's own files (the vendored three.js)
    const csp = (await fetch(`http://127.0.0.1:${port}/`, {headers: {'tailscale-user-login': 'a@github'}})).headers.get('content-security-policy');
    assert.match(csp, /default-src 'none'; script-src 'self' 'sha256-[\w+/=]{44}'; style-src 'sha256-[\w+/=]{44}'; connect-src 'self'/);
    // the 3D map: human path only, bad boxes refused, the vendored script served
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/api/voxels?x1=0&y1=0&z1=0&x2=500&y2=1&z2=1`, {headers: {'tailscale-user-login': 'a@github'}})).status, 400);
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/api/voxels?x1=0&y1=0&z1=0&x2=1&y2=1&z2=1`, {headers: {'tailscale-user-login': 'a@github'}})).status, 409, 'no bot online to read from');
    assert.match(await (await fetch(`http://127.0.0.1:${port}/vendor/three.min.js`, {headers: {'tailscale-user-login': 'a@github'}})).text(), /Three\.js Authors/);
    // a supply marker replaces the configured supply chest for everyone
    const placesPost = (body, origin = `http://127.0.0.1:${port}`) => fetch(`http://127.0.0.1:${port}/api/places`, {method: 'POST', headers: {'content-type': 'application/json', origin, 'tailscale-user-login': 'a@github'}, body: JSON.stringify(body)});
    assert.strictEqual((await placesPost({action: 'set', place: {name: 'Main', kind: 'supply', x: 5, y: 64, z: 6}}, 'http://evil.example')).status, 403, 'cross-origin refused');
    const pr = await placesPost({action: 'set', place: {name: 'Main', kind: 'supply', x: 5, y: 64, z: 6}});
    assert.deepStrictEqual([pr.status, (await pr.json()).supplyChest], [200, {x: 5, y: 64, z: 6}]);
    const full = await (await fetch(`http://127.0.0.1:${port}/api/state`, {headers: {'tailscale-user-login': 'a@github'}})).json();
    assert.deepStrictEqual([full.supplyChest, full.places.length], [{x: 5, y: 64, z: 6}, 1 + 7]); // the marker plus the 7 seeded zones
    assert.strictEqual((await placesPost({action: 'set', place: {name: 'Bad', kind: 'nope', x: 0, y: 0, z: 0}})).status, 400);

    // map tiles: proxied from BlueMap; anything else never reaches it
    const tileUrl = (pth) => fetch(`http://127.0.0.1:${port}${pth}`, {headers: {'tailscale-user-login': 'a@github'}});
    const tl = await tileUrl('/api/tile/world/1/x-1/z0.png');
    assert.deepStrictEqual([tl.status, tl.headers.get('content-type'), await tl.text()], [200, 'image/png', 'PNGDATA']);
    assert.strictEqual((await tileUrl('/api/tile/world/1/x9/z9.png')).status, 404, 'missing tile');
    for (const bad of ['/api/tile/evil/1/x0/z0.png', '/api/tile/world/7/x0/z0.png', '/api/tile/world/1/x0/z0.png%2F..%2F..%2Fsettings.json']) assert.strictEqual((await tileUrl(bad)).status, 404, bad);
    assert.ok(asked.filter((u) => u.includes('/tiles/')).every((u) => /^\/maps\/world\/tiles\/1\/x-?\d+\/z-?\d+\.png$/.test(u)), asked.join());
    bm.close();
    wk.close();
    const gone = await poll(async () => (await state()).find((b) => b.name === 'bot5' && !b.connected), 'bot5 offline');
    assert.deepStrictEqual([gone.online, gone.host, gone.lastSeen > 0], [false, 'laptop', true]);
    assert.strictEqual((await post({bots: 'all', type: 'stop'})).status, 200, 'an absent worker does not break Stop for all');
    const named = await post({bots: ['bot5'], type: 'stop'});
    assert.strictEqual(named.status, 400);
    assert.match((await named.json()).error, /bot5.*offline/);
    assert.strictEqual((await fetch(`http://127.0.0.1:${wport}/api/state`)).status, 404, 'the worker port serves no dashboard');
  } finally {
    child.kill('SIGKILL');
  }
})();
