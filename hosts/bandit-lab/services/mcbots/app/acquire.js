'use strict';
// "How does a bot get N of an item?", worked out from the game's own data instead of hand-written chains (owner,
// 2026-10-17: the bots should derive things, not have everything described). Every way the game offers is weighed:
// the bot's inventory, a chest it knows the contents of, a craft, a smelt, a block that drops the item, a mob that
// drops it. Each has an estimated time in seconds and what it needs first: a crafting table, a furnace, a pickaxe good
// enough for the block. The cheapest way wins, down to the raw materials; what no way reaches comes back as missing.
// Pure: the world (inventory, chests, what is near, what failed lately) comes in as plain data, see plan().
const {cells, needsTable, SMELT} = require('./recipes');

const SPEED = 4; // blocks a second on foot
const CHEST_S = 3; // open a chest and take from it
const CRAFT_S = 0.5; // one craft, laid out by the server (crafting.js bookCraft)
const SMELT_S = 10; // one item in a furnace
const FIGHT_S = 15; // one kill, the walk to the mob included
const STEP_S = 2; // from one block of a kind to the next
const EXPLORE_S = 300; // a block or a mob not seen near: go and look for one
const DIG_S = 1.5; // per hardness point, with a tool that fits
const FUEL = 'coal', PER_FUEL = 8;
const ROUNDS = 30; // relaxation rounds; recipe chains are far shorter
const MAX_EXPANSIONS = 5000; // ways tried in one plan; past that the first one found stands

// What minecraft-data leaves out: a sheep's wool is in per-colour loot tables it does not list.
const MOB_EXTRA = {sheep: {white_wool: 1}};

// Items per block (or kill) without silk touch: {item: n}. minecraft-data splits a silk-touch alternative off by chance
// (iron_ore: raw iron 0.5, the ore itself 0.5 with silk touch), so the rest is scaled back up. The smallest stack
// counts: iron ore says 1-2 raw iron, and without fortune it is 1 (bot50 mined 2 ores for 3, sandbox 2026-10-17).
function yieldOf(drops) {
  const silk = drops.filter((e) => e.silkTouch).reduce((s, e) => s + e.dropChance, 0);
  const out = {};
  for (const e of drops) {
    if (e.silkTouch) continue;
    const lo = e.stackSizeRange?.[0] || 1;
    out[e.item] = (out[e.item] || 0) + (e.dropChance / Math.max(0.05, 1 - silk)) * lo;
  }
  return out;
}

// Per data set: item -> [{block, per}] and item -> [{mob, per}]. A block's loot table in minecraft-data loses its
// conditions (oak leaves: a stick and an apple every time; really 2 % and 0.5 %), so only the drops the block list
// names count in full; the rest counts a tenth.
const SIDE_DROP = 0.1;
const INDEX = new WeakMap();
function lootIndex(data) {
  if (INDEX.has(data)) return INDEX.get(data);
  const blocks = new Map(), mobs = new Map();
  const add = (map, item, entry) => (map.has(item) ? map.get(item).push(entry) : map.set(item, [entry]));
  for (const [block, l] of Object.entries(data.blockLoot || {})) {
    const primary = new Set((data.blocksByName[block]?.drops || []).map((d) => data.items[typeof d === 'object' ? d.drop?.id ?? d.id : d]?.name));
    for (const [item, per] of Object.entries(yieldOf(l.drops))) if (per > 0) add(blocks, item, {block, per: primary.has(item) ? per : per * SIDE_DROP});
  }
  const mobLoot = Object.fromEntries(Object.entries(data.entityLoot || {}).map(([mob, l]) => [mob, yieldOf(l.drops)]));
  for (const [mob, extra] of Object.entries(MOB_EXTRA)) mobLoot[mob] = {...mobLoot[mob], ...extra};
  for (const [mob, loot] of Object.entries(mobLoot)) for (const [item, per] of Object.entries(loot)) if (per > 0) add(mobs, item, {mob, per});
  const out = {blocks, mobs};
  INDEX.set(data, out);
  return out;
}

// A recipe as {per, ingredients: {name: n}, table}; null when an ingredient is unknown.
function recipeParts(data, r) {
  const ingredients = {};
  for (const id of cells(r)) {
    const name = data.items[id]?.name;
    if (!name) return null;
    ingredients[name] = (ingredients[name] || 0) + 1;
  }
  return Object.keys(ingredients).length ? {per: r.result?.count || 1, ingredients, table: needsTable(r)} : null;
}

const chestKey = (s, item) => `chest:${s.at.x},${s.at.y},${s.at.z}:${item}`;

