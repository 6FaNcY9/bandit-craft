'use strict';
// Unit test for the pure parts of the rail measurement: node tools/mcbots-railspeed/rig.test.js
const assert = require('node:assert/strict');
const {SPEEDS, SPACINGS, SWEEP_LANE, railLane, powerEvery, launch, iceLane, setSpeed, clearLane, batches, parseSample, summarize} = require('./rig');

const lane = {x1: 300, x2: 2300, y: 200, z: 10};

// The settings the design names, on a lane of at least 2 km
assert.deepEqual(SPEEDS, [8, 20, 40, 72, 100, 150, 200, 400, 1000]);
assert.deepEqual(SPACINGS, [2, 4, 8, 16, 38]);
assert.deepEqual(SWEEP_LANE, lane);

// Laying
assert.ok(railLane(lane).some((c) => c === 'forceload add 300 10 2300 10'));
assert.ok(railLane(lane).includes('fill 300 199 10 2300 199 10 stone'));
assert.ok(railLane(lane).includes('fill 300 200 10 2300 200 10 rail[shape=east_west]'));
assert.ok(railLane(lane).findIndex((c) => c.startsWith('forceload')) < railLane(lane).findIndex((c) => c.startsWith('fill')), 'fill needs loaded chunks');
assert.deepEqual(powerEvery({...lane, x2: 340}, 38).slice(0, 2), ['setblock 300 199 10 redstone_block', 'setblock 300 200 10 powered_rail[shape=east_west,powered=true]']);
assert.equal(powerEvery({...lane, x2: 340}, 38).length, 4, 'at 300 and 338');
assert.equal(setSpeed(100), 'gamerule max_minecart_speed 100');

// forceload refuses more than 256 chunks in one command, and a 5 km lane is more
const spans = railLane({x1: 300, x2: 5300, y: 200, z: 40}).filter((c) => c.startsWith('forceload add')).map((c) => c.split(' ').map(Number));
assert.ok(spans.length > 1 && spans.every((s) => Math.floor(s[4] / 16) - Math.floor(s[2] / 16) + 1 <= 256));
assert.equal(spans[0][2], 300);
assert.equal(spans.at(-1)[4], 5300);
for (let i = 1; i < spans.length; i++) assert.equal(spans[i][2], spans[i - 1][4] + 1, 'no gap between spans');

// A lane whose walls would reach an unforced chunk row is refused, or its fill fails halfway
assert.throws(() => railLane({...lane, z: 30}), /chunk row/);

// One tag, one cart at a time, occupied, moving east
const started = launch(lane);
assert.equal(started[0], 'kill @e[tag=rs]');
assert.ok(/^summon minecart 301\.5 200\.1 10\.5 /.test(started[1]));
assert.ok(started[1].includes('Tags:["rs"]') && started[1].includes('id:"minecraft:armor_stand"') && started[1].includes('Motion:[1.0,0.0,0.0]'));

// Blue ice: two wide with a wall each side, or one column with an air gap each side so a boat can overhang
const ice2 = iceLane({x1: 300, x2: 310, y: 200, z: 50}, 2);
assert.ok(ice2.includes('fill 300 199 50 310 199 51 blue_ice'));
assert.ok(ice2.includes('fill 300 200 49 310 201 49 stone_bricks') && ice2.includes('fill 300 200 52 310 201 52 stone_bricks'));
const ice1 = iceLane({x1: 300, x2: 310, y: 200, z: 60}, 1);
assert.ok(ice1.includes('fill 300 199 60 310 199 60 blue_ice'));
assert.ok(ice1.includes('fill 300 200 58 310 201 58 stone_bricks') && ice1.includes('fill 300 200 62 310 201 62 stone_bricks'));
assert.ok(!ice1.some((c) => /^fill \S+ 199 59 /.test(c)), 'nothing under the air gap');
assert.throws(() => iceLane(lane, 3), /width/);

