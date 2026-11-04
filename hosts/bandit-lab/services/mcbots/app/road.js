'use strict';
// A highway's geometry and what a block means to it: pure, tested in test/road.js. A road runs from its origin in one of
// the four directions; k is the distance from the origin. roadjob.js wires this to a bot.

// `s` is the same hand on every road: side 1 of an east road is +z.
const DIRS = {
  east: {dx: 1, dz: 0, sx: 0, sz: 1},
  west: {dx: -1, dz: 0, sx: 0, sz: -1},
  south: {dx: 0, dz: 1, sx: -1, sz: 0},
  north: {dx: 0, dz: -1, sx: 1, sz: 0},
};

const FIRST_RAIL = 5; // behind the chamber: curb at 3, landing at 4
const RAMP_BOOSTERS = 48; // measured: reaches 81 to 89 m/s, and the dips take over from there
const RAMP_CELLS = 256; // what 48 of isBoosterSlot's take
const BORDER_K = 29999984;
const FLAT_BEFORE_END = 3; // rails between the last dip and the rail's end: measured, fewer not tried (runbook)

function cell({dir, origin}, k, h = 0, side = 0) {
  const d = DIRS[dir];
  return {x: origin.x + d.dx * k + d.sx * side, y: origin.y + h, z: origin.z + d.dz * k + d.sz * side};
}

// Two rails one lower in every 16 keep the speed: a slope rail adds more than the flat ones lose.
const isDip = (k) => k % 16 === 8 || k % 16 === 9;
const railHeight = (k) => (isDip(k) ? -1 : 0);

function crossSection(road, k) {
  const low = railHeight(k);
  const air = [], solid = [cell(road, k, low - 1), cell(road, k, 2)];
  for (let h = low; h <= 1; h++) air.push(cell(road, k, h));
  for (let h = low; h <= 1; h++) solid.push(cell(road, k, h, -1), cell(road, k, h, 1));
  return {air, solid, rail: cell(road, k, low)};
}

const isBoosterSlot = (k) => [0, 4, 12].includes(k % 16);
const niche = (road, k) => cell(road, k, 0, 1); // the wall cell beside the rail: a redstone torch in it powers the booster

function mayEndAt(k) {
  if (isDip(k) || isDip(k + 1)) return false;
  for (let back = 1; back < FLAT_BEFORE_END; back++) if (isDip(k - back)) return false;
  return true;
}

function onRoad({dir, origin}, pos) {
  const d = DIRS[dir];
  const [x, y, z] = [Math.floor(pos.x) - origin.x, Math.floor(pos.y) - origin.y, Math.floor(pos.z) - origin.z];
  const k = x * d.dx + z * d.dz + 0, side = x * d.sx + z * d.sz + 0; // + 0: no -0 out of a zero direction
  return k >= 0 && Math.abs(side) <= 1 && y >= -2 && y <= 2 ? {k, side, h: y} : null;
}

// What a job may dig as plain ground. Moved here from bots.js as it was: the jobs there use it too.
const NATURAL = /^(stone|deepslate|dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mud|clay|gravel|sand|red_sand|andesite|diorite|granite|tuff|calcite|dripstone_block|[a-z_]*_ore|short_grass|tall_grass|fern|large_fern|[a-z_]*_flower|dandelion|poppy|wildflowers|moss_block|moss_carpet|glow_lichen|cave_vines|cave_vines_plant)$/;
const ROCK = /^(obsidian|smooth_basalt|magma_block|pointed_dripstone|infested_[a-z_]+|raw_[a-z]+_block|amethyst_block|budding_amethyst|[a-z]+_amethyst_bud|amethyst_cluster|sculk|sculk_vein|sculk_catalyst|sculk_sensor|hanging_roots|azalea|flowering_azalea|azalea_leaves|flowering_azalea_leaves|spore_blossom|big_dripleaf|big_dripleaf_stem|small_dripleaf|brown_mushroom|red_mushroom|seagrass|tall_seagrass|kelp|kelp_plant|ice|packed_ice|blue_ice)$/;
const STRUCTURE = /^([a-z_]+_planks|[a-z_]+_fence|rail|cobweb|tuff_[a-z_]+|chiseled_tuff[a-z_]*|polished_tuff[a-z_]*|(waxed_)?((exposed|weathered|oxidized)_)?(chiseled_|cut_)?copper(_[a-z_]+)?|(waxed_)?((exposed|weathered|oxidized)_)?cut_copper[a-z_]*)$/;
const KEEP = /^(chest|trapped_chest|barrel|hopper|spawner|trial_spawner|vault|dispenser|dropper)$/;

// The spec's three lists, in the order that decides. Anything not named counts as a player's.
function kindOf(name) {
  if (/^(air|cave_air|void_air)$/.test(name)) return 'air';
  if (/^(water|lava|bubble_column|flowing_water|flowing_lava)$/.test(name)) return 'fluid';
  if (/^(gravel|sand|red_sand)$/.test(name)) return 'falling';
  if (name === 'sculk_shrieker') return 'danger';
  if (KEEP.test(name)) return 'keep';
  if (STRUCTURE.test(name)) return 'structure';
  if (NATURAL.test(name) || ROCK.test(name)) return 'natural';
  return 'player';
}

