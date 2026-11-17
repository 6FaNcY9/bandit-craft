'use strict';
// node --test tools/world-check/
const test = require('node:test');
const assert = require('node:assert/strict');
const {diffSamples, farSpot, parseMspt, compareLoad} = require('./lib');

const reply = {palette: ['minecraft:stone'], blocks: [[1, 2, 3, 0]], unknown: [[5, 5]], ungenerated: []};

test('diffSamples', () => {
  assert.deepStrictEqual(diffSamples([[1, 2, 3, 'minecraft:stone'], [1, 3, 3, 'minecraft:cave_air']], reply), []);
  assert.deepStrictEqual(diffSamples([[1, 3, 3, 'minecraft:dirt']], reply), [{x: 1, y: 3, z: 3, want: 'minecraft:dirt', got: 'minecraft:air'}]);
  assert.strictEqual(diffSamples([[80, 0, 80, 'minecraft:air']], reply)[0].got, '?unknown');
});

test('diffSamples: negative coordinates map to the floor chunk, ungenerated counts as unknown', () => {
  const r = {palette: [], blocks: [], unknown: [[-1, -6]], ungenerated: [[-2, 0]]};
  assert.strictEqual(diffSamples([[-1, 0, -81, 'minecraft:air']], r)[0].got, '?unknown'); // -1 >> 4 = -1, -81 >> 4 = -6
  assert.strictEqual(diffSamples([[-17, 0, 0, 'minecraft:air']], r)[0].got, '?unknown'); // chunk -2, 0
  assert.deepStrictEqual(diffSamples([[-16, 0, -80, 'minecraft:air']], r), []); // chunk -1, -5: known
});

test('farSpot', () => {
  assert.deepStrictEqual(farSpot({x1: -590, z1: -340, x2: 50, z2: 300}, [[-270, -20]]), {x1: -590, z1: -340, x2: -559, z2: -309});
  assert.strictEqual(farSpot({x1: 0, z1: 0, x2: 100, z2: 100}, [[50, 50]]), null);
  assert.deepStrictEqual(farSpot({x1: 0, z1: 0, x2: 100, z2: 100}, []), {x1: 0, z1: 0, x2: 31, z2: 31});
});

test('parseMspt', () => {
  assert.strictEqual(parseMspt('Server tick times (avg/min/max) from last 5s, 10s, 1m: 9.1/5.0/20.0, 9.3/5.1/20.2, 9.6/5.0/31.4'), 9.6);
  assert.strictEqual(parseMspt('Server tick times (avg/min/max) from last 5s, 10s, 1m:\n 9.1/5.0/20.0, 9.3/5.1/20.2, 12/5.0/31.4'), 12);
  assert.strictEqual(parseMspt('Unknown command'), null);
  assert.strictEqual(parseMspt(undefined), null);
});

test('compareLoad', () => {
  assert.deepStrictEqual(compareLoad({mspt: 9.0, loopP99: 12}, {mspt: 9.4, loopP99: 15}), {msptDelta: 0.4, loopP99Delta: 3, ok: false});
  assert.deepStrictEqual(compareLoad({mspt: 9.0, loopP99: 12}, {mspt: 9.5, loopP99: 14}), {msptDelta: 0.5, loopP99Delta: 2, ok: true});
  assert.strictEqual(compareLoad({mspt: 9.0, loopP99: 12}, {mspt: 9.6, loopP99: 12}).ok, false);
  // an old hub has no loop delay: that limit cannot be judged, the mspt one still can
  assert.deepStrictEqual(compareLoad({mspt: 9.0, loopP99: null}, {mspt: 9.2, loopP99: 3}), {msptDelta: 0.2, loopP99Delta: null, ok: true});
  assert.strictEqual(compareLoad({mspt: null, loopP99: 1}, {mspt: 9, loopP99: 1}).ok, false);
});
