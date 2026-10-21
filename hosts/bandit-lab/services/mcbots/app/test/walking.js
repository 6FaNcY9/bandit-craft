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
    console.log('goLeg: deadline after a night wait ok');
  };
  // execFile, not execFileSync: a blocked event loop failed the combat timing test next door (lastFight < 1 s).
  require('node:child_process').execFile(process.execPath, ['-e', `(${night})().catch((e) => { console.error(e); process.exit(1); })`], {cwd: APP, encoding: 'utf8'}, (e, out, err) => {
    if (e || !/deadline after a night wait ok/.test(out)) { console.error(err || e); process.exitCode = 1; return; }
    process.stdout.write(out);
  });
}
