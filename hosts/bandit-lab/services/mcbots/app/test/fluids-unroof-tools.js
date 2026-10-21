'use strict';
(async () => { // fluids: the sources a schematic leaves out, poured from buckets (the iron farm's 140, 2026-10-15)
  const assert = require('node:assert/strict');
  const F = require('../fluids');
  const {Vec3} = require('vec3');
  const {Cancelled} = require('../bots');
  const world = () => {
    const cells = new Map();
    const blockAt = (x, y, z) => {
      const c = cells.get(`${x},${y},${z}`);
      const name = c ? c.name : y <= 63 ? 'stone' : 'air';
      return {name, boundingBox: /water|lava|air/.test(name) ? 'empty' : 'block', getProperties: () => ({level: c?.level ?? 0}), position: new Vec3(x, y, z)};
    };
    return {cells, blockAt, put: (x, y, z, name, level = 0) => cells.set(`${x},${y},${z}`, {name, level})};
  };
  let w = world();
  const fl = [{x: 0, y: 64, z: 0, name: 'water'}, {x: 1, y: 65, z: 0, name: 'water'}, {x: 2, y: 64, z: 0, name: 'lava'}];
  assert.deepStrictEqual(F.missing(fl, w.blockAt, {x: 0, z: 0}).map((f) => `${f.name}${f.y}`), ['water64', 'water65', 'lava64'], 'lowest first, lava last');
  w.put(0, 64, 0, 'water'); w.put(1, 65, 0, 'water', 3);
  assert.deepStrictEqual(F.missing(fl, w.blockAt, {x: 0, z: 0}).map((f) => `${f.name}${f.y}`), ['water65', 'lava64'], 'a source is done, flowing water is not');
  assert.deepStrictEqual(F.aim(w.blockAt, {x: 5, y: 64, z: 5}), {x: 5.5, y: 64, z: 5.5}, 'the floor\'s top face');
  assert.strictEqual(F.aim(w.blockAt, {x: 5, y: 70, z: 5}), null, 'nothing solid around');
  w.put(6, 70, 5, 'cobblestone');
  assert.deepStrictEqual(F.aim(w.blockAt, {x: 5, y: 70, z: 5}), {x: 6, y: 70.5, z: 5.5}, 'else a side');
  w.put(10, 64, 0, 'water'); w.put(11, 64, 0, 'water'); w.put(12, 64, 0, 'water');
  assert.ok(F.refills(w.blockAt, {x: 11, y: 64, z: 0}) && !F.refills(w.blockAt, {x: 10, y: 64, z: 0}), 'the middle of a row of three refills, its end not');
  const box1 = {lo: {x: 0, y: 64, z: 0}, hi: {x: 2, y: 64, z: 0}};
  w.put(0, 65, 0, 'water'); w.put(20, 64, 0, 'water');
  const ok = F.fillable(w.blockAt, box1, 'water', new Set(['0,65,0']));
  assert.deepStrictEqual([ok(w.blockAt(0, 65, 0)), ok(w.blockAt(20, 64, 0)), ok(w.blockAt(11, 64, 0))], [false, true, true], 'not a source the build itself needs (above its box), yes a pond or a refilling row');

  // the job: an empty bucket from the chest, filled at the pond outside the build, poured into each missing cell; no
  // lava anywhere, so the lava cell is left and reported
  w = world();
  w.put(30, 64, 0, 'water');
  const inv = [], infos = [];
  let looking = null;
  const bot = {
    entity: {position: new Vec3(0, 64, 0)},
    inventory: {items: () => inv},
    blockAt: (p) => w.blockAt(p.x, p.y, p.z),
    equip: async () => {},
    lookAt: async (p) => { looking = p; },
    activateItem: async () => {
      const hand = inv.find((i) => /bucket/.test(i.name));
      if (hand.name === 'bucket') { hand.name = 'water_bucket'; return; }
      w.put(Math.floor(looking.x), looking.y, Math.floor(looking.z), 'water');
      hand.name = 'bucket';
    },
    findBlocks: ({matching, count}) => [...w.cells.keys()].map((k) => k.split(',').map(Number)).map(([x, y, z]) => w.blockAt(x, y, z)).filter(matching).slice(0, count).map((b) => b.position),
  };
  const asked = [];
  const {fluids} = F.makeFluids({
    goNear: async (r, j, x, y, z) => { bot.entity.position = new Vec3(x, y, z); },
    guard: (j) => { if (j.cancelled) throw new Cancelled('stopped'); },
    sleep: async () => {}, at: (c) => `${c.x} ${c.y} ${c.z}`,
    plan: async () => ({fluids: [{x: 0, y: 64, z: 0, name: 'water'}, {x: 1, y: 64, z: 0, name: 'water'}, {x: 2, y: 64, z: 0, name: 'lava'}], lo: {x: 0, y: 64, z: 0}, hi: {x: 2, y: 64, z: 0}}),
    withdraw: async (r, j, item) => { asked.push(item); if (item === 'bucket') inv.push({name: 'bucket', count: 1}); },
    craft: async () => {},
  });
  await fluids({bot, world: {claim: async () => true, release() {}}, emit: (k, t) => infos.push(t)}, {t: {}, args: {}, cancelled: false});
  assert.ok(F.isSource(w.blockAt(0, 64, 0), 'water') && F.isSource(w.blockAt(1, 64, 0), 'water'), 'both water cells poured');
  assert.deepStrictEqual(asked, ['bucket'], 'one bucket, refilled at the pond');
  assert.ok(infos.some((t) => /fluids: 2 poured, 1 left: lava at 2 64 0/.test(t)), infos.join('|'));
  console.log('fluids: bucket pour ok');
})();

