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
const SOLD_OUT_MS = 10 * 60 * 1000; // no clock from the server, or out of reach: look again after this
// When a sold-out villager is worth a walk (64 fletchers measured over RCON, 2026-11-03): all of them refill within a
// second at day tick 2008-2028; inside work hours, up to 9000, one refills again 1200-2400 ticks after it was emptied
// (at most twice a day); from 9000 on nothing happens until the next morning.
const REFILL_TICK = 2040, WORK_END = 9000, WORK_AGAIN_TICKS = 2400, TICK_MS = 50;
const soldOutUntil = (timeOfDay, now) => {
  if (!Number.isFinite(timeOfDay)) return now + SOLD_OUT_MS;
  const tick = ((timeOfDay % 24000) + 24000) % 24000;
  if (tick >= REFILL_TICK && tick < WORK_END) return now + WORK_AGAIN_TICKS * TICK_MS;
  return now + ((REFILL_TICK - tick + 24000) % 24000) * TICK_MS;
};
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
    // Who buys no sticks at all (never) and who is sold out (until). On the bot: a fight calls the job again and the next
    // day's job starts anew, and neither must visit every villager again.
    const memo = (r.tradeMemo ||= new Map());
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
    // A chat trade (job.args.item) may end by time or by emerald count. pump resets job.t and startedAt on every run
    // but keeps other job fields, so the count and the deadline live on the job and survive an interruption.
    const {minutes, target} = job.args, chat = !!job.args.item;
    let sold = 0, emeralds = job.emeralds ?? job.t.done ?? 0, finished = false;
    if (minutes) job.tradeUntil ||= Date.now() + minutes * 60000;
    job.t.open = !(minutes || target); // open: the dashboard shows the count
    const credit = (n) => {
      emeralds += n;
      job.emeralds = job.t.done = emeralds;
      job.progress = `Smaragde: ${emeralds}`;
    };
    credit(0);
    if (target) job.t.total = target;
    const met = () => (target && emeralds >= target) || (job.tradeUntil && Date.now() >= job.tradeUntil);
    // Emerald blocks go into the chest (owner 2026-11-03); a rest under nine emeralds waits for the next round. Loose
    // emeralds are stored only when no block could be crafted (no crafting table in reach of the chest).
    const bank = async (rest = false) => {
      if (count(bot, 'emerald') >= 9) {
        job.t.doing = 'crafting emerald blocks';
        try { await ensureItem(r, job, 'emerald_block', count(bot, 'emerald_block') + Math.floor(count(bot, 'emerald') / 9)); } catch (e) { guard(job); r.emit('info', `trade: no emerald blocks: ${e.message.slice(0, 80)}`); }
      }
      const items = ['emerald_block', 'emerald'].filter((name) => count(bot, name) >= (name === 'emerald' && !rest ? 9 : 1));
      if (!items.length) return;
      job.t.doing = 'bringing the emeralds to the chest';
      for (const item of items) {
        let last;
        for (const store of stores) {
          try { await deposit(r, job, store, item); last = null; break; } catch (e) { guard(job); last = e; }
        }
        if (last) throw new Error(`no room for the emeralds: ${last.message}`);
      }
      r.emit('info', `trade: ${sold} trades this run, ${emeralds} emeralds in all, stored`);
    };
    // Loot from the fights on the way goes into storage (sticks, planks and tools stay; deposit's KEEP rules).
    const clear = async () => {
      // keep: an own deposit would otherwise file the sticks too
      if (r.prefs?.chest) { job.t.doing = 'bringing loot to storage'; await deposit(r, job, {own: true, keep: {stick: 2304}}); return; }
      if (!r.supplyChest) throw new Error('inventory full and no supply chest to empty it into');
      job.t.doing = 'bringing loot to storage';
      await deposit(r, job, r.supplyChest);
    };
    const wait = async (doing, ms = WAIT_MS) => {
      job.t.doing = doing;
      for (let t = 0; t < ms; t += 1000) { guard(job); await sleep(1000); }
    };
    // One pass: refill sticks, or bank, or one villager. A failed walk (no path through the protected town, a
    // chest out of reach) is tried again after a pause; three in a row at the same place end the job (a long walk
    // that stalls at a river and then goes on is no reason to stop).
    const step = async () => {
      guard(job);
      if (met()) { await bank(true); finished = true; return; } // the last walk to the chest is inside the retry loop
      const logs = bot.inventory.items().filter((i) => i.name.endsWith('_log')).reduce((n, i) => n + i.count, 0);
      // A round (owner 2026-11-03): under a stack of sticks (a price raised by demand is at most 64, so every offer stays
      // affordable) the emeralds go to the chest, then the inventory is filled from chest to chest before it trades again.
      if (count(bot, 'stick') < 64) job.tradeFilling = true;
      if (job.tradeFilling) {
        await bank();
        const first = job.args.sticksFirst;
        const chests = first ? [first, ...sticksAt()] : sticksAt();
        const c = (first && nextStickChest(bot.entity.position, empty, Date.now(), [first])) || nextStickChest(bot.entity.position, empty, Date.now(), chests);
        const room = bot.inventory.emptySlotCount() - 4; // four slots stay free for the emeralds of the next round
        if (c && room >= 1) {
          job.t.doing = 'taking sticks from the hall chests';
          // A chest half shows the whole double chest: both halves are passed over once one is empty.
          const dry = () => { for (const o of chests) if (o.x === c.x && o.y === c.y && Math.abs(o.z - c.z) <= 1) empty.set(`${o.x},${o.y},${o.z}`, Date.now() + EMPTY_MS); };
          const before = count(bot, 'stick');
          try {
            await withdraw(r, job, 'stick', room * 64, c);
            if (count(bot, 'stick') - before < room * 64) dry(); // it gave all it had: no second walk to it
          } catch (e) {
            guard(job);
            dry();
            if (!/^no stick/.test(e.message)) r.emit('info', `trade: stick chest at ${c.x} ${c.y} ${c.z}: ${e.message.slice(0, 80)}`);
          }
          return;
        }
        job.tradeFilling = false;
        if (count(bot, 'stick') < 64) {
          if (room < 1) { await clear(); return; }
          if (!logs) {
            if (!chat) { await wait('the stick chests are empty, waiting for a refill'); return; }
            try { await ensureItem(r, job, 'stick', 64); } catch {
              guard(job);
              throw Object.assign(new Error(`keine Sticks, Smaragde: ${emeralds}`), {final: true}); // not worth the retries
            }
            return;
          }
          job.t.doing = 'crafting sticks';
          await ensureItem(r, job, 'stick', Math.min(BATCH, count(bot, 'stick') + logs * 8));
        }
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
        // Exactly until the first one is due: no minute lost, no walk for nothing.
        const next = Math.min(...[...memo.values()].map((m) => m.until ?? Infinity));
        const ms = Number.isFinite(next) ? Math.max(1000, next - Date.now()) : WAIT_MS;
        r.emit('info', `trade: every villager is sold out, next restock in ${Math.round(ms / 1000)} s`);
        await wait('every villager is sold out, waiting for the restock', job.tradeUntil ? Math.min(ms, Math.max(1000, job.tradeUntil - Date.now())) : ms); // a time limit ends on time, not at the restock
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
          memo.set(key, buys ? {until: soldOutUntil(bot.time?.timeOfDay, Date.now())} : {never: true});
          return;
        }
        job.t.doing = 'trading sticks for emeralds';
        const plan = tradePlan(offers, count(bot, 'stick'));
        if (!plan.length) memo.set(key, {until: Date.now() + WAIT_MS}); // only after a restock of sticks
        for (const {index, times: wanted} of plan) {
          guard(job);
          // Not past the target: the trades that still fit.
          const per = win.trades[index].outputItem?.count || 1;
          const times = target ? Math.min(wanted, Math.ceil((target - emeralds) / per)) : wanted;
          if (times < 1) break;
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
          credit(times * per);
        }
        // Sold out, or the sticks ran out first (then it is visited again after crafting).
        if (!stickOffers(win.trades).length) memo.set(key, {until: soldOutUntil(bot.time?.timeOfDay, Date.now())});
      } finally {
        win.close();
      }
    };
    // Every run starts at the emerald chest (owner 2026-11-03); a failed walk there is no reason to give up the run.
    if (!job.tradeStarted) {
      job.tradeStarted = true;
      try { await goNear(r, job, stores[0].x, stores[0].y, stores[0].z, 3, {doing: 'walking to the emerald chest'}); } catch (e) { guard(job); r.emit('info', `trade: emerald chest out of reach: ${e.message.slice(0, 80)}`); }
    }
    for (let fails = 0, at = null; ;) {
      try { await step(); fails = 0; if (finished) return; } catch (e) {
        guard(job);
        if (e.final) throw e;
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

module.exports = {HALL, STORE, STICK_CHESTS, nextStickChest, stickOffers, tradePlan, nextVillager, soldOutUntil, inBox, makeTrade};
