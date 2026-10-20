'use strict';
// Standing orders: keep the supply chest stocked without anyone clicking.
//
// Quotas (item -> wanted amount) are declared in default.nix (KEEPER_QUOTAS).
// What is in the chest is known from the last bot that opened it (world.stock,
// reported by `deposit`, `withdraw` and `stock` jobs). Every few seconds, while
// switched on, the keeper
//   1. asks an idle bot to count the chest when the numbers are missing or old,
//   2. for the first quota below its target with nobody on it, gives an idle
//      bot a short job chain (chop/mine ..., deposit) through the same enqueue()
//      the dashboard uses, so everything a human can see or stop works here too.
// It starts switched off (or as it was, with a state file: server.js passes one) and never takes a bot that has a
// job or a queue. A bot that finishes without raising the stock puts that item
// on a cooldown, so a missing ore never turns into a loop.
const fs = require('node:fs');
const MAX_BOTS = 2; // bots the keeper may use at once
const IDLE_MS = 10000; // a bot must be idle this long before it is taken
const STOCK_MAX_AGE_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 10 * 60 * 1000; // after a chain that did not raise the stock
const ASSIGN_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_JOB = 64; // items per chain: short chains, fresh numbers in between

const KINDS = {
  logs: (n) => n.endsWith('_log'),
  coal: (n) => n === 'coal' || n === 'charcoal',
};
// A bot the keeper (and the plan) may give work: online, alive, no job, nothing queued.
const idle = (s) => !!s && s.online && !s.dead && !s.job && !s.queue.length;
const matcher = (key) => KINDS[key] || ((n) => n === key);
const have = (items, key) => Object.entries(items || {}).filter(([n]) => matcher(key)(n)).reduce((s, [, c]) => s + c, 0);

// How to make `n` more of a quota item: [[jobType, args], ...] or {blocked: why}.
// `c` is the chest {x,y,z}; `stock` the chest contents.
const PLANS = {
  logs: (n, c) => [['chop', {count: n}], ['deposit', {...c, only: 'logs'}]],
  cobblestone: (n, c) => [['mine', {block: 'stone', count: n}], ['deposit', {...c, only: 'cobblestone'}]],
  // Plenty of logs in the chest: burn charcoal instead of mining (coal veins ran dry, 2026-10-20). 2n logs: n smelted, the rest fuel;
  // 128 stay for torches and tools. KINDS.coal counts charcoal.
  coal: (n, c, stock) => have(stock, 'oak_log') >= 2 * n + 128
    ? [['withdraw', {item: 'oak_log', count: 2 * n, ...c}], ['smelt', {item: 'oak_log', count: n}], ['deposit', {...c, only: 'coal'}], ['deposit', {...c, only: 'logs'}]]
    : [['mine', {block: 'coal_ore', count: n}], ['deposit', {...c, only: 'coal'}]],
  // 1 coal + 1 stick make 4 torches; sticks need planks, planks need a log.
  torch: (n, c, stock) => {
    const coal = Math.ceil(n / 4);
    if (have(stock, 'coal') < coal) return {blocked: `needs ${coal} coal in the chest first`};
    if (have(stock, 'logs') < 1) return {blocked: 'needs a log in the chest (for the sticks)'};
    return [['withdraw', {item: 'coal', count: coal, ...c}], ['withdraw', {item: 'logs', count: Math.ceil(n / 32), ...c}], ['craft', {item: 'torch', count: n}], ['deposit', {...c, only: 'torch'}]];
  },
};
// Stone bricks, the bots' building stone (seal, shaft steps, fluid plugs): smelt cobblestone to stone, craft 4 stone
// into 4 bricks. The chest gives the cobblestone (plus 8 for a furnace), coal for the fuel and a log for a table.
PLANS.stone_bricks = (n, c, stock) => {
  const need = [['cobblestone', n + 8], ['coal', Math.ceil(n / 8)], ['logs', 1]];
  const short = need.find(([what, k]) => have(stock, what) < k);
  if (short) return {blocked: `needs ${short[1]} ${short[0]} in the chest first`};
  return [...need.map(([what, k]) => ['withdraw', {item: what, count: k, ...c}]), ['smelt', {item: 'cobblestone', count: n}], ['craft', {item: 'stone_bricks', count: n}], ['deposit', {...c, only: 'stone_bricks'}]];
};
// Spare pickaxes, so rearm finds one when a bot's breaks (4x "no pickaxe left" on the lab, 2026-10-10).
// A stone pickaxe is 3 cobblestone + 2 sticks; the logs make the sticks and one crafting table.
PLANS.stone_pickaxe = (n, c, stock) => {
  const logs = Math.ceil(n / 2) + 1;
  if (have(stock, 'cobblestone') < 3 * n) return {blocked: `needs ${3 * n} cobblestone in the chest first`};
  if (have(stock, 'logs') < logs) return {blocked: `needs ${logs} logs in the chest (for the sticks and a table)`};
  return [['withdraw', {item: 'cobblestone', count: 3 * n, ...c}], ['withdraw', {item: 'logs', count: logs, ...c}], ['craft', {item: 'stone_pickaxe', count: n}], ['deposit', {...c, only: 'stone_pickaxe'}]];
};
// Raw iron for the kit below; a mine job with this block keeps what it digs (bots.js ensureGear does not smelt it).
PLANS.raw_iron = (n, c) => [['mine', {block: 'iron_ore', count: n}], ['deposit', {...c, only: 'raw_iron'}]];
// Iron tools: the chest gives raw iron, coal for the furnace, 8 cobblestone for one and logs for the sticks and a
// table; the bot smelts, crafts and puts the tool back. Needs 3 (pickaxe) or 2 (sword) ingots per tool.
for (const [item, ingots] of [['iron_pickaxe', 3], ['iron_sword', 2]]) {
  PLANS[item] = (n, c, stock) => {
    const raw = ingots * n;
    const need = [['raw_iron', raw], ['coal', Math.ceil(raw / 8)], ['cobblestone', 8], ['logs', Math.ceil(n / 2) + 1]];
    const short = need.find(([what, k]) => have(stock, what) < k);
    if (short) return {blocked: `needs ${short[1]} ${short[0]} in the chest first`};
    return [...need.map(([what, k]) => ['withdraw', {item: what, count: k, ...c}]), ['smelt', {item: 'raw_iron', count: raw}], ['craft', {item, count: n}], ['deposit', {...c, only: item}]];
  };
}
// Any quota item without a chain above: let the acquire planner (bots.js getItem) find its own way, then shelve the result.
// shortcut: it does not know the keeper's reserves (128 logs, supply chest only); give an item its own PLANS entry when that matters.
const getPlan = (item) => (n, c) => [['get', {item, count: n}], ['deposit', {...c, only: item}]];
const WORKSITE = new Set(['chop', 'mine']); // jobs that start with a walk to the work site, when one is set

