'use strict';
// Fluids of a schematic build: the water and lava sources build.js leaves out of the plan (plan.fluids; the
// downloaded iron farm has 140 water sources and 1 lava, 2026-10-15). `fluids` takes an empty bucket (supply
// chest, else crafted), fills it at the nearest source of that fluid that is outside the build or refills
// itself (two source neighbours and a floor: an infinite pool, so the farm's own rows serve once they stand),
// and pours it into each missing cell, lowest first. Several bots share the cells through claims. The
// decisions are pure and tested in test.js; makeFluids() wires them to a bot.
const {Vec3} = require('vec3');

const BUCKET = {water: 'water_bucket', lava: 'lava_bucket'};
const FACES = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]; // the floor first
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const level = (b) => Number(b?.getProperties?.().level ?? b?.properties?.level ?? 0);
const isSource = (b, name) => !!b && b.name === name && level(b) === 0;
const key = (c) => `${c.x},${c.y},${c.z}`;
const inBox = (box, p) => p.x >= box.lo.x && p.x <= box.hi.x && p.y >= box.lo.y && p.y <= box.hi.y && p.z >= box.lo.z && p.z <= box.hi.z;

// The cells still without their source, lowest first, then nearest to `me`; lava after water.
function missing(fluids, blockAt, me) {
  return fluids.filter((f) => !isSource(blockAt(f.x, f.y, f.z), f.name))
    .sort((a, b) => (a.name === 'lava') - (b.name === 'lava') || a.y - b.y || Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
}

// The point a bucket aims at to put a fluid into cell c: the middle of the face it shares with a solid
// neighbour (the floor first), or null when nothing solid touches it.
function aim(blockAt, c) {
  for (const [dx, dy, dz] of FACES) {
    if (blockAt(c.x + dx, c.y + dy, c.z + dz)?.boundingBox === 'block') return {x: c.x + 0.5 + dx * 0.5, y: c.y + 0.5 + dy * 0.5, z: c.z + 0.5 + dz * 0.5};
  }
  return null;
}

// A water source that comes back when a bucket takes it: two water sources beside it and a floor (solid or a source).
function refills(blockAt, s) {
  const below = blockAt(s.x, s.y - 1, s.z);
  if (!below || !(below.boundingBox === 'block' || isSource(below, 'water'))) return false;
  return SIDES.filter(([dx, dz]) => isSource(blockAt(s.x + dx, s.y, s.z + dz), 'water')).length >= 2;
}

// Where to fill a bucket of `name`: a source that is not one of the build's (inside its box or one of its fluid
// cells: bot50 refilled from the source it had just poured, sandbox 2026-10-15), or one of those that refills.
const fillable = (blockAt, box, name, own = new Set()) => (b) => isSource(b, name)
  && ((!inBox(box, b.position) && !own.has(key(b.position))) || (name === 'water' && refills(blockAt, b.position)));

function makeFluids({goNear, guard, sleep, plan, withdraw, craft, at}) {
  const held = (bot, name) => bot.inventory.items().find((i) => i.name === name);
  const blockAtOf = (bot) => (x, y, z) => bot.blockAt(new Vec3(x, y, z));

  // An empty bucket: from the supply chest, else crafted (3 iron).
  async function emptyBucket(r, job) {
    if (held(r.bot, 'bucket')) return;
    await withdraw(r, job, 'bucket', 1).catch(() => guard(job));
    if (!held(r.bot, 'bucket')) await craft(r, job, 'bucket');
    if (!held(r.bot, 'bucket')) throw new Error('no bucket: none in the supply chest and none could be crafted (3 iron)');
  }

  async function fillAt(r, job, name, box, own) {
    const {bot} = r;
    const src = bot.findBlocks({matching: fillable(blockAtOf(bot), box, name, own), useExtraInfo: true, maxDistance: 96, count: 1})[0];
    if (!src) throw new Error(`no ${name} source within 96 blocks to fill a bucket`);
    await goNear(r, job, src.x, src.y, src.z, 3, {doing: `walking to the ${name} at ${at(src)} to fill a bucket`});
    guard(job);
    await bot.equip(held(bot, 'bucket'), 'hand');
    guard(job);
    await bot.lookAt(src.offset(0.5, 0.5, 0.5), true);
    await bot.activateItem();
    for (let i = 0; i < 20 && !held(bot, BUCKET[name]); i++) await sleep(100);
    if (!held(bot, BUCKET[name])) throw new Error(`could not fill a bucket with ${name} at ${at(src)}`);
  }

  async function pour(r, job, c) {
    const {bot} = r;
    const face = aim(blockAtOf(bot), c);
    if (!face) throw new Error('nothing solid next to it to pour against');
    await goNear(r, job, c.x, c.y, c.z, 3, {doing: `walking to ${at(c)} to pour ${c.name}`});
    guard(job);
    job.t.doing = `pouring ${c.name} at ${at(c)}`;
    await bot.equip(held(bot, BUCKET[c.name]), 'hand');
    guard(job);
    await bot.lookAt(new Vec3(face.x, face.y, face.z), true);
    await bot.activateItem();
    for (let i = 0; i < 20 && !isSource(bot.blockAt(new Vec3(c.x, c.y, c.z)), c.name); i++) await sleep(100);
    return isSource(bot.blockAt(new Vec3(c.x, c.y, c.z)), c.name);
  }

  async function fluids(r, job) {
    const {bot} = r;
    const p = await plan(job.args);
    const box = {lo: p.lo, hi: p.hi};
    const own = new Set(p.fluids.map(key));
    const skip = new Set();
    let poured = 0;
    job.t.total = p.fluids.length;
    for (;;) {
      guard(job);
      const left = missing(p.fluids, blockAtOf(bot), bot.entity.position);
      job.t.done = p.fluids.length - left.length;
      job.progress = `${job.t.done}/${p.fluids.length} sources`;
      const c = left.find((f) => !skip.has(key(f)));
      if (!c) {
        r.emit('info', `fluids: ${poured} poured${left.length ? `, ${left.length} left: ${left.slice(0, 3).map((f) => `${f.name} at ${at(f)}`).join(', ')}` : ''}`);
        if (left.length && !poured) throw new Error(`no source could be poured (${left.length} left)`);
        return;
      }
      if (r.world && !(await r.world.claim(r.name, `fluid:${key(c)}`))) { skip.add(key(c)); continue; } // another bot pours it
      try {
        if (!held(bot, BUCKET[c.name])) {
          await emptyBucket(r, job);
          await fillAt(r, job, c.name, box, own);
        }
        if (await pour(r, job, c)) poured++;
        else skip.add(key(c));
      } catch (e) {
        guard(job);
        skip.add(key(c));
        r.emit('info', `fluids: left ${c.name} at ${at(c)} (${e.message.slice(0, 80)})`);
      } finally {
        r.world?.release(r.name, `fluid:${key(c)}`);
      }
    }
  }

  return {fluids, emptyBucket, fillAt};
}

module.exports = {missing, aim, refills, fillable, isSource, makeFluids, BUCKET};
