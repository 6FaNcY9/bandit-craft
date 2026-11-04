'use strict';
// The road's geometry and what a block means to it (road.js): pure, no bot.
const assert = require('node:assert');
const {cell, isDip, railHeight, crossSection, isBoosterSlot, niche, mayEndAt, onRoad, FIRST_RAIL, RAMP_BOOSTERS, RAMP_CELLS, BORDER_K} = require('../road');

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
// A cell left half built by a death or a restart reads as the bot's own, there and nowhere else.
assert.strictEqual(inspect(world({'16,0,1': 'cobbled_deepslate'}), east, 16, 32).stop, null, 'a wall it lined');
assert.strictEqual(inspect(world({'16,0,0': 'cobblestone'}), east, 16, 32).stop, null, 'a block in the road for a moment');
assert.strictEqual(inspect(world({'16,0,1': 'redstone_torch'}), east, 16, 32).stop, null, 'a booster half laid');
assert.strictEqual(inspect(world({'17,0,1': 'cobblestone'}), east, 16, 32).stop.why, 'player', 'the next cell is not its own');
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