class Keeper {
  constructor({runners, world, chest, quotas, site = null, places = null, events = null, now = Date.now, log = () => {}, file = null}) {
    this.runners = runners;
    this.world = world;
    this.chest = chest; // {x,y,z} of the supply chest, or null: nothing to keep
    this.quotas = quotas; // [[item, want]]
    this.site = site;
    this.places = places;
    this.events = events;
    this.now = now;
    this.log = log;
    this.file = file;
    // On/off survives a restart: it came back off after the deploy and no standing order ran all night (main server 2026-10-18/19).
    // A missing or bad file means off.
    try { this.enabled = !!chest && JSON.parse(fs.readFileSync(file, 'utf8')).enabled === true; } catch { this.enabled = false; }
    this.work = new Map(); // item -> {bot, n, at, before, seen}
    this.counting = null; // {bot, at}: a bot is on its way to count the chest
    this.cooldown = new Map(); // item -> until
    this.notes = new Map(); // item -> why nothing is happening
    this.idleSince = new Map();
    this.lighting = new Map();
    this.lightWork = new Map();
  }

  say(text) {
    this.log('keeper', text);
    this.events?.add('keeper', 'info', text);
  }

  setEnabled(on) {
    if (on && !this.chest) throw new Error('no supply chest is configured, so there is nothing to keep stocked');
    if (this.enabled === !!on) return;
    this.enabled = !!on;
    if (this.file) try { fs.writeFileSync(`${this.file}.tmp`, JSON.stringify({enabled: this.enabled})); fs.renameSync(`${this.file}.tmp`, this.file); } catch {}
    this.work.clear();
    this.counting = null;
    this.cooldown.clear();
    this.say(this.enabled ? 'standing orders on' : 'standing orders off (bots finish what they are doing; use Stop to end it)');
  }

  snap(r) {
    try {
      return r.snapshot();
    } catch {
      return null;
    }
  }

  idle(s) {
    return idle(s);
  }

