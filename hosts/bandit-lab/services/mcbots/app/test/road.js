'use strict';
// The road's geometry and what a block means to it (road.js): pure, no bot.
const assert = require('node:assert');
const {originPlan, readOrigin, mayBuildAt, DIRS, cell, isDip, railHeight, crossSection, isBoosterSlot, niche, mayEndAt, onRoad, FIRST_RAIL, RAMP_BOOSTERS, RAMP_CELLS, BORDER_K} = require('../road');

const O = {x: 0, y: 0, z: 0};
const east = {dir: 'east', origin: O}, west = {dir: 'west', origin: O}, south = {dir: 'south', origin: O}, north = {dir: 'north', origin: O};

assert.deepStrictEqual(cell(east, 5, 1, -1), {x: 5, y: 1, z: -1});
assert.deepStrictEqual(cell(west, 5), {x: -5, y: 0, z: 0});
assert.deepStrictEqual(cell(south, 5), {x: 0, y: 0, z: 5});
assert.deepStrictEqual(cell(north, 5), {x: 0, y: 0, z: -5});
assert.deepStrictEqual(cell({dir: 'east', origin: {x: 100, y: 200, z: 300}}, 5, 1), {x: 105, y: 201, z: 300}, 'from any origin');
// Side 1 is the same hand on every road, so a niche never swaps sides along one road.
for (const road of [east, west, south, north]) {
  const [a, b] = [cell(road, 5, 0, 1), cell(road, 6, 0, 1)];
  assert.strictEqual(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), 1, road.dir);
  assert.strictEqual(Math.abs(a.x) + Math.abs(a.z), 6, `${road.dir}: one to the side`);
}

// A dip is two cells in every 16.
assert.deepStrictEqual([7, 8, 9, 10, 23, 24, 25, 26].map(isDip), [false, true, true, false, false, true, true, false]);
assert.deepStrictEqual([7, 8, 9, 10].map(railHeight), [0, -1, -1, 0]);

const flat = crossSection(east, 7), dip = crossSection(east, 8);
assert.deepStrictEqual(flat.rail, {x: 7, y: 0, z: 0});
assert.deepStrictEqual(dip.rail, {x: 8, y: -1, z: 0});
assert.deepStrictEqual([flat.air.length, flat.solid.length], [2, 6], 'two air, floor, roof, four walls');
assert.deepStrictEqual([dip.air.length, dip.solid.length], [3, 8], 'three air, floor one lower, roof, six walls');
assert.ok(flat.solid.some((c) => c.y === -1 && c.z === 0), 'flat floor');
assert.ok(flat.solid.some((c) => c.y === 2 && c.z === 0), 'flat roof');
assert.ok(dip.solid.some((c) => c.y === -2 && c.z === 0), 'dip floor');
assert.ok(dip.solid.some((c) => c.y === 2 && c.z === 0), 'the dip keeps the same roof');
assert.ok(dip.solid.some((c) => c.y === -1 && c.z === 1) && dip.solid.some((c) => c.y === -1 && c.z === -1), 'dip walls go down with it');
assert.ok(dip.air.some((c) => c.y === -1) && dip.air.some((c) => c.y === 1), 'a dip is three high inside');
const cells = (o) => [...o.air, ...o.solid].map((c) => `${c.x},${c.y},${c.z}`);
assert.strictEqual(new Set(cells(dip)).size, cells(dip).length, 'no cell twice');

// Boosters avoid dips: three in every 16, so a ramp of 48 takes 256 cells.
assert.deepStrictEqual(Array.from({length: 16}, (_, k) => k).filter(isBoosterSlot), [0, 4, 12]);
assert.strictEqual(RAMP_BOOSTERS, 48);
assert.strictEqual(Array.from({length: RAMP_CELLS}, (_, k) => k).filter(isBoosterSlot).length, RAMP_BOOSTERS);
assert.deepStrictEqual(niche(east, 12), cell(east, 12, 0, 1));

