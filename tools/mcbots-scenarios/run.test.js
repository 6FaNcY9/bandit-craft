'use strict';
// Unit test for the pure parts of run.js: node tools/mcbots-scenarios/run.test.js
const assert = require('node:assert/strict');
const {maxGap, checkCommand, validateScenario, evalCondition, evalSuccess, countMetrics, invCount, chestItemCount} = require('./run');
const {SCENARIOS} = require('./scenarios');

// every shipped scenario is valid and stays inside the box
for (const s of SCENARIOS) validateScenario(s);
assert.equal(SCENARIOS.length, 13);

// rcon guard: outside the box, unknown verbs and unguarded shapes are refused
assert.throws(() => checkCommand('fill 3499 201 3000 3510 205 3010 minecraft:stone'), /outside/);
assert.throws(() => checkCommand('fill 3500 201 3000 3510 231 3010 minecraft:stone'), /outside/);
assert.throws(() => checkCommand('setblock 3510 201 3061 minecraft:chest'), /outside/);
assert.throws(() => checkCommand('op bot50'), /not allowed/);
assert.throws(() => checkCommand('setblock 3510 201 3010 minecraft:stone destroy'), /not allowed/);
assert.throws(() => checkCommand('execute if block 3 200 3000 minecraft:stone run fill 3500 201 3000 3501 201 3000 minecraft:air'), /outside/);
assert.ok(checkCommand('execute if block 3500 200 3000 minecraft:stone run fill 3500 201 3000 3560 208 3060 minecraft:air'));
assert.ok(checkCommand('tp bot50 3510.5 201 3030.5'));

// scenario validation
const good = {name: 'x-1', timeoutS: 5, job: {type: 'goto', args: {}}, success: [{kind: 'alive'}]};
validateScenario(good);
assert.throws(() => validateScenario({...good, name: 'Bad Name'}), /name/);
assert.throws(() => validateScenario({...good, timeoutS: 0}), /timeoutS/);
assert.throws(() => validateScenario({...good, success: [{kind: 'magic'}]}), /unknown condition/);
assert.throws(() => validateScenario({...good, success: []}), /at least one/);
assert.throws(() => validateScenario({...good, setup: ['fill 0 0 0 1 1 1 minecraft:air']}), /outside/);

// predicates
const bot = {pos: [3540, 201, 3031], health: 20, job: null, lastError: '', inventory: ['cobblestone x5', 'bread x8', 'cobblestone x4']};
const ctx = {bot, elapsedS: 30, timedOut: false, chests: {'1,2,3,cobblestone': 16}};
assert.equal(invCount(bot.inventory, 'cobblestone'), 9);
assert.ok(evalCondition({kind: 'near', x: 3540, y: 201, z: 3030, r: 2.5}, ctx));
assert.ok(!evalCondition({kind: 'near', x: 3500, y: 201, z: 3030, r: 2.5}, ctx));
assert.ok(evalCondition({kind: 'notNear', x: 3500, y: 201, z: 3030, r: 2.5}, ctx));
assert.ok(evalCondition({kind: 'inv', item: 'cobblestone', min: 8}, ctx) && !evalCondition({kind: 'inv', item: 'cobblestone', min: 10}, ctx));
assert.ok(evalCondition({kind: 'finished'}, ctx) && !evalCondition({kind: 'finished'}, {...ctx, timedOut: true}) && !evalCondition({kind: 'finished'}, {...ctx, bot: {...bot, job: {type: 'goto'}}}));
assert.ok(evalCondition({kind: 'alive'}, ctx) && !evalCondition({kind: 'alive'}, {...ctx, bot: {...bot, health: 0}}));
assert.ok(evalCondition({kind: 'chest', x: 1, y: 2, z: 3, item: 'cobblestone', min: 16}, ctx) && !evalCondition({kind: 'chest', x: 1, y: 2, z: 3, item: 'cobblestone', min: 17}, ctx));
const failed = {...bot, lastError: 'could not reach 1 2 3', lastErrorAgoS: 3};
assert.ok(evalCondition({kind: 'error', re: 'could not reach|no path'}, {...ctx, bot: failed}) && !evalCondition({kind: 'noError'}, {...ctx, bot: failed}));
assert.ok(evalCondition({kind: 'noError'}, {...ctx, bot: {...failed, lastErrorAgoS: 900}}), 'a stale error from before the run is ignored');
assert.ok(evalCondition({kind: 'noError'}, {...ctx, bot: {...failed, lastErrorAgoS: 35}}), 'an error from before the job started is ignored');
assert.deepEqual(evalSuccess({success: [{kind: 'alive'}, {kind: 'inv', item: 'x', min: 1}]}, ctx), ['{"kind":"inv","item":"x","min":1}']);

// metrics
const ev = [{kind: 'fail', text: 'could not reach 1 2 3'}, {kind: 'info', text: 'No path to 4 5 6'}, {kind: 'info', text: 'no progress for 30 s: x'}, {kind: 'info', text: 'skipped a block'}, {kind: 'info', text: 'no free stone'}, {kind: 'death', text: 'drowned'}];
assert.deepEqual(countMetrics(ev), {could_not_reach: 1, no_path: 1, no_progress_30s: 1, skipped_a: 1, no_free: 1, deaths: 1});
assert.equal(countMetrics([], true).deaths, 1);
assert.equal(countMetrics([]).deaths, 0);

// chest parsing
assert.equal(chestItemCount('The block has data: [{Slot: 0b, count: 64, id: "minecraft:cobblestone"}, {Slot: 1b, id: "minecraft:cobblestone", count: 5}, {Slot: 2b, count: 9, id: "minecraft:dirt"}]', 'cobblestone'), 69);
assert.equal(chestItemCount('No such data', 'cobblestone'), 0);
assert.equal(maxGap([[0, 'a'], [1, 'a'], [2, 'b'], [6, 'b'], [7, 'c']]), 4);
assert.equal(maxGap([]), 0);
console.log('ok');
