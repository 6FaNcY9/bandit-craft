'use strict';
// The road job (roadjob.js), against a fake world of deepslate: nothing here needs a server.
const assert = require('node:assert');
const {Vec3} = require('vec3');
const {makeRoad} = require('../roadjob');
const {crossSection, checkCell, cell, niche, isBoosterSlot, FIRST_RAIL, RAMP_CELLS} = require('../road');

const road = {dir: 'east', origin: {x: 0, y: 0, z: 0}};
const EMPTY = /^(air|cave_air|water|lava|rail|powered_rail|redstone_torch|short_grass|cobweb)$/;
const key = ({x, y, z}) => `${x},${y},${z}`;
const isDipCell = (k) => k % 16 === 8 || k % 16 === 9;

// put: blocks by "x,y,z". back: cells a fluid flows back into after each placing. Digging deepslate drops the cobbled kind.
function world(put = {}, {items = {rail: 64, cobbled_deepslate: 64, iron_pickaxe: 1}, back = []} = {}) {
  const blocks = new Map(Object.entries(put));
  const name = (c) => (blocks.has(key(c)) ? blocks.get(key(c)) : 'deepslate');
  const inv = Object.entries(items).map(([n, count]) => ({name: n, count}));
  const log = {placed: [], dug: [], tossed: []};
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
  };
  const deps = {
    guard: (job) => { if (job.cancelled) throw new Error('stopped'); },
    sleep: async () => {},
    waitCalm: async () => {},
    goNear: async (r, job, x, y, z) => { bot.entity.position = new Vec3(x + 0.5, y, z + 0.5); },
    digAt: async (r, job, pos) => {
      const n = name(pos);
      log.dug.push(`${n} ${key(pos)}`);
      blocks.set(key(pos), 'air');
      const up = {x: pos.x, y: pos.y + 1, z: pos.z};
      if (name(up) === 'gravel') { blocks.set(key(pos), 'gravel'); blocks.set(key(up), 'air'); for (let c = up, a; name(a = {...c, y: c.y + 1}) === 'gravel'; c = a) { blocks.set(key(c), 'gravel'); blocks.set(key(a), 'air'); } }
      if (n === 'deepslate') add('cobbled_deepslate');
      if (/rail$|torch$/.test(n)) add(n);
      return true;
    },
  };
  return {r: {bot}, bot, job: {t: {}, args: {}}, log, blocks, name, inv, ...makeRoad(deps), read: (x, y, z) => { const n = name({x, y, z}); return {name: n, boundingBox: EMPTY.test(n) ? 'empty' : 'block'}; }};
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
    assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {stop: 'cannot continue'});
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
    assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {stop: 'cannot continue'});
    assert.strictEqual(w.log.placed.filter((p) => p.endsWith('20,1,1')).length, 3, 'three tries');
    assert.strictEqual(w.log.dug.length, 0, 'the road stays shut');
  }
  { // gravel in the roof with more above it: dug until rock holds, then lined
    const w = world(roadTo(20, {'20,2,0': 'gravel', '20,3,0': 'gravel', '20,4,0': 'gravel'}));
    assert.strictEqual(await w.buildCell(w.r, w.job, road, 20), 'ok');
    assert.deepStrictEqual(checkCell(w.read, road, 20), []);
    assert.strictEqual(w.log.dug.filter((d) => d.startsWith('gravel')).length, 3);
  }
  { // gravel without end is not a loop without end
    const w = world(roadTo(20, box(20, 20, 2, 60, 0, 0, 'gravel')));
    assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {stop: 'cannot continue'});
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
    assert.deepStrictEqual(await w.buildCell(w.r, w.job, road, 20), {stop: 'cannot continue'});
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
  { // a Stop goes through
    const w = world(roadTo(20));
    w.job.cancelled = true;
    await assert.rejects(w.buildCell(w.r, w.job, road, 20), /stopped/);
    assert.deepStrictEqual([w.log.dug, w.log.placed], [[], []]);
  }
})();
if (require.main === module) module.exports.then(() => console.log('ok'), (e) => { console.error(e); process.exit(1); });
