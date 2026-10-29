'use strict';
const {Vec3} = require('vec3');
// Trading hall (owner 2026-10-24): sell sticks to every villager on both floors of the hall that buys them (the
// fletchers) and put the emeralds into a chest. The sticks come from the owner's stick chests in the hall (logs the
// bot happens to carry are crafted into sticks too); with every chest empty it waits for a refill and never walks
// the 270 blocks to the base, a route that kept stranding bot5 under the river. The emeralds go into the owner's chests on
// the hall's south end (2026-10-24): the double chest at -25/-26 69 -95, then the one right of it. The job runs until stopped: when every
// villager is sold out it waits for their restock. The decisions are pure and tested in test/trade.js; makeTrade()
// wires them to a bot like graves.js.
// The hall: rows of cells at x -29 and -18, floors y 63 and 66, z -127..-96 (scanned over RCON 2026-10-24).
const HALL = {x1: -32, y1: 60, z1: -132, x2: -14, y2: 70, z2: -88};
const SOLD_OUT_MS = 10 * 60 * 1000; // villagers restock at their workstation up to twice a day (a day is 20 min)
const WAIT_MS = 60 * 1000; // all sold out: look again after this
// Both halves of a double chest open the whole chest: the first and, when it is full, the one to its right.
const STORE = [{x: -25, y: 69, z: -95}, {x: -27, y: 69, z: -95}];
// The owner's stick chests between the cell rows (one stack per half, 1284 sticks on 2026-10-24): the lower floor's
// centre row at x -22 (y 63 and 64), the upper floor's at x -24 (y 66 and 67). Taken before any logs are fetched.
const row = (x, y, zs) => zs.map((z) => ({x, y, z}));
const STICK_CHESTS = [
  ...row(-22, 63, [-123, -122, -120, -119, -115, -114, -112, -111, -109, -108, -106, -105, -102, -101, -99, -98]),
  ...row(-22, 64, [-122, -121, -119, -118, -114, -113, -111, -110, -108, -107, -105, -104, -101, -100, -98, -97]),
  ...row(-24, 66, [-122, -121, -119, -118, -116, -115, -113, -112, -109, -108, -106, -105, -102, -101]),
  ...row(-24, 67, [-121, -120, -118, -117, -115, -114, -112, -111, -108, -107, -105, -104, -101, -100]),
];
const EMPTY_MS = 10 * 60 * 1000; // an empty stick chest: look again after this (the owner refills them)
const STICKS = 640; // taken from the chests at a time
const BATCH = 320; // sticks crafted at a time (5 stacks), so logs, sticks and emeralds fit together

const inBox = (b, p) => p.x >= b.x1 && p.x <= b.x2 + 1 && p.y >= b.y1 && p.y <= b.y2 + 1 && p.z >= b.z1 && p.z <= b.z2 + 1;

// Offers of an open trade window that buy sticks for emeralds and have uses left, with their index for bot.trade.
function stickOffers(trades) {
  return (trades || []).map((t, index) => ({t, index})).filter(({t}) =>
    t.inputItem1?.name === 'stick' && !t.hasItem2 && t.outputItem?.name === 'emerald' &&
    !t.tradeDisabled && t.maximumNbTradeUses - t.nbTradeUses > 0)
    .map(({t, index}) => ({index, price: t.realPrice ?? t.inputItem1.count, left: t.maximumNbTradeUses - t.nbTradeUses}));
}

// How often each offer is used with `sticks` in hand, cheapest first; [] when not one trade is affordable.
function tradePlan(offers, sticks) {
  const plan = [];
  for (const o of [...offers].sort((a, b) => a.price - b.price)) {
    const times = Math.min(o.left, Math.floor(sticks / o.price));
    if (times < 1) continue;
    plan.push({index: o.index, times});
    sticks -= times * o.price;
  }
  return plan;
}

// The nearest villager in the hall that is not known to buy no sticks and not sold out; null when none is due.
function nextVillager(entities, from, memo, now, box = HALL) {
  let best = null, bestD = Infinity;
  for (const e of entities) {
    if (e.name !== 'villager' || !e.position || !inBox(box, e.position)) continue;
    const m = memo.get(e.uuid ?? e.id);
    if (m && (m.never || now < m.until)) continue;
    // A floor costs a walk round to the other stairs: weigh height like 8 blocks.
    const d = Math.hypot(e.position.x - from.x, e.position.z - from.z) + 8 * Math.abs(e.position.y - from.y);
    if (d < bestD) { best = e; bestD = d; }
  }
  return best;
}

