'use strict';
const APP = require('node:path').join(__dirname, '..');
const assert = require('node:assert');

(async () => { // goLeg: "No path" at the usual budget looks further (250, then 600) and puts the budget back (2026-10-20)
  const {goNear} = require('../bots');
  const {Vec3} = require('vec3');
  const tried = [];
  const pf = {searchRadius: 80, stop() {}, setGoal() {}, goto: async () => { tried.push(pf.searchRadius); if (pf.searchRadius < 600) throw new Error('No path to the goal!'); }};
  const bot = {entity: {position: new Vec3(0, 64, 0)}, time: {timeOfDay: 1000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
    blockAt: () => ({name: 'air', boundingBox: 'empty'}), pathfinder: pf};
  await goNear({bot, world: {hostilesNear: () => []}, combat: {fit: () => false}, emit() {}, protectedAreas: []}, {type: 'goto', t: {}, cancelled: false}, 3, 64, 3, 2);
  assert.deepStrictEqual([tried, pf.searchRadius], [[80, 250, 600], 80]);
})();

(async () => { // goLeg: "No path" carries the node nearest the goal: walk there (twice at most), then plan again (2026-10-20)
  const {goNear} = require('../bots');
  const {Vec3} = require('vec3');
  const run = async (gain, finish) => {
    const hops = [], pos = new Vec3(0, 64, 0), calls = {n: 0};
    const pf = {searchRadius: 600, stop() {}, setGoal() {}, goto: async (goal) => {
      if (goal.constructor.name === 'GoalBlock') { hops.push(goal.x); pos.x = goal.x; return; }
      if (finish(++calls.n)) return;
      throw Object.assign(new Error('No path to the goal!'), {best: {x: pos.x + gain, y: 64, z: 0}});
    }};
    const bot = {entity: {position: pos}, time: {timeOfDay: 1000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
      blockAt: () => ({name: 'air', boundingBox: 'empty'}), pathfinder: pf};
    const out = await goNear({bot, world: {hostilesNear: () => []}, combat: {fit: () => false}, emit() {}, protectedAreas: []}, {type: 'goto', t: {}, cancelled: false}, 60, 64, 0, 2).then(() => 'ok', (e) => e.message);
    return [out, hops];
  };
  assert.deepStrictEqual(await run(10, (n) => n === 3), ['ok', [10, 20]], 'two partial hops, then the real goal is reached');
  const [out2, hops2] = await run(2, () => false);
  assert.match(out2, /could not reach/);
  assert.deepStrictEqual(hops2, [], 'a hop of 2 blocks is no progress');
  const [out3, hops3] = await run(10, () => false);
  assert.match(out3, /could not reach/);
  assert.strictEqual(hops3.length, 2, 'two hops at most');
})();

{ // a walk with no path is remembered per start chunk and goal chunk for 10 min (2026-10-20)
  const {noPathAge, chunkKey} = require('../bots');
  const {Vec3} = require('vec3');
  const k = chunkKey(40, 64, 5, new Vec3(1, 64, 1));
  assert.notStrictEqual(k, chunkKey(41, 64, 5, new Vec3(1, 64, 1)));
  const m = new Map([[k, 1000]]);
  assert.strictEqual(noPathAge(m, k, 6000), 5000);
  assert.strictEqual(noPathAge(m, k, 1000 + 600000), null);
  assert.strictEqual(noPathAge(undefined, k), null);
}
(async () => { // goLeg: the second identical failing walk fails at once without searching; arrival clears it (2026-10-20)
  const {goNear} = require('../bots');
  const {Vec3} = require('vec3');
  let calls = 0, ok = false;
  const pf = {searchRadius: 600, stop() {}, setGoal() {}, goto: async () => { calls++; if (!ok) throw new Error('No path to the goal!'); }};
  const bot = {entity: {position: new Vec3(0, 64, 0)}, time: {timeOfDay: 1000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
    blockAt: () => ({name: 'air', boundingBox: 'empty'}), pathfinder: pf};
  const r = {bot, world: {hostilesNear: () => []}, combat: {fit: () => false}, emit() {}, protectedAreas: []};
  const go = () => goNear(r, {type: 'goto', t: {}, cancelled: false}, 3, 64, 3, 2).then(() => 'ok', (e) => e.message);
  assert.match(await go(), /could not reach 3 64 3: No path/);
  const n = calls;
  assert.match(await go(), /no path \(cached, \d+ s ago\)/);
  assert.strictEqual(calls, n, 'the cached failure did not search');
  ok = true;
  r.noPath.clear(); // arrival at the goal drops the entry
  assert.strictEqual(await go(), 'ok');
  assert.strictEqual(r.noPath.size, 0);
  const stopped = {type: 'goto', t: {}, cancelled: false};
  ok = false;
  pf.goto = async () => { stopped.cancelled = true; throw new Error('The goal was changed'); };
  await goNear(r, stopped, 3, 64, 3, 2).catch(() => {});
  assert.strictEqual(r.noPath.size, 0, 'a stop is no failed walk');
})();

(async () => { // walled in by its own fill: after the widest search one try without the dig box, which comes back (2026-10-20)
  const {goNear} = require('../bots');
  const {Vec3} = require('vec3');
  const box = {x1: 0, x2: 9, z1: 0, z2: 9}, seen = [], said = [];
  const r = {emit: (k, x) => said.push(x), world: {hostilesNear: () => []}, combat: {fit: () => false}, protectedAreas: [], digBox: box};
  const pf = {searchRadius: 80, stop() {}, setGoal() {}, goto: async () => { seen.push(r.digBox ? pf.searchRadius : 'free'); if (r.digBox) throw new Error('No path to the goal!'); }};
  r.bot = {entity: {position: new Vec3(0, 64, 0)}, time: {timeOfDay: 1000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
    blockAt: () => ({name: 'air', boundingBox: 'empty'}), pathfinder: pf};
  await goNear(r, {type: 'schematic', t: {}, cancelled: false}, 3, 64, 3, 2);
  assert.deepStrictEqual([seen, r.digBox, pf.searchRadius], [[80, 250, 600, 'free'], box, 80]);
  assert.match(said[0], /digging out once/);
})();

{ // goLeg: the walk deadline runs while the pathfinder walks, not during a night's wait: a night used it up, and bot1
  // swam against a cave wall for an hour with no deadline (main server 2026-10-18). Mock timers stop every clock in the
  // process, so this runs in a child process of its own.
  const night = async () => {
    const assert = require('node:assert/strict');
    const {mock} = require('node:test');
    const {goNear} = require('./bots');
    const {Vec3} = require('vec3');
    mock.timers.enable({apis: ['setTimeout']});
    const flush = () => new Promise((res) => setImmediate(res));
    let pending = null, walks = 0, outcome = null;
    const bot = {entity: {position: new Vec3(0, 64, 0)}, time: {timeOfDay: 18000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
      blockAt: () => ({name: 'air', boundingBox: 'empty'}),
      pathfinder: {searchRadius: -1, stop() {}, setGoal: (g) => { if (g === null && pending) pending(new Error('The goal was changed')); },
        goto: () => new Promise((_res, rej) => { walks++; pending = rej; })}};
    const r = {bot, world: {hostilesNear: () => []}, combat: {fit: () => false}, emit() {}, protectedAreas: []};
    goNear(r, {type: 'grave', t: {}, cancelled: false}, 3, 64, 3, 2).then(() => { outcome = 'arrived'; }, (e) => { outcome = e.message; });
    for (let s = 0; s < 120; s += 5) { mock.timers.tick(5000); await flush(); } // two minutes of night
    assert.strictEqual(walks, 0, 'no walk at night');
    bot.time.timeOfDay = 1000;
    mock.timers.tick(5000); await flush(); await flush();
    assert.strictEqual(walks, 1, 'the walk starts in the morning');
    mock.timers.tick(90000); await flush(); await flush(); await flush();
    assert.match(String(outcome), /no way there within 90 s/, 'the deadline still bounds the walk after the night');
    // A bot that does not move is given up after 30 s, one that keeps moving only at the 90 s deadline (2026-10-20).
    outcome = null; r.noPath = null; // each phase is a fresh walk, not the cached failure
    goNear(r, {type: 'grave', t: {}, cancelled: false}, 3, 64, 3, 2).then(() => { outcome = 'arrived'; }, (e) => { outcome = e.message; });
    await flush();
    for (let s = 0; s < 30; s += 5) { mock.timers.tick(5000); await flush(); }
    await flush(); await flush();
    assert.match(String(outcome), /no progress for 30 s/, 'a standing bot is given up early');
    outcome = null; r.noPath = null; // each phase is a fresh walk, not the cached failure
    goNear(r, {type: 'grave', t: {}, cancelled: false}, 3, 64, 3, 2).then(() => { outcome = 'arrived'; }, (e) => { outcome = e.message; });
    await flush();
    for (let s = 0; s < 85; s += 5) { bot.entity.position = new Vec3(s, 64, 0); mock.timers.tick(5000); await flush(); }
    assert.strictEqual(outcome, null, 'a walking bot is not stalled');
    mock.timers.tick(5000); await flush(); await flush(); await flush();
    assert.match(String(outcome), /no way there within 90 s/);
    // The deadline firing during a fight leaves combat's goal alone (retreat, air): halt's setGoal(null) killed it (audit bots-2-4).
    outcome = null; r.noPath = null;
    let cleared = 0;
    const setGoal = bot.pathfinder.setGoal;
    bot.pathfinder.setGoal = (g) => { if (g === null) cleared++; setGoal(g); };
    goNear(r, {type: 'grave', t: {}, cancelled: false}, 3, 64, 3, 2).then(() => { outcome = 'arrived'; }, (e) => { outcome = e.message; });
    await flush();
    r.combat.busy = true; pending(new Error('The goal was changed')); // combat takes the pathfinder
    await flush();
    for (let s = 0; s < 95; s += 5) { mock.timers.tick(5000); await flush(); }
    assert.strictEqual(cleared, 0, 'no setGoal(null) while combat has the pathfinder');
    r.combat.busy = false;
    mock.timers.tick(1000); await flush(); await flush(); await flush();
    assert.match(String(outcome), /no way there within 90 s/, 'the walk still ends at its deadline after the fight');
    console.log('goLeg: deadline after a night wait ok');
  };
  // execFile, not execFileSync: a blocked event loop failed the combat timing test next door (lastFight < 1 s).
  require('node:child_process').execFile(process.execPath, ['-e', `(${night})().catch((e) => { console.error(e); process.exit(1); })`], {cwd: APP, encoding: 'utf8'}, (e, out, err) => {
    if (e || !/deadline after a night wait ok/.test(out)) { console.error(err || e); process.exitCode = 1; return; }
    process.stdout.write(out);
  });
}

(async () => { // doors: a closed wooden door is clicked open, an open door or gate and a closed door's upper half are walked through, iron stays shut (2026-11-01)
  const {safeMovements} = require('../bots');
  const {Vec3} = require('vec3');
  const EventEmitter = require('node:events');
  const registry = require('minecraft-data')('26.1');
  const blocks = new Map(); // "x,y,z" -> block
  const bot = Object.assign(new EventEmitter(), {registry, entity: {position: new Vec3(0, 64, 0)}, pathfinder: {}, blockAt: (p) => blocks.get(`${p.x},${p.y},${p.z}`) || null});
  const put = (x, y, z, name, props) => blocks.set(`${x},${y},${z}`, {type: registry.blocksByName[name].id, name, position: new Vec3(x, y, z), boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 0.19]], getProperties: () => props});
  put(1, 64, 0, 'oak_door', {open: false, half: 'lower'});
  put(1, 65, 0, 'oak_door', {open: false, half: 'upper'});
  put(2, 64, 0, 'oak_door', {open: true, half: 'lower'});
  put(3, 64, 0, 'iron_door', {open: false, half: 'lower'});
  put(4, 64, 0, 'oak_fence_gate', {open: true});
  put(5, 64, 0, 'oak_fence_gate', {open: false});
  const mv = safeMovements(bot, [], null);
  const at = (x, y) => { const b = mv.getBlock(new Vec3(x, y, 0), 0, 0, 0); return [b.openable, b.safe]; };
  assert.strictEqual(mv.canOpenDoors, true);
  assert.deepStrictEqual(at(1, 64), [true, false], 'closed lower half: click it');
  assert.deepStrictEqual(at(1, 65), [false, true], 'closed upper half: the click below opens it');
  assert.deepStrictEqual(at(2, 64), [false, true], 'open door: walk through, never click it shut');
  assert.deepStrictEqual(at(3, 64), [false, false], 'iron door: a wall');
  // package.nix patches the library: a bot with scaffolding blocks crashed its worker after clicking a door (2026-11-03).
  assert.ok(require('node:fs').readFileSync(require.resolve('mineflayer-pathfinder'), 'utf8').includes('if (!placingBlock) {'), 'the door patch is in the library');
  assert.ok(require('node:fs').readFileSync(require.resolve('mineflayer-pathfinder'), 'utf8').includes('/_door$|_fence_gate$/.test(block.name)'), 'the path goes through the middle of a door');
  assert.deepStrictEqual(at(4, 64), [false, true], 'open gate: walk through');
  assert.deepStrictEqual(at(5, 64), [true, false], 'closed gate: click it');
  // An unloaded cell reaches the exclusions as the library's stand-in without a position: it threw and took the hub down (2026-11-07).
  const ghost = {physical: false, safe: false, replaceable: false};
  assert.ok(mv.exclusionPlace(ghost) >= 100, 'no placing into an unloaded cell');
  assert.ok(mv.exclusionBreak(ghost) >= 100, 'nor digging it');
})();

(async () => { // parkour: no jump over a deep gap, a shallow gap is still jumped (five falls at the tower, 2026-11-17)
  const {safeMovements} = require('../bots');
  const {Movements} = require('mineflayer-pathfinder');
  const {Vec3} = require('vec3');
  const EventEmitter = require('node:events');
  const registry = require('minecraft-data')('26.1');
  const air = registry.blocksByName.air.id, stone = registry.blocksByName.stone.id;
  const world = (solid) => {
    const at = (p) => solid.has(`${p.x},${p.y},${p.z}`)
      ? {type: stone, name: 'stone', position: p.clone(), boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], getProperties: () => ({})}
      : {type: air, name: 'air', position: p.clone(), boundingBox: 'empty', shapes: [], getProperties: () => ({})};
    return Object.assign(new EventEmitter(), {registry, entities: {}, entity: {position: new Vec3(0, 64, 0)}, pathfinder: {}, blockAt: at});
  };
  // The bot stands on 0,63,0; the landing is 2,63,0; 1,y,0 is the gap.
  const jumpsTo = (mv) => { const out = []; mv.getMoveParkourForward(new Vec3(0, 64, 0), {x: 1, z: 0}, out); return out.map((m) => `${m.x},${m.y},${m.z}`); };
  const chasm = world(new Set(['0,63,0', '2,63,0']));
  assert.deepStrictEqual(jumpsTo(new Movements(chasm)), ['2,64,0'], 'the library alone jumps the deep gap');
  assert.deepStrictEqual(jumpsTo(safeMovements(chasm, [], null)), [], 'no jump over a gap with no floor in reach');
  const shallow = world(new Set(['0,63,0', '2,63,0', '1,61,0']));
  assert.deepStrictEqual(jumpsTo(safeMovements(shallow, [], null)), ['2,64,0'], 'a gap with a floor 2 down is still jumped');
})();

(async () => { // chase: "No path" to a player below widens the fall once, and a way missing for 30 s ends the job with a reason (2026-11-01)
  const {chase} = require('../bots');
  const {Vec3} = require('vec3');
  const EventEmitter = require('node:events');
  const mk = (py) => {
    const goals = [], mv = {maxDropDown: 3};
    const bot = Object.assign(new EventEmitter(), {health: 20, entity: {position: new Vec3(0, 70, 0)}, players: {Misa: {entity: {position: new Vec3(0, py, 0)}}},
      pathfinder: {movements: mv, setGoal: (g) => goals.push(g), isMoving: () => true, stop() {}}});
    return {bot, goals, mv, r: {bot, online: true, combat: {epoch: 0, busy: false}, world: {player: () => null}}};
  };
  const {bot, goals, mv, r} = mk(60);
  const job = {args: {player: 'Misa'}, t: {}, cancelled: false};
  const done = chase(r, job, false);
  await new Promise((res) => setTimeout(res, 100));
  bot.emit('path_update', {status: 'noPath', path: []});
  await new Promise((res) => setTimeout(res, 700));
  assert.strictEqual(mv.maxDropDown, 12, 'health 20 allows a 12-block fall');
  assert.strictEqual(goals.length, 2, 'the goal is set again with the wider drop');
  bot.players.Misa.entity.position = new Vec3(0, 69, 1);
  await done;
  assert.strictEqual(mv.maxDropDown, 3, 'the drop is put back');
  const two = mk(70);
  let later = 0; // not by patching Date.now: the other test parts run at the same time and read it
  const follow = chase(two.r, {args: {player: 'Misa'}, t: {}, cancelled: false}, true, () => Date.now() + later).then(() => 'ok', (e) => e.message);
  await new Promise((res) => setTimeout(res, 100));
  two.bot.emit('path_update', {status: 'noPath', path: []});
  later = 31000;
  assert.strictEqual(await follow, 'no path to Misa');
  assert.strictEqual(two.mv.maxDropDown, 3, 'same level: no wider drop');
})();

(async () => { // walks dig no built blocks (audit 2026-11-19: mine, chop, get, grave and combat walks tunnelled castle and base walls);
  // building jobs keep their own plan veto (build.js), and a walk refused only by them fails with a reason of its own
  const {safeMovements, goNear} = require('../bots');
  const {Vec3} = require('vec3');
  const EventEmitter = require('node:events');
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), {registry, entity: {position: new Vec3(0, 64, 0)}, pathfinder: {}, blockAt: () => null});
  const blk = (name) => ({type: registry.blocksByName[name].id, name, position: new Vec3(1, 64, 0), boundingBox: 'block'});
  const cost = (mv, name) => mv.exclusionAreasBreak.reduce((a, f) => a + f(blk(name)), 0);
  for (const type of ['mine', 'chop', 'shift', 'get', 'goto', 'rearm', 'withdraw', 'deposit', 'graves', undefined]) {
    const r = {current: type && {type}, digOnly: null, digBox: null};
    const mv = safeMovements(bot, [], r);
    assert.ok(cost(mv, 'stone_bricks') >= 100, `${type || 'no job (combat)'}: a walk leaves stone_bricks standing`);
    assert.ok(cost(mv, 'oak_planks') >= 100, `${type || 'no job'}: and planks`);
    assert.strictEqual(cost(mv, 'stone'), 0, `${type || 'no job'}: stone is still dug`);
  }
  // produce only gathers and build vetoes only its own box: their walks keep this veto (bot21's "mine dirt" step of a
  // produce job dug 37 blocks out of the castle tower, main server 2026-11-19). A running schematic vetoes by its plan
  // (build.js vetoBreak, planVeto up: off the site only natural ground) and may dig out through its own walls.
  for (const type of ['build', 'produce', 'schematic']) assert.ok(cost(safeMovements(bot, [], {current: {type}}), 'stone_bricks') >= 100, `${type}: its walks leave stone_bricks standing`);
  assert.strictEqual(cost(safeMovements(bot, [], {current: {type: 'schematic'}, planVeto: true}), 'stone_bricks'), 0, 'schematic: build.js vetoes by its plan');
  // Walled in by built blocks only: the walk ends with its own reason (bot-chef shows it), no endless retry.
  let calls = 0;
  const r = {current: {type: 'mine'}, world: {hostilesNear: () => []}, combat: {fit: () => false}, emit() {}, protectedAreas: []};
  const mv = safeMovements(bot, [], r);
  const pf = {searchRadius: 80, stop() {}, setGoal() {}, goto: async () => { calls++; mv.exclusionBreak(blk('stone_bricks')); throw new Error('No path to the goal!'); }};
  r.bot = {entity: {position: new Vec3(0, 64, 0)}, time: {timeOfDay: 1000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
    blockAt: () => ({name: 'air', boundingBox: 'empty'}), pathfinder: pf};
  const out = await goNear(r, {type: 'mine', t: {}, cancelled: false}, 3, 64, 3, 2).then(() => 'ok', (e) => e.message);
  assert.match(out, /^could not reach 3 64 3: No path.*only through built blocks \(kept stone_bricks at 1 64 0\)/);
  assert.ok(calls <= 6, `the walk ends (${calls} searches)`);
  assert.match(await goNear(r, {type: 'mine', t: {}, cancelled: false}, 3, 64, 3, 2).then(() => 'ok', (e) => e.message), /cached/, 'and is not searched again at once');
  calls = 0;
  pf.goto = async () => { calls++; throw new Error('No path to the goal!'); }; // no built block refused: the usual reason
  assert.match(await goNear(r, {type: 'mine', t: {}, cancelled: false}, 9, 64, 9, 2).then(() => 'ok', (e) => e.message), /^could not reach 9 64 9: No path to the goal!$/);
})();

{ // a schematic left hanging on a dead connection keeps planVeto up: the next connection's movements have no vetoBreak,
  // so the built veto is back there (final review 2026-11-19)
  const mineflayer = require('mineflayer'), {BotRunner} = require('../bots');
  const EventEmitter = require('node:events');
  const {Vec3} = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const bot = Object.assign(new EventEmitter(), {_client: new EventEmitter(), registry, entity: {position: new Vec3(0, 64, 0)}, blockAt: () => null,
    loadPlugin() {}, dig: async () => {}, equip: async () => {}, placeBlock: async () => {}});
  let mv = null;
  const createBot = mineflayer.createBot;
  mineflayer.createBot = () => bot;
  const r = new BotRunner('bot1', {host: 'x', port: 1, log: () => {}, world: {noteChange() {}, forgetMob() {}}});
  try { r.connect(); } finally { mineflayer.createBot = createBot; }
  bot.pathfinder = {setMovements: (m) => (mv = m)};
  bot.collectBlock = {};
  r.planVeto = true;
  try {
    bot.emit('spawn');
  } finally { r.combat.stop(); }
  const blk = {type: registry.blocksByName.stone_bricks.id, name: 'stone_bricks', position: new Vec3(1, 64, 0), boundingBox: 'block'};
  assert.ok(mv.exclusionAreasBreak.reduce((a, f) => a + f(blk), 0) >= 100, 'a fresh connection leaves stone_bricks standing');
}

(async () => { // goNear: a tree's crown is no roof: bot2 on a tuff mound at -311 75 -163 under oak leaves 4 up climbed "to Y 90" straight up
  // towards the castle chest at -302 111 6, "no progress for 30 s" every minute for 8 min (main server 2026-11-19). Rock overhead still climbs.
  const {goNear} = require('../bots');
  const {Vec3} = require('vec3');
  const first = async (roof) => {
    const goals = [], pos = new Vec3(-311, 75, -163);
    const pf = {searchRadius: 80, stop() {}, setGoal() {}, goto: async (g) => {
      goals.push(g.constructor.name);
      for (const k of ['x', 'y', 'z']) if (Number.isFinite(g[k])) pos[k] = g[k];
    }};
    const bot = {entity: {position: pos}, time: {timeOfDay: 1000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
      blockAt: (p) => (p.y === 79 ? {name: roof, boundingBox: 'block'} : {name: 'air', boundingBox: 'empty'}), pathfinder: pf};
    await goNear({bot, world: {hostilesNear: () => []}, combat: {fit: () => false}, emit() {}, protectedAreas: []}, {type: 'goto', t: {}, cancelled: false}, -302, 111, 6, 2);
    return goals[0];
  };
  assert.notStrictEqual(await first('oak_leaves'), 'GoalY', 'under leaves the bot walks, it does not climb straight up');
  assert.strictEqual(await first('stone'), 'GoalY', 'under rock it still climbs first');
})().catch((e) => { console.error(e); process.exitCode = 1; });

(async () => { // goNear: a surface walk base -268 66 -213 -> spruce forest -374 74 75 sank bot1 to Y -19 in 2 min, leg by leg (main server
  // 2026-11-19): a y-less leg goal ranked a node 80 levels down like one on the surface. A floor under start and target stops that.
  const {goNear} = require('../bots');
  const {Vec3} = require('vec3');
  const {goals: G} = require('mineflayer-pathfinder');
  const first = async (x, y, z, opts) => {
    const goals = [], pos = new Vec3(-268, 66, -213);
    const pf = {searchRadius: 80, stop() {}, setGoal() {}, goto: async (g) => {
      goals.push(g);
      for (const k of ['x', 'y', 'z']) if (Number.isFinite(g[k])) pos[k] = g[k];
    }};
    const bot = {entity: {position: pos}, time: {timeOfDay: 1000}, game: {dimension: 'overworld'}, inventory: {items: () => []},
      blockAt: () => ({name: 'air', boundingBox: 'empty'}), pathfinder: pf};
    await goNear({bot, world: {hostilesNear: () => []}, combat: {fit: () => false}, emit() {}, protectedAreas: []}, {type: 'goto', t: {}, cancelled: false}, x, y, z, 2, opts);
    return goals[0];
  };
  const g = await first(-374, 74, 75);
  const at = (y) => ({x: g.x, y, z: g.z});
  assert.strictEqual(g.isEnd(at(30)), false, 'a leg may not end deep under start and target');
  assert.strictEqual(g.isEnd(at(60)), true, 'a leg ends near the surface');
  assert.ok(g.heuristic(at(30)) > g.heuristic(at(60)), 'a deep node ranks worse');
  assert.strictEqual(g.isEnd(at(55)), true, 'the base level stays a legal leg end');
  const deep = await first(-374, 24, 75);
  assert.strictEqual(deep.isEnd({x: deep.x, y: 14, z: deep.z}), true, 'a deep target keeps deep legs');
  const xz = await first(-228, 66, -213, {xz: true});
  assert.strictEqual(xz.isEnd({x: xz.x, y: 46, z: xz.z}), false, 'the xz last leg has the floor too');
  const noY = await first(-228, undefined, -213, {xz: true});
  assert.strictEqual(noY.isEnd({x: noY.x, y: 60, z: noY.z}), true, 'a missing y does not poison the leg floor');
  assert.strictEqual(noY.isEnd({x: noY.x, y: 30, z: noY.z}), false, 'a missing y still keeps the floor under the start');
  assert.ok(Number.isFinite(noY.heuristic({x: noY.x, y: 60, z: noY.z})), 'the heuristic stays a number without y');
  const own = new G.GoalY(40);
  assert.strictEqual(await first(-268, 40, -213, {goal: own}), own, 'a dig-down goal is untouched');
})().catch((e) => { console.error(e); process.exitCode = 1; });
