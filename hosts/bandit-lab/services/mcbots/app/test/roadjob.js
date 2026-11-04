'use strict';
// The road job (roadjob.js), against a fake world of deepslate: nothing here needs a server.
const assert = require('node:assert');
const {Vec3} = require('vec3');
const {makeRoad} = require('../roadjob');
const {crossSection, checkCell, cell, niche, isBoosterSlot, mayEndAt, railHeight, originPlan, loadFor, FARMS, FIRST_RAIL, RAMP_CELLS, BORDER_K} = require('../road');
const O = {x: 0, y: 0, z: 0};
const {VALIDATE} = require('../bots');

const road = {dir: 'east', origin: {x: 0, y: 0, z: 0}};
const EMPTY = /^(air|cave_air|water|lava|rail|powered_rail|redstone_torch|short_grass|cobweb|glow_lichen)$/;
const key = ({x, y, z}) => `${x},${y},${z}`;
const isDipCell = (k) => k % 16 === 8 || k % 16 === 9;

// put: blocks by "x,y,z". back: cells a fluid flows back into after each placing. Digging deepslate drops the cobbled kind.
function world(put = {}, {items = {rail: 64, cobbled_deepslate: 64, iron_pickaxe: 1}, back = [], extra = {}} = {}) {
  const blocks = new Map(Object.entries(put));
  const name = (c) => (blocks.has(key(c)) ? blocks.get(key(c)) : 'deepslate');
  const inv = Object.entries(items).map(([n, count]) => ({name: n, count}));
  const log = {placed: [], dug: [], tossed: [], events: [], rides: [], walks: [], slept: 0};
  const add = (n) => { const it = inv.find((i) => i.name === n && i.count < 64); if (it) it.count++; else inv.push({name: n, count: 1}); };
  const bot = {
    entity: {position: new Vec3(0, 0, 0)},
    held: null,
    inventory: {items: () => inv.filter((i) => i.count > 0)},
    blockAt: (p) => { const n = name(p); return {name: n, position: new Vec3(p.x, p.y, p.z), boundingBox: EMPTY.test(n) ? 'empty' : 'block'}; },
    equip: async (it) => { bot.held = it; },
    lookAt: async (p) => { log.looked = p; },
    placeBlock: async (ref, face) => {
      const c = {x: ref.position.x + face.x, y: ref.position.y + face.y, z: ref.position.z + face.z};
      assert.ok(EMPTY.test(name(ref.position)) === false, `placing against ${name(ref.position)}`);
      assert.ok(EMPTY.test(name(c)), `placing into ${name(c)} at ${key(c)}`);
      assert.ok(bot.held?.count > 0, 'nothing in hand');
      bot.held.count--;
      blocks.set(key(c), bot.held.name);
      log.placed.push(`${bot.held.name} ${key(c)}`);
      if (back.includes(key(c))) blocks.set(key(c), 'water');
    },
    tossStack: async (it) => { log.tossed.push(it.count); it.count = 0; },
    entities: {},
    food: 20,
  };
  const deps = {
    edible: (b, it) => it.name === 'bread',
    guard: (job) => { if (job.cancelled) throw new Error('stopped'); },
    sleep: async (ms) => { log.slept += ms; },
    waitCalm: async () => {},
    tossJunk: async () => {},
    gearWanted: () => 0,
    goNear: async (r, job, x, y, z) => { bot.entity.position = new Vec3(x + 0.5, y, z + 0.5); log.walks.push(x); },
    digAt: async (r, job, pos, expect, opts) => {
      const n = name(pos);
      if (!opts?.stay) log.walkedToDig = (log.walkedToDig || 0) + 1;
      log.dug.push(`${n} ${key(pos)}`);
      blocks.set(key(pos), 'air');
      const up = {x: pos.x, y: pos.y + 1, z: pos.z};
      if (name(up) === 'gravel') { blocks.set(key(pos), 'gravel'); blocks.set(key(up), 'air'); for (let c = up, a; name(a = {...c, y: c.y + 1}) === 'gravel'; c = a) { blocks.set(key(c), 'gravel'); blocks.set(key(a), 'air'); } }
      if (n === 'deepslate') add('cobbled_deepslate');
      if (/rail$|torch$/.test(n)) add(n);
      return true;
    },
  };
  return {r: {bot, emit: (kind, text) => log.events.push([kind, text])}, bot, job: {t: {}, args: {}}, log, blocks, name, inv, ...makeRoad({...deps, ...extra}), deps, read: (x, y, z) => { const n = name({x, y, z}); return {name: n, boundingBox: EMPTY.test(n) ? 'empty' : 'block'}; }};
}

// The cells behind k as a finished road, so that the bot has somewhere to stand and something to place against.
function roadTo(k, put = {}) {
  const out = {};
  for (let i = 1; i < k; i++) {
    const {air, rail} = crossSection(road, i);
    for (const c of air) out[key(c)] = 'air';
    out[key(rail)] = 'rail';
  }
  return {...out, ...put};
}
const open = (...cells) => Object.fromEntries(cells.map((c) => [c, 'air']));
const box = (x1, x2, y1, y2, z1, z2, what = 'air') => { const out = {}; for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) out[`${x},${y},${z}`] = what; return out; };

