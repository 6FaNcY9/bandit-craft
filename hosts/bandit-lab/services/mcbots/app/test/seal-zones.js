'use strict';
const assert = require('node:assert');
const {VALIDATE} = require('../bots');

// seal job: walls over the cave openings in the side faces of a box (fake world)
(async () => {
  const S = require('../seal');
  const {Vec3} = require('vec3');
  const {Cancelled} = require('../bots');
  assert.deepStrictEqual(VALIDATE.seal({x1: -274, z1: -205, x2: -293, z2: -224, y1: 70, y2: -20}), {x1: -293, z1: -224, x2: -274, z2: -205, y1: -20, y2: 70}, 'corners are normalised');
  assert.throws(() => VALIDATE.seal({x1: 0, z1: 0, x2: 24, z2: 5, y1: 0, y2: 10}), /at most 24/);
  assert.throws(() => VALIDATE.seal({x1: 0, z1: 0, x2: 5, z2: 5, y1: -60, y2: 100}), /at most 160 blocks high/);
  assert.throws(() => VALIDATE.seal({x1: 0, z1: 0, x2: 1, z2: 5, y1: 0, y2: 10}), /at least 3/);
  assert.throws(() => VALIDATE.seal({x1: 0, z1: 0, x2: 5, z2: 5, y1: -70, y2: 0}), /y must be/);
  // The box 0..8 x 0..8, y 0..3: solid rock around a hollow, a cave tunnel into its west wall at z 4 (y 0..1),
  // an air cell with rock outside at (0,0,2), water on the east wall, an air cell open to grass at (8,2,6).
  const box = {x1: 0, z1: 0, x2: 8, z2: 8, y1: 0, y2: 3};
  const world = (extra = {}) => {
    const m = new Map(Object.entries({'0,0,4': 'air', '0,1,4': 'air', '-1,0,4': 'air', '-2,0,4': 'air', '-1,1,4': 'air', '0,0,2': 'air', '8,1,2': 'water', '8,2,6': 'cave_air', '9,2,6': 'short_grass', ...extra}));
    for (let x = 1; x <= 7; x++) for (let z = 1; z <= 7; z++) for (let y = 0; y <= 3; y++) m.set(`${x},${y},${z}`, 'air');
    return m;
  };
  const SOFT = /^(air|cave_air|short_grass|torch)$/;
  const blockOf = (m, x, y, z) => {
    if (y < 0 && x >= 0 && x <= 8 && z >= 0 && z <= 8 || y < -1) return {name: 'stone', boundingBox: 'block', position: new Vec3(x, y, z)};
    const n = m.get(`${x},${y},${z}`) ?? 'stone';
    return {name: n, boundingBox: SOFT.test(n) && !/^(air|cave_air)$/.test(n) || /air|water/.test(n) ? 'empty' : 'block', position: new Vec3(x, y, z)};
  };
  const kindAt = (m) => (x, y, z) => S.kindOf(blockOf(m, x, y, z));
  { // scan: only boundary air cells with a non-solid block just outside; fluids left alone; unloaded cells counted
    const m = world();
    const r = S.scan(box, kindAt(m));
    assert.deepStrictEqual(r.walls.map((c) => `${c.x},${c.y},${c.z}`).sort(), ['0,0,4', '0,1,4', '8,2,6']);
    assert.deepStrictEqual([r.fluid, r.unloaded, r.skipped], [1, 0, 0]);
    assert.strictEqual(S.scan(box, kindAt(m), (x, y, z) => z === 4).walls.length, 1, 'skipped cells are not walls');
    assert.strictEqual(S.scan(box, kindAt(m), (x, y, z) => z === 4).skipped, 2);
    const sky = S.scan(box, kindAt(m), () => false, (x, y, z) => z !== 4);
    assert.deepStrictEqual([sky.walls.length, sky.sky], [1, 2], 'openings without a roof are counted, not walled');
    assert.strictEqual(S.scan(box, (x, y, z) => (x === 0 && y === 0 && z === 4 ? null : kindAt(m)(x, y, z))).unloaded, 1);
    assert.strictEqual(S.scan({...box, x1: -9, x2: 17, z1: -9, z2: 17}, kindAt(m)).walls.length, 0, 'no air on the faces of a bigger box except where it meets the hollow');
    // the top and bottom faces are never walled: the shaft stays open
    m.set('4,3,4', 'air'); m.set('4,4,4', 'air');
    assert.strictEqual(S.scan(box, kindAt(m)).walls.length, 3);
    const spot = S.standSpot({x: 0, y: 0, z: 4}, box, kindAt(world()));
    assert.ok(spot && spot.x >= 1 && Math.abs(spot.z - 4) <= 3 && spot.y === 0, 'stands inside, off the wall cell');
    assert.strictEqual(S.standSpot({x: 0, y: 0, z: 4}, box, (x, y, z) => 'solid') , null, 'no room to stand');
    const rf = S.refFace({x: 0, y: 0, z: 4}, kindAt(world()), new Vec3(2, 1.6, 4));
    assert.deepStrictEqual([rf.pos.x + rf.face.x, rf.pos.y + rf.face.y, rf.pos.z + rf.face.z], [0, 0, 4], 'the face points from the held block into the cell');
    assert.strictEqual(S.refFace({x: 0, y: 0, z: 4}, kindAt(world()), new Vec3(40, 1.6, 4)), null, 'out of reach');
  }
  const fake = ({m = world(), items = [['cobblestone', 64]], protectedAreas = [], supplyChest = null, stopAt = null, reach = true} = {}) => {
    const inv = items.map(([name, count]) => ({name, count}));
    const mv = {scafoldingBlocks: [1, 2]};
    const log = {placed: [], dug: 0, withdraw: [], walks: 0};
    const job = {t: {}, cancelled: false, args: box};
    const bot = {game: {dimension: 'overworld'}, entity: {position: new Vec3(4, 0, 4)}, pathfinder: {movements: mv}, inventory: {items: () => inv}, heldItem: null,
      registry: {blocksByName: {torch: {id: 5}, wall_torch: {id: 6}}},
      blockAt: (v) => blockOf(m, v.x, v.y, v.z),
      findBlock: () => [...m].some(([k, n]) => n === 'torch' && k.split(',').every((c, i) => Math.abs(Number(c) - [4, 0, 4][i]) <= 12)) || null,
      dig: async () => { log.dug++; },
      equip: async (it) => { bot.heldItem = it; if (stopAt === 'equip') job.cancelled = true; },
      placeBlock: async (ref, face) => { const t = ref.position.plus(face); log.placed.push(`${bot.heldItem.name}@${t.x},${t.y},${t.z}`); m.set(`${t.x},${t.y},${t.z}`, bot.heldItem.name); }};
    const r = {bot, protectedAreas, supplyChest, name: 'bot11', world: null, emit: (k, t) => log.walks = log.walks};
    const goNear = async (rr, jj, x, y, z, d, opts = {}) => { if (!reach && opts.goal) throw new Error(`could not reach ${x} ${y} ${z}`); if (opts.goal) bot.entity.position = new Vec3(x + 0.5, y, z + 0.5); };
    const guard = (j) => { if (j.cancelled) throw new Cancelled('stopped'); };
    const withdraw = async (rr, jj, item, count) => { log.withdraw.push([item, count]); inv.push({name: item, count}); };
    const seal = S.makeSeal({goNear, guard, sleep: async () => {}, goals: {GoalBlock: class {}}, withdraw, skipMs: 0});
    return {seal, r, job, m, log, mv, inv};
  };
  let f = fake();
  await f.seal(f.r, f.job);
  assert.deepStrictEqual(f.log.placed.filter((p) => p.startsWith('cobblestone')).sort(), ['cobblestone@0,0,4', 'cobblestone@0,1,4', 'cobblestone@8,2,6']);
  assert.strictEqual(f.log.dug, 0, 'nothing is dug');
  assert.deepStrictEqual([f.mv.scafoldingBlocks, f.r.digOnly], [[1, 2], undefined], 'pathfinder settings come back');
  assert.match(f.job.progress, /sealed 3\/3/);
  assert.ok(!f.job.noop);
  const again = {t: {}, cancelled: false, args: box};
  await f.seal(f.r, again);
  assert.strictEqual(again.noop, true, 'a second run has nothing to do');
  f = fake({items: [['cobblestone', 64], ['torch', 4]]});
  await f.seal(f.r, f.job);
  assert.strictEqual(f.log.placed.filter((p) => p.startsWith('torch')).length, 1, 'one torch while none shines within reach');
  const lit = [...f.m].filter(([, n]) => n === 'torch').map(([k]) => k);
  assert.ok(lit.length === 1 && ['1,0,4', '1,1,4', '7,2,6'].includes(lit[0]), `on the inside face of a new wall: ${lit}`);
  f = fake({items: [['dirt', 5]]}); // dirt will do, and a missing material is fetched
  await f.seal(f.r, f.job);
  assert.ok(f.log.placed.every((p) => p.startsWith('dirt')));
  f = fake({items: [['dirt', 1], ['cobbled_deepslate', 9]]});
  await f.seal(f.r, f.job);
  assert.ok(f.log.placed[0].startsWith('cobbled_deepslate'), 'cobblestone, then cobbled deepslate, then dirt');
  f = fake({items: [], supplyChest: {x: 50, y: 0, z: 50}});
  await f.seal(f.r, f.job);
  assert.deepStrictEqual(f.log.withdraw[0], ['stone_bricks', 3], 'fetches what the openings need, bricks first');
  f = fake({items: [['cobblestone', 9], ['stone_bricks', 9]]});
  await f.seal(f.r, f.job);
  assert.ok(f.log.placed.length && f.log.placed.every((p) => p.startsWith('stone_bricks')), 'stone bricks before cobblestone');
  f = fake({items: []});
  await assert.rejects(f.seal(f.r, f.job), /out of wall blocks/);
  assert.deepStrictEqual(f.mv.scafoldingBlocks, [1, 2], 'restored after a failure too');
  f = fake({protectedAreas: [[-5, 3, 20, 5]]}); // z 3..5 protected: the two west walls stay open
  await f.seal(f.r, f.job);
  assert.deepStrictEqual(f.log.placed, ['cobblestone@8,2,6']);
  f = fake({stopAt: 'equip'});
  await assert.rejects(f.seal(f.r, f.job), Cancelled);
  assert.strictEqual(f.log.placed.length, 0, 'a Stop during the equip places nothing');
  f = fake({reach: false}); // unreachable: each cell is tried twice, then the job says what is left
  await assert.rejects(f.seal(f.r, f.job), /0 walls placed, 3 openings left/);
  f = fake({m: world({'0,2,4': 'air', '-1,2,4': 'air'})});
  f.r.supplyChest = {x: 1, y: 2, z: 4}; // the cell beside the chest is never walled
  f.inv.push({name: 'cobblestone', count: 64});
  await f.seal(f.r, f.job);
  assert.ok(!f.log.placed.includes('cobblestone@0,2,4'), 'nothing next to the supply chest');
  f = fake({m: world({'0,2,5': 'red_bed'})}); // a bed in reach of (0,1,4)/(0,2,4)
  await f.seal(f.r, f.job);
  assert.ok(!f.log.placed.some((p) => /@0,1,4$/.test(p)), 'no wall beside a bed');
  console.log('ok');
})();