// Taking it away again frees what railLane forced
const cleared = clearLane(lane);
assert.equal(cleared[0], 'kill @e[tag=rs]');
assert.ok(cleared.includes('forceload remove 300 10 2300 10'));
assert.ok(cleared.findIndex((c) => c.startsWith('forceload remove')) > cleared.findIndex((c) => c.startsWith('fill')), 'fill first: it needs loaded chunks');

// Limits of the console
assert.ok(batches(Array(130).fill('x')).every((b) => b.length <= 64));
assert.equal(batches(Array(130).fill('x')).flat().length, 130);
assert.deepEqual(batches([]), []);
assert.throws(() => batches(['x'.repeat(1401)]), /1400/);

// Parsing the console's replies
assert.deepEqual(parseSample(['The game time is 1000 tick(s)', 'Minecart has the following entity data: [301.5d, 200.0d, 10.5d]']), {tick: 1000, x: 301.5, y: 200, z: 10.5});
assert.equal(parseSample(['The game time is 1000 tick(s)', 'No entity was found']), null);
assert.equal(parseSample(['weird', 'reply']), null);
assert.equal(parseSample(['The game time is 1000 tick(s)']), null);

// Analysis: speed is per game tick, so a lagging server does not read as a slow rail
const run = (speed, n, t0 = 0, msPerTick = 50) => Array.from({length: n}, (_, i) => ({tick: 20 * i, wall: t0 + i * 20 * msPerTick, x: 300 + speed * i, y: 200, z: 10.5}));
assert.equal(summarize(run(40, 30), lane).sustained, 40);
assert.equal(summarize(run(40, 30, 0, 100), lane).sustained, 40, 'half speed server, same rail');
assert.equal(Math.round(summarize(run(40, 30, 0, 100), lane).tps), 10);
assert.equal(Math.round(summarize(run(40, 30), lane).tps), 20);

// Sustained is what it settles at, top what it peaked at
const ramp = Array.from({length: 30}, (_, i) => ({tick: 20 * i, wall: i * 1000, x: 300 + (i < 10 ? 10 * i : 100 + 30 * (i - 10)), y: 200, z: 10.5}));
assert.equal(summarize(ramp, lane).sustained, 30);
assert.equal(summarize(ramp, lane).top, 30);

// Samples closer than 20 ticks are not paired: a jitter of a tick or two must not read as a burst of speed
const close = [{tick: 0, wall: 0, x: 300, y: 200, z: 10.5}, {tick: 1, wall: 50, x: 310, y: 200, z: 10.5}, {tick: 20, wall: 1000, x: 320, y: 200, z: 10.5}, {tick: 21, wall: 1050, x: 321, y: 200, z: 10.5}, {tick: 40, wall: 2000, x: 340, y: 200, z: 10.5}];
assert.ok(summarize(close, lane).top <= 20);

// Off the rail is a derail, gone is lost; neither is a speed
const off = run(40, 10); off[9] = {...off[9], y: 180};
assert.equal(summarize(off, lane).derailed, true);
assert.equal(summarize(off, lane).sustained, null, 'a derailed run has no speed to compare');
const sideways = run(40, 10); sideways[9] = {...sideways[9], z: 14};
assert.equal(summarize(sideways, lane).derailed, true);
const gone = [...run(40, 5), null];
assert.equal(summarize(gone, lane).lost, true);
assert.equal(summarize(gone, lane).sustained, null);
assert.equal(summarize(run(40, 60), lane).reachedEnd, true);
assert.equal(summarize(run(40, 60), lane).lost, false);
assert.equal(summarize(run(40, 60), lane).derailed, false);
assert.equal(summarize(run(8, 30), lane).reachedEnd, false, 'a timeout has not reached the end');
assert.equal(summarize(run(8, 30), lane).sustained, 8, 'and is still a valid row');

// A cart gone after the far end is the end of the lane, not a lost run
assert.equal(summarize([...run(40, 60), null], lane).lost, false);

// Nothing to measure
assert.equal(summarize([], lane).lost, true);
assert.equal(summarize([null], lane).sustained, null);
