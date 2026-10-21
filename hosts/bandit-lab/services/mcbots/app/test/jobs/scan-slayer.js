'use strict';
const assert = require('node:assert');
const {loadConfig} = require('../../config');
module.exports = async () => {
  { // scan.js: the text map around a bot, then the hub round trip and the tidy job
    const {scanAround, MAX_TEXT} = require('../../scan');
    const {tidyTargets} = require('../../tidy');
    const {cleanScan, RemoteRunner} = require('../../hub');
    const {JOBS, VALIDATE, Cancelled} = require('../../bots');
    const A = require('../../agentauth');
    const {Vec3} = require('vec3');
    // A world of stone below y 64 and air above; `set` overrides single blocks by "x,y,z".
    const worldOf = (set = {}) => (v) => {
      const k = `${v.x},${v.y},${v.z}`;
      const name = k in set ? set[k] : v.y < 64 ? 'stone' : 'air';
      return {name, boundingBox: /^(air|water|lava)$/.test(name) ? 'empty' : 'block'};
    };
    const mob = (id, name, x, y, z, extra = {}) => ({id, name, type: 'hostile', position: new Vec3(x, y, z), ...extra});
    const botOf = (set, entities = []) => ({entity: {id: 0, position: new Vec3(0.5, 64, 0.5)}, blockAt: worldOf(set), entities: Object.fromEntries([{id: 0}, ...entities].map((e) => [e.id, e]))});
    const bot0 = botOf();
    bot0.entities = {0: bot0.entity};
    assert.strictEqual(scanAround(bot0).text, 'up 10+ exits N,E,S,W', 'an empty field');

    const set = {'3,62,1': 'iron_ore', '-1,63,0': 'coal_ore', '0,55,0': 'deepslate_diamond_ore', '2,63,0': 'lava', '0,63,3': 'water', '1,63,3': 'water', '0,64,-1': 'stone', '0,69,0': 'stone',
      '4,64,0': 'chest', '4,64,1': 'chest', '-2,64,-2': 'furnace', '0,64,5': 'crafting_table', '-3,64,3': 'red_bed', '-3,64,4': 'red_bed', '9,64,9': 'barrel'};
    for (let y = 58; y <= 63; y++) set[`1,${y},0`] = 'air'; // a hole 6 deep east of the bot
    const item = (id, x, z, name) => ({id, name: 'item', position: new Vec3(x, 64, z), getDroppedItem: () => ({name})});
    const world = botOf(set, [item(1, 3.5, 0.5, 'oak_log'), item(2, 6.5, 0.5, 'dirt'), mob(3, 'zombie', 7.5, 64, 0.5), mob(4, 'creeper', 12.5, 64, 0.5), mob(5, 'x', 0.5, 64, 0.5, {type: 'player'}), ...[6, 7, 8, 9].map((i) => mob(i, 'skeleton', 8.5 + i, 64, 0.5)), mob(20, 'cow', 2.5, 64, 0.5, {type: 'passive'})]);
    const out = scanAround(world);
    assert.ok(out.text.length <= MAX_TEXT, `${out.text.length}: ${out.text}`);
    assert.deepStrictEqual(out.data.ores.map((o) => [o.name, ...o.d]), [['coal_ore', -1, -1, 0], ['iron_ore', 3, -2, 1], ['deepslate_diamond_ore', 0, -9, 0]], 'nearest first, offsets relative to the bot');
    assert.deepStrictEqual(out.data.fluids, [{name: 'lava', d: [2, -1, 0], n: 1}, {name: 'water', d: [0, -1, 3], n: 2}]);
    assert.deepStrictEqual(out.data.drops, [{dir: 'E', fall: 6}]);
    assert.deepStrictEqual([out.data.up, out.data.exits], [3, ['E', 'S', 'W']], 'the wall to the north is no exit');
    assert.deepStrictEqual(out.data.stations.map((s) => s.name), ['furnace', 'chest', 'red_bed', 'crafting_table'], 'one chest and one bed, at most 4');
    assert.deepStrictEqual(out.data.items, {n: 2, nearest: {d: [3, 0, 0], name: 'oak_log'}});
    assert.deepStrictEqual(out.data.mobs.map((m) => [m.name, m.dist]), [['zombie', 7], ['creeper', 12], ['skeleton', 14], ['skeleton', 15]], 'hostile only, nearest 4 within 16');
    assert.ok(out.text.startsWith('lava(2,-1,0) water(0,-1,3)x2; drop E6; mobs zombie 7m creeper 12m'), out.text);
    assert.ok(/ores coal\(-1,-1,0\)/.test(out.text), out.text);
    // The text is trimmed from the least important end when it is too long.
    const ores = {};
    for (let i = 0; i < 6; i++) ores[`${i + 1},${60 - i},${i}`] = `${['deepslate_redstone', 'deepslate_lapis', 'deepslate_emerald', 'deepslate_diamond', 'deepslate_copper', 'deepslate_gold'][i]}_ore`;
    const crowd = scanAround(botOf({...set, ...ores}, [1, 2, 3, 4].map((i) => mob(i, 'cave_spider', 3 + i, 64, 0))));
    assert.ok(crowd.text.length <= MAX_TEXT && crowd.text.includes('mobs cave_spider'), `${crowd.text.length}: ${crowd.text}`);
    assert.strictEqual(crowd.data.ores.length, 6, 'the data keeps all six even when the text drops some');

    // hub: a worker's scan is bounded, asked for at most once at a time, and times out
    assert.deepStrictEqual(cleanScan({text: 'x'.repeat(500), data: {a: 1}}), {text: 'x'.repeat(400), data: {a: 1}});
    assert.deepStrictEqual(cleanScan({text: 't', data: {a: 'x'.repeat(5000)}}), {text: 't', data: null});
    assert.strictEqual(cleanScan({data: 1}), null);
    {
      let now = 1000;
      const sent = [];
      const rr = new RemoteRunner('bot16', () => now);
      assert.strictEqual(await rr.askScan(), null, 'offline: nothing');
      rr.conn = {ws: {send: (m) => sent.push(JSON.parse(m))}};
      const a = rr.askScan(50), b = rr.askScan(50);
      assert.deepStrictEqual(sent, [{t: 'scan_req', bot: 'bot16'}], 'one request for two askers');
      rr.gotScan({text: 'up 3', data: null});
      assert.deepStrictEqual([await a, await b], [{text: 'up 3', data: null}, {text: 'up 3', data: null}]);
      now += 1500;
      assert.strictEqual((await rr.askScan(50)).text, 'up 3', 'reused for 2 s');
      assert.strictEqual(sent.length, 1);
      now += 1000;
      assert.strictEqual(await rr.askScan(20), null, 'no answer: null after the wait');
      assert.strictEqual(sent.length, 2);
    }
    assert.ok(A.agentEndpoint('GET', '/api/scan/bot16') && !A.agentEndpoint('POST', '/api/scan/bot16'));
    assert.strictEqual(A.agentJobRefusal({bots: ['bot16'], type: 'tidy', args: {radius: 24}}, {agentBots: ['bot16'], supplyChest: {x: 1, y: 2, z: 3}}), null);

    // tidy: validation, the pure choice of items, then the job against a fake bot
    assert.deepStrictEqual(VALIDATE.tidy({}), {radius: 16});
    assert.deepStrictEqual(VALIDATE.tidy({x: -271.5, y: 66, z: -214, radius: '24'}), {x: -272, y: 66, z: -214, radius: 24});
    assert.throws(() => VALIDATE.tidy({radius: 33}), /radius/);
    assert.throws(() => VALIDATE.tidy({x: 1, y: 2}), /z must be/);
    const drop = (id, x, y, z, extra = {}) => ({id, name: 'item', position: new Vec3(x, y, z), ...extra});
    const me = new Vec3(0, 64, 0);
    const pick = (list, extra = {}) => tidyTargets(list, {x: 0, y: 64, z: 0, radius: 16, areas: [], me, ...extra}).map((e) => e.id);
    assert.deepStrictEqual(pick([drop(1, 9, 64, 0), drop(2, 3, 64, 0), drop(3, 20, 64, 0), drop(4, 0, 90, 0), drop(5, 1, 64, 1, {isValid: false}), {id: 6, name: 'zombie', position: me}]), [2, 1], 'nearest first; not too far, too high, invalid or not an item');
    assert.deepStrictEqual(pick([drop(1, 9, 64, 0), drop(2, 3, 64, 0)], {areas: [[0, -5, 5, 5]]}), [1], 'never inside a protected area');
    assert.deepStrictEqual(pick([drop(1, 2, 64, 0), drop(2, 3, 64, 0), drop(3, 4, 64, 0)], {skip: new Set([1]), blockAt: (x, y) => (x === 3 && y === 63 ? 'lava' : null)}), [3], 'given up on, or lying in lava');

    const fake = ({items = [], areas = [], chest = {x: 5, y: 64, z: 5}, fail = false} = {}) => {
      const infos = [], slots = [];
      const ents = new Map(items.map((e) => [e.id, e]));
      const bot = {
        entities: new Proxy({}, {get: (_, k) => ents.get(Number(k)), ownKeys: () => [...ents.keys()].map(String), getOwnPropertyDescriptor: (_, k) => ({enumerable: true, configurable: true, value: ents.get(Number(k))})}),
        game: {dimension: 'overworld'}, entity: {position: new Vec3(0, 64, 0)}, blockAt: worldOf(),
        inventory: {items: () => slots, emptySlotCount: () => 36 - slots.length},
        pathfinder: {setGoal() {}, stop() {}, goto: async (g) => {
          if (fail) throw new Error('no path');
          const e = [...ents.values()].find((x) => Math.hypot(x.position.x - g.x, x.position.z - g.z) < 1);
          if (!e) return;
          ents.delete(e.id);
          slots.push({name: 'cobblestone', count: 1});
          bot.entity.position = e.position;
        }},
      };
      return {bot, infos, ents, r: {bot, world: {hostilesNear: () => []}, combat: {busy: false, epoch: 0}, emit: (k, t) => infos.push(t), protectedAreas: areas, supplyChest: chest}};
    };
    const tidyJob = (args = {}, extra = {}) => ({t: {}, cancelled: false, type: 'tidy', args: {radius: 16, ...args}, ...extra});
    const realDeposit = JOBS.deposit;
    const deposits = [];
    JOBS.deposit = async (r, j) => { deposits.push(j.args); };
    try {
      let f = fake({items: [drop(1, 10, 64, 0), drop(2, 12, 64, 3), drop(3, -4, 64, 0)], areas: [[-6, -2, -2, 2]]});
      let job = tidyJob({x: 0, y: 64, z: 0});
      await JOBS.tidy(f.r, job);
      assert.deepStrictEqual([...f.ents.keys()], [3], 'the item in the protected area stays');
      assert.deepStrictEqual([job.collected, deposits], [2, [{x: 5, y: 64, z: 5}]], 'two picked up, then the deposit job on the supply chest');
      assert.ok(f.infos.some((m) => /^tidied 2 items within 16 of 0 64 0$/.test(m)), f.infos.join('|'));

      deposits.length = 0;
      f = fake({items: [drop(1, 3, 64, 5)]});
      job = tidyJob(); // no point: the supply chest is the centre
      await JOBS.tidy(f.r, job);
      assert.strictEqual(job.collected, 1);
      f = fake({items: [drop(1, 30, 64, 5)]});
      await JOBS.tidy(f.r, tidyJob());
      assert.deepStrictEqual([f.ents.size, deposits.length], [1, 1], 'out of reach of the chest: left alone, and nothing new to deposit');

      deposits.length = 0;
      f = fake({items: [drop(1, 3, 64, 0)], fail: true});
      await JOBS.tidy(f.r, tidyJob({x: 0, y: 64, z: 0}));
      assert.deepStrictEqual([f.ents.size, deposits.length], [1, 0], 'unreachable: given up, no deposit');
      f = fake({items: [drop(1, 3, 64, 0), drop(2, 4, 64, 0)]});
      job = tidyJob({x: 0, y: 64, z: 0});
      const goto = f.bot.pathfinder.goto;
      f.bot.pathfinder.goto = async (g) => { job.cancelled = true; return goto(g); };
      await assert.rejects(JOBS.tidy(f.r, job), Cancelled);
      assert.strictEqual(deposits.length, 0, 'a Stop deposits nothing');
      f = fake({items: [drop(1, 3, 64, 0)]});
      f.r.supplyChest = null;
      await assert.rejects(JOBS.tidy(f.r, tidyJob()), /needs x, y, z or a supply chest/);
      await JOBS.tidy(f.r, tidyJob({x: 0, y: 64, z: 0}));
      assert.ok(f.infos.some((m) => /no supply chest: kept them/.test(m)));
      assert.strictEqual(deposits.length, 0);
    } finally {
      JOBS.deposit = realDeposit;
    }
    { // a far bot walks to the area before it reads the entities
      const {makeTidy} = require('../../tidy');
      const log = [], infos = [];
      const ents = new Map([[1, drop(1, 2, 64, 1)]]);
      const bot = {
        get entities() { log.push('read'); return Object.fromEntries(ents); },
        entity: {position: new Vec3(100, 64, 0)}, blockAt: () => null,
        inventory: {items: () => [], emptySlotCount: () => 36},
      };
      const goNear = async (rr, j, gx, gy, gz) => {
        log.push('goNear');
        bot.entity.position = new Vec3(gx, gy, gz);
        if (gx === 2) ents.delete(1);
      };
      const tidy = makeTidy({goNear, guard: () => {}, sleep: async () => { log.push('sleep'); }, waitCalm: async () => {}, deposit: async () => {}, at: (p) => `${p.x} ${p.y} ${p.z}`});
      const r = {bot, supplyChest: null, protectedAreas: [], emit: (k, t) => infos.push(t)};
      await tidy(r, {t: {}, cancelled: false, type: 'tidy', args: {x: 0, y: 64, z: 0, radius: 24}});
      assert.deepStrictEqual(log.slice(0, 3), ['goNear', 'sleep', 'read'], log.join(','));
      assert.strictEqual(infos.length, 1, infos.join('|'));
    }
  }
  { // slayer (gaming PC) card: metrics parsing, status validation, backend counts, offline shape
    const {Slayer, parseMetrics, parseStatus, countBackends, parseCmd} = require('../../slayer');
    const {EventLog} = require('../../events');
    const prom = '# HELP llamacpp:prompt_tokens_seconds x\n# TYPE llamacpp:prompt_tokens_seconds gauge\nllamacpp:prompt_tokens_seconds 812.5\nllamacpp:predicted_tokens_seconds 41.25\nllamacpp:requests_processing{slot="0"} 1\nllamacpp:n_decode_total 99\nllamacpp:requests_deferred 0\nllamacpp:bogus nan\n';
    assert.deepStrictEqual(parseMetrics(prom), {promptPerSec: 812.5, predictedPerSec: 41.25, processing: 1, decodeTotal: 99});
    assert.deepStrictEqual(parseMetrics('garbage\nllamacpp:predicted_tokens_seconds NaN\nllamacpp:requests_processing -3\n<html>'), {promptPerSec: null, predictedPerSec: null, processing: null, decodeTotal: null});
    const gpu = {util: 31.6, vramUsedMB: 9000, vramTotalMB: 16376, tempC: 64};
    assert.deepStrictEqual(parseStatus(`\uFEFF${JSON.stringify({state: 'paused-game', gpu, extra: 'x'})}`), {state: 'paused-game', gpu: {...gpu, util: 32}});
    assert.deepStrictEqual(parseStatus('{}'), {state: null, gpu: null});
    for (const bad of ['not json', '[1]', 'null', JSON.stringify({state: 'on fire'}), JSON.stringify({gpu: {util: 1}}), JSON.stringify({gpu: {...gpu, tempC: '64'}}), JSON.stringify({gpu: {...gpu, util: 1e9}}), JSON.stringify({pad: 'x'.repeat(4100)}), 5, undefined]) assert.ok(parseStatus(bad).error, String(bad).slice(0, 30));
    assert.deepStrictEqual(parseCmd(''), []);
    assert.deepStrictEqual(parseCmd('["ssh","slayer","type","C:\\\\bandit-ai\\\\status.json"]'), ['ssh', 'slayer', 'type', 'C:\\bandit-ai\\status.json']);
    for (const bad of ['ssh slayer', '[]', '["a",""]', '[1]', '{"a":1}']) assert.throws(() => parseCmd(bad), /JSON array/, bad);
    assert.strictEqual(loadConfig({BOT_NAMES: 'bot1'}).slayerUrl, '');
    assert.strictEqual(loadConfig({BOT_NAMES: 'bot1', SLAYER_URL: 'http://127.0.0.1:18081/'}).slayerUrl, 'http://127.0.0.1:18081');
    assert.throws(() => loadConfig({BOT_NAMES: 'bot1', SLAYER_URL: 'file:///etc/passwd'}), /SLAYER_URL/);
    // decisions per backend, last 24 h; no backend field = the lab's model
    let now = 1e12;
    const decs = new EventLog({now: () => now});
    decs.add('bot1', 'info', 'old'); // 25 h ago
    now += 25 * 3600000;
    decs.add('bot1', 'info', 'no field');
    decs.add('bot1', 'info', 'lab').backend = 'lab';
    decs.add('bot1', 'info', 'pc').backend = 'slayer';
    decs.add('bot1', 'info', 'pc2').backend = 'slayer';
    decs.add('bot1', 'info', 'other PC').backend = 'second';
    assert.deepStrictEqual(countBackends(decs.items, now), {lab: 2, slayer: 2});
    // offline: the tunnel refuses, no PC; the answer keeps its shape
    const mk = (fetchFn, run) => new Slayer({url: 'http://127.0.0.1:18081', cmd: ['ssh', 'slayer', 'type', 'x'], decisions: decs, fetchFn, run, now: () => now});
    const off = mk(async () => { throw new Error('ECONNREFUSED'); });
    await off.poll();
    assert.deepStrictEqual(off.view(), {enabled: true, online: false, busy: false, tokensPerSec: null, promptPerSec: null, requestsToday: 2, decisions: {lab: 2, slayer: 2}, gpu: null, state: 'offline', t: now});
    assert.strictEqual(new Slayer({url: '', decisions: decs}).view().enabled, false);
    // serving + busy, GPU from the status command; paused-game while the PC is off but says so
    const res = (body, ok = true) => ({ok, text: async () => body});
    const pc = {'/health': res('{"status":"ok"}'), '/slots': res('[{"id":0,"is_processing":true}]'), '/metrics': res(prom), '/status.json': res('', false)};
    const on = mk(async (u) => pc[new URL(u).pathname], (cmd, args, opt, cb) => { on.ran = [cmd, args, opt.timeout, opt.maxBuffer]; cb(null, JSON.stringify({state: 'serving', gpu})); });
    await on.poll();
    await on.pollStatusCmd();
    assert.deepStrictEqual(on.ran, ['ssh', ['slayer', 'type', 'x'], 5000, 4096]);
    assert.deepStrictEqual([on.view().state, on.view().busy, on.view().tokensPerSec, on.view().promptPerSec, on.view().gpu], ['serving', true, 41.25, 812.5, {...gpu, util: 32}]);
    pc['/slots'] = res('not json'); // /slots broken: requests_processing still says busy
    await on.poll();
    assert.strictEqual(on.view().busy, true);
    pc['/metrics'] = res('', false);
    await on.poll();
    assert.deepStrictEqual([on.view().busy, on.view().tokensPerSec], [false, null]);
    pc['/health'] = res('{"error":"Loading model"}', false); // 503 while loading is not serving
    await on.poll();
    on.run = (c, a, o, cb) => cb(null, JSON.stringify({state: 'paused-game'}));
    await on.pollStatusCmd();
    assert.strictEqual(on.view().state, 'paused-game');
    assert.strictEqual(on.view().gpu, null);
    now += 200000; // the status file went stale (the tunnel or the watcher died)
    assert.strictEqual(on.view().state, 'offline');
    on.run = (c, a, o, cb) => cb(null, 'x'.repeat(5000)); // too long / bad output / error: kept as it was
    const before = on.status;
    await on.pollStatusCmd();
    on.run = (c, a, o, cb) => cb(new Error('timeout'));
    await on.pollStatusCmd();
    assert.strictEqual(on.status, before);
  }
};
