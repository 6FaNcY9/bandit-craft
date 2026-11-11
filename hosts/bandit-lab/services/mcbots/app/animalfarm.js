'use strict';
// Animal pen: `animalfarm` tends a box of at most 16 x 16 with cows, sheep, pigs and chickens until stopped. Each
// round it feeds two of a kind to breed them, shears the sheep, culls the adults above 8 (never a named animal or a
// baby), picks the drops and eggs up and hands them in. A kind whose outputs the hall holds enough of is left alone.
// It never digs and never builds pillars; a fence gate it opened on its way through is closed again. A missing input
// (food, shears) or a failed hand-in never throws: that chore waits 5 minutes. The decisions live in animals.js.
const {Vec3} = require('vec3');
const {insideAreas} = require('./world');
const {named, baby} = require('./hunt');
const {KINDS, census, planRound} = require('./animals');
const {centre} = require('./wheatfarm');

const RETRY_MS = 300000;
const NEVER = /(?!)/; // matches no block name: the walks dig nothing
const OUTPUTS = new Set(Object.values(KINDS).flatMap((k) => k.outputs));
const isOutput = (n) => OUTPUTS.has(n) || n.endsWith('_wool');
const isOpen = (b) => String(b.getProperties?.().open) === 'true';

// The closed fence gates on the box border (the edge ring and the ring just outside it), within 3 of box.y.
function borderGates(blockAt, box) {
  const out = [];
  for (let x = box.x1 - 1; x <= box.x2 + 1; x++) {
    for (let z = box.z1 - 1; z <= box.z2 + 1; z++) {
      if (x > box.x1 && x < box.x2 && z > box.z1 && z < box.z2) continue;
      for (let y = box.y - 3; y <= box.y + 3; y++) {
        const b = blockAt(x, y, z);
        if (b && /_fence_gate$/.test(b.name) && !isOpen(b)) out.push({x, y, z});
      }
    }
  }
  return out;
}

