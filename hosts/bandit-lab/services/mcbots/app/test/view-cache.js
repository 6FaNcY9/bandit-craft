'use strict';
const assert = require('node:assert');
const {makeCache} = require('../public/oneview/worldcache.js');
// One known column as decodeBatch plus the worker would give it: 24 sections, sy -4..19.
const col = (cx, cz, h = 1) => Array.from({length: 24}, (_, i) => ({kind: 0, cx, sy: i - 4, cz, hash: Uint8Array.of(h, 0, 0, 0, 0, 0, 0, 0), sec: {palette: ['minecraft:stone'], idx: null}}));
const tile = (req, h) => { const out = []; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push(...col(req.cx + dx, req.cz + dz, h)); return out; };
const load = (c) => { for (let x; (x = c.next());) c.done(x.id, tile(x)); };

// 1 negative tiles, two in flight
let c = makeCache({viewR: 1}); c.setView(-16, -1);               // four tiles in view; the view's own tile comes first
const a = c.next(); assert.deepStrictEqual([a.cx, a.cz, a.r], [-17, -2, 1]);
assert.ok(c.next() !== null); assert.strictEqual(c.next(), null);
// 2 first tile: 9 columns, 216 sections to mesh
let r = c.done(a.id, tile(a)); assert.deepStrictEqual([r.mesh.length, r.chunks.length, c.size()], [216, 9, 9]);
// 3 a tile beside it meshes the 3 touching columns again
c = makeCache({viewR: 0}); c.setView(-17, -2); r = c.done(c.next().id, tile({cx: -17, cz: -2}));
c.setView(-14, -2); const b = c.next(); assert.deepStrictEqual([b.cx, b.cz], [-14, -2]);
assert.strictEqual(c.done(b.id, tile(b)).mesh.length, 216 + 72);
// 4 same hash: nothing; one changed section: itself and its 6 neighbours
c = makeCache({viewR: 1}); c.setView(-17, -2); load(c);
c.onSeq(40); assert.strictEqual(c.onSeq(41), 'changes');
c.changes({seq: 41, sections: [[-17, 0, -2], [99, 0, 99]], more: false}, 41);
const q = c.next(); assert.deepStrictEqual([q.cx, q.cz, q.r, c.seq()], [-17, -2, 0, 41]);
assert.strictEqual(c.done(q.id, col(-17, -2)).mesh.length, 0);
c.changes({seq: 42, sections: [[-17, 0, -2]], more: false}, 42);
const ch = col(-17, -2); ch[4].hash = Uint8Array.of(9, 0, 0, 0, 0, 0, 0, 0);      // sy 0
assert.strictEqual(c.done(c.next().id, ch).mesh.length, 7);
// 5 unknown is a state, not sections
c.changes({seq: 43, sections: [[-17, 0, -2]], more: false}, 43);
r = c.done(c.next().id, [{kind: 2, cx: -17, sy: 0, cz: -2}]);
assert.deepStrictEqual(r.chunks, [[-17, -2, 2]]); assert.strictEqual(c.section(-17, 0, -2), null);
// 6 Review Focus 1: a walk across the whole area never holds more than 225 columns at viewR 5
c = makeCache({viewR: 5});
for (let cx = -37; cx <= 3; cx++) { c.setView(cx, -2); load(c); c.evict(); assert.ok(c.size() <= 225, 'at ' + cx); }
assert.strictEqual(c.section(-37, 0, -2), null);
// 7 Review Focus 2 and 3: seq 0 is ignored, a long gap resyncs by tile, a lower seq resets
c = makeCache({viewR: 1}); c.setView(0, 0); load(c); const tiles = c.size() / 9;
assert.deepStrictEqual([c.onSeq(0), c.onSeq(40), c.onSeq(40), c.onSeq(0)], [null, null, null, null]);
c.changes({seq: 500, sections: [[0, 0, 0]], more: true}, 900);
assert.strictEqual(c.seq(), 900);
let n = 0; for (let x; (x = c.next());) { assert.strictEqual(x.r, 1); c.done(x.id, tile(x)); n++; } assert.strictEqual(n, tiles);
assert.deepStrictEqual([c.onSeq(30), c.size(), c.seq()], ['reset', 0, 30]);
// 8 Review Focus 2: a failed tile waits 2 s, 4 s … 30 s; others go on
let t = 0; c = makeCache({viewR: 0, now: () => t}); c.setView(0, 0);
let f = c.next(); c.fail(f.id); assert.strictEqual(c.next(), null);
t = 1999; assert.strictEqual(c.next(), null); t = 2000; f = c.next(); assert.ok(f); c.fail(f.id);
t = 5999; assert.strictEqual(c.next(), null); t = 6000; f = c.next(); assert.ok(f);
for (let i = 0; i < 8; i++) { c.fail(f.id); t += 30000; f = c.next(); assert.ok(f, 'never more than 30 s'); }
// 9 a failed tile does not hold the others back
c = makeCache({viewR: 1, now: () => 0}); c.setView(-16, -1); c.fail(c.next().id);
n = 0; for (let x; (x = c.next());) { c.done(x.id, tile(x)); n++; } assert.strictEqual(n, 3);
// 10 a change that lands while a tile flies is not lost: the tile is fetched again
c = makeCache({viewR: 0}); c.setView(-17, -2); const w = c.next();
c.changes({seq: 5, sections: [[-17, 0, -2]], more: false}, 5); c.done(w.id, tile(w));
const w2 = c.next(); assert.deepStrictEqual([w2.r, w2.cx, w2.cz], [1, -17, -2]); c.done(w2.id, tile(w2)); assert.strictEqual(c.next(), null);
// 11 neighbours come in the mesher's order, null where nothing is loaded; evict hands back every column of a far tile
const sec = (x, y, z) => c.section(x, y, z);
const want = [sec(-18, 0, -2), sec(-16, 0, -2), sec(-17, -1, -2), sec(-17, 1, -2), sec(-17, 0, -3), sec(-17, 0, -1)];
c.neighbours(-17, 0, -2).forEach((s, i) => assert.ok(s && s === want[i], "nb " + i)); // identity: every section is a separate object
assert.deepStrictEqual([c.neighbours(-18, -4, -3)[2], c.neighbours(-18, -4, -3)[0], c.loaded().length], [null, null, 216]);
c.setView(0, 0); assert.strictEqual(c.evict().length, 9); assert.strictEqual(c.size(), 0);
