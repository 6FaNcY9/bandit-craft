'use strict';
// Far search: heading choice, compass names, failure text. No Minecraft server.
(() => {
  const assert = require('node:assert/strict');
  const {DIRS, hopTarget, farHeading, farFail, FAR_HOP} = require('../farsearch');
  const {germanReason} = require('../owner');
  const orderOutcome = require('../orderloop').orderOutcome;
  const name = (i) => DIRS[i].en;
  // Minecraft north is -z
  assert.equal(DIRS[0].de, 'Norden'); assert.equal(hopTarget({x: 0, z: 0}, DIRS[0]).z, -FAR_HOP);
  assert.equal(DIRS[4].de, 'Süden'); assert.equal(hopTarget({x: 0, z: 0}, DIRS[4]).z, FAR_HOP);
  assert.deepEqual(DIRS.map((d) => d.de), ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten']);
  // away from the base: the bot at (100, 0), base at the origin -> east
  assert.equal(name(farHeading({x: 100, z: 0}, [], {x: 0, z: 0})), 'east');
  assert.equal(name(farHeading({x: 100, z: 0}, [], {x: 0, z: 0}, [2])), 'northeast'); // east tried: next-best (tie with southeast, lower index)
  // never a heading whose first hop lands in a protected box
  const box = [150, -50, 250, 50]; // 96 east of (100, 0) is inside
  for (const base of [{x: 0, z: 0}, null]) assert.notEqual(name(farHeading({x: 100, z: 0}, [box], base)), 'east');
  // out of the protected area soonest: a huge box to the east (beyond the first hop) beats pure "away"
  assert.equal(name(farHeading({x: 100, z: 0}, [[190, -20, 900, 20]], {x: 0, z: 0})), 'northeast');
  // all headings blocked or tried: -1
  assert.equal(farHeading({x: 0, z: 0}, [[-500, -500, 500, 500]]), -1);
  assert.equal(farHeading({x: 0, z: 0}, [], null, [0, 1, 2, 3, 4, 5, 6, 7]), -1);
  // failure text: German reason, and the fail event reads "gave up" for the order retry (4x wait)
  const text = farFail('spruce_log', {hops: 8, dir: 4});
  assert.equal(text, 'no free spruce_log within 768 blocks of a far search heading south');
  assert.equal(germanReason(text), 'kein spruce_log gefunden, auch nicht 768 Blöcke weiter Richtung Süden');
  assert.doesNotMatch(text, /no way to get|no progress for|No path/);
  assert.equal(orderOutcome({kind: 'fail', text: `gave up: mine spruce_log 2048 - ${text}`}, {type: 'mine', args: {}}).retry, 4 * 5 * 60000);
})();
// farFail between two headings (dir -1) names the last real one; no walkable heading has its own text and reason
(() => {
  const assert = require('node:assert/strict');
  const {farFail} = require('../farsearch'), {germanReason} = require('../owner');
  assert.equal(farFail('sand', {hops: 2, dir: -1, last: 6}), 'no free sand within 192 blocks of a far search heading west');
  const t = farFail('sand', {hops: 0, dir: -1});
  assert.equal(t, 'no free sand within reach and no walkable heading');
  assert.equal(germanReason(t), 'kein sand in Reichweite und kein Weg weiter weg');
})();
// get: a "no free" mine failure is not a failure of the way (nothing learned, nothing blocked, far text rethrown);
// a genuine failure of a way is still learned
const first = (async () => {
  const assert = require('node:assert/strict'), {Vec3} = require('vec3');
  const {JOBS} = require('../bots');
  const learned = [];
  const mk = () => ({name: 'bot3', emit() {}, log() {}, acquireFailed: new Map(), protectedAreas: [], world: {chests: new Map(), learn: (k, v) => learned.push([k, v]), learned: () => null},
    bot: {entity: {position: new Vec3(0, 64, 0)}, registry: require('minecraft-data')('26.1'), inventory: {items: () => []}, findBlock: () => null, findBlocks: () => [], world: {getColumn: () => null}, nearestEntity: () => null}});
  const job = () => ({id: 1, type: 'get', args: {item: 'spruce_log', count: 4}, t: {}, collected: 0, progress: ''});
  const old = JOBS.mine;
  try {
    const far = 'no free spruce_log within 768 blocks of a far search heading south';
    JOBS.mine = async () => { throw new Error(far); };
    const r = mk();
    await assert.rejects(JOBS.get(r, job()), (e) => e.message === far);
    assert.equal(r.acquireFailed.size, 0); assert.equal(learned.length, 0);
    JOBS.mine = async () => { throw new Error('no path to somewhere'); };
    const r2 = mk();
    await assert.rejects(JOBS.get(r2, job()));
    assert.ok(r2.acquireFailed.size > 0 && learned.some(([, v]) => v.ok === false), 'a real failure is still learned');
    // Blocks it could not walk to: this bot tries another way, the fleet does not learn the way as failed
    learned.length = 0;
    JOBS.mine = async () => { throw new Error('could not reach -25 63 -78: no progress for 30 s'); };
    const r3 = mk();
    await assert.rejects(JOBS.get(r3, job()));
    assert.ok(r3.acquireFailed.size > 0, 'this bot tries another way');
    assert.ok(!learned.some(([k, v]) => k.startsWith('mine:') && v.ok === false), 'no fleet-wide way failure');
  } finally { JOBS.mine = old; }
})().catch((e) => { console.error(e); process.exitCode = 1; });

// A far search that gives up walks back to where it began (no drift on the next retry), then throws the same error.
first.then(async () => {
  const assert = require('node:assert/strict'), {Vec3} = require('vec3');
  const {JOBS} = require('../bots');
  const pos = new Vec3(10, 64, 20), walks = [];
  const bot = {entity: {position: pos}, registry: require('minecraft-data')('26.1'), inventory: {items: () => []}, findBlock: () => null, findBlocks: () => [], world: {getColumn: () => null}, nearestEntity: () => null,
    blockAt: () => null, game: {dimension: 'overworld'}, on() {}, once() {},
    pathfinder: {searchRadius: 100, stop() {}, setGoal() {}, goto: async (g) => { walks.push([g.x, g.z]); pos.x = g.x; pos.z = g.z; }}};
  const r = {name: 'bot3', emit() {}, log() {}, bot, protectedAreas: [], world: null, skip: new Map(), acquireFailed: new Map(), conflict() {}, combat: {busy: false, hostilesNear: () => [], fit: () => true}, moves: null};
  const job = {id: 1, type: 'mine', args: {block: 'sand', count: 4}, t: {upkeep: true}, collected: 0, progress: ''};
  await assert.rejects(JOBS.mine(r, job), (e) => /^no free sand within \d+ blocks of a far search heading/.test(e.message));
  assert.ok(walks.length >= 2, 'it hopped out');
  assert.deepEqual(walks.at(-1), [10, 20], 'the last walk goes back to the start');
  assert.ok(Math.hypot(pos.x - 10, pos.z - 20) < 10, 'and the bot ends there');
}).catch((e) => { console.error(e); process.exitCode = 1; });

// Night, unfit, on protected ground (no shelter hole allowed): the far search waits for the morning on the clock. A bare
// `continue` looped without ever yielding, the worker's keepalive starved and MisaBot and EM_Trader timed out (2026-11-07).
first.then(async () => {
  const assert = require('node:assert/strict'), {Vec3} = require('vec3');
  const {JOBS} = require('../bots');
  const bot = {entity: {position: new Vec3(10, 64, 20)}, registry: require('minecraft-data')('26.1'), inventory: {items: () => []}, findBlock: () => null, findBlocks: () => [], world: {getColumn: () => null}, nearestEntity: () => null,
    blockAt: () => null, game: {dimension: 'overworld'}, time: {timeOfDay: 18000}, on() {}, once() {},
    pathfinder: {searchRadius: 100, stop() {}, setGoal() {}, goto: async () => { throw new Error('not expected: a walk at night'); }}};
  const r = {name: 'MisaBot', emit() {}, log() {}, bot, protectedAreas: [[-80, -144, 80, 80]], world: {hostilesNear: () => []}, skip: new Map(), acquireFailed: new Map(), conflict() {}, combat: {busy: false, fit: () => false}, moves: null};
  const job = {id: 2, type: 'mine', args: {block: 'crimson_stem', count: 1}, t: {upkeep: true}, collected: 0, progress: '', noFar: false};
  const run = JOBS.mine(r, job);
  await new Promise((res) => setTimeout(res, 50)); // never fires while the loop spins
  assert.match(job.t.doing, /morning/);
  job.cancelled = true;
  await assert.rejects(run, /stopped/);
}).catch((e) => { console.error(e); process.exitCode = 1; });

// Deep rock after a detour: back at the base (rearm), the dig-down walks back to the block it dug last (77 blocks away)
// instead of a new stair beside the base and a far search (bot19, 500 blocks, 2026-11-18).
first.then(async () => {
  const assert = require('node:assert/strict'), {Vec3} = require('vec3');
  const {JOBS} = require('../bots');
  const home = {x: -271, y: 66, z: -214}, dug = {x: -194, y: -2, z: -209};
  const pos = new Vec3(-268, 66, -212), walks = [];
  const job = {id: 3, type: 'mine', args: {block: 'deepslate', count: 4}, t: {upkeep: true, area: dug}, collected: 0, progress: ''};
  const bot = {entity: {position: pos}, registry: require('minecraft-data')('26.1'), inventory: {items: () => []}, findBlock: () => null, findBlocks: () => [], world: {getColumn: () => null}, nearestEntity: () => null,
    blockAt: () => null, game: {dimension: 'overworld'}, on() {}, once() {},
    pathfinder: {searchRadius: 100, stop() {}, setGoal() {}, goto: async (g) => {
      walks.push([g.constructor.name, g.x, g.y, g.z]);
      for (const k of ['x', 'y', 'z']) if (Number.isFinite(g[k])) pos[k] = g[k];
      if (walks.length > 12 || Math.hypot(pos.x - dug.x, pos.z - dug.z) < 4) job.cancelled = true; // there (or lost): stop the job
    }}};
  const r = {name: 'bot19', emit() {}, log() {}, bot, supplyChest: home, protectedAreas: [], world: null, skip: new Map(), acquireFailed: new Map(), conflict() {}, combat: {busy: false, hostilesNear: () => [], fit: () => true}, moves: null};
  await assert.rejects(JOBS.mine(r, job), /stopped/);
  assert.ok(Math.hypot(pos.x - dug.x, pos.z - dug.z) < 4 && pos.y === dug.y, `it walked back to the dug block: ${JSON.stringify(walks)}`);
  assert.ok(!walks.some(([name]) => name === 'GoalY'), 'no new stair');
}).catch((e) => { console.error(e); process.exitCode = 1; });

// Mined out under the base, deep rock walks to the nearest spot any bot dug it at, not on a blind far hop (bot19 hopped
// 134 blocks to -267 3 -67, twice on 2026-11-18); nothing free there: the spot is marked, and the far search goes on.
first.then(async () => {
  const assert = require('node:assert/strict'), {Vec3} = require('vec3');
  const {JOBS} = require('../bots'), {WorldModel} = require('../world');
  const home = {x: -271, y: 66, z: -214}, good = {x: -200, y: -10, z: -100}; // off the hop lines: a hop south from here ends near -267 3 -67
  const world = new WorldModel();
  world.learn(`dig:deepslate:${good.x},${good.y},${good.z}`, {ok: true});
  const pos = new Vec3(-265, -6, -160), walks = [], infos = [];
  const job = {id: 4, type: 'mine', args: {block: 'deepslate', count: 4}, t: {upkeep: true}, collected: 0, progress: ''};
  let there = false;
  const bot = {entity: {position: pos}, registry: require('minecraft-data')('26.1'), inventory: {items: () => []}, findBlock: () => null, findBlocks: () => [], world: {getColumn: () => null}, nearestEntity: () => null,
    blockAt: () => null, game: {dimension: 'overworld'}, on() {}, once() {},
    pathfinder: {searchRadius: 100, stop() {}, setGoal() {}, goto: async (g) => {
      if (there || walks.length > 12) job.cancelled = true; // the walk after the spot (or lost): stop the job
      walks.push([g.constructor.name, g.x, g.y, g.z]);
      for (const k of ['x', 'y', 'z']) if (Number.isFinite(g[k])) pos[k] = g[k];
      there ||= Math.hypot(pos.x - good.x, pos.z - good.z) < 4;
    }}};
  const r = {name: 'bot19', emit: (k, t) => infos.push(t), log() {}, bot, supplyChest: home, protectedAreas: [], world, skip: new Map(), acquireFailed: new Map(), conflict() {}, combat: {busy: false, hostilesNear: () => [], fit: () => true}, moves: null};
  await assert.rejects(JOBS.mine(r, job), /stopped/);
  assert.ok(there, `it walked to the shared spot: ${JSON.stringify(walks)}`);
  assert.ok(walks.every(([name]) => name !== 'GoalY'), 'no dig-down');
  const hop = infos.findIndex((t) => /sucht weiter/.test(t));
  assert.ok(hop >= 0 && walks.length >= 2, `the far search only after the spot: ${infos.join('|')}`);
  assert.deepStrictEqual(world.digSpots('deepslate'), [], 'nothing free there: marked');
}).catch((e) => { console.error(e); process.exitCode = 1; });
