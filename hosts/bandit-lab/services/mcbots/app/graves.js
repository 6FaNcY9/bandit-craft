'use strict';
// Graves (AxGraves): a dead bot's items wait in a packet-based grave entity for 24 h; only the owner can
// take them, by sneaking and right-clicking it. `grave` walks there, does that and puts the loot into the
// supply chest. The decisions (which entity is the grave, whether to go after a death, which armour to
// wear) are pure and tested in test.js with plain objects; makeGraves() wires them to a bot like hunt.js.
const {Vec3} = require('vec3');
const {insideAreas, normDim} = require('./world');
const fs = require('node:fs');
const path = require('node:path');

const REACH = 3; // the grave entity lies within this many blocks of the death position
const FAR = 1500; // a death further than this from the base is not worth the walk
const NOT_GRAVE = new Set(['item', 'experience_orb', 'arrow', 'trident', 'falling_block']);
const DEATH = /^died at (-?\d+) (-?\d+) (-?\d+):/;
const FETCHED = /^finished: grave(?: at)? (-?\d+) (-?\d+) (-?\d+)/;

function openGraves(events, bot, {archiveDir, now = Date.now(), chest, areas = [], from} = {}) {
  const rows = [...events];
  if (archiveDir) {
    let names = [];
    // Only files written to in the window: a rotated archive of an older day holds no open grave.
    try { names = fs.readdirSync(archiveDir).filter((n) => /^events\.jsonl(?:\.\d{1,13})?$/.test(n) && fs.statSync(path.join(archiveDir, n)).mtimeMs >= now - 24 * 60 * 60 * 1000); } catch {}
    for (const name of names) {
      try { rows.push(...fs.readFileSync(path.join(archiveDir, name), 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s).event).filter(Boolean)); } catch {}
    }
  }
  const deaths = new Map(), fetched = [];
  for (const e of rows) {
    const t = typeof e.t === 'number' ? e.t : Date.parse(e.t);
    if (e.bot !== bot || !Number.isFinite(t) || t < now - 24 * 60 * 60 * 1000 || t > now) continue;
    const m = e.kind === 'death' && DEATH.exec(e.text);
    const f = e.kind === 'done' && FETCHED.exec(e.text);
    if (m) deaths.set(m.slice(1).map(Number).join(' '), {x: +m[1], y: +m[2], z: +m[3], t});
    if (f) fetched.push({x: +f[1], y: +f[2], z: +f[3], t});
  }
  // A death says "died at" rounded, its grave job floors the spot: a fetch within 2 blocks after the death took it.
  const taken = (s) => fetched.some((f) => f.t >= s.t && Math.hypot(f.x - s.x, f.y - s.y, f.z - s.z) <= 2);
  const p = from || chest || {x: 0, y: 64, z: 0};
  return [...deaths.entries()].filter(([, s]) => !taken(s) && s.y >= -64 && s.y <= 320 &&
    (!chest || Math.hypot(s.x - chest.x, s.z - chest.z) <= FAR) && !insideAreas(areas, s.x, s.z))
    .map(([, s]) => s).sort((a, b) => Math.hypot(a.x-p.x,a.y-p.y,a.z-p.z) - Math.hypot(b.x-p.x,b.y-p.y,b.z-p.z)).slice(0, 40).map(({x,y,z}) => ({x,y,z}));
}

// Entities that may be the grave (an armor stand with a head, a display entity, ...), nearest first.
// `entities` is a plain list; players and dropped items never are.
function graveCandidates(entities, {x, y, z}) {
  const d = (e) => Math.hypot(e.position.x - x, e.position.y - y, e.position.z - z);
  return entities
    .filter((e) => e.position && e.type !== 'player' && e.isValid !== false && !NOT_GRAVE.has(e.name) && d(e) <= REACH)
    .sort((a, b) => d(a) - d(b));
}

// Where to look for the grave after a death, or null when the bot should not go: not its own overworld
// death position, too far from the base chest, in a protected area, a grave job already queued for it, or
// the death happened on the way to a grave (a deadly spot would otherwise be visited again and again).
function graveAfterDeath({pos, dim, chest, areas, jobType, queued}) {
  if (!pos || !chest || jobType === 'grave' || normDim(dim) !== 'overworld') return null;
  const [x, y, z] = [pos.x, pos.y, pos.z].map(Math.floor);
  if (![x, y, z].every(Number.isFinite) || y < -64 || y > 320 || insideAreas(areas, x, z)) return null;
  if (Math.hypot(x - chest.x, z - chest.z) > FAR || queued.some((j) => j.type === 'grave' && j.args.x === x && j.args.y === y && j.args.z === z)) return null;
  return {x, y, z};
}

const TIER = ['leather', 'golden', 'chainmail', 'iron', 'diamond', 'netherite'];
const SLOTS = {head: /_helmet$/, torso: /_chestplate$/, legs: /_leggings$/, feet: /_boots$/};
const tier = (n) => TIER.findIndex((t) => n.startsWith(t));

