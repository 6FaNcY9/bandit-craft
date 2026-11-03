'use strict';
const assert = require('node:assert');
const {HALL, STORE, STICK_CHESTS, nextStickChest, stickOffers, tradePlan, nextVillager, soldOutUntil, makeTrade} = require('../trade');
const {VALIDATE} = require('../bots');
// ---- trade: sticks for emeralds in the trading hall ----
const offer = (o = {}) => ({inputItem1: {name: 'stick', count: 32}, hasItem2: false, outputItem: {name: 'emerald'}, tradeDisabled: false, nbTradeUses: 0, maximumNbTradeUses: 16, realPrice: 32, ...o});
// Only stick -> emerald offers with uses left count; their window index is kept.
assert.deepStrictEqual(stickOffers([offer({inputItem1: {name: 'string', count: 24}}), offer({nbTradeUses: 4}), offer({tradeDisabled: true}), offer({outputItem: {name: 'arrow'}}), offer({nbTradeUses: 16})]),
  [{index: 1, price: 32, left: 12}]);
// Demand raised the price: realPrice counts, cheapest offer first, never more than the sticks allow.
assert.deepStrictEqual(tradePlan([{index: 0, price: 40, left: 16}, {index: 2, price: 32, left: 3}], 200), [{index: 2, times: 3}, {index: 0, times: 2}]);
assert.deepStrictEqual(tradePlan([{index: 0, price: 32, left: 16}], 31), []);
// A sold-out villager is due again by the game's clock: in work hours soon, otherwise at the next morning's refill.
assert.strictEqual(soldOutUntil(5000, 1000), 1000 + 2400 * 50);
assert.strictEqual(soldOutUntil(9000, 0), (24000 - 9000 + 2040) * 50);
assert.strictEqual(soldOutUntil(23000, 0), (24000 - 23000 + 2040) * 50);
assert.strictEqual(soldOutUntil(2000, 0), 40 * 50, 'just before the refill');
assert.strictEqual(soldOutUntil(undefined, 0), 10 * 60 * 1000, 'no clock');
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
async function run(chestSticks, start = {}, chestsWithSticks = 1) {
  const walks = [];
  const inv = {...start};
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
    goNear: async (r, j, x, y, z) => { walks.push(`walk ${x} ${y} ${z}`); }, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
    sleep: async () => { job.cancelled = true; }, // the first wait: the owner presses Stop
    count: (b, name) => inv[name] || 0,
    ensureItem: async (r, j, name, want) => {
      if (name === 'emerald_block') { const n = want - (inv.emerald_block || 0); inv.emerald -= n * 9; inv.emerald_block = (inv.emerald_block || 0) + n; return; }
      const logs = Math.ceil((want - (inv.stick || 0)) / 8); inv.oak_log -= logs; inv.stick = (inv.stick || 0) + logs * 8;
    },
    withdraw: async (r, j, item, n, from) => {
      if (item === 'stick') {
        if (!chestSticks || !chestsWithSticks) throw new Error('no stick in the chest');
        calls.push(`withdraw stick ${n} at ${from.x} ${from.y} ${from.z}`);
        inv.stick = (inv.stick || 0) + chestSticks;
        if (!--chestsWithSticks) chestSticks = 0;
        return;
      }
      calls.push(`withdraw ${item} ${n}`);
    },
    deposit: async (r, j, store, only) => {
      calls.push(`deposit ${only || 'loot'} at ${store.x}`);
      if (only && store.x === -25) throw new Error('chest full'); // the first chest is full: the one to its right
      if (only) inv[only] = 0;
    },
  });
  const r = {bot, supplyChest: {x: -271, y: 66, z: -214}, emit: () => {}};
  await assert.rejects(trade(r, job), /stopped/);
  return {calls, opened: opened.sort(), inv, job, walks};
}
(async () => {
  const a = await run(160);
  assert.deepStrictEqual(a.calls, ['withdraw stick 1664 at -22 63 -111']); // three emeralds: no block yet, they stay in the inventory
  assert.deepStrictEqual(a.opened, ['c', 'f']); // each once: the fletcher is sold out after 3, the cleric never buys
  assert.deepStrictEqual([a.inv.emerald, a.job.t.done, a.job.t.doing], [3, 3, 'every villager is sold out, waiting for the restock']);
  const b = await run(0);
  assert.deepStrictEqual([b.calls, b.opened, b.job.t.doing], [[], [], 'the stick chests are empty, waiting for a refill']);
  // Emeralds left from the last round become blocks and go to the chest (the full first chest, then the one right of
  // it) before the refill; the refill fills every slot but four; the rest under nine stays.
  const c = await run(160, {emerald: 20});
  assert.deepStrictEqual(c.calls.slice(0, 3), ['deposit emerald_block at -25', 'deposit emerald_block at -27', 'withdraw stick 1664 at -22 63 -111']);
  assert.strictEqual(c.inv.emerald, 2 + 3);
  // The inventory is filled from chest to chest: a chest that gave all it had is not walked to again, the next one is.
  const f = await run(160, {}, 2);
  assert.deepStrictEqual(f.calls.filter((l) => l.startsWith('withdraw')).length, 2);
  assert.notStrictEqual(f.calls[0], f.calls[1]);
  assert.deepStrictEqual(f.walks[0], 'walk -25 69 -95', 'the run starts at the emerald chest');
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
  // ---- chat trades with a stop condition: handel sticks [time|target] ----
  // One fletcher paying `pay` emeralds for each stick; chests maps "x,y,z" to the sticks in it.
  const rig = ({args = {}, inv = {}, chests = {}, pay = 1, uses = 100, job: more = {}, prefs, slots = 30, ensure, sleep, supply} = {}) => {
    const stock = {...inv}, calls = [], pauses = [], tradeCalls = [], opened = [];
    const fletcher = {...v(1, -28.5, 63, -110), uuid: 'f'};
    const trades = [offer({inputItem1: {name: 'stick', count: 1}, realPrice: 1, outputItem: {name: 'emerald', count: pay}, maximumNbTradeUses: uses})];
    const job = {args, t: {}, cancelled: false, ...more};
    const bot = {
      entity: {position: {x: -23, y: 63, z: -110}}, entities: {1: fletcher},
      inventory: {items: () => Object.entries(stock).filter(([, n]) => n > 0).map(([name, count]) => ({name, count})), emptySlotCount: () => slots},
      async openVillager(e) { opened.push(e.uuid); return {trades, close() {}}; },
      async trade(win, index, times) { tradeCalls.push(times); stock.stick -= times; stock.emerald = (stock.emerald || 0) + times * pay; win.trades[index].nbTradeUses += times; },
    };
    const {trade} = makeTrade({
      goNear: async () => {}, guard: (j) => { if (j.cancelled) throw new Error('stopped'); },
      sleep: sleep || (async () => { pauses.push(1); job.cancelled = true; }),
      count: (b, name) => stock[name] || 0,
      ensureItem: ensure || (async (r, j, name, want) => {
        if (name !== 'emerald_block') throw new Error('unexpected ensureItem');
        const n = want - (stock.emerald_block || 0); stock.emerald -= n * 9; stock.emerald_block = (stock.emerald_block || 0) + n;
      }),
      withdraw: async (r, j, item, n, from) => {
        const key = `${from.x},${from.y},${from.z}`;
        calls.push(`withdraw ${key}`);
        if (calls.length > 100) job.cancelled = true; // a chest retried for ever fails the test instead of hanging it (a full sweep is about 30)
        if (!chests[key]) throw new Error('no stick in the chest');
        stock.stick = (stock.stick || 0) + chests[key]; chests[key] = 0;
      },
      deposit: async (r, j, store, only) => {
        calls.push(`deposit ${only || JSON.stringify(store)} ${store.own ? 'own' : store.x}`);
        if (only) stock[only] = 0; else job.cancelled = true; // the loot walk ends the run
      },
    });
    const r = {bot, emit: () => {}, supplyChest: supply, prefs};
    return {run: () => trade(r, job), job, stock, calls, pauses, tradeCalls, opened};
  };
  const hallChest = '-22,63,-111';
  // A target ends the job and stores the loose emeralds too; the count is on the job.
  let k = rig({args: {item: 'stick', target: 3}, inv: {stick: 100}});
  await k.run();
  assert.deepStrictEqual([k.job.progress, k.job.t.done, k.job.t.total, k.job.t.open, k.job.emeralds], ['Smaragde: 3', 3, 3, false, 3]);
  assert.deepStrictEqual(k.tradeCalls, [3], 'no overshoot: the 100 sticks would have paid 100 emeralds');
  assert.deepStrictEqual([k.stock.stick, k.stock.emerald], [97, 0]);
  assert.deepStrictEqual(k.calls, ['deposit emerald -25'], 'the 3 loose emeralds go to the chest at the end');
  // An offer paying 2 per trade: 3 are needed, so 2 trades (4 emeralds) is the least that reaches it.
  k = rig({args: {item: 'stick', target: 3}, inv: {stick: 100}, pay: 2});
  await k.run(); assert.deepStrictEqual([k.tradeCalls, k.job.progress], [[2], 'Smaragde: 4']);
  // A resumed job counts what it had: 2 done, one more. pump resets job.t, so the count lives on the job.
  k = rig({args: {item: 'stick', target: 3}, inv: {stick: 100, emerald: 2}, job: {emeralds: 2}});
  await k.run(); assert.deepStrictEqual([k.tradeCalls, k.job.progress, k.job.t.done], [[1], 'Smaragde: 3', 3]);
  // The time limit stays through a resume: a deadline in the past ends the job at once, with a fresh job.t.
  k = rig({args: {item: 'stick', minutes: 5}, inv: {stick: 100}, job: {tradeUntil: Date.now() - 1, emeralds: 4}});
  await k.run(); assert.deepStrictEqual([k.opened, k.job.progress, k.job.t.open], [[], 'Smaragde: 4', false]);
  // minutes: runs, then ends after the limit even with villagers sold out (the wait is where it is noticed)
  k = rig({args: {item: 'stick', minutes: 0.001}, inv: {stick: 64}, uses: 3, sleep: () => new Promise((res) => setTimeout(res, 30)), ensure: async (r, j, name) => { if (name === 'stick') k.stock.stick = 64; }});
  await k.run(); assert.ok(k.job.tradeUntil > 0); assert.deepStrictEqual([k.job.progress, k.stock.emerald], ['Smaragde: 3', 0]);
  // The restock can be 20 minutes away: a time limit does not wait for it.
  let naps = 0;
  k = rig({args: {item: 'stick', minutes: 0.001}, inv: {stick: 64}, uses: 3, sleep: () => { naps++; return new Promise((res) => setTimeout(res, 30)); }, ensure: async (r, j, name) => { if (name === 'stick') k.stock.stick = 64; }});
  await k.run(); assert.ok(naps < 20, `${naps} naps`);
  // Time up before any trade: the count is 0 and says so.
  k = rig({args: {item: 'stick', minutes: 1}, job: {tradeUntil: 1}});
  await k.run(); assert.strictEqual(k.job.progress, 'Smaragde: 0');
  // The hall's trades without an item (hub or schedule) keep running until stopped; the count is German now.
  k = rig({args: {}, inv: {stick: 100}});
  await assert.rejects(k.run(), /stopped/); assert.deepStrictEqual([k.job.progress, k.job.t.open], ['Smaragde: 100', true]);
  // No sticks anywhere and no logs: a chat trade stops at once (no 3 x 30 s of retries) and says what it got.
  const noSticks = async () => { throw new Error('need 8 more planks and have no logs (chop first)'); };
  k = rig({args: {item: 'stick', target: 50}, inv: {emerald: 4}, job: {emeralds: 4}, ensure: noSticks});
  await assert.rejects(k.run(), /^Error: keine Sticks, Smaragde: 4$/); assert.deepStrictEqual(k.pauses, []);
  // ... but ensureItem may fetch logs and craft: then it trades on.
  let crafted = 0;
  k = rig({args: {item: 'stick', target: 2}, ensure: async (r, j, name) => { if (name === 'stick') { crafted++; k.stock.stick = 64; } }});
  await k.run(); assert.deepStrictEqual([crafted, k.job.progress], [1, 'Smaragde: 2']);
  // A scheduled trade still waits for a refill.
  k = rig({args: {}, ensure: noSticks});
  await assert.rejects(k.run(), /stopped/); assert.strictEqual(k.job.t.doing, 'the stick chests are empty, waiting for a refill');
  // sticksFirst: the own chest before the hall's; when it is empty it is passed over like the others.
  const own = {x: 5, y: 6, z: 7};
  k = rig({args: {item: 'stick', target: 1, sticksFirst: own, stores: [own]}, chests: {[hallChest]: 100}});
  await k.run(); assert.deepStrictEqual(k.calls.slice(0, 2), ['withdraw 5,6,7', `withdraw ${hallChest}`]);
  assert.strictEqual(k.calls.filter((c) => c === 'withdraw 5,6,7').length, 1, 'an empty own chest is not tried again');
  k = rig({args: {item: 'stick', target: 1, sticksFirst: own, stores: [own]}, chests: {'5,6,7': 100, [hallChest]: 100}});
  await k.run(); assert.strictEqual(k.calls.filter((c) => c.startsWith('withdraw'))[0], 'withdraw 5,6,7'); // then on from chest to chest until full
  assert.strictEqual(k.calls.filter((c) => c === 'withdraw 5,6,7').length, 1);
  // With an own chest, loot goes there (no supply chest needed) and the sticks stay.
  k = rig({args: {item: 'stick', target: 5}, chests: {[hallChest]: 100}, slots: 3, prefs: {chest: own}});
  await assert.rejects(k.run(), /stopped/);
  assert.deepStrictEqual(k.calls.filter((c) => c.startsWith('deposit')), ['deposit {"own":true,"keep":{"stick":2304}} own']);
  console.log('trade ok');
})();
