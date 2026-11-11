'use strict';
// Crop farm: `cropfarm` keeps a box of at most 16 x 16 going with one crop until stopped. Carrots, potatoes and
// beetroot: harvest the ripe ones, pick the drops up, replant the same cell from them (else from the chest),
// clear grass off wet soil and till it with a hoe. Sugar cane: cut the block above the base only, never the
// base; cane is never planted and water is never placed. While the hall holds more than its cap of the crop the
// farm waits. A missing input (seeds, hoe) or a failed hand-in never throws: that chore waits 5 minutes.
// Built like wheatfarm.js (its scan, chooseWork and pickups take the crop table) and tested like treefarm.js.
const {Vec3} = require('vec3');
const {insideAreas, normDim} = require('./world');
const {CROPS, scan, chooseWork, pickups, centre, wheatAge} = require('./wheatfarm');

const RETRY_MS = 300000;
const HOE = /^(wooden|stone|iron|golden|diamond|netherite)_hoe$/;
const GRASS = /^(short_grass|tall_grass|fern|large_fern)$/;
const HOES = ['iron_hoe', 'stone_hoe', 'wooden_hoe']; // asked for in this order when none is carried
// The crops by job argument; sugar cane has no seed and no age, it is scanned by scanCane.
const CROP_KINDS = {carrot: CROPS.carrot, potato: CROPS.potato, beetroot: CROPS.beetroot, sugar_cane: {block: 'sugar_cane', seed: null, drops: /^sugar_cane$/}};

// Every cane column of the box: {x, z, gy, state}, gy the ground under the cane. ripe: a stack of at least 2,
// dug at gy + 2 (the base at gy + 1 stays and regrows); growing: 1 high; blocked: anything else or not loaded.
function scanCane(blockAt, box, y0, areas) {
  const cells = [];
  for (let x = box.x1; x <= box.x2; x++) {
    for (let z = box.z1; z <= box.z2; z++) {
      if (insideAreas(areas, x, z)) continue;
      let y = y0 + 20;
      while (y >= y0 - 20 && /^(air|cave_air)$/.test(blockAt(x, y, z)?.name || 'air')) y--;
      let gy = y;
      while (gy >= y0 - 20 && blockAt(x, gy, z)?.name === 'sugar_cane') gy--;
      const n = y - gy;
      cells.push({x, z, gy, state: n >= 2 ? 'ripe' : n === 1 ? 'growing' : 'blocked'});
    }
  }
  return {cells};
}

