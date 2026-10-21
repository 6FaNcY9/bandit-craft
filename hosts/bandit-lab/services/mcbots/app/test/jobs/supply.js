'use strict';
const assert = require('node:assert');
module.exports = async () => {
  const B = require('../../build');
  const {Vec3} = require('vec3');
  const bpArgs = (remove = false) => ({origin: {x: 0, y: 64, z: 0}, blocks: Array.from({length: 9}, (_, i) => ({x: i % 3, y: 0, z: Math.floor(i / 3), block: 'cobblestone'})), remove});
  // r.bot: ground below y 64, air above; the carried inventory is a mutable list.
  const fake = (carried, supplyChest = {x: 5, y: 64, z: 5}) => {
    const items = carried.map(([name, count]) => ({name, count}));
    const mv = {exclusionAreasBreak: [], exclusionAreasPlace: [], scafoldingBlocks: []};
    const bot = {game: {dimension: 'minecraft:overworld'}, pathfinder: {movements: mv}, registry: {itemsByName: {cobblestone: {id: 1}}},
      blockAt: (p) => ({name: p.y < 64 ? 'stone' : 'air', position: p}), inventory: {items: () => items}};
    return {r: {bot, protectedAreas: [], supplyChest, name: 'bot6'}, items};
  };
  const run = (r, withdraw, args, passedAfter = null) => {
    let guards = 0;
    const guard = () => { if (passedAfter !== null && guards++ >= passedAfter) throw new Error('passed-check'); };
    const build = B.makeBuild({goNear: async () => {}, guard, sleep: async () => {}, goals: {}, digAt: async () => {}, withdraw});
    return build(r, {args, t: {}});
  };
  const calls = [];
  const give = (f) => async (r, job, item, count) => { calls.push([item, count]); f(item, count); };
  // 5 carried, 4 missing: exactly 4 are taken, then the build goes on (the first guard of the place loop ends the test)
  let f = fake([['cobblestone', 5]]);
  await assert.rejects(run(f.r, give((item, n) => f.items[0].count += n), bpArgs(), 3), /passed-check/);
  assert.deepStrictEqual(calls, [['cobblestone', 4]], 'only the missing count is taken');
  // nothing carried, chest has no cobblestone: the item error is absorbed, the recount names the shortage
  calls.length = 0;
  f = fake([]);
  await assert.rejects(run(f.r, async (r, j, item, n) => { calls.push([item, n]); throw new Error(`no ${item} in the chest`); }, bpArgs()), /missing material: 9 cobblestone \(not in the supply chest either\)/);
  assert.deepStrictEqual(calls, [['cobblestone', 9]]);
  // the chest holds only 3 of 9: still short by 6
  f = fake([]);
  await assert.rejects(run(f.r, give((item, n) => f.items.push({name: item, count: 3})), bpArgs()), /missing material: 6 cobblestone \(not in the supply chest either\)/);
  // another error (no chest there) is not hidden
  f = fake([]);
  await assert.rejects(run(f.r, async () => { throw new Error('no chest at 5 64 5 (found air)'); }, bpArgs()), /no chest at 5 64 5/);
  // no supply chest configured: the plain message, no withdraw attempt
  calls.length = 0;
  f = fake([], null);
  await assert.rejects(run(f.r, give(() => {}), bpArgs()), (e) => e.message === 'missing material: 9 cobblestone');
  assert.deepStrictEqual(calls, []);
  // remove mode never withdraws (the blocks are in the world, nothing to carry)
  f = fake([]);
  f.r.bot.blockAt = (p) => ({name: p.y === 64 && p.x < 3 && p.z < 3 ? 'cobblestone' : p.y < 64 ? 'stone' : 'air', position: p});
  await assert.rejects(run(f.r, give(() => {}), bpArgs(true), 1), /passed-check|no record/); // no record of placing it (MC-3): refused even earlier
  assert.deepStrictEqual(calls, [], 'no withdraw in remove mode');
  // a stop between items ends the build before the next withdraw
  calls.length = 0;
  f = fake([]);
  const two = {origin: {x: 0, y: 64, z: 0}, blocks: [{x: 0, y: 0, z: 0, block: 'cobblestone'}, {x: 1, y: 0, z: 0, block: 'dirt'}]};
  f.r.bot.registry.itemsByName.dirt = {id: 2};
  await assert.rejects(run(f.r, async (r, j, item, n) => { calls.push([item, n]); f.items.push({name: item, count: n}); }, two, 1), /passed-check/);
  assert.strictEqual(calls.length, 1, 'a stop during the withdrawals prevents the next one');
  // B4: what the chest lacks is gathered, once, in order; a stop ends it; the cap holds
  {
    const runs = [];
    const gather = (f, after) => async (r, j, type, args) => {
      runs.push([type, args.block || args.item, args.count]);
      if (type === 'mine') f.items.push({name: 'cobblestone', count: args.count});
      if (after) after(type, args);
    };
    // chest has 3, 6 are mined; the chest is asked first
    calls.length = 0;
    f = fake([]);
    await assert.rejects(B.makeBuild({goNear: async () => {}, guard: () => { if (runs.length) throw new Error('passed-check'); }, sleep: async () => {}, goals: {}, digAt: async () => {},
      withdraw: async (r, j, item, n) => { calls.push([item, n]); f.items.push({name: item, count: 3}); }, runJob: gather(f)})(f.r, {args: bpArgs(), t: {}}), /passed-check/);
    assert.deepStrictEqual(calls, [['cobblestone', 9]]);
    assert.deepStrictEqual(runs, [['mine', 'stone', 6]], 'only the rest is gathered');
    // no chest at all: gathers the whole 9
    runs.length = 0;
    f = fake([], null);
    await assert.rejects(B.makeBuild({goNear: async () => {}, guard: () => { if (runs.length) throw new Error('passed-check'); }, sleep: async () => {}, goals: {}, digAt: async () => {}, runJob: gather(f)})(f.r, {args: bpArgs(), t: {}}), /passed-check/);
    assert.deepStrictEqual(runs, [['mine', 'stone', 9]]);
    // something nobody can gather: refused before any job runs
    runs.length = 0;
    f = fake([]);
    const planks = {origin: {x: 0, y: 64, z: 0}, blocks: [{x: 0, y: 0, z: 0, block: 'oak_planks'}, {x: 1, y: 0, z: 0, block: 'cobblestone'}]};
    await assert.rejects(B.makeBuild({goNear: async () => {}, guard: () => {}, sleep: async () => {}, goals: {}, digAt: async () => {}, withdraw: async () => { throw new Error('no oak_planks in the chest'); }, runJob: gather(f)})(f.r, {args: planks, t: {}}), /cannot gather 1 oak_planks yet/);
    assert.deepStrictEqual(runs, []);
    // a stop between two gather jobs ends it
    runs.length = 0;
    f = fake([], null);
    let ctxCalls = 0;
    await assert.rejects(B.makeBuild({goNear: async () => {}, guard: () => { if (runs.length >= 1) throw new Error('stopped'); }, sleep: async () => {}, goals: {}, digAt: async () => {},
      runJob: gather(f), gatherContext: () => { ctxCalls++; return {furnace: false, wood: true, hasFuel: () => true}; }})(f.r, {args: {...planks, blocks: [{x: 0, y: 0, z: 0, block: 'stone'}]}, t: {}}), /stopped/);
    assert.strictEqual(runs.length, 1, 'the smelt after the mine never started');
    assert.strictEqual(ctxCalls, 1);
    // drops lost: a second round, then the 2x cap ends it (9 blocks: 9 + 9 gathered, a third round would pass 18)
    runs.length = 0;
    f = fake([], null);
    await assert.rejects(B.makeBuild({goNear: async () => {}, guard: () => {}, sleep: async () => {}, goals: {}, digAt: async () => {}, runJob: async (r, j, type, args) => { runs.push([type, args.count]); }})(f.r, {args: bpArgs(), t: {}}),
      /missing material: 9 cobblestone \(gathered 18, the limit is 18\)/);
    assert.deepStrictEqual(runs, [['mine', 9], ['mine', 9]]);
  }
};
