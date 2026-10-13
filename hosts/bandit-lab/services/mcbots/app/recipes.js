'use strict';
const mcData = require('minecraft-data');

const SMELT = {
  stone: 'cobblestone', smooth_stone: 'stone', glass: 'sand', terracotta: 'clay',
  brick: 'clay_ball', iron_ingot: 'raw_iron', gold_ingot: 'raw_gold', copper_ingot: 'raw_copper',
  charcoal: 'oak_log', cracked_stone_bricks: 'stone_bricks', smooth_sandstone: 'sandstone',
  smooth_red_sandstone: 'red_sandstone', deepslate: 'cobbled_deepslate', smooth_quartz: 'quartz_block',
  nether_brick: 'netherrack', green_dye: 'cactus', sponge: 'wet_sponge',
};
const GATHER = {
  cobblestone: 'mine stone', cobbled_deepslate: 'mine deepslate', clay_ball: 'mine clay',
  coal: 'mine coal_ore', raw_iron: 'mine iron_ore', raw_copper: 'mine copper_ore', raw_gold: 'mine gold_ore',
  redstone: 'mine redstone_ore', lapis_lazuli: 'mine lapis_ore', diamond: 'mine diamond_ore', flint: 'mine gravel',
};
for (const item of ['dirt', 'sand', 'red_sand', 'gravel', 'netherrack', 'cactus', 'sugar_cane',
  'andesite', 'diorite', 'granite', 'tuff', 'calcite', 'obsidian', 'end_stone', 'blackstone', 'basalt']) GATHER[item] = `mine ${item}`;

function planMaterials(items, {version = '26.1', have = {}} = {}) {
  const data = mcData(version);
  if (!data) throw new Error(`unsupported Minecraft version: ${version}`);
  const gatherHow = {...GATHER};
  for (const item of data.itemsArray) if (item.name.endsWith('_log') && !item.name.startsWith('stripped_')) gatherHow[item.name] = `chop ${item.name}`;
  const memo = new Map();
  const cells = (r) => (r.inShape ? r.inShape.flat() : r.ingredients || []).filter((id) => id != null);
  const ingredientsOf = (r) => {
    const out = {};
    for (const id of cells(r)) {
      const name = data.items[id]?.name;
      if (!name) return null;
      out[name] = (out[name] || 0) + 1;
    }
    return out;
  };
  // Memo keys include the ancestors: a recipe rejected in one branch can work in another.
  function choose(item, count, trail = []) {
    if (trail.includes(item)) return null;
    const key = JSON.stringify([item, count, [...trail].sort()]);
    if (memo.has(key)) return memo.get(key);
    const next = [...trail, item];
    const missing = Math.max(0, count - (have[item] || 0));
    let best = null;
    if (gatherHow[item]) best = {kind: 'gather', cost: missing, ingredients: {}};
    else if (SMELT[item]) {
      const from = SMELT[item], input = choose(from, missing, next);
      if (input) best = {kind: 'smelt', cost: input.cost + Math.ceil(missing / 8), ingredients: {[from]: 1}, per: 1};
    } else for (const [pass, r] of (data.recipes[data.itemsByName[item]?.id] || []).flatMap((r) => [[0, r], [1, r]])) {
      const ingredients = ingredientsOf(r);
      if (!ingredients || !Object.keys(ingredients).length) continue;
      // Unpacking a block into the material it is made of (iron_block -> iron_ingot) only when nothing
      // else makes the item (iron_ingot -> iron_nugget): the second pass, and only if the first found none.
      const unpack = Object.keys(ingredients).length === 1 && r.result.count > 1 &&
        (data.recipes[data.itemsByName[Object.keys(ingredients)[0]]?.id] || []).some((back) =>
          cells(back).includes(data.itemsByName[item]?.id));
      if (unpack !== (pass === 1) || (pass === 1 && best)) continue;
      const crafts = Math.ceil(missing / r.result.count);
      const parts = Object.entries(ingredients).map(([name, n]) => choose(name, n * crafts, next));
      if (parts.some((p) => !p)) continue;
      const cost = parts.reduce((sum, p) => sum + p.cost, 0);
      const ids = cells(r).sort((a, b) => a - b);
      const oak = Object.keys(ingredients).some((name) => name.startsWith('oak_'));
      const lower = best && ids.findIndex((id, i) => id !== best.ids[i]);
      if (!best || cost < best.cost || (cost === best.cost && (oak > best.oak ||
        (oak === best.oak && lower >= 0 && ids[lower] < best.ids[lower])))) {
        best = {kind: 'craft', cost, ingredients, per: r.result.count, oak, ids,
          table: r.inShape ? r.inShape.length > 2 || r.inShape.some((row) => row.length > 2) : cells(r).length > 4};
      }
    }
    if (!best && !missing) best = {kind: 'unknown', cost: 0, ingredients: {}};
    memo.set(key, best);
    return best;
  }

  const needs = new Map(Object.entries(items)), steps = new Map(), order = [];
  function visit(item, trail = []) {
    if (steps.has(item)) return;
    const step = choose(item, Math.max(1, needs.get(item) || 0), trail);
    steps.set(item, step);
    if (step) for (const name of Object.keys(step.ingredients)) visit(name, [...trail, item]);
    order.push(item);
  }
  for (const item of needs.keys()) visit(item);
  const gather = [], smelt = [], craft = [], unknown = [];
  let smelts = 0;
  // Parents first: all users contribute before an intermediate is rounded or inventory is spent.
  for (const item of [...order].reverse()) {
    const count = Math.max(0, (needs.get(item) || 0) - (have[item] || 0));
    if (!count) continue;
    const step = steps.get(item);
    if (!step || step.kind === 'unknown') { unknown.push(item); continue; }
    if (step.kind === 'gather') { gather.push({item, count, how: gatherHow[item]}); continue; }
    const crafts = Math.ceil(count / step.per), ingredients = {};
    for (const [name, n] of Object.entries(step.ingredients)) {
      ingredients[name] = n * crafts;
      needs.set(name, (needs.get(name) || 0) + n * crafts);
    }
    if (step.kind === 'smelt') {
      smelt.push({item, count, from: SMELT[item], per: 1});
      smelts += count;
    } else craft.push({item, count, crafts, ingredients, table: step.table});
  }
  const fuel = {item: 'coal', count: Math.ceil(smelts / 8)};
  const coalNeed = Math.max(0, (needs.get('coal') || 0) + fuel.count - (have.coal || 0));
  const coal = gather.find((g) => g.item === 'coal');
  if (coal) coal.count = coalNeed;
  else if (coalNeed) gather.push({item: 'coal', count: coalNeed, how: GATHER.coal});
  return {gather, smelt: smelt.reverse(), craft: craft.reverse(), fuel, unknown: unknown.sort()};
}

module.exports = {planMaterials};
