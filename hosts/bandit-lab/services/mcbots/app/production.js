'use strict';
// Material production for a project (a schematic build): from what the project still needs and what its
// store chest holds, the next job chain for an idle bot. Crafts whose ingredients are in the store come
// first, then smelts whose input and fuel are, then gathering; a step another bot works on (`taken`) is
// left to it. Chains stay short (one craft or smelt job takes at most 64), so the numbers are fresh between.
const {planMaterials} = require('./recipes');

const MAX = 64;
const FUEL = 'coal';
const at = (c) => ({x: c.x, y: c.y, z: c.z});

// What the gather table's `how` becomes as a mcbots job: `mine <block>` collects that block (stone drops
// cobblestone, iron_ore raw iron), `chop <log>` takes that log kind only, so oak stays oak.
const YIELD = {snow_block: 4}; // items a mined block gives
function gatherJob(how, n) {
  const [verb, block] = how.split(' ');
  return verb === 'mine' || verb === 'chop' ? ['mine', {block, count: Math.ceil(n / (YIELD[block] || 1))}] : null;
}

// need, stock: {item: count}; taken: Set of step keys; store: {x,y,z}. -> {key, label, chain} | {idle: why}
function nextChain({need, stock = {}, taken = new Set(), store, version = '26.1'}) {
  const plan = planMaterials(need, {version, have: stock});
  const has = (item) => stock[item] || 0;
  for (const c of plan.craft) {
    const key = `craft:${c.item}`;
    if (taken.has(key)) continue;
    // As many crafts as the store has ingredients for, up to MAX items out.
    const crafts = Math.min(c.crafts, Math.floor(MAX / Math.max(1, c.count / c.crafts)),
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
    return {key, label: `${g.how} for ${Math.min(g.count, MAX)} ${g.item}`, chain: [job, ['deposit', {...at(store), only: g.item}]]};
  }
  const left = [...plan.unknown, ...plan.gather.filter((g) => !gatherJob(g.how, 1)).map((g) => g.item)];
  return {idle: left.length ? `nothing the bots can make: ${left.join(', ')}` : taken.size ? 'the other bots have the open steps' : 'the project has all it needs'};
}

module.exports = {nextChain, gatherJob};