  tick() {
    if (!this.enabled) return;
    const t = this.now();
    const snaps = new Map();
    for (const r of this.runners.values()) {
      const s = this.snap(r);
      snaps.set(r.name, s);
      if (this.idle(s)) this.idleSince.has(r.name) || this.idleSince.set(r.name, t);
      else this.idleSince.delete(r.name);
    }
    const stock = this.world.stockAt(this.chest);
    this.finish(snaps, t, stock);

    const busy = new Set([...this.work.values()].map((w) => w.bot).concat(this.counting ? [this.counting.bot] : []));
    const free = () => [...this.runners.values()].filter((r) => !busy.has(r.name) && this.idle(snaps.get(r.name)) && t - (this.idleSince.get(r.name) ?? t) >= IDLE_MS)[0];

    // 1. numbers missing or old: have a bot read the chest
    if (!stock || t - stock.t > STOCK_MAX_AGE_MS) {
      if (!this.counting && busy.size < MAX_BOTS) {
        const r = free();
        // Busy from now: planLighting below gave the same bot a light job on top (keeper test, 2026-10-18).
        if (r) this.assign(r, [['stock', {...this.chest}]], () => { this.counting = {bot: r.name, at: t}; busy.add(r.name); }, 'counting what is in the supply chest');
      }
      this.planLighting(snaps, t, busy);
      return;
    }
    // 2. the quota that is shortest relative to its want and has nobody on it (the order of the list breaks a tie).
    // shortcut: urgency only, not the plan's cost or the bots' travel time; weigh those once the archive shows which plans run long.
    this.notes.clear();
    const short = [...this.quotas].map(([item, want]) => ({item, want, missing: want - have(stock.items, item) - (this.work.get(item)?.n || 0)}))
      .filter((q) => q.missing > 0 && !this.work.has(q.item)).sort((a, b) => b.missing / b.want - a.missing / a.want);
    for (const {item, want, missing} of short) {
      if ((this.cooldown.get(item) || 0) > t) {
        this.notes.set(item, `no progress last time, retrying in ${Math.ceil((this.cooldown.get(item) - t) / 60000)} min`);
        continue;
      }
      const plan = PLANS[item] || getPlan(item);
      const n = Math.min(missing, MAX_JOB);
      const jobs = plan(n, this.chest, stock.items);
      if (!Array.isArray(jobs)) {
        this.notes.set(item, jobs.blocked);
        continue;
      }
      if (busy.size >= MAX_BOTS) {
        this.notes.set(item, 'waiting for a free bot');
        continue;
      }
      const r = free();
      if (!r) {
        this.notes.set(item, 'waiting for an idle bot');
        continue;
      }
      const chain = this.site && WORKSITE.has(jobs[0][0]) ? [['goto', {...this.site}], ...jobs] : jobs;
      this.assign(r, chain, () => {
        this.work.set(item, {bot: r.name, n, at: t, before: have(stock.items, item), seen: false});
        busy.add(r.name);
      }, `${r.name}: ${item} ${have(stock.items, item)}/${want}, fetching ${n} (${jobs[0][0]} ...)`);
    }
    this.planLighting(snaps, t, busy);
  }

  planLighting(snaps, t, busy) {
    const idleDay = [...snaps.values()].some((s) => this.idle(s) && s.isDay === true);
    if (!idleDay) return;
    const dayFree = (ok = () => true) => [...this.runners.values()].find((r) => !busy.has(r.name) && this.idle(snaps.get(r.name)) && snaps.get(r.name)?.isDay === true && ok(snaps.get(r.name)) && t - (this.idleSince.get(r.name) ?? t) >= IDLE_MS);
    const placeList = typeof this.places === 'function' ? this.places()?.list : this.places?.list;
    const zones = (placeList || []).filter((p) => p.dim === 'overworld' && p.box && ['base', 'wheat', 'storage', 'treefarm'].includes(p.kind));
    for (const p of zones) {
      const key = `zone:${p.name}`;
      if ((this.lighting.get(key) || 0) > t || this.lightWork.has(key) || busy.size >= MAX_BOTS) continue;
      const r = dayFree(); if (!r) break;
      const chain = [['light', {...p.box, zone: p.name}]];
      this.assign(r, chain, () => { this.lightWork.set(key, {bot: r.name, at: t}); busy.add(r.name); }, `${r.name}: lighting ${p.name}`);
    }
    // A spawner seen lately (world blocks live 10 min): the job returns at once when a torch is on it already.
    for (const b of this.world.snapshot().blocks.filter((x) => x.type === 'spawner' && x.dim === 'overworld')) {
      const key = `spawner:${b.x},${b.y},${b.z}`;
      if ((this.lighting.get(key) || 0) > t || this.lightWork.has(key) || busy.size >= MAX_BOTS) continue;
      const r = dayFree((s) => s.fit); if (!r) break;
      this.assign(r, [['light', {spawner: {x: b.x, y: b.y, z: b.z}}]], () => { this.lightWork.set(key, {bot: r.name, at: t}); busy.add(r.name); }, `${r.name}: lighting spawner ${b.x} ${b.y} ${b.z}`);
    }
  }

