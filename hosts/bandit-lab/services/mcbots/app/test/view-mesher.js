'use strict';
const assert = require('node:assert');
const {meshSection} = require('../public/oneview/mesher.js');
const AIR = {palette: ['minecraft:air'], idx: null}, STONE = {palette: ['minecraft:stone'], idx: null};
const A6 = [AIR, AIR, AIR, AIR, AIR, AIR], S6 = [STONE, STONE, STONE, STONE, STONE, STONE];
const one = (x, y, z, state = 'minecraft:stone') => { const idx = new Uint16Array(4096); idx[(y << 8) | (z << 4) | x] = 1; return {palette: ['minecraft:air', state], idx}; };
const faces = (m) => (m ? m.idx.length / 6 : 0);
// one block: 6 faces, every triangle looks away from the block's centre, four brightness steps
let m = meshSection(one(3, 4, 5), A6);
assert.deepStrictEqual([m.pos.length, m.col.length, m.idx.length], [72, 72, 36]);
for (let t = 0; t < 36; t += 3) {
  const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.pos[m.idx[t + k] * 3 + j]));
  const u = b.map((v, j) => v - a[j]), w = c.map((v, j) => v - a[j]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  assert.ok(n[0] * (a[0] - 3.5) + n[1] * (a[1] - 4.5) + n[2] * (a[2] - 5.5) > 0, 'triangle ' + t / 3);
}
assert.deepStrictEqual([...new Set(m.col)].sort((p, q) => p - q), [69, 90, 110, 138]);
// buried: nothing. Nothing loaded around: only the top. One open side: only that side.
assert.strictEqual(meshSection(STONE, S6), null);
assert.strictEqual(faces(meshSection(STONE, [null, null, null, null, null, null])), 256);
assert.strictEqual(faces(meshSection(STONE, [AIR, null, null, STONE, null, null])), 256);
// border cells look into the neighbour
assert.strictEqual(faces(meshSection(one(0, 4, 5), [STONE, AIR, AIR, AIR, AIR, AIR])), 5);
assert.strictEqual(faces(meshSection(one(15, 15, 15), [AIR, STONE, AIR, STONE, AIR, STONE])), 3);
// what is not drawn makes no face and hides none
assert.strictEqual(meshSection(one(1, 1, 1, 'minecraft:short_grass'), A6), null);
assert.strictEqual(faces(meshSection(one(0, 4, 5), [{palette: ['minecraft:torch'], idx: null}, AIR, AIR, AIR, AIR, AIR])), 6);
// the height cut puts a lid on the cut layer
assert.strictEqual(faces(meshSection(STONE, S6, 8)), 256);
assert.strictEqual(meshSection(one(3, 9, 5), A6, 8), null);
assert.strictEqual(meshSection(STONE, A6, 0), null);
// worst case (3D checkerboard) fits 16-bit indices
const chk = new Uint16Array(4096); for (let i = 0; i < 4096; i++) chk[i] = ((i & 15) + ((i >> 4) & 15) + (i >> 8)) & 1;
m = meshSection({palette: ['minecraft:air', 'minecraft:stone'], idx: chk}, A6);
assert.ok(faces(m) === 12288 && m.idx instanceof Uint16Array && m.pos.length === 12288 * 12);
console.log('view-mesher ok');
