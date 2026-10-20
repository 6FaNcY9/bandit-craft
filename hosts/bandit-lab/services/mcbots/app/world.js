'use strict';
// Shared situational picture, one per process: players (BlueMap, global),
// hostile mobs and notable blocks reported by any bot. Pure logic + a poller.

const MAPS = {world: 'overworld', world_the_nether: 'the_nether', world_the_end: 'the_end'};
const fs = require('node:fs');
const MOB_TTL_MS = 30000;
const BLOCK_TTL_MS = 600000;
const PLAYER_TTL_MS = 10000; // BlueMap polled every 2 s; older = stale, drop
const MAX_MOBS = 200;
const MAX_BLOCKS = 100;
const NOTABLE_BLOCKS = ['chest', 'trapped_chest', 'barrel', 'spawner', 'diamond_ore', 'deepslate_diamond_ore', 'ancient_debris', 'emerald_ore', 'deepslate_emerald_ore'];

// Hostile for the shared picture: mineflayer/minecraft-data classify mobs.
const isHostile = (e) => !!e && e.type !== 'player' && (e.type === 'hostile' || e.category === 'Hostile mobs');
// Hostile but never attacked: neutral unless provoked (enderman, piglins), or
// far too strong for a bot (warden, wither, dragon, elder guardian).
const NO_FIGHT = new Set(['enderman', 'zombified_piglin', 'piglin', 'piglin_brute', 'warden', 'wither', 'ender_dragon', 'elder_guardian', 'ghast', 'breeze']);
const shouldFight = (e) => isHostile(e) && !NO_FIGHT.has(e.name);

// Mineflayer does not move passengers with mounts; suspected spearing deaths, 2026-10-16.
const mobLocation = (e) => e.vehicle && e.vehicle.isValid !== false ? e.vehicle : e;

// 'minecraft:the_nether' / 'the_nether' / 'overworld' -> canonical name.
const normDim = (d) => String(d || '').replace(/^minecraft:/, '');

// Is the block column x,z inside one of the [x1,z1,x2,z2(,y1,y2)] boxes where bots never dig or place? With y, a box that
// has y bounds only covers those levels (bot2 sat 24 h under a hall zone: the 2D box walled off bedrock to sky, main server 2026-10-19);
// callers that pass no y stay 2D, the conservative reading.
const insideAreas = (areas, x, z, y) => areas.some(([x1, z1, x2, z2, y1, y2]) => x >= x1 && x <= x2 && z >= z1 && z <= z2 && (y == null || y1 == null || y2 == null || (y >= y1 && y <= y2)));

// Walking time budget: 90 s, plus 1 s per block of distance, capped at 10 min.
const deadlineMs = (dist) => Math.min(600000, 90000 + Math.max(0, Math.floor(dist || 0)) * 1000);

// BlueMap /maps/<map>/live/players.json -> [{name, uuid, x, y, z, dim}].
function parsePlayers(json, dim) {
  const out = [];
  for (const p of Array.isArray(json?.players) ? json.players : []) {
    if (p.foreign || typeof p.name !== 'string' || !/^\w{1,16}$/.test(p.name)) continue;
    const {x, y, z} = p.position || {};
    if (![x, y, z].every(Number.isFinite)) continue;
    out.push({name: p.name, uuid: String(p.uuid || ''), x, y, z, dim});
  }
  return out;
}

const CLAIM_TTL_MS = 120000;

// The cells of a shaft's staircase, clockwise along the walls of x1..x2 / z1..z2.
function stairRing(x1, z1, x2, z2) {
  const ring = [];
  for (let x = x1; x < x2; x++) ring.push({x, z: z1});
  for (let z = z1; z < z2; z++) ring.push({x: x2, z});
  for (let x = x2; x > x1; x--) ring.push({x, z: z2});
  for (let z = z2; z > z1; z--) ring.push({x: x1, z});
  return ring;
}

