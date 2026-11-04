'use strict';
// The highway job: road.js says what a road is, cartride.js how to ride one, and this wires both to a bot, as level.js does.
const {Vec3} = require('vec3');
const {refFace} = require('./seal');
const {LINING, FIRST_RAIL, RAMP_BOOSTERS, RAMP_CELLS, BORDER_K, cell, crossSection, railHeight, kindOf, isOpen, checkCell, railFits, isBoosterSlot, niche, inspect, findHead, onRoad, fellOff, mayEndAt, originPlan, readOrigin, mayBuildAt, isClear, FARMS, loadFor} = require('./road');

const TRIES = 3; // the spec's limit: three tries in a row at the same place, then the road stops
const WALK_WAIT_MS = 5000;
const FALLS = 16; // gravel coming down the column above a cell; more than this is no cell to build
const STACKS = 4; // rock kept for lining: a cave in the first 400 blocks has about 100 open cells
const NO_DIG = ['keep', 'player', 'danger'];
const vec = ({x, y, z}) => new Vec3(x, y, z);
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const cannot = (what, {x, y, z}) => ({stop: `cannot continue: ${what} at ${x} ${y} ${z}`});
const ORIGIN = {x: 0, y: 0, z: 0};
const ORIGIN_RAMP_END = FIRST_RAIL + RAMP_CELLS;
const SEGMENT = 16; // one dip each
const FIRST_LOOK = 8; // the chamber and the stair are the bot's own
const NEAR = 8; // this close to the rail's end the bot is at it: rails taken up at a shift's end leave it this far back
const RAILS_LOW = 16; // enough to reach the next place the rail may end
const FOOD_LOW = 14; // as care() in bots.js. A bot with food eats by itself (combat.js)
const CHUNK_TRIES = 60; // a second each
const BACK_OFF = 48;
const RETRY_MS = 300000; // the spec's 5 minutes
const WARDEN_RANGE = 32;
const FARMS_MS = 300000; // farms fill slowly, and each try is a walk
const FEW_RAILS = 64; // not worth a trip
const GET_MOST = 256; // VALIDATE.get
const SLOTS = 36;
const TRIP_FOR = ['rail', 'iron_pickaxe', 'powered_rail', 'redstone_torch', 'minecart', 'bread']; // sticks and the table are spent making these, cobblestone comes out of the rock
const FARM_LEVELS = 3; // climbing to a chest upstairs sent a bot across the spawn for half an hour (sandbox, 2026-11-04); every load item lies within this
const READ_MS = 120000;
// What a road bot carries besides its load and its food: what it wears or fights with, gold (no farm) and gems. A list of what to
// throw lost against the ground: wet stretches gave clay, seeds and moss, and a load leaves only 4 slots.
const KEEPS = /_(helmet|chestplate|leggings|boots|sword|axe|pickaxe|shovel)$|^(shield|totem_of_undying|diamond|emerald|gold_ingot)$/;
const ORIGIN_KEY = 'highway:origin';
const CLAIM_HOLD_MS = 45000; // world.js: a claim runs out if it is not renewed
const ON_FOOT = /no cart|did not start|could not board|no rail|took over/; // a cart lost or stuck costs time, not the road
const FRONT = [-1, 0, 1]; // heights shut past a landing, the lowest first to place the rest on
const liningLeft = (bot) => bot.inventory.items().filter((i) => LINING.test(i.name)).reduce((n, i) => n + i.count, 0);
const rideLimit = (k) => 120000 + (k || 0) * 20; // at the 50 m/s no ride goes below