function makeCropFarm({goNear, guard, sleep, digAt, waitCalm, deposit, withdraw, at, enough = () => 0}) {
  const held = (bot, n) => bot.inventory.items().filter((i) => i.name === n).reduce((s, i) => s + i.count, 0);
  const look = (bot, x, y, z) => bot.blockAt(new Vec3(x, y, z));

  // Poll until the block at the position satisfies test (26.x may not echo a placement in time).
  async function settled(bot, x, y, z, test) {
    for (let i = 0; i < 15 && !test(look(bot, x, y, z)?.name || ''); i++) await sleep(100);
    return test(look(bot, x, y, z)?.name || '');
  }

  // Within reach of the cell, else walk there; false when there is no way (that cell is left, not the whole job).
  const reach = (r, job, c, what) => r.bot.entity.position.distanceTo(new Vec3(c.x + 0.5, c.gy + 1, c.z + 0.5)) <= 3.5 ||
    goNear(r, job, c.x, c.gy + 1, c.z, 3, {doing: `walking to ${at({x: c.x, y: c.gy + 1, z: c.z})} to ${what}`}).then(() => true, () => { guard(job); return false; });

  async function till(r, job, c, hoe) {
    const {bot} = r;
    if (!(await reach(r, job, c, 'till'))) return false;
    guard(job);
    job.t.doing = `tilling ${at({x: c.x, y: c.gy, z: c.z})}`;
    await bot.equip(hoe, 'hand');
    guard(job); // a Stop during the equip must not till
    await bot.activateBlock(look(bot, c.x, c.gy, c.z)).catch(() => {});
    return settled(bot, c.x, c.gy, c.z, (n) => n === 'farmland').then((ok) => { guard(job); return ok; });
  }

  async function plant(r, job, c, crop) {
    const {bot} = r;
    const seed = bot.inventory.items().find((i) => i.name === crop.seed);
    if (!seed) return false;
    if (!(await reach(r, job, c, 'plant'))) return false;
    guard(job);
    job.t.doing = `planting ${crop.seed} at ${at({x: c.x, y: c.gy + 1, z: c.z})}`;
    await bot.equip(seed, 'hand');
    guard(job);
    await bot.placeBlock(look(bot, c.x, c.gy, c.z), new Vec3(0, 1, 0)).catch(() => {});
    return settled(bot, c.x, c.gy + 1, c.z, (n) => n === crop.block).then((ok) => { guard(job); return ok; });
  }

  async function cropfarm(r, job) {
    const {bot} = r;
    const box = job.args, kind = job.args.crop, crop = CROP_KINDS[kind], cane = kind === 'sugar_cane';
    const blockAt = (x, y, z) => look(bot, x, y, z);
    const y0 = job.args.y ?? r.supplyChest?.y ?? Math.floor(bot.entity.position.y);
    const mid = centre(box);
    const skip = new Map(); // key -> time until which that cell, item or chore is left alone
    const skipped = (k) => (skip.get(k) || 0) > Date.now();
    const later = (k, ms = RETRY_MS) => skip.set(k, Date.now() + ms);
    let harvested = job.harvested || 0, planted = job.planted || 0, unloadedTries = 0;
    job.t.open = true; // no end: the dashboard shows a count, not a bar
    job.t.area = {x: mid.x, y: y0, z: mid.z}; // where a resumed job walks back to
    const report = () => {
      job.harvested = harvested;
      job.planted = planted;
      job.t.done = harvested;
      job.progress = `${kind}: ${harvested} harvested, ${planted} planted`;
    };
    const idle = async () => { for (let i = 0; i < 10; i++) { guard(job); await sleep(1000); } };
    for (;;) {
      guard(job);
      await waitCalm(r, job);
      // The hall is above its cap for this crop: wait, never fail, go on when it falls below.
      if (enough(r, kind) > 0) {
        job.t.doing = 'enough in the hall, waiting';
        for (let i = 0; i < 60; i++) { guard(job); await sleep(1000); }
        continue;
      }
      if (r.world?.unreachable) throw new Error('hub unreachable: not farming without block reservations');
      const dim = normDim(bot.game?.dimension);
      if (Math.hypot(bot.entity.position.x - mid.x, bot.entity.position.z - mid.z) > 12) await goNear(r, job, mid.x, y0, mid.z, 6, {doing: `walking to the ${kind} farm at ${mid.x} ${mid.z}`});
      guard(job);

      // Hand in at 64 of an output or a nearly full bag; a failed hand-in (chest full) waits 5 minutes.
      const outputs = [...new Set(bot.inventory.items().filter((i) => crop.drops.test(i.name)).map((i) => i.name))];
      const full = bot.inventory.emptySlotCount() < 4;
      if (!skipped('handin') && (full || outputs.some((n) => held(bot, n) >= 64))) {
        try {
          for (const n of outputs) { job.progress = `depositing ${n}`; await deposit(r, job, n); guard(job); }
        } catch (e) {
          guard(job);
          later('handin');
          r.emit('info', `cropfarm: hand-in failed (${e.message.slice(0, 80)})`);
        }
        // Still full (junk, a chest that took only part): no hand-in on every round, the farm goes on or waits.
        if (bot.inventory.emptySlotCount() < 4 || outputs.some((n) => held(bot, n) >= 64)) later('handin');
        report();
        continue;
      }
      if (full) { // the hand-in did not help lately: harvesting now would drop the crop on the ground
        job.t.doing = 'bag full, the hand-in failed, retrying in 5 minutes';
        await idle();
        continue;
      }

      const s = cane ? scanCane(blockAt, box, y0, r.protectedAreas) : scan(blockAt, box, y0, r.protectedAreas, crop);
      if (s.unloaded) { // not loaded yet: wait a moment before judging the farm
        if (++unloadedTries > 20) throw new Error('the farm is not loaded');
        await sleep(1000);
        continue;
      }
      unloadedTries = 0;
      if (!s.cells.length) throw new Error('nothing to farm: the whole area is protected');
      const me = bot.entity.position;
      const cellSkip = (c) => skipped(`cell:${c.x},${c.z}`);
      const hoe = bot.inventory.items().find((i) => HOE.test(i.name));
      const work = cane ? {harvest: s.cells.filter((c) => c.state === 'ripe' && !cellSkip(c)).slice(0, 8), plant: [], clear: [], till: []}
        : chooseWork(s.cells, {me, seeds: held(bot, crop.seed), hoe: !!hoe, skip: cellSkip});
      let acted = false;

      // Missing inputs: one ask at the chest, then that chore waits 5 minutes.
      const plantable = !cane && s.cells.some((c) => c.state === 'plant' && !cellSkip(c));
      if (plantable && !held(bot, crop.seed) && !skipped('seeds')) {
        try {
          await withdraw(r, job, crop.seed, 16);
          acted = true;
        } catch (e) {
          guard(job);
          later('seeds');
        }
      }
      if (work.needHoe && !skipped('hoe')) {
        let got = false;
        for (const n of HOES) {
          try { await withdraw(r, job, n, 1); got = true; break; } catch (e) { guard(job); }
        }
        if (got) acted = true; else later('hoe');
      }
      if (acted) continue; // the next round plans with what came

      // 1. Harvest; the drops are picked up by digAt. Cane is cut one above its base.
      for (const c of work.harvest) {
        guard(job);
        const pos = new Vec3(c.x, c.gy + (cane ? 2 : 1), c.z), claim = `${dim}:${pos.x},${pos.y},${pos.z}`;
        const b = bot.blockAt(pos);
        if (b?.name !== crop.block || (!cane && wheatAge(b) < crop.ripe)) continue; // gone or not ripe any more
        if (r.world && !(await r.world.claim(r.name, claim))) { r.conflict?.(); continue; }
        try {
          job.t.doing = `harvesting ${kind} at ${at(pos)}`;
          if (await digAt(r, job, pos, (n) => n === crop.block)) { harvested++; report(); } else later(`cell:${c.x},${c.z}`);
        } catch (e) {
          guard(job);
          later(`cell:${c.x},${c.z}`);
          r.emit('info', `cropfarm: left the ${kind} at ${at(pos)} (${e.message.slice(0, 60)})`);
        } finally {
          r.world?.release(r.name, claim);
        }
        acted = true;
      }

      // 2. Drops lying around the farm.
      for (const e of pickups(Object.values(bot.entities), box, r.protectedAreas, me, crop.drops).filter((e) => !skipped(`item:${e.id}`)).slice(0, 8)) {
        guard(job);
        job.t.doing = `picking up ${e.getDroppedItem().name}`;
        later(`item:${e.id}`); // one try per item
        await goNear(r, job, e.position.x, e.position.y, e.position.z, 0.8, {doing: job.t.doing}).catch(() => {});
        acted = true;
      }
      guard(job);

      // 3. Replant the empty farmland from the drops (a harvested cell comes up as `plant` in the next round).
      for (const c of work.plant) {
        guard(job);
        if (!held(bot, crop.seed)) break;
        if (await plant(r, job, c, crop)) { planted++; report(); } else later(`cell:${c.x},${c.z}`);
        acted = true;
      }

      // 4. Grass off wet soil, then till it (only with a hoe).
      for (const c of work.clear) {
        guard(job);
        const pos = new Vec3(c.x, c.gy + 1, c.z);
        try {
          await digAt(r, job, pos, (n) => GRASS.test(n));
        } catch (e) {
          guard(job);
          later(`cell:${c.x},${c.z}`);
        }
        acted = true;
      }
      for (const c of work.till) {
        guard(job);
        if (!(await till(r, job, c, hoe))) later(`cell:${c.x},${c.z}`);
        acted = true;
      }
      report();
      if (acted) continue;

      if (!s.cells.some((c) => c.state !== 'blocked' && c.state !== 'water')) throw new Error(`nothing to farm: no ${cane ? 'sugar cane' : 'soil, farmland or crop'} in the area`);
      const lacks = [];
      if (plantable && skipped('seeds')) lacks.push(`no ${crop.seed} to plant`);
      if (!cane && skipped('hoe') && s.cells.some((c) => c.state === 'till' && c.wet)) lacks.push('no hoe to till with');
      job.t.doing = lacks.length ? `${lacks.join(' and ')}, retrying in 5 minutes` : s.cells.some((c) => c.state === 'growing') ? `waiting for the ${kind} to grow` : 'nothing to do';
      await idle();
    }
  }

  return {cropfarm};
}

module.exports = {CROP_KINDS, RETRY_MS, scanCane, makeCropFarm};