// world: {
//   data: minecraft-data for the bot's version,
//   have: {item: n} the inventory,
//   stores: [{at: {x, y, z}, dist, stock: {item: n}}] chests and what they held when last seen,
//   blockNear(name) -> distance in blocks | null, mobNear(name) -> distance | null (nearest such the bot knows of),
//   canMine(block), canKill(mob) -> bool: what the bot's jobs may do at all,
//   stationNear(name) -> bool: a crafting table or furnace stands near enough to use (crafting.js station()),
//   smelting: {result: input} (default: recipes.js SMELT), failed: Set of method keys to leave out for now,
//   seenOnly: mine and kill only what blockNear/mobNear know of, no exploring (a helper for another bot's need: soul
//   sand is mined in the Nether, and none of the crew has seen any),
// }
// -> {node, missing: [item]}; node = {item, count, via, cost, children, ...}, via: have | chest | craft | smelt |
// mine | kill | missing | parts (several of these). Costs are seconds, estimated.
function plan(goal, world) {
  const {data} = world;
  const loot = lootIndex(data);
  const smelting = world.smelting || SMELT;
  const failed = world.failed || new Set();
  const canMine = world.canMine || (() => true), canKill = world.canKill || (() => true);
  const near = new Map();
  const nearOf = (kind, name) => {
    const k = `${kind}:${name}`;
    if (!near.has(k)) near.set(k, (kind === 'block' ? world.blockNear?.(name) : world.mobNear?.(name)) ?? null);
    return near.get(k);
  };
  const toolsFor = (block) => Object.keys(data.blocksByName[block]?.harvestTools || {}).map((id) => data.items[id]?.name).filter(Boolean);
  const recipes = (item) => (data.recipes[data.itemsByName[item]?.id] || []).map((r) => recipeParts(data, r)).filter(Boolean);

  // Every way to make an item (chests aside): {key, kind, inputs, unit(cost of one input) -> seconds for one}; a mine or
  // kill method also has `each`, the seconds per block or kill.
  function methods(item) {
    const out = [];
    for (const r of recipes(item)) out.push({key: `craft:${item}`, kind: 'craft', recipe: r, inputs: Object.keys(r.ingredients),
      unit: (c) => (CRAFT_S + Object.entries(r.ingredients).reduce((s, [n, k]) => s + k * c(n), 0)) / r.per});
    const input = smelting[item];
    if (input) out.push({key: `smelt:${item}`, kind: 'smelt', input, inputs: [input, FUEL], unit: (c) => SMELT_S + c(input) + c(FUEL) / PER_FUEL});
    for (const {block, per} of loot.blocks.get(item) || []) {
      const hard = data.blocksByName[block]?.hardness ?? 1;
      if (!canMine(block) || hard < 0) continue; // bedrock and the like
      if (block === item && recipes(item).length) continue; // a block that is crafted and drops itself was placed: planks, wool
      const tools = toolsFor(block), dist = nearOf('block', block);
      if (dist === null && world.seenOnly) continue;
      const each = DIG_S * hard + STEP_S + (dist === null ? EXPLORE_S : dist / SPEED) / 8;
      // The tool counts once a plan (keep()), not per block: here only whether one can be had at all.
      out.push({key: `mine:${block}`, kind: 'mine', block, per, tools, each, inputs: tools,
        unit: (c) => (tools.length && !tools.some((t) => Number.isFinite(c(t))) ? Infinity : each / per)});
    }
    for (const {mob, per} of loot.mobs.get(item) || []) {
      if (!canKill(mob)) continue;
      const dist = nearOf('mob', mob);
      if (dist === null && world.seenOnly) continue;
      const each = FIGHT_S + (dist === null ? EXPLORE_S : dist / SPEED);
      out.push({key: `kill:${mob}`, kind: 'kill', mob, per, each, inputs: [], unit: () => each / per});
    }
    return out.filter((m) => !failed.has(m.key));
  }

  // The items that matter for this goal: its ingredients, smelt inputs, fuel and tools, all the way down.
  const relevant = new Map(); // item -> its methods
  for (const queue = [goal.item, 'crafting_table', 'furnace']; queue.length;) {
    const item = queue.pop();
    if (relevant.has(item)) continue;
    const ms = methods(item);
    relevant.set(item, ms);
    for (const m of ms) queue.push(...m.inputs);
  }

  // What one costs to make from scratch (no inventory, no chests), relaxed until nothing gets cheaper. No cycle can win
  // it: each step adds time, and no recipe gives back more than it takes (iron_block <-> iron_ingot is 9:1 both ways).
  // The inventory and chests come in below, counted, as the plan spends them: free in here, they made the cycle
  // raw_iron -> raw_iron_block -> raw_iron look cheaper than digging, and the plan never ended (sandbox 2026-10-17).
  const pure = new Map([...relevant.keys()].map((item) => [item, Infinity]));
  const pc = (item) => pure.get(item) ?? Infinity;
  for (let round = 0, changed = true; changed && round < ROUNDS; round++) {
    changed = false;
    for (const [item, ms] of relevant) {
      for (const m of ms) {
        const c = m.unit(pc);
        if (c < pure.get(item)) { pure.set(item, c); changed = true; }
      }
    }
  }

  // The plan, spending the inventory and the chests as it goes: two branches cannot both count the same planks.
  const have = {...world.have};
  const stock = (world.stores || []).map((s) => ({...s, stock: {...s.stock}})).sort((a, b) => a.dist - b.dist);
  const missing = new Set();
  const making = new Set(); // the items being made up the tree: none of them may be an input again
  const held = (t) => (have[t] || 0) > 0 || !!world.stationNear?.(t);
  // What `count` of an item costs now: what the inventory and the chests still hold, the rest made from scratch.
  function estimate(item, count) {
    let rest = Math.max(0, count - (have[item] || 0)), c = 0;
    for (const s of stock) {
      const k = Math.min(rest, s.stock[item] || 0);
      if (!k || failed.has(chestKey(s, item))) continue;
      c += 2 * s.dist / SPEED + CHEST_S;
      rest -= k;
    }
    return rest ? c + rest * pc(item) : c;
  }
  const toolCost = (tools) => (!tools.length || tools.some(held) ? 0 : Math.min(Infinity, ...tools.filter((t) => !making.has(t)).map((t) => estimate(t, 1))));
  // A method's cost for `count` of its item, as things stand: Infinity if it needs something being made up the tree.
  function costOf(m, count) {
    if (m.kind === 'craft') {
      if (m.inputs.some((i) => making.has(i))) return Infinity;
      const crafts = Math.ceil(count / m.recipe.per);
      return crafts * CRAFT_S + (m.recipe.table ? toolCost(['crafting_table']) : 0) + Object.entries(m.recipe.ingredients).reduce((s, [n, k]) => s + estimate(n, k * crafts), 0);
    }
    if (m.kind === 'smelt') {
      if (making.has(m.input) || making.has(FUEL)) return Infinity;
      return count * SMELT_S + toolCost(['furnace']) + estimate(m.input, count) + estimate(FUEL, Math.ceil(count / PER_FUEL));
    }
    const n = Math.ceil(count / m.per);
    return n * m.each + (m.kind === 'mine' ? toolCost(m.tools) : 0);
  }
  // A tool or a station: one in hand (or a station standing near) will do; else the cheapest is made once and kept.
  function keep(items) {
    if (!items.length || items.some(held)) return null;
    const free = items.filter((t) => !making.has(t)).sort((a, b) => estimate(a, 1) - estimate(b, 1));
    if (!free.length) return null; // all being made up the tree: produce() saw that cost as Infinity already
    const node = need(free[0], 1);
    node.kept = true;
    have[free[0]] = (have[free[0]] || 0) + 1;
    return node;
  }
  function need(item, count) {
    const parts = [];
    let rest = count;
    const own = Math.min(rest, have[item] || 0);
    if (own) {
      have[item] -= own;
      rest -= own;
      parts.push({item, count: own, via: 'have', cost: 0, children: []});
    }
    for (const s of stock) {
      const k = Math.min(rest, s.stock[item] || 0);
      if (!k || failed.has(chestKey(s, item))) continue;
      const trip = 2 * s.dist / SPEED + CHEST_S;
      if (trip >= k * pc(item)) continue; // making them is quicker than the walk
      s.stock[item] -= k;
      rest -= k;
      parts.push({item, count: k, via: 'chest', at: s.at, key: chestKey(s, item), cost: trip, children: []});
    }
    if (rest) parts.push(produce(item, rest));
    return parts.length === 1 ? parts[0] : {item, count, via: 'parts', cost: parts.reduce((s, c) => s + c.cost, 0), children: parts};
  }
  // The ledger as it is, to go back to when a way turns out to need something no way reaches.
  let expansions = 0;
  const snapshot = () => ({have: {...have}, stock: stock.map((s) => ({...s.stock})), missing: new Set(missing)});
  function restore(snap) {
    for (const k of Object.keys(have)) delete have[k];
    Object.assign(have, snap.have);
    stock.forEach((s, i) => { s.stock = {...snap.stock[i]}; });
    missing.clear();
    for (const m of snap.missing) missing.add(m);
  }
  // The cheapest way first; one whose tree ends in a missing item gives way to the next. Costs look one level down
  // only: iron ingots from 27 nuggets looked cheaper than smelting (the furnace counts once, not per ingot), and nuggets
  // come only from ingots, which were being made (sandbox 2026-10-17).
  function produce(item, count) {
    const options = (relevant.get(item) || []).map((m) => [m, costOf(m, count)]).filter(([, c]) => Number.isFinite(c)).sort((a, b) => a[1] - b[1]);
    if (!options.length) {
      missing.add(item);
      return {item, count, via: 'missing', cost: Infinity, children: []};
    }
    let first = null;
    for (const [m] of options) {
      const snap = snapshot();
      const node = build(item, count, m);
      if (missing.size === snap.missing.size || expansions > MAX_EXPANSIONS) return node;
      first ||= {snap, m};
      restore(snap);
    }
    restore(first.snap); // no way without a missing item: the cheapest, with what it lacks
    return build(item, count, first.m);
  }
  function build(item, count, m) {
    expansions++;
    making.add(item);
    const kids = [];
    const node = {item, count, via: m.kind, key: m.key, children: kids};
    if (m.kind === 'craft') {
      const crafts = Math.ceil(count / m.recipe.per);
      const t = m.recipe.table && keep(['crafting_table']);
      if (t) kids.push(t);
      for (const [n, k] of Object.entries(m.recipe.ingredients)) kids.push(need(n, k * crafts));
      have[item] = (have[item] || 0) + crafts * m.recipe.per - count; // a stick craft gives 4
      Object.assign(node, {crafts, cost: crafts * CRAFT_S});
    } else if (m.kind === 'smelt') {
      const f = keep(['furnace']);
      if (f) kids.push(f);
      kids.push(need(m.input, count), need(FUEL, Math.ceil(count / PER_FUEL)));
      Object.assign(node, {input: m.input, cost: count * SMELT_S});
    } else if (m.kind === 'mine') {
      const t = keep(m.tools);
      if (t) kids.push(t);
      const blocks = Math.ceil(count / m.per);
      Object.assign(node, {block: m.block, blocks, cost: blocks * m.each});
    } else {
      const kills = Math.ceil(count / m.per);
      Object.assign(node, {mob: m.mob, kills, cost: kills * m.each});
    }
    making.delete(item);
    node.cost += kids.reduce((s, c) => s + c.cost, 0);
    return node;
  }
  const node = need(goal.item, goal.count);
  return {node, missing: [...missing].sort()};
}