// The armour pieces to put on: per slot the best one in the inventory, if the worn piece (name or null) is worse.
function armourPicks(items, worn) {
  const picks = [];
  for (const [slot, re] of Object.entries(SLOTS)) {
    const best = items.filter((i) => re.test(i.name)).sort((a, b) => tier(b.name) - tier(a.name))[0];
    if (best && (!worn[slot] || tier(best.name) > tier(worn[slot]))) picks.push({slot, item: best});
  }
  return picks;
}

// mineflayer's activateEntity always sends sneaking: false, so write the packets ourselves: first
// "interact at" (where on the entity), then "interact", as the vanilla client does.
async function click(bot, e, sneaking, guard = () => {}) {
  await bot.lookAt(e.position.offset(0, (e.height || 1) / 2, 0), false);
  guard(); // a Stop during the look must send no packet (R5-1)
  for (const mouse of [2, 0]) bot._client.write('use_entity', {target: e.id, mouse, sneaking, hand: 0, x: 0, y: 0, z: 0, location: new Vec3(0, 0, 0)});
}

const countAll = (bot) => (bot.inventory.slots || bot.inventory.items()).reduce((n, i) => n + (i ? i.count : 0), 0);

function makeGraves({goNear, guard, sleep, deposit}) {
  async function grave(r, job) {
    const {bot} = r;
    const {x, y, z} = job.args;
    if (insideAreas(r.protectedAreas, x, z)) throw new Error(`${x} ${z} is inside a protected area`);
    const where = `${x} ${y} ${z}`;
    await goNear(r, job, x, y, z, 2, {doing: `walking to the grave at ${where}`});
    // The packet-based entity is sent when the bot is near; give it a moment.
    let found = [];
    for (let i = 0; i < 20 && !found.length; i++) {
      found = graveCandidates(Object.values(bot.entities), job.args);
      if (!found.length) await sleep(250);
      guard(job);
    }
    const seen = Object.values(bot.entities).filter((e) => e.position && e.type !== 'player' && e.position.distanceTo(bot.entity.position) <= 8).map((e) => `${e.name}/${e.type}`);
    r.emit('info', `grave at ${where}: ${found.length} candidates (${found.map((e) => e.name).join(', ')}); nearby: ${[...new Set(seen)].join(', ') || 'nothing'}`);
    if (!found.length) throw new Error(`no grave entity within ${REACH} blocks of ${where} (gone, or already taken)`);
    const before = countAll(bot);
    job.t.doing = `taking the grave at ${where}`;
    bot.setControlState('sneak', true);
    try {
      await sleep(400); // the server must see the sneak before the click
      for (const e of found.slice(0, 4)) {
        guard(job);
        if (e.position.distanceTo(bot.entity.position) > 4) await goNear(r, job, e.position.x, e.position.y, e.position.z, 2, {doing: 'closing in on the grave'});
        await click(bot, e, true, () => guard(job)).catch((err) => r.emit('info', `grave click on ${e.name} failed: ${err.message}`));
        guard(job); // a Stop cancelled that click: end now instead of waiting for items
        for (let i = 0; i < 12 && countAll(bot) === before; i++) await sleep(250);
        guard(job);
        if (countAll(bot) > before) break;
      }
    } finally {
      bot.setControlState('sneak', false);
    }
    const got = countAll(bot) - before;
    if (got <= 0) throw new Error(`the grave at ${where} gave nothing (not ours, empty, or the click did not take)`);
    job.collected = got;
    job.t.done = got;
    for (const {slot, item} of armourPicks(bot.inventory.items(), Object.fromEntries(Object.keys(SLOTS).map((s) => [s, bot.inventory.slots?.[bot.getEquipmentDestSlot(s)]?.name || null])))) {
      guard(job);
      await bot.equip(item, slot).catch(() => {});
    }
    guard(job);
    if (r.supplyChest) await deposit(r, job);
    r.emit('info', `grave at ${where}: ${got} items back${r.supplyChest ? '' : ' (no supply chest to deposit into)'}`);
  }

  async function graves(r, job) {
    // Spots done leave the list, so a run resumed after a death goes on with the rest.
    const spots = job.args.spots || [], total = spots.length;
    let fetched = 0, gone = 0, unreachable = 0;
    job.t.total = total; job.t.done = 0;
    while (spots.length) {
      guard(job);
      // A child, not a copy: a death or Stop cancels the job, and only then reaches the grave walk too (a copy
      // kept bot1 on a dead job for an hour after a death, main server 2026-10-18).
      try { await grave(r, Object.assign(Object.create(job), {type: 'grave', args: spots[0]})); fetched++; }
      catch (e) {
        guard(job);
        if (/no grave entity|gave nothing/.test(e.message)) gone++;
        else unreachable++;
      }
      spots.shift();
      job.done = fetched + gone + unreachable;
      job.t.done = job.done;
      r.emit('info', `graves: ${job.done}/${total}`);
    }
    r.emit('info', `graves: ${fetched} of ${total} fetched, ${gone} gone, ${unreachable} out of reach`);
  }

  return {grave, graves};
}

module.exports = {click, REACH, FAR, graveCandidates, graveAfterDeath, openGraves, armourPicks, makeGraves};