// The rail ends only with the last dip far enough back, and with a flat cell to land on.
assert.ok(!mayEndAt(7), 'the landing would be a dip');
assert.ok(!mayEndAt(8) && !mayEndAt(9), 'in a dip');
assert.ok(!mayEndAt(10) && !mayEndAt(11), 'too close behind one');
assert.ok(mayEndAt(12) && mayEndAt(15) && mayEndAt(16) && mayEndAt(22), 'far enough behind one');

assert.deepStrictEqual(onRoad(east, {x: 40.5, y: 0, z: 0.5}), {k: 40, side: 0, h: 0});
assert.deepStrictEqual(onRoad(west, {x: -40.5, y: 0.06, z: 0.5}), {k: 41, side: 0, h: 0}, 'a cell is named by its low corner');
assert.deepStrictEqual(onRoad(north, {x: 0.5, y: -1, z: -39.5}), {k: 40, side: 0, h: -1}, 'in a dip');
assert.strictEqual(onRoad(east, {x: 40.5, y: 0, z: 9.5}), null, 'beside it');
assert.strictEqual(onRoad(east, {x: -40.5, y: 0, z: 0.5}), null, 'behind the origin');
assert.strictEqual(onRoad(east, {x: 40.5, y: 61, z: 0.5}), null, 'above it');

assert.strictEqual(FIRST_RAIL, 5);
assert.strictEqual(BORDER_K, 29999984);

// ---- what a block is, and what a segment holds ----
const {kindOf, inspect, isOpen, checkCell, railShape, railFits} = require('../road');

for (const n of ['stone', 'deepslate', 'tuff', 'deepslate_iron_ore', 'moss_block', 'sculk', 'sculk_vein', 'pointed_dripstone', 'obsidian', 'amethyst_block', 'budding_amethyst', 'magma_block', 'hanging_roots']) assert.strictEqual(kindOf(n), 'natural', n);
for (const n of ['air', 'cave_air', 'void_air']) assert.strictEqual(kindOf(n), 'air', n);
for (const n of ['gravel', 'sand', 'red_sand']) assert.strictEqual(kindOf(n), 'falling', n);
for (const n of ['water', 'lava', 'bubble_column']) assert.strictEqual(kindOf(n), 'fluid', n);
for (const n of ['oak_planks', 'oak_fence', 'rail', 'cobweb', 'chiseled_tuff', 'tuff_bricks', 'waxed_copper_block', 'oxidized_cut_copper', 'copper_grate']) assert.strictEqual(kindOf(n), 'structure', n);
for (const n of ['chest', 'trapped_chest', 'barrel', 'hopper', 'spawner', 'trial_spawner', 'vault', 'dispenser', 'dropper']) assert.strictEqual(kindOf(n), 'keep', n);
assert.strictEqual(kindOf('sculk_shrieker'), 'danger');
for (const n of ['torch', 'wall_torch', 'cobblestone', 'cobblestone_stairs', 'white_bed', 'oak_sign', 'powered_rail', 'stone_bricks', 'crafting_table', 'redstone_torch', 'cobbled_deepslate', 'decorated_pot']) assert.strictEqual(kindOf(n), 'player', n);