{ // zones (places with a box), the storage layout and the chest index; all plain objects
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const P = require('../places'), pc = require('../plan-config'), L = require('../storage-layout');
  const {WorldModel} = require('../world');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zones-'));
  const pl = new P.Places(dir);
  // a point place still works; a zone needs a box, is normalised and capped
  assert.strictEqual(pl.set({name: 'Home', kind: 'home', x: 1, y: 64, z: 2}).box, undefined);
  assert.throws(() => pl.set({name: 'Z', kind: 'shaft'}), /needs a box/);
  assert.throws(() => pl.set({name: 'Z', kind: 'shaft', box: {x1: 0, x2: 70, z1: 0, z2: 3, y1: 0, y2: 3}}), /at most 64/);
  const z = pl.set({name: 'Z', kind: 'storage', box: {x1: 5, x2: 1, z1: 9, z2: 7, y1: 60, y2: 58}});
  assert.deepStrictEqual(z.box, {x1: 1, y1: 58, z1: 7, x2: 5, y2: 60, z2: 9});
  assert.deepStrictEqual([z.x, z.y, z.z], [3, 59, 8], 'the point is the centre');
  assert.deepStrictEqual(new P.Places(dir).zone('storage').box, z.box, 'survives a restart');
  // seeding only on a first start; zoneBox reads the zone of a kind, else the fallback (BASE follows it)
  const fresh = new P.Places(fs.mkdtempSync(path.join(os.tmpdir(), 'zones-')));
  fresh.seed(pc.seedZones());
  assert.deepStrictEqual(fresh.list.map((p) => p.kind).sort(), ['base', 'protected', 'shaft', 'storage', 'storage', 'treefarm', 'wheat']);
  const n = fresh.list.length;
  fresh.seed(pc.seedZones());
  assert.strictEqual(fresh.list.length, n, 'seeded once');
  assert.deepStrictEqual(P.protectedBoxes(fresh.list), [[-265, -221, -248, -212, 57, 61]], 'the hall walls are protected, with their height');
  const was = {...pc.BASE.shaft};
  P.use(fresh);
  assert.deepStrictEqual(pc.BASE.shaft, was, 'seeded zones equal the shipped geometry');
  fresh.set({...fresh.zone('shaft'), box: {x1: -300, x2: -290, z1: -10, z2: 0, y1: -59, y2: 80}});
  assert.deepStrictEqual(pc.BASE.shaft, {x1: -300, z1: -10, x2: -290, z2: 0}, 'moving the zone moves the work');
  assert.strictEqual(pc.OBJECTIVES.find((o) => o.id === 'shaft-to-ore').roles[0].jobs[0][1].x1, -300);
  assert.ok(P.inZone('storage', -260, 59, -217) && !P.inZone('storage', -260, 70, -217));
  // jobs take zone: "<name>"
  assert.deepStrictEqual(VALIDATE.treefarm({zone: 'Tree farm'}), {x1: -262, z1: -238, x2: -248, z2: -224});
  assert.deepStrictEqual(VALIDATE.shaft({zone: 'Shaft'}), {x1: -300, z1: -10, x2: -290, z2: 0, top: 80, bottom: -59});
  assert.deepStrictEqual(VALIDATE.excavate({zone: 'Storage room'}), {x1: -272, y1: 58, z1: -219, x2: -266, y2: 60, z2: -213});
  assert.throws(() => VALIDATE.wheatfarm({zone: 'Nope'}), /no zone called Nope/);
  P.use(null);
  assert.deepStrictEqual(pc.BASE.shaft, was, 'no zones: the shipped geometry');
  assert.ok(pc.OBJECTIVES.some((o) => o.id === 'file-storage' && o.needs.includes('storage-room')));
  // layout: 56 distinct double-chest cells in 10 contiguous category runs
  assert.strictEqual(L.SLOTS.length, 56);
  assert.strictEqual(new Set(L.SLOTS.map(L.keyOf)).size, 56);
  assert.strictEqual(L.LAYOUT.reduce((s, [, k]) => s + k, 0), 56);
  assert.ok(L.SLOTS.every((s) => s.x >= -263 && s.x <= -251 && s.stand.z === (s.z <= -217 ? -218 : -215)));
  assert.ok(L.LAYOUT.every(([c, k]) => L.chestsFor(c).length === k));
  assert.deepStrictEqual(['iron_ingot', 'raw_iron', 'oak_log', 'cobblestone', 'bone', 'iron_pickaxe', 'wheat_seeds', 'redstone', 'stone_bricks', 'dandelion', 'sand'].map((i) => L.categoryOf(i)),
    ['ore', 'ore', 'wood', 'stone', 'mobs', 'tools_gear', 'farm_food', 'redstone', 'build', 'misc', 'dirt_sand']);
  assert.strictEqual(L.categoryOf('bread', (n) => n === 'bread'), 'farm_food');
  // the index: persisted, searched; withdraw order = holders (nearest first), the category run, the wall
  let t = 1000;
  const w = new WorldModel({now: () => t});
  w.persistChests(path.join(dir, 'chests.json'));
  w.noteChest('-263,58,-219', {iron_ingot: 5, coal: 2}, 20);
  w.noteChest('-251,59,-214', {iron_ingot: 9}, 0);
  t = 61000;
  const hit = w.findItems('iron');
  assert.strictEqual(hit[0].total, 14);
  assert.deepStrictEqual(hit[0].where.map((x) => [x.x, x.count, x.ageS]), [[-251, 9, 60], [-263, 5, 60]]);
  assert.deepStrictEqual(w.findItems('nothing'), []);
  const order = L.withdrawOrder({item: 'iron_ingot', match: (n) => n === 'iron_ingot', chests: w.chests, wall: pc.BASE.roomChests, exists: () => true, from: {x: -250, y: 58, z: -214}});
  assert.deepStrictEqual(order.slice(0, 2).map(L.keyOf), ['-251,59,-214', '-263,58,-219'], 'holders first, nearest first');
  const miscKeys = L.BY_CAT.misc.map(L.keyOf);
  assert.ok(miscKeys.every((k) => order.map(L.keyOf).includes(k)), 'the misc overflow chests are searched too (R7-5)');
  assert.ok(order.length < 2 + 3 + 4 + pc.BASE.roomChests.length + 1, 'holders, the ore run, misc, the wall: never all 64');
  assert.strictEqual(L.keyOf(L.order('ore', ['iron_ingot'], w.chests)[0]), '-263,58,-219');
  w.noteChest('-263,58,-219', {coal: 2}, 20); // flush path: the debounce timer is unref'd, so write now via a second instance
  const w2 = new WorldModel();
  fs.writeFileSync(path.join(dir, 'chests.json'), JSON.stringify(Object.fromEntries(w.chests)));
  w2.persistChests(path.join(dir, 'chests.json'));
  assert.strictEqual(w2.chests.get('-251,59,-214').items.iron_ingot, 9, 'reloads');
  assert.ok(require('../agentauth').agentEndpoint('GET', '/api/storage/find'));
}