function makeAnimalFarm({goNear, guard, sleep, waitCalm, deposit, withdraw, crafting, at, engage, enough = () => 0}) {
  const held = (bot, n) => bot.inventory.items().filter((i) => i.name === n).reduce((s, i) => s + i.count, 0);

  async function animalfarm(r, job) {
    const {bot} = r;
    const box = job.args;
    const y0 = job.args.y ?? r.supplyChest?.y ?? Math.floor(bot.entity.position.y);
    const mid = centre(box);
    const look = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const skip = new Map(); // chore or item -> time until which it is left alone
    const skipped = (k) => (skip.get(k) || 0) > Date.now();
    const later = (k) => skip.set(k, Date.now() + RETRY_MS);
    const fed = new Map(), shorn = new Map();
    let bred = job.bred || 0, sheared = job.sheared || 0, culled = job.culled || 0;
    job.t.open = true;
    job.t.area = {x: mid.x, y: y0, z: mid.z}; // where a resumed job walks back to
    const report = () => {
      Object.assign(job, {bred, sheared, culled});
      job.t.done = bred + sheared + culled;
      job.progress = `pen: ${bred} bred, ${sheared} sheared, ${culled} culled`;
    };
    const idle = async (n = 10) => { for (let i = 0; i < n; i++) { guard(job); await sleep(1000); } };

    // shortcut: gates are noted once at the start; a pen not loaded then has none noted, re-order the job near it.
    const gates = borderGates(look, {...box, y: y0});
    const inside = () => { const p = bot.entity.position.floored(); return p.x >= box.x1 && p.x <= box.x2 && p.z >= box.z1 && p.z <= box.z2; };
    // Close the noted gates that stand open now; a failed close is left, the job goes on.
    async function shut() {
      for (const g of gates) {
        const b = look(g.x, g.y, g.z);
        if (!b || !/_fence_gate$/.test(b.name) || !isOpen(b)) continue;
        try {
          if (bot.entity.position.distanceTo(new Vec3(g.x + 0.5, g.y, g.z + 0.5)) > 4) {
            if (job.cancelled) continue;
            await goNear(r, job, g.x, g.y, g.z, 3, {doing: `walking to the gate at ${at(g)} to close it`});
          }
          await bot.activateBlock(look(g.x, g.y, g.z));
        } catch (e) {
          r.emit('info', `animalfarm: could not close the gate at ${at(g)} (${String(e.message).slice(0, 60)})`);
        }
      }
    }
    // Every walk or chase that ends on the other side of the box edge closes the gates behind it.
    const crossing = async (fn) => { const was = inside(); try { return await fn(); } finally { if (inside() !== was) await shut(); } };
    const walk = (x, y, z, range, doing) => crossing(() => goNear(r, job, x, y, z, range, {doing}));
    const gone = (e) => e.isValid === false || !bot.entities[e.id] || named(e) || baby(e) || insideAreas(r.protectedAreas, Math.floor(e.position.x), Math.floor(e.position.z));

    async function feed(e, food) {
      if (gone(e)) return;
      const item = bot.inventory.items().find((i) => i.name === food);
      if (!item) return;
      try {
        if (e.position.distanceTo(bot.entity.position) > 3) await walk(e.position.x, e.position.y, e.position.z, 2, `walking to a ${e.name} to feed it`);
        guard(job);
        job.t.doing = `feeding a ${e.name} at ${at(e.position.floored())}`;
        await bot.equip(item, 'hand');
        guard(job);
        if (gone(e)) return; // named, grown into a protected area or gone during the walk
        await bot.activateEntity(e);
      } catch (err) {
        guard(job);
        r.emit('info', `animalfarm: could not feed a ${e.name} (${String(err.message).slice(0, 60)})`);
      }
    }

    const was = {digOnly: r.digOnly, noScaffold: r.noScaffold};
    r.digOnly = NEVER;
    r.noScaffold = true;
    try {
      for (;;) {
        guard(job);
        await waitCalm(r, job);
        const active = Object.keys(KINDS).filter((k) => !KINDS[k].outputs.some((item) => enough(r, item) > 0));
        if (!active.length) {
          job.t.doing = 'enough in the hall, waiting';
          await idle(60);
          continue;
        }
        if (Math.hypot(bot.entity.position.x - mid.x, bot.entity.position.z - mid.z) > 12) await walk(mid.x, y0, mid.z, 6, `walking to the pen at ${mid.x} ${mid.z}`);
        guard(job);

        // Hand in at 64 of an output or a nearly full bag; a failed hand-in (hall full) waits 5 minutes.
        const outputs = [...new Set(bot.inventory.items().filter((i) => isOutput(i.name)).map((i) => i.name))];
        const full = bot.inventory.emptySlotCount() < 4;
        if (!skipped('handin') && (full || outputs.some((n) => held(bot, n) >= 64))) {
          try {
            for (const n of outputs) { job.progress = `depositing ${n}`; await deposit(r, job, n); guard(job); }
          } catch (e) {
            guard(job);
            later('handin');
            r.emit('info', `animalfarm: hand-in failed (${String(e.message).slice(0, 80)})`);
          }
          if (bot.inventory.emptySlotCount() < 4 || outputs.some((n) => held(bot, n) >= 64)) later('handin');
          report();
          continue;
        }
        if (full) {
          job.t.doing = 'bag full, the hand-in failed, retrying in 5 minutes';
          await idle();
          continue;
        }

        const all = census(Object.values(bot.entities), box, r.protectedAreas);
        const counts = Object.fromEntries(active.map((k) => [k, all[k]]));
        const plan = () => planRound(counts, {
          now: Date.now(), fed, shorn, paused: false,
          have: {food: Object.fromEntries(Object.values(KINDS).map((k) => [k.food, held(bot, k.food)])), shears: !!bot.inventory.items().find((i) => i.name === 'shears')},
        });
        let plans = plan();
        // Missing inputs: one try per 5 minutes, then plan again with what came.
        const lacks = [...new Set(Object.values(plans).flatMap((p) => p.lacks))];
        let fetched = false;
        for (const item of lacks.filter((i) => !skipped(i))) {
          later(item);
          try {
            if (item === 'shears') await crafting.ensureItem(r, job, 'shears', 1);
            else await withdraw(r, job, item, 16);
            fetched = true;
          } catch (e) {
            guard(job);
          }
        }
        if (fetched) plans = plan();

        let acted = false;
        for (const [kind, p] of Object.entries(plans)) {
          if (p.breed) {
            for (const e of p.breed) await feed(e, KINDS[kind].food);
            for (const e of p.breed) fed.set(e.id, Date.now());
            bred++;
            acted = true;
          }
          const shears = bot.inventory.items().find((i) => i.name === 'shears');
          for (const e of shears ? p.shear : []) {
            guard(job);
            if (gone(e)) continue;
            job.t.doing = `shearing a sheep at ${at(e.position.floored())}`;
            if ((await crossing(() => engage(r, job, e, shears))) === 'done') sheared++;
            shorn.set(e.id, Date.now());
            acted = true;
          }
          for (const e of p.cull) {
            guard(job);
            if (gone(e)) continue;
            job.t.doing = `culling a ${kind} at ${at(e.position.floored())}`;
            if ((await crossing(() => engage(r, job, e, null))) === 'done') culled++;
            acted = true;
          }
          report();
        }

        // Drops and eggs inside the box, one try each.
        if (acted) await sleep(500); // the drops fly a little
        const items = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position && e.isValid !== false && isOutput(e.getDroppedItem?.()?.name || '') && !skipped(`item:${e.id}`)
          && e.position.x >= box.x1 && e.position.x < box.x2 + 1 && e.position.z >= box.z1 && e.position.z < box.z2 + 1 && !insideAreas(r.protectedAreas, Math.floor(e.position.x), Math.floor(e.position.z)));
        for (const e of items.slice(0, 8)) {
          guard(job);
          later(`item:${e.id}`);
          await walk(e.position.x, e.position.y, e.position.z, 0.8, `picking up ${e.getDroppedItem().name}`).catch(() => {});
        }
        guard(job);

        const missing = [...new Set(Object.values(plans).flatMap((p) => p.lacks))];
        const any = active.some((k) => all[k].adults.length || all[k].babies);
        job.t.doing = missing.length ? `no ${missing.join(' and no ')}, retrying in 5 minutes` : !any ? 'no animals in the pen' : acted || items.length ? job.t.doing : 'nothing to do, waiting';
        await idle();
      }
    } finally {
      r.digOnly = was.digOnly;
      r.noScaffold = was.noScaffold;
    }
  }

  return {animalfarm};
}

module.exports = {RETRY_MS, borderGates, makeAnimalFarm};