// A world of stone, with one thing put in per case: null is a chunk not loaded.
const world = (put = {}) => (x, y, z) => {
  const key = `${x},${y},${z}`;
  return key in put ? (put[key] && {name: put[key], boundingBox: /torch/.test(put[key]) ? 'empty' : 'block'}) : {name: 'stone'};
};
assert.strictEqual(inspect(world(), east, 16, 32).stop, null);
assert.strictEqual(inspect(world({'20,3,3': 'torch'}), east, 16, 32).stop.why, 'player', 'within 3 blocks');
assert.deepStrictEqual(inspect(world({'20,3,3': 'torch'}), east, 16, 32).stop.at, {x: 20, y: 3, z: 3});
assert.strictEqual(inspect(world({'20,3,3': 'torch'}), east, 16, 32).stop.name, 'torch');
assert.strictEqual(inspect(world({'20,3,4': 'torch'}), east, 16, 32).stop, null, 'one further to the side');
assert.strictEqual(inspect(world({'20,5,0': 'torch'}), east, 16, 32).stop, null, 'above what it looks at');
assert.strictEqual(inspect(world({'20,4,0': 'torch'}), east, 16, 32).stop.why, 'player', 'as high as it looks');
assert.strictEqual(inspect(world({'20,-3,0': 'torch'}), east, 16, 32).stop.why, 'player', 'as low as it looks');
assert.strictEqual(inspect(world({'20,-4,0': 'torch'}), east, 16, 32).stop, null, 'below what it looks at');
assert.strictEqual(inspect(world({'35,0,0': 'torch'}), east, 16, 32).stop.why, 'player', '3 ahead');
assert.strictEqual(inspect(world({'36,0,0': 'torch'}), east, 16, 32).stop, null, '4 ahead');
assert.strictEqual(inspect(world({'15,0,0': 'torch'}), east, 16, 32).stop, null, 'behind is the road already built');
assert.strictEqual(inspect(world({'20,0,0': 'chest'}), east, 16, 32).stop.why, 'keep', 'in the road');
assert.strictEqual(inspect(world({'24,-1,0': 'barrel'}), east, 16, 32).stop.why, 'keep', 'in a dip, one lower');
assert.strictEqual(inspect(world({'20,-1,0': 'chest'}), east, 16, 32).stop, null, 'in the floor of a flat cell: it stays, the road is not stopped');
assert.strictEqual(inspect(world({'20,0,2': 'chest'}), east, 16, 32).stop, null, 'a chest beside the road stays and does not stop it');
assert.strictEqual(inspect(world({'20,0,0': 'oak_planks'}), east, 16, 32).stop, null, 'a mineshaft is dug through');
assert.strictEqual(inspect(world({'20,2,0': 'sculk_shrieker'}), east, 16, 32).stop.why, 'danger');
assert.strictEqual(inspect(world({'20,0,3': 'sculk_shrieker'}), east, 16, 32).stop.why, 'danger', 'near, not only in the cells');
assert.strictEqual(inspect(world({'20,0,0': null}), east, 16, 32).stop.why, 'unloaded');
assert.strictEqual(inspect(world({'20,0,1': 'water'}), east, 16, 32).stop, null, 'a fluid is no stop');
assert.strictEqual(inspect(world({'20,2,0': 'cave_air'}), east, 16, 32).stop, null, 'a cave is no stop');
// Cells left half built by a death, a restart or a stop read as the bot's own, there and nowhere else.
assert.strictEqual(inspect(world({'16,0,1': 'cobbled_deepslate'}), east, 16, 32).stop, null, 'a wall it lined');
assert.strictEqual(inspect(world({'16,0,0': 'cobblestone'}), east, 16, 32).stop, null, 'a block in the road for a moment');
assert.strictEqual(inspect(world({'16,0,1': 'redstone_torch'}), east, 16, 32).stop, null, 'a booster half laid');
assert.strictEqual(inspect(world({'18,0,1': 'cobblestone'}), east, 16, 32).stop, null, 'a stop took the rail back past what it lined (east, 465 m)');
assert.strictEqual(inspect(world({'23,0,1': 'cobblestone'}), east, 16, 32).stop, null, 'as far as a stop can take it');
assert.strictEqual(inspect(world({'24,0,1': 'cobblestone'}), east, 16, 32).stop.why, 'player', 'past that it is not its own');
assert.strictEqual(inspect(world({'16,0,3': 'cobblestone'}), east, 16, 32).stop.why, 'player', 'nor beside it');
assert.strictEqual(inspect(world({'16,0,1': 'torch'}), east, 16, 32).stop.why, 'player', 'nor anything else');
// The same on another road, to show nothing is east only.
assert.strictEqual(inspect(world({'3,0,-20': 'torch'}), north, 16, 32).stop.why, 'player');
assert.strictEqual(inspect(world({'4,0,-20': 'torch'}), north, 16, 32).stop, null);