const EXPERIENCE_KEY = /^(?:(?:craft|smelt|mine|kill):[a-z_]{1,48}|chest:-?\d+,-?\d+,-?\d+:[a-z_]{1,48}|reach:[a-z_]{1,24}:-?\d+,-?\d+,-?\d+)$/;
// A block no walk reaches waits longer each time, 5 min doubling up to 2 h: a coal ore in a cave at -208 44 -169 cost
// three bots 90 s every 5 min all night (main server 2026-10-20). The wait is shared (experience key reach:), kept 4 h.
const backoff = (n) => Math.min(7200000, 300000 * 2 ** (n - 1));
const REACH_KEEP_MS = 4 * 3600000;
const validExperience = (v) => !!v && [v.ok, v.fail, v.streak, v.secs, v.units, v.lastFail, v.t].every((n) => Number.isFinite(n) && n >= 0);

class WorldModel {
  constructor({now = Date.now} = {}) {
    this.now = now;
    this.players = new Map(); // name -> {..., t}
    this.mobs = new Map(); // `${dim}:${id}` -> {id, type, x, y, z, dim, by, t}
    this.blocks = new Map(); // `${dim}:${x},${y},${z}` -> {type, x, y, z, dim, by, t}
    this.bluemap = {enabled: false, ok: false, error: '', t: 0};
    this.claims = new Map(); // `${dim}:${x},${y},${z}` -> {by, t}: blocks a bot is working on
    this.tally = new Map(); // bot -> {granted, refused, timedOut}: shown in /api/debug
    this.chests = new Map(); // storage index: "x,y,z" (smaller half of a double) -> {items: {name: count}, free, t}; fed by openChest()
    this.chestFile = null;
    this.stock = null; // what a bot last saw in any chest it counted: {items: {name: count}, by, free (empty slots or null), chest, t}
    this.stocks = new Map(); // "x,y,z" (or "" with no coordinates) -> the same, per chest: the keeper and the plan read only their own
    this.needs = new Map(); // `${bot}:${item}` -> {bot,item,count,to,why,t}
    this.experience = new Map(); // method key -> observed outcomes and time
    this.experienceFile = null;
  }

  // A block change seen by one of this process' bots (blocklog.js); recorded when the hub set a log.
  noteChange(c) {
    this.blocklog?.record(c);
  }

  // A bot that opened a chest reports its contents with the chest's coordinates (Codex R6-4: the plan's base
  // chest is not the supply chest, and one chest's numbers must not stand for the other's).
  noteStock(by, items, free = null, chest = null) {
    const c = chest && [chest.x, chest.y, chest.z].every(Number.isInteger) ? {x: chest.x, y: chest.y, z: chest.z} : null;
    this.stock = {items, by, free, chest: c, t: this.now()};
    this.stocks.set(c ? `${c.x},${c.y},${c.z}` : '', this.stock);
  }

  postNeed(bot, item, count, to, why = '') {
    if (typeof bot !== 'string' || !/^[a-z][a-z0-9]{0,15}$/.test(bot) || typeof item !== 'string' || !/^[a-z_]{1,48}$/.test(item) || !Number.isInteger(count) || count < 1 || count > 256 || !to || ![to.x,to.y,to.z].every(Number.isInteger) || typeof why !== 'string' || why.length > 160 || /[\u0000-\u001f\u007f]/.test(why)) throw new Error('invalid need');
    const need = {bot, item, count, to: {x: to.x, y: to.y, z: to.z}, why, t: this.now()};
    this.needs.set(`${bot}:${item}`, need);
    return need;
  }
  dropNeed(bot, item) { this.needs.delete(`${bot}:${item}`); }
  openNeeds(now = this.now()) { return [...this.needs.values()].filter((n) => now - n.t < 600000).sort((a,b) => a.t-b.t); }

