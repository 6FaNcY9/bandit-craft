'use strict';
const assert = require('node:assert');
const {cellIndex} = require('../worldsection');
const {makeQuery, parseBox, parseRect, BadQuery, TooBig, LIMITS} = require('../worldquery');

// chunk (-1, 0) known: stone y 0..63, an oak stair at world (-1, 64, 0), air elsewhere; (0, 0) unknown; (1, 0) ungenerated.
const AIR = {palette: ['minecraft:air'], idx: null}, STONE = {palette: ['minecraft:stone'], idx: null};
const stairIdx = new Uint16Array(4096); stairIdx[cellIndex(15, 0, 0)] = 1;
const STAIR = {palette: ['minecraft:cave_air', 'minecraft:oak_stairs[facing=east]'], idx: stairIdx};
const sections = new Map(), chunks = new Map([['-1,0', 'known'], ['1,0', 'ungenerated']]);
for (let sy = -4; sy <= 19; sy++) sections.set(`-1,${sy},0`, sy >= 0 && sy <= 3 ? STONE : sy === 4 ? STAIR : AIR);
const src = {section: (cx, sy, cz) => sections.get(`${cx},${sy},${cz}`) || null, chunk: (cx, cz) => chunks.get(`${cx},${cz}`) || 'unknown'};
const q = makeQuery(src);

const r = q.blocks({x1: -2, y1: 63, z1: 0, x2: 17, y2: 65, z2: 0});
assert.deepStrictEqual(r.unknown, [[0, 0]]); assert.deepStrictEqual(r.ungenerated, [[1, 0]]);
assert.ok(r.blocks.every(([x]) => x < 0));                                  // nothing from unknown chunks
assert.deepStrictEqual(r.blocks.find(([x, y]) => x === -1 && y === 64), [-1, 64, 0, r.palette.indexOf('minecraft:oak_stairs[facing=east]')]);
assert.strictEqual(r.blocks.length, 2 + 1);                                 // stone at x -2 and -1 (y 63), the stair; air left out
assert.deepStrictEqual(r.box, {x1: -2, y1: 63, z1: 0, x2: 17, y2: 65, z2: 0});
const h = q.height({x1: -2, z1: 0, x2: 1, z2: 0});
assert.deepStrictEqual(h.heights, [63, 64, null, null]);
assert.strictEqual(h.tops[2], -1);
assert.deepStrictEqual([h.palette[h.tops[0]], h.palette[h.tops[1]]], ['minecraft:stone', 'minecraft:oak_stairs[facing=east]']);
assert.deepStrictEqual([h.unknown, h.ungenerated], [[[0, 0]], []]);          // x -2..1 never reaches chunk 1
assert.deepStrictEqual(q.materials({x1: -16, y1: -64, z1: 0, x2: -1, y2: 319, z2: 15}).counts, {'minecraft:stone': 16 * 16 * 64, 'minecraft:oak_stairs': 1});
assert.throws(() => q.blocks({x1: 0, y1: 0, z1: 0, x2: 32, y2: 31, z2: 31}), TooBig);        // 33*32*32
assert.doesNotThrow(() => q.blocks({x1: -32, y1: 0, z1: 0, x2: -1, y2: 31, z2: 31}));        // exactly 32,768
assert.throws(() => q.height({x1: 0, z1: 0, x2: 128, z2: 0}), TooBig);
assert.throws(() => q.materials({x1: 0, y1: -64, z1: 0, x2: 127, y2: 319, z2: 127}), TooBig); // 6.3M
assert.throws(() => parseBox({x1: '1', y1: '0', z1: '0', x2: 'NaN', y2: '0', z2: '0'}), BadQuery);
assert.throws(() => parseBox({x1: '0', y1: '-65', z1: '0', x2: '0', y2: '0', z2: '0'}), BadQuery);
assert.deepStrictEqual(parseBox({x1: '5', y1: '9', z1: '0', x2: '-5', y2: '0', z2: '0'}), {x1: -5, y1: 0, z1: 0, x2: 5, y2: 9, z2: 0});
assert.deepStrictEqual(parseRect({x1: '5', z1: '3', x2: '-5', z2: '9'}), {x1: -5, z1: 3, x2: 5, z2: 9});
assert.throws(() => parseRect({x1: '1', z1: '', x2: '2', z2: '3'}), BadQuery);               // empty is not 0
assert.throws(() => parseRect({x1: '1.5', z1: '0', x2: '2', z2: '3'}), BadQuery);
assert.throws(() => parseRect({x1: '0', z1: '0', x2: '99999999', z2: '3'}), BadQuery);
assert.deepStrictEqual(LIMITS, {blocks: 32768, height: 128, materials: 2000000});

// negative chunk edges: x -16 is the first cell of chunk -1, x -17 the last of chunk -2 (unknown here)
const e = q.blocks({x1: -17, y1: 0, z1: 0, x2: -16, y2: 0, z2: 0});
assert.deepStrictEqual([e.unknown, e.blocks.map(([x]) => x)], [[[-2, 0]], [-16]]);

// a known chunk with a missing section in range is reported unknown as a whole, never read as air
sections.delete('-1,2,0');
const m = q.blocks({x1: -16, y1: 0, z1: 0, x2: -1, y2: 70, z2: 0});
assert.deepStrictEqual([m.blocks.length, m.unknown], [0, [[-1, 0]]]);
assert.deepStrictEqual(q.height({x1: -1, z1: 0, x2: -1, z2: 0}).heights, [null]);
assert.deepStrictEqual(q.materials({x1: -16, y1: 100, z1: 0, x2: -1, y2: 110, z2: 0}).unknown, []); // box above the hole: fine
console.log('world-query: ok');