// ---- a finished cell ----
assert.ok(isOpen({name: 'air'}) && isOpen({name: 'water'}) && isOpen({name: 'gravel'}) && isOpen({name: 'short_grass', boundingBox: 'empty'}));
assert.ok(!isOpen({name: 'deepslate', boundingBox: 'block'}) && !isOpen({name: 'cobblestone', boundingBox: 'block'}) && !isOpen({name: 'oak_fence', boundingBox: 'block'}));
const built = (road, k, put = {}) => {
  const {air, rail} = crossSection(road, k), blocks = {};
  for (const c of air) blocks[`${c.x},${c.y},${c.z}`] = 'air';
  blocks[`${rail.x},${rail.y},${rail.z}`] = 'rail';
  return world({...blocks, ...put});
};
assert.deepStrictEqual(checkCell(built(east, 7), east, 7), [], 'flat');
assert.deepStrictEqual(checkCell(built(east, 8), east, 8), [], 'dip');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,0,0': 'powered_rail'}), east, 7), [], 'a booster is a rail');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,0,0': 'air'}), east, 7), ['air at 7 0 0'], 'no rail');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,1,0': 'stone'}), east, 7), ['stone at 7 1 0'], 'no headroom');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,-1,0': 'air'}), east, 7), ['air at 7 -1 0'], 'no floor');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,2,0': 'gravel'}), east, 7), ['gravel at 7 2 0'], 'a roof that falls');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,1,1': 'water'}), east, 7), ['water at 7 1 1'], 'a leak');
assert.deepStrictEqual(checkCell(built(east, 12, {'12,0,1': 'redstone_torch'}), east, 12), [], 'a booster\'s torch in its niche');
assert.deepStrictEqual(checkCell(built(east, 12, {'12,0,1': 'air'}), east, 12), ['air at 12 0 1'], 'an empty niche is a hole');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,0,1': 'redstone_torch'}), east, 7), ['redstone_torch at 7 0 1'], 'no slot here');
assert.deepStrictEqual(checkCell(built(east, 7, {'7,0,-1': null}), east, 7), ['not loaded at 7 0 -1']);

// Rails: the shape once its neighbours lie, the same in road order on every road (measured east and north).
assert.deepStrictEqual([7, 8, 9, 10].map((k) => railShape(east, k)), ['east_west', 'ascending_west', 'ascending_east', 'east_west']);
assert.deepStrictEqual([7, 8, 9, 10].map((k) => railShape(north, k)), ['north_south', 'ascending_south', 'ascending_north', 'north_south']);
assert.deepStrictEqual([8, 9].map((k) => railShape(west, k)), ['ascending_east', 'ascending_west']);
assert.deepStrictEqual([8, 9].map((k) => railShape(south, k)), ['ascending_north', 'ascending_south']);
const shaped = (shape) => ({name: 'rail', getProperties: () => ({shape})});
assert.ok(railFits(shaped('east_west'), east) && railFits(shaped('ascending_west'), east) && railFits({name: 'rail'}, east));
assert.ok(!railFits(shaped('north_south'), east) && !railFits(shaped('north_east'), east) && !railFits(shaped('east_west'), north));
const withRail = (k, shape) => (x, y, z) => (y === (k % 16 === 8 || k % 16 === 9 ? -1 : 0) && z === 0 ? shaped(shape) : built(east, k)(x, y, z));
assert.deepStrictEqual(checkCell(withRail(7, 'east_west'), east, 7), []);
assert.deepStrictEqual(checkCell(withRail(7, 'north_south'), east, 7), ['rail north_south at 7 0 0'], 'across the road');
assert.deepStrictEqual(checkCell(withRail(8, 'east_west'), east, 8), ['rail east_west at 8 -1 0'], 'a dip that does not slope');

