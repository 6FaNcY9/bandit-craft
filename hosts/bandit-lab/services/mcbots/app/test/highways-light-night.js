'use strict';
const assert = require('node:assert');

(async () => { // tunnel highways: a written .litematic reads back, the tunnel's shape, rock walls (highway.js, 2026-10-18)
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const {writeLitematic} = require('../litematic-write');
  const {parseLitematic} = require('../schematic');
  const {tunnel, schematic, legs} = require('../highway');
  const {matches} = require('../placing');
  // Round trip: 6 states (3 bits, entries spanning two longs), props kept, air returned, structure_void (unset) not.
  const names = ['stone', 'cobblestone', 'oak_planks', 'glass', 'dirt'];
  const blocks = [];
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) blocks.push({x, y: 0, z, name: names[(x + z) % 5], props: {}});
  blocks.push({x: 2, y: 1, z: 2, name: 'cobblestone_stairs', props: {facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false'}});
  blocks.push({x: 1, y: 1, z: 1, name: 'air', props: {}});
  const parsed = await parseLitematic(writeLitematic({name: 't', regions: [{name: 'r', position: {x: 0, y: 0, z: 0}, size: {x: 5, y: 3, z: 5}, blocks}]}));
  assert.strictEqual(parsed.blocks.length, 26);
  for (const b of blocks.filter((c) => c.name !== 'air')) assert.ok(parsed.blocks.some((p) => p.x === b.x && p.y === b.y && p.z === b.z && p.name === b.name && JSON.stringify(p.props) === JSON.stringify(b.props)), `${b.name} at ${b.x},${b.y},${b.z}`);
  assert.deepStrictEqual(parsed.air, [{x: 1, y: 1, z: 1}]);
  // A straight leg east: 3 wide walkway, 3 high, walls, floor and ceiling; a torch every 6 blocks pointing in.
  const at = (r, x, y, z) => r.blocks.find((b) => b.x === x && b.y === y && b.z === z)?.name ?? (r.air.some((a) => a.x === x && a.y === y && a.z === z) ? 'air' : null);
  let t = tunnel([{x: 0, y: 60, z: 0}, {x: 12, y: 60, z: 0}]);
  for (const z of [-1, 0, 1]) for (const y of [60, 61]) assert.strictEqual(at(t, 4, y, z), 'air', `walkway ${y} ${z}`);
  assert.deepStrictEqual([at(t, 4, 59, 0), at(t, 4, 63, 0), at(t, 4, 60, -2), at(t, 4, 62, 2)], ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone']);
  const torches = t.blocks.filter((b) => b.name === 'wall_torch');
  assert.deepStrictEqual(torches.map((b) => [b.x, b.y, b.z, b.props.facing]), [[6, 62, -1, 'south'], [12, 62, 1, 'north']]);
  assert.ok(!t.air.some((a) => a.x === 6 && a.y === 62 && a.z === -1), 'a torch cell is no air to clear');
  // An L: the corner is open both ways (air wins over the walls of either leg).
  t = tunnel([{x: 0, y: 60, z: 0}, {x: 8, y: 60, z: 0}, {x: 8, y: 60, z: 8}]);
  assert.deepStrictEqual([at(t, 9, 60, 0), at(t, 8, 60, 1), at(t, 7, 60, 0), at(t, 10, 60, 4)], ['air', 'air', 'air', 'cobblestone']);
  // Rising 3 over 9 blocks: flat, three steps whose floor is a stair facing uphill, flat; headroom 3 over each step.
  t = tunnel([{x: 0, y: 60, z: 0}, {x: 0, y: 63, z: 9}]);
  const steps = t.blocks.filter((b) => b.name === 'cobblestone_stairs' && b.x === 0);
  assert.deepStrictEqual(steps.map((b) => [b.y, b.z, b.props.facing]), [[60, 4, 'south'], [61, 5, 'south'], [62, 6, 'south']]);
  for (const s of steps) for (const h of [1, 2, 3]) assert.strictEqual(at(t, 0, s.y + h, s.z), 'air', `headroom over the step at z ${s.z}`);
  // Down is the same tunnel walked the other way.
  assert.deepStrictEqual(tunnel([{x: 0, y: 63, z: 9}, {x: 0, y: 60, z: 0}]).blocks.filter((b) => b.name === 'cobblestone_stairs').length, t.blocks.filter((b) => b.name === 'cobblestone_stairs').length);
  assert.throws(() => tunnel([{x: 0, y: 60, z: 0}, {x: 0, y: 70, z: 5}]), /rises no more/);
  assert.throws(() => tunnel([{x: 0, y: 60, z: 0}, {x: 3, y: 60, z: 5}]), /along x or z/);
  // The file the CLI writes builds where it should: its region at 0,0,0, the origin at the lowest corner.
  const s = schematic([{x: 100, y: 60, z: 50}, {x: 110, y: 60, z: 50}]);
  assert.deepStrictEqual(s.origin, {x: 100, y: 59, z: 48});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hw-'));
  fs.writeFileSync(path.join(dir, 'hw.litematic'), s.buffer);
  const plan = await require('../build').schematicPlan(dir, {file: 'hw.litematic', origin: s.origin, anySolid: ['cobblestone']});
  assert.ok(plan.air.has('104,60,50') && plan.air.has('104,62,51') && !plan.air.has('104,63,50'), 'the walkway, not the ceiling, is air to clear');
  assert.ok(plan.byKey.get('104,59,50').anySolid && plan.byKey.get('104,63,50').anySolid, 'floor and ceiling take any rock');
  assert.ok(!plan.byKey.get('106,62,49')?.anySolid, 'a torch is a torch');
  // A file replaced under its name is parsed again: a leg was built from the old copy (sandbox 2026-10-18).
  fs.writeFileSync(path.join(dir, 'hw.litematic'), schematic([{x: 100, y: 60, z: 50}, {x: 104, y: 60, z: 50}]).buffer);
  const again = await require('../build').schematicPlan(dir, {file: 'hw.litematic', origin: s.origin, anySolid: ['cobblestone']});
  assert.ok(again.targets.length < plan.targets.length, 'the new file, not the cached plan');
  // A clean-up schematic is air alone: its site spans that air ("NaN Infinity NaN" before, sandbox 2026-10-19).

  fs.writeFileSync(path.join(dir, 'clean.litematic'), writeLitematic({name: 'clean', regions: [{name: 'c', size: {x: 1, y: 3, z: 2}, position: {x: 0, y: 0, z: 0},
    blocks: [{x: 0, y: 0, z: 0, name: 'air'}, {x: 0, y: 2, z: 1, name: 'air'}]}]}));
  const clean = await require('../build').schematicPlan(dir, {file: 'clean.litematic', origin: {x: -244, y: 60, z: -184}});
  assert.strictEqual(clean.targets.length, 0);
  assert.deepStrictEqual([clean.lo, clean.hi], [{x: -244, y: 60, z: -184}, {x: -244, y: 62, z: -183}]);
  fs.rmSync(dir, {recursive: true, force: true});
  // Rock is as good as a cobblestone wall; gravel and water are not, nor rock where no anySolid was asked.
  assert.strictEqual(matches({name: 'cobblestone', props: {}, anySolid: true}, {name: 'stone', props: {}}), true);
  assert.strictEqual(matches({name: 'cobblestone', props: {}, anySolid: true}, {name: 'deepslate_iron_ore', props: {}}), true);
  assert.strictEqual(matches({name: 'cobblestone', props: {}, anySolid: true}, {name: 'gravel', props: {}}), false);
  assert.strictEqual(matches({name: 'cobblestone', props: {}, anySolid: true}, {name: 'water', props: {}}), false);
  assert.strictEqual(matches({name: 'cobblestone', props: {}}, {name: 'stone', props: {}}), false);
  // Legs cut from one route never wall what another leg walks through: made apart, two legs narrowed their corner to
  // one block (sandbox 2026-10-18).
  const air = new Set(), solid = new Set();
  for (const leg of legs([{x: 0, y: 60, z: 0}, {x: 10, y: 60, z: 0}, {x: 10, y: 60, z: 10}])) {
    const p = await parseLitematic(leg.buffer), k = (c) => `${c.x + leg.origin.x},${c.y + leg.origin.y},${c.z + leg.origin.z}`;
    for (const c of p.air) air.add(k(c));
    for (const c of p.blocks) if (c.name !== 'wall_torch') solid.add(k(c));
  }
  assert.deepStrictEqual([...air].filter((c) => solid.has(c)), [], 'no cell is wall in one leg and walkway in another');
  assert.ok(air.has('8,60,1') && air.has('10,60,2'), 'the corner stays 3 wide');
  console.log('highways: litematic round trip, tunnel shape, rock walls, joined legs ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
// ---- light jobs and keeper lighting ----
(async () => {
{
  const {VALIDATE, lightCandidates, spawnerTorchSpot} = require('../bots');
  const {NOTABLE_BLOCKS, WorldModel} = require('../world');
  assert.deepStrictEqual(VALIDATE.light({x1: 0, y1: 0, z1: 0, x2: 63, y2: 47, z2: 63}), {x1: 0, y1: 0, z1: 0, x2: 63, y2: 47, z2: 63});
  assert.throws(() => VALIDATE.light({x1: 0, y1: 0, z1: 0, x2: 64, y2: 1, z2: 1}), /64 x 64/);
  assert.throws(() => VALIDATE.light({x1: 0, y1: 0, z1: 0, x2: 1, y2: 48, z2: 1}), /48 blocks high/);
  assert.deepStrictEqual(VALIDATE.light({spawner: {x: 1, y: 2, z: 3}}), {spawner: {x: 1, y: 2, z: 3}});
  assert.throws(() => VALIDATE.mine({block: 'spawner'}), /placed block/);
  assert.ok(NOTABLE_BLOCKS.includes('spawner'));
  const blocks = new Map();
  const put = (x, y, z, name, boundingBox = 'empty', light = 0) => blocks.set(`${x},${y},${z}`, {name, boundingBox, light});
  const at = (x, y, z) => blocks.get(`${x},${y},${z}`) || null;
  for (let x = 0; x <= 40; x += 8) {
    put(x, 0, 0, 'grass_block', 'block'); put(x, 1, 0, 'air', 'empty', 0); put(x, 2, 0, 'air');
  }
  put(8, 0, 0, 'farmland', 'block');
  put(16, 1, 0, 'water');
  const picks = lightCandidates({x1: 0, y1: 0, z1: 0, x2: 40, y2: 2, z2: 0}, at, (x) => x === 32, (x) => x === 24);
  assert.deepStrictEqual(picks, [{x: 0, y: 1, z: 0}, {x: 40, y: 1, z: 0}], 'only safe dark grass remains: farmland, water, nearby torch and protected zone are skipped');
  { // a dark flat floor: every spot ends with light >= 8 (a torch shines 14, 1 less per block), with few torches (2026-10-20)
    const floor = new Map(), dim = 25;
    for (let x = 0; x < dim; x++) for (let z = 0; z < dim; z++) { floor.set(`${x},0,${z}`, {name: 'stone', boundingBox: 'block'}); floor.set(`${x},1,${z}`, {name: 'air', boundingBox: 'empty', light: 0}); floor.set(`${x},2,${z}`, {name: 'air', boundingBox: 'empty', light: 0}); }
    const spots = lightCandidates({x1: 0, y1: 0, z1: 0, x2: dim - 1, y2: 2, z2: dim - 1}, (x, y, z) => floor.get(`${x},${y},${z}`) || null);
    let worst = 0;
    for (let x = 0; x < dim; x++) for (let z = 0; z < dim; z++) worst = Math.max(worst, Math.min(...spots.map((p) => Math.abs(p.x - x) + Math.abs(p.z - z))));
    assert.ok(worst <= 6, `a spot ${worst} from the nearest torch is lit ${14 - worst} only`);
    assert.ok(spots.length <= 15, `${spots.length} torches for a ${dim} x ${dim} floor`);
    const lit = lightCandidates({x1: 0, y1: 0, z1: 0, x2: dim - 1, y2: 2, z2: dim - 1}, (x, y, z) => { const b = floor.get(`${x},${y},${z}`); return b && y === 1 ? {...b, light: 9} : b || null; });
    assert.deepStrictEqual(lit, [], 'a floor already at 9 needs nothing');
  }
  assert.deepStrictEqual(spawnerTorchSpot({x: 0, y: 1, z: 0}, (x, y, z) => at(x, y, z)), {spot: {x: 0, y: 2, z: 0}, face: new (require('vec3').Vec3)(0, 1, 0)});
  put(0, 2, 0, 'stone', 'block'); put(1, 1, 0, 'air');
  assert.deepStrictEqual(spawnerTorchSpot({x: 0, y: 1, z: 0}, at).spot, {x: 1, y: 1, z: 0}, 'blocked top selects an open side');
}

{
  const {Keeper, IDLE_MS} = require('../keeper');
  const {WorldModel} = require('../world');
  let now = 1000000;
  const world = new WorldModel({now: () => now});
  world.noteStock('bot1', {oak_log: 1});
  world.noteBlock('bot1', 'spawner', {x: 5, y: 20, z: 5}, 'overworld');
  const zone = {name: 'Base', kind: 'base', dim: 'overworld', box: {x1: 0, y1: 60, z1: 0, x2: 8, y2: 64, z2: 8}};
  const runner = {name: 'bot1', sent: [], idle: true, fit: true, snapshot() { return {online: true, dead: false, job: this.idle ? null : {label: 'lighting'}, queue: [], isDay: true, fit: this.fit}; }, enqueue(type, args) { this.sent.push([type, args]); this.idle = false; }};
  const keeper = new Keeper({runners: new Map([[runner.name, runner]]), world, chest: {x: 1, y: 2, z: 3}, quotas: [], places: () => ({list: [zone]}), now: () => now});
  keeper.setEnabled(true); keeper.tick(); now += IDLE_MS; keeper.tick();
  assert.deepStrictEqual(runner.sent[0], ['light', {...zone.box, zone: 'Base'}], 'daylight idle bot receives zone lighting');
  keeper.tick(); // observe that the bot started its job
  runner.idle = true; keeper.tick(); // finish the zone job
  runner.fit = false;
  runner.sent.length = 0;
  keeper.tick();
  assert.strictEqual(runner.sent.some(([type, args]) => type === 'light' && args.spawner), false, 'unfit bot does not receive a spawner job');
  now += 30 * 60 * 1000; keeper.tick();
  // The chest numbers are old by now: the bot counts the chest first, with no light job on top.
  assert.deepStrictEqual(runner.sent.map(([type]) => type), ['stock'], 'one job at a time');
  world.noteStock('bot1', {oak_log: 1}); runner.idle = true; keeper.tick(); now += IDLE_MS; keeper.tick();
  assert.strictEqual(runner.sent.some(([type, args]) => type === 'light' && args.zone === 'Base'), true, 'zone is scheduled again after 30 minutes');
  keeper.tick();
  runner.idle = true; keeper.tick();
  runner.fit = true; runner.idle = true; keeper.places = () => ({list: []}); keeper.tick();
  // Seen again lately (world blocks live 10 min) and idle long enough.
  now += IDLE_MS; world.noteBlock('bot1', 'spawner', {x: 5, y: 20, z: 5}, 'overworld'); keeper.tick();
  assert.strictEqual(runner.sent.some(([type, args]) => type === 'light' && args.spawner), true, 'known spawner goes to a fit bot');
}
})().catch((e) => { console.error(e); process.exitCode = 1; });

(async () => { // night fixes 2026-10-19: the gear fetches iron from far storage
  { // withdraw far: indexed chests near the supply chest, nearest first; Nether-far and dead ones never end the withdraw
    const {JOBS} = require('../bots');
    const {Vec3} = require('vec3');
    const {WorldModel} = require('../world');
    const pc = require('../plan-config'), L = require('../storage-layout');
    const world = new WorldModel();
    world.noteChest('-354,66,-165', {iron_ingot: 7}, 0);
    world.noteChest('-354,66,-163', {iron_ingot: 5}, 0);
    world.noteChest('-354,66,-100', {iron_ingot: 4}, 0); // its chest is gone
    world.noteChest('-800,66,-165', {iron_ingot: 99}, 0); // out of the 200 range
    const it = (name, count) => ({name, count, type: 7, metadata: null});
    const held = {[L.keyOf(pc.BASE.chest)]: [], '-354,66,-165': [it('iron_ingot', 7)], '-354,66,-163': [it('iron_ingot', 5)]};
    const walks = [];
    const bot = {
      entity: {position: new Vec3(-271, 66, -214), onGround: true}, game: {dimension: 'overworld'}, entities: {}, inventory: {items: () => []},
      blockAt: (p) => (held[L.keyOf(p)] ? {name: 'chest', position: p, boundingBox: 'block', getProperties: () => ({})} : p.x === -354 && p.z === -100 ? {name: 'air', position: p} : null),
      pathfinder: {searchRadius: -1, stop() {}, setGoal() {}, goto: async (g) => { walks.push(`${g.x},${g.z}`); }},
      openContainer: async (b) => { const items = held[L.keyOf(b.position)]; return {containerItems: () => items, close() {}, withdraw: async (_t, _m, n) => { items[0].count -= n; if (!items[0].count) items.shift(); }}; },
    };
    const r = {bot, world, sheltered: true, emit() {}, protectedAreas: []};
    const job = (count, far) => ({type: 'withdraw', t: {}, cancelled: false, args: {...pc.BASE.chest, item: 'iron_ingot', count, ...(far ? {far} : {})}});
    await assert.rejects(JOBS.withdraw(r, job(3, false)), /no iron_ingot/, 'without far the farm chests are not looked at');
    assert.deepStrictEqual(walks.filter((w) => w.startsWith('-354')), []);
    await JOBS.withdraw(r, job(11, true));
    assert.deepStrictEqual([held['-354,66,-163'], held['-354,66,-165']].map((l) => l.map((i) => i.count)), [[1], []], 'nearest first (-165 is nearer the bot), 11 taken');
    assert.ok(!walks.some((w) => w.startsWith('-800')), 'beyond 200 blocks of the supply chest: not visited');
    await JOBS.withdraw(r, job(5, true)); // 1 left in the nearest; the gone chest after it is skipped, not fatal
    assert.ok(r.unreachableChests.has('-354,66,-100'), 'the dead chest is passed over for 30 min');
    // at night only a fit bot goes that far (review 2026-10-19: no walk into the dark to the iron farm unarmed)
    held['-354,66,-163'] = [it('iron_ingot', 4)];
    world.noteChest('-354,66,-163', {iron_ingot: 4}, 0);
    walks.length = 0;
    bot.time = {timeOfDay: 18000};
    r.combat = {busy: false, fit: () => false};
    await assert.rejects(JOBS.withdraw(r, job(3, true)), /no iron_ingot/);
    assert.deepStrictEqual(walks.filter((w) => w.startsWith('-354')), [], 'unfit at night: the far chests wait for the day');
    r.combat.fit = () => true;
    await JOBS.withdraw(r, job(3, true));
    assert.deepStrictEqual(held['-354,66,-163'].map((i) => i.count), [1], 'fit at night: it goes');
  }
  // a light block counts as empty for every build (it cannot be dug in survival; plaza sandbox build 2026-10-19)
  assert.ok(require('../build').REPLACEABLE.has('light'));
  { // waitSafe: an enderman by the target does not hold the walk (bot1 in a cave, main server 2026-10-19)
    const {waitSafe} = require('../bots');
    const {WorldModel} = require('../world');
    const world = new WorldModel();
    world.noteMob('bot2', {id: 1, name: 'enderman', position: {x: 2, y: 64, z: 0}}, 'overworld');
    const r = {bot: {game: {dimension: 'overworld'}, time: {timeOfDay: 1000}, entity: {}}, combat: {busy: false, fit: () => false}, world, emit() {}};
    const t0 = Date.now();
    await waitSafe(r, {t: {}, cancelled: false, type: 'goto'}, 0, 0, 64);
    assert.ok(Date.now() - t0 < 500, 'no wait for an enderman');
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });

(async () => { // night fixes 2026-10-19: the keeper remembers on/off
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  { // keeper: on/off survives a restart; a bad or missing file is off
    const {Keeper} = require('../keeper');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-')), file = path.join(dir, 'keeper.json');
    const mk = (extra = {}) => new Keeper({runners: new Map(), world: new (require('../world').WorldModel)(), chest: {x: 1, y: 2, z: 3}, quotas: [], file, ...extra});
    assert.strictEqual(mk().enabled, false, 'no file: off');
    mk().setEnabled(true);
    assert.strictEqual(mk().enabled, true, 'on stays on after a restart');
    mk().setEnabled(true); // already on: no change
    const k = mk(); k.setEnabled(false);
    assert.strictEqual(mk().enabled, false);
    fs.writeFileSync(file, '{nope');
    assert.strictEqual(mk().enabled, false, 'bad file: off');
    fs.writeFileSync(file, JSON.stringify({enabled: true}));
    assert.strictEqual(mk({chest: null}).enabled, false, 'no supply chest: nothing to keep, off');
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
(async () => { // humanlook: bounded turn rate outside a fight, instant in one (2026-10-20)
  const H = require('../humanlook');
  const fake = (yaw0) => {
    const bot = {entity: {yaw: yaw0}, calls: [], waitForTicks: async () => {}};
    bot.look = async (yaw, pitch) => { bot.calls.push(yaw); bot.entity.yaw = yaw; };
    return bot;
  };
  const maxDelta = (bot, from) => bot.calls.reduce((m, y, i) => Math.max(m, Math.abs(Math.atan2(Math.sin(y - (i ? bot.calls[i - 1] : from)), Math.cos(y - (i ? bot.calls[i - 1] : from))))), 0);
  let b = fake(0);
  H.install(b);
  await b.look(Math.PI, 0);
  assert.ok(maxDelta(b, 0) <= H.MAX_STEP + 1e-9, 'a 180 degree turn goes in steps of at most 40 degrees');
  assert.ok(b.calls.length >= 5 && b.calls.at(-1) === Math.PI, 'and ends exactly on the target');
  b = fake(3);
  H.install(b);
  await b.look(-3, 0);
  assert.ok(b.calls.length === 1 && b.calls[0] === -3, 'across the +-pi seam the short way (0.28 rad) is one step');
  b = fake(0);
  H.install(b, {fighting: () => true});
  await b.look(Math.PI, 0);
  assert.deepStrictEqual(b.calls, [Math.PI], 'in a fight the turn is instant');
  b = fake(0);
  H.install(b);
  const first = b.look(Math.PI, 0);
  await b.look(0.1, 0);
  await first;
  assert.ok(Math.abs(b.entity.yaw - 0.1) < 1e-9, 'the latest look wins');
  const smp = new H.Sampler(() => 5);
  smp.tick(0, false); smp.tick(Math.PI / 2, false); smp.tick(Math.PI / 2 + 0.1, true); smp.tick(-Math.PI + 0.1, false);
  assert.deepStrictEqual(smp.flush(), {t: 5, out: 90, fight: 5.7}, 'sampler keeps the largest turn per tick, fights apart; seam handled');
})().catch((e) => { console.error(e); process.exitCode = 1; });

{ // nearestOutside: the get plan must not use mineflayer's per-position scan (useExtraInfo), which stalled the event loop ~40 s
  const {nearestOutside} = require('../bots');
  const {Vec3} = require('vec3');
  let asked;
  const bot = {entity: {position: new Vec3(0, 64, 0)}, findBlocks: (o) => { asked = o; return [new Vec3(3, 64, 0), new Vec3(10, 64, 0)]; }};
  assert.strictEqual(nearestOutside(bot, 5, [[0, -5, 5, 5]]), 10, 'the nearest find inside a protected area is skipped');
  assert.strictEqual(asked.useExtraInfo, undefined, 'no useExtraInfo: the palette scan stays fast');
  assert.strictEqual(nearestOutside(bot, 5, [[0, -5, 20, 5]]), null, 'every find protected: none');
  assert.strictEqual(nearestOutside(bot, 5, []), 3);
  assert.strictEqual(nearestOutside(bot, 5, [], new Set([4])), null, 'a type no section holds: no scan at all');
  asked = null; assert.strictEqual(nearestOutside(bot, 5, [], new Set([5])), 3); assert.ok(asked, 'a type that is present is searched');
  const world = {getColumn: (x, z) => (x === 0 && z === 0 ? {sections: [null, {palette: [10, 11]}, {palette: [12]}]} : null)};
  const reg = {blocksByStateId: {10: {id: 1}, 11: {id: 2}, 12: {id: 1}}};
  const b2 = {entity: {position: new Vec3(0, 64, 0)}, world, registry: reg};
  assert.deepStrictEqual([...require('../bots').presentTypes(b2)].sort(), [1, 2], 'block types from the section palettes');
  { // makeBlockNear: a plan's scans stay inside the budget, finds are remembered
    let t = 0, scans = 0;
    const r = {bot: {entity: {position: new Vec3(0, 64, 0)}, registry: {blocksByName: {a: {id: 1}, b: {id: 2}, c: {id: 3}}}, world: {getColumn: () => ({sections: [{}]})}, findBlocks: () => { scans++; t += 200; return [new Vec3(4, 64, 0)]; }}, protectedAreas: []};
    const near = require('../bots').makeBlockNear(r, {now: () => t, budgetMs: 300});
    assert.deepStrictEqual([near('a'), near('b'), near('c')], [4, 4, null], 'the third name finds the budget spent');
    assert.strictEqual(scans, 2);
    assert.strictEqual(near('a'), 4); assert.strictEqual(scans, 2, 'a find is remembered');
    const next = require('../bots').makeBlockNear(r, {now: () => t, budgetMs: 300});
    assert.strictEqual(next('c'), 4, 'the next plan gets a new budget');
  }
  world.getColumn = () => ({sections: [{}]});
  assert.strictEqual(require('../bots').presentTypes(b2), null, 'a section without a palette: nothing can be ruled out');
}
