'use strict';
// Storage roles for a deposit at the base chest: what the keeper, the plan and crafting draw from it
// stays there ('base'); everything else (stone variants, flowers, mob drops, ...) goes to the
// storage-room chests ('room'), so junk cannot fill the chest the jobs depend on (2026-10-10).
const BASE_RE = /^(stick|[a-z_]+_(log|planks|sapling|wool|bed|pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)|cobblestone|stone_bricks|coal|charcoal|torch|raw_iron|iron_ingot|crafting_table|furnace|chest|scaffolding|bow|crossbow|shield|shears)$/;
// The base chest keeps an item only up to its keeper quota (cobblestone 569 / logs 509 / saplings 310 filled it and
// left no room for torches, 2026-10-10): the rest goes to the hall like 'room' items. Mirrors KEEPER_QUOTAS
// (default.nix) and the plan's stock-basics; saplings are no quota but capped too. Kinds: any *_log is "logs".
// Bread and spare pickaxes too: 193 bread in 4 slots and 3 iron pickaxes in 3 left the chest 3 slots free, and the
// carry-out never ran (main server 2026-10-20).
// Sticks and planks too: the keep-cap spares of every bot (bot19 carried 474 sticks) would refill the chest (architect review 2026-11-11).
// shortcut: planks 256 across all wood kinds is a guess; raise it if builds starve for planks in the chest.
const CAPS = [['logs', 64], ['cobblestone', 128], ['stone_bricks', 128], ['coal', 32], ['torch', 64], ['raw_iron', 32], ['sapling', 32],
  ['bread', 128], ['iron_pickaxe', 2], ['stick', 64], ['planks', 256]];
const kindOf = (n) => (n.endsWith('_log') ? 'logs' : n.endsWith('_sapling') ? 'sapling' : n.endsWith('_planks') ? 'planks' : n.endsWith('_wool') ? 'wool' : n === 'charcoal' ? 'coal' : n);
// Is the chest already at (or, with delta < 0, would it stay at) the cap of this item's kind? stock: {name: count}.
const overCap = (name, stock, delta = 0, caps = CAPS) => {
  const cap = caps.find(([k]) => k === kindOf(name));
  return !!cap && Object.entries(stock).reduce((s, [n, c]) => s + (kindOf(n) === cap[0] ? c : 0), delta) >= cap[1];
};
const storeFor = (name, foods = () => false, over = () => false) => ((BASE_RE.test(name) || foods(name)) && !over(name) ? 'base' : 'room');

const sameXYZ = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;

// Natural stone and ground the bots dig by the thousand (tossJunk drops them when full).
const JUNK = new Set(['cobblestone', 'cobbled_deepslate', 'dirt', 'gravel', 'granite', 'diorite', 'andesite', 'tuff', 'netherrack', 'calcite', 'dripstone_block', 'rooted_dirt', 'leaf_litter']);
// Hall caps per kind: the hall held 45,260 cobblestone and 26,129 wheat seeds and its full stone chests sent the
// surplus back into the supply chest (main server 2026-11-11). Logs are capped for the tree farm pause, never dropped.
const HALL_CAPS = {cobblestone: 6912, wheat_seeds: 1728, sapling: 1728, logs: 1728,
  // Farm outputs (animals and crops plan): the farms pause at the cap; all wool colours are one kind.
  carrot: 864, potato: 864, beetroot: 864, beetroot_seeds: 864, sugar_cane: 864, beef: 864, porkchop: 864, mutton: 864, chicken: 864, leather: 864, feather: 864, wool: 864, egg: 432};
const hallCap = (n) => HALL_CAPS[kindOf(n)] ?? (JUNK.has(n) ? 1728 : 0);
// The owner's drop list (2026-11-11): cheap stone and ground, seeds and saplings; nothing else is ever dropped.
const DROPPABLE = (n) => JUNK.has(n) || n === 'wheat_seeds' || n.endsWith('_sapling');
// What the chest index (Map 'x,y,z' -> {items}) says the hall holds; null when no hall chest is indexed.
function hallTotals(chests) {
  const {SLOTS, keyOf} = require('./storage-layout');
  const slots = new Set(SLOTS.map(keyOf));
  let totals = null;
  for (const [k, c] of chests || []) {
    if (!slots.has(k)) continue;
    totals ||= {};
    for (const [n, count] of Object.entries(c.items || {})) totals[n] = (totals[n] || 0) + count;
  }
  return totals;
}
// How far the hall is above this kind's cap; 0 without a cap or without an index (a stale index errs toward keeping).
const surplus = (name, totals) => {
  const cap = hallCap(name);
  if (!cap || !totals) return 0;
  return Math.max(0, Object.entries(totals).reduce((s, [n, c]) => s + (kindOf(n) === kindOf(name) ? c : 0), 0) - cap);
};
// Farm outputs the chest a farm hands in at may hold: the hall caps never see that chest, and raw food and wool would fill
// it (no room for torches and coal, 2026-10-10). 128 per kind, eggs 32; all wool colours are one kind.
const CHEST_QUOTA = {carrot: 128, potato: 128, beetroot: 128, sugar_cane: 128, beef: 128, porkchop: 128, mutton: 128, chicken: 128, leather: 128, feather: 128, wool: 128, egg: 32};
const STOCK_TTL_MS = 1800000; // an older reading is unknown: the next visit to the chest refreshes it
// How far the chest at pos is above this kind's quota, read from world.stocks (keyed by the exact chest a job opened; the
// double-chest index keeps the smaller half and held an 11-day-old ghost under the supply chest's other half, 2026-11-11).
// 0 without a quota, a chest, a reading or with one older than 30 minutes (errs toward working).
const chestAbove = (name, stocks, pos, now = Date.now()) => {
  const quota = CHEST_QUOTA[kindOf(name)], c = pos && stocks?.get(`${pos.x},${pos.y},${pos.z}`);
  if (!quota || !c || !(now - c.t <= STOCK_TTL_MS)) return 0;
  return Math.max(0, Object.entries(c.items || {}).reduce((s, [n, k]) => s + (kindOf(n) === kindOf(name) ? k : 0), 0) - quota);
};
// A farm kind rests while the hall is above its cap or the chest the farm hands in at is above its quota.
const farmEnough = (name, world, pos, now = Date.now()) => surplus(name, hallTotals(world?.chests)) || chestAbove(name, world?.stocks, pos, now);
module.exports = {storeFor, overCap, CAPS, sameXYZ, JUNK, HALL_CAPS, DROPPABLE, hallTotals, surplus, CHEST_QUOTA, chestAbove, farmEnough};
