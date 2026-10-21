'use strict';
const assert = require('node:assert');
const W = require('../world');
const {BotRunner} = require('../bots');
// ---- per-worker hub credentials (Codex R2-6): a lab worker runs its own names only ----
(async () => {
  const WebSocket = require('ws');
  const net = require('node:net');
  const {execSync} = require('node:child_process');
  const {WorldModel} = require('../world');
  const {Hub, createWorkerServer, workerToken} = require('../hub');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, what, ms = 5000) => {
    for (let t = 0; t < ms; t += 20) {
      const v = await f();
      if (v) return v;
      await sleep(20);
    }
    throw new Error(`timed out: ${what}`);
  };
  const shared = 'f00dcafe'.repeat(6);
  assert.strictEqual(workerToken(shared, 'bandit-lab-worker'), execSync(`printf 'mcbots-worker:%s:%s' bandit-lab-worker ${shared} | sha256sum | cut -c1-64`, {encoding: 'utf8'}).trim(), 'the sh derivation in default.nix matches');
  assert.deepStrictEqual(require('../config').loadConfig({BOT_NAMES: 'bot1', HUB_WORKERS: 'w-one=bot16,bot17; w-two=bot2'}).hubWorkers, {'w-one': ['bot16', 'bot17'], 'w-two': ['bot2']});
  assert.throws(() => require('../config').loadConfig({BOT_NAMES: 'bot1', HUB_WORKERS: 'w-one=steve'}), /HUB_WORKERS/);
  const port = await new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const fresh = () => new Map([['bot1', {name: 'bot1', start() {}, shutdown() {}, snapshot: () => ({name: 'bot1', online: true}), debug: () => ({}), enqueue() {}}]]);
  let runners = fresh();
  const workers = {'w-one': ['bot16', 'bot17', 'bot18'], 'w-two': ['bot2', 'bot3', 'bot4']};
  const make = () => new Hub({world: new WorldModel(), runners: (runners = fresh()), token: shared, workers, log: () => {}});
  let hub = make();
  const server = createWorkerServer(hub);
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req, socket, head) => hub.upgrade(req, socket, head));
  await new Promise((res) => server.listen(port, '127.0.0.1', res));
  const open = (token) => new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/worker`, {headers: {Authorization: `Bearer ${token}`}});
    const msgs = [];
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => res({ws, msgs, send: (m) => ws.send(JSON.stringify(m)), closed: new Promise((r) => ws.on('close', (c) => r(c)))}));
    ws.on('unexpected-response', (_q, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    ws.on('error', () => {});
  });
  const hello = async (token, bots, extra = {}) => {
    const c = await open(token);
    c.send({t: 'hello', v: 1, host: 'h', wid: 'a1'.repeat(16), bots, ...extra});
    return c;
  };
  const welcomed = (c) => until(() => c.msgs.find((m) => m.t === 'welcome'), 'welcome');
  try {
    const one = workerToken(shared, 'w-one'), two = workerToken(shared, 'w-two');
    // each credential runs its own names; the same wid and host label (as both lab containers have) change nothing
    const a = await hello(one, ['bot16', 'bot17']);
    await welcomed(a);
    const b = await hello(two, ['bot2']);
    await welcomed(b);
    for (const [token, names] of [[two, ['bot16']], [two, ['bot17', 'bot2']], [one, ['bot2']], [one, ['bot5']], [shared, ['bot16']], [shared, ['bot2', 'bot5']]]) {
      const evil = await hello(token, names);
      assert.strictEqual(await evil.closed, 4003, `${token.slice(0, 4)} ${names}`);
      assert.match(evil.msgs.find((m) => m.t === 'error').message, /may not be run with this worker credential|belong to a lab worker/);
    }
    assert.ok(runners.get('bot16').snapshot().connected && runners.get('bot2').snapshot().connected, 'the owners stay connected');
    assert.ok(!runners.has('bot5'), 'a refused hello creates nothing');
    // the owner reconnects and replaces its stale socket; the shared (laptop) credential still runs other names
    const again = await hello(one, ['bot16', 'bot17', 'bot18']);
    await welcomed(again);
    assert.strictEqual(await a.closed, 4001);
    const laptop = await hello(shared, ['bot5'], {wid: 'c3'.repeat(16)});
    await welcomed(laptop);
    for (const c of [again, b, laptop]) c.ws.close();
    // after a hub restart nothing is first-come: the sets are the server's
    hub.close();
    for (const c of hub.conns) c.ws.terminate();
    hub = make();
    const evil = await hello(two, ['bot16']);
    assert.strictEqual(await evil.closed, 4003, 'worker 2 cannot claim bot16 first after a restart');
    const owner = await hello(one, ['bot16']);
    await welcomed(owner);
    owner.ws.close();
    await assert.rejects(open('x'.repeat(40)), /401/);
  } finally {
    hub.close();
    server.close();
    for (const c of hub.conns) c.ws.terminate();
  }
})();

// ---- claims expire out of the per-bot count; offline workers are forgotten after an hour ----
{
  const {WorldModel, CLAIM_TTL_MS} = require('../world');
  let t = 1000;
  const w = new WorldModel({now: () => t});
  for (let i = 0; i < 8; i++) w.claim('bot5', `overworld:${i},1,1`);
  assert.strictEqual(w.held('bot5'), 8);
  t += CLAIM_TTL_MS + 1;
  assert.strictEqual(w.held('bot5'), 0); // expired claims no longer count
  assert.strictEqual(w.claims.size, 8);
  w.prune();
  assert.strictEqual(w.claims.size, 0); // and are pruned
  assert.ok(w.claim('bot6', 'overworld:0,1,1'));

  const {Hub, RemoteRunner, FORGET_MS} = require('../hub');
  const runners = new Map([['bot1', new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: w})]]);
  const {EventLog} = require('../events');
  const events = new EventLog();
  let now = 5000;
  const hub = new Hub({world: w, runners, token: 'k'.repeat(40), now: () => now, events});
  const away = new RemoteRunner('bot5', () => now); away.lastSeen = now; away.conn = null;
  const here = new RemoteRunner('bot6', () => now); here.lastSeen = now - 2 * FORGET_MS; here.conn = {ws: {}};
  runners.set('bot5', away); runners.set('bot6', here);
  now += FORGET_MS - 1000;
  hub.heartbeat();
  assert.ok(runners.has('bot5'));
  now += 2000;
  hub.heartbeat();
  assert.deepStrictEqual([...runners.keys()], ['bot1', 'bot6']); // bot5 gone; a connected one stays however old; lab bots stay
  assert.match(events.items.at(-1).text, /removed from the list/);
  hub.close();
}
{ // a deposit event names what went in, biggest first, and stays short
  const {depositList} = require('../bots');
  assert.strictEqual(depositList({coal: 12, cobblestone: 64}), '64 cobblestone, 12 coal');
  assert.strictEqual(depositList({a: 1, b: 2, c: 3, d: 4, e: 5, f: 6}), '6 f, 5 e, 4 d, 3 c, 2 more kinds');
  // the agent's state carries the supply chest as last seen
  const sw = new W.WorldModel({now: () => 5000});
  assert.strictEqual(sw.snapshot().stock, null);
  sw.noteStock('bot3', {cobblestone: 64});
  assert.deepStrictEqual(sw.snapshot().stock, {items: {cobblestone: 64}, by: 'bot3', free: null, age: 0});
}
// ---- event log, activity line, queue removal ----
{
  const {EventLog, clean, MAX} = require('../events');
  let t = 0;
  const log = new EventLog({now: () => ++t});
  for (let i = 0; i < MAX + 30; i++) log.add('bot1', 'job', `n${i}`);
  assert.strictEqual(log.items.length, MAX); // ring buffer: never more than MAX
  assert.strictEqual(log.items[0].text, 'n30');
  assert.strictEqual(log.lastId, MAX + 30);
  assert.deepStrictEqual(log.since(MAX + 28).map((e) => e.text), [`n${MAX + 28}`, `n${MAX + 29}`]);
  assert.strictEqual(log.add('bot1', 'nonsense', 'x'.repeat(999)).kind, 'info');
  assert.strictEqual(log.items.at(-1).text.length, 200);
  assert.strictEqual(clean({bot: 'bot9', kind: 'done', text: 'x'}, new Set(['bot5'])), null);
  assert.strictEqual(clean({bot: 'bot5', kind: 'done', text: 5}, new Set(['bot5'])), null);
  assert.deepStrictEqual(clean({bot: 'bot5', kind: 'x', text: 'y', extra: 1}, new Set(['bot5'])), {bot: 'bot5', kind: 'info', text: 'y'});

  const seen = [];
  const r = new BotRunner('bot3', {host: 'x', port: 1, log: () => {}, world: null, supplyChest: {x: 1, y: 2, z: 3}, onEvent: (b, k, x) => seen.push([b, k, x])});
  assert.strictEqual(r.activity(), 'connecting...');
  r.lastSeen = 1;
  assert.strictEqual(r.activity(), 'offline');
  r.online = true;
  r.bot = {inventory: {items: () => [], emptySlotCount: () => 36}, heldItem: {name: 'stone_pickaxe', durabilityUsed: 50}, registry: {itemsByName: {stone_pickaxe: {maxDurability: 131}}}, entity: null};
  assert.strictEqual(r.activity(), 'idle - no job');
  assert.deepStrictEqual(r.tool(), {name: 'stone_pickaxe', max: 131, left: 81});
  r.queue = [{id: 7, type: 'goto', args: {x: 1, y: 2, z: 3}}, {id: 8, type: 'chop', args: {count: 4}}];
  assert.strictEqual(r.activity(), 'starting the next job');
  r.enqueue('remove', {id: 7});
  assert.deepStrictEqual(r.snapshot().queueIds, [8]); // a running job is not removed, queued ones are
  r.queue = [];
  r.current = {id: 9, type: 'mine', args: {block: 'stone', count: 8}, progress: '2/8', startedAt: Date.now() - 5000, t: {doing: 'mining stone 2/8 near 1 2 3', done: 2, total: 8}};
  let sn = r.snapshot();
  assert.deepStrictEqual([sn.activity, sn.job.done, sn.job.total, sn.job.type], ['mining stone 2/8 near 1 2 3', 2, 8, 'mine']);
  r.dead = true;
  assert.strictEqual(r.activity(), 'dead - respawning');
  r.dead = false;
  r.emit('death', 'died');
  r.onEvent = () => { throw new Error('a broken listener must not kill the bot'); };
  assert.doesNotThrow(() => r.emit('death', 'again'));
  assert.deepStrictEqual(seen, [['bot3', 'death', 'died']]);
  // several refusals in a row are one event
  r.onEvent = (b, k, x) => seen.push([b, k, x]);
  seen.length = 0;
  for (let i = 0; i < 5; i++) r.conflict();
  assert.strictEqual(seen.length, 1);
  assert.match(seen[0][2], /^1 block skipped/);
  // the hub passes the new fields through and refuses wrong types
  const {cleanSnapshot} = require('../hub');
  const cs = cleanSnapshot({...sn, tool: {name: 5, max: -1, left: 'x'}, queueIds: [1, 'a', -3], activity: 'x'.repeat(999)});
  assert.deepStrictEqual([cs.tool, cs.queueIds, cs.activity.length, cs.job.done, cs.job.total], [{name: '', max: 0, left: null}, [1, 0, 0], 200, 2, 8]);
  assert.deepStrictEqual(cleanSnapshot(null).queueIds, []);
  // a worker bot's night shelter reaches the hub, or the agents order it out of its hole (bot2/bot3, 2026-10-15)
  assert.deepStrictEqual([cleanSnapshot({sheltered: true}).sheltered, cleanSnapshot({sheltered: 'yes'}).sheltered], [true, false]);
  assert.deepStrictEqual([cleanSnapshot({gettingFood: true}).gettingFood, cleanSnapshot({}).gettingFood], [true, false], 'a worker bot fetching food is left alone too');
  assert.deepStrictEqual(cleanSnapshot({armour: ['iron_helmet', null, 5, 'leather_boots', 'x']}).armour, ['iron_helmet', null, '', 'leather_boots']);
  const {RemoteRunner} = require('../hub');
  const sent = [];
  const rr = new RemoteRunner('bot5');
  rr.conn = {ws: {send: (m) => sent.push(JSON.parse(m))}};
  rr.enqueue('remove', {id: '12'});
  assert.deepStrictEqual(sent[0], {t: 'job', bot: 'bot5', type: 'remove', args: {id: 12}, replace: false});
}