// ---- the road's end, read from the blocks ----
const {findHead} = require('../road');
const railed = (to, put = {}) => { const out = {}; for (let k = FIRST_RAIL; k <= to; k++) out[k % 16 === 8 || k % 16 === 9 ? `${k},-1,0` : `${k},0,0`] = 'rail'; return world({...out, ...put}); };
assert.deepStrictEqual(findHead(railed(40), east, 20), {head: 40, open: false}, 'forward from where it stands');
assert.deepStrictEqual(findHead(railed(40), east, 41), {head: 40, open: false}, 'back from the landing');
assert.deepStrictEqual(findHead(railed(40), east, 46), {head: 40, open: false}, 'back over rails taken up');
assert.deepStrictEqual(findHead(railed(40, {'24,-1,0': 'powered_rail'}), east, 20), {head: 40, open: false}, 'through anything that is a rail');
assert.deepStrictEqual(findHead(railed(40), east, FIRST_RAIL), {head: 40, open: false}, 'from the first rail');
assert.deepStrictEqual(findHead(world(), east, 20), {head: FIRST_RAIL - 1, open: false}, 'a road with no rail yet: nothing within 64 back');
assert.deepStrictEqual(findHead(world(), east, 3), {head: FIRST_RAIL - 1, open: false});
assert.deepStrictEqual(findHead(railed(40, {'30,0,0': null}), east, 20), {head: 29, open: true}, 'the chunk ends the reading, not the road');

// ---- the origin ----
{
  const plan = originPlan(O), key = (c) => `${c.x},${c.y},${c.z}`;
  const room = new Set(plan.room.map(key)), curbs = new Set(plan.curbs.map(key));
  assert.strictEqual(plan.room.filter((c) => Math.abs(c.x) <= 2 && Math.abs(c.z) <= 2 && c.y >= 0 && c.y <= 3).length, 100, 'the room');
  // the stair has three air cells a step, and rises one a step
  assert.deepStrictEqual(plan.stair[0].air[0], {x: 2, y: 0, z: -3}, 'it leaves the room on its north side');
  plan.stair.forEach((s, i) => {
    assert.deepStrictEqual(s.air, [0, 1, 2].map((h) => ({...s.air[0], y: s.air[0].y + h})));
    assert.deepStrictEqual(s.floor, {...s.air[0], y: s.air[0].y - 1});
    if (!i) return;
    const a = plan.stair[i - 1].air[0], b = s.air[0];
    assert.strictEqual(Math.abs(a.x - b.x) + Math.abs(a.z - b.z), 1, 'one over');
    assert.ok(b.y - a.y === 0 || b.y - a.y === 1, 'one up at most');
  });
  // each road's first rail is at k 5, its curb at 3
  for (const dir of Object.keys(DIRS)) {
    const road = {dir, origin: O};
    assert.ok(curbs.has(key(cell(road, 3))), `${dir}: curb`);
    for (const c of [cell(road, 3, 1), cell(road, 3, 2), cell(road, 4), cell(road, 4, 1), cell(road, 4, 2)]) assert.ok(room.has(key(c)), `${dir}: open over the curb and on the landing ${key(c)}`);
    assert.ok(!room.has(key(cell(road, 3))), `${dir}: the curb stays`);
    assert.ok(!room.has(key(cell(road, FIRST_RAIL))), `${dir}: the rail's cell is the road's`);
    assert.strictEqual(FIRST_RAIL, 5);
    // no stair cell within 3 of a road beyond k 8: inspect would take it for something in the road
    const d = DIRS[dir];
    for (const s of plan.stair) for (const c of s.air) {
      const k = c.x * d.dx + c.z * d.dz, side = c.x * d.sx + c.z * d.sz;
      assert.ok(k < 8 || Math.abs(side) > 3, `${dir}: ${key(c)} k ${k} side ${side}`);
    }
  }
  // what is there: from the sky down to the first step with anything in it
  const worldOf = (sky, put = {}) => (x, y, z) => {
    const k = `${x},${y},${z}`;
    if (k in put) return put[k] && {name: put[k], boundingBox: /air|wildflowers/.test(put[k]) ? 'empty' : 'block'};
    return x >= 2 + sky || y > 100 ? {name: 'air', boundingBox: 'empty'} : {name: 'deepslate', boundingBox: 'block'};
  };
  const read = (s, put) => readOrigin(worldOf(s, put), plan);
  assert.strictEqual(read(10).top, 3 + 10 - 1, 'corridor of 3 and steps up to the open air');
  assert.strictEqual(read(10).done, false);
  assert.deepStrictEqual(read(10, {[key(plan.stair[12].air[1])]: 'wildflowers'}).stop, undefined, 'a plant is no building');
  const inWay = key(plan.stair[5].air[1]), st = read(10, {[inWay]: 'oak_stairs'}).stop;
  assert.deepStrictEqual([st.name, key(st.at)], ['oak_stairs', inWay]);
  assert.strictEqual(read(10, {[key(plan.room[0])]: 'chest'}).stop.name, 'chest');
  assert.strictEqual(read(10, {[key(plan.stair[20].air[0])]: null}).unloaded, true, 'a chunk not there is not air');
  assert.strictEqual(read(10, {[key(plan.room[1])]: 'water'}).stop.name, 'water', 'a flooded chamber is not dug');
  // all dug, the curbs left standing
  const dug = {}; for (const c of plan.room) dug[key(c)] = 'air'; for (const s of plan.stair) for (const c of s.air) dug[key(c)] = 'air';
  assert.deepStrictEqual(readOrigin(worldOf(1000, dug), plan), {top: 0, done: true});
  // the exception to the protected box opens only its own cells
  const may = mayBuildAt(plan, O), s30 = plan.stair[33].air[0];
  assert.strictEqual(s30.y, 31);
  assert.deepStrictEqual([may({x: 40, y: 6, z: 3}), may({x: 40, y: 7, z: 3}), may(s30), may(plan.stair[33].floor), may({...s30, z: s30.z - 1})], [true, false, true, true, false]);
  assert.deepStrictEqual([may({x: 40, y: 6, z: 4}), may({x: -3, y: 6, z: -60}), may({x: 2, y: 0, z: 2})], [false, true, true], 'at y 6 only what a road can touch: not the whole box');
}

