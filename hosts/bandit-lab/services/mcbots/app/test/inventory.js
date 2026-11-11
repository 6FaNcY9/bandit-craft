'use strict';
// Keep caps: what a deposit files above the per-bot keep caps (bot19 carried 448 sticks, 7 iron pickaxes and 3 tables, 2026-11-11).
const assert = require('node:assert/strict');
const {beyondKeep} = require('../bots');

const it = (name, count) => ({name, count, type: 1, metadata: 0});
assert.deepStrictEqual(beyondKeep([it('stick', 64), it('stick', 64), it('stick', 20)]).map((i) => [i.name, i.count]), [['stick', 64], ['stick', 20]], 'one stack of sticks stays');
assert.deepStrictEqual(beyondKeep([it('iron_pickaxe', 1), it('iron_pickaxe', 1), it('iron_pickaxe', 1)]).map((i) => i.name), ['iron_pickaxe'], 'two of each tool stay');
assert.deepStrictEqual(beyondKeep([it('crafting_table', 3)]).map((i) => i.count), [2], 'one table stays, a partial count leaves');
assert.deepStrictEqual(beyondKeep([it('coal', 40), it('charcoal', 40)]).map((i) => [i.name, i.count]), [['charcoal', 16]], 'coal and charcoal share one cap');
assert.deepStrictEqual(beyondKeep([it('oak_planks', 64), it('birch_planks', 64), it('oak_planks', 10)]).map((i) => [i.name, i.count]), [['oak_planks', 10]], 'every planks kind has its own cap');
assert.deepStrictEqual(beyondKeep([it('oak_log', 64), it('bread', 64), it('torch', 64)]), [], 'logs and food are not keep items; torches at the cap stay');

// Hall caps: cheap surplus the full hall cannot take is dropped at the work site, never put back in the supply chest.
const S = require('../storage');
const hall = new Map([['-263,58,-219', {items: {cobblestone: 7000, wheat_seeds: 2000}, free: 0}]]);
const t = S.hallTotals(hall);
assert.strictEqual(S.surplus('cobblestone', t), 88);
assert.strictEqual(S.surplus('wheat_seeds', t), 272);
assert.strictEqual(S.surplus('oak_log', {oak_log: 2000, birch_log: 100}), 372, 'all logs are one kind (the tree farm pause reads it)');
assert.strictEqual(S.surplus('iron_ingot', {iron_ingot: 99999}), 0, 'kinds without a cap have no surplus');
assert.strictEqual(S.DROPPABLE('oak_log'), false, 'logs are never dropped');
assert.strictEqual(S.DROPPABLE('oak_sapling') && S.DROPPABLE('wheat_seeds') && S.DROPPABLE('cobblestone'), true);
assert.strictEqual(S.surplus('cobblestone', null), 0, 'no index: keep');
assert.strictEqual(S.hallTotals(new Map([['1,2,3', {items: {cobblestone: 9}}]])), null, 'chests outside the hall do not count');
assert.strictEqual(S.hallTotals(undefined), null);

