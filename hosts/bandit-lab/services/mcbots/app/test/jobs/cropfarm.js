'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // cropfarm: validation, the cane scan, then the job against a fake bot
    const {VALIDATE, Cancelled} = require('../../bots');
    const C = require('../../cropfarm');
    const {Vec3} = require('vec3');
    assert.deepStrictEqual(VALIDATE.cropfarm({x1: 15, z1: 0, x2: 0, z2: 15, crop: 'carrot'}), {x1: 0, z1: 0, x2: 15, z2: 15, crop: 'carrot'}, '16 x 16, corners in any order');
    assert.deepStrictEqual(VALIDATE.cropfarm({x1: 0, z1: 0, x2: 1, z2: 1, crop: 'sugar_cane', y: 70}), {x1: 0, z1: 0, x2: 1, z2: 1, crop: 'sugar_cane', y: 70});
    assert.throws(() => VALIDATE.cropfarm({x1: 0, z1: 0, x2: 16, z2: 0, crop: 'carrot'}), /a farm is at most 16 x 16/);
    assert.throws(() => VALIDATE.cropfarm({x1: 0, z1: 0, x2: 1, z2: 1, crop: 'wheat'}), /crop must be/);
    assert.throws(() => VALIDATE.cropfarm({x1: 0, z1: 0, x2: 1, z2: 1}), /crop must be/);

    // a flat world: grass at y 64, air above; `put` overrides single blocks
    const flat = (extra = {}) => {
      const cell = new Map(Object.entries(extra));
      const blockAt = (x, y, z) => {
        const c = cell.get(`${x},${y},${z}`);
        if (c) return typeof c === 'string' ? {name: c, boundingBox: /air|short_grass|sugar_cane|water/.test(c) ? 'empty' : 'block'} : c;
        return y <= 64 ? {name: y === 64 ? 'grass_block' : 'dirt', boundingBox: 'block'} : {name: 'air', boundingBox: 'empty'};
      };
      return {cell, blockAt, put: (x, y, z, n) => cell.set(`${x},${y},${z}`, n)};
    };
    const crop = (name, age) => ({name, boundingBox: 'empty', getProperties: () => ({age})});
    const field = (w, cells, block, age) => { for (const [x, z] of cells) { w.put(x, 64, z, 'farmland'); w.put(x, 65, z, block === null ? 'air' : crop(block, age)); } };
    const cane = (w, x, z, n) => { w.put(x, 64, z, 'sand'); for (let y = 65; y < 65 + n; y++) w.put(x, y, z, 'sugar_cane'); };

    // the cane scan: 2 high is ripe (dig gy + 2), 1 high grows, anything else is blocked; protected columns are left out
    const box = {x1: 0, z1: 0, x2: 2, z2: 0};
    let w = flat();
    cane(w, 0, 0, 3); cane(w, 1, 0, 1);
    assert.deepStrictEqual(C.scanCane(w.blockAt, box, 64, []).cells, [{x: 0, z: 0, gy: 64, state: 'ripe'}, {x: 1, z: 0, gy: 64, state: 'growing'}, {x: 2, z: 0, gy: 64, state: 'blocked'}]);
    assert.deepStrictEqual(C.scanCane(w.blockAt, box, 64, [[0, 0, 0, 0]]).cells.map((c) => c.x), [1, 2]);

    // the job: a 3 x 3 box, water in the middle
    const small = {x1: 0, z1: 0, x2: 2, z2: 2};
    const DROPS = {carrots: [['carrot', 3]], beetroots: [['beetroot', 1], ['beetroot_seeds', 2]], sugar_cane: [['sugar_cane', 1]]};
    const fake = ({inv = [], world, kind = 'carrot', stopAfterSleeps = 3, enough, deposit, withdraw, args = small}) => {
      const events = [], infos = [], calls = {deposit: [], withdraw: [], dig: []};
      const it = (name, count) => ({name, count, type: name.length});
      const give = (name, n) => { const e = inv.find((i) => i.name === name) || (inv.push(it(name, 0)), inv.at(-1)); e.count += n; };
      let now = 0;
      const bot = {
        entities: {}, inventory: {items: () => inv.filter((i) => i.count > 0), emptySlotCount: () => 30}, heldItem: null, game: {dimension: 'overworld'},
        entity: {position: new Vec3(0.5, 65, 0.5)},
        blockAt: (p) => { const b = world.blockAt(p.x, p.y, p.z); return b && {position: p, ...b}; },
        equip: async (item) => { bot.heldItem = item; },
        activateBlock: async (b) => { if (bot.heldItem?.name.endsWith('_hoe') && b.name === 'grass_block') { world.put(b.position.x, b.position.y, b.position.z, 'farmland'); events.push(`till ${b.position.x},${b.position.z}`); } },
        placeBlock: async (ref) => {
          const held = bot.heldItem;
          held.count--;
          world.put(ref.position.x, ref.position.y + 1, ref.position.z, crop(C.CROP_KINDS[kind].block, 0));
          events.push(`plant ${held.name} ${ref.position.x},${ref.position.z}`);
        },
      };
      const job = {type: 'cropfarm', args: {...args, crop: kind}, t: {}, cancelled: false};
      let sleeps = 0;
      const cf = C.makeCropFarm({
        ...(enough ? {enough} : {}),
        goNear: async (r, j, x, y, z) => {
          bot.entity.position = new Vec3(x, y, z);
          for (const [id, e] of Object.entries(bot.entities)) if (e.position.distanceTo(bot.entity.position) < 1) { give(e.getDroppedItem().name, 1); delete bot.entities[id]; events.push(`pickup ${e.getDroppedItem().name}`); }
        },
        guard: (j) => { if (j.cancelled) throw new Cancelled('stopped'); },
        sleep: async (ms) => { now += ms; if (++sleeps > stopAfterSleeps) job.cancelled = true; },
        waitCalm: async () => {},
        at: (c) => `${c.x} ${c.y} ${c.z}`,
        digAt: async (r, j, pos, want) => {
          const b = world.blockAt(pos.x, pos.y, pos.z);
          if (!want(b.name)) return false;
          calls.dig.push(`${b.name} ${pos.x},${pos.y},${pos.z}`);
          if (b.name === 'sugar_cane') for (let y = pos.y; world.blockAt(pos.x, y, pos.z).name === 'sugar_cane'; y++) world.put(pos.x, y, pos.z, 'air');
          else world.put(pos.x, pos.y, pos.z, 'air');
          for (const [n, c] of DROPS[b.name] || []) give(n, c);
          return true;
        },
        deposit: deposit || (async (r, j, item) => { calls.deposit.push(item); for (const i of inv) if (i.name === item) i.count = 0; }),
        withdraw: withdraw || (async (r, j, item, count) => { calls.withdraw.push(`${item} ${count} @${now}`); throw new Error(`no ${item} in the chest`); }),
      });
      const r = {bot, world: {claim: async () => true, release() {}}, combat: {busy: false, epoch: 0}, emit: (k, t) => infos.push(t), protectedAreas: [], supplyChest: {x: -3, y: 65, z: -3}};
      const realNow = Date.now;
      const run = async () => { Date.now = () => now; try { return await cf.cropfarm(r, job); } finally { Date.now = realNow; } };
      return {r, job, events, infos, calls, inv, run, clock: () => now};
    };
    const ALL = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]];

    // (a) a ripe carrot is dug, a drop picked up, the same cell replanted with carrot; younger ones are left
    w = flat({'1,64,1': 'water'});
    field(w, ALL, 'carrots', 3);
    w.put(0, 65, 0, crop('carrots', 7));
    let f = fake({world: w});
    f.r.bot.entities[1] = {id: 1, name: 'item', position: new Vec3(2.5, 65, 2.5), getDroppedItem: () => ({name: 'carrot'})};
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.dig, ['carrots 0,65,0'], 'only the ripe one');
    assert.ok(f.events.includes('pickup carrot'), f.events.join('|'));
    assert.ok(f.events.includes('plant carrot 0,0'), f.events.join('|'));
    assert.strictEqual(w.blockAt(0, 65, 0).name, 'carrots');
    assert.match(f.job.progress, /1 harvested, 1 planted/);
    assert.strictEqual(f.job.t.open, true);

    // (b) beetroot is ripe at age 3
    w = flat({'1,64,1': 'water'});
    field(w, [[0, 0], [1, 0]], 'beetroots', 3);
    w.put(1, 65, 0, crop('beetroots', 2));
    f = fake({world: w, kind: 'beetroot'});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.dig, ['beetroots 0,65,0']);
    assert.ok(f.events.includes('plant beetroot_seeds 0,0'), f.events.join('|'));

    // (c) cane: only the block above the base is dug, never the base, nothing is planted
    w = flat();
    cane(w, 0, 0, 3); cane(w, 1, 1, 1); cane(w, 2, 2, 2);
    f = fake({world: w, kind: 'sugar_cane'});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.dig.sort(), ['sugar_cane 0,66,0', 'sugar_cane 2,66,2']);
    assert.deepStrictEqual([w.blockAt(0, 65, 0).name, w.blockAt(1, 65, 1).name, w.blockAt(2, 65, 2).name], ['sugar_cane', 'sugar_cane', 'sugar_cane'], 'every base stays');
    assert.ok(!f.events.some((e) => e.startsWith('plant')));

    // (d) the hall holds enough carrots: nothing dug or deposited; below the cap again: it harvests
    w = flat({'1,64,1': 'water'});
    field(w, ALL, 'carrots', 7);
    const asked = [];
    f = fake({world: w, inv: [{name: 'carrot', count: 64, type: 1}], enough: (r, item) => { asked.push(item); return 500; }});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual([f.calls.dig.length, f.calls.deposit.length], [0, 0], 'nothing dug, nothing deposited');
    assert.strictEqual(f.job.t.doing, 'enough in the hall, waiting');
    assert.strictEqual(asked[0], 'carrot');
    let more = 500;
    f = fake({world: w, stopAfterSleeps: 100, enough: () => { const n = more; more = 0; return n; }});
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.calls.dig.length, 8, 'all 8 harvested after the wait');

    // (e) no seeds and no hoe: no throw, doing names both, the chest is asked again after 300 s, not before
    w = flat({'1,64,1': 'water'});
    field(w, [[0, 0], [1, 0], [2, 0]], null);
    f = fake({world: w, stopAfterSleeps: 400});
    await assert.rejects(f.run(), Cancelled);
    assert.match(f.job.t.doing, /no carrot to plant/);
    assert.match(f.job.t.doing, /no hoe to till with/);
    const seedAsks = f.calls.withdraw.filter((c) => c.startsWith('carrot')).map((c) => Number(c.split('@')[1]));
    assert.ok(seedAsks.length >= 2, f.calls.withdraw.join('|'));
    assert.strictEqual(seedAsks[0], 0);
    assert.ok(seedAsks[1] >= 300000 && seedAsks[1] < 320000, `asked again at ${seedAsks[1]}`);
    assert.ok(f.calls.withdraw.some((c) => c.endsWith('_hoe 1 @0')), 'a hoe is asked for too');
    // with a hoe and seeds the wet grass is tilled and planted
    w = flat({'1,64,1': 'water'});
    f = fake({world: w, inv: [{name: 'stone_hoe', count: 1, type: 1}, {name: 'carrot', count: 16, type: 2}]});
    await assert.rejects(f.run(), Cancelled);
    assert.ok(f.events.filter((e) => e.startsWith('till')).length >= 8, f.events.join('|'));
    assert.ok(f.events.filter((e) => e.startsWith('plant carrot')).length >= 1, f.events.join('|'));

    // (f) a protected column is untouched
    w = flat({'1,64,1': 'water'});
    field(w, ALL, 'carrots', 7);
    f = fake({world: w});
    f.r.protectedAreas = [[0, 0, 0, 0]];
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.calls.dig.length, 7);
    assert.ok(!f.calls.dig.includes('carrots 0,65,0'));

    // (g) 64 carrots are handed in with deposit(r, job, 'carrot'); a failing deposit does not throw
    w = flat({'1,64,1': 'water'});
    f = fake({world: w, inv: [{name: 'carrot', count: 64, type: 1}]});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.deposit, ['carrot']);
    const tried = [];
    f = fake({world: w, inv: [{name: 'carrot', count: 64, type: 1}], stopAfterSleeps: 40, deposit: async (r, j, item) => { tried.push(item); throw new Error('the chest is full'); }});
    f.r.bot.inventory.emptySlotCount = () => 2;
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(tried, ['carrot'], 'once, then left for 5 minutes');
    assert.match(f.job.t.doing, /bag full, the hand-in failed/);
    // a hand-in that goes through but leaves the bag full is not repeated every round either
    tried.length = 0;
    f = fake({world: w, inv: [{name: 'carrot', count: 64, type: 1}], stopAfterSleeps: 40, deposit: async (r, j, item) => { tried.push(item); }});
    f.r.bot.inventory.emptySlotCount = () => 2;
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(tried, ['carrot']);
    // a stale or empty chest index never pauses: no hall totals, no surplus
    const storage = require('../../storage');
    assert.strictEqual(storage.surplus('carrot', storage.hallTotals(undefined)), 0);
    assert.strictEqual(storage.surplus('carrot', storage.hallTotals(new Map())), 0);
  }
};
