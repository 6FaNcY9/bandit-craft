'use strict';
// Material production for a project (a schematic build): from what the project still needs and what its
// store chest holds, the next job chain for an idle bot. Crafts whose ingredients are in the store come
// first, then smelts whose input and fuel are, then gathering; a step another bot works on (`taken`) is
// left to it. Chains stay short (one craft or smelt job takes at most 64), so the numbers are fresh between.
const mcData = require('minecraft-data');
const {planMaterials} = require('./recipes');

const MAX = 64;
// Items that do not stack (shears) take a slot each: 64 of them never fit a bag, and 1160 for a sorter fill every chest
// of the store so that nothing else fits. A chain makes what the bag holds, the store keeps this many (2026-11-11).
const STAGE = 96;
const FUEL = 'coal';
const at = (c) => ({x: c.x, y: c.y, z: c.z});

// What the gather table's `how` becomes as a mcbots job: `mine <block>` collects that block (stone drops
// cobblestone, iron_ore raw iron), `chop <log>` takes that log kind only, so oak stays oak. No job for snow: none lies
// near the sorter and the far search walked bot2 400 blocks out to its death (2026-11-11), so the owner brings it.
function gatherJob(how, n) {
  const [verb, block] = how.split(' ');
  return (verb === 'mine' || verb === 'chop') && block !== 'snow_block' ? ['mine', {block, count: n}] : null;
}

// need, stock: {item: count}; taken: Set of step keys; store: {x,y,z}. -> {key, label, chain} | {idle: why}
// resting: steps that just ran; they wait while another step is open. The builder used cobblestone up as fast as it
// came, and "took 3 cobblestone from storage" ran every 2 min for hours while 9 hoppers never got a turn (main
// server 2026-10-18).
// slots: the bag's free slots; shears and the like take one each, two stay free for the ingredients.
function nextChain({need, stock = {}, taken = new Set(), resting = new Set(), store, version = '26.1', slots = 36}) {
  if (resting.size) {
    const other = nextChain({need, stock, taken: new Set([...taken, ...resting]), store, version, slots});
    if (!other.idle) return other;
  }
  const plan = planMaterials(need, {version, have: stock});
  const has = (item) => stock[item] || 0;
  const staged = [];
  for (const c of plan.craft) {
    const key = `craft:${c.item}`;
    if (taken.has(key)) continue;
    const out = mcData(version).itemsByName[c.item]?.stackSize === 1 ? Math.min(MAX, Math.max(1, slots - 2), STAGE - has(c.item)) : MAX;
    if (out < 1) { staged.push(c.item); continue; }
    // As many crafts as the store has ingredients for, up to `out` items out.
    const crafts = Math.min(c.crafts, Math.floor(out / Math.max(1, c.count / c.crafts)),
      ...Object.entries(c.ingredients).map(([item, n]) => Math.floor(has(item) / (n / c.crafts))));
    if (crafts < 1) continue;
    const count = Math.min(c.count, Math.round(crafts * (c.count / c.crafts)));
    const chain = Object.entries(c.ingredients).map(([item, n]) => ['withdraw', {item, count: Math.ceil((n / c.crafts) * crafts), ...at(store)}]);
    return {key, label: `craft ${count} ${c.item}`, chain: [...chain, ['craft', {item: c.item, count}], ['deposit', {...at(store), only: c.item}]]};
  }
  for (const s of plan.smelt) {
    const key = `smelt:${s.item}`;
    if (taken.has(key)) continue;
    const n = Math.min(s.count, MAX, has(s.from), (has(FUEL) - (s.from === FUEL ? s.count : 0)) * 8);
    if (n < 1) continue;
    return {key, label: `smelt ${n} ${s.from} into ${s.item}`, chain: [
      ['withdraw', {item: s.from, count: n, ...at(store)}], ['withdraw', {item: FUEL, count: Math.ceil(n / 8), ...at(store)}],
      ['smelt', {item: s.from, count: n}], ['deposit', {...at(store), only: s.item}]]};
  }
  for (const g of plan.gather) {
    const key = `gather:${g.item}`;
    const job = gatherJob(g.how, Math.min(g.count, MAX));
    if (taken.has(key) || !job) continue;
    return {key, label: `${g.how} for ${Math.min(g.count, MAX)} ${g.item}`, chain: [job, ['deposit', {...at(store), only: g.item}]], gather: {item: g.item, count: g.count}};
  }
  const left = [...plan.unknown, ...plan.gather.filter((g) => !gatherJob(g.how, 1)).map((g) => g.item)];
  const wait = staged.length ? `${staged.join(', ')} are staged, waiting for the builders` : taken.size ? 'the other bots have the open steps' : 'the project has all it needs'; // staged is no end: produce quits on "all it needs"
  return {idle: left.length ? `nothing the bots can make: ${left.join(', ')}` : wait, left};
}

module.exports = {nextChain, gatherJob};