(async () => { // unroof: out of a cave under sand, the column dug from beside (bot1 at -181 58 -218, 2026-10-15)
  const assert = require('node:assert/strict');
  const U = require('../unroof');
  const {Vec3} = require('vec3');
  const {Cancelled} = require('../bots');
  const world = () => {
    const cells = new Map();
    const name = (x, y, z) => cells.get(`${x},${y},${z}`) ?? (y <= 57 ? 'granite' : 'air');
    const blockAt = (x, y, z) => ({name: name(x, y, z), boundingBox: /air|water|lava/.test(name(x, y, z)) ? 'empty' : 'block', position: new Vec3(x, y, z)});
    const put = (x, y, z, n) => cells.set(`${x},${y},${z}`, n);
    // dig, then let what stands on it fall to the next floor (sand and gravel only)
    const dig = (x, y, z) => {
      put(x, y, z, 'air');
      for (let yy = y + 1; U.GRAVITY.test(name(x, yy, z)); yy++) {
        const n = name(x, yy, z);
        put(x, yy, z, 'air');
        let land = yy - 1;
        while (blockAt(x, land - 1, z).boundingBox === 'empty') land--;
        put(x, land, z, n);
      }
    };
    return {cells, blockAt, put, dig};
  };
  // bot1's pocket: open to the north, sandstone walls, one sandstone and two sand overhead, sky from 63
  let w = world();
  const p = {x: 0, y: 58, z: 0};
  for (const [x, z] of [[1, 0], [-1, 0], [0, -1]]) for (const y of [58, 59, 60]) w.put(x, y, z, 'sandstone');
  w.put(0, 60, 0, 'sandstone'); w.put(0, 61, 0, 'sand'); w.put(0, 62, 0, 'sand');
  assert.ok(U.sandRoof(w.blockAt, p), 'sand in the roof');
  assert.deepStrictEqual(U.nextDig(w.blockAt, p), {x: 0, y: 60, z: 0}, 'the lowest solid cell first');
  assert.deepStrictEqual(U.side(w.blockAt, p), {x: 0, y: 58, z: 1, dig: []}, 'the open cell beside');
  const stone = world();
  stone.put(0, 60, 0, 'stone'); stone.put(0, 61, 0, 'stone');
  assert.ok(!U.sandRoof(stone.blockAt, p), 'a stone roof is the walk\'s own business');
  stone.put(0, 62, 0, 'gravel');
  assert.ok(U.sandRoof(stone.blockAt, p), 'gravel on the stone roof');
  const shut = world();
  for (const [x, z] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) for (const y of [58, 59]) shut.put(x, y, z, 'stone');
  shut.put(1, 60, 0, 'sand'); // never dig a side with sand on it: it would fall into the bot's own cell
  assert.deepStrictEqual(U.side(shut.blockAt, p), {x: -1, y: 58, z: 0, dig: [{x: -1, y: 58, z: 0}, {x: -1, y: 59, z: 0}]}, 'a closed side is dug, not the one under sand');

  // the job: steps north, digs the sandstone (the sand falls into the column), digs the sand twice, done
  const dug = [], infos = [];
  const bot = {
    entity: {position: new Vec3(0.5, 58, 0.5)},
    blockAt: (q) => w.blockAt(q.x, q.y, q.z),
    dig: async (b) => {
      const me = bot.entity.position.floored();
      assert.ok(!(b.position.x === me.x && b.position.z === me.z), `never digs the column it stands in (${b.position})`);
      dug.push(`${b.name}${b.position.y}`);
      w.dig(b.position.x, b.position.y, b.position.z);
    },
  };
  const {unroof} = U.makeUnroof({
    goBlock: async (r, j, c) => { bot.entity.position = new Vec3(c.x + 0.5, c.y, c.z + 0.5); },
    guard: (j) => { if (j.cancelled) throw new Cancelled('stopped'); },
    sleep: async () => {}, unsafe: () => null, at: (c) => `${c.x} ${c.y} ${c.z}`,
  });
  assert.strictEqual(await unroof({bot, emit: (k, t) => infos.push(t)}, {t: {}, cancelled: false}), true);
  assert.deepStrictEqual(dug, ['sandstone60', 'sand58', 'sand58'], 'the roof from beside, then the fallen sand');
  assert.ok(!U.sandRoof(w.blockAt, p) && w.blockAt(0, 58, 0).name === 'air', 'the column is open');
  assert.ok(infos.some((t) => /dug the sand out of the roof over 0 58 0/.test(t)), infos.join('|'));
  // a stone roof: nothing to do here
  bot.entity.position = new Vec3(0.5, 58, 0.5);
  w = stone;
  w.put(0, 62, 0, 'stone');
  assert.strictEqual(await unroof({bot, emit: () => {}}, {t: {}, cancelled: false}), false);
  // water beside the roof: sealed first, then dug; without a seal the dig is refused
  for (const sealOk of [true, false]) {
    const wet = world();
    wet.put(0, 60, 0, 'sand'); wet.put(1, 60, 0, 'water');
    w = wet;
    bot.entity.position = new Vec3(0.5, 58, 0.5);
    dug.length = 0;
    let sealed = false;
    const {unroof: u2} = U.makeUnroof({
      goBlock: async (r, j, c) => { bot.entity.position = new Vec3(c.x + 0.5, c.y, c.z + 0.5); },
      guard: () => {}, sleep: async () => {}, at: (c) => `${c.x} ${c.y} ${c.z}`,
      unsafe: (b, q) => (!sealed && q.y === 60 ? 'water next to it' : null),
      seal: async () => (sealed = sealOk),
    });
    if (sealOk) { assert.strictEqual(await u2({bot, emit: () => {}}, {t: {}, cancelled: false}), true); assert.ok(dug.includes('sand60'), 'sealed, then dug: ' + dug); }
    else await assert.rejects(u2({bot, emit: () => {}}, {t: {}, cancelled: false}), /unsafe: water next to it/);
  }
  console.log('unroof: sand roof dug from beside ok');
})();

