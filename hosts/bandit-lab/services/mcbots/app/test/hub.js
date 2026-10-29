'use strict';
const assert = require('node:assert');
// ---- hub: reservations, remote workers, worker client ----
{
  const {WorldModel} = require('../world');
  const w = new WorldModel();
  assert.ok(w.claim('bot1', 'overworld:1,2,3') && w.claim('bot1', 'overworld:1,2,4') && !w.claim('bot2', 'overworld:1,2,3'));
  w.releaseAll('bot1');
  assert.strictEqual(w.claims.size, 0);
  assert.strictEqual(w.unreachable, false);
  assert.ok(w.claim('bot2', 'overworld:1,2,3'));

  const {loadWorkerConfig, loadConfig: lc} = require('../config');
  const env = {HUB_URL: 'wss://bandit-lab.example.ts.net:8446/worker', HUB_TOKEN: 'x'.repeat(40), MC_HOST: '100.1.1.1', BOT_PASSWORD_SEED: 's'};
  const wc = loadWorkerConfig(env, ['bot5', 'bot6']);
  assert.deepStrictEqual([wc.names, wc.mcHost, wc.mcPort], [['bot5', 'bot6'], '100.1.1.1', 25565]);
  for (const bad of [[], ['bot5', 'bot5'], ['bot1000'], ['--help'], ['Bot5']]) assert.throws(() => loadWorkerConfig(env, bad), JSON.stringify(bad));
  assert.throws(() => loadWorkerConfig({...env, HUB_URL: 'http://x/worker'}, ['bot5']));
  assert.throws(() => loadWorkerConfig({...env, HUB_URL: 'ws://evil.example/worker'}, ['bot5']));
  assert.doesNotThrow(() => loadWorkerConfig({...env, HUB_URL: 'ws://127.0.0.1:9/worker'}, ['bot5']));
  assert.throws(() => loadWorkerConfig({...env, HUB_TOKEN: ''}, ['bot5']));
  const tok = 'a1b2c3d4'.repeat(8);
  assert.strictEqual(lc({BOT_NAMES: 'bot1', WORKER_PORT: '8096', WORKER_TOKEN: tok}).workerPort, 8096);
  assert.throws(() => lc({BOT_NAMES: 'bot1', WORKER_PORT: '8096'}), 'port without token');
  assert.throws(() => lc({BOT_NAMES: 'bot1', WORKER_TOKEN: tok}), 'token without port');
  assert.throws(() => lc({BOT_NAMES: 'bot1', WORKER_PORT: '8095', WORKER_TOKEN: tok}), 'same port as the dashboard');
  assert.throws(() => lc({BOT_NAMES: 'bot1', WORKER_PORT: '8096', WORKER_TOKEN: 'short'}));
  assert.strictEqual(lc({BOT_NAMES: 'bot1'}).workerToken, '');
}

