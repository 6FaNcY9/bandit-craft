'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // wheatfarm: validation, the pure scan and work choice, then the job against a fake bot
    const {JOBS, VALIDATE, Cancelled} = require('../../bots');
    const W = require('../../wheatfarm');
    const {Vec3} = require('vec3');
    const {OBJECTIVES, BASE} = require('../../plan-config');
    assert.deepStrictEqual(VALIDATE.wheatfarm({x1: 8, z1: 0, x2: 0, z2: 8}), {x1: 0, z1: 0, x2: 8, z2: 8}, 'corners in any order');
    for (const bad of [{x1: 0, z1: 0, x2: 9, z2: 5}, {x1: 0, z1: 0, x2: 5}, {x1: 'a', z1: 0, x2: 5, z2: 5}, {x1: 0.5, z1: 0, x2: 5, z2: 5}]) assert.throws(() => VALIDATE.wheatfarm(bad), JSON.stringify(bad));
    assert.ok(VALIDATE.wheatfarm({x1: 0, z1: 0, x2: 8, z2: 8}), '9 x 9 is the limit');
    assert.deepStrictEqual(VALIDATE.wheatfarm({x1: 0, z1: 0, x2: 1, z2: 1, y: 201}), {x1: 0, z1: 0, x2: 1, z2: 1, y: 201}, 'optional ground level');
    assert.throws(() => VALIDATE.wheatfarm({x1: 0, z1: 0, x2: 1, z2: 1, y: 'a'}), /y/);
    const wf = OBJECTIVES.find((o) => o.id === 'wheat-farm');
    assert.deepStrictEqual([wf.needs, wf.onBlocked, wf.roles[0].jobs[0]], [['stock-basics'], 'skip', ['wheatfarm', BASE.wheat]]);
    assert.deepStrictEqual(OBJECTIVES.map((o) => o.id).slice(5, 7), ['tree-farm', 'wheat-farm']);
    assert.strictEqual(W.wheatAge({getProperties: () => ({age: 7})}), 7);
    assert.strictEqual(W.wheatAge({metadata: 3}), 3, 'metadata is the age when there is no property reader');
    assert.ok(Number.isNaN(W.wheatAge({})));
    assert.strictEqual(W.breadFrom(8), 2);
    assert.deepStrictEqual([W.shouldDeposit({bread: 16, emptySlots: 20}), W.shouldDeposit({bread: 3, emptySlots: 3}), W.shouldDeposit({bread: 15, emptySlots: 4})], [true, true, false]);

    // a flat world: grass at y 64; water at (x -2, y 64, z 4) wets columns up to 4 blocks away
    const wheat = (age) => ({name: 'wheat', boundingBox: 'empty', getProperties: () => ({age})});
    const flat = (extra = {}) => {
      const cell = new Map(Object.entries(extra));
      const blockAt = (x, y, z) => {
        const c = cell.get(`${x},${y},${z}`);
        if (c) return typeof c === 'string' ? {name: c, boundingBox: /air|grass|fern/.test(c) ? 'empty' : c === 'water' ? 'empty' : 'block'} : c;
        return y <= 64 ? {name: y === 64 ? 'grass_block' : 'dirt', boundingBox: 'block'} : {name: 'air', boundingBox: 'empty'};
      };
      return {cell, blockAt, put: (x, y, z, n) => cell.set(`${x},${y},${z}`, n)};
    };
    const box = {x1: 0, z1: 0, x2: 4, z2: 4};
    let w = flat({'-1,64,2': 'water'});
    w.put(0, 64, 0, 'farmland'); w.put(0, 65, 0, wheat(7)); // ripe
    w.put(1, 64, 0, 'farmland'); w.put(1, 65, 0, wheat(3)); // growing
    w.put(2, 64, 0, 'farmland'); // empty farmland
    w.put(3, 65, 0, 'short_grass'); // grass on soil
    w.put(0, 65, 4, 'oak_planks'); // not free above
    w.put(4, 64, 3, 'cobblestone'); // not soil
    w.put(2, 64, 2, 'water'); // a water cell inside the box
    let sc = W.scan(w.blockAt, box, 64, []);
    const st = (x, z) => sc.cells.find((c) => c.x === x && c.z === z);
    assert.deepStrictEqual([st(0, 0).state, st(1, 0).state, st(2, 0).state, st(3, 0).state, st(4, 0).state, st(0, 4).state, st(4, 3).state, st(2, 2).state], ['ripe', 'growing', 'plant', 'clear', 'till', 'blocked', 'blocked', 'water']);
    assert.strictEqual(sc.wet, true);
    assert.deepStrictEqual([st(3, 0).wet, st(4, 0).wet, st(4, 4).wet], [true, true, true], 'within 4 blocks of the water in the box (2,2) or beside it (-1,2)');
    assert.strictEqual(W.scan(flat().blockAt, box, 64, []).wet, false, 'no water anywhere');
    // an oak slab laid in the water source (waterlogged) still wets the field (main server field 1, 2026-10-17)
    const slab = {name: 'oak_slab', boundingBox: 'block', getProperties: () => ({type: 'bottom', waterlogged: true})};
    assert.strictEqual(W.scan(flat({'2,64,2': slab}).blockAt, box, 64, []).wet, true, 'waterlogged slab');
    assert.strictEqual(W.scan(flat({'2,64,2': {...slab, getProperties: () => ({waterlogged: false})}}).blockAt, box, 64, []).wet, false, 'a dry slab does not');
    assert.deepStrictEqual(W.scan(w.blockAt, box, 64, [[0, 0, 4, 1]]).cells.filter((c) => c.z <= 1).length, 0, 'protected columns are never listed');
    assert.strictEqual(W.scan((x, y, z) => (x === 2 && z === 2 ? null : w.blockAt(x, y, z)), box, 64, []).unloaded, 1, 'an unloaded column is counted');
    assert.strictEqual(W.centre(box).x + ',' + W.centre(box).z, '2,2');
    assert.strictEqual(sc.centre.state, 'water');
    // water one level up wets too, two levels up does not
    w = flat({'4,65,6': 'water'});
    assert.strictEqual(W.scan(w.blockAt, box, 64, []).cells.find((c) => c.x === 4 && c.z === 4).wet, true);
    w = flat({'4,66,6': 'water'});
    assert.strictEqual(W.scan(w.blockAt, box, 64, []).wet, false);
    // work: harvest, then plant (as many as seeds), clear/till wet soil only; hoe and seeds are asked for
    const cells = [
      {x: 0, z: 0, state: 'ripe', wet: true}, {x: 3, z: 0, state: 'ripe', wet: false}, {x: 1, z: 1, state: 'plant', wet: true}, {x: 2, z: 1, state: 'plant', wet: true},
      {x: 4, z: 4, state: 'till', wet: true}, {x: 3, z: 4, state: 'till', wet: false}, {x: 2, z: 4, state: 'clear', wet: true}, {x: 0, z: 3, state: 'growing', wet: true},
    ];
    let pick = W.chooseWork(cells, {me: {x: 0, z: 0}, seeds: 1, hoe: true});
    assert.deepStrictEqual(pick.harvest.map((c) => c.x), [0, 3], 'ripe wheat, nearest first (dry or not)');
    assert.deepStrictEqual([pick.plant.length, pick.clear.length, pick.till.map((c) => `${c.x},${c.z}`), pick.needHoe, pick.needSeeds], [1, 1, ['4,4'], false, false], 'dry soil is not tilled, planting is capped by the seeds');
    pick = W.chooseWork(cells, {me: {x: 0, z: 0}, seeds: 0, hoe: false});
    assert.deepStrictEqual([pick.plant.length, pick.till.length, pick.needHoe, pick.needSeeds], [0, 0, true, true]);
    assert.deepStrictEqual(W.chooseWork(cells, {me: {x: 0, z: 0}, seeds: 5, hoe: true, skip: (c) => c.state !== 'ripe' || c.x === 3}).harvest.length, 1, 'skipped cells are left alone');
    assert.deepStrictEqual(W.chooseWork([{x: 0, z: 0, state: 'growing', wet: true}], {me: {x: 0, z: 0}, seeds: 0, hoe: false}).needSeeds, false, 'nothing to plant: no seeds needed');
    // drops: wheat, seeds and bread within a block of the box
    const drop = (x, z, name) => ({name: 'item', position: new Vec3(x + 0.5, 65, z + 0.5), getDroppedItem: () => ({name})});
    assert.deepStrictEqual(W.pickups([drop(1, 1, 'wheat'), drop(5, 5, 'wheat_seeds'), drop(7, 1, 'wheat'), drop(2, 2, 'dirt'), drop(0, 0, 'bread')], box, [], new Vec3(0, 65, 0)).map((e) => e.getDroppedItem().name), ['bread', 'wheat', 'wheat_seeds']);

    // the job: wet field, seeds in the pocket, a hoe; it harvests, tills, plants, crafts bread and deposits
    const small = {x1: 0, z1: 0, x2: 3, z2: 3};
    const fake = ({inv = [], world, stopAfterSleeps = 2, chestFail = false, getWater = null, noWay = () => false, care = null}) => {
      const events = [], infos = [], calls = {deposit: [], craft: [], dig: []};
      const it = (name, count) => ({name, count, type: name.length});
      const give = (name, n) => { const e = inv.find((i) => i.name === name) || (inv.push(it(name, 0)), inv.at(-1)); e.count += n; };
      const bot = {
        entities: {}, inventory: {items: () => inv.filter((i) => i.count > 0), emptySlotCount: () => 30}, heldItem: null, game: {dimension: 'overworld'},
        entity: {position: new Vec3(0.5, 65, 0.5)}, registry: {blocksByName: {}},
        blockAt: (p) => { const b = world.blockAt(p.x, p.y, p.z); return b && {position: p, ...b}; },
        equip: async (item) => { bot.heldItem = item; },
        activateBlock: async (b) => { if (bot.heldItem?.name.endsWith('_hoe') && b.name === 'grass_block') { world.put(b.position.x, b.position.y, b.position.z, 'farmland'); events.push(`till ${b.position.x},${b.position.z}`); } },
        placeBlock: async (ref) => { bot.heldItem.count--; world.put(ref.position.x, ref.position.y + 1, ref.position.z, wheat(0)); events.push(`plant ${ref.position.x},${ref.position.z}`); },
        findBlocks: () => [],
        lookAt: async (p) => { bot.looking = p; },
        activateItem: async () => { if (bot.heldItem?.name === 'water_bucket') { world.put(Math.floor(bot.looking.x), bot.looking.y, Math.floor(bot.looking.z), 'water'); bot.heldItem.name = 'bucket'; } },
      };
      const job = {type: 'wheatfarm', args: small, t: {}, cancelled: false};
      let sleeps = 0;
      const wfm = W.makeWheatFarm({
        goNear: async (r, j, x, y, z) => { if (noWay(x, z)) throw new Error(`could not reach ${x} ${y} ${z}: No path to the goal!`); bot.entity.position = new Vec3(x, y, z); },
        guard: (j) => { if (j.cancelled) throw new Cancelled('stopped'); },
        sleep: async () => { if (++sleeps > stopAfterSleeps) job.cancelled = true; },
        waitCalm: async () => {}, at: (c) => `${c.x} ${c.y} ${c.z}`,
        digAt: async (r, j, pos, want) => {
          const b = world.blockAt(pos.x, pos.y, pos.z);
          if (!want(b.name)) return false;
          calls.dig.push(`${b.name} ${pos.x},${pos.z}`);
          world.put(pos.x, pos.y, pos.z, 'air');
          if (b.name === 'wheat') { give('wheat', 1); give('wheat_seeds', 1); }
          return true;
        },
        crafting: {count: (b, n) => inv.filter((i) => i.name === n).reduce((a, i) => a + i.count, 0), ensureItem: async (r, j, name, want) => { calls.craft.push(`${name} ${want}`); if (chestFail) throw new Error('no logs'); if (name === 'bread') { give('wheat', -3 * (want - inv.filter((i) => i.name === 'bread').reduce((a, i) => a + i.count, 0))); give('bread', want); } else give(name, 1); }},
        craftTable: () => true, base: {x: -9, y: 65, z: -9},
        deposit: async (r, j, what, keep) => {
          calls.deposit.push(keep ? `${what} keep ${JSON.stringify(keep)}` : what);
          for (const i of inv) if (i.name === what) i.count = 0;
          if (keep) for (const i of inv) if (keep[i.name] != null) i.count = Math.min(i.count, keep[i.name]);
        },
        getWater: getWater && (async (...a) => { await getWater(...a); give('water_bucket', 1); }),
        care,
      });
      const r = {bot, world: {claim: async () => true, release() {}}, combat: {busy: false, epoch: 0}, emit: (k, t) => infos.push(t), protectedAreas: [], supplyChest: {x: -3, y: 65, z: -3}};
      return {r, job, events, infos, calls, inv, run: () => wfm.wheatfarm(r, job)};
    };
    w = flat({'-1,64,1': 'water'});
    w.put(0, 64, 0, 'farmland'); w.put(0, 65, 0, wheat(7)); w.put(1, 64, 0, 'farmland'); w.put(1, 65, 0, wheat(7)); w.put(2, 64, 0, 'farmland'); w.put(2, 65, 0, wheat(7));
    let f = fake({world: w, inv: [{name: 'wooden_hoe', count: 1, type: 1}, {name: 'wheat_seeds', count: 20, type: 2}]});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.dig.slice(0, 3), ['wheat 0,0', 'wheat 1,0', 'wheat 2,0'], 'ripe wheat first');
    assert.deepStrictEqual(f.calls.craft.slice(0, 1), ['bread 1'], '3 wheat -> bread');
    assert.ok(f.events.filter((e) => e.startsWith('till')).length >= 12, 'every grass cell is tilled: ' + f.events.length);
    assert.ok(f.events.filter((e) => e.startsWith('plant')).length >= 15, 'and planted');
    assert.match(f.job.progress, /3 wheat harvested, \d+ planted, 1 bread/);
    assert.match(f.job.t.doing, /waiting for the wheat to grow/);
    // care (food and gear) runs in the farm loop, never in a pass for food (bot3 at food 5 on its field, 2026-10-17)
    let cared = 0;
    f = fake({world: flat({'-1,64,1': 'water'}), inv: [{name: 'wooden_hoe', count: 1, type: 1}], care: async () => { cared++; }});
    await assert.rejects(f.run(), Cancelled);
    assert.ok(cared >= 1, 'care in the loop');
    cared = 0;
    f = fake({world: flat({'-1,64,1': 'water'}), inv: [{name: 'wooden_hoe', count: 1, type: 1}], care: async () => { cared++; }});
    f.job.forFood = true;
    await f.run();
    assert.strictEqual(cared, 0, 'not in a pass for food');
    // forFood (a hungry bot, bots.js wheatFood): the bread is kept and the pass ends when nothing is left to do
    w = flat({'-1,64,1': 'water'});
    w.put(0, 64, 0, 'farmland'); w.put(0, 65, 0, wheat(7)); w.put(1, 64, 0, 'farmland'); w.put(1, 65, 0, wheat(7)); w.put(2, 64, 0, 'farmland'); w.put(2, 65, 0, wheat(7));
    f = fake({world: w, inv: [{name: 'wooden_hoe', count: 1, type: 1}, {name: 'wheat_seeds', count: 20, type: 2}, {name: 'bread', count: 16, type: 3}]});
    f.job.forFood = true;
    await f.run(); // returns, no Stop needed
    assert.deepStrictEqual(f.calls.deposit, [], 'the bread is kept, even 16 of it');
    assert.ok(f.inv.find((i) => i.name === 'bread').count > 16, 'and the harvest became bread');
    assert.ok(f.events.filter((e) => e.startsWith('plant')).length >= 15, 'the field is replanted on the way');
    // 16 bread are handed in (bread, not wheat)
    f = fake({world: flat({'-1,64,1': 'water'}), inv: [{name: 'bread', count: 16, type: 3}, {name: 'wheat', count: 2, type: 4}]});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.deposit.slice(0, 2), ['bread', 'wheat']);
    // seeds above 64 go out with a plain deposit (filed in the hall), 64 stay to replant (bot3 with 1154, main server 2026-10-19)
    f = fake({world: flat({'-1,64,1': 'water'}), inv: [{name: 'bread', count: 16, type: 3}, {name: 'wheat_seeds', count: 200, type: 2}]});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.deposit.slice(0, 2), ['bread', 'null keep {"wheat_seeds":64}']);
    // no hoe and nothing craftable: the job waits instead of failing; a Stop at the equip tills nothing
    f = fake({world: flat({'-1,64,1': 'water'}), inv: [{name: 'wheat_seeds', count: 3, type: 2}], chestFail: true});
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.events.filter((e) => e.startsWith('till')).length, 0);
    assert.match(f.job.t.doing, /no hoe/);
    f = fake({world: flat({'-1,64,1': 'water'}), inv: [{name: 'wooden_hoe', count: 1, type: 1}]});
    f.r.bot.equip = async (item) => { f.r.bot.heldItem = item; f.job.cancelled = true; };
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.events.filter((e) => e.startsWith('till')).length, 0);
    // no water and no bucket: a clear failure naming the spot
    f = fake({world: flat(), inv: [{name: 'wooden_hoe', count: 1, type: 1}]});
    await assert.rejects(f.run(), /no water in the field: place a water source at 1 64 1/);
    // protected: nothing to farm
    f = fake({world: flat({'-1,64,1': 'water'})});
    f.r.protectedAreas = [[0, 0, 3, 3]];
    await assert.rejects(f.run(), /nothing to farm/);
    // several fields (the dashboard's wheat zones, 2026-10-16): tended in turn before the job waits
    const field2 = {x1: 10, z1: 0, x2: 13, z2: 3};
    const seeds = () => [{name: 'wooden_hoe', count: 1, type: 1}, {name: 'wheat_seeds', count: 40, type: 2}];
    w = flat({'-1,64,1': 'water', '9,64,1': 'water'});
    for (const x of [0, 10]) { w.put(x, 64, 0, 'farmland'); w.put(x, 65, 0, wheat(7)); }
    f = fake({world: w, inv: seeds(), stopAfterSleeps: 1});
    f.job.args = {...small, fields: [small, field2]};
    await assert.rejects(f.run(), Cancelled);
    assert.ok(f.calls.dig.includes('wheat 0,0') && f.calls.dig.includes('wheat 10,0'), 'both fields harvested: ' + f.calls.dig.slice(0, 8));
    assert.ok(f.events.some((e) => e === 'plant 12,2'), 'and the second one planted');
    // a dry second field: a water bucket is fetched and poured into its centre
    const fetched = [];
    f = fake({world: flat({'-1,64,1': 'water'}), inv: seeds(), stopAfterSleeps: 6, getWater: async (r, j, fs) => fetched.push(fs.length)});
    f.job.args = {...small, fields: [small, field2]};
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(fetched, [2], 'one bucket, filled outside both fields');
    assert.strictEqual(f.r.bot.blockAt(new Vec3(11, 64, 1)).name, 'water', 'poured at the centre of field 2');
    // wet only at an edge (a pond beside it): the dry centre still gets its water
    const field3 = {x1: 20, z1: 0, x2: 28, z2: 8};
    fetched.length = 0;
    f = fake({world: flat({'-1,64,1': 'water', '29,64,8': 'water'}), inv: seeds(), stopAfterSleeps: 6, getWater: async (r, j, fs) => fetched.push(fs.length)});
    f.job.args = {...small, fields: [small, field3]};
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(fetched, [2]);
    assert.strictEqual(f.r.bot.blockAt(new Vec3(24, 64, 4)).name, 'water', 'poured at the centre of field 3');
    // no water to be had: that field waits, the other goes on (one field alone still fails, as above)
    f = fake({world: flat({'-1,64,1': 'water'}), inv: seeds(), stopAfterSleeps: 2, getWater: async () => { throw new Error('no water source within 96 blocks'); }});
    f.job.args = {...small, fields: [small, field2]};
    await assert.rejects(f.run(), Cancelled);
    assert.ok(f.infos.some((t) => /field 2 left for now \(no water source/.test(t)), f.infos.join('|'));
    assert.ok(f.events.filter((e) => e.startsWith('plant')).length >= 15, 'field 1 farmed anyway');
    // no way to a field (bot3's order ended on "could not reach -234 66 -218: No path", 2026-10-16) or to its cells:
    // that field and those cells are left: the job goes on until the Stop
    const refused = [];
    f = fake({world: flat({'-1,64,1': 'water', '29,64,1': 'water'}), inv: seeds(), stopAfterSleeps: 2, noWay: (x, z) => refused.push(`${x},${z}`)});
    f.r.bot.entity.position = new Vec3(-4.5, 65, -4.5); // near field 1 (no walk to its centre), every cell out of reach
    f.job.args = {...small, fields: [small, {x1: 30, z1: 0, x2: 33, z2: 3}]};
    await assert.rejects(f.run(), Cancelled);
    assert.ok(f.infos.some((t) => /field 2 left for now \(could not reach .*No path/.test(t)), f.infos.join('|'));
    assert.ok(refused.some((c) => c === '0,0') && !f.events.length, `cell walks refused (${refused.slice(0, 4)}), nothing tilled or planted: ${f.events}`);
    // withFields: a dashboard wheat zone stands for all of them, the asked one first
    const zones = [{x1: 0, z1: 0, x2: 8, z2: 8}, {x1: 9, z1: 0, x2: 17, z2: 8}, {x1: 18, z1: 0, x2: 26, z2: 8}];
    assert.deepStrictEqual(W.withFields({x1: 17, z1: 8, x2: 9, z2: 0}, zones).fields.map((z) => z.x1), [9, 18, 0]);
    assert.deepStrictEqual(W.withFields({x1: 50, z1: 0, x2: 52, z2: 2}, zones), {x1: 50, z1: 0, x2: 52, z2: 2}, 'not a zone: one field');
    assert.deepStrictEqual(W.withFields({x1: 0, z1: 0, x2: 8, z2: 8}, zones.slice(0, 1)).fields, undefined, 'one zone: nothing to add');
    const V = require('../../bots').VALIDATE;
    assert.deepStrictEqual(V.wheatfarm({x1: 0, z1: 0, x2: 3, z2: 3, fields: [field2, {x1: 3, z1: 3, x2: 0, z2: 0}]}).fields, [field2, small]);
    assert.throws(() => V.wheatfarm({...small, fields: [small, small, small, small, small]}), /fields must be a list of 1 to 4/);
    assert.throws(() => V.wheatfarm({...small, fields: [{x1: 0, z1: 0, x2: 20, z2: 0}]}), /at most 9 x 9/);
  }
};
