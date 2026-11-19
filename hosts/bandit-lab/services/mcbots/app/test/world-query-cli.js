'use strict';
// world-query.js, the laptop CLI: pure parts only, offline fixtures (the hub's own world query is test/world-query.js).
const assert = require('node:assert');
const zlib = require('node:zlib');
const wq = require('../world-query');

// not-full rule and plan state matching
assert.ok(wq.notFull('minecraft:poppy') && wq.notFull('minecraft:oak_leaves[persistent=true]') && wq.notFull('minecraft:water[level=0]'));
assert.ok(wq.notFull('minecraft:stone_slab[type=bottom]') && !wq.notFull('minecraft:stone_slab[type=double]'));
assert.ok(!wq.notFull('minecraft:stone') && !wq.notFull('minecraft:grass_block[snowy=false]') && !wq.notFull('minecraft:snow_block'));
assert.ok(wq.notFull('minecraft:snow[layers=1]') && wq.notFull('minecraft:short_grass') && wq.notFull('minecraft:wall_torch[facing=east]'));
assert.ok(wq.sameState('minecraft:oak_stairs[facing=east,half=bottom]', 'minecraft:oak_stairs[facing=east]'));
assert.ok(!wq.sameState('minecraft:oak_stairs[facing=west,half=bottom]', 'minecraft:oak_stairs[facing=east]'));

// args: negative numbers are values, not flags
assert.deepStrictEqual(wq.parseArgs(['map', '-300', '-40', '-269', '-9', '--step', '2']), {pos: ['map', '-300', '-40', '-269', '-9'], flags: {step: '2'}});

// glyphs: one per full state; a fixed glyph goes to the most common matching state, the next state gets a letter
const stats = new Map();
for (const [s, n] of [['minecraft:grass_block[snowy=false]', 5], ['minecraft:grass_block[snowy=true]', 1], ['minecraft:stone', 3], ['minecraft:poppy', 2]]) for (let i = 0; i < n; i++) wq.tally(stats, s, 60 + i);
const g = wq.glyphs(stats);
assert.strictEqual(g.get('minecraft:grass_block[snowy=false]'), ',');
assert.strictEqual(g.get('minecraft:stone'), '#');
assert.strictEqual(new Set(g.values()).size, g.size);
assert.match(g.get('minecraft:grass_block[snowy=true]'), /^[A-Za-z]$/);
assert.ok(wq.legend(stats, g, {'.': 0, '?': 2, '-': 0}).includes('#  minecraft:stone  3  y=60..62'));

// grid: rows start with the absolute value, header labels right-aligned on their column, never touching
const rows = wq.grid('z', [-40, -39], [-300, -299, -298, -297, -296], [['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j']], 1);
assert.strictEqual(rows[2], 'z= -40 |abcde');
assert.strictEqual(rows[0].indexOf('-300') + 3, 'z= -40 |'.length); // ends on column 0
assert.strictEqual(rows[1].indexOf('-296') + 3, 'z= -40 |'.length + 4);
const wide = wq.grid('z', [0], [100, 101, 102, 103, 104], [['100 ', '101 ', '102 ', '103 ', '104 ']], 4);
assert.strictEqual(wide[0].indexOf('104'), wide[1].indexOf('104')); // label sits on the digits

// map: an unknown chunk is ?? / ?, never air; a stepped cell is the maximum; ' marks a top that is not full
const world = (x, z) => (x >= 16 ? {y: null, state: null, st: 'unknown'} : {y: 60 + x, state: x === 3 ? 'minecraft:poppy' : 'minecraft:stone', st: 'known'});
const cells = wq.mapCells(world, 0, 0, 17, 1, 1);
assert.deepStrictEqual(cells[0][16], {k: '?'});
const text = wq.renderMap(cells, {x1: 0, z1: 0, x2: 17, z2: 1, step: 1}, wq.cornersText(world, 0, 0, 17, 1));
const lines = text.split('\n');
assert.strictEqual(lines[0], 'map x=0..17 z=0..1 (inclusive, 18x2) north=up east=right step=1');
assert.strictEqual(lines[1], 'NW(0,0) y=60 stone | NE(17,0) ?? | SW(0,1) y=60 stone | SE(17,1) ??');
const hrow = lines.find((l) => l.startsWith('z=   0 |'));
assert.ok(hrow.includes(" 63' 64 ") && hrow.endsWith(' ??  ??') && !/\./.test(hrow.slice(8)));
assert.ok(text.includes('?  unknown chunk (never air)  4'));
const stepped = wq.mapCells(world, 0, 0, 7, 1, 4);
assert.deepStrictEqual(stepped[0].map((c) => c.y), [63, 67]);
assert.ok(wq.renderMap(stepped, {x1: 0, z1: 0, x2: 7, z2: 1, step: 4}, '').startsWith('map x=0..7 z=0..1 (inclusive, 8x2) north=up east=right step=4 cell=max, NOT for placement'));