  // How a planner way (acquire.js key) went, for every bot: in 8 h `get white_bed` tried kill:sheep 12 times and
  // cobwebs 22 times, each failure forgotten after 10 min by one bot only (main server 2026-10-18).
  learn(key, input = {}) {
    const {ok, secs = 0, units = 0} = input || {};
    if (!EXPERIENCE_KEY.test(key) || !input || typeof ok !== 'boolean' || !Number.isFinite(secs) || secs < 0 || !Number.isFinite(units) || units < 0) throw new Error('invalid experience');
    if (key.startsWith('reach:')) for (const [k, v] of this.experience) if (k.startsWith('reach:') && this.now() - v.t > REACH_KEEP_MS) this.experience.delete(k);
    const r = this.experience.get(key) || {ok: 0, fail: 0, streak: 0, secs: 0, units: 0, lastFail: 0, t: 0};
    if (ok) { r.ok++; r.streak = 0; r.secs += secs; r.units += units; }
    else { r.fail++; r.streak++; r.lastFail = this.now(); }
    r.t = this.now();
    if (r.ok + r.fail > 40) { r.ok = Math.floor(r.ok / 2); r.fail = Math.floor(r.fail / 2); r.secs = Math.floor(r.secs / 2); r.units = Math.floor(r.units / 2); }
    this.experience.set(key, r);
    if (this.experienceFile && !this.experienceTimer) {
      this.experienceTimer = setTimeout(() => {
        this.experienceTimer = null;
        try { fs.writeFileSync(`${this.experienceFile}.tmp`, JSON.stringify(Object.fromEntries(this.experience))); fs.renameSync(`${this.experienceFile}.tmp`, this.experienceFile); } catch {}
      }, 5000);
      this.experienceTimer.unref?.();
    }
  }

  // pOk is 1 without a failure: a way that worked must not look dearer than one never tried (sandbox 2026-10-18).
  // A craft or a smelt is only made dearer, never left out: it fails on the place (a table out of reach), and often
  // nothing else makes the item.
  learned(key, now = this.now()) {
    const r = this.experience.get(key);
    if (!r) return null;
    if (key.startsWith('reach:')) { const until = r.streak >= 1 && now - r.t < REACH_KEEP_MS ? r.lastFail + backoff(r.streak) : 0; return {each: null, pOk: 0, blocked: now < until, until}; }
    const until = r.streak >= 2 && !/^(craft|smelt):/.test(key) ? r.lastFail + Math.min(86400000, 600000 * 2 ** (r.streak - 2)) : 0;
    return {each: r.units >= 2 ? r.secs / r.units : null, pOk: (r.ok + 1) / (r.ok + r.fail + 1), blocked: now < until, until};
  }

  // A record as the hub has it (hubclient.js): taken over whole, nothing learned twice.
  noteExperience(key, v) {
    if (EXPERIENCE_KEY.test(key) && validExperience(v)) this.experience.set(key, {ok: v.ok, fail: v.fail, streak: v.streak, secs: v.secs, units: v.units, lastFail: v.lastFail, t: v.t});
  }

