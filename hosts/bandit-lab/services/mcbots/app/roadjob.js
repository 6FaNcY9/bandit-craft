'use strict';
// The highway job: road.js says what a road is, cartride.js how to ride one, and this wires both to a bot, as level.js does.
const {Vec3} = require('vec3');
const {refFace} = require('./seal');
const {LINING, FIRST_RAIL, RAMP_BOOSTERS, RAMP_CELLS, cell, crossSection, railHeight, kindOf, isOpen, checkCell, railFits, isBoosterSlot, niche} = require('./road');

const TRIES = 3; // the spec's limit: three tries in a row at the same place, then the road stops
const FALLS = 16; // gravel coming down the column above a cell; more than this is no cell to build
const STACKS = 4; // rock kept for lining: a cave in the first 400 blocks has about 100 open cells
const NO_DIG = ['keep', 'player', 'danger'];
const vec = ({x, y, z}) => new Vec3(x, y, z);
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const stop = {stop: 'cannot continue'};

function makeRoad({goNear, guard, sleep, digAt}) {
  // 26.x may not answer a placing, so what it did is read from the blocks afterwards, as seal.js does.
  async function place(r, c) {
    const {bot} = r;
    const solidAt = (x, y, z) => (bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block' ? 'solid' : 'open');
    const ref = refFace(c, solidAt, bot.entity.position.offset(0, 1.6, 0));
    if (!ref) return 'noref';
    const item = bot.inventory.items().find((i) => LINING.test(i.name));
    if (!item) return 'out';
    await bot.equip(item, 'hand');
    await bot.placeBlock(bot.blockAt(vec(ref.pos)), vec(ref.face)).catch(() => {});
    return 'placed';
  }

  const free = (b) => ['air', 'fluid'].includes(kindOf(b.name));

  // Floor, walls and roof first: nothing is opened before it is shut off.
  async function line(r, job, {air, solid}) {
    const read = (c) => r.bot.blockAt(vec(c));
    const tries = new Map();
    let falls = 0;
    for (;;) {
      guard(job);
      const open = solid.filter((c) => isOpen(read(c)));
      if (!open.length) return null;
      let did = false;
      for (const c of open) {
        if (!free(read(c))) {
          // Gravel falls after the first block is gone, and grass or a cobweb cannot be built through.
          if (++falls > FALLS) return stop;
          await digAt(r, job, vec(c), null, {pickup: false});
          did = true;
          if (!free(read(c))) continue;
        }
        const key = `${c.x},${c.y},${c.z}`, n = tries.get(key) || 0;
        if (n >= TRIES) return stop;
        const res = await place(r, c);
        if (res === 'out') return {out: 'lining'};
        if (res === 'placed') { tries.set(key, n + 1); did = true; }
      }
      if (did) continue;
      // A floor over a cave with nothing beside it: a block in the road to hold it, which the road's digging takes away.
      const help = air.filter((c) => free(read(c)));
      let held = 'noref';
      for (const c of help) if ((held = await place(r, c)) !== 'noref') break;
      if (held === 'out') return {out: 'lining'};
      if (held !== 'placed') return stop;
    }
  }

  // From the top down, so that the bot does not drop into what it digs. A rail where the rail goes stays, if it lies along the road.
  async function open(r, job, road, {air, rail}) {
    const read = (c) => r.bot.blockAt(vec(c));
    for (const c of [...air].reverse()) {
      for (let tries = 0; ; tries++) {
        guard(job);
        const b = read(c);
        if (same(c, rail) && /rail$/.test(b.name) && railFits(b, road)) break;
        if (kindOf(b.name) === 'air') break;
        if (tries >= TRIES) return stop;
        if (kindOf(b.name) === 'fluid') {
          const res = await place(r, c);
          if (res === 'out') return {out: 'lining'};
          if (res === 'noref') return stop;
        } else {
          await digAt(r, job, vec(c), null, {pickup: false});
        }
      }
    }
    return null;
  }

  async function layRail(r, job, {rail}) {
    const {bot} = r, floor = {...rail, y: rail.y - 1};
    for (let tries = 0; ; tries++) {
      guard(job);
      if (/rail$/.test(bot.blockAt(vec(rail)).name)) return null;
      if (tries >= TRIES) return stop;
      const item = bot.inventory.items().find((i) => i.name === 'rail');
      if (!item) return {out: 'rail'};
      await bot.equip(item, 'hand');
      await bot.placeBlock(bot.blockAt(vec(floor)), new Vec3(0, 1, 0)).catch(() => {});
      await sleep(50);
    }
  }

  // What the bot digs it keeps for lining, up to a point. Thrown behind it, or it walks over the stones and picks them up again.
  async function tossExtra(r, road, k) {
    const {bot} = r;
    const extra = bot.inventory.items().filter((i) => LINING.test(i.name)).slice(STACKS);
    if (!extra.length) return;
    await bot.lookAt(vec(cell(road, Math.max(0, k - 6), 1)), true);
    for (const it of extra) await bot.tossStack(it);
  }

  // Leaves cell k finished: 'ok'. {stop: why}: the road cannot go on here. {out: what}: this shift cannot, the road could.
  async function buildCell(r, job, road, k) {
    guard(job);
    const {bot} = r;
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const section = crossSection(road, k);
    for (const c of [...section.air, ...section.solid]) if (!blockAt(c.x, c.y, c.z)) return {out: 'unloaded'};
    if (!checkCell(blockAt, road, k).length) return 'ok';
    for (const c of section.air) {
      const {name} = blockAt(c.x, c.y, c.z), kind = kindOf(name);
      if (same(c, section.rail) && /rail$/.test(name)) continue;
      if (NO_DIG.includes(kind) && !LINING.test(name)) return {stop: kind};
    }
    const back = Math.max(0, k - 2), s = cell(road, back, railHeight(back));
    await goNear(r, job, s.x, s.y, s.z, 1, {doing: `walking to the road's end, ${k} m`});
    const done = (await line(r, job, section)) || (await open(r, job, road, section)) || (await layRail(r, job, section));
    if (done) return done;
    await tossExtra(r, road, k);
    return 'ok';
  }

  const standBeside = async (r, job, road, k, doing) => {
    const s = cell(road, k - 1, railHeight(k - 1));
    await goNear(r, job, s.x, s.y, s.z, 1, {doing});
  };

  // A booster for a rail, powered by a torch in a niche dug into the wall. False, and the rail stays as it is, with nothing
  // to lay it with or anything but rock around the niche: it must not open a cave or a fluid into the road.
  async function layBooster(r, job, road, k) {
    const {bot} = r;
    const read = (c) => bot.blockAt(vec(c));
    const has = (name) => bot.inventory.items().some((i) => i.name === name);
    if (!has('powered_rail') || !has('redstone_torch')) return false;
    const spot = niche(road, k);
    const around = [cell(road, k, 0, 2), cell(road, k, 1, 1), cell(road, k, -1, 1), cell(road, k - 1, 0, 1), cell(road, k + 1, 0, 1)];
    if (around.some((c) => isOpen(read(c)))) return false;
    await standBeside(r, job, road, k, `laying the ramp at ${k} m`);
    guard(job);
    await digAt(r, job, vec(spot), null, {pickup: false});
    await bot.equip(bot.inventory.items().find((i) => i.name === 'redstone_torch'), 'hand');
    await bot.placeBlock(read(cell(road, k, -1, 1)), new Vec3(0, 1, 0)).catch(() => {});
    await digAt(r, job, vec(cell(road, k)), null, {pickup: false});
    await bot.equip(bot.inventory.items().find((i) => i.name === 'powered_rail'), 'hand');
    await bot.placeBlock(read(cell(road, k, -1)), new Vec3(0, 1, 0)).catch(() => {});
    await sleep(50);
    return read(cell(road, k)).name === 'powered_rail';
  }

  // Plain rail back, the torch taken, the niche shut again, so that the road is as it was. False without rock to shut it:
  // a booster that stays until there is does less harm than a hole in the wall.
  async function removeBooster(r, job, road, k) {
    const {bot} = r;
    const read = (c) => bot.blockAt(vec(c));
    if (read(cell(road, k)).name !== 'powered_rail') return false;
    if (!bot.inventory.items().some((i) => LINING.test(i.name))) return false;
    await standBeside(r, job, road, k, `taking up the ramp at ${k} m`);
    guard(job);
    const spot = niche(road, k);
    if (read(spot).name === 'redstone_torch') await digAt(r, job, vec(spot), null, {pickup: false});
    await place(r, spot);
    await digAt(r, job, vec(cell(road, k)), null, {pickup: false});
    await bot.equip(bot.inventory.items().find((i) => i.name === 'rail'), 'hand');
    await bot.placeBlock(read(cell(road, k, -1)), new Vec3(0, 1, 0)).catch(() => {});
    await sleep(50);
    return read(cell(road, k)).name === 'rail';
  }

  const backToHead = async (r, job, road, head) => {
    const s = cell(road, head, railHeight(head));
    await goNear(r, job, s.x, s.y, s.z, 1, {doing: `walking to the road's end, ${head} m`});
  };

  // Laid by walking back when a shift ends, whatever ended it: no count has to predict that. The nearest to the head
  // first, so that with too few the ride home still starts on them. Returns how many stand.
  async function layRamp(r, job, road, head) {
    const {bot} = r;
    let stand = 0;
    for (let k = head; k > Math.max(head - RAMP_CELLS, FIRST_RAIL - 1) && stand < RAMP_BOOSTERS; k--) {
      guard(job);
      if (!isBoosterSlot(k)) continue;
      if (bot.blockAt(vec(cell(road, k))).name === 'powered_rail' || (await layBooster(r, job, road, k))) stand++;
    }
    await backToHead(r, job, road, head);
    return stand;
  }

  // The same walk on coming back. The origin's ramp is never touched: it stays for every trip. Returns how many it took.
  async function collectRamp(r, job, road, head) {
    let taken = 0;
    for (let k = head; k > Math.max(head - RAMP_CELLS, FIRST_RAIL + RAMP_CELLS); k--) {
      guard(job);
      if (isBoosterSlot(k) && (await removeBooster(r, job, road, k))) taken++;
    }
    await backToHead(r, job, road, head);
    return taken;
  }

  return {buildCell, layBooster, removeBooster, layRamp, collectRamp};
}

module.exports = {makeRoad};
