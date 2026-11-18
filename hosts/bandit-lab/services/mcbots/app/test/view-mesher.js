'use strict';
const assert = require('node:assert');
const {meshSection} = require('../public/oneview/mesher.js');
const blocks = require('../public/oneview/blocks.js');
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
// a real drawn block above the cut darkens the lid (x 0.3); a lid over real air keeps its colour
const colSet = (r) => [...new Set(r.col)];
m = meshSection(STONE, S6, 8);
assert.ok(faces(m) === 256 && colSet(m).length === 1 && colSet(m)[0] === 41);
m = meshSection(one(3, 7, 5), A6, 8);
assert.deepStrictEqual(colSet(m).includes(138), true);
// capY 16 with a real neighbour above: the lid option forces the cut layer's top, dark under rock, normal under air
m = meshSection(STONE, [STONE, STONE, STONE, AIR, STONE, STONE], 16, {lid: true});
assert.ok(faces(m) === 256 && colSet(m).length === 1 && colSet(m)[0] === 138);
m = meshSection(STONE, S6, 16, {lid: true});
assert.ok(faces(m) === 256 && colSet(m).length === 1 && colSet(m)[0] === 41);
assert.strictEqual(meshSection(STONE, S6, 16), null);
// loose dirt: a dirt block with at most one drawn side neighbour is red and counted
const rgbAt = (r, f) => [...r.col.slice(f * 12, f * 12 + 3)];
const dirt = (x, y, z) => one(x, y, z, 'minecraft:dirt');
const mk = (list) => {
  const palette = ['minecraft:air'], idx = new Uint16Array(4096);
  for (const [x, y, z, s] of list) { let p = palette.indexOf(s); if (p < 0) p = palette.push(s) - 1; idx[(y << 8) | (z << 4) | x] = p; }
  return {palette, idx};
};
m = meshSection(dirt(3, 4, 5), A6);
assert.strictEqual(m.loose, 1);
assert.deepStrictEqual(rgbAt(m, 3), [255, 42, 42]);
m = meshSection(dirt(3, 4, 5), A6, 16, {loose: false});
assert.strictEqual(m.loose, 1);
assert.deepStrictEqual(rgbAt(m, 3), blocks.rgb('dirt'));
assert.strictEqual(meshSection(one(3, 4, 5), A6).loose, 0);
m = meshSection(mk([[5, 4, 5, 'minecraft:dirt'], [4, 4, 5, 'minecraft:stone'], [6, 4, 5, 'minecraft:stone']]), A6);
assert.strictEqual(m.loose, 0);
m = meshSection(mk([[5, 4, 5, 'minecraft:dirt'], [4, 4, 5, 'minecraft:stone'], [6, 4, 5, 'minecraft:stone']]), A6, 16, {loose: false});
assert.strictEqual(m.loose, 0);
// a section border looks into the neighbour; an unloaded neighbour counts as drawn (no red at the view's edge)
m = meshSection(mk([[0, 4, 5, 'minecraft:dirt'], [1, 4, 5, 'minecraft:stone']]), [null, AIR, AIR, AIR, AIR, AIR]);
assert.strictEqual(m.loose, 0);
m = meshSection(mk([[0, 4, 5, 'minecraft:dirt'], [1, 4, 5, 'minecraft:stone']]), A6);
assert.strictEqual(m.loose, 1);
// plants are not drawn, so they do not hold the dirt
m = meshSection(mk([[5, 4, 5, 'minecraft:dirt'], [6, 4, 5, 'minecraft:stone'], [4, 4, 5, 'minecraft:short_grass'], [5, 4, 4, 'minecraft:short_grass'], [5, 4, 6, 'minecraft:short_grass']]), A6);
assert.strictEqual(m.loose, 1);
// above the cut nothing is red and nothing is counted
m = meshSection(dirt(3, 10, 5), A6, 8);
assert.ok(!m || m.loose === 0);
m = meshSection(mk([[3, 4, 5, 'minecraft:dirt'], [3, 10, 5, 'minecraft:dirt']]), A6, 8);
assert.strictEqual(m.loose, 1);
console.log('view-mesher ok');
