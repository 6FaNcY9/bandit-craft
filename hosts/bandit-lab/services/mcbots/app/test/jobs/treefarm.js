'use strict';
const assert = require('node:assert');
module.exports = async () => {
  { // treefarm: validation, the pure scan, then the job against a fake bot
    const {JOBS, VALIDATE, Cancelled} = require('../../bots');
    const T = require('../../treefarm');
    const {Vec3} = require('vec3');
    const A = require('../../agentauth');
    assert.deepStrictEqual(VALIDATE.treefarm({x1: 8, z1: 0, x2: 0, z2: 8}), {x1: 0, z1: 0, x2: 8, z2: 8}, 'corners in any order');
    for (const bad of [{x1: 0, z1: 0, x2: 24, z2: 5}, {x1: 0, z1: 0, x2: 1, z2: 5}, {x1: 0, z1: 0, x2: 5}, {x1: 'a', z1: 0, x2: 5, z2: 5}, {x1: 0.5, z1: 0, x2: 5, z2: 5}]) assert.throws(() => VALIDATE.treefarm(bad), JSON.stringify(bad));
    assert.ok(VALIDATE.treefarm({x1: 0, z1: 0, x2: 23, z2: 23}), '24 x 24 is the limit');
    assert.strictEqual(A.agentJobRefusal({bots: ['bot1'], type: 'treefarm', args: {}}, {agentBots: ['bot1'], supplyChest: {x: 1, y: 2, z: 3}}), null);
    assert.deepStrictEqual([T.gridCells({x1: 0, z1: 0, x2: 14, z2: 14}).length, T.gridCells({x1: 0, z1: 0, x2: 23, z2: 23}).length, T.gridCells({x1: 0, z1: 0, x2: 2, z2: 2})], [25, 64, [{x: 1, z: 1}]]);
    assert.deepStrictEqual(T.gridCells({x1: -5, z1: 10, x2: 3, z2: 12}).map((c) => `${c.x},${c.z}`), ['-4,11', '-1,11', '2,11'], 'a 3-block grid, one block in from the edge');
    assert.strictEqual(T.pickSapling([{name: 'jungle_sapling'}, {name: 'birch_sapling'}, {name: 'dark_oak_sapling'}, {name: 'oak_sapling'}]).name, 'oak_sapling', 'oak first, never dark_oak');
    assert.strictEqual(T.pickSapling([{name: 'dark_oak_sapling'}, {name: 'oak_log'}]), undefined, '2x2-only kinds are not planted');

    // a flat world: grass at y 64, air above; `put` overrides single blocks
    const flat = (extra = {}) => {
      const cell = new Map(Object.entries(extra));
      const blockAt = (x, y, z) => {
        const c = cell.get(`${x},${y},${z}`);
        if (c) return typeof c === 'string' ? {name: c, boundingBox: /air|sapling|short_grass|fern/.test(c) ? 'empty' : 'block'} : c;
        return y <= 64 ? {name: y === 64 ? 'grass_block' : 'dirt', boundingBox: 'block'} : {name: 'air', boundingBox: 'empty'};
      };
      return {cell, blockAt, put: (x, y, z, n) => cell.set(`${x},${y},${z}`, n)};
    };
    const box = {x1: 0, z1: 0, x2: 14, z2: 14};
    const tree = (w, x, z, n = 4, log = 'oak_log') => { for (let y = 65; y < 65 + n; y++) w.put(x, y, z, log); w.put(x, 65 + n, z, 'oak_leaves'); w.put(x + 1, 65 + n - 1, z, 'oak_leaves'); };
    let w = flat();
    let sc = T.scan(w.blockAt, box, 64, []);
    assert.deepStrictEqual([sc.free.length, sc.planted.length, sc.trees.length], [25, 0, 0]);
    assert.deepStrictEqual(sc.free[0], {x: 1, z: 1, gy: 64});
    // saplings, trees and things in the way
    w.put(1, 65, 1, 'oak_sapling'); // planted
    w.put(4, 65, 4, 'short_grass'); // grass is replaced by the sapling
    w.put(7, 65, 7, 'chest'); // not free
    w.put(10, 64, 10, 'cobblestone'); // not soil
    w.put(13, 68, 13, 'oak_planks'); // a roof within 4 blocks above
    w.put(13, 70, 1, 'oak_planks'); // far above: it counts as the ground of that column, which is no soil
    w.put(1, 66, 13, 'oak_leaves'); // leaves above are fine
    w.put(10, 65, 1, 'water'); // water in the cell
    sc = T.scan(w.blockAt, box, 64, []);
    assert.deepStrictEqual(sc.planted, [{x: 1, z: 1, gy: 64}]);
    const freeKeys = sc.free.map((c) => `${c.x},${c.z}`);
    assert.ok(freeKeys.includes('4,4') && freeKeys.includes('1,13'), 'grass and leaves above do not block');
    assert.ok(!['7,7', '10,10', '13,13', '10,1', '13,1'].some((k) => freeKeys.includes(k)), 'chest, stone, a roof and water do');
    assert.strictEqual(T.scan(w.blockAt, box, 64, [[0, 0, 5, 5]]).free.some((c) => c.x < 6 && c.z < 6), false, 'protected areas are never listed');
    // trees: a leafy natural tree counts, a bare pillar, a stripped log, a log on planks and a tree outside do not
    w = flat();
    tree(w, 4, 4, 5); // 5 logs
    w.put(5, 66, 4, 'oak_log'); w.put(6, 66, 4, 'oak_log'); // a branch
    for (let y = 65; y < 68; y++) w.put(10, y, 10, 'oak_log'); // bare pillar
    for (let y = 65; y < 68; y++) w.put(1, y, 10, 'stripped_oak_log'); w.put(1, 68, 10, 'oak_leaves');
    w.put(13, 64, 1, 'oak_planks'); w.put(13, 65, 1, 'oak_log'); w.put(13, 66, 1, 'oak_leaves');
    tree(w, 20, 4, 4); // outside the box
    sc = T.scan(w.blockAt, box, 64, []);
    assert.strictEqual(sc.trees.length, 1, JSON.stringify(sc.trees.map((t) => t.base)));
    assert.deepStrictEqual([sc.trees[0].base, sc.trees[0].logs.length, sc.trees[0].logs[0].y], [{x: 4, y: 65, z: 4}, 7, 65], 'all logs including the branch, lowest first');
    assert.strictEqual(T.scan(w.blockAt, box, 64, [[4, 4, 4, 4]]).trees.length, 0, 'a protected base column is not a tree');
    w.put(7, 66, 4, 'oak_log'); w.put(15, 66, 4, 'oak_log'); w.put(14, 66, 4, 'oak_log'); w.put(13, 66, 4, 'oak_log'); w.put(8, 66, 4, 'oak_log'); w.put(9, 66, 4, 'oak_log'); w.put(10, 66, 4, 'oak_log'); w.put(11, 66, 4, 'oak_log'); w.put(12, 66, 4, 'oak_log');
    assert.ok(!T.scan(w.blockAt, box, 64, []).trees[0].logs.some((l) => l.x > 14), 'logs outside the box are never listed');
    // drops: only saplings, apples and logs inside the box
    const drop = (x, z, name) => ({name: 'item', position: new Vec3(x + 0.5, 65, z + 0.5), getDroppedItem: () => ({name})});
    const ds = [drop(3, 3, 'oak_sapling'), drop(2, 2, 'apple'), drop(5, 5, 'dirt'), drop(20, 5, 'oak_sapling'), drop(8, 8, 'birch_log'), drop(1, 1, 'stick')];
    assert.deepStrictEqual(T.pickups(ds, box, [], new Vec3(0, 65, 0)).map((e) => e.getDroppedItem().name), ['apple', 'oak_sapling', 'birch_log']);
    assert.strictEqual(T.pickups(ds, box, [[0, 0, 4, 4]], new Vec3(0, 65, 0)).length, 1, 'not in a protected area');

    // the job: a 9 x 9 farm, 9 cells; the chest holds saplings; a grown tree is cut and replanted
    const small = {x1: 0, z1: 0, x2: 8, z2: 8};
    const fake = ({inv = [], world, stopAfterSleeps = 3, chest = true}) => {
      const events = [], infos = [], calls = {deposit: 0, withdraw: [], dig: []};
      const it = (name, count) => ({name, count, type: name.length});
      const bot = {
        entities: {}, inventory: {items: () => inv.filter((i) => i.count > 0), emptySlotCount: () => 30}, heldItem: null, game: {dimension: 'overworld'},
        entity: {position: new Vec3(0.5, 65, 0.5), onGround: true},
        blockAt: (p) => { const b = world.blockAt(p.x, p.y, p.z); return b && {position: p, ...b}; },
        equip: async (item) => { bot.heldItem = item; },
        placeBlock: async (ref) => { const held = bot.heldItem; held.count--; world.put(ref.position.x, ref.position.y + 1, ref.position.z, held.name); events.push(`plant ${held.name} ${ref.position.x},${ref.position.z}`); },
        activateBlock: async () => { events.push('bonemeal'); },
      };
      const job = {type: 'treefarm', args: small, t: {}, cancelled: false};
      let sleeps = 0;
      const tf = T.makeTreeFarm({
        goNear: async (r, j, x, y, z) => { bot.entity.position = new Vec3(x, y, z); },
        guard: (j) => { if (j.cancelled) throw new Cancelled('stopped'); },
        sleep: async () => { if (++sleeps > stopAfterSleeps) job.cancelled = true; },
        waitCalm: async () => {},
        at: (c) => `${c.x} ${c.y} ${c.z}`,
        digAt: async (r, j, pos, want) => {
          const b = world.blockAt(pos.x, pos.y, pos.z);
          if (!want(b.name)) return false;
          calls.dig.push(`${pos.x},${pos.y},${pos.z}`);
          world.put(pos.x, pos.y, pos.z, 'air');
          const log = inv.find((i) => i.name === b.name) || (inv.push(it(b.name, 0)), inv.at(-1));
          log.count++;
          return true;
        },
        deposit: async () => { calls.deposit++; for (const i of inv) if (/_log$/.test(i.name)) i.count = 0; },
        withdraw: async (r2, j, item, count) => {
          calls.withdraw.push(`${item} ${count}`);
          if (!chest || !['oak_sapling', 'dirt'].includes(item)) throw new Error(`no ${item} in the chest`);
          inv.push(it(item, count));
        },
      });
      const r = {bot, world: {claim: async () => true, release() {}}, combat: {busy: false, epoch: 0}, emit: (k, t) => infos.push(t), protectedAreas: [], supplyChest: {x: -3, y: 65, z: -3}};
      return {r, job, events, infos, calls, inv, run: () => tf.treefarm(r, job)};
    };
    w = flat();
    let f = fake({world: w});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.withdraw, ['oak_sapling 9'], 'birch is only tried when oak is gone; the chest was asked once');
    assert.strictEqual(f.events.filter((e) => e.startsWith('plant')).length, 9, f.events.join('|'));
    assert.match(f.job.progress, /0 logs cut, 9 saplings planted/);
    assert.deepStrictEqual(T.scan(w.blockAt, small, 64, []).planted.length, 9);
    // the trees grow (saplings become trees); the bot cuts them all, hands the logs in and replants
    for (const c of T.gridCells(small)) tree(w, c.x, c.z, 4);
    f = fake({world: w, inv: [{name: 'oak_sapling', count: 9, type: 1}]});
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.calls.dig.length, 36, '9 trees x 4 logs');
    assert.ok(f.calls.deposit >= 1, 'logs go to the chest');
    assert.strictEqual(f.events.filter((e) => e.startsWith('plant')).length, 9, 'every stump is replanted');
    assert.match(f.job.progress, /36 logs cut, 9 saplings planted/);
    // a Stop during planting plants nothing more
    w = flat();
    f = fake({world: w, inv: [{name: 'oak_sapling', count: 9, type: 1}]});
    f.r.bot.equip = async (item) => { f.r.bot.heldItem = item; f.job.cancelled = true; };
    await assert.rejects(f.run(), Cancelled);
    assert.strictEqual(f.events.filter((e) => e.startsWith('plant')).length, 0);
    // no saplings anywhere: a clear failure, not an endless wait; no chest: no job
    f = fake({world: flat(), chest: false});
    await assert.rejects(f.run(), /no saplings: none carried, none in the supply chest/);
    assert.deepStrictEqual(f.calls.withdraw.length, 6, 'every allowed kind was asked for once');
    f = fake({world: flat()});
    f.r.supplyChest = null;
    await assert.rejects(f.run(), /needs the supply chest/);
    // a farm mined down to stone (the main base's, 2026-10-15): dirt from the chest on every spot, then saplings
    const stony = () => { const w2 = flat(); for (let x = 0; x <= 8; x++) for (let z = 0; z <= 8; z++) w2.put(x, 64, z, (x + z) % 2 ? 'stone' : 'andesite'); return w2; };
    assert.deepStrictEqual([T.cellState(stony().blockAt, {x: 1, z: 1}, 64), T.scan(stony().blockAt, small, 64, []).bare.length], ['bare', 9]);
    w = stony();
    f = fake({world: w, inv: [{name: 'oak_sapling', count: 9, type: 1}]});
    await assert.rejects(f.run(), Cancelled);
    assert.deepStrictEqual(f.calls.withdraw, ['dirt 9'], 'dirt from the chest, once');
    assert.strictEqual(T.scan(w.blockAt, small, 64, []).bare.length, 0, 'no bare spot left: ' + f.events.join('|'));
    assert.strictEqual(f.events.filter((e) => e.startsWith('plant oak_sapling')).length, 9, 'and a sapling on each: ' + f.events.join('|'));
    // no dirt in the chest either: a clear failure, not "nothing to farm"
    f = fake({world: stony(), chest: false});
    await assert.rejects(f.run(), /no soil: 9 planting spots are bare stone/);
    // honours the protected area: a protected farm plants nothing
    f = fake({world: flat(), inv: [{name: 'oak_sapling', count: 9, type: 1}]});
    f.r.protectedAreas = [[0, 0, 8, 8]];
    await assert.rejects(f.run(), /nothing to farm/);
    assert.strictEqual(f.events.filter((e) => e.startsWith('plant')).length, 0);
  }
};