// a block box fixture: stone at y 60 for x 0..3, an oak stair on top of x 1, chunk x 16.. unknown
const box = {unknown: new Set(['1,0']), ungen: new Set(),
  st: (x) => (x >= 16 ? 'unknown' : 'known'),
  at: (x, y) => (y === 60 && x <= 3 ? 'minecraft:stone' : y === 61 && x === 1 ? 'minecraft:oak_stairs[facing=east]' : null)};
const cut = wq.renderCut(box, {x1: 0, y1: 60, z1: 0, x2: 17, y2: 61, z2: 0}, 'z', '').split('\n');
assert.strictEqual(cut[2], 'section at z=0, looking north, east=right, highest y at the top');
assert.strictEqual(cut.find((l) => l.startsWith('y=  61')), 'y=  61 |./..............??');
assert.strictEqual(cut.find((l) => l.startsWith('y=  60')), 'y=  60 |####............??');
assert.deepStrictEqual(wq.cellLines(box, {x1: 0, y1: 60, z1: 0, x2: 17, y2: 61, z2: 0}), [
  '?? chunk 1,0 x=16..17 z=0..0 y=60..61 unknown, never air', '0..3 60 0 minecraft:stone', '1 61 0 minecraft:oak_stairs[facing=east]']);
assert.deepStrictEqual(wq.cellLines(box, {x1: 0, y1: 60, z1: 0, x2: 15, y2: 61, z2: 0}, 'stairs'), ['1 61 0 minecraft:oak_stairs[facing=east]']);

// check: into air, same, REPLACE, unknown, unsupported, overlaps
const plan = {set: [[0, 61, 0, 'minecraft:stone'], [1, 61, 0, 'minecraft:oak_stairs[facing=east]'], [2, 60, 0, 'minecraft:dirt'], [5, 62, 0, 'minecraft:stone'], [20, 60, 0, 'minecraft:stone']], remove: [[3, 60, 0], [4, 60, 0]]};
const r = wq.comparePlan(plan, box, [{file: 'a.litematic', blocks: [[0, 61, 0, 0, 0], [9, 9, 9, 0, 1]]}]);
assert.deepStrictEqual([r.intoAir, r.same, r.replace.length, r.unknown.length, r.present, r.alreadyAir, r.unsupported], [2, 1, 1, 1, 1, 1, 2]); // unsupported: 2 60 0 (air at y 59) and 5 62 0
assert.deepStrictEqual(r.overlaps, [['a.litematic', 1]]);

// placed plans: bot projects parsed from the summary, sites kept only when the hub has the file, no duplicates
const schematics = [{file: 'a.litematic', size: {x: 4, y: 3, z: 2}, offset: {x: 0, y: 0, z: 0}}];
const list = wq.siteList({bot21: {type: 'produce', summary: 'a.litematic origin -291 113 13 0 none 0 chests store -302 111 6'}, bot3: {type: 'wheatfarm', summary: '-262 -250 -254 -242 65'}},
  [{file: 'a.litematic', origin: [-291, 113, 13]}, {file: 'gone.litematic', origin: [0, 0, 0]}], schematics);
assert.deepStrictEqual(list.map((p) => [p.file, p.src, p.q]), [['a.litematic', 'bot21 produce', {file: 'a.litematic', origin: '-291,113,13'}]]);

// imported area edge
assert.deepStrictEqual(wq.edgeDistance(-270, -20, -270, -20), {far: 320, near: 320});
assert.ok(wq.edgeDistance(100, 0, 110, 10).far < 0);

// png: valid signature, chunk CRCs, pixels inflate back; unknown is magenta-hatched
const img = wq.drawMap((x, z) => (x >= 16 ? {y: null, state: null, st: 'unknown'} : {y: 60 + z, state: 'minecraft:grass_block', st: 'known'}), {x1: 0, z1: 0, x2: 17, z2: 15}, []);
const png = wq.encodePng(img.w, img.h, img.rgb);
assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
for (let o = 8; o < png.length;) {
  const n = png.readUInt32BE(o);
  assert.strictEqual(png.readUInt32BE(o + 8 + n), zlib.crc32(png.subarray(o + 4, o + 8 + n)));
  if (png.toString('latin1', o + 4, o + 8) === 'IDAT') assert.strictEqual(zlib.inflateSync(png.subarray(o + 8, o + 8 + n)).length, (img.w * 3 + 1) * img.h);
  o += 12 + n;
}
let magenta = 0;
for (let i = 0; i < img.rgb.length; i += 3) if (img.rgb[i] === 255 && img.rgb[i + 1] === 0 && img.rgb[i + 2] === 255) magenta++;
assert.ok(magenta > 0);

// overflow hint: the same command, smaller
assert.strictEqual(wq.shrink('cut', ['-300', '100', '13', '-237', '400', '13'], 4 * wq.MAX_OUT), '-300 100 13 -275 224 13');
console.log('world-query-cli: ok');