  persistExperience(file) {
    this.experienceFile = file;
    try {
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) this.noteExperience(k, v);
    } catch {}
  }

  // What was last seen in this chest (an observation without coordinates counts for any chest: older callers and tests).
  stockAt(chest) {
    return (chest && this.stocks.get(`${chest.x},${chest.y},${chest.z}`)) || this.stocks.get('') || null;
  }

  // The storage index (survives restarts: STATE_DIR/chests.json, written at most every 5 s).
  persistChests(file) {
    this.chestFile = file;
    try {
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) if (/^-?\d+,-?\d+,-?\d+$/.test(k) && v && typeof v.items === 'object') this.chests.set(k, {items: v.items, free: v.free ?? null, t: Number(v.t) || 0});
    } catch {} // missing or unreadable: empty
  }

  noteChest(key, items, free = null) {
    this.chests.set(key, {items, free, t: this.now()});
    if (!this.chestFile || this.chestTimer) return;
    this.chestTimer = setTimeout(() => {
      this.chestTimer = null;
      try {
        fs.writeFileSync(`${this.chestFile}.tmp`, JSON.stringify(Object.fromEntries(this.chests)));
        fs.renameSync(`${this.chestFile}.tmp`, this.chestFile);
      } catch {}
    }, 5000);
    this.chestTimer.unref?.();
  }

  // Where is it: items whose name contains q -> [{item, total, where: [{x, y, z, count, ageS}]}], biggest stack first.
  findItems(q) {
    const t = this.now(), out = new Map();
    for (const [key, c] of this.chests) {
      const [x, y, z] = key.split(',').map(Number);
      for (const [item, count] of Object.entries(c.items)) {
        if (!item.includes(q)) continue;
        const e = out.get(item) || {item, total: 0, where: []};
        e.total += count;
        e.where.push({x, y, z, count, ageS: Math.round((t - c.t) / 1000)});
        out.set(item, e);
      }
    }
    return [...out.values()].map((e) => ({...e, where: e.where.sort((a, b) => b.count - a.count)})).sort((a, b) => b.total - a.total);
  }

  // Bots share one process, so claims are exact: a bot only takes a block no
  // other bot holds. Claims expire after CLAIM_TTL_MS in case a bot dies.
  claim(by, key) {
    const c = this.claims.get(key);
    if (c && c.by !== by && this.now() - c.t < CLAIM_TTL_MS) {
      this.count(by, 'refused');
      return false;
    }
    this.claims.set(key, {by, t: this.now()});
    this.count(by, 'granted');
    return true;
  }

  count(by, kind) {
    const t = this.tally.get(by) || {granted: 0, refused: 0, timedOut: 0};
    t[kind]++;
    this.tally.set(by, t);
  }

  claimStats(by) {
    return {...(this.tally.get(by) || {granted: 0, refused: 0, timedOut: 0})};
  }

  // Shaft strips are claimed for the whole job as two keys, `shaft:x1,top,z1` and `shaftend:x2,bottom,z2`
  // (the hub's key format); another bot's stair steps stay standing wherever it digs (Codex R6-1).
  stepHeldByOther(by, x, y, z) {
    const t = this.now();
    for (const [k, c] of this.claims) {
      if (c.by === by || !k.startsWith('shaft:') || t - c.t >= CLAIM_TTL_MS) continue;
      const [x1, top, z1] = k.slice(6).split(',').map(Number);
      const endKey = [...this.claims].find(([e, v]) => e.startsWith('shaftend:') && v.by === c.by)?.[0];
      if (!endKey) continue;
      const [x2, bottom, z2] = endKey.slice(9).split(',').map(Number);
      if (x < x1 || x > x2 || z < z1 || z > z2 || y < bottom || y > top || (x !== x1 && x !== x2 && z !== z1 && z !== z2)) continue;
      const ring = stairRing(x1, z1, x2, z2);
      const step = ring[(top - y) % ring.length];
      if (step.x === x && step.z === z) return true;
    }
    return false;
  }

  release(by, key) {
    if (this.claims.get(key)?.by === by) this.claims.delete(key);
  }

  // A disconnected bot (or worker) must not keep blocks reserved.
  releaseAll(by) {
    for (const [k, c] of this.claims) if (c.by === by) this.claims.delete(k);
  }

  // True when claims cannot be checked against the shared table (a worker that
  // lost the hub): jobs that dig refuse to start instead of risking a block
  // another bot holds.
  get unreachable() {
    return false;
  }

  // Live claims of one bot: expired ones must not count towards a per-bot cap.
  held(by) {
    const t = this.now();
    let n = 0;
    for (const c of this.claims.values()) if (c.by === by && t - c.t < CLAIM_TTL_MS) n++;
    return n;
  }

  claimedByOther(by, key) {
    const c = this.claims.get(key);
    return !!c && c.by !== by && this.now() - c.t < CLAIM_TTL_MS;
  }

  setPlayers(list) {
    const t = this.now();
    this.players = new Map(list.map((p) => [p.name, {...p, t}]));
    this.bluemap.t = t;
  }

  player(name) {
    const p = this.players.get(name);
    return p && this.now() - p.t <= PLAYER_TTL_MS ? p : undefined;
  }

  noteMob(by, e, dim) {
    const {x, y, z} = mobLocation(e).position;
    this.mobs.set(`${dim}:${e.id}`, {id: e.id, type: e.name, x, y, z, dim, by, t: this.now()});
    this.trim(this.mobs, MAX_MOBS);
  }

  forgetMob(id) {
    for (const k of this.mobs.keys()) if (k.endsWith(`:${id}`)) this.mobs.delete(k);
  }

  noteBlock(by, type, pos, dim) {
    this.blocks.set(`${dim}:${pos.x},${pos.y},${pos.z}`, {type, x: pos.x, y: pos.y, z: pos.z, dim, by, t: this.now()});
    this.trim(this.blocks, MAX_BLOCKS);
  }

  // Drop the oldest entries beyond the cap (Map keeps insertion order; a
  // re-set of an existing key keeps its slot, so sort by last-seen).
  trim(map, max) {
    if (map.size <= max) return;
    const oldest = [...map.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, map.size - max);
    for (const [k] of oldest) map.delete(k);
  }

  prune() {
    const t = this.now();
    for (const [k, m] of this.mobs) if (t - m.t > MOB_TTL_MS) this.mobs.delete(k);
    for (const [k, b] of this.blocks) if (t - b.t > BLOCK_TTL_MS) this.blocks.delete(k);
    for (const [k, p] of this.players) if (t - p.t > PLAYER_TTL_MS) this.players.delete(k);
    for (const [k, c] of this.claims) if (t - c.t >= CLAIM_TTL_MS) this.claims.delete(k);
  }

  // y: only mobs within 8 blocks of that height (a cave or a dark space under a build is not near).
  hostilesNear(x, z, dim, r, y = null) {
    this.prune();
    return [...this.mobs.values()].filter((m) => m.dim === dim && Math.hypot(m.x - x, m.z - z) <= r && (y == null || m.y == null || Math.abs(m.y - y) <= 8));
  }

  snapshot() {
    this.prune();
    const t = this.now();
    const age = (o) => ({...o, age: Math.round((t - o.t) / 1000)});
    return {
      bluemap: {...this.bluemap, age: this.bluemap.t ? Math.round((t - this.bluemap.t) / 1000) : null},
      players: [...this.players.values()].map(age),
      mobs: [...this.mobs.values()].map(age),
      blocks: [...this.blocks.values()].map(age),
      claims: [...this.claims].map(([key, c]) => ({key, by: c.by})),
      stock: this.stock && {items: this.stock.items, by: this.stock.by, free: this.stock.free, ...(this.stock.chest ? {chest: this.stock.chest} : {}), age: Math.round((t - this.stock.t) / 1000)}, // the supply chest as last seen
    };
  }
}

