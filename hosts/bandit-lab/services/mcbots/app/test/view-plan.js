'use strict';
const assert = require('node:assert');
const {planKey, plansOf, planGroups} = require('../public/oneview/planview.js');
assert.strictEqual(planKey('a.litematic', {x: -1, y: 64, z: 3}), 'a.litematic@-1,64,3');
assert.strictEqual(planKey('a.litematic', [-1, 64, 3]), 'a.litematic@-1,64,3');
assert.deepStrictEqual(plansOf({bot2: {type: 'schematic', file: 'a.litematic', origin: [1, 2, 3]}, bot1: {type: 'schematic', file: 'a.litematic', origin: [1, 2, 3], paused: true},
  bot3: {type: 'shaft'}, bot4: {type: 'schematic'}}), [{key: 'a.litematic@1,2,3', bot: 'bot1', file: 'a.litematic'}]);
// a stored project without an origin serialises as [null, null, null]: no plan
assert.deepStrictEqual(plansOf({bot5: {type: 'schematic', file: 'a.litematic', origin: [null, null, null]}}), []);
assert.deepStrictEqual(plansOf(undefined), []);
const reply = {file: 'a.litematic', origin: {x: 0, y: 64, z: 0}, seq: 7, palette: ['stone_bricks', 'glass'],
  blocks: [[0, 64, 0, 0, 1], [1, 64, 0, 0, 0], [0, 65, 0, 1, 0], [1, 65, 0, 0, 2], [-1, 66, -2, 1, 3], [0, 66, 0, 0, 1]]};
const g = planGroups(reply);
assert.deepStrictEqual(g.counts, {missing: 2, built: 2, wrong: 1, unknown: 1, total: 6});
assert.strictEqual(g.percent, 33);
assert.deepStrictEqual(g.box, {x1: -1, y1: 64, z1: -2, x2: 1, y2: 66, z2: 0});
assert.deepStrictEqual(g.groups.map((x) => [x.name, x.s, [...x.xyz]]),
  [['stone_bricks', 0, [1, 64, 0]], ['glass', 0, [0, 65, 0]], ['stone_bricks', 1, [0, 64, 0, 0, 66, 0]], [null, 2, [1, 65, 0]], [null, 3, [-1, 66, -2]]]);
const cut = planGroups(reply, 64);
assert.deepStrictEqual(cut.groups.map((x) => [x.name, x.s, x.xyz.length / 3]), [['stone_bricks', 0, 1], ['stone_bricks', 1, 1]]);
assert.deepStrictEqual(cut.counts, g.counts);
assert.strictEqual(planGroups({...reply, blocks: reply.blocks.map((b) => [...b.slice(0, 4), 1])}).percent, 100);
assert.deepStrictEqual([planGroups({...reply, blocks: []}).percent, planGroups({...reply, blocks: []}).box], [0, null]);
console.log('view-plan ok');