(async () => {
  const {JOBS} = require('../bots');
  const layout = require('../storage-layout');
  const {Vec3} = require('vec3');
  const BASE = {x: -271, y: 66, z: -214};
  // chests: 'x,y,z' -> {room, items}; `index` is the hub's chest index (r.world.chests)
  const rig = ({carried, chests, index = hall, at = new Vec3(BASE.x + 100, 64, BASE.z)}) => {
    const items = carried.map(([name, count], i) => ({name, count, type: i + 1, metadata: null}));
    const world = new Map(Object.entries(chests).map(([k, c]) => [k, {...c, items: {...c.items}}]));
    const tossed = [], withdrawn = [];
    const blockAt = (p) => (world.has(`${p.x},${p.y},${p.z}`) ? {name: 'chest', position: new Vec3(p.x, p.y, p.z), boundingBox: 'block', getProperties: () => ({})} : p.y < 64 ? {name: 'stone', boundingBox: 'block', position: p} : {name: 'air', boundingBox: 'empty', position: p});
    const bot = {
      game: {dimension: 'minecraft:overworld'}, entity: {position: at}, food: 20, health: 20,
      registry: {foodsByName: {bread: {}}, blocksByName: {}}, slots: {},
      inventory: {slots: new Proxy({}, {get: () => ({})}), items: () => items.filter((i) => i.count > 0), emptySlotCount: () => 30},
      getEquipmentDestSlot: () => 1,
      tossStack: async (it) => { tossed.push(it.name); it.count = 0; },
      pathfinder: {searchRadius: 100, setGoal() {}, stop() {}, goto: async (g) => { bot.entity.position = new Vec3(g.x, g.y, g.z); }},
      blockAt,
      openContainer: async (block) => {
        const c = world.get(`${block.position.x},${block.position.y},${block.position.z}`);
        return {
          containerItems: () => Object.entries(c.items).map(([name, count]) => ({name, count, type: name, metadata: null})),
          deposit: async (type, meta, count) => {
            const it = items.find((i) => i.type === type);
            if (Object.values(c.items).reduce((a, b) => a + b, 0) + count > c.room) throw new Error('chest full');
            c.items[it.name] = (c.items[it.name] || 0) + count; it.count -= count;
          },
          withdraw: async (type, meta, count) => { withdrawn.push(type); delete c.items[type]; items.push({name: type, count, type: `w-${type}`, metadata: null}); },
          close() {},
        };
      },
    };
    const r = {bot, name: 'bot1', prefs: {}, protectedAreas: [], supplyChest: BASE, world: {chests: index, hostilesNear: () => [], noteStock() {}}, combat: {busy: false, epoch: 0},
      emit() {}, getSettings: () => ({torches: false}), gearTriedAt: Date.now(), pickaxeTriedAt: Date.now()};
    const left = () => Object.fromEntries(items.filter((i) => i.count > 0).map((i) => [i.name, i.count]));
    return {r, tossed, withdrawn, left, stored: (k) => world.get(k).items};
  };
  const job = (args) => ({type: 'deposit', args, t: {}, cancelled: false});
  const base = {[`${BASE.x},${BASE.y},${BASE.z}`]: {room: 1e6, items: {}}};
  const carried = [['cobblestone', 64], ['cobblestone', 64], ['oak_log', 10]];
  // 100 blocks out, the hall over its cap: one cobblestone stack is dropped (the other is the pillar stack), the logs go home
  let x = rig({carried, chests: base});
  await JOBS.deposit(x.r, job({...BASE}));
  assert.deepStrictEqual(x.tossed, ['cobblestone'], 'surplus stone dropped at the site, never logs');
  // 20 blocks from the chest: nothing is dropped (the bots would pick it up again)
  x = rig({carried, chests: base, at: new Vec3(BASE.x + 20, 64, BASE.z)});
  await JOBS.deposit(x.r, job({...BASE}));
  assert.deepStrictEqual(x.tossed, []);
  // a guest's own deposit is unchanged
  x = rig({carried, chests: {'3,64,0': {room: 1e6, items: {}}}});
  x.r.prefs = {chest: {x: 3, y: 64, z: 0}};
  await JOBS.deposit(x.r, job({own: true}));
  assert.deepStrictEqual(x.tossed, []);
  // a stale or empty index keeps everything
  x = rig({carried, chests: base, index: new Map()});
  await JOBS.deposit(x.r, job({...BASE}));
  assert.deepStrictEqual(x.tossed, []);

  // near the base with the hall full: over-quota cobblestone and room items stay with the bot, never back into the base chest
  const fullHall = Object.fromEntries(layout.SLOTS.map((c) => [layout.keyOf(c), {room: 0, items: {}}]));
  x = rig({carried: [['cobblestone', 64], ['dirt', 64]], chests: {...fullHall, [`${BASE.x},${BASE.y},${BASE.z}`]: {room: 1e6, items: {cobblestone: 128}}}, index: new Map(), at: new Vec3(BASE.x + 2, 66, BASE.z)});
  await JOBS.deposit(x.r, job({...BASE}));
  assert.deepStrictEqual(x.stored(`${BASE.x},${BASE.y},${BASE.z}`), {cobblestone: 128}, 'the base chest stays at its quota');
  assert.deepStrictEqual(x.left(), {cobblestone: 64, dirt: 64});
  // the carry-out takes a base-chest stack to the hall only when the index shows room in its category (or misc)
  const dirtChest = layout.keyOf(layout.chestsFor('dirt_sand')[0]);
  const near = {...fullHall, [`${BASE.x},${BASE.y},${BASE.z}`]: {room: 1e6, items: {dirt: 64}}};
  x = rig({carried: [], chests: near, index: new Map([[dirtChest, {items: {}, free: 0}]]), at: new Vec3(BASE.x + 2, 66, BASE.z)});
  await JOBS.deposit(x.r, job({...BASE}));
  assert.deepStrictEqual(x.withdrawn, [], 'a full hall: the dirt stays in the base chest');
  x = rig({carried: [], chests: near, index: new Map([[dirtChest, {items: {}, free: 5}]]), at: new Vec3(BASE.x + 2, 66, BASE.z)});
  await JOBS.deposit(x.r, job({...BASE}));
  assert.deepStrictEqual(x.withdrawn, ['dirt'], 'room in the dirt run: carried out');
  console.log('inventory: keep caps, hall caps ok');
})();
