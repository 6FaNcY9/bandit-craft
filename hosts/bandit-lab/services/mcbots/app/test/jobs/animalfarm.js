'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // animalfarm: validation, the gate scan, then the job against a fake bot
    const {VALIDATE, Cancelled} = require('../../bots');
    const A = require('../../animalfarm');
    const storage = require('../../storage');
    const {Vec3} = require('vec3');
    assert.deepStrictEqual(VALIDATE.animalfarm({x1: 15, z1: 0, x2: 0, z2: 15}), {x1: 0, z1: 0, x2: 15, z2: 15}, '16 x 16, corners in any order');
    assert.deepStrictEqual(VALIDATE.animalfarm({x1: 0, z1: 0, x2: 1, z2: 1, y: 70}), {x1: 0, z1: 0, x2: 1, z2: 1, y: 70});
    assert.throws(() => VALIDATE.animalfarm({x1: 0, z1: 0, x2: 16, z2: 0}), /a pen is at most 16 x 16/);

    const box = {x1: 0, z1: 0, x2: 4, z2: 4};
    const gate = (open) => ({name: 'oak_fence_gate', getProperties: () => ({open})});
    const world = (gates = {}) => {
      const cell = new Map(Object.entries(gates));
      return {cell, blockAt: (x, y, z) => cell.get(`${x},${y},${z}`) || (y <= 64 ? {name: 'grass_block'} : {name: 'air'})};
    };
    // closed gates on the border only: an open one, an inner one and a plain fence are left out
    let w = world({'2,65,0': gate(false), '4,65,2': gate(true), '2,65,2': gate(false), '0,65,0': {name: 'oak_fence'}});
    assert.deepStrictEqual(A.borderGates(w.blockAt, {...box, y: 65}), [{x: 2, y: 65, z: 0}]);

    const mob = (id, name, x, z, metadata = {}) => ({id, name, type: 'animal', isValid: true, height: 1, position: new Vec3(x + 0.5, 65, z + 0.5), metadata});
    const herd = (name, n, from = 1) => Array.from({length: n}, (_, i) => mob(from + i, name, i % 5, Math.floor(i / 5) % 5));
    const fake = ({mobs = [], inv = [], blocks = world(), stopAfterSleeps = 5, onSleep, onGoNear, enough, deposit, withdraw, crafting, start = new Vec3(2.5, 65, 2.5)}) => {
      const calls = {feed: [], engage: [], deposit: [], withdraw: [], craft: [], gate: [], flags: [], opts: []};
      const it = (name, count) => ({name, count, type: name.length});
      inv = inv.map(([n, c]) => it(n, c));
      let now = 0, sleeps = 0;
      const sleepMs = [];
      const bot = {
        entities: Object.fromEntries(mobs.map((e) => [e.id, e])), heldItem: null,
        inventory: {items: () => inv.filter((i) => i.count > 0), emptySlotCount: () => 30},
        entity: {position: start},
        blockAt: (p) => { const b = blocks.blockAt(p.x, p.y, p.z); return b && {position: p, ...b}; },
        equip: async (item) => { bot.heldItem = item; },
        activateEntity: async (e) => { calls.feed.push({id: e.id, with: bot.heldItem?.name, at: now}); },
        activateBlock: async (b) => {
          calls.gate.push(`${b.position.x},${b.position.z}`);
          if (blocks.failClose) throw new Error('the gate did not answer');
          blocks.cell.set(`${b.position.x},${b.position.y},${b.position.z}`, gate(!b.getProperties().open));
        },
      };
      const job = {type: 'animalfarm', args: {...box}, t: {}, cancelled: false};
      const inside = (p) => p.x >= 0 && p.x < 5 && p.z >= 0 && p.z < 5;
      const r = {bot, world: {}, combat: {busy: false, epoch: 0}, emit() {}, protectedAreas: [], supplyChest: {x: -3, y: 65, z: -3}, digOnly: 'before', noScaffold: false};
      const af = A.makeAnimalFarm({
        ...(enough ? {enough} : {}),
        goNear: async (rr, j, x, y, z) => {
          const to = new Vec3(x, y, z);
          // the pathfinder opens the closed gate on the way through the fence
          if (inside(bot.entity.position) !== inside(to)) for (const [k, b] of blocks.cell) if (/_fence_gate$/.test(b.name) && k === '2,65,0') blocks.cell.set(k, gate(true));
          bot.entity.position = to;
          onGoNear?.(bot);
        },
        guard: (j) => { if (j.cancelled) throw new Cancelled('stopped'); },
        sleep: async (ms) => { now += ms; sleepMs.push(ms); onSleep?.(sleepMs.length); if (++sleeps > stopAfterSleeps) job.cancelled = true; },
        waitCalm: async () => {},
        at: (c) => `${c.x} ${c.y} ${c.z}`,
        engage: async (rr, j, e, shears, opts) => {
          calls.engage.push({id: e.id, shears: shears?.name || null});
          calls.opts.push(opts);
          calls.flags.push({digOnly: rr.digOnly, noScaffold: rr.noScaffold});
          if (!shears) delete bot.entities[e.id];
          return 'done';
        },
        crafting: crafting || {ensureItem: async (rr, j, item) => { calls.craft.push(item); throw new Error('no iron_ingot in the chest'); }},
        deposit: deposit || (async (rr, j, item) => { calls.deposit.push(item); for (const i of inv) if (i.name === item) i.count = 0; }),
        withdraw: withdraw || (async (rr, j, item, count) => { calls.withdraw.push(`${item} ${count} @${now}`); throw new Error(`no ${item} in the chest`); }),
      });
      const realNow = Date.now;
      const run = async () => { Date.now = () => now; try { return await af.animalfarm(r, job); } finally { Date.now = realNow; } };
      return {r, job, bot, calls, inv, run, sleepMs};
    };

    // (a) two cows and wheat: both fed with wheat, remembered; the next round within 300 s feeds nobody, after it again
    let f = fake({mobs: herd('cow', 2), inv: [['wheat', 16]], stopAfterSleeps: 400});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.feed.slice(0, 2).map((c) => [c.id, c.with, c.at]), [[1, 'wheat', 0], [2, 'wheat', 0]]);
    assert.ok(f.calls.feed.length >= 4, `fed again later (${f.calls.feed.length})`);
    assert.ok(f.calls.feed[2].at >= 300000 && f.calls.feed[2].at < 320000, `fed again at ${f.calls.feed[2].at}`);
    assert.deepStrictEqual(f.calls.engage, [], 'two cows: nothing culled');

    // a cow named while the bot walks to it is not fed
    f = fake({mobs: herd('cow', 2), inv: [['wheat', 16]], start: new Vec3(0.5, 65, 0.5), onGoNear: (b) => { b.entities[1].metadata[2] = 'Berta'; }});
    f.bot.entities[1].position = new Vec3(4.5, 65, 4.5);
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.feed.map((c) => c.id), [2]);
    assert.strictEqual(f.job.bred, 0, 'a pair half fed is not counted');
    // a feed that failed is not remembered: the cow is fed with the next one in the next round
    let fails = 1;
    f = fake({mobs: herd('cow', 3), inv: [['wheat', 16]], start: new Vec3(0.5, 65, 0.5), stopAfterSleeps: 15, onGoNear: () => { if (fails-- > 0) throw new Error('no path'); }});
    f.bot.entities[1].position = new Vec3(4.5, 65, 4.5);
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.feed.map((c) => c.id), [2, 1, 3]);
    assert.strictEqual(f.job.bred, 1);
    // wheat fetched from the chest feeds the pair in the same round
    f = fake({mobs: herd('cow', 2), withdraw: async (rr, j, item, count) => { f.inv.push({name: item, count, type: 1}); }});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.feed.map((c) => [c.id, c.at]), [[1, 0], [2, 0]]);

    // (b) 13 cows, a named one, a calf, a horse, a wolf and a cat: exactly 4 culled, the highest ids, nobody else touched
    const others = [mob(20, 'cow', 1, 1, {2: 'Berta'}), mob(21, 'cow', 1, 2, {16: true}), mob(30, 'horse', 2, 2), mob(31, 'wolf', 3, 3), mob(32, 'cat', 3, 1)];
    f = fake({mobs: [...herd('cow', 13), ...others]});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.engage.map((c) => c.id), [13, 12, 11, 10]);
    assert.deepStrictEqual(f.calls.opts, Array(4).fill({noSweep: true}), 'a cull never sweeps');
    assert.deepStrictEqual(f.calls.feed, [], 'no wheat: nobody fed');
    assert.ok(f.calls.withdraw.includes('wheat 16 @0'), f.calls.withdraw.join('|'));
    assert.match(f.job.t.doing, /no wheat/);
    // the hall holds enough beef: the cows are left alone, the pigs are culled
    f = fake({mobs: [...herd('cow', 13), ...herd('pig', 10, 40)], enough: (r, item) => (item === 'beef' ? 5 : 0)});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.engage.map((c) => c.id), [49, 48]);

    // (c) a sheep is sheared with the shears it carries, once within 300 s; without shears: no throw, doing says so
    f = fake({mobs: herd('sheep', 2), inv: [['shears', 1]], stopAfterSleeps: 25});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.engage, [{id: 1, shears: 'shears'}, {id: 2, shears: 'shears'}]);
    assert.deepStrictEqual(f.calls.opts, [undefined, undefined]);
    f = fake({mobs: herd('sheep', 2), stopAfterSleeps: 25});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.engage, []);
    assert.deepStrictEqual(f.calls.craft, ['shears'], 'one try at crafting them per 5 minutes');
    assert.match(f.job.t.doing, /no shears/);

    // (d) gates: the one the bot opened on its way in is closed again, the one left open stays open, a failed close goes on
    const gates = () => world({'2,65,0': gate(false), '4,65,2': gate(true)});
    f = fake({mobs: herd('cow', 2), inv: [['wheat', 16]], blocks: (w = gates()), start: new Vec3(2.5, 65, -3.5)});
    f.bot.entities[1].position = new Vec3(2.5, 65, 3.5);
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.gate, ['2,0'], 'only the gate the bot opened');
    assert.strictEqual(w.blockAt(2, 65, 0).getProperties().open, false);
    assert.strictEqual(w.blockAt(4, 65, 2).getProperties().open, true);
    w = gates();
    w.failClose = true;
    f = fake({mobs: herd('cow', 2), inv: [['wheat', 16]], blocks: w, start: new Vec3(2.5, 65, -3.5)});
    f.bot.entities[1].position = new Vec3(2.5, 65, 3.5);
    await assert.rejects(f.run(), Cancelled);
    assert.ok(f.calls.gate.length >= 1);
    assert.strictEqual(f.calls.feed.length, 2, 'the job went on after the failed close');

    // (e) every kind paused: 60 one-second sleeps, nobody touched; a surplus back at 0 resumes
    let paused = true;
    let rounds = 0;
    f = fake({mobs: herd('cow', 13), stopAfterSleeps: 59, enough: (r, item) => { if (item === 'beef') rounds++; return paused ? 1 : 0; }});
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.job.t.doing, 'enough in the hall, waiting');
    assert.deepStrictEqual(f.sleepMs, Array(60).fill(1000));
    assert.strictEqual(rounds, 1, 'one wait of 60 s, not several short ones');
    assert.deepStrictEqual(f.calls.engage, []);
    f = fake({mobs: herd('cow', 13), stopAfterSleeps: 70, enough: () => (paused ? 1 : 0), onSleep: (n) => { if (n === 60) paused = false; }});
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.calls.engage.length, 4, 'resumed');
    // a stale or empty chest index never pauses (the wiring of bots.js)
    assert.strictEqual(storage.surplus('beef', storage.hallTotals(undefined)), 0);
    assert.strictEqual(storage.surplus('wool', storage.hallTotals(new Map())), 0);
    f = fake({mobs: herd('cow', 13), enough: (r, item) => storage.surplus(item, storage.hallTotals(r.world?.chests))});
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.calls.engage.length, 4);

    // (f) 64 beef go in by deposit(r, job, 'beef'); a failing deposit does not throw
    f = fake({inv: [['beef', 64], ['white_wool', 3]]});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.deposit, ['beef', 'white_wool']);
    const tried = [];
    f = fake({inv: [['beef', 64]], stopAfterSleeps: 40, deposit: async (r, j, item) => { tried.push(item); throw new Error('the hall is full'); }});
    f.bot.inventory.emptySlotCount = () => 2;
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(tried, ['beef'], 'once, then left for 5 minutes');
    assert.match(f.job.t.doing, /bag full, the hand-in failed/);

    // (g) while it runs it digs nothing and places no pillar; afterwards the runner's flags are back
    f = fake({mobs: herd('cow', 9)});
    await assert.rejects(f.run(), Cancelled);
    const {digOnly, noScaffold} = f.calls.flags[0];
    assert.ok(digOnly instanceof RegExp && !['dirt', 'stone', 'oak_fence', 'oak_fence_gate', 'grass_block', ''].some((n) => digOnly.test(n)));
    assert.strictEqual(noScaffold, true);
    assert.deepStrictEqual([f.r.digOnly, f.r.noScaffold], ['before', false]);
  }
};