// Read off the first 2 km east on the sandbox: vines in a cave at k 555 stopped the road as a player's block.
assert.strictEqual(kindOf('vine'), 'natural');

{ // the load: a farm of iron has no table to craft rails at, so the table comes before the rails, and everything in it has a farm
  const {loadFor: load, FARMS: farms} = require('../road');
  const keys = Object.keys(load(undefined, 1));
  assert.ok(keys.includes('crafting_table') && keys.indexOf('crafting_table') < keys.indexOf('rail'), 'a table before the rails');
  for (const item of keys) assert.ok(farms.some((f) => f.items.includes(item)), `${item} has a farm`);
  const one = new Set(['iron_pickaxe', 'iron_sword', 'minecart']), slots = (l) => Object.entries(l).reduce((n, [item, c]) => n + (one.has(item) ? c : Math.ceil(c / 64)), 0);
  assert.ok(slots(load(undefined)) <= 32, `a first load leaves room for what walking picks up, and a chest gives nothing to full bags: ${slots(load(undefined))}`);
  assert.ok(slots(load(5000)) <= 32, 'and a later one for the old ramp');
  const at = (item) => farms.findIndex((f) => f.items.includes(item));
  assert.ok(at('stick') < farms.findIndex((f) => f.x === -307) && at('crafting_table') < farms.findIndex((f) => f.x === -307), 'the round brings sticks and a table to the iron');
}

{ // nobody fetches from the owner's house at spawn: iron doors no bot can open, and a pit behind them. Bread comes from the wheat in the bots' own hall
  const {FARMS: farms} = require('../road');
  assert.ok(!farms.some((f) => f.x === 23 && f.z === 55));
  assert.deepStrictEqual(farms.filter((f) => f.items.includes('bread')).map((f) => f.x), [-263]);
}

{ // a stair through a cave: air is not a step until it has a floor, or a restart walks past steps that were never built
  const {originPlan: plan_, readOrigin: read_} = require('../road');
  const plan = plan_({x: 0, y: 0, z: 0});
  const solid = {name: 'stone', boundingBox: 'block'}, air = {name: 'air', boundingBox: 'empty'};
  const open = new Set(), key = (c) => `${c.x},${c.y},${c.z}`;
  plan.stair.forEach((s, i) => { if (i >= 50) s.air.forEach((c) => open.add(key(c))); if (i >= 64 || (i >= 50 && i <= 53)) open.add(key(s.floor)); });
  const at = (x, y, z) => (open.has(key({x, y, z})) ? air : solid);
  assert.strictEqual(read_(at, plan).top, 54, 'dug down to step 54, and the cave below it has no floors yet');
}
