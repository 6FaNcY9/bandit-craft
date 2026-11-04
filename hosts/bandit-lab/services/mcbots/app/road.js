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
const FLAT_BEFORE_END = 3; // rails between the last dip and the rail's end (runbook, "A builder's whole trip")

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
const NATURAL = /^(stone|deepslate|dirt|grass_block|coarse_dirt|rooted_dirt|podzol|mud|clay|gravel|sand|red_sand|andesite|diorite|granite|tuff|calcite|dripstone_block|[a-z_]*_ore|short_grass|tall_grass|fern|large_fern|[a-z_]*_flower|dandelion|poppy|moss_block|moss_carpet|glow_lichen|cave_vines|cave_vines_plant)$/;
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

// What cells fromK..toK hold, before a bot digs them. blockAt(x, y, z) gives {name}, or null where no chunk is loaded.
function inspect(blockAt, road, fromK, toK) {
  const named = ({x, y, z}) => blockAt(x, y, z)?.name;
  for (let k = fromK; k <= toK + LOOK_AHEAD; k++) {
    for (let side = -LOOK_SIDE; side <= LOOK_SIDE; side++) {
      for (let h = LOOK_LOW; h <= LOOK_HIGH; h++) {
        const at = cell(road, k, h, side), name = named(at);
        if (name === undefined) return {stop: {why: 'unloaded', at, name: null}, fluids: [], open: []};
        const kind = kindOf(name);
        if (kind === 'player' || kind === 'danger') return {stop: {why: kind, at, name}, fluids: [], open: []};
      }
    }
  }
  const fluids = [], open = [];
  for (let k = fromK; k <= toK; k++) {
    const {air, solid} = crossSection(road, k);
    for (const at of air) {
      const name = named(at), kind = kindOf(name);
      if (kind === 'keep') return {stop: {why: 'keep', at, name}, fluids: [], open: []};
      if (kind === 'fluid') fluids.push(at);
    }
    for (const at of solid) {
      const kind = kindOf(named(at));
      if (kind === 'fluid') fluids.push(at);
      else if (kind === 'air' || kind === 'falling') open.push(at);
    }
  }
  return {stop: null, fluids, open};
}

module.exports = {NATURAL, kindOf, inspect, DIRS, FIRST_RAIL, RAMP_BOOSTERS, RAMP_CELLS, BORDER_K, cell, isDip, railHeight, crossSection, isBoosterSlot, niche, mayEndAt, onRoad};
