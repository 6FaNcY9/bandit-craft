'use strict';
const assert = require('node:assert/strict');
const {aliveStep} = require('../alive');
const M = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const me = {x: 0, y: 64, z: 0}, P = (name, x, z, uuid = name) => ({name, uuid, x, y: 64, z});
let r = aliveStep({me, players: [P('far', 6, 0), P('near', 0, 3)], owners: [], now: 0, state: {}});
assert.deepEqual(r.look, {x: 0, y: 65.6, z: 3});
r = aliveStep({me, players: [P('far', 20, 0)], owners: [], now: 0, state: {}});
assert.equal(r.look, null);
assert.equal(aliveStep({me, players: [], owners: [], now: 0, state: {}}).look, null);
r = aliveStep({me, players: [P('m', 2, 0, M)], owners: [M], now: 0, state: {}});
assert.equal(r.sneak, true);
r = aliveStep({me, players: [P('m', 2, 0, M)], owners: [M], now: 250, state: r.state});
assert.equal(r.sneak, false);
r = aliveStep({me, players: [P('m', 6, 0, M)], owners: [M], now: 500, state: r.state}); // left 5 blocks: next approach bows again
r = aliveStep({me, players: [P('m', 2, 0, M)], owners: [M], now: 750, state: r.state});
assert.equal(r.sneak, true);
assert.equal(aliveStep({me, players: [P('s', 2, 0)], owners: [M], now: 0, state: {}}).sneak, false);
assert.deepEqual(aliveStep({me, players: [P('s', 0.5, 0)], owners: [], now: 0, state: {}}).aside, {dx: -1, dz: 0});
assert.deepEqual(aliveStep({me, players: [P('s', 0, -0.5)], owners: [], now: 0, state: {}}).aside, {dx: 0, dz: 1});
assert.equal(aliveStep({me, players: [P('s', 2, 0)], owners: [], now: 0, state: {}}).aside, null);
r = aliveStep({me, players: [P('m', 2, 0, '069A79F4-44E9-4726-A5BE-FCA90E38AAF5')], owners: ['069a79f444e94726a5befca90e38aaf5'.toUpperCase()], now: 0, state: {}});
assert.equal(r.sneak, true);
r = aliveStep({me, players: [P('m', 2, 0, '069a79f4-44e9-4726-a5be-fca90e38aaf5')], owners: ['069A79F444E94726A5BEFCA90E38AAF5'], now: 0, state: {}});
assert.equal(r.sneak, true);
const {safeCell} = require('../alive'), B = (name, boundingBox) => ({name, boundingBox}), stone = B('stone', 'block'), air = B('air', 'empty');
assert.equal(safeCell(stone, air, air), true);
assert.equal(safeCell(B('water', 'empty'), air, air), false);
assert.equal(safeCell(stone, B('stone_pressure_plate', 'empty'), air), false);
assert.equal(safeCell(B('magma_block', 'block'), air, air), false);
assert.equal(safeCell(stone, air, null), false);
{ // shore: the dry floor next to the water, never the sea floor
  const {shore} = require('../alive'), {Vec3} = require('vec3');
  const water = B('water', 'empty'), at = (v) => (v.y >= 63 ? air : v.x >= 3 && v.y <= 63 ? (v.y === 63 ? air : stone) : v.y <= 59 ? stone : water);
  const cells = [];
  for (let x = 0; x <= 4; x++) for (let y = 58; y <= 64; y++) cells.push(new Vec3(x, y, 0));
  const bot = {blockAt: (v) => ({...at(v), position: v}),
    findBlock: ({matching, useExtraInfo}) => cells.map((v) => bot.blockAt(v)).find((b) => matching(b) && useExtraInfo(b)) || null};
  assert.deepEqual(shore(bot).position, new Vec3(3, 62, 0));
}
console.log('alive ok');
