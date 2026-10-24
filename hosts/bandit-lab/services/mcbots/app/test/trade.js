'use strict';
const assert = require('node:assert');
const {HALL, STORE, STICK_CHESTS, nextStickChest, stickOffers, tradePlan, nextVillager, makeTrade} = require('../trade');
const {VALIDATE} = require('../bots');
// ---- trade: sticks for emeralds in the trading hall ----
const offer = (o = {}) => ({inputItem1: {name: 'stick', count: 32}, hasItem2: false, outputItem: {name: 'emerald'}, tradeDisabled: false, nbTradeUses: 0, maximumNbTradeUses: 16, realPrice: 32, ...o});
// Only stick -> emerald offers with uses left count; their window index is kept.
assert.deepStrictEqual(stickOffers([offer({inputItem1: {name: 'string', count: 24}}), offer({nbTradeUses: 4}), offer({tradeDisabled: true}), offer({outputItem: {name: 'arrow'}}), offer({nbTradeUses: 16})]),
  [{index: 1, price: 32, left: 12}]);
// Demand raised the price: realPrice counts, cheapest offer first, never more than the sticks allow.
assert.deepStrictEqual(tradePlan([{index: 0, price: 40, left: 16}, {index: 2, price: 32, left: 3}], 200), [{index: 2, times: 3}, {index: 0, times: 2}]);
assert.deepStrictEqual(tradePlan([{index: 0, price: 32, left: 16}], 31), []);
// The nearest due villager in the hall; the other floor weighs 8 blocks per level; known ones are passed over.
const v = (id, x, y, z, name = 'villager') => ({id, name, position: {x, y, z}});
const ents = [v(1, -28.5, 63, -110), v(2, -17.5, 66, -110), v(3, -28.5, 63, -100), v(4, -23, 63, -111, 'wandering_trader'), v(5, 0, 63, 0)];
const from = {x: -23, y: 66, z: -110};
assert.strictEqual(nextVillager(ents, from, new Map(), 0).id, 2);
assert.strictEqual(nextVillager(ents, from, new Map([[2, {never: true}]]), 0).id, 1);
assert.strictEqual(nextVillager(ents, from, new Map([[2, {never: true}], [1, {until: 50}]]), 10).id, 3);
assert.strictEqual(nextVillager(ents, from, new Map([[2, {never: true}], [1, {until: 50}]]), 60).id, 1); // restocked
assert.strictEqual(nextVillager(ents, from, new Map([[1, {never: true}], [2, {never: true}], [3, {never: true}]]), 0), null);
assert.ok(HALL.x1 < -29 && HALL.x2 > -18);
assert.deepStrictEqual(STORE.map((c) => c.x), [-25, -27]);
assert.deepStrictEqual(VALIDATE.trade({}), {});
assert.deepStrictEqual(VALIDATE.trade({x: 1, y: 64, z: 2}), {x: 1, y: 64, z: 2});
// The nearest stick chest of the owner's rows, the other floor weighing 8 per level; empty ones are passed over.
assert.deepStrictEqual(nextStickChest({x: -23, y: 63, z: -110}, new Map(), 0), {x: -22, y: 63, z: -111}); // -111 and -109 tie: the first in the row
assert.deepStrictEqual(nextStickChest({x: -23, y: 66, z: -110}, new Map(), 0), {x: -24, y: 66, z: -109});
assert.deepStrictEqual(nextStickChest({x: -23, y: 63, z: -110}, new Map(STICK_CHESTS.map((c) => [`${c.x},${c.y},${c.z}`, 99])), 50), null);
// Runs with a fake bot: sticks from a hall chest, a fletcher sold out, a cleric learned as never, the emeralds into the
// chest right of the full first one, then the Stop ends the wait. With every stick chest empty it waits, no base trip.
async function run(chestSticks) {
  const inv = {};
  const items = () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({name, count}));
  const fletcher = {...v(1, -28.5, 63, -110), uuid: 'f'}, cleric = {...v(2, -28.5, 63, -112), uuid: 'c'};
  const trades = {f: [offer({maximumNbTradeUses: 3})], c: [offer({inputItem1: {name: 'rotten_flesh', count: 32}})]};
  const opened = [];
  const job = {args: {}, t: {}, cancelled: false};
  const bot = {
    entity: {position: {x: -23, y: 63, z: -110}},
    entities: {1: fletcher, 2: cleric},
    inventory: {items, emptySlotCount: () => 30},
    async openVillager(e) { opened.push(e.uuid); return {trades: trades[e.uuid], close() {}}; },
    async trade(win, index, times) {
      const t = win.trades[index];
      inv.stick -= times * t.realPrice; inv.emerald = (inv.emerald || 0) + times; t.nbTradeUses += times;
    },
  };
  const calls = [];
  const {trade} = makeTrade({
    goNear: async () => {}, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
    sleep: async () => { job.cancelled = true; }, // the first wait: the owner presses Stop
    count: (b, name) => inv[name] || 0,
    ensureItem: async (r, j, name, want) => { const logs = Math.ceil((want - (inv.stick || 0)) / 8); inv.oak_log -= logs; inv.stick = (inv.stick || 0) + logs * 8; },
    withdraw: async (r, j, item, n, from) => {
      if (item === 'stick') {
        if (!chestSticks) throw new Error('no stick in the chest');
        calls.push(`withdraw stick at ${from.x} ${from.y} ${from.z}`);
        inv.stick = (inv.stick || 0) + chestSticks; chestSticks = 0;
        return;
      }
      calls.push(`withdraw ${item} ${n}`);
    },
    deposit: async (r, j, store, only) => {
      calls.push(`deposit ${only || 'loot'} at ${store.x}`);
      if (only && store.x === -25) throw new Error('chest full'); // the first chest is full: the one to its right
      if (only) inv.emerald = 0;
    },
  });
  const r = {bot, supplyChest: {x: -271, y: 66, z: -214}, emit: () => {}};
  await assert.rejects(trade(r, job), /stopped/);
  return {calls, opened: opened.sort(), inv, job};
}
(async () => {
  const a = await run(160);
  assert.deepStrictEqual(a.calls, ['withdraw stick at -22 63 -111', 'deposit emerald at -25', 'deposit emerald at -27']);
  assert.deepStrictEqual(a.opened, ['c', 'f']); // each once: the fletcher is sold out after 3, the cleric never buys
  assert.deepStrictEqual([a.inv.emerald, a.job.t.done, a.job.t.doing], [0, 3, 'every villager is sold out, waiting for the restock']);
  const b = await run(0);
  assert.deepStrictEqual([b.calls, b.opened, b.job.t.doing], [[], [], 'the stick chests are empty, waiting for a refill']);
  // A full inventory and a walk to storage that keeps failing at one place: two pauses, the third failure ends the job.
  let pauses = 0, tries = 0;
  const bot = {entity: {position: {x: -23, y: 63, z: -110}}, entities: {}, inventory: {items: () => [], emptySlotCount: () => 1}};
  const {trade} = makeTrade({
    goNear: async () => {}, guard: () => {}, sleep: async () => { pauses++; }, count: () => 0, ensureItem: async () => {},
    withdraw: async (r, j, item) => { if (item === 'stick') throw new Error('no stick in the chest'); },
    deposit: async (r, j, store, only) => { if (!only) { tries++; throw new Error('could not reach -68 66 -115: No path to the goal!'); } },
  });
  await assert.rejects(trade({bot, supplyChest: {x: -271, y: 66, z: -214}, emit: () => {}}, {args: {}, t: {}}), /No path/);
  assert.deepStrictEqual([tries, pauses], [3, 60]);
  console.log('trade ok');
})();