const LOOK_SIDE = 3, LOOK_AHEAD = 3, LOOK_LOW = -3, LOOK_HIGH = 4;
const LINING = /^(cobbled_deepslate|cobblestone)$/; // what digging deepslate and stone yields without Silk Touch
// A bot that died or restarted halfway through a cell left these in it, and they must not read as a player's.
const OWN = /^(cobbled_deepslate|cobblestone|redstone_torch|powered_rail)$/;
const OPPOSITE = {east: 'west', west: 'east', south: 'north', north: 'south'};
const key = ({x, y, z}) => `${x},${y},${z}`;

// What cells fromK..toK hold, before a bot digs them. blockAt(x, y, z) gives {name}, or null where no chunk is loaded.
function inspect(blockAt, road, fromK, toK) {
  const named = ({x, y, z}) => blockAt(x, y, z)?.name;
  const {air, solid} = crossSection(road, fromK), halfBuilt = new Set([...air, ...solid].map(key));
  for (let k = fromK; k <= toK + LOOK_AHEAD; k++) {
    for (let side = -LOOK_SIDE; side <= LOOK_SIDE; side++) {
      for (let h = LOOK_LOW; h <= LOOK_HIGH; h++) {
        const at = cell(road, k, h, side), name = named(at);
        if (name === undefined) return {stop: {why: 'unloaded', at, name: null}};
        const kind = kindOf(name);
        if (kind === 'player' && OWN.test(name) && halfBuilt.has(key(at))) continue;
        if (kind === 'player' || kind === 'danger') return {stop: {why: kind, at, name}};
      }
    }
  }
  for (let k = fromK; k <= toK; k++) {
    for (const at of crossSection(road, k).air) {
      const name = named(at);
      if (kindOf(name) === 'keep') return {stop: {why: 'keep', at, name}};
    }
  }
  return {stop: null};
}

// What a road's wall, floor or roof cannot be: it lets water or mobs through, or falls.
const isOpen = (b) => ['air', 'fluid', 'falling'].includes(kindOf(b.name)) || b.boundingBox === 'empty';

// The shape a rail has once its neighbours lie: the rail last placed may still differ, so a check of it means little.
function railShape({dir}, k) {
  if (k % 16 === 8) return `ascending_${OPPOSITE[dir]}`;
  if (k % 16 === 9) return `ascending_${dir}`;
  return DIRS[dir].dx ? 'east_west' : 'north_south';
}
// A rail lying across the road, a mineshaft's: it has to go. No shape known (a test's plain block) counts as fitting.
function railFits(b, {dir}) {
  const shape = b.getProperties?.().shape;
  return !shape || (DIRS[dir].dx ? /^(east_west|ascending_east|ascending_west)$/ : /^(north_south|ascending_north|ascending_south)$/).test(shape);
}

// What is wrong with a finished cell: nothing, or a list of what and where.
function checkCell(blockAt, road, k) {
  const out = [], {air, solid, rail} = crossSection(road, k);
  const at = ({x, y, z}) => blockAt(x, y, z);
  const here = (c) => `${c.x} ${c.y} ${c.z}`;
  const niched = isBoosterSlot(k) && niche(road, k);
  for (const c of air) {
    const b = at(c), isRail = c.x === rail.x && c.y === rail.y && c.z === rail.z;
    if (!b) out.push(`not loaded at ${here(c)}`);
    else if (isRail ? !/rail$/.test(b.name) : kindOf(b.name) !== 'air') out.push(`${b.name} at ${here(c)}`);
    else if (isRail && (b.getProperties?.().shape ?? railShape(road, k)) !== railShape(road, k)) out.push(`rail ${b.getProperties().shape} at ${here(c)}`);
  }
  for (const c of solid) {
    const b = at(c);
    if (!b) out.push(`not loaded at ${here(c)}`);
    else if (niched && c.x === niched.x && c.y === niched.y && c.z === niched.z && b.name === 'redstone_torch') continue;
    else if (isOpen(b)) out.push(`${b.name} at ${here(c)}`);
  }
  return out;
}

// The last rail, read from the blocks and not from what a file says. From the landing it looks back; open: it ran into a
// chunk not loaded, so the road may go on past there.
function findHead(blockAt, road, fromK) {
  const at = (k) => { const {x, y, z} = cell(road, k, railHeight(k)); return blockAt(x, y, z); };
  let k = Math.max(fromK, FIRST_RAIL);
  if (!/rail$/.test(at(k)?.name ?? 'rail')) {
    const floor = Math.max(FIRST_RAIL, k - 64);
    while (k >= floor && !/rail$/.test(at(k)?.name ?? '')) k--;
    return {head: k >= floor ? k : FIRST_RAIL - 1, open: false};
  }
  if (!at(k)) return {head: k - 1, open: true};
  while (/rail$/.test(at(k + 1)?.name ?? '')) k++;
  return {head: k, open: !at(k + 1)};
}