// The nearest stick chest not found empty lately; null when all are.
function nextStickChest(from, empty, now, chests = STICK_CHESTS) {
  let best = null, bestD = Infinity;
  for (const c of chests) {
    if (now < (empty.get(`${c.x},${c.y},${c.z}`) || 0)) continue;
    const d = Math.hypot(c.x - from.x, c.z - from.z) + 8 * Math.abs(c.y - from.y);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}

function makeTrade({goNear, guard, sleep, count, ensureItem, withdraw, deposit}) {
  async function trade(r, job) {
    const {bot} = r;
    // Who buys no sticks at all (never) and who is sold out (until). On the job: the runner calls the job again
    // after a fight, and that must not visit every villager again.
    const memo = (job.tradeMemo ||= new Map());
    const empty = (job.emptyChests ||= new Map());
    // Another hall (Misa's, spec 2026-10-29) comes in the job's arguments: its box, store chests and, unless listed,
    // every other chest or barrel in the box as stick chests. Without them it is the owner's hall.
    const hall = job.args.hall || HALL;
    const stores = job.args.stores || (job.args.x !== undefined ? [{x: job.args.x, y: job.args.y, z: job.args.z}] : STORE);
    const sticksAt = () => {
      if (job.args.sticks) return job.args.sticks;
      if (!job.args.hall) return STICK_CHESTS;
      const c = {x: (hall.x1 + hall.x2) >> 1, y: (hall.y1 + hall.y2) >> 1, z: (hall.z1 + hall.z2) >> 1};
      const isStore = (p) => stores.some((o) => o.x === p.x && o.y === p.y && o.z === p.z);
      return bot.findBlocks({point: new Vec3(c.x, c.y, c.z), maxDistance: 64, count: 512, matching: (b) => /^(chest|trapped_chest|barrel)$/.test(b?.name)})
        .filter((p) => inBox(hall, p) && !isStore(p));
    };
    let sold = 0, emeralds = job.t.done || 0;
    job.t.open = true; // no end: the dashboard shows the count
    const bank = async () => {
      if (!count(bot, 'emerald')) return;
      job.t.doing = 'bringing the emeralds to the chest';
      let last;
      for (const store of stores) {
        try { await deposit(r, job, store, 'emerald'); last = null; break; } catch (e) { guard(job); last = e; }
      }
      if (last) throw new Error(`no room for the emeralds: ${last.message}`);
      r.emit('info', `trade: ${sold} trades this run, ${emeralds} emeralds in all, stored`);
    };
    // Loot from the fights on the way goes into storage (sticks, planks and tools stay; deposit's KEEP rules).
    const clear = async () => {
      if (!r.supplyChest) throw new Error('inventory full and no supply chest to empty it into');
      job.t.doing = 'bringing loot to storage';
      await deposit(r, job, r.supplyChest);
    };
    const wait = async (doing) => {
      job.t.doing = doing;
      for (let t = 0; t < WAIT_MS; t += 1000) { guard(job); await sleep(1000); }
    };
    // One pass: refill sticks, or bank, or one villager. A failed walk (no path through the protected town, a
    // chest out of reach) is tried again after a pause; three in a row at the same place end the job (a long walk
    // that stalls at a river and then goes on is no reason to stop).
    const step = async () => {
      guard(job);
      const logs = bot.inventory.items().filter((i) => i.name.endsWith('_log')).reduce((n, i) => n + i.count, 0);
      // At least a stack: a price raised by demand is at most 64 sticks, so every offer stays affordable.
      if (count(bot, 'stick') < 64) {
        const chests = sticksAt();
        const c = nextStickChest(bot.entity.position, empty, Date.now(), chests);
        if (c) {
          job.t.doing = 'taking sticks from the hall chests';
          // A chest half shows the whole double chest: both halves are passed over once one is empty.
          // Room is kept for the emeralds: with every slot full of sticks it would walk to the chest after each villager.
          const room = bot.inventory.emptySlotCount() - 4;
          if (room < 1) { await bank(); if (bot.inventory.emptySlotCount() - 4 < 1) await clear(); return; }
          try { await withdraw(r, job, 'stick', Math.min(STICKS, room * 64), c); } catch (e) {
            guard(job);
            for (const o of chests) if (o.x === c.x && o.y === c.y && Math.abs(o.z - c.z) <= 1) empty.set(`${o.x},${o.y},${o.z}`, Date.now() + EMPTY_MS);
            if (!/^no stick/.test(e.message)) r.emit('info', `trade: stick chest at ${c.x} ${c.y} ${c.z}: ${e.message.slice(0, 80)}`);
          }
          return;
        }
        if (!logs) { await bank(); await wait('the stick chests are empty, waiting for a refill'); return; }
        job.t.doing = 'crafting sticks';
        await ensureItem(r, job, 'stick', Math.min(BATCH, count(bot, 'stick') + logs * 8));
      }
      // Few free slots left: the emeralds go first.
      if (bot.inventory.emptySlotCount() < 2) {
        await bank();
        if (bot.inventory.emptySlotCount() < 2) await clear();
        if (bot.inventory.emptySlotCount() < 2) throw new Error('inventory full: no room for the emeralds of a trade');
        return;
      }
      const v = nextVillager(Object.values(bot.entities), bot.entity.position, memo, Date.now(), hall);
      if (!v) {
        await bank();
        if (!Object.values(bot.entities).some((e) => e.name === 'villager' && e.position && inBox(hall, e.position))) {
          await goNear(r, job, (hall.x1 + hall.x2) / 2, job.args.hall ? hall.y1 + 3 : 63, (hall.z1 + hall.z2) / 2, 6, {doing: 'walking to the trading hall'});
          return;
        }
        await wait('every villager is sold out, waiting for the restock');
        return;
      }
      const key = v.uuid ?? v.id;
      try {
        await goNear(r, job, v.position.x, v.position.y, v.position.z, 2, {doing: `walking to the villager at ${Math.floor(v.position.x)} ${Math.floor(v.position.y)} ${Math.floor(v.position.z)}`});
      } catch (e) {
        guard(job);
        memo.set(key, {until: Date.now() + SOLD_OUT_MS}); // out of reach for now: the others first
        r.emit('info', `trade: villager out of reach: ${e.message.slice(0, 80)}`);
        return;
      }
      guard(job);
      let win;
      try { win = await bot.openVillager(v); } catch (e) {
        guard(job);
        memo.set(key, {until: Date.now() + SOLD_OUT_MS});
        r.emit('info', `trade: could not open the villager: ${e.message.slice(0, 80)}`);
        return;
      }
      try {
        const offers = stickOffers(win.trades);
        if (!offers.length) {
          // A fletcher whose stick offer is used up still lists it (disabled); no stick offer at all: never.
          const buys = (win.trades || []).some((t) => t.inputItem1?.name === 'stick');
          memo.set(key, buys ? {until: Date.now() + SOLD_OUT_MS} : {never: true});
          return;
        }
        job.t.doing = 'trading sticks for emeralds';
        const plan = tradePlan(offers, count(bot, 'stick'));
        if (!plan.length) memo.set(key, {until: Date.now() + WAIT_MS}); // only after a restock of sticks
        for (const {index, times} of plan) {
          guard(job);
          // The server did not move the sticks in (26.1 bots through ViaBackwards, a fight closing the window):
          // this villager later, the others now.
          try { await bot.trade(win, index, times); } catch (e) {
            guard(job);
            memo.set(key, {until: Date.now() + WAIT_MS});
            r.emit('info', `trade: a trade failed: ${e.message.slice(0, 80)}`);
            break;
          }
          sold += times;
          // Counted from the offer: the inventory update can come after bot.trade returns.
          emeralds += times * (win.trades[index].outputItem?.count || 1);
        }
        job.t.done = emeralds;
        job.progress = `${emeralds} emeralds`;
        // Sold out, or the sticks ran out first (then it is visited again after crafting).
        if (!stickOffers(win.trades).length) memo.set(key, {until: Date.now() + SOLD_OUT_MS});
      } finally {
        win.close();
      }
    };
    for (let fails = 0, at = null; ;) {
      try { await step(); fails = 0; } catch (e) {
        guard(job);
        const p = bot.entity.position;
        if (at && Math.hypot(p.x - at.x, p.y - at.y, p.z - at.z) > 16) fails = 0;
        at = {x: p.x, y: p.y, z: p.z};
        if (++fails >= 3) throw e;
        r.emit('info', `trade: ${e.message.slice(0, 100)} (try ${fails} of 3, again in 30 s)`);
        for (let t = 0; t < 30000; t += 1000) { guard(job); await sleep(1000); }
      }
    }
  }
  return {trade};
}

module.exports = {HALL, STORE, STICK_CHESTS, nextStickChest, stickOffers, tradePlan, nextVillager, inBox, makeTrade};