(async () => {
  const WebSocket = require('ws');
  const net = require('node:net');
  const {WorldModel} = require('../world');
  const {Hub, createWorkerServer, RemoteRunner} = require('../hub');
  const {RemoteWorld, HubClient} = require('../hubclient');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, what, ms = 10000) => {
    for (let t = 0; t < ms; t += 20) {
      const v = await f();
      if (v) return v;
      await sleep(20);
    }
    throw new Error(`timed out: ${what}`);
  };
  const port = await new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const token = 'f00dcafe'.repeat(6);
  const world = new WorldModel();
  const labBot = {name: 'bot1', start() {}, shutdown() {}, snapshot: () => ({name: 'bot1', online: true}), debug: () => ({}), enqueue() {}};
  const runners = new Map([['bot1', labBot]]);
  const hubSettings = new (require('../settings').Settings)('');
  const hub = new Hub({world, runners, token, log: () => {}, protectedAreas: [[1, 2, 3, 4]], supplyChest: {x: 1, y: 2, z: 3}, settings: hubSettings});
  const server = createWorkerServer(hub);
  await new Promise((res) => server.listen(port, '127.0.0.1', res));
  const url = `ws://127.0.0.1:${port}/worker`;

  // a worker as a raw websocket, to look at the wire
  const open = (headers) => new Promise((res, rej) => {
    const ws = new WebSocket(url, {headers});
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => res({ws, msgs, send: (m) => ws.send(JSON.stringify(m)), closed: new Promise((r) => ws.on('close', (c) => r(c)))}));
    ws.on('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    ws.on('error', () => {});
  });
  const rejects = async (p, re) => { try { await p; } catch (e) { return assert.match(e.message, re); } assert.fail('should have been refused'); };

  try {
    // admission: token required, nothing but /worker is served
    await rejects(open({}), /401/);
    await rejects(open({Authorization: 'Bearer wrong' + token}), /401/);
    await rejects(open({Authorization: `Basic ${token}`}), /401/);
    await rejects(new Promise((res, rej) => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {headers: {Authorization: `Bearer ${token}`}}); ws.on('open', res); ws.on('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); ws.on('error', () => {}); }), /404/);
    const plain = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.strictEqual(plain.status, 404, 'no dashboard routes on the worker port');
    const auth = {Authorization: `Bearer ${token}`};
    const W1 = 'a1'.repeat(16), W2 = 'b2'.repeat(16); // two workers' ids (hubclient derives them from the login seed)

    // a worker may not take over the lab's bots, nor send anything before hello
    let a = await open(auth);
    a.send({t: 'hello', v: 1, host: 'laptop', bots: ['bot1']});
    await until(() => a.msgs.find((m) => m.t === 'error'), 'lab bot refused');
    assert.match(a.msgs.find((m) => m.t === 'error').message, /bot1 run in the lab/);
    await a.closed;
    a = await open(auth);
    a.send({t: 'status', bots: []});
    assert.strictEqual((await a.closed), 1008);
    a = await open(auth);
    a.send({t: 'hello', v: 99, host: 'laptop', bots: ['bot5']});
    await a.closed;
    assert.ok(!runners.has('bot5'));

    // a proper worker
    a = await open(auth);
    a.send({t: 'hello', v: 1, host: 'laptop', wid: W1, bots: ['bot5']});
    const welcome = await until(() => a.msgs.find((m) => m.t === 'welcome'), 'welcome');
    assert.deepStrictEqual([welcome.protectedAreas, welcome.supplyChest], [[[1, 2, 3, 4]], {x: 1, y: 2, z: 3}]);
    // a worker running only another player's bots gets no supply chest
    hub.guests = new Set(['bot22']);
    assert.strictEqual(hub.chestFor({bots: new Set(['bot22'])}), null);
    assert.deepStrictEqual(hub.chestFor({bots: new Set(['bot22', 'bot5'])}), {x: 1, y: 2, z: 3});
    hub.guests = new Set();
    const r5 = runners.get('bot5');
    assert.ok(r5 instanceof RemoteRunner);
    assert.strictEqual(r5.snapshot().online, false, 'not online until the bot reports in');
    a.send({t: 'status', bots: [
      {name: 'bot5', online: true, health: 18, food: 'lots', pos: [1, 64, 3], dimension: 'overworld', job: {label: 'mine stone 3', progress: '1/3'}, queue: ['say hi'], inventory: Array(500).fill('x'.repeat(500)), lastError: 'e'.repeat(5000), pullbacks: 3, debug: {pos: [1, 64, 3], corrections: {total: 7, last30s: 2, lastAgoS: 1.5}, claims: {granted: 4, refused: -1, timedOut: 'x', evil: 9}, positions: [{agoS: 1, x: 1, y: 64, z: 3}], job: {id: 1, type: 'mine', args: {block: 'stone', evil: {a: 1}}, status: 'running', progress: '1/3', runningS: 2}}},
      {name: 'bot1', online: true, health: 1}, // not this worker's bot: ignored
      {name: 'bot9', online: true}, // not announced: ignored
    ]});
    await until(() => r5.snapshot().online, 'bot5 online');
    const s5 = r5.snapshot();
    assert.strictEqual(s5.host, 'laptop');
    assert.strictEqual(s5.remote, true);
    assert.deepStrictEqual([s5.health, s5.food, s5.pos, s5.pullbacks], [18, null, [1, 64, 3], 3]);
    assert.strictEqual(s5.inventory.length, 80);
    assert.ok(s5.inventory.every((x) => x.length <= 60) && s5.lastError.length === 300);
    assert.ok(s5.lastSeen > 0);
    assert.ok(!runners.has('bot9') && runners.get('bot1') === labBot);
    const d5 = r5.debug();
    assert.deepStrictEqual(d5.corrections, {total: 7, last30s: 2, lastAgoS: 1.5});
    assert.deepStrictEqual(d5.claims, {granted: 4, refused: 0, timedOut: 0}, 'claim counters are sanitised to non-negative ints, unknown keys dropped');
    assert.strictEqual(d5.job.args.evil, '[object Object]'.slice(0, 200));
    assert.doesNotThrow(() => JSON.stringify([s5, d5]));
    assert.deepStrictEqual(r5.kept, [], 'no kept jobs reported yet');
    // kept jobs: only the long job types, re-validated; bad entries and over-long lists are dropped
    a.send({t: 'status', bots: [{name: 'bot5', online: true, kept: [
      {type: 'say', args: {text: 'hi'}}, {type: 'mine', args: {block: 'stone', count: 'many'}}, 'junk', null,
      {type: 'shift', args: {block: 'logs', x: 1, y: 64, z: 1, evil: 1}}, {type: 'mine', args: {block: 'stone', count: 3}},
      ...Array(40).fill({type: 'chop', args: {count: 2}}),
    ]}]});
    await until(() => r5.kept.length, 'kept jobs reported');
    assert.deepStrictEqual(r5.kept.slice(0, 2).map((j) => j.type), ['shift', 'mine']);
    assert.ok(!('evil' in r5.kept[0].args) && r5.kept.length <= 20);

    // jobs from the dashboard go to the worker, validated on the hub first
    r5.enqueue('goto', {x: '1', y: 2, z: 3}, {replace: true});
    r5.enqueue('stop');
    const jobs = await until(() => a.msgs.filter((m) => m.t === 'job').length === 2 && a.msgs.filter((m) => m.t === 'job'), 'jobs forwarded');
    assert.deepStrictEqual(jobs[0], {t: 'job', bot: 'bot5', type: 'goto', args: {x: 1, y: 2, z: 3}, replace: true});
    assert.deepStrictEqual([jobs[1].type, jobs[1].replace], ['stop', false]);
    assert.throws(() => r5.enqueue('say', {text: '/op me'}));
    assert.throws(() => r5.enqueue('format-disk', {}));
    assert.strictEqual(a.msgs.filter((m) => m.t === 'job').length, 2, 'rejected jobs never reach the worker');

    // reservations: the hub is the only authority
    assert.ok(world.claim('bot1', 'overworld:5,60,5')); // a lab bot holds this block
    const ask = async (key, by = 'bot5') => {
      const id = Math.floor(Math.random() * 1e6);
      a.send({t: 'claim', id, key, by});
      return (await until(() => a.msgs.find((m) => m.t === 'claim_result' && m.id === id), 'claim_result')).ok;
    };
    assert.strictEqual(await ask('overworld:5,60,5'), false, 'a block a lab bot holds is refused');
    assert.strictEqual(await ask('overworld:6,60,5'), true);
    assert.ok(world.claimedByOther('bot1', 'overworld:6,60,5'), 'lab bots see the worker claim');
    assert.strictEqual(await ask('overworld:7,60,5', 'bot1'), false, 'a worker cannot claim for a lab bot');
    assert.strictEqual(await ask('not a key'), false);
    for (let i = 0; i < 12; i++) await ask(`overworld:${10 + i},60,5`);
    assert.ok([...world.claims.values()].filter((c) => c.by === 'bot5').length <= 8, 'claims per bot are capped');
    a.send({t: 'release', key: 'overworld:6,60,5', by: 'bot5'});
    await until(() => !world.claims.has('overworld:6,60,5'), 'release');
    // a production step is a key too: bot2 on worker-2 never got one and waited for good (main server 2026-10-19)
    assert.strictEqual(await ask('produce:craft:stone_bricks'), true);
    assert.ok(world.claimedByOther('bot1', 'produce:craft:stone_bricks'), 'the lab bots see the step taken');
    assert.strictEqual(await ask('produce:format:disk'), false);
    a.send({t: 'release', key: 'produce:craft:stone_bricks', by: 'bot5'});
    await until(() => !world.claims.has('produce:craft:stone_bricks'), 'release a step');

    // observations and the picture sent back
    a.send({t: 'observe', mobs: [{id: 77, type: 'zombie', x: 1, y: 2, z: 3, dim: 'overworld', by: 'bot5'}, {id: 'x', type: 'zombie'}], blocks: [{type: 'chest', x: 4, y: 5, z: 6, dim: 'overworld', by: 'bot5'}], gone: []});
    await until(() => world.mobs.has('overworld:77') && world.blocks.size === 1, 'observations');
    assert.strictEqual(world.mobs.size, 1);
    hub.broadcastWorld();
    const wm = await until(() => a.msgs.find((m) => m.t === 'world'), 'world broadcast');
    assert.ok(wm.mobs.some((m) => m.id === 77) && wm.claims.some((c) => c.by === 'bot1'));

    // the worker goes away: bot5 stays listed as offline with its last-seen, claims are freed
    const seen = r5.snapshot().lastSeen;
    assert.ok(await ask('overworld:30,60,5'));
    a.ws.close();
    await until(() => !r5.snapshot().connected, 'offline');
    const off = r5.snapshot();
    assert.deepStrictEqual([off.online, off.host, off.lastSeen, off.job, off.queue], [false, 'laptop', seen, null, []]);
    assert.ok(![...world.claims.values()].some((c) => c.by === 'bot5'), 'claims of a gone worker are released');
    assert.throws(() => r5.enqueue('goto', {x: 1, y: 2, z: 3}), /offline/);

    // a reconnect replaces a stale connection (same worker: same wid, whatever its host label says)
    const old = await open(auth);
    old.send({t: 'hello', v: 1, host: 'laptop', wid: W1, bots: ['bot5']});
    await until(() => old.msgs.find((m) => m.t === 'welcome'), 'welcome 1');
    const fresh = await open(auth);
    fresh.send({t: 'hello', v: 1, host: 'laptop2', wid: W1, bots: ['bot5']});
    await until(() => fresh.msgs.find((m) => m.t === 'welcome'), 'welcome 2');
    assert.strictEqual(await old.closed, 4001);
    assert.strictEqual(r5.snapshot().connected, true, 'the new connection stays owner');
    assert.strictEqual(r5.snapshot().host, 'laptop2');
    fresh.ws.close();
    await until(() => !r5.snapshot().connected, 'offline again');

    // a replaced connection must not keep acting for the bot it lost
    {
      const o = await open(auth);
      o.send({t: 'hello', v: 1, host: 'a', wid: W1, bots: ['bot8']});
      await until(() => o.msgs.find((m) => m.t === 'welcome'), 'welcome old');
      const n = await open(auth);
      n.send({t: 'hello', v: 1, host: 'b', wid: W1, bots: ['bot8']});
      await until(() => n.msgs.find((m) => m.t === 'welcome'), 'welcome new');
      o.send({t: 'claim', id: 1, key: 'overworld:70,60,5', by: 'bot8'});
      o.send({t: 'ping'});
      await sleep(300);
      assert.ok(!world.claims.has('overworld:70,60,5'), 'a replaced connection cannot claim');
      n.ws.close();
      await until(() => !runners.get('bot8').snapshot().connected, 'bot8 offline');
    }

    // bot names belong to the worker that first announced them (R2-6)
    {
      const hello = async (wid, host, bots) => {
        const c = await open(auth);
        c.send({t: 'hello', v: 1, host, ...(wid ? {wid} : {}), bots});
        return c;
      };
      const welcomed = (c, what) => until(() => c.msgs.find((m) => m.t === 'welcome'), what);
      const lab = await hello(W1, 'bandit-lab-worker', ['bot16', 'bot17']);
      await welcomed(lab, 'lab worker');
      // another credential holder can neither announce nor replace them, nor the laptop's bot5
      for (const names of [['bot16'], ['bot16', 'bot21'], ['bot5'], ['bot17', 'bot5']]) {
        const evil = await hello(W2, 'bandit-lab-worker', names);
        assert.strictEqual(await evil.closed, 4003, names.join());
        assert.match(evil.msgs.find((m) => m.t === 'error').message, /taken by another worker/);
        assert.ok(runners.get('bot16').snapshot().connected, 'the owner stays connected');
        assert.ok(runners.get('bot16').conn.bots.has('bot16'));
      }
      assert.ok(!runners.has('bot21'), 'a refused hello binds and creates nothing');
      // the same worker (same id, whatever its label) takes its names back and replaces the stale socket
      const again = await hello(W1, 'renamed-host', ['bot16', 'bot17']);
      await welcomed(again, 'owner again');
      assert.strictEqual(await lab.closed, 4001);
      // a free name goes to whoever asks first; a worker without id is told apart by its host label
      const other = await hello(W2, 'laptop', ['bot21']);
      await welcomed(other, 'second worker, free name');
      const old1 = await hello(null, 'oldhost', ['bot22']);
      await welcomed(old1, 'worker without id');
      const old2 = await hello(null, 'elsewhere', ['bot22']);
      assert.strictEqual(await old2.closed, 4003);
      const old3 = await hello(W1, 'oldhost', ['bot22']);
      assert.strictEqual(await old3.closed, 4003, 'an id does not match a name bound by label');
      const old4 = await hello(null, 'oldhost', ['bot22']);
      await welcomed(old4, 'same label reconnects');
      assert.strictEqual(await old1.closed, 4001);
      for (const c of [again, other, old4]) c.ws.close();
      await until(() => !runners.get('bot16').snapshot().connected && !runners.get('bot22').snapshot().connected, 'all offline');
    }

    // a worker restarted alone: the hub queues its bots' KEEP jobs again once they are online and idle
    {
      const hello = async () => {
        const c = await open(auth);
        c.send({t: 'hello', v: 1, host: 'laptop', wid: W2, bots: ['bot20']});
        await until(() => c.msgs.find((m) => m.t === 'welcome'), 'welcome bot20');
        return c;
      };
      const keep = [{type: 'mine', args: {block: 'stone', count: 5}}];
      const status = (c, extra) => c.send({t: 'status', bots: [{name: 'bot20', ...extra}]});
      const jobs = (c) => c.msgs.filter((m) => m.t === 'job');
      let c = await hello();
      status(c, {online: true, job: {type: 'mine', label: 'mine stone 5'}, kept: keep});
      const r20 = runners.get('bot20');
      await until(() => r20.kept.length === 1, 'kept reported');
      c.ws.close(); // the worker is restarted
      await until(() => !r20.snapshot().connected, 'worker gone');
      c = await hello();
      status(c, {online: false, kept: []}); // the new process: not logged in yet, nothing queued
      await sleep(150);
      assert.strictEqual(r20.kept.length, 1, 'the old list is kept while the bot logs in');
      assert.strictEqual(jobs(c).length, 0);
      status(c, {online: true, kept: []});
      await until(() => jobs(c).length === 1, 'job queued again');
      assert.deepStrictEqual([jobs(c)[0].type, jobs(c)[0].args], ['mine', {block: 'stone', count: 5}]);
      assert.strictEqual(r20.kept.length, 1, 'saved until the worker reports it');
      status(c, {online: true, kept: []}); // not queued twice
      await sleep(150);
      assert.strictEqual(jobs(c).length, 1);
      // a plain reconnect (the worker never stopped) keeps the worker's own queue: nothing is sent
      status(c, {online: true, job: {type: 'mine', label: 'mine stone 5'}, kept: keep});
      await until(() => r20.kept.length === 1 && r20.snap.job, 'job running');
      c.ws.close();
      await until(() => !r20.snapshot().connected, 'blip');
      c = await hello();
      status(c, {online: true, job: {type: 'mine', label: 'mine stone 5'}, kept: keep});
      await sleep(150);
      assert.strictEqual(jobs(c).length, 0);
      // a stop forgets them; a bot that stays away past the window starts empty
      c.ws.close();
      await until(() => !r20.snapshot().connected, 'blip 2');
      c = await hello();
      const realNow = hub.now;
      hub.now = () => Date.now() + 6 * 60000;
      status(c, {online: true, kept: []});
      await until(() => r20.kept.length === 0, 'window over: adopt the worker list');
      assert.strictEqual(jobs(c).length, 0);
      hub.now = realNow;
      c.ws.close();
      await until(() => !r20.snapshot().connected, 'bot20 offline');
    }

    // a flooding worker is cut off
    {
      const f = await open(auth);
      f.send({t: 'hello', v: 1, host: 'flood', bots: ['bot9']});
      await until(() => f.msgs.find((m) => m.t === 'welcome'), 'welcome flood');
      for (let i = 0; i < 1000; i++) f.send({t: 'ping'});
      assert.strictEqual(await f.closed, 1008, 'message flood closes the connection');
    }

    // connections are capped (each costs memory before it has said hello)
    {
      const socks = [];
      let refused = false;
      for (let i = 0; i < 40 && !refused; i++) {
        try { socks.push(await open(auth)); } catch (e) { refused = /503/.test(e.message); if (!refused) throw e; }
      }
      assert.ok(refused, 'too many connections are refused with 503');
      for (const x of socks) x.ws.terminate();
      await until(() => hub.conns.size === 0, 'sockets closed');
    }

    // a worker with the wrong token keeps retrying with back-off and never gets a runner
    const badLogs = [];
    const bad = new HubClient({url, token: 'bad'.repeat(20), names: ['bot7'], hostLabel: 'lap', log: (w, m) => badLogs.push(m), makeRunner: () => assert.fail('no runner without a welcome')});
    bad.start();
    await until(() => badLogs.filter((l) => /refused.*401/.test(l)).length >= 2, 'refused twice (retrying)', 8000);
    assert.ok(bad.backoff >= 2000, `back-off grows: ${bad.backoff}`);
    bad.stop();
    assert.ok(!runners.has('bot7'));

    // guessing: after 20 wrong tokens in a minute the next wrong one is 429, but the real token still gets in
    for (let i = 0; i < 25; i++) await open({Authorization: `Bearer ${'x'.repeat(30 + i)}`}).catch(() => {});
    await rejects(open({Authorization: `Bearer ${'y'.repeat(40)}`}), /429/);
    (await open(auth)).ws.close(); // the real client below also connects while the window is full

    // the real client against the real hub (stub bots instead of a Minecraft login)
    const got = [];
    hubSettings.set('bot6', {defend: false, eatBelow: 10}); // chosen before the worker ever connected
    const stub = {name: 'bot6', started: false, current: null, queue: [], start() { this.started = true; }, shutdown() {}, snapshot: () => ({name: 'bot6', online: true, pos: [9, 9, 9], job: null, queue: [], inventory: [], pullbacks: 0}), debug: () => ({pos: [9, 9, 9]}), enqueue: (type, args, opts) => got.push([type, args, opts])};
    const logs = [];
    const client = new HubClient({url, token, names: ['bot6'], hostLabel: 'lap', log: (w, m) => logs.push(`${w}: ${m}`), makeRunner: () => stub});
    assert.strictEqual(client.world.unreachable, true, 'no reservations before the hub answered');
    assert.strictEqual(await client.world.claim('bot6', 'overworld:1,1,1'), false);
    client.start();
    const r6 = await until(() => runners.get('bot6')?.snapshot().online && runners.get('bot6'), 'worker bot online');
    assert.ok(stub.started);
    assert.strictEqual(client.world.unreachable, false);
    assert.strictEqual(r6.snapshot().host, 'lap');
    // settings: the stored ones arrive with the welcome, a change is forwarded, a bad frame is refused on the worker too
    assert.deepStrictEqual([stub.getSettings().defend, stub.getSettings().eatBelow, stub.getSettings().torches], [false, 10, true]);
    r6.pushSettings(hubSettings.set('bot6', {torches: false}));
    await until(() => stub.getSettings().torches === false, 'settings forwarded to the worker');
    assert.strictEqual(stub.getSettings().defend, false, 'earlier settings stay');
    client.handle({t: 'settings', bot: 'bot6', settings: {eatBelow: 99}});
    client.handle({t: 'settings', bot: 'bot7', settings: {eatBelow: 3}});
    client.handle({t: 'settings', bot: 'bot6', settings: {evil: 1, fightRange: 4}});
    assert.deepStrictEqual([stub.getSettings().eatBelow, stub.getSettings().fightRange, client.settings.get('bot7').eatBelow], [10, 4, 15], 'refused values and foreign bots change nothing, unknown keys are dropped');
    assert.ok(logs.some((l) => /bot6: settings from hub rejected/.test(l)));
    { // protected zones and the supply chest reach a runner that already exists (Codex R7-2): policy frame and every welcome
      const box = {x1: 1, z1: 1, x2: 5, z2: 5};
      client.handle({t: 'policy', protectedAreas: [box], supplyChest: {x: 7, y: 8, z: 9}});
      assert.deepStrictEqual([stub.protectedAreas, stub.supplyChest], [[box], {x: 7, y: 8, z: 9}]);
      client.handle({t: 'welcome', protectedAreas: [], supplyChest: null, settings: {}});
      assert.deepStrictEqual([stub.protectedAreas, stub.supplyChest], [[], null], 'a reconnect repairs it too');
      // the wheat field too: hungry worker bots get bread there (bots.js wheatFood); a bad box is dropped
      client.handle({t: 'policy', protectedAreas: [], supplyChest: null, wheatField: {x1: -254, z1: -242, x2: -262, z2: -250}});
      assert.deepStrictEqual(stub.wheatField, {x1: -262, z1: -250, x2: -254, z2: -242});
      client.handle({t: 'policy', protectedAreas: [], supplyChest: null, wheatField: {x1: 0, z1: 0, x2: 30, z2: 30}});
      assert.strictEqual(stub.wheatField, null);
      hub.protectedAreas.push(box); hub.broadcastPolicy();
      await until(() => stub.protectedAreas.length === 2, 'the hub broadcast reaches the connected worker');
      hub.protectedAreas.pop(); hub.broadcastPolicy();
      await until(() => stub.protectedAreas.length === 1, 'and the removal too');
    }
    // kept jobs: the worker reports its own list, the hub keeps it; Stop empties it at once
    stub.current = {type: 'shift', args: {block: 'logs', x: 1, y: 64, z: 1}};
    stub.queue = [{type: 'mine', args: {block: 'stone', count: 5}, collected: 2}, {type: 'say', args: {text: 'x'}}, {type: 'chop', args: {count: 4}, cancelled: true}];
    await until(() => r6.kept.length === 3, 'kept jobs reached the hub');
    assert.deepStrictEqual(r6.kept, [{type: 'shift', args: {block: 'logs', x: 1, y: 64, z: 1}}, {type: 'mine', args: {block: 'stone', count: 3}}, {type: 'say', args: {text: 'x'}}], 'the rest of the chain follows the first long job (R6-5); a cancelled one does not');
    r6.enqueue('stop');
    assert.deepStrictEqual(r6.kept, []);
    stub.current = null;
    stub.queue = [];
    await until(() => got.length === 1, 'stop reached the stub bot');
    got.length = 0;
    r6.enqueue('mine', {block: 'stone', count: 2});
    await until(() => got.length === 1, 'job reached the stub bot');
    assert.deepStrictEqual(got[0], ['mine', {block: 'stone', count: 2}, {replace: false}]);
    assert.strictEqual(await client.world.claim('bot6', 'overworld:40,60,5'), true);
    assert.ok(world.claimedByOther('bot1', 'overworld:40,60,5'));
    assert.ok(world.claim('bot1', 'overworld:41,60,5'));
    hub.broadcastWorld();
    await until(() => client.world.claimedByOther('bot6', 'overworld:41,60,5'), 'lab claim mirrored to the worker');
    assert.strictEqual(await client.world.claim('bot6', 'overworld:41,60,5'), false, 'worker cannot take a lab bot block');
    assert.deepStrictEqual(client.world.claimStats('bot6'), {granted: 1, refused: 1, timedOut: 0}, 'worker counts hub answers and mirror refusals');
    {
      const mute = new RemoteWorld();
      mute.attach(() => {}); // a hub that never answers
      assert.strictEqual(await mute.claim('bot6', 'overworld:1,1,1'), false);
      assert.strictEqual(mute.claimStats('bot6').timedOut, 1);
    }
    // what a worker's bot saw in the supply chest reaches the hub's picture (cleaned: bad names and counts dropped)
    client.world.noteStock('bot6', {coal: 3, oak_log: 20, 'Bad Name': 5, stone: -1, dirt: 1.5});
    client.world.flush();
    await until(() => world.stock?.items.coal === 3, 'stock reached the hub');
    assert.deepStrictEqual(world.stock.items, {coal: 3, oak_log: 20});
    assert.strictEqual(world.stock.by, 'bot6');
    // One storage index for all processes (acquire.js plans from it): a worker's chest reaches the hub, cleaned...
    client.world.noteChest('10,64,-3', {iron_ingot: 12, 'Bad Name': 1, coal: -2}, 20);
    client.world.flush();
    await until(() => world.chests.get('10,64,-3'), 'worker chest reached the hub');
    assert.deepStrictEqual([world.chests.get('10,64,-3').items, world.chests.get('10,64,-3').free], [{iron_ingot: 12}, 20]);
    // ... and a lab bot's chest reaches the worker.
    world.noteChest('-5,60,7', {oak_log: 30});
    hub.broadcastWorld();
    await until(() => client.world.chests.get('-5,60,7'), 'lab chest reached the worker');
    assert.deepStrictEqual(client.world.chests.get('-5,60,7').items, {oak_log: 30});
    client.world.postNeed('bot6', 'hopper', 9, {x: -356, y: 72, z: -191}, 'waiting for material');
    client.world.flush();
    await until(() => world.openNeeds().some((n) => n.bot === 'bot6'), 'worker need reached hub');
    hub.broadcastWorld();
    await until(() => client.world.openNeeds().some((n) => n.bot === 'bot6' && n.item === 'hopper'), 'hub need returned to worker');
    client.world.dropNeed('bot6', 'hopper');
    client.world.flush();
    await until(() => !world.needs.has('bot6:hopper'), 'worker need removal reached hub');
    hub.broadcastWorld();
    await until(() => !client.world.needs.has('bot6:hopper'), 'hub need removal reached worker');
    client.world.learn('mine:stone', {ok: true, secs: 9, units: 3});
    client.world.flush();
    await until(() => world.learned('mine:stone')?.each === 3, 'worker experience reached hub');
    hub.observe({bots: new Set(['bot6'])}, {learn: [{bot: 'bot6', key: 'mine:bad-key!', ok: true, secs: 1, units: 1}]});
    assert.strictEqual(world.learned('mine:bad-key!'), null, 'hub rejects malformed worker experience');
    hub.broadcastWorld();
    await until(() => client.world.learned('mine:stone')?.each === 3, 'hub experience returned to worker');
    assert.deepStrictEqual([client.world.outExperience.length, client.world.experience.get('mine:stone').ok], [0, 1], 'the hub copy is not sent back or counted twice');
    client.world.learn('kill:sheep', {ok: false}); client.world.learn('kill:sheep', {ok: false});
    client.world.flush();
    await until(() => world.learned('kill:sheep')?.blocked === true, 'both outcomes of one interval reached the hub');
    hub.observe({bots: new Set(['bot6'])}, {needs: [
      {bot: 'bot6', item: 'stone', count: 0, to: {x: 1, y: 2, z: 3}, why: 'bad count'},
      {bot: 'bot6', item: 'stone', count: 1, to: {x: 1, y: 2, z: 3}, why: 'bad\ntext'},
      {bot: 'bot6', item: 'stone', count: 1, to: {x: 1, y: 2.5, z: 3}, why: 'bad position'},
    ]});
    assert.ok(!world.needs.has('bot6:stone'), 'hub rejects malformed worker needs');
    client.world.release('bot6', 'overworld:40,60,5');
    await until(() => !world.claims.has('overworld:40,60,5'), 'worker release reached the hub');
    // hub link drops: reservations are refused until it is back
    for (const c of hub.conns) c.ws.terminate();
    await until(() => client.world.unreachable, 'client noticed the drop');
    assert.strictEqual(await client.world.claim('bot6', 'overworld:42,60,5'), false);
    hubSettings.set('bot6', {fightRange: 5}); // changed while the worker is away (nothing to forward to)
    r6.pushSettings(hubSettings.get('bot6'));
    await until(() => !client.world.unreachable && runners.get('bot6').snapshot().connected, 'client reconnected', 6000);
    assert.strictEqual(stub.started, true);
    await until(() => stub.getSettings().fightRange === 5, 'reconnect brings the settings changed meanwhile');
    assert.strictEqual(stub.getSettings().torches, false, 'and keeps the rest');
    client.stop();
    await until(() => !runners.get('bot6').snapshot().connected, 'stopped worker is offline');
    assert.strictEqual(runners.get('bot6').snapshot().online, false);
  } finally {
    hub.close();
    server.close();
    for (const c of hub.conns) c.ws.terminate();
  }
})();