// The chamber where the four roads start, and the stair down to it: a corridor from the room's north side at x 2 to z -5, then
// steps rising east, three air cells each because the pathfinder needs them. At z -5 they stay out of what inspect sees.
const STAIR_STEPS = 100; // the surface near the origin is at y 60 to 64
function originPlan(origin) {
  const at = (x, y, z) => ({x: origin.x + x, y: origin.y + y, z: origin.z + z});
  const room = [], curbs = [], stair = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y <= 3; y++) room.push(at(x, y, z));
  for (const dir of Object.keys(DIRS)) {
    const road = {dir, origin};
    curbs.push(cell(road, 3));
    room.push(cell(road, 3, 1), cell(road, 3, 2), cell(road, 4), cell(road, 4, 1), cell(road, 4, 2));
  }
  const step = (x, y, z) => stair.push({air: [at(x, y, z), at(x, y + 1, z), at(x, y + 2, z)], floor: at(x, y - 1, z)});
  for (let z = -3; z >= -5; z--) step(2, 0, z);
  for (let i = 1; i <= STAIR_STEPS; i++) step(2 + i, i, -5);
  return {room, curbs, stair};
}

const isClear = (b) => kindOf(b.name) === 'air' || (kindOf(b.name) === 'natural' && b.boundingBox === 'empty'); // a flower is no building
const barred = (b) => ['player', 'keep', 'danger', 'fluid'].includes(kindOf(b.name)); // not the bots' to dig, and a flooded chamber is the owner's to hear of
// What stands there: {unloaded}, {stop: {name, at}} for a block that is barred, or {top, done}: top is the lowest step open
// to the sky, read from above, so a cave under the surface is not taken for the surface.
function readOrigin(blockAt, plan) {
  const read = (c) => blockAt(c.x, c.y, c.z);
  let top = plan.stair.length;
  for (; top > 0; top--) {
    const blocks = plan.stair[top - 1].air.map(read);
    if (blocks.some((b) => !b)) return {unloaded: true};
    if (!blocks.every(isClear)) break;
  }
  let done = top === 0;
  for (const c of [...plan.stair.slice(0, top).flatMap((s) => s.air), ...plan.room]) {
    const b = read(c);
    if (!b) return {unloaded: true};
    if (barred(b)) return {stop: {name: b.name, at: c}};
    if (!isClear(b)) done = false;
  }
  for (const c of plan.curbs) {
    const b = read(c);
    if (!b) return {unloaded: true};
    if (barred(b)) return {stop: {name: b.name, at: c}};
    if (isOpen(b)) done = false;
  }
  return {top, done};
}

// The spec's one exception to the protected box: up to 6 above the origin, and the stair.
function mayBuildAt(plan, origin) {
  const key = (c) => `${c.x},${c.y},${c.z}`;
  const stair = new Set(plan.stair.flatMap((s) => [...s.air, s.floor]).map(key));
  return (p) => p.y <= origin.y + 6 || stair.has(key(p));
}

// The owner's farms and stores a road may take from, read off a copy of the world (docs/specs/2026-11-03-highway-bots-design.md). Nothing else is a
// source, whatever a chest holds. What a farm can make from its iron counts as what it has: get plans the crafting. Gold has no farm yet.
const IRON = ['iron_ingot', 'rail', 'iron_pickaxe', 'iron_sword', 'minecart'];
const FARMS = [
  {x: -51, y: 63, z: -82, items: ['rail', 'powered_rail', 'redstone_torch', 'minecart', 'iron_ingot']}, // the workshop by the stick farm
  {x: 23, y: 66, z: 55, items: ['rail', 'powered_rail', 'redstone_torch', 'bread', 'minecart']}, // the base at spawn
  {x: -22, y: 64, z: -119, items: ['stick']},
  {x: -307, y: 61, z: -167, items: IRON},
  {x: 292, y: 130, z: 745, items: IRON},
  {x: -263, y: 58, z: -216, items: ['cobblestone']},
];
// 8 pickaxes do about 1 km of deepslate, so more rails would not get laid. The cobblestone is for a cave right after the start. Sticks first:
// a farm of iron has none, and rails and tools take them. A first trip also carries the origin's ramp.
const LOAD = {stick: 128, rail: 1024, iron_pickaxe: 8, powered_rail: 48, redstone_torch: 48, minecart: 1, bread: 32, cobblestone: 128, iron_sword: 1};
function loadFor(frontier, ingots = 0) {
  const ramp = !frontier || frontier <= FIRST_RAIL + RAMP_CELLS ? 2 * LOAD.powered_rail : LOAD.powered_rail;
  return {...LOAD, powered_rail: ramp, redstone_torch: ramp, ...(ingots ? {iron_ingot: ingots} : {})};
}

module.exports = {FARMS, loadFor, originPlan, readOrigin, mayBuildAt, isClear, findHead, NATURAL, LINING, kindOf, inspect, isOpen, checkCell, railShape, railFits, DIRS, FIRST_RAIL, RAMP_BOOSTERS, RAMP_CELLS, BORDER_K, cell, isDip, railHeight, crossSection, isBoosterSlot, niche, mayEndAt, onRoad};