function makeRoad({goNear, waitCalm, guard, sleep, digAt, edible, ride, get, countChest, chestsNear, ensureGear, gearWanted, tossJunk, now = Date.now, farms = FARMS, restock = null, buildOrigin = null}) {
  // 26.x may not answer a placing, so what it did is read from the blocks afterwards, as seal.js does.
  async function place(r, c, spare = FRONT.length) {
    const {bot} = r;
    const solidAt = (x, y, z) => (bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block' ? 'solid' : 'open');
    const ref = refFace(c, solidAt, bot.entity.position.offset(0, 1.6, 0));
    if (!ref) return 'noref';
    if (liningLeft(bot) <= spare) return 'out';
    await bot.equip(bot.inventory.items().find((i) => LINING.test(i.name)), 'hand');
    await bot.placeBlock(bot.blockAt(vec(ref.pos)), vec(ref.face)).catch(() => {});
    return 'placed';
  }

  // Glow lichen grows in water, where a dig is refused, and a block simply replaces it.
  const free = (b) => ['air', 'fluid'].includes(kindOf(b.name)) || b.name === 'glow_lichen';

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
          if (++falls > FALLS) return cannot('too much falling', c);
          await digAt(r, job, vec(c), null, {pickup: false, stay: true});
          did = true;
          if (!free(read(c))) continue;
        }
        const key = `${c.x},${c.y},${c.z}`, n = tries.get(key) || 0;
        if (n >= TRIES) return cannot('no block stays', c);
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
      if (held !== 'placed') return cannot('nothing to build against', open[0]);
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
        if (tries >= TRIES) return cannot(`${b.name} stays`, c);
        if (kindOf(b.name) === 'fluid') {
          const res = await place(r, c);
          if (res === 'out') return {out: 'lining'};
          if (res === 'noref') return cannot('nothing to build against', c);
        } else {
          await digAt(r, job, vec(c), null, {pickup: false, stay: true});
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
      if (tries >= TRIES) return cannot('no rail', rail);
      const item = bot.inventory.items().find((i) => i.name === 'rail');
      if (!item) return {out: 'rail'};
      await bot.equip(item, 'hand');
      await bot.placeBlock(bot.blockAt(vec(floor)), new Vec3(0, 1, 0)).catch(() => {});
      await sleep(50);
    }
  }

  // What the bot digs it keeps for lining, up to a point. Thrown behind it, or it walks over the stones and picks them up again.
  const isStray = (r, it, want) => !(it.name in want) && !LINING.test(it.name) && !KEEPS.test(it.name) && !edible(r.bot, it) && !r.prefs?.keep?.[it.name];

  async function tossExtra(r, job, road, k) {
    const {bot} = r, want = loadFor(job.args.frontier, gearWanted(r)), items = bot.inventory.items();
    const extra = [...items.filter((i) => LINING.test(i.name)).slice(STACKS), ...items.filter((i) => isStray(r, i, want))];
    if (!extra.length) return;
    await bot.lookAt(vec(cell(road, Math.max(0, k - 6), 1)), true);
    for (const it of extra) await bot.tossStack(it);
  }

  // Leaves cell k finished: 'ok'. {stop: why}: the road cannot go on here. {out: what}: this shift cannot, the road could.
  async function buildCell(r, job, road, k, {rail = true} = {}) {
    guard(job);
    const {bot} = r;
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const section = crossSection(road, k);
    for (const c of [...section.air, ...section.solid]) if (!blockAt(c.x, c.y, c.z)) return {out: 'unloaded'};
    if (rail && !checkCell(blockAt, road, k).length) return 'ok';
    for (const c of section.air) {
      const {name} = blockAt(c.x, c.y, c.z), kind = kindOf(name);
      if (same(c, section.rail) && /rail$/.test(name)) continue;
      if (NO_DIG.includes(kind) && !LINING.test(name)) return {stop: kind};
    }
    const back = Math.max(FIRST_RAIL - 1, k - 2), s = cell(road, back, railHeight(back));
    await goNear(r, job, s.x, s.y, s.z, 1, {doing: `walking to the road's end, ${k} m`});
    const done = (await line(r, job, section)) || (await open(r, job, road, section)) || (rail ? await layRail(r, job, section) : null);
    if (done) return done;
    await tossExtra(r, job, road, k);
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
    // The rail is gone now, so whatever happens something goes back: a place that fails leaves a hole no cart gets past.
    const put = async (item, want) => {
      for (let tries = 0; tries < TRIES && !want.test(read(cell(road, k)).name); tries++) {
        await bot.equip(bot.inventory.items().find((i) => i.name === item), 'hand');
        await bot.placeBlock(read(cell(road, k, -1)), new Vec3(0, 1, 0)).catch(() => {});
        await sleep(250);
      }
    };
    await put('powered_rail', /^powered_rail$/);
    await put('rail', /rail$/);
    return read(cell(road, k)).name === 'powered_rail';
  }

  // Plain rail back, the torch taken, the niche shut again, so that the road is as it was. False without rock to shut it:
  // a booster that stays until there is does less harm than a hole in the wall.
  async function removeBooster(r, job, road, k) {
    const {bot} = r;
    const read = (c) => bot.blockAt(vec(c));
    if (read(cell(road, k)).name !== 'powered_rail') return false;
    if (!bot.inventory.items().some((i) => LINING.test(i.name)) || !bot.inventory.items().some((i) => i.name === 'rail')) return false;
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

  // A walk across the land stalls now and then on open ground (no progress for 30 s at -178 -108, sandbox 2026-11-04): that must not end a road.
  const walkFar = async (r, job, ...rest) => {
    for (let tries = 1; ; tries++) {
      try {
        return await goNear(r, job, ...rest);
      } catch (e) {
        guard(job);
        if (tries >= TRIES || !/^could not reach/.test(e.message)) throw e;
        r.emit('info', `highway: ${e.message}, walking on`);
        await sleep(WALK_WAIT_MS);
      }
    }
  };

  const backToHead = async (r, job, road, head) => {
    const s = cell(road, head, railHeight(head));
    await goNear(r, job, s.x, s.y, s.z, 1, {doing: `walking to the road's end, ${head} m`});
  };

  // A bot sees about 128 blocks, a ramp is 256 long: what it cannot see yet it walks to.
  const loaded = async (r, job, road, k) => {
    if (r.bot.blockAt(vec(cell(road, k)))) return;
    await standBeside(r, job, road, k, `walking along the road, ${k} m`);
    for (let i = 0; i < 50 && !r.bot.blockAt(vec(cell(road, k))); i++) await sleep(100);
    if (!r.bot.blockAt(vec(cell(road, k)))) throw new Error(`no chunk at ${k} m of the road`);
  };

  // Laid by walking back when a shift ends, whatever ended it: no count has to predict that. The nearest to the head
  // first, so that with too few the ride home still starts on them. Returns how many stand.
  async function layRamp(r, job, road, head) {
    const {bot} = r;
    let stand = 0;
    for (let k = head; k > Math.max(head - RAMP_CELLS, FIRST_RAIL - 1) && stand < RAMP_BOOSTERS; k--) {
      guard(job);
      if (!isBoosterSlot(k)) continue;
      await loaded(r, job, road, k);
      if (bot.blockAt(vec(cell(road, k)))?.name === 'powered_rail' || (await layBooster(r, job, road, k))) stand++;
    }
    await backToHead(r, job, road, head);
    return stand;
  }

  // The same walk on coming back. The origin's ramp is never touched: it stays for every trip. Returns how many it took.
  async function collectRamp(r, job, road, head) {
    let taken = 0;
    for (let k = head; k > Math.max(head - RAMP_CELLS, FIRST_RAIL + RAMP_CELLS); k--) {
      guard(job);
      if (!isBoosterSlot(k)) continue;
      await loaded(r, job, road, k);
      if (await removeBooster(r, job, road, k)) taken++;
    }
    await backToHead(r, job, road, head);
    return taken;
  }

  const count = (bot, test) => bot.inventory.items().filter((i) => test.test(i.name)).reduce((n, i) => n + i.count, 0);
  const wardenNear = (bot) => Object.values(bot.entities).some((e) => e.name === 'warden' && e.position.distanceTo(bot.entity.position) <= WARDEN_RANGE);

  // Why this shift ends, if it does. The last pickaxe is for the ramp and for taking the cart back.
  function shiftOver(bot) {
    if (count(bot, /^rail$/) <= RAILS_LOW) return 'rails';
    if (count(bot, /_pickaxe$/) <= 1) return 'pickaxes';
    if (bot.food < FOOD_LOW && !bot.inventory.items().some((i) => edible(bot, i))) return 'food';
    return null;
  }

  // Ends the road's rail where a cart can stop: at a place it may end, with a free cell to land on and rock past that. Forward
  // if it can, and if not, by taking up rails: the cells past them are built, so one of them is the landing. Returns the last rail.
  async function endRail(r, job, road, k, {forward = true} = {}) {
    const {bot} = r;
    const landed = (at) => {
      const {air, solid} = crossSection(road, at + 1), read = (c) => bot.blockAt(vec(c));
      return air.every((c) => kindOf(read(c)?.name ?? 'stone') === 'air') && !solid.some((c) => read(c) && isOpen(read(c))); // all air in a cave, with nothing to stand on
    };
    if (mayEndAt(k) && landed(k)) return k;
    if (forward) {
      while (!mayEndAt(k) && (await buildCell(r, job, road, k + 1)) === 'ok') k++;
      if (mayEndAt(k) && (await buildCell(r, job, road, k + 1, {rail: false})) === 'ok') return k;
    }
    do {
      if (k < FIRST_RAIL) return k;
      await digAt(r, job, vec(cell(road, k, railHeight(k))), null, {pickup: false});
      k--;
    } while (!mayEndAt(k));
    return k;
  }

  // By cart if it can, on foot if it cannot: a lost cart or a stretch with no booster costs time, not the road.
  async function travel(r, job, road, railK, walkK, doing) {
    const {x, y, z} = cell(road, railK, railHeight(railK));
    try {
      await ride.ride(r, job, new Vec3(x, y, z), {limitMs: rideLimit(job.args.frontier)});
    } catch (e) {
      guard(job);
      if (!ON_FOOT.test(e.message)) throw e;
      r.emit('info', `highway: walking, ${e.message}`);
      await ride.takeCart(r, job);
      const w = cell(road, walkK, railHeight(walkK));
      await goNear(r, job, w.x, w.y, w.z, 1, {doing});
    }
  }

  // A cart runs on past the rail's end until something stops it, and in a cave nothing does: off the rail at 869 m, the rider came down at
  // 885 m and y -9 (sandbox). The last lining is kept for this (place), and the next shift digs it away with the cell.
  async function closeEnd(r, job, road, head) {
    for (const h of FRONT) {
      const c = cell(road, head + 2, h), read = () => r.bot.blockAt(vec(c));
      for (let tries = 0; free(read()) && tries < TRIES; tries++) {
        guard(job);
        await place(r, c, 0);
      }
      if (free(read())) { r.emit('alert', `highway: ${road.dir}: the road's end at ${head} m stays open at ${c.x} ${c.y} ${c.z}, a cart would run off it`); return; }
    }
  }

  const goHome = async (r, job, road, head) => {
    const land = cell(road, head + 1);
    await layRamp(r, job, road, head);
    await goNear(r, job, land.x, land.y, land.z, 0, {doing: 'getting on the cart'});
    await closeEnd(r, job, road, head);
    await travel(r, job, road, head, FIRST_RAIL - 1, 'walking home along the road');
  };

  // The road stops here: the owner hears why, the bot goes home if it can, and the job ends.
  async function stopRoad(r, job, road, k, what) {
    r.emit('alert', `highway: ${road.dir} stopped at ${k} m: ${what}`);
    try {
      await goHome(r, job, road, await endRail(r, job, road, k, {forward: false}));
    } catch (e) {
      guard(job);
      r.emit('info', `highway: not home: ${e.message.slice(0, 80)}`);
    }
    return 'stopped';
  }

  // Never a fight: back along the road, and again after 5 minutes. The second time it is the owner's.
  async function backOff(r, job, road, k, what) {
    job.t.dangers = (job.t.dangers || 0) + 1;
    if (job.t.dangers > 1) return stopRoad(r, job, road, k, what);
    r.emit('info', `highway: ${what} at ${k} m, backing off for 5 minutes`);
    const s = Math.max(FIRST_RAIL - 1, k - BACK_OFF), w = cell(road, s, railHeight(s));
    await goNear(r, job, w.x, w.y, w.z, 2, {doing: `keeping away from ${what}`});
    for (let left = RETRY_MS; left > 0; left -= 1000) {
      guard(job);
      await sleep(1000);
    }
    return 'again';
  }

  // Builds from the rail's end until the shift or the road ends: 'done', 'stopped', 'again' (look where it is), or 'home'.
  async function shift(r, job, road, head, end) {
    const {bot} = r;
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const near = crossSection(road, head);
    // With no slot for the boosters they would lie on the ground and vanish, and gold has no farm: on the road they do no harm.
    if (!shiftOver(bot) && head > ORIGIN_RAMP_END && bot.blockAt(vec(near.rail))) {
      let old = false;
      for (let k = head; k > head - SEGMENT && !old; k--) old = isBoosterSlot(k) && blockAt(...Object.values(cell(road, k)))?.name === 'powered_rail';
      const roomy = () => bot.inventory.items().length <= SLOTS - 2;
      if (old && !roomy()) {
        await tossJunk(r, job);
        const {stick, ...need} = loadFor(job.args.frontier, gearWanted(r)); // the stick farm comes first on the next round
        await tossStrays(r, job, need);
      }
      if (old && roomy()) await collectRamp(r, job, road, head);
      else if (old) r.emit('info', `highway: no room to take up the old ramp at ${head} m (${bot.inventory.items().length} slots taken)`);
    }
    let k = head, cellTries = 0;
    const home = async () => {
      k = await endRail(r, job, road, k);
      job.args.frontier = k;
      await goHome(r, job, road, k);
      return 'home';
    };
    while (k < end) {
      guard(job);
      await waitCalm(r, job);
      const to = Math.min(k + SEGMENT, end);
      if (to >= FIRST_LOOK) {
        const {stop: seen} = inspect(blockAt, road, Math.max(k + 1, FIRST_LOOK), to);
        if (seen?.why === 'unloaded') {
          job.t.chunkWaits = (job.t.chunkWaits || 0) + 1;
          if (job.t.chunkWaits > CHUNK_TRIES) return stopRoad(r, job, road, k, 'the chunks ahead did not load');
          await sleep(1000);
          continue;
        }
        if (seen?.why === 'danger') return backOff(r, job, road, k, `${seen.name} at ${seen.at.x} ${seen.at.y} ${seen.at.z}`);
        if (seen) return stopRoad(r, job, road, k, `${seen.name} at ${seen.at.x} ${seen.at.y} ${seen.at.z}`);
      }
      job.t.chunkWaits = 0;
      while (k < to) {
        guard(job);
        await waitCalm(r, job);
        if (wardenNear(bot)) return backOff(r, job, road, k, 'a warden');
        if (shiftOver(bot)) return home();
        const made = await buildCell(r, job, road, k + 1).catch((e) => { // refused as unsafe: the road stops as it does for anything else in its way
          guard(job);
          if (!/^unsafe/.test(e.message)) throw e;
          return {stop: e.message};
        });
        if (made?.out === 'unloaded') { await sleep(1000); continue; }
        if (made?.out) return home();
        // Built again from what stands: a place or a dig that failed for a moment must not end a road, and the log says what it was.
        if (/^(cannot continue|unsafe)/.test(made?.stop) && ++cellTries < TRIES) {
          r.emit('info', `highway: ${made.stop}, trying that cell again`);
          await sleep(2000);
          continue;
        }
        if (made?.stop) return stopRoad(r, job, road, k, made.stop);
        cellTries = 0;
        k++;
        if (k <= ORIGIN_RAMP_END && isBoosterSlot(k)) await layBooster(r, job, road, k);
        job.t.done = k;
        job.progress = `${road.dir}: ${k} m`;
      }
      job.args.frontier = k; // kept across restarts (keptOf); the blocks have the last word
      job.t.dangers = 0;
    }
    job.args.frontier = k;
    return 'done';
  }

  // What is short, from the nearest farm that lists it, then the next: get plans the chests and the crafting. It sees only the chests this
  // trip read, so what is not on the list cannot become a source. With too little to start a shift it waits and says so, once.
  async function tossStrays(r, job, want) {
    for (const it of r.bot.inventory.items()) {
      if (!isStray(r, it, want)) continue;
      await r.bot.tossStack(it).catch(() => {});
      guard(job);
    }
  }

  async function fetchLoad(r, job, road) {
    const {bot} = r;
    const have = (item) => bot.inventory.items().filter((i) => i.name === item).reduce((n, i) => n + i.count, 0);
    const want = loadFor(job.args.frontier, gearWanted(r));
    // Back at the origin after a restart, with most of a load. With little lining it would ride out, lay a few cells of a cave and ride back for ever.
    if (liningLeft(bot) * 4 >= want.cobblestone * 3 && !TRIP_FOR.some((item) => have(item) * 4 < want[item] * 3)) return 'ok';
    await upStair(r, job, road);
    await bot.lookAt(vec(cell(road, FIRST_RAIL + 3, 1)), true); // onto the road, not where it walks next
    await tossJunk(r, job); // the rock of the last trip: a load takes nearly every slot
    const walkTo = (farm, items) => goNear(r, job, farm.x, farm.y, farm.z, 8, {doing: `walking to the farm at ${farm.x} ${farm.z} for ${items[0]}`});
    r.farmChests = (job.t.farmChests ||= new Map());
    try {
      for (const farm of farms) {
        const items = Object.keys(want).filter((item) => farm.items.includes(item) && have(item) < want[item]);
        if (!items.length) continue;
        try {
          await walkTo(farm, items).catch((e) => { guard(job); return walkTo(farm, items); }); // "no progress for 30 s" is often a moment's jam
        } catch (e) {
          guard(job);
          r.emit('info', `highway: the farm at ${farm.x} ${farm.z}: ${e.message.slice(0, 80)}`);
          continue;
        }
        await tossStrays(r, job, want);
        const until = now() + READ_MS;
        for (const p of chestsNear(r, farm).filter((c) => Math.abs(c.y - farm.y) <= FARM_LEVELS)) {
          if (now() > until) break;
          await countChest(r, job, p).catch(() => guard(job));
        }
        for (const item of items) {
          try {
            for (let short = want[item] - have(item); short > 0; short = want[item] - have(item)) {
              const before = have(item);
              await get(r, job, item, Math.min(short, GET_MOST));
              if (have(item) <= before) break;
            }
          } catch (e) {
            guard(job);
            r.emit('info', `highway: ${item} at the farm at ${farm.x} ${farm.z}: ${e.message.slice(0, 80)}`);
          }
        }
      }
      await ensureGear(r, job);
    } finally {
      r.farmChests = null;
    }
    const over = have('rail') < FEW_RAILS ? 'rails' : shiftOver(bot);
    if (over) {
      if (!job.t.farmsOut) r.emit('alert', `highway: ${job.args.dir} waiting: the farms have no ${{rails: 'rail', pickaxes: 'iron_pickaxe', food: 'food'}[over]}`);
      job.t.farmsOut = true;
      return 'waiting';
    }
    job.t.farmsOut = false;
    return 'ok';
  }

  // Digs every cell of a list until it stays open: gravel comes down after the block under it.
  async function dig(r, job, cells) {
    const read = (c) => r.bot.blockAt(vec(c));
    for (const c of cells) {
      for (let falls = 0; read(c) && !isClear(read(c)); falls++) {
        if (falls > FALLS) throw new Error(`${read(c).name} keeps falling at ${c.x} ${c.y} ${c.z}`);
        guard(job);
        await digAt(r, job, vec(c), null, {pickup: false, stay: true});
      }
    }
  }
  const fill = async (r, c) => {
    if (!isOpen(r.bot.blockAt(vec(c)))) return;
    if ((await place(r, c)) === 'out') throw new Error('no lining left for the origin');
  };

  async function stepOnto(r, job, s, doing) {
    for (let tries = 0; ; tries++) {
      await dig(r, job, [...s.air].reverse());
      try {
        return await goNear(r, job, s.air[0].x, s.air[0].y, s.air[0].z, 0, {doing});
      } catch (e) { // gravel lands a moment after the dig saw air, and then no path leads onto the step (sandbox, 2026-11-04)
        guard(job);
        if (tries >= TRIES) throw e;
        await sleep(1000);
      }
    }
  }

  // Off to the farms by hand: gravel comes down on the stair after the bot has gone, and no walk may dig in the protected box (sandbox, 2026-11-04).
  async function upStair(r, job, road) {
    const {bot} = r, o = road.origin, plan = originPlan(o), p = bot.entity.position, feet = p.floored();
    const onIt = plan.stair.some((s) => s.air.some((c) => c.x === feet.x && c.y === feet.y && c.z === feet.z));
    if (!onIt && !(Math.hypot(p.x - o.x, p.z - o.z) <= 6 && Math.abs(p.y - o.y) <= 3)) return;
    const allowed = r.mayBuild;
    r.mayBuild = mayBuildAt(plan, o);
    try {
      for (const s of plan.stair.filter((c) => c.air[0].y >= feet.y)) {
        const floor = bot.blockAt(vec(s.floor));
        if (!floor || isOpen(floor)) return; // past the ground: the sky needs no stair
        await stepOnto(r, job, s, 'climbing the stair');
      }
    } finally {
      r.mayBuild = allowed;
    }
  }

  // From the surface down, so the bot always stands on what it dug: the stair, the room, the curbs. One bot does it, the others wait.
  async function digOrigin(r, job, road) {
    const {bot} = r, plan = originPlan(road.origin), {x, y, z} = road.origin;
    const blockAt = (a, b, c) => bot.blockAt(new Vec3(a, b, c));
    let state = readOrigin(blockAt, plan);
    if (state.done) return 'ok';
    if (state.unloaded) await walkFar(r, job, x + 30, y + 64, z - 5, 32, {doing: 'walking to the origin'});
    for (let tries = 0; (state = readOrigin(blockAt, plan)).unloaded; tries++) {
      if (tries > CHUNK_TRIES) throw new Error('the chunks at the origin did not load');
      await sleep(1000);
    }
    const stopped = (s) => { r.emit('alert', `highway: the origin stopped: ${s.name} at ${s.at.x} ${s.at.y} ${s.at.z}`); return 'stopped'; };
    if (state.stop) return stopped(state.stop);
    const claim = () => (r.world ? r.world.claim(r.name, ORIGIN_KEY) : true);
    while (!state.done && !(await claim())) {
      job.t.doing = 'waiting for the bot that builds the origin';
      guard(job);
      await sleep(CLAIM_HOLD_MS);
      state = readOrigin(blockAt, plan);
      if (state.stop) return stopped(state.stop);
    }
    if (state.done) return 'ok';
    const hold = setInterval(() => Promise.resolve(claim()).catch(() => {}), CLAIM_HOLD_MS);
    try {
      const {top} = state, walk = (c, doing) => goNear(r, job, c.x, c.y, c.z, 0, {doing});
      if (top < plan.stair.length) await goNear(r, job, plan.stair[top].air[0].x, plan.stair[top].air[0].y, plan.stair[top].air[0].z, 1, {doing: 'walking to the top of the stair'});
      for (let i = top - 1; i >= 0; i--) {
        const s = plan.stair[i];
        await dig(r, job, [...s.air].reverse());
        // Through a cave a floor has nothing beside it: line holds it with a block in the stair, which the second dig takes away.
        const lined = await line(r, job, {air: s.air, solid: [s.floor]});
        if (lined) throw new Error(lined.out ? 'no lining left for the origin' : `the stair's floor cannot be set at ${s.floor.x} ${s.floor.y} ${s.floor.z}`);
        await stepOnto(r, job, s, `digging the stair down, step ${i}`);
      }
      const door = plan.stair[0].air[0], away = (c) => Math.hypot(c.x - door.x, c.z - door.z);
      await dig(r, job, [...plan.room].sort((a, b) => away(a) - away(b)));
      for (const c of plan.curbs) {
        const s = {x: c.x - Math.sign(c.x - x), y: c.y, z: c.z - Math.sign(c.z - z)};
        if (isOpen(bot.blockAt(vec(c)))) { await walk(s, 'setting a curb'); await fill(r, c); }
      }
    } finally {
      clearInterval(hold);
      r.world?.release?.(r.name, ORIGIN_KEY);
    }
    return 'ok';
  }

  // Keeps no state but a hint: it looks where it stands and reads the blocks. Riding out from the origin ends at the road's
  // real end by itself, because the rail stops one cell before the rock.
  async function highway(r, job) {
    const {bot} = r;
    const {dir, length, origin = ORIGIN} = job.args;
    const road = {dir, origin}, end = Math.min(length ?? BORDER_K, BORDER_K);
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const saved = r.digOnly;
    const onRoad_ = /$^/, may = mayBuildAt(originPlan(origin), origin);
    r.digOnly = onRoad_; // the road's cells and nothing else: a walk digs no ways of its own
    r.mayBuild = may;
    // Off to the farms a bot is any other bot: the walk may dig its way as usual, and the box is closed again.
    const offRoad = async (fn) => {
      r.digOnly = saved;
      r.mayBuild = null;
      try { return await fn(); } finally { r.digOnly = onRoad_; r.mayBuild = may; }
    };
    try {
      for (let waits = 0; ;) {
        guard(job);
        await waitCalm(r, job);
        if (bot.vehicle) {
          await ride.rideOn(r, job, {limitMs: rideLimit(job.args.frontier)}).catch((e) => {
            guard(job);
            if (!ON_FOOT.test(e.message)) throw e;
            r.emit('info', `highway: on foot from here, ${e.message}`);
          });
        }
        const fell = fellOff(road, bot.entity.position);
        if (fell !== null) { // not a farm walk from here: that one digs its way up through whatever lies above (a lake at 880 m, sandbox)
          const {x, y, z} = bot.entity.position.floored(), {head: to} = findHead(blockAt, road, fell), w = cell(road, to, railHeight(to));
          await goNear(r, job, w.x, w.y, w.z, 0, {doing: `back to the road at ${to} m`}).catch(async (e) => {
            guard(job);
            r.emit('info', `highway: off the road at ${x} ${y} ${z}, walking back to its start: ${e.message.slice(0, 80)}`);
            const land = cell(road, FIRST_RAIL - 1);
            await walkFar(r, job, land.x, land.y, land.z, 0, {doing: 'walking back to the start of the road'}).catch((e2) => {
              guard(job);
              throw new Error(`off the road at ${x} ${y} ${z}: ${e2.message}`);
            });
          });
          continue;
        }
        const here = onRoad(road, bot.entity.position);
        const k = here ? here.k : -1;
        if (k < FIRST_RAIL) {
          if (!job.args.origin) { // a road with an origin of its own brings its load and its start
            if ((await offRoad(() => (restock || fetchLoad)(r, job, road))) === 'waiting') {
              for (let left = FARMS_MS; left > 0; left -= 1000) { guard(job); await sleep(1000); }
              continue;
            }
            guard(job);
            if ((await (buildOrigin || digOrigin)(r, job, road)) === 'stopped') return;
            guard(job);
          }
          const land = cell(road, FIRST_RAIL - 1), first = findHead(blockAt, road, FIRST_RAIL);
          if (onRoad(road, bot.entity.position)?.k !== FIRST_RAIL - 1) await walkFar(r, job, land.x, land.y, land.z, 0, {doing: 'walking to the road'});
          if (first.head < FIRST_RAIL && !first.open) {
            if ((await shift(r, job, road, FIRST_RAIL - 1, end)) !== 'again' && !bot.vehicle && job.args.frontier >= end) return;
            continue;
          }
          const far = job.args.frontier ?? FIRST_RAIL, w = cell(road, far, railHeight(far));
          await travel(r, job, road, FIRST_RAIL, far, `walking along the road to ${w.x} ${w.z}`);
          continue;
        }
        const {head, open} = findHead(blockAt, road, k);
        if (open && Math.abs(head - k) <= NEAR) {
          if (++waits > CHUNK_TRIES) { await stopRoad(r, job, road, head, 'the chunks here did not load'); return; }
          await sleep(1000);
          continue;
        }
        waits = 0;
        if (Math.abs(head - k) > NEAR) {
          const {frontier} = job.args;
          const toOrigin = frontier !== undefined && k < frontier / 2;
          const to = toOrigin ? FIRST_RAIL - 1 : Math.max(frontier ?? head, head), w = cell(road, to, railHeight(to));
          await goNear(r, job, w.x, w.y, w.z, toOrigin ? 0 : 2, {doing: `walking along the road, ${k} m, to ${to} m`}); // onto the landing itself: from within 2 of it this asks for ever
          continue;
        }
        const res = await shift(r, job, road, head, end);
        if (res === 'done' || res === 'stopped') return;
      }
    } finally {
      r.digOnly = saved;
      r.mayBuild = null;
    }
  }

  return {highway, restock: fetchLoad, buildOrigin: digOrigin, buildCell, layBooster, removeBooster, layRamp, collectRamp};
}

module.exports = {makeRoad};
