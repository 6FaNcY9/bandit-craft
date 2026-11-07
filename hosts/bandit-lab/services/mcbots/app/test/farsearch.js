'use strict';
// Far search: heading choice, compass names, failure text. No Minecraft server.
(() => {
  const assert = require('node:assert/strict');
  const {DIRS, hopTarget, farHeading, farFail, FAR_HOP} = require('../farsearch');
  const {germanReason} = require('../owner');
  const orderOutcome = require('../agentauth').orderOutcome;
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