// The next thing to do: the first node, children first, whose children are all in hand. Null when all is in hand or
// a needed item cannot be had (plan().missing says which).
function nextStep(node) {
  if (node.via === 'have' || node.via === 'missing') return null;
  for (const c of node.children) if (c.via !== 'have') return nextStep(c);
  return node.via === 'parts' ? null : node;
}

// The plan as lines, children indented under what they are for.
function explain(node, depth = 0) {
  const at = node.at && `${node.at.x} ${node.at.y} ${node.at.z}`;
  const what = {have: 'in the inventory', chest: `from the chest at ${at}`, craft: `craft ${node.crafts}x`, smelt: `smelt ${node.input}`,
    mine: `mine ${node.blocks} ${node.block}`, kill: `kill ${node.kills} ${node.mob}`, missing: 'no way to get it', parts: 'in parts'}[node.via];
  const time = node.via !== 'have' && Number.isFinite(node.cost) ? ` ~${Math.round(node.cost)} s` : '';
  return [`${'  '.repeat(depth)}${node.count} ${node.item}${node.kept ? ' (kept)' : ''}: ${what}${time}`, ...node.children.map((c) => explain(c, depth + 1))].join('\n');
}

// One line for the event log: the raw work grouped, then how much crafting and smelting follows.
// "~121 s: mine 5 oak_log, mine 11 stone, mine 2 iron_ore, mine 1 coal_ore; then 9 crafts, 3 smelts".
function summary(node) {
  const raw = new Map(); // label -> [count, (n) -> text]
  let crafts = 0, smelts = 0;
  const add = (label, n, text) => raw.set(label, [(raw.get(label)?.[0] || 0) + n, text]);
  const walk = (x) => {
    x.children.forEach(walk);
    if (x.via === 'mine') add(`mine:${x.block}`, x.blocks, (n) => `mine ${n} ${x.block}`);
    if (x.via === 'kill') add(`kill:${x.mob}`, x.kills, (n) => `kill ${n} ${x.mob}`);
    if (x.via === 'chest') add(`chest:${x.item}`, x.count, (n) => `${n} ${x.item} from a chest`);
    if (x.via === 'missing') add(`missing:${x.item}`, x.count, (n) => `no way to get ${n} ${x.item}`);
    if (x.via === 'craft') crafts += x.crafts;
    if (x.via === 'smelt') smelts += x.count;
  };
  walk(node);
  const work = [...raw.values()].map(([n, text]) => text(n));
  const then = [crafts && `${crafts} crafts`, smelts && `${smelts} smelts`].filter(Boolean).join(', ');
  const time = Number.isFinite(node.cost) ? `~${Math.round(node.cost)} s: ` : '';
  return `${time}${work.join(', ') || 'all in hand'}${then ? `; then ${then}` : ''}`;
}

module.exports = {plan, nextStep, explain, summary, yieldOf, lootIndex};
