'use strict';
const assert = require('node:assert');
const b = require('../public/oneview/blocks.js');
assert.strictEqual(b.nameOf('minecraft:oak_stairs[facing=east,half=bottom]'), 'oak_stairs');
assert.strictEqual(b.nameOf('stone'), 'stone');
for (const n of ['air', 'cave_air', 'short_grass', 'torch', 'oak_wall_sign', 'rail']) assert.ok(!b.drawn(n), n);
for (const n of ['stone', 'water', 'glass', 'oak_leaves', 'chest']) assert.ok(b.drawn(n), n);
assert.deepStrictEqual(b.rgb('stone'), [0x8a, 0x8a, 0x8a]);
assert.deepStrictEqual(b.rgb('glass'), [0xbf, 0xe8, 0xf5]);
assert.deepStrictEqual(b.rgb('dark_oak_planks'), [0x4a, 0x30, 0x18]);
const c = b.rgb('zzz_new_block');
assert.ok(c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
assert.deepStrictEqual(b.rgb('zzz_new_block'), c);
assert.strictEqual(require('../voxels').collect({x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 0}, () => 'torch').blocks.length, 0); // voxels.js still hides what blocks.js hides
console.log('view-blocks ok');
