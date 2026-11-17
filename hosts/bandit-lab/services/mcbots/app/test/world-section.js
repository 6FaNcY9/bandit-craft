'use strict';
const assert = require('node:assert');
const s = require('../worldsection');
// single value
let b = s.encodeSection(['minecraft:air'], null);
assert.deepStrictEqual([...b.subarray(0, 4)], [1, 0, 1, 0]);
assert.deepStrictEqual(s.decodeSection(b), {palette: ['minecraft:air'], idx: null});
// 3 entries -> 2 bits, 1024 data bytes, LSB first
const idx = new Uint16Array(4096); idx[0] = 1; idx[1] = 2; idx[4095] = 2;
b = s.encodeSection(['minecraft:stone', 'a', 'b'], idx);
assert.strictEqual(b[1], 2);
assert.strictEqual(b[b.length - 1024], 0b1001);            // cell 0 = 1, cell 1 = 2
assert.strictEqual(b[b.length - 1] >> 6, 2);               // cell 4095
assert.deepStrictEqual(s.decodeSection(b).idx, idx);
// widths that cross byte borders, up to 12 bits
for (const n of [2, 17, 257, 4096]) {
  const pal = Array.from({length: n}, (_, i) => 't' + i), ix = Uint16Array.from({length: 4096}, (_, i) => i % n);
  const d = s.decodeSection(s.encodeSection(pal, ix));
  assert.deepStrictEqual(d.idx, ix); assert.strictEqual(d.palette.length, n);
}
assert.throws(() => s.decodeSection(Buffer.from([2, 0, 1, 0])), /bad section/);
assert.throws(() => s.decodeSection(b.subarray(0, b.length - 1)), /bad section/);
// cells and names
assert.strictEqual(s.cellIndex(1, 2, 3), (2 << 8) | (3 << 4) | 1);
assert.strictEqual(s.nameOf('minecraft:oak_stairs[facing=east]'), 'minecraft:oak_stairs');
assert.ok(s.isAir('minecraft:cave_air') && !s.isAir('minecraft:water[level=0]'));
// batch, negative coordinates
const blob = s.encodeSection(['minecraft:air'], null), hash = s.sectionHash(blob);
assert.strictEqual(hash.length, 8);
const recs = [{kind: 0, cx: -37, sy: -4, cz: -22, hash, blob}, {kind: 1, cx: 3, sy: 0, cz: 18}, {kind: 2, cx: -1, sy: 0, cz: 0}];
assert.deepStrictEqual(s.decodeBatch(s.encodeBatch({boot: 5n, batch: 7, records: recs})), {boot: 5n, batch: 7, records: recs});
assert.throws(() => s.decodeBatch(Buffer.from([9])), /bad batch/);
// corrupt input is refused, not half-read
const frame = s.encodeBatch({boot: 5n, batch: 7, records: recs});
assert.throws(() => s.decodeBatch(frame.subarray(0, frame.length - 1)), /bad batch/);
assert.throws(() => s.decodeBatch(Buffer.concat([frame, Buffer.from([0])])), /bad batch/);
assert.throws(() => s.decodeSection(Buffer.concat([s.encodeSection(['a', 'b', 'c'], idx).subarray(0, -1024), Buffer.alloc(1024, 0xff)])), /bad section/); // index 3 of 3
// golden fixture written by the Java encoder
const fx = s.decodeBatch(require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/world-sections.bin')));
assert.deepStrictEqual([fx.boot, fx.batch, fx.records.map((r) => [r.kind, r.cx, r.sy, r.cz])], [1n, 7, [[0, -17, 5, -2], [0, -1, -4, 0], [0, 3, 19, 18], [1, 40, 0, -41]]]);
assert.deepStrictEqual(s.decodeSection(fx.records[0].blob), {palette: ['minecraft:air'], idx: null});
const two = s.decodeSection(fx.records[1].blob);
assert.deepStrictEqual(two.palette, ['minecraft:stone', 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:redstone_lamp']);
assert.strictEqual(two.idx[s.cellIndex(1, 2, 3)], 1); assert.strictEqual(two.idx[4095], 2); assert.strictEqual(two.idx[0], 0);
const three = s.decodeSection(fx.records[2].blob);
assert.strictEqual(three.palette.length, 17); assert.strictEqual(fx.records[2].blob[1], 5); assert.strictEqual(three.idx[4095], 4095 % 17);
for (const r of fx.records.slice(0, 3)) {           // both encoders agree byte for byte
  const d = s.decodeSection(r.blob);
  assert.ok(s.encodeSection(d.palette, d.idx).equals(r.blob)); assert.ok(s.sectionHash(r.blob).equals(r.hash));
}
// the browser's copy is this same file: no require, no Buffer on the decode path
const vm = require('node:vm'), fs = require('node:fs');
const ctx = vm.createContext({TextDecoder}); ctx.self = ctx;
vm.runInContext(fs.readFileSync(require.resolve('../worldsection'), 'utf8'), ctx);
assert.strictEqual(typeof ctx.Buffer, 'undefined');
const bin = new Uint8Array(fs.readFileSync(`${__dirname}/fixtures/world-sections.bin`));
const web = ctx.OV.section.decodeBatch(bin), node = s.decodeBatch(Buffer.from(bin));
assert.strictEqual(web.records.length, 4);
web.records.forEach((r, i) => {
  const n = node.records[i];
  assert.deepStrictEqual([r.kind, r.cx, r.sy, r.cz], [n.kind, n.cx, n.sy, n.cz]);
  if (r.kind !== 0) return;
  const w = ctx.OV.section.decodeSection(r.blob), d = s.decodeSection(n.blob);
  assert.deepStrictEqual([[...w.palette], w.idx && Array.from(w.idx)], [d.palette, d.idx && Array.from(d.idx)]);
});