module.exports = (async () => {
  { // digs and lays a flat cell, then a dip, in road order
    const w = world(roadTo(7));
    for (const k of [7, 8, 9, 10]) assert.strictEqual(await w.buildCell(w.r, w.job, road, k), 'ok', `k ${k}`);
    for (const k of [7, 8, 9, 10]) assert.deepStrictEqual(checkCell(w.read, road, k), [], `k ${k}`);
    assert.deepStrictEqual(w.log.placed.filter((p) => p.startsWith('rail')), ['rail 7,0,0', 'rail 8,-1,0', 'rail 9,-1,0', 'rail 10,0,0']);
  }
  { // the bot never stands in a cell not finished
    const w = world(roadTo(20));
    const seen = [];
    const place = w.bot.placeBlock;
    w.bot.placeBlock = async (...a) => { seen.push(w.bot.entity.position.x); return place(...a); };
    await w.buildCell(w.r, w.job, road, 20);
    assert.ok(seen.every((x) => x < 20), `stood at ${seen}`);
  }
  { // keeps natural rock: nothing placed where the wall stands
    const w = world(roadTo(20, {'20,0,1': 'granite', '20,1,-1': 'tuff'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(w.log.placed, ['rail 20,0,0']);
    assert.strictEqual(w.name({x: 20, y: 0, z: 1}), 'granite');
  }
  { // lines what is open: floor, walls and roof over a big cave, from what it carries
    const w = world(roadTo(20, box(20, 26, -6, 8, -6, 6)));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(checkCell(w.read, road, 20), []);
    for (const c of crossSection(road, 20).solid) assert.strictEqual(w.name(c), 'cobbled_deepslate', key(c));
  }
  { // across a cave, through a dip: a floor with nothing to hold it gets a block in the road for a moment, gone again at the end
    const w = world(roadTo(20, box(20, 30, -6, 8, -6, 6)));
    for (let k = 20; k <= 27; k++) assert.strictEqual(await w.buildCell(w.r, w.job, road, k), 'ok', `k ${k}`);
    for (let k = 20; k <= 27; k++) assert.deepStrictEqual(checkCell(w.read, road, k), [], `k ${k}`);
    assert.strictEqual(w.name({x: 24, y: -2, z: 0}), 'cobbled_deepslate');
    assert.strictEqual(w.name({x: 24, y: -1, z: 0}), 'rail');
  }
  { // nothing at all to place against: it says so, and does not try for ever
    const w = world(box(10, 30, -6, 8, -6, 6));
    assert.match((await w.buildCell(w.r, w.job, road, 20)).stop, /^cannot continue: /);
  }
  { // a mineshaft's rail lying across the road goes, and ours is laid
    const w = world(roadTo(20, open('20,1,0')));
    w.blocks.set('20,0,0', 'rail');
    const read = w.bot.blockAt;
    let across = true;
    w.bot.blockAt = (p) => { const b = read(p); return key(p) === '20,0,0' && b.name === 'rail' ? {...b, getProperties: () => ({shape: across ? 'north_south' : 'east_west'})} : b; };
    const dig = w.log.dug;
    const place = w.bot.placeBlock;
    w.bot.placeBlock = async (...a) => { across = false; return place(...a); };
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.ok(dig.includes('rail 20,0,0'));
    assert.ok(w.log.placed.includes('rail 20,0,0'));
  }
  { // half built by a bot that died: the block it left in the road is its own, not a player's
    const w = world(roadTo(20, {'20,0,0': 'cobbled_deepslate', '20,0,1': 'cobbled_deepslate'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(checkCell(w.read, road, 20), []);
  }
  { // glow lichen grows in water, where a dig is refused (east, 465 m): a block goes straight onto it
    const w = world(roadTo(20, {'20,1,-1': 'glow_lichen'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.ok(!w.log.dug.includes('glow_lichen 20,1,-1'));
    assert.strictEqual(w.name({x: 20, y: 1, z: -1}), 'cobbled_deepslate');
  }
  { // a wall of grass or a cobweb cannot be placed against or through: dug, then lined
    const w = world(roadTo(20, {'20,0,1': 'short_grass', '20,1,-1': 'cobweb'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(checkCell(w.read, road, 20), []);
    assert.ok(w.log.dug.includes('short_grass 20,0,1') && w.log.dug.includes('cobweb 20,1,-1'));
  }
  { // water in the wall and in the road
    const w = world(roadTo(20, {'20,1,1': 'water', '20,0,0': 'water'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(checkCell(w.read, road, 20), []);
  }
  { // fluid that comes back stops the road
    const w = world(roadTo(20, {'20,1,1': 'water'}), {back: ['20,1,1']});
    assert.match((await w.buildCell(w.r, w.job, road, 20)).stop, /^cannot continue: /);
    assert.strictEqual(w.log.placed.filter((p) => p.endsWith('20,1,1')).length, 3, 'three tries');
    assert.strictEqual(w.log.dug.length, 0, 'the road stays shut');
  }
  { // gravel in the roof with more above it: dug until rock holds, then lined
    const w = world(roadTo(20, {'20,2,0': 'gravel', '20,3,0': 'gravel', '20,4,0': 'gravel'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(checkCell(w.read, road, 20), []);
    assert.strictEqual(w.log.dug.filter((d) => d.startsWith('gravel')).length, 3);
    assert.strictEqual(w.log.walkedToDig, undefined, 'from where it stands: the roof ahead cannot be seen, and looking for a spot took 19 s a block');
  }
  { // gravel without end is not a loop without end
    const w = world(roadTo(20, box(20, 20, 2, 60, 0, 0, 'gravel')));
    assert.match((await w.buildCell(w.r, w.job, road, 20)).stop, /^cannot continue: /);
    assert.ok(w.log.dug.length <= 16, `dug ${w.log.dug.length}`);
  }
  { // a block it must not dig
    for (const [what, why] of [['chest', 'keep'], ['oak_sign', 'player'], ['sculk_shrieker', 'danger']]) {
      const w = world(roadTo(20, {'20,0,0': what}));
      assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {stop: why}, what);
      assert.strictEqual(w.log.dug.length + w.log.placed.length, 0, what);
    }
  }
  { // mineshaft wood in the road is dug, its rail too, unless it lies where the rail goes
    const w = world(roadTo(20, {'20,1,0': 'oak_planks', '21,1,0': 'rail', '21,0,0': 'oak_fence'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 21), 'ok');
    assert.deepStrictEqual(checkCell(w.read, road, 21), []);
  }
  { // resumes a half-built cell: floor laid, air dug, no rail. No second rail, nothing dug again
    const w = world(roadTo(20, open('20,0,0', '20,1,0')));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(w.log.dug, []);
    assert.deepStrictEqual(w.log.placed, ['rail 20,0,0']);
  }
  { // a finished cell is left alone
    const w = world(roadTo(21));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual([w.log.dug, w.log.placed], [[], []]);
  }
  { // a booster already in the cell stays
    const w = world(roadTo(21, {'20,0,0': 'powered_rail', '20,0,1': 'redstone_torch'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual([w.log.dug, w.log.placed], [[], []]);
  }
  { // runs out of lining: says so, and the cell stays shut
    const w = world(roadTo(20, {'20,0,1': 'air'}), {items: {rail: 64, iron_pickaxe: 1}});
    assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {out: 'lining'});
    assert.deepStrictEqual(w.log.dug, []);
    assert.strictEqual(w.name({x: 20, y: 0, z: 0}), 'deepslate');
  }
  { // runs out of rails
    const w = world(roadTo(20), {items: {cobbled_deepslate: 64, iron_pickaxe: 1}});
    assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {out: 'rail'});
  }
  { // a rail that will not stay: three tries, then the road stops
    const w = world(roadTo(20, open('20,0,0', '20,1,0')), {back: ['20,0,0']});
    assert.match((await w.buildCell(w.r, w.job, road, 20)).stop, /^cannot continue: /);
  }
  { // a chunk that has not come: nothing done, and no stop
    const w = world(roadTo(20));
    const read = w.bot.blockAt;
    w.bot.blockAt = (p) => (p.x === 20 ? null : read(p));
    assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {out: 'unloaded'});
    assert.deepStrictEqual([w.log.dug, w.log.placed], [[], []]);
  }
  { // keeps four stacks of rock for lining and throws the rest away
    const w = world(roadTo(20), {items: {rail: 64, iron_pickaxe: 1}});
    for (let i = 0; i < 6; i++) w.inv.push({name: i % 2 ? 'cobblestone' : 'cobbled_deepslate', count: 64});
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.strictEqual(w.bot.inventory.items().filter((i) => /cobble/.test(i.name)).length, 4);
    assert.strictEqual(w.log.tossed.length, 3, 'the two left over and the one the cell dug');
    assert.ok(w.log.looked.x < 20, 'behind it, or it walks over them again and picks them up');
  }
  // ---- the ramp ----
  const kit = {rail: 64, cobbled_deepslate: 64, iron_pickaxe: 1, powered_rail: 48, redstone_torch: 48};
  const have = (w, n) => w.inv.filter((i) => i.name === n).reduce((sum, i) => sum + i.count, 0);
  const boosters = (w, from, to) => { let n = 0; for (let k = from; k <= to; k++) if (w.name(cell(road, k)) === 'powered_rail') n++; return n; };
  { // a booster swaps in place
    const w = world(roadTo(1010), {items: kit});
    assert.strictEqual(await w.layBooster(w.r, w.job, road, 1004), true);
    assert.strictEqual(w.name(cell(road, 1004)), 'powered_rail');
    assert.strictEqual(w.name(niche(road, 1004)), 'redstone_torch');
    assert.deepStrictEqual([have(w, 'powered_rail'), have(w, 'redstone_torch'), have(w, 'rail')], [47, 47, 65]);
    assert.deepStrictEqual(checkCell(w.read, road, 1004), []);
  }
  { // a booster that does not go down at once is tried again: the real road had a hole at 164 m (sandbox, 2026-11-04)
    const w = world(roadTo(1010), {items: kit});
    const place = w.bot.placeBlock;
    let refused = 1;
    w.bot.placeBlock = async (ref, face) => { if (w.bot.held?.name === 'powered_rail' && refused-- > 0) throw new Error('timeout'); return place(ref, face); };
    assert.strictEqual(await w.layBooster(w.r, w.job, road, 1004), true);
    assert.strictEqual(w.name(cell(road, 1004)), 'powered_rail');
  }
  { // and if it never does, a plain rail goes back: never a hole in the road
    const w = world(roadTo(1010), {items: kit});
    const place = w.bot.placeBlock;
    w.bot.placeBlock = async (ref, face) => { if (w.bot.held?.name === 'powered_rail') throw new Error('timeout'); return place(ref, face); };
    assert.strictEqual(await w.layBooster(w.r, w.job, road, 1004), false);
    assert.strictEqual(w.name(cell(road, 1004)), 'rail');
  }
  for (const [what, block] of [['a cave', 'air'], ['water', 'water'], ['gravel', 'gravel']]) { // no niche into one, on any side of it
    for (const at of ['1004,0,2', '1004,1,1', '1004,-1,1', '1003,0,1', '1005,0,1']) {
      const w = world(roadTo(1010, {[at]: block}), {items: kit});
      assert.strictEqual(await w.layBooster(w.r, w.job, road, 1004), false, `${what} at ${at}`);
      assert.deepStrictEqual([w.log.dug, w.log.placed], [[], []], `${what} at ${at}`);
    }
  }
  { // nothing to lay it with: no booster, and the rail stays as it is
    const w = world(roadTo(1010), {items: {...kit, powered_rail: 0}});
    assert.strictEqual(await w.layBooster(w.r, w.job, road, 1004), false);
    assert.deepStrictEqual(w.log.dug, []);
  }
  { // a ramp is laid walking back, and the bot is back at the head
    const w = world(roadTo(1002), {items: kit});
    assert.strictEqual(await w.layRamp(w.r, w.job, road, 1000), 48);
    assert.strictEqual(boosters(w, 700, 1000), 48);
    for (let k = 1000 - RAMP_CELLS + 1; k <= 1000; k++) assert.deepStrictEqual(checkCell(w.read, road, k), [], `k ${k}`);
    assert.ok(Math.abs(w.bot.entity.position.x - 1000.5) <= 1, 'at the head');
  }
  { // a bot sees 128 blocks and a ramp is 256 long: it walks to what it cannot see yet, both ways
    const w = world(roadTo(1002), {items: kit});
    const read = w.bot.blockAt;
    w.bot.blockAt = (p) => (Math.abs(p.x - w.bot.entity.position.x) > 128 ? null : read(p));
    w.bot.entity.position = new Vec3(500.5, 0, 0.5);
    assert.strictEqual(await w.layRamp(w.r, w.job, road, 1000), 48);
    w.bot.entity.position = new Vec3(500.5, 0, 0.5);
    assert.strictEqual(await w.collectRamp(w.r, w.job, road, 1000), 48);
    assert.deepStrictEqual(boosters(w, 700, 1000), 0);
  }
  { // too few boosters: as many as it has, no failure
    const w = world(roadTo(1002), {items: {...kit, powered_rail: 10}});
    assert.strictEqual(await w.layRamp(w.r, w.job, road, 1000), 10);
    assert.strictEqual(boosters(w, 900, 1000), 10, 'the nearest to the head first');
  }
  { // collecting leaves the road as it was
    const w = world(roadTo(1002), {items: kit});
    await w.layRamp(w.r, w.job, road, 1000);
    assert.strictEqual(await w.collectRamp(w.r, w.job, road, 1000), 48);
    assert.deepStrictEqual([have(w, 'powered_rail'), have(w, 'redstone_torch')], [48, 48]);
    for (let k = 1000 - RAMP_CELLS + 1; k <= 1000; k++) {
      assert.deepStrictEqual(checkCell(w.read, road, k), [], `k ${k}`);
      assert.strictEqual(w.name(cell(road, k, isDipCell(k) ? -1 : 0)), 'rail', `k ${k}`);
      if (isBoosterSlot(k)) assert.strictEqual(w.name(niche(road, k)), 'cobbled_deepslate', `k ${k}`);
    }
    assert.ok(Math.abs(w.bot.entity.position.x - 1000.5) <= 1, 'at the head');
  }
  { // the origin's ramp stays
    const w = world(roadTo(302), {items: kit});
    const slots = [];
    for (let k = FIRST_RAIL; k <= 300; k++) if (isBoosterSlot(k)) slots.push(k);
    for (const k of slots) { w.blocks.set(`${k},0,0`, 'powered_rail'); w.blocks.set(`${k},0,1`, 'redstone_torch'); }
    const taken = await w.collectRamp(w.r, w.job, road, 300);
    assert.strictEqual(taken, slots.filter((k) => k > FIRST_RAIL + RAMP_CELLS).length);
    for (const k of slots.filter((s) => s <= FIRST_RAIL + RAMP_CELLS)) assert.strictEqual(w.name(cell(road, k)), 'powered_rail', `k ${k}`);
    for (const k of slots.filter((s) => s > FIRST_RAIL + RAMP_CELLS)) assert.strictEqual(w.name(cell(road, k)), 'rail', `k ${k}`);
  }
  { // a ramp with holes: what stands is taken
    const w = world(roadTo(1002), {items: kit});
    await w.layRamp(w.r, w.job, road, 1000);
    for (const k of [996, 992]) { w.blocks.set(`${k},0,0`, 'rail'); w.blocks.set(`${k},0,1`, 'cobbled_deepslate'); }
    assert.strictEqual(await w.collectRamp(w.r, w.job, road, 1000), 46);
  }
  { // no rock to shut a niche again: that booster stays until there is, rather than leave a hole
    const w = world(roadTo(1010), {items: {...kit, cobbled_deepslate: 0}});
    w.blocks.set('1004,0,0', 'powered_rail');
    w.blocks.set('1004,0,1', 'redstone_torch');
    assert.strictEqual(await w.removeBooster(w.r, w.job, road, 1004), false);
    assert.strictEqual(w.name(cell(road, 1004)), 'powered_rail');
    assert.deepStrictEqual(w.log.dug, []);
  }
  // ---- the job ----
  const load = {rail: 640, cobbled_deepslate: 64, iron_pickaxe: 8, powered_rail: 96, redstone_torch: 96, minecart: 1};
  // A trip as the world would have it: the cart runs along the rails and stands in the landing past their end.
  const fakeRide = (w, {fail, rideOnFail} = {}) => ({
    takeCart: async () => true,
    rideOn: async () => { if (rideOnFail) { w.bot.vehicle = null; throw new Error(rideOnFail); } w.log.rideOn = (w.log.rideOn || 0) + 1; w.bot.vehicle = null; w.bot.entity.position = new Vec3((w.log.rideOnTo ?? 0) + 0.5, 0, 0.5); return w.bot.entity.position; },
    ride: async (r, job, rail) => {
      if (fail) throw new Error(fail);
      const from = rail.x, out = from < 50;
      w.log.rides.push(from);
      let k = from;
      if (out) { while (/rail$/.test(w.name(cell(road, k + 1, railHeight(k + 1))))) k++; k++; } else k = FIRST_RAIL - 1;
      w.bot.entity.position = new Vec3(k + 0.5, 0, 0.5);
      return w.bot.entity.position;
    },
  });
  const job = (put, opts = {}, {at = FIRST_RAIL - 1, args = {}, ride = {}, restock, origin} = {}) => {
    const holder = {};
    const w = world(put, {items: load, ...opts, extra: {restock: restock || (async () => 'ok'), buildOrigin: origin || (async () => {}), get ride() { return holder.ride; }}});
    holder.ride = fakeRide(w, ride);
    Object.assign(w, makeRoad({...w.deps, restock: restock || (async () => 'ok'), buildOrigin: origin || (async () => {}), ride: holder.ride}));
    w.bot.entity.position = new Vec3(at + 0.5, 0, 0.5);
    w.job.type = 'highway';
    w.job.args = {dir: 'east', ...args};
    return w;
  };
  const alerts = (w) => w.log.events.filter(([kind]) => kind === 'alert').map(([, text]) => text);
  const rails = (w) => w.log.placed.filter((p) => p.startsWith('rail '));
  const start = {}; for (let k = 0; k < FIRST_RAIL; k++) { start[`${k},0,0`] = 'air'; start[`${k},1,0`] = 'air'; }

  { // a new road: no rail yet, so it builds from the first cell, boosters of the origin's ramp as it goes
    const w = job(start, {}, {args: {length: 30}});
    await w.highway(w.r, w.job);
    for (let k = FIRST_RAIL; k <= 30; k++) assert.deepStrictEqual(checkCell(w.read, road, k), [], `k ${k}`);
    assert.strictEqual(w.name(cell(road, 12)), 'powered_rail');
    assert.strictEqual(w.name(cell(road, 16)), 'powered_rail');
    assert.strictEqual(w.name(cell(road, 15)), 'rail');
    assert.strictEqual(w.job.args.frontier, 30, 'keeps the frontier');
    assert.deepStrictEqual(alerts(w), []);
    assert.deepStrictEqual(w.log.rides, [], 'nothing to ride yet');
  }
  { // rides out to the real end, whatever the frontier said
    const w = job(roadTo(301, start), {}, {args: {length: 310, frontier: 40}});
    await w.highway(w.r, w.job);
    assert.deepStrictEqual(w.log.rides, [FIRST_RAIL]);
    for (let k = 301; k <= 310; k++) assert.deepStrictEqual(checkCell(w.read, road, k), [], `k ${k}`);
    assert.strictEqual(w.job.args.frontier, 310);
    assert.ok(!w.log.placed.some((p) => p.startsWith('powered_rail 3') && +p.split(' ')[1].split(',')[0] <= 300), 'no booster laid on what stood');
  }
  { // resumes a half-built cell: no second rail, no gap
    const w = job(roadTo(301, open('301,0,0', '301,1,0')), {}, {at: 301, args: {length: 301}});
    await w.highway(w.r, w.job);
    assert.deepStrictEqual(rails(w), ['rail 301,0,0']);
    assert.deepStrictEqual(w.log.dug, []);
  }
  { // a bot that logs in riding rides on, and then does what it would do where it stands
    const w = job(roadTo(301), {}, {at: 200, args: {length: 301}});
    w.bot.vehicle = {id: 7};
    w.log.rideOnTo = 300;
    await w.highway(w.r, w.job);
    assert.strictEqual(w.log.rideOn, 1);
    assert.deepStrictEqual(rails(w), ['rail 301,0,0'], 'at the head it works');
  }
  { // logged in riding a cart that never stands: off it, and on from where it is
    const w = job(roadTo(301), {}, {at: 200, args: {length: 301}, ride: {rideOnFail: 'ride took over 126 s'}});
    w.bot.vehicle = {id: 7};
    await w.highway(w.r, w.job);
    assert.deepStrictEqual(rails(w), ['rail 301,0,0']);
  }
  { // stranded mid-road walks to the head when that is nearer
    const w = job(roadTo(1501), {}, {at: 1000, args: {length: 1501, frontier: 1500}});
    const read = w.bot.blockAt;
    w.bot.blockAt = (p) => (Math.abs(p.x - w.bot.entity.position.x) > 128 ? null : read(p));
    await w.highway(w.r, w.job);
    assert.ok(w.log.walks.includes(1500), `walked to ${w.log.walks.slice(0, 4)}`);
    assert.deepStrictEqual(w.log.rides, []);
    assert.deepStrictEqual(rails(w), ['rail 1501,0,0']);
  }
  { // and to the origin when that is, and rides out from there
    const w = job(roadTo(1501, start), {}, {at: 200, args: {length: 1501, frontier: 1500}});
    const read = w.bot.blockAt;
    w.bot.blockAt = (p) => (Math.abs(p.x - w.bot.entity.position.x) > 128 ? null : read(p));
    await w.highway(w.r, w.job);
    assert.strictEqual(w.log.walks[0], FIRST_RAIL - 1);
    assert.deepStrictEqual(w.log.rides, [FIRST_RAIL]);
  }
  { // chunks that have not come: it waits and reads again
    const w = job(roadTo(301), {}, {at: 300, args: {length: 301}});
    const read = w.bot.blockAt;
    let misses = 100;
    w.bot.blockAt = (p) => (misses-- > 0 ? null : read(p));
    await w.highway(w.r, w.job);
    assert.deepStrictEqual(alerts(w), []);
    assert.deepStrictEqual(rails(w), ['rail 301,0,0']);
  }
  { // chunks that never come: it says so, once, and the job ends
    const w = job(roadTo(301), {}, {at: 300, args: {length: 400}});
    const read = w.bot.blockAt;
    w.bot.blockAt = (p) => (p.x > 310 ? null : read(p));
    await w.highway(w.r, w.job);
    assert.strictEqual(alerts(w).length, 1);
    assert.match(alerts(w)[0], /^highway: east/);
    assert.match(alerts(w)[0], /not load/);
  }
  { // a player block stops the road: one alert, nothing dug towards it, the bot goes home, the frontier stays
    const w = job(roadTo(301, {'308,3,3': 'torch', ...start}), {}, {at: 301, args: {length: 400, frontier: 300}});
    await w.highway(w.r, w.job);
    assert.strictEqual(alerts(w).length, 1);
    assert.match(alerts(w)[0], /^highway: east stopped at 300 m: torch at 308 3 3/);
    assert.strictEqual(w.job.args.frontier, 300);
    assert.ok(!w.log.dug.some((d) => /^(deepslate|stone) 30[3-9],/.test(d)), 'it does not build towards it');
    assert.strictEqual(w.log.rides.length, 1, 'home by cart');
  }
  { // a chest in the road, and a road that cannot go straight, say so the same way
    const w = job(roadTo(301, {'305,0,0': 'chest', ...start}), {}, {at: 301, args: {length: 400}});
    await w.highway(w.r, w.job);
    assert.match(alerts(w)[0], /chest at 305 0 0/);
    const v = job(roadTo(301, {'303,1,1': 'water', ...start}), {back: ['303,1,1']}, {at: 301, args: {length: 400}});
    await v.highway(v.r, v.job);
    assert.match(alerts(v)[0], /cannot continue/);
    assert.ok(!v.log.dug.some((d) => /^\S+ 30[3-9],/.test(d)), 'the cell stays shut');
  }
  { // ends at length, and at the border, with no alert
    const w = job(roadTo(301), {}, {at: 300, args: {length: 300}});
    await w.highway(w.r, w.job);
    assert.deepStrictEqual([w.log.dug, w.log.placed, alerts(w)], [[], [], []]);
    const near = {};
    for (let k = BORDER_K - 2; k <= BORDER_K - 1; k++) { for (const c of crossSection(road, k).air) near[key(c)] = 'air'; near[key(crossSection(road, k).rail)] = 'rail'; }
    const b = job(near, {}, {at: BORDER_K - 1, args: {}});
    await b.highway(b.r, b.job);
    assert.deepStrictEqual(b.name(cell(road, BORDER_K)), 'rail', 'the last cell');
    assert.notStrictEqual(b.name(cell(road, BORDER_K + 1)), 'rail', 'and none past it');
    assert.deepStrictEqual(alerts(b), []);
  }
  { // a shift ends with few rails: on to a place the rail may end, a landing past it, the ramp behind it, then home
    const w = job(roadTo(301, start), {items: {...load, rail: 30}}, {at: 301, args: {}, restock: async (r, j) => { j.cancelled = true; return 'ok'; }});
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    const head = w.log.rides[0];
    assert.ok(mayEndAt(head), `head ${head}`);
    assert.ok(head >= 301 + 14 && head <= 301 + 30, `head ${head}`);
    assert.strictEqual(w.name(cell(road, head + 1)), 'air', 'a landing');
    assert.strictEqual(w.name(cell(road, head + 1, 1)), 'air');
    assert.strictEqual(w.name(cell(road, head + 2)), 'deepslate', 'rock past it');
    assert.ok(w.log.placed.some((p) => p.startsWith('powered_rail')), 'a ramp');
    assert.strictEqual(w.job.args.frontier, head);
  }
  { // one pickaxe left: no more road, because the ramp and the cart need it
    const w = job(roadTo(301, start), {items: {...load, iron_pickaxe: 1}}, {at: 301, args: {}, restock: async (r, j) => { j.cancelled = true; return 'ok'; }});
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    assert.ok(w.log.rides[0] <= 301 + 8, `head ${w.log.rides[0]}`);
  }
  { // no food and hungry ends a shift; with food it goes on, the bot eats by itself
    const w = job(roadTo(301, start), {}, {at: 301, args: {}, restock: async (r, j) => { j.cancelled = true; return 'ok'; }});
    w.bot.food = 5;
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    assert.ok(w.log.rides.length === 1);
    const v = job(roadTo(301), {items: {...load, bread: 8}}, {at: 301, args: {length: 310}});
    v.bot.food = 5;
    await v.highway(v.r, v.job);
    assert.deepStrictEqual(v.log.rides, []);
  }
  { // out of lining in a dip over a cave: rails taken up to where the rail may end, with the built cells past it as the landing
    const w = job(roadTo(296, box(296, 330, -6, 8, -6, 6)), {items: {...load, cobbled_deepslate: 40}}, {at: 296, args: {}, restock: async (r, j) => { j.cancelled = true; return 'ok'; }});
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    const head = w.log.rides[0];
    assert.ok(mayEndAt(head), `head ${head}`);
    assert.notStrictEqual(w.name(cell(road, head + 1, railHeight(head + 1))), 'rail', 'no rail past it');
    assert.deepStrictEqual(alerts(w), [], 'the road is not stopped for this');
    for (const h of [0, 1]) assert.strictEqual(w.name(cell(road, head + 2, h)), 'cobbled_deepslate', `the last lining goes to the front, at ${h}`);
  }
  { // a rail's end in a cave has nothing to stop a cart: a floor under the landing and a front past it (sandbox: off the rail at 869 m, came down at 885 m, y -9)
    const w = job(roadTo(301, box(301, 330, -6, 8, -6, 6)), {items: {...load, rail: 16}}, {at: 301, args: {}, restock: async (r, j) => { j.cancelled = true; return 'ok'; }});
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    const head = w.log.rides[0];
    assert.ok(mayEndAt(head), `head ${head}`);
    assert.strictEqual(w.name(cell(road, head + 1, -1)), 'cobbled_deepslate', 'a floor under the landing');
    assert.strictEqual(w.name(cell(road, head + 1)), 'air', 'a landing');
    for (const h of [0, 1]) assert.strictEqual(w.name(cell(road, head + 2, h)), 'cobbled_deepslate', `the front at ${h}`);
  }
  { // the next shift takes that front away and goes on
    const put = roadTo(301, box(301, 330, -6, 8, -6, 6));
    for (const c of [cell(road, 301, -1), cell(road, 302, -1), cell(road, 302), cell(road, 302, 1)]) put[`${c.x},${c.y},${c.z}`] = 'cobbled_deepslate';
    const w = job(put, {}, {at: 301, args: {length: 306}});
    await w.highway(w.r, w.job);
    assert.deepStrictEqual(alerts(w), []);
    assert.ok(/rail$/.test(w.name(cell(road, 302))), 'a rail where the front stood');
    assert.strictEqual(w.name(cell(road, 302, 1)), 'air');
  }
  { // far out and off the road: back to the road with no digging, no farm round from there (sandbox: stairs up through a lake)
    const home = async () => { throw new Error('a load from out there'); };
    const w = job(roadTo(901), {}, {at: 901, args: {length: 902}, restock: home});
    w.bot.entity.position = new Vec3(905.5, -9, 0.5);
    const walk = w.deps.goNear;
    let dug = null;
    const m = makeRoad({...w.deps, goNear: async (r, ...a) => { dug = r.digOnly.test('stone'); return walk(r, ...a); }, restock: home, buildOrigin: async () => {}, ride: fakeRide(w)});
    await m.highway(w.r, w.job);
    assert.strictEqual(dug, false, 'that walk digs nothing');
    assert.strictEqual(w.log.walks[0], 900, 'to the last rail');
    assert.ok(/rail$/.test(w.name(cell(road, 901))));
    const v = job(roadTo(901), {}, {at: 901, args: {length: 902}, restock: home});
    v.bot.entity.position = new Vec3(905.5, -9, 0.5);
    const n = makeRoad({...v.deps, goNear: async () => { throw new Error('could not reach 901 0 0: no path'); }, restock: home, buildOrigin: async () => {}, ride: fakeRide(v)});
    await assert.rejects(n.highway(v.r, v.job), /off the road at 905 -9 0: could not reach/);
  }
  { // off the road near the farms it goes for its load as ever
    let loads = 0;
    const w = job(roadTo(301), {}, {at: 301, args: {}, restock: async (r, j) => { loads++; j.cancelled = true; return 'ok'; }});
    w.bot.entity.position = new Vec3(305.5, -9, 0.5);
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    assert.strictEqual(loads, 1);
  }
  { // on coming back it takes up the old ramp, once, and not when there is none
    const put = roadTo(1001, start);
    for (let k = 1000; k > 1000 - RAMP_CELLS; k--) if (isBoosterSlot(k)) { put[`${k},0,0`] = 'powered_rail'; put[`${k},0,1`] = 'redstone_torch'; }
    const w = job(put, {items: {...load, powered_rail: 0, redstone_torch: 0}}, {at: 1001, args: {length: 1010}});
    await w.highway(w.r, w.job);
    assert.strictEqual([...w.blocks.values()].filter((n) => n === 'powered_rail').length, 0);
    const v = job(roadTo(1001), {}, {at: 1001, args: {length: 1002}});
    const walks = v.log.walks;
    await v.highway(v.r, v.job);
    assert.ok(walks.every((x) => x >= 990), `walked back to ${Math.min(...walks)}`);
  }
  { // no cart at the head: walks home, no failure
    const w = job(roadTo(301, start), {items: {...load, rail: 20}}, {at: 301, args: {}, ride: {fail: 'no cart in the inventory'}, restock: async (r, j) => { j.cancelled = true; return 'ok'; }});
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    assert.strictEqual(w.log.walks.at(-1), FIRST_RAIL - 1);
    assert.deepStrictEqual(alerts(w), []);
  }
  { // a ride that never ends (a cart left on the rail stops the next rider in a dip): on foot from there, not the end of the job
    const w = job(roadTo(301, start), {items: {...load, rail: 20}}, {at: 301, args: {}, ride: {fail: 'ride took over 126 s'}, restock: async (r, j) => { j.cancelled = true; return 'ok'; }});
    await assert.rejects(w.highway(w.r, w.job), /stopped/);
    assert.strictEqual(w.log.walks.at(-1), FIRST_RAIL - 1);
  }
  { // a shrieker: no road towards it, back along the road, again after 5 minutes, then stop
    const w = job(roadTo(301, {'308,3,0': 'sculk_shrieker', ...start}), {}, {at: 301, args: {length: 400}});
    await w.highway(w.r, w.job);
    assert.ok(w.log.slept >= 300000, `slept ${w.log.slept}`);
    assert.ok(w.log.walks.some((x) => x < 301 - 16), 'back along the road');
    assert.strictEqual(alerts(w).length, 1, 'only when it stops');
    assert.match(alerts(w)[0], /sculk_shrieker/);
  }
  { // a warden: the same, and it does not wait for the next segment
    const w = job(roadTo(301, start), {}, {at: 301, args: {length: 400}});
    w.bot.entities[1] = {name: 'warden', position: new Vec3(310, 0, 0)};
    await w.highway(w.r, w.job);
    assert.ok(w.log.slept >= 300000);
    assert.match(alerts(w)[0], /warden/);
    const gone = job(roadTo(301, start), {}, {at: 301, args: {length: 303}});
    gone.bot.entities[1] = {name: 'warden', position: new Vec3(310, 0, 0)};
    const back = gone.deps.sleep;
    Object.assign(gone, makeRoad({...gone.deps, restock: async () => 'ok', buildOrigin: async () => {}, ride: fakeRide(gone), sleep: async (ms) => { delete gone.bot.entities[1]; return back(ms); }}));
    await gone.highway(gone.r, gone.job);
    assert.deepStrictEqual(alerts(gone), [], 'it left: the road goes on');
    assert.strictEqual(gone.job.args.frontier, 303);
  }
  { // farms empty: it waits, and tries again
    let calls = 0;
    const w = job(start, {}, {args: {length: 8}, restock: async () => (++calls < 3 ? 'waiting' : 'ok')});
    await w.highway(w.r, w.job);
    assert.strictEqual(calls, 3);
    assert.ok(w.log.slept >= 2 * 60000);
  }
  // ---- the load ----
  {
    const farms = [{x: 10, y: 0, z: 0, items: ['rail', 'bread']}, {x: 500, y: 0, z: 0, items: ['rail']}];
    const full = {rail: 960, stick: 128, iron_pickaxe: 8, powered_rail: 96, redstone_torch: 96, minecart: 1, bread: 32, cobblestone: 128, iron_sword: 1};
    const setup = (items, {get, near = () => [], count = async () => {}, now, walk} = {}) => {
      const w = world({}, {items}), asked = [];
      w.job.args = {dir: 'east', frontier: 5000};
      w.bot.entity.position = new Vec3(1000, 70, 1000);
      const deps = {...w.deps, ...(walk ? {goNear: walk(w.deps.goNear)} : {}), farms, now, chestsNear: near, countChest: count, ensureGear: async () => { w.log.geared = true; }, gearWanted: () => 0, tossJunk: async () => { w.log.junk = true; },
        get: async (r, j, item, n) => { VALIDATE.get({item, count: n}); asked.push([item, n, Math.floor(w.bot.entity.position.x)]); w.log.seen = r.farmChests; if (get) await get(item, n, w); const it = w.inv.find((i) => i.name === item); if (it) it.count += n; else w.inv.push({name: item, count: n}); }};
      return {w, asked, m: makeRoad(deps)};
    };
    { // fetches only what is short, and rails need no list of their own: get plans chests and crafts
      const {w, asked, m} = setup({...full, rail: 704});
      assert.strictEqual(await m.restock(w.r, w.job, road), 'ok');
      assert.deepStrictEqual(asked, [['rail', 256, 10]]);
      assert.strictEqual(w.log.geared, true);
      assert.ok(w.log.seen instanceof Map, 'get looks at the farms only');
      assert.strictEqual(w.r.farmChests, null, 'and everyone else at what they always did');
    }
    { // a get takes at most 256: a whole load comes in several, and rock from the last trip goes first
      const {w, asked, m} = setup({...full, rail: 0});
      assert.strictEqual(await m.restock(w.r, w.job, road), 'ok');
      assert.deepStrictEqual(asked, [['rail', 256, 10], ['rail', 256, 10], ['rail', 256, 10], ['rail', 192, 10]]);
      assert.strictEqual(w.log.junk, true);
    }
    { // a get that brings nothing is not asked again, or it would ask for ever
      let calls = 0;
      const {w, m} = setup({...full, rail: 0}, {get: async (item, n, v) => { calls++; const it = v.inv.find((i) => i.name === 'rail'); it.count -= n; }});
      await m.restock(w.r, w.job, road);
      assert.strictEqual(calls, 2, 'once at each of the two farms');
    }
    { // nothing that matters is low, so nobody walks off for a few blocks of cobblestone: a bot back at the origin after a restart stays
      const {w, asked, m} = setup({...full, rail: 720, stick: 40, cobblestone: 4, iron_sword: 0, sand: 1});
      assert.strictEqual(await m.restock(w.r, w.job, road), 'ok');
      assert.deepStrictEqual(asked, []);
      assert.strictEqual(w.log.junk, undefined, 'and throws nothing away');
    }
    { // one round: each farm once, with everything it has at one stop, however the load is ordered
      const round = [{x: 10, y: 0, z: 0, items: ['rail', 'bread']}, {x: 500, y: 0, z: 0, items: ['stick', 'rail']}];
      const w = world({}, {items: {...full, rail: 704, stick: 0, bread: 0}});
      w.job.args = {dir: 'east', frontier: 5000};
      w.bot.entity.position = new Vec3(1000, 70, 1000);
      const asked = [], stops = [];
      const m = makeRoad({...w.deps, farms: round, chestsNear: () => [], countChest: async () => {}, ensureGear: async () => {}, gearWanted: () => 0, tossJunk: async () => {},
        goNear: async (r, j, x) => { stops.push(x); w.bot.entity.position.x = x; },
        get: async (r, j, item, n) => { asked.push([item, n, w.bot.entity.position.x]); w.inv.find((i) => i.name === item).count += n; }});
      await m.restock(w.r, w.job, road);
      assert.deepStrictEqual(stops, [10, 500]);
      assert.deepStrictEqual(asked, [['rail', 256, 10], ['bread', 32, 10], ['stick', 128, 500]]);
    }
    { // a walk that fails is tried once more at once, then the farm is left out
      let tries = 0;
      const {w, asked, m} = setup({...full, rail: 704}, {walk: (go) => async (r, j, x, ...rest) => { if (x === 10 && tries++ === 0) throw new Error('no progress for 30 s'); return go(r, j, x, ...rest); }});
      await m.restock(w.r, w.job, road);
      assert.deepStrictEqual(asked, [['rail', 256, 10]]);
      assert.strictEqual(tries, 2);
    }
    { // what walking picked up leaves the bags at every stop, or the rails have no room; what it may be worth stays
      const {w, m} = setup({...full, rail: 704, sand: 3, birch_log: 2, egg: 1, wildflowers: 1, diamond: 2});
      await m.restock(w.r, w.job, road);
      const left = (n) => w.inv.find((i) => i.name === n)?.count;
      assert.deepStrictEqual([left('sand'), left('birch_log'), left('egg'), left('wildflowers'), left('diamond')], [0, 0, 0, 0, 2]);
    }
    { // next farm when one is empty
      const {w, asked, m} = setup({...full, rail: 704}, {get: async (item, n, v) => { if (v.bot.entity.position.x < 100) throw new Error('no way to get iron_ingot'); }});
      assert.strictEqual(await m.restock(w.r, w.job, road), 'ok');
      assert.deepStrictEqual(asked, [['rail', 256, 10], ['rail', 256, 500]]);
    }
    { // what one farm had counts: the next is asked for the rest
      const {w, asked, m} = setup({...full, rail: 704}, {get: async (item, n, v) => { const it = v.inv.find((i) => i.name === 'rail'); it.count += 10; throw new Error('out'); }});
      await m.restock(w.r, w.job, road);
      assert.deepStrictEqual(asked, [['rail', 256, 10], ['rail', 246, 500]]);
    }
    { // all empty waits and says so, once
      const {w, m} = setup({...full, rail: 20}, {get: async () => { throw new Error('no way'); }});
      assert.strictEqual(await m.restock(w.r, w.job, road), 'waiting');
      assert.strictEqual(await m.restock(w.r, w.job, road), 'waiting');
      const said = w.log.events.filter(([k]) => k === 'alert').map(([, s]) => s);
      assert.strictEqual(said.length, 1);
      assert.match(said[0], /^highway: east waiting: the farms have no rail/);
    }
    { // a little short is no reason to stay home
      const {w, m} = setup({...full, rail: 800}, {get: async () => { throw new Error('no way'); }});
      assert.strictEqual(await m.restock(w.r, w.job, road), 'ok');
      assert.deepStrictEqual(w.log.events.filter(([k]) => k === 'alert'), []);
    }
    { // a farm's chests are read once a trip, one that will not open is passed over, and one on another floor is left alone
      const read = [];
      const near = () => [{y: 0, n: 'a'}, {y: 3, n: 'b'}, {y: 4, n: 'upstairs'}, {y: -4, n: 'cellar'}];
      const {w, m} = setup({...full, rail: 704, bread: 1}, {near, count: async (r, j, p) => { read.push(p.n); if (p.n === 'a') throw new Error('covered'); }});
      await m.restock(w.r, w.job, road);
      assert.deepStrictEqual(read, ['a', 'b']);
    }
    { // reading a farm has a time limit, and the bot then works with what it has seen
      let t = 0;
      const read = [];
      const near = () => [{y: 0, n: 'a'}, {y: 0, n: 'b'}, {y: 0, n: 'c'}];
      const {w, asked, m} = setup({...full, rail: 704}, {near, now: () => t, count: async (r, j, p) => { read.push(p.n); t += 70000; }});
      await m.restock(w.r, w.job, road);
      assert.deepStrictEqual(read, ['a', 'b']);
      assert.deepStrictEqual(asked, [['rail', 256, 10]]);
    }
    { // a Stop goes through a farm that fails
      const {w, m} = setup({...full, rail: 704}, {get: async (item, n, v) => { w.job.cancelled = true; throw new Error('stopped'); }});
      await assert.rejects(m.restock(w.r, w.job, road), /stopped/);
      assert.strictEqual(w.r.farmChests, null);
    }
    // a first trip carries the origin's ramp too; the second has only its own
    assert.deepStrictEqual([loadFor(undefined).powered_rail, loadFor(100).redstone_torch, loadFor(5000).powered_rail, loadFor(5000).rail], [96, 96, 48, 960]);
    assert.strictEqual(loadFor(5000, 24).iron_ingot, 24, 'iron for armour');
    assert.strictEqual(loadFor(5000).iron_ingot, undefined);
    assert.ok(Object.keys(loadFor(5000))[0] === 'stick', 'sticks first: a farm of iron has none');
    // the list: every farm is outside the box of what is off limits
    for (const f of FARMS) assert.ok(!(f.x >= 112 && f.x <= 272 && f.z >= 368 && f.z <= 592), JSON.stringify(f));
    for (const item of Object.keys(loadFor(1))) assert.ok(FARMS.some((f) => f.items.includes(item)), item);
    assert.ok(FARMS.some((f) => f.items.includes('iron_ingot')));
  }
  // ---- the origin ----
  {
    const plan = originPlan(O), sky = {};
    for (const s of plan.stair.slice(10)) for (const c of s.air) sky[key(c)] = 'air';
    const load2 = {cobbled_deepslate: 64, iron_pickaxe: 2};
    { // a player's block on the stair's way stops the origin and reports it, digs nothing
      const at = plan.stair[5].air[1], w = world({...sky, [key(at)]: 'oak_stairs'}, {items: load2});
      assert.strictEqual(await w.buildOrigin(w.r, w.job, road), 'stopped');
      assert.deepStrictEqual(w.log.dug, []);
      assert.match(w.log.events.find(([k]) => k === 'alert')[1], /^highway: the origin stopped: oak_stairs at 5 4 -5/);
    }
    { // dug from the top down, with the curbs left standing, and then it is done
      const w = world(sky, {items: load2});
      w.r.name = 'bot2';
      assert.strictEqual(await w.buildOrigin(w.r, w.job, road), 'ok');
      for (const c of [...plan.room, ...plan.stair.flatMap((s) => s.air)]) assert.strictEqual(w.name(c), 'air', key(c));
      for (const c of plan.curbs) assert.strictEqual(w.name(c), 'deepslate', key(c));
      const y = w.log.dug.filter((d) => /^deepslate \S+,-5$/.test(d)).map((d) => Number(d.split(' ')[1].split(',')[1]));
      assert.ok(y[0] > y.at(-1), 'down');
      const dug = w.log.dug.length;
      assert.strictEqual(await w.buildOrigin(w.r, w.job, road), 'ok');
      assert.strictEqual(w.log.dug.length, dug, 'built once');
    }
    { // off to the farms the stair is climbed by hand: gravel has come down on it since, and no walk may dig in the box
      const dug = {...sky};
      for (const c of [...plan.room, ...plan.stair.slice(0, 10).flatMap((s) => s.air)]) dug[key(c)] = 'air';
      for (const s of plan.stair.slice(10)) dug[key(s.floor)] = 'air';
      const gravel = plan.stair[5].air[0];
      dug[key(gravel)] = 'gravel';
      const w = world(dug, {items: {rail: 16, iron_pickaxe: 8, bread: 32, minecart: 1, powered_rail: 48, redstone_torch: 48}});
      w.job.args = {dir: 'east', frontier: 300};
      w.bot.entity.position = new Vec3(4.5, 0, 0.5);
      let during;
      const m = makeRoad({...w.deps, farms: [], chestsNear: () => [], countChest: async () => {}, gearWanted: () => 0, tossJunk: async () => {},
        ensureGear: async () => {}, digAt: async (r, j, p, ...rest) => { during = r.mayBuild?.({x: p.x, y: p.y, z: p.z}); return w.deps.digAt(r, j, p, ...rest); }});
      await m.restock(w.r, w.job, road);
      assert.strictEqual(w.name(gravel), 'air');
      assert.strictEqual(during, true, 'the box lets it dig its stair');
      assert.strictEqual(w.r.mayBuild, undefined, 'and only for that');
      assert.deepStrictEqual([Math.floor(w.bot.entity.position.x), Math.floor(w.bot.entity.position.y)], [plan.stair[9].air[0].x, plan.stair[9].air[0].y], 'up to where the floors end');
    }
    { // a stair through a cave: a floor with nothing beside it is held from above, and what held it goes again
      const s = plan.stair[5], f = s.floor, cave = {};
      for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) cave[key({x: f.x + dx, y: f.y + dy, z: f.z + dz})] = 'air';
      const w = world({...sky, ...cave}, {items: load2});
      assert.strictEqual(await w.buildOrigin(w.r, w.job, road), 'ok');
      assert.strictEqual(w.name(f), 'cobbled_deepslate');
      assert.deepStrictEqual(s.air.map(w.name), ['air', 'air', 'air']);
    }
    { // gravel lands a moment after the dig has seen air, and the walk onto the step finds no way: it is dug again, and the walk tried again
      const target = plan.stair[5].air[0];
      let fell = 0, slept = 0;
      const w = world(sky, {items: load2});
      const go = w.deps.goNear;
      const m = makeRoad({...w.deps, sleep: async () => { slept++; }, goNear: async (r, j, x, y, z, ...rest) => {
        if (x === target.x && y === target.y && z === target.z && fell++ === 0) { w.blocks.set(key(target), 'gravel'); throw new Error('could not reach: Took to long to decide path to goal!'); }
        return go(r, j, x, y, z, ...rest);
      }});
      assert.strictEqual(await m.buildOrigin(w.r, w.job, road), 'ok');
      assert.strictEqual(w.name(target), 'air');
      assert.ok(fell >= 2 && slept >= 1, 'walked again after it settled');
    }
    { // a step that stays out of reach still ends the job with the reason
      const target = plan.stair[5].air[0];
      const w = world(sky, {items: load2});
      const go = w.deps.goNear;
      const m = makeRoad({...w.deps, sleep: async () => {}, goNear: async (r, j, x, y, z, ...rest) => {
        if (x === target.x && y === target.y && z === target.z) throw new Error('could not reach: no path');
        return go(r, j, x, y, z, ...rest);
      }});
      await assert.rejects(m.buildOrigin(w.r, w.job, road), /could not reach/);
    }
    { // a curb a cave took away is set again, and gravel that comes down is dug again
      const curb = plan.curbs[0], above = {...plan.stair[1].air[2], y: plan.stair[1].air[2].y + 1};
      const w = world({...sky, [key(curb)]: 'air', [key(above)]: 'gravel'}, {items: load2});
      assert.strictEqual(await w.buildOrigin(w.r, w.job, road), 'ok');
      assert.strictEqual(w.name(curb), 'cobbled_deepslate');
      assert.strictEqual(w.name(plan.stair[1].air[2]), 'air');
    }
    { // a second bot finds it claimed and waits, then finds it built
      const w = world(sky, {items: load2});
      const put = (c) => w.blocks.set(key(c), 'air');
      w.r.world = {claim: async () => false};
      const m = makeRoad({...w.deps, sleep: async () => { plan.room.forEach(put); plan.stair.flatMap((s) => s.air).forEach(put); }});
      assert.strictEqual(await m.buildOrigin(w.r, w.job, road), 'ok');
      assert.deepStrictEqual(w.log.dug, []);
    }
    { // the job opens the protected box for itself and closes it again
      const w = job(start, {}, {at: FIRST_RAIL - 1, args: {length: 6}});
      let during, atFarm;
      const m = makeRoad({...w.deps, ride: fakeRide(w), restock: async (r) => { atFarm = [r.mayBuild, r.digOnly]; return 'ok'; }, buildOrigin: async (r) => { during = r.mayBuild; }});
      await m.highway(w.r, w.job);
      assert.deepStrictEqual([during({x: 2, y: 6, z: 9}), during({x: 2, y: 7, z: 9}), w.r.mayBuild], [true, false, null]);
      assert.deepStrictEqual(atFarm, [null, undefined], 'off to the farms it is any other bot');
    }
  }
  { // home from a ride the bot stands on the first rails, within 2 of the landing: it has to step onto it, or it walks there for ever (sandbox, 2026-11-04)
    const w = job(roadTo(300, start), {}, {at: 6, args: {frontier: 300}});
    let calls = 0, restocked = false;
    const m = makeRoad({...w.deps, ride: fakeRide(w), buildOrigin: async () => {},
      restock: async () => { restocked = true; throw new Error('at the farms'); },
      goNear: async (r, j, x, y, z, dist) => {
        if (++calls > 20) throw new Error('walks for ever');
        const p = w.bot.entity.position;
        if (Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) > dist) { p.x = x + 0.5; p.y = y; p.z = z + 0.5; }
      }});
    await assert.rejects(m.highway(w.r, w.job), /at the farms/);
    assert.ok(restocked);
  }
  { // a dig refused as unsafe ends the road the way a stop does: the owner hears why, and the bot goes home
    const w = job(roadTo(301, start), {}, {at: 301, args: {}});
    const dig = w.deps.digAt;
    const m = makeRoad({...w.deps, ride: fakeRide(w), restock: async () => 'ok', buildOrigin: async () => {}, digAt: async (r, j, p, e, o) => { if (p.x === 305) throw new Error('unsafe: water next to it'); return dig(r, j, p, e, o); }});
    await m.highway(w.r, w.job);
    assert.match(alerts(w)[0], /^highway: east stopped at 304 m: unsafe: water next to it/);
    assert.strictEqual(w.log.rides.length, 1);
  }
  { // a full inventory cannot pick the old ramp up, and gold has no farm: it stays on the road, where it does no harm
    const items = {...load};
    for (let i = 0; i < 30; i++) items[`kept_${i}`] = 1;
    const w = job(roadTo(1002), {items}, {at: 1000, args: {length: 1004}});
    w.r.prefs = {keep: Object.fromEntries(Object.keys(items).map((n) => [n, true]))};
    await w.layRamp(w.r, w.job, road, 1000);
    const dug = w.log.dug.length;
    await w.highway(w.r, w.job);
    assert.strictEqual(w.log.dug.filter((d) => d.startsWith('powered_rail')).length, w.log.dug.slice(0, dug).filter((d) => d.startsWith('powered_rail')).length);
    assert.strictEqual(w.name(cell(road, 996)), 'powered_rail');
  }
  { // what digging gave goes first: a bag full of ore must not leave 48 boosters behind on every trip
    const items = {...load};
    for (const n of ['raw_iron', 'raw_copper', 'raw_gold', 'coal', 'flint', 'redstone', 'lapis_lazuli', 'gravel', 'clay_ball', 'wheat_seeds', 'moss_carpet']) items[n] = 3;
    for (let i = 0; i < 24; i++) items[`keep_${i}`] = 1;
    const w = job(roadTo(1002), {items}, {at: 1000, args: {length: 1004}});
    w.r.prefs = {keep: Object.fromEntries(Array.from({length: 24}, (_, i) => [`keep_${i}`, true]))};
    await w.layRamp(w.r, w.job, road, 1000);
    await w.highway(w.r, w.job);
    assert.notStrictEqual(w.name(cell(road, 996)), 'powered_rail');
    assert.ok(!w.r.bot.inventory.items().some((i) => /^raw_|^coal$|^flint$|^clay_ball$|^wheat_seeds$|^moss_carpet$/.test(i.name)));
    assert.ok(w.r.bot.inventory.items().some((i) => i.name === 'keep_0'));
  }
  { // what digging gives goes at once, so that the load, the cart and the old ramp always find a slot; what it wears, eats or fights with stays
    const w = job(roadTo(20), {items: {...load, clay_ball: 2, iron_helmet: 1, shield: 1, diamond: 1, bread: 3, gold_ingot: 1}}, {at: 19, args: {length: 21}});
    await w.highway(w.r, w.job);
    const bag = w.r.bot.inventory.items().map((i) => i.name);
    assert.ok(!bag.includes('clay_ball'), 'thrown behind it while building');
    for (const n of ['iron_helmet', 'shield', 'diamond', 'bread', 'gold_ingot', 'rail', 'cobbled_deepslate']) assert.ok(bag.includes(n), n);
  }
  { // out of lining at home: a trip for it, or the bot rides out, cannot build and rides back for ever
    let fetched = 0;
    const bare = {...load}; delete bare.cobbled_deepslate;
    const round = [{x: -300, y: 60, z: -160, items: ['cobblestone']}];
    const w0 = job(roadTo(301), {items: {...bare, stick: 128, crafting_table: 1, bread: 32, iron_sword: 1, rail: 960, powered_rail: 48, redstone_torch: 48}}, {at: 301, args: {}});
    const m = makeRoad({...w0.deps, farms: round, chestsNear: () => [], countChest: async () => {}, ensureGear: async () => {}, get: async () => { fetched++; }, buildOrigin: async () => {}, ride: {takeCart: async () => true, rideOn: async () => {}, ride: async () => {}}});
    w0.job.args = {dir: 'east', frontier: 5000};
    w0.bot.entity.position = new Vec3(1000, 70, 1000);
    await m.restock(w0.r, w0.job, road).catch(() => {});
    assert.ok(fetched > 0, 'went to the farm for cobblestone');
  }
  { // no room but for the sticks: they go, the stick farm comes first on the next round, and 48 boosters do not stay behind
    const items = {...load, stick: 128};
    for (let i = 0; i < 26; i++) items[`kept_${i}`] = 1;
    const w = job(roadTo(1002), {items}, {at: 1000, args: {length: 1004}});
    w.r.prefs = {keep: Object.fromEntries(Array.from({length: 26}, (_, i) => [`kept_${i}`, true]))};
    await w.layRamp(w.r, w.job, road, 1000);
    await w.highway(w.r, w.job);
    assert.notStrictEqual(w.name(cell(road, 996)), 'powered_rail');
    assert.ok(!w.r.bot.inventory.items().some((i) => i.name === 'stick'));
  }
  { // a place that fails for a moment does not end a road: the cell is tried again, and the owner never hears of it
    const w = job(roadTo(301), {}, {at: 301, args: {length: 302}});
    const place = w.bot.placeBlock;
    let refused = 3;
    w.bot.placeBlock = async (ref, face) => { if (w.bot.held?.name === 'rail' && refused-- > 0) throw new Error('no answer'); return place(ref, face); };
    await w.highway(w.r, w.job);
    assert.deepStrictEqual(alerts(w), []);
    assert.ok(/rail$/.test(w.name(cell(road, 302))));
    assert.ok(w.log.events.some(([kind, text]) => kind === 'info' && /cannot continue: no rail at 301 0 0/.test(text)), 'and the log says what it was');
  }
  { // a seal that failed for a moment (flowing water, east 831 m) is tried again too
    const w = job(roadTo(301), {}, {at: 301, args: {length: 302}});
    const dig = w.deps.digAt;
    let refused = 1;
    const m = makeRoad({...w.deps, digAt: async (...a) => { if (refused-- > 0) throw new Error('unsafe: water next to it'); return dig(...a); }, restock: async () => 'ok', buildOrigin: async () => {}, ride: {takeCart: async () => true, rideOn: async () => {}, ride: async () => {}}});
    await m.highway(w.r, w.job);
    assert.deepStrictEqual(alerts(w), []);
    assert.ok(/rail$/.test(w.name(cell(road, 301))));
  }
  { // a long walk that stalls on open ground (no progress at -178 -108, sandbox) goes on, it does not end a road
    const w = job(roadTo(301), {}, {at: 301, args: {length: 302}});
    w.bot.entity.position = new Vec3(-500, 70, -500);
    let stalls = 2;
    const m = makeRoad({...w.deps, goNear: async (...a) => { if (stalls-- > 0) throw new Error('could not reach 4 0 0: no progress for 30 s'); return w.deps.goNear(...a); }, restock: async () => 'ok', buildOrigin: async () => {}, ride: fakeRide(w)});
    await m.highway(w.r, w.job);
    assert.ok(/rail$/.test(w.name(cell(road, 301))));
    assert.strictEqual(w.log.events.filter(([, text]) => /walking on/.test(text)).length, 2);
    let always = 0;
    const v = job(roadTo(301), {}, {at: 301, args: {length: 302}});
    v.bot.entity.position = new Vec3(-500, 70, -500);
    const n = makeRoad({...v.deps, goNear: async () => { always++; throw new Error('could not reach 4 0 0: no path'); }, restock: async () => 'ok', buildOrigin: async () => {}, ride: fakeRide(v)});
    await assert.rejects(n.highway(v.r, v.job), /could not reach/, 'one that never gets there still says so');
    assert.strictEqual(always, 3);
  }
  { // a road with an origin of its own brings its load and its start: no farm, no chamber
    let fetched = 0, dug = 0;
    const w = job({'0,0,0': 'air'}, {}, {at: 0});
    const here = {x: 1000, y: 200, z: 1000}, on = {dir: 'east', origin: here};
    w.job.args = {dir: 'east', origin: here, length: 8};
    for (let k = 0; k < FIRST_RAIL; k++) for (const h of [0, 1]) w.blocks.set(key(cell(on, k, h)), 'air');
    w.bot.entity.position = new Vec3(1004.5, 200, 1000.5);
    const m = makeRoad({...w.deps, ride: fakeRide(w), restock: async () => { fetched++; return 'ok'; }, buildOrigin: async () => { dug++; }});
    await m.highway(w.r, w.job);
    assert.deepStrictEqual([fetched, dug], [0, 0]);
    assert.strictEqual(w.name(cell(on, 8, railHeight(8))), 'rail');
  }
  { // the job's arguments
    assert.deepStrictEqual(VALIDATE.highway({dir: 'east'}), {dir: 'east'});
    assert.deepStrictEqual(VALIDATE.highway({dir: 'north', length: 2000, frontier: 40, origin: {x: 1, y: 2, z: 3}}), {dir: 'north', length: 2000, frontier: 40, origin: {x: 1, y: 2, z: 3}});
    assert.throws(() => VALIDATE.highway({dir: 'up'}), /dir must be/);
    assert.throws(() => VALIDATE.highway({}), /dir must be/);
    assert.throws(() => VALIDATE.highway({dir: 'east', length: 0}), /length/);
    assert.throws(() => VALIDATE.highway({dir: 'east', origin: {x: 1}}), /y/);
  }
  { // a Stop goes through
    const w = world(roadTo(20));
    w.job.cancelled = true;
    await assert.rejects(w.buildCell(w.r, w.job, road, 20), /stopped/);
    assert.deepStrictEqual([w.log.dug, w.log.placed], [[], []]);
  }
})();
if (require.main === module) module.exports.then(() => console.log('ok'), (e) => { console.error(e); process.exit(1); });