(async () => { // tools: never dig with a sword; a stone shovel for soil when the shovels are worn out (bot2, 2026-10-16)
  const assert = require('node:assert/strict');
  const {unarm} = require('../bots');
  const item = (name) => ({name});
  const mk = (held, items, empty) => {
    const calls = [];
    return {calls, bot: {heldItem: held && item(held), registry: {foodsByName: {bread: {}}},
      inventory: {items: () => items.map(item), emptySlotCount: () => empty},
      unequip: async (d) => calls.push(['unequip', d]), equip: async (it, d) => calls.push(['equip', it.name, d])}};
  };
  let t = mk('diamond_sword', ['diamond_sword', 'bread', 'dirt'], 1);
  await unarm(t.bot); assert.deepStrictEqual(t.calls, [['unequip', 'hand']], 'a free slot: empty hand');
  t = mk('diamond_sword', ['diamond_sword', 'stone_pickaxe', 'bread', 'dirt'], 0);
  await unarm(t.bot); assert.deepStrictEqual(t.calls, [['equip', 'dirt', 'hand']], 'full: a plain block, not a tool or food');
  t = mk('stone_shovel', ['stone_shovel'], 0);
  await unarm(t.bot); assert.deepStrictEqual(t.calls, [], 'a real tool stays');

  // The pathfinder digs its way with a tool only when it is faster than a hand, else with a plain block (bot50 dug
  // stone with its sword, sandbox 2026-10-18).
  const {pathTool} = require('../bots');
  const inv = (names) => ({entity: {effects: {}}, registry: {foodsByName: {bread: {}}}, inventory: {items: () => names.map((name, i) => ({name, type: i}))}});
  const firstItem = (b) => (bb) => b.inventory.items()[0];
  const block = (fast) => ({digTime: (type) => (type !== null && fast.includes(type) ? 400 : 7500)});
  let b = inv(['iron_sword', 'bread', 'cobblestone']);
  assert.strictEqual(pathTool(b, block([]), firstItem(b)).name, 'cobblestone', 'stone without a pickaxe: no sword');
  b = inv(['iron_sword', 'stone_pickaxe']);
  assert.strictEqual(pathTool(b, block([1]), (bb) => b.inventory.items()[1]).name, 'stone_pickaxe', 'a pickaxe that helps is used');
  assert.strictEqual(pathTool(b, block([0]), firstItem(b)).name, 'iron_sword', 'a sword where it is faster (cobweb)');
  assert.strictEqual(pathTool(b, block([]), firstItem(b)), null, 'only tools: none chosen');

  // the right tool, best first from what is carried (bot2 chopped by hand between wooden axes, 2026-10-19)
  const {toolsToMake} = require('../bots');
  const stack = (name, count = 1) => ({name, count});
  assert.deepStrictEqual(toolsToMake([stack('oak_log', 4), stack('cobblestone', 2)], 'axe'), ['wooden_axe'], 'too little stone: wood');
  assert.deepStrictEqual(toolsToMake([stack('oak_log', 4), stack('cobblestone', 6)], 'axe'), ['stone_axe', 'wooden_axe'], 'stone first, wood if that fails');
  assert.deepStrictEqual(toolsToMake([stack('stick', 2), stack('iron_ingot', 3), stack('cobblestone', 3)], 'pickaxe'), ['iron_pickaxe', 'stone_pickaxe'], 'iron before stone');
  assert.deepStrictEqual(toolsToMake([stack('wooden_axe'), stack('oak_planks', 2), stack('cobbled_deepslate', 3)], 'axe'), ['stone_axe'], 'a wooden one is replaced, not by wood');
  assert.deepStrictEqual(toolsToMake([stack('golden_shovel'), stack('stick', 2), stack('cobblestone')], 'shovel'), ['stone_shovel'], 'gold counts as wood');
  assert.deepStrictEqual(toolsToMake([stack('stone_axe'), stack('iron_ingot', 9), stack('stick', 9)], 'axe'), [], 'stone held: the iron stays for armour');
  assert.deepStrictEqual(toolsToMake([stack('iron_pickaxe'), stack('oak_log', 9)], 'axe'), ['wooden_axe'], 'a pickaxe is no axe');
  assert.deepStrictEqual(toolsToMake([stack('bread')], 'shovel'), [], 'nothing to make it from');
  // nothing mined under the base: 11 500 hollow cells beneath it (main server 2026-10-19)
  const {underBase} = require('../bots');
  const home = {x: -271, y: 66, z: -214};
  assert.deepStrictEqual([underBase(home, {x: -258, z: -196}), underBase(home, {x: -271, z: -160}), underBase(null, {x: 0, z: 0})], [true, false, false]);
  const {outOfBase} = require('../bots');
  const [ox, oz] = outOfBase(home, {x: -258, z: -210}, 4);
  assert.ok(!underBase(home, {x: ox, z: oz}) && Math.hypot(ox - home.x, oz - home.z) < 53 && ox > home.x && oz > home.z, `${ox} ${oz}`);
  assert.deepStrictEqual(outOfBase(home, home, 4), [home.x + 52, home.z]);
  const {shiftLeash} = require('../bots');
  // T04: the walk aims at the nearest free blocks, never at skipped ones, and at most k of them
  {
    const {topTargets} = require("../bots");
    const blocks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => ({x}));
    assert.deepStrictEqual(topTargets(blocks, (p) => p.x === 1 || p.x === 3, 3).map((p) => p.x), [2, 4, 5]);
    assert.deepStrictEqual(topTargets(blocks, () => true), []);
    assert.strictEqual(topTargets(blocks, () => false).length, 8, 'default k is 8');
  }
  assert.deepStrictEqual([shiftLeash(home, {x: -269, z: -211}, false), shiftLeash(home, {x: home.x + 100, z: home.z}, false), shiftLeash(home, {x: -269, z: -211}, true), shiftLeash(home, null, false)], [112, 64, 240, 64], 'a shift anchored under the base reaches past the circle');
  const {ensureTool} = require('../bots');
  const crafted = [], infos = [];
  let carried = [stack('cobblestone', 6), stack('stick', 4)];
  const r = {bot: {inventory: {items: () => carried}}, emit: (k, x) => infos.push(x)};
  const make = async (rr, j, it) => { crafted.push(it); };
  await ensureTool(r, {t: {}}, {material: 'mineable/pickaxe'}, make);
  assert.deepStrictEqual(crafted, ['stone_pickaxe'], 'stone without a pickaxe: one is made');
  await ensureTool(r, {t: {}}, {material: 'mineable/shovel'}, make);
  await ensureTool(r, {t: {}}, {material: 'plant;mineable/axe'}, make);
  assert.deepStrictEqual(crafted, ['stone_pickaxe', 'stone_shovel', 'stone_axe'], 'each kind on its own timer, any material string');
  await ensureTool(r, {t: {}}, {material: 'mineable/shovel'}, make);
  assert.equal(crafted.length, 3, 'not again within 2 min');
  await ensureTool(r, {t: {}}, {material: 'leaves;mineable/hoe'}, make);
  assert.equal(crafted.length, 3, 'no hoes');
  r.toolTriedAt = {}; carried = [stack('stone_shovel')];
  await ensureTool(r, {t: {}}, {material: 'mineable/shovel'}, make);
  assert.equal(crafted.length, 3, 'a stone shovel at hand: nothing to make');
  carried = [stack('cobblestone', 3), stack('oak_planks', 5)]; r.toolTriedAt = {};
  await ensureTool(r, {t: {}, cancelled: false}, {material: 'mineable/axe'}, async () => { throw new Error('no crafting table'); });
  assert.match(infos.at(-1), /^no axe made: no crafting table/, 'a failed craft is reported, the dig goes on');
  // bread from stored wheat (104 hungry bots in 48 h beside 106 stored wheat, 2026-10-16)
  const {storedBread} = require('../bots');
  let wheat = 0;
  const baked = [], said = [];
  const rb = {bot: {inventory: {items: () => (wheat ? [{name: 'wheat', count: wheat, type: 1}] : [])}, registry: {itemsByName: {wheat: {id: 1}}}}, emit: (k, x) => said.push(x)};
  await storedBread(rb, {t: {}}, {withdraw: async (rr, j, item, n) => { assert.equal(item, 'wheat'); wheat += Math.min(n, 7); }, bake: async (rr, j, n) => baked.push(n)});
  assert.deepStrictEqual(baked, [2], 'only 7 in store: 2 bread');
  wheat = 0; baked.length = 0;
  await storedBread(rb, {t: {}}, {withdraw: async () => { throw new Error('none'); }, bake: async (rr, j, n) => baked.push(n)});
  assert.deepStrictEqual(baked, [], 'none in store: nothing baked, no error');
  // iron for a bucket: stored raw iron smelted when no ingots are stored (bot3's dry wheat fields, 2026-10-16)
  const {ironIngots} = require('../bots');
  const inv2 = [];
  const add = (name, n) => { const e = inv2.find((i) => i.name === name) || (inv2.push({name, count: 0}), inv2.at(-1)); e.count += n; };
  const ri = {bot: {inventory: {items: () => inv2.filter((i) => i.count > 0)}}, supplyChest: {x: 0, y: 64, z: 0}};
  const store = {raw_iron: 39, coal: 5}, asked2 = [], smelted = [];
  const take2 = async (rr, j, item, n) => { asked2.push(item); if (!store[item]) throw new Error(`no ${item} in the chest`); const k = Math.min(n, store[item]); store[item] -= k; add(item, k); };
  await ironIngots(ri, {t: {}}, 3, {take: take2, smelt: async (rr, j, k) => { smelted.push(k); add('raw_iron', -k); add('iron_ingot', k); }});
  assert.deepStrictEqual([asked2, smelted], [['iron_ingot', 'raw_iron', 'coal'], [3]], 'ingots asked first, then raw iron and coal, smelted');
  asked2.length = 0;
  await ironIngots(ri, {t: {}}, 3, {take: take2, smelt: async () => smelted.push('again')});
  assert.deepStrictEqual(asked2, [], 'three ingots at hand: nothing to do');
  // shaft escape: the stair steps near a bot stranded inside the footprint (bot2 on old pillars, 2026-10-16)
  const {shaftSteps, stairRing} = require('../bots');
  const sa = {x1: -291, z1: -222, x2: -276, z2: -207, top: 80, bottom: -59};
  const sr = stairRing(sa.x1, sa.z1, sa.x2, sa.z2);
  assert.deepStrictEqual(shaftSteps(sr, sa, {x: -285, y: 47, z: -208}).slice(0, 2), [{x: -280, y: 47, z: -207}, {x: -281, y: 46, z: -207}], 'bot2 on the pillar at -285 46 -208: the steps of layers 46 and 45');
  assert.strictEqual(shaftSteps(sr, sa, {x: -285, y: 47, z: -208}).length, 4);
  assert.deepStrictEqual(shaftSteps(sr, sa, {x: -280, y: 47, z: -207}), [], 'on a step: nothing to escape');
  assert.deepStrictEqual(shaftSteps(sr, sa, {x: -300, y: 47, z: -208}), [], 'outside the shaft');
  // a perch with no way down: one more try with a longer fall, bounded by health (bot1 on a scaffold top, 2026-10-16)
  const {dropDown} = require('../bots');
  const mv = {maxDropDown: 4}, seen = [];
  const rp = {bot: {health: 20, pathfinder: {movements: mv}}};
  await dropDown(rp, async () => seen.push(mv.maxDropDown), new Error('No path'));
  assert.deepStrictEqual([seen, mv.maxDropDown], [[12], 4], 'up to 12 at full health, restored after');
  rp.bot.health = 9;
  await dropDown(rp, async () => seen.push(mv.maxDropDown), new Error('No path'));
  assert.deepStrictEqual(seen, [12, 6], '9 health: a 6-block fall leaves 6');
  rp.bot.health = 7;
  await assert.rejects(dropDown(rp, async () => seen.push('walked'), new Error('No path')), /No path/, 'too hurt: the walk fails as before');
  // support glass as the hoppers call for it (iron farm: 9 hoppers, not the sorter's 320 glass, 2026-10-16)
  const {supportStock} = require('../bots');
  const hop = (n) => ({targets: Array.from({length: n}, () => ({name: 'hopper'})).concat([{name: 'cobblestone'}])});
  assert.deepStrictEqual([supportStock(hop(9)).glass, supportStock(hop(40)).glass, supportStock(hop(347)).glass, supportStock(hop(0)).dirt], [16, 40, 320, 128]);
  {
    const {helpOnce, JOBS} = require('../bots');
    const needs = [
      {bot: 'bot1', item: 'dirt', count: 1, to: {x: 0, y: 1, z: 0}, t: 1},
      {bot: 'bot2', item: 'hopper', count: 80, to: {x: 1, y: 2, z: 3}, t: 2},
      {bot: 'bot4', item: 'iron_ingot', count: 3, to: {x: 4, y: 5, z: 6}, t: 3},
    ];
    const held = new Set(), calls = [];
    const world = {openNeeds: () => needs, claimedByOther: () => false, claim: async (_by, key) => !held.has(key) && (held.add(key), true), release: (_by, key) => held.delete(key)};
    const oldGet = JOBS.get, oldDeposit = JOBS.deposit;
    let limits = null;
    JOBS.get = async (r, j) => { limits = [r.digOnly, r.digBox]; calls.push(['get', j.args.item, j.args.count]); if (j.args.item === 'hopper') throw new Error('no route'); };
    JOBS.deposit = async (_r, j) => calls.push(['deposit', j.args.only, j.args.x]);
    const box = {x1: 0, z1: 0, x2: 8, z2: 8}, natural = new Set(['dirt']);
    const runner = {name: 'bot1', world, emit() {}, digOnly: natural, digBox: box}; // a wheat farmer helping
    const parent = {type: 'help', args: {}, cancelled: false};
    try {
      assert.strictEqual(await helpOnce(runner, parent), true);
      assert.deepStrictEqual(calls, [['get', 'hopper', 64]], 'oldest other bot is tried, capped at 64; own need is ignored');
      calls.length = 0;
      assert.strictEqual(await helpOnce(runner, parent), true);
      assert.deepStrictEqual(calls, [['get', 'iron_ingot', 3], ['deposit', 'iron_ingot', 4]], 'failed need rests while the next one is served');
      assert.deepStrictEqual(limits, [null, null], 'the help digs outside the farm box');
      assert.deepStrictEqual([runner.digOnly, runner.digBox], [natural, box], 'and the farm limits come back');
      // what the planner cannot make (soul sand, the owner's part) is passed over without a try
      const {Vec3} = require('vec3');
      const helper = {name: 'bot3', world: {...world, chests: new Map(), openNeeds: () => [
        {bot: 'bot2', item: 'soul_sand', count: 4, to: {x: 1, y: 2, z: 3}, t: 1}, {bot: 'bot2', item: 'iron_ingot', count: 5, to: {x: 1, y: 2, z: 3}, t: 2}]},
      emit() {}, acquireFailed: new Map(), protectedAreas: [], bot: {entity: {position: new Vec3(0, 64, 0)}, registry: require('minecraft-data')('26.1'),
        inventory: {items: () => [{name: 'iron_ingot', count: 5}]}, findBlock: () => null, findBlocks: () => [], world: {getColumn: () => null}, nearestEntity: () => null}};
      calls.length = 0;
      assert.strictEqual(await helpOnce(helper, parent), true);
      assert.deepStrictEqual(calls, [['deposit', 'iron_ingot', 1]], 'soul sand skipped, the iron it carries delivered without a get');
    } finally { JOBS.get = oldGet; JOBS.deposit = oldDeposit; }
  }
  console.log('tools: no sword digging, shovel replaced ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