  assign(r, chain, onOk, text) {
    try {
      for (const [type, args] of chain) r.enqueue(type, args, {replace: false});
    } catch (e) {
      r.enqueue('stop', {}, {});
      this.say(`could not give ${r.name} the job: ${e.message}`);
      return;
    }
    onOk();
    this.say(text);
  }

  // A chain is over when its bot is idle again (after having been seen busy), offline, or too slow.
  finish(snaps, t, stock) {
    for (const [key, w] of [...this.lightWork]) {
      const s = snaps.get(w.bot);
      if ((s && !this.idle(s)) || !s?.online || t - w.at > ASSIGN_TIMEOUT_MS) w.seen = true;
      if (!w.seen || (s?.online && !this.idle(s))) continue;
      this.lightWork.delete(key);
      this.lighting.set(key, t + (key.startsWith('spawner:') ? 24 * 60 : 30) * 60 * 1000);
      this.say(`${w.bot} finished ${key.startsWith('zone:') ? `lighting ${key.slice(5)}` : 'lighting a spawner'}`);
    }
    if (this.counting) {
      const s = snaps.get(this.counting.bot);
      if ((stock && stock.t >= this.counting.at) || t - this.counting.at > 5 * 60 * 1000 || !s?.online) this.counting = null;
    }
    for (const [item, w] of [...this.work]) {
      const s = snaps.get(w.bot);
      if (s && !this.idle(s)) w.seen = true;
      const over = (w.seen && this.idle(s)) || !s?.online || t - w.at > ASSIGN_TIMEOUT_MS || (!w.seen && t - w.at > 60000);
      if (!over) continue;
      this.work.delete(item);
      // The deposit at the end of every chain re-reads the chest, so a newer stock tells the result.
      const after = stock && stock.t > w.at ? have(stock.items, item) : null;
      if (after !== null && after <= w.before) {
        this.cooldown.set(item, t + COOLDOWN_MS);
        this.say(`${w.bot} is done with ${item}, but the chest did not get more (${w.before} -> ${after}); trying something else for ${COOLDOWN_MS / 60000} min`);
      } else this.say(`${w.bot} is done with ${item}${after !== null ? ` (${w.before} -> ${after} in the chest)` : ''}`);
    }
  }

  state() {
    const stock = this.world.stockAt(this.chest);
    const t = this.now();
    return {
      available: !!this.chest,
      enabled: this.enabled,
      chest: this.chest,
      site: this.site,
      stockAgeS: stock ? Math.round((t - stock.t) / 1000) : null,
      stockBy: stock?.by || null,
      quotas: this.quotas.map(([item, want]) => {
        const w = this.work.get(item);
        return {item, want, have: stock ? have(stock.items, item) : null, bot: w?.bot || null, fetching: w?.n || 0, note: w ? '' : this.notes.get(item) || ''};
      }),
      lighting: [...new Set([...this.lighting.keys(), ...this.lightWork.keys()])].map((key) => ({target: key, bot: this.lightWork.get(key)?.bot || null, nextAt: this.lighting.get(key) || null})),
      counting: this.counting?.bot || null,
    };
  }
}

// "logs:64,cobblestone:128" -> [['logs', 64], ['cobblestone', 128]]
function parseQuotas(text) {
  const out = [];
  for (const part of String(text || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z_]{1,32}):(\d{1,4})$/.exec(part);
    if (!m || +m[2] < 1 || +m[2] > 1728) throw new Error(`bad KEEPER_QUOTAS entry: ${part} (use item:amount, 1..1728)`);
    if (out.some(([i]) => i === m[1])) throw new Error(`duplicate KEEPER_QUOTAS item: ${m[1]}`);
    out.push([m[1], +m[2]]);
  }
  return out;
}

module.exports = {Keeper, parseQuotas, PLANS, have, idle, MAX_BOTS, IDLE_MS, COOLDOWN_MS, STOCK_MAX_AGE_MS};