// Poll BlueMap every 2 s. Failures only mark the model degraded: bots keep
// working from entity tracking.
function startBlueMap(world, baseUrl, log, fetchFn = fetch) {
  if (!baseUrl) return () => {};
  world.bluemap.enabled = true;
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const lists = await Promise.all(Object.entries(MAPS).map(async ([map, dim]) => {
        const res = await fetchFn(`${baseUrl.replace(/\/+$/, '')}/maps/${map}/live/players.json`, {signal: AbortSignal.timeout(1500)});
        if (!res.ok) throw new Error(`${map}: HTTP ${res.status}`);
        return parsePlayers(await res.json(), dim);
      }));
      world.setPlayers(lists.flat());
      if (!world.bluemap.ok) log('bluemap', 'player positions available');
      Object.assign(world.bluemap, {ok: true, error: ''});
    } catch (e) {
      const err = String(e.cause?.code || e.message || e);
      if (world.bluemap.ok || world.bluemap.error !== err) log('bluemap', `unavailable: ${err}`);
      Object.assign(world.bluemap, {ok: false, error: err});
    } finally {
      busy = false;
    }
  };
  poll();
  const timer = setInterval(poll, 2000);
  return () => clearInterval(timer);
}

module.exports = {backoff, CLAIM_TTL_MS, stairRing, WorldModel, startBlueMap, parsePlayers, mobLocation, isHostile, shouldFight, normDim, deadlineMs, insideAreas, NOTABLE_BLOCKS, MAPS, MOB_TTL_MS, MAX_MOBS, MAX_BLOCKS, NO_FIGHT};
