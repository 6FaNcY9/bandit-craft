'use strict';
// Plan status: a schematic plan's cells against the world model, one gzipped answer per world change.
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const {writeLitematic} = require('../litematic-write');
const {parseState, cellStatus, makePlanStatus} = require('../planstatus');
const {TooBig, BadQuery} = require('../worldquery');
assert.deepStrictEqual(parseState('minecraft:oak_stairs[facing=east,half=bottom]'), {name: 'oak_stairs', props: {facing: 'east', half: 'bottom'}});
assert.deepStrictEqual(parseState('minecraft:stone'), {name: 'stone', props: {}});
const stairs = {name: 'oak_stairs', props: {facing: 'east', half: 'bottom'}};
assert.strictEqual(cellStatus(stairs, 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]'), 1);
assert.strictEqual(cellStatus(stairs, 'minecraft:oak_stairs[facing=west,half=bottom,shape=straight,waterlogged=false]'), 2);
assert.strictEqual(cellStatus(stairs, 'minecraft:stone'), 2);
for (const free of ['minecraft:air', 'minecraft:cave_air', 'minecraft:short_grass', 'minecraft:water[level=3]', 'minecraft:lava[level=0]']) assert.strictEqual(cellStatus(stairs, free), 0, free);
assert.strictEqual(cellStatus({name: 'cobblestone', props: {}, anySolid: true}, 'minecraft:deepslate'), 1);
assert.strictEqual(cellStatus({name: 'redstone_lamp', props: {}}, 'minecraft:redstone_lamp'), 1); // the model strips lit and powered
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const write = (names) => fs.writeFileSync(path.join(dir, 'p.litematic'), writeLitematic({name: 'p', regions: [{position: {x: 0, y: 0, z: 0}, size: {x: 17, y: 1, z: 17},
    blocks: [[0, 0], [1, 0], [2, 0], [16, 0], [0, 16]].map(([x, z], i) => ({x, y: 0, z, name: names[i] || 'stone_bricks'}))}]}));
  write([]);
  // chunk 0,0 known: x 0 stone_bricks, x 1 air, x 2 dirt at y 64; chunk 1,0 ungenerated; everything else unknown
  const idx = new Uint16Array(4096); idx[0] = 1; idx[2] = 2;
  const SEC = {palette: ['minecraft:air', 'minecraft:stone_bricks', 'minecraft:dirt'], idx}, AIR = {palette: ['minecraft:air'], idx: null};
  const src = {chunk: (cx, cz) => (cx === 0 && cz === 0 ? 'known' : cx === 1 ? 'ungenerated' : 'unknown'), section: (cx, sy) => (sy === 4 ? SEC : AIR)};
  let seq = 5, reads = 0;
  const readFile = (f) => { reads++; return fs.promises.readFile(f); };
  const status = makePlanStatus({src, seq: () => seq, readFile});
  const args = {dir, file: 'p.litematic', origin: {x: 0, y: 64, z: 0}, rotation: 0, mirror: 'none', substitute: {}, anySolid: []};
  const open = (buf) => JSON.parse(zlib.gunzipSync(buf));
  const [b1, b2] = await Promise.all([status(args), status(args)]);              // two viewers, one computation
  assert.ok(b1 === b2 && reads === 1);
  const j = open(b1);
  assert.deepStrictEqual([j.file, j.origin, j.seq, j.palette, j.counts], ['p.litematic', {x: 0, y: 64, z: 0}, 5, ['stone_bricks'], [1, 1, 1, 2]]);
  assert.deepStrictEqual(j.blocks.sort((p, q) => p[0] - q[0] || p[2] - q[2]), [[0, 64, 0, 0, 1], [0, 64, 16, 0, 3], [1, 64, 0, 0, 0], [2, 64, 0, 0, 2], [16, 64, 0, 0, 3]]); // unknown, never missing
  assert.strictEqual(await status(args), b1);
  seq = 6; const b3 = await status(args);
  assert.ok(b3 !== b1 && open(b3).seq === 6 && reads === 1, 'a world change computes again, the parsed file stays');
  assert.deepStrictEqual(open(await status({...args, substitute: {stone_bricks: 'cobblestone'}})).counts, [1, 0, 2, 2]);
  write(['glass']); fs.utimesSync(path.join(dir, 'p.litematic'), new Date(), new Date(Date.now() + 5000)); // replaced under its name
  assert.deepStrictEqual(open(await status(args)).palette, ['glass', 'stone_bricks']);
  await assert.rejects(makePlanStatus({src, seq: () => 1, maxCells: 3})(args), TooBig);
  await assert.rejects(status({...args, file: '../p.litematic'}), BadQuery);
  await assert.rejects(status({...args, origin: {x: 0.5, y: 64, z: 0}}), BadQuery);
  fs.rmSync(path.join(dir, 'p.litematic'));
  assert.strictEqual(await status(args), null);                                  // file gone
  fs.rmSync(dir, {recursive: true, force: true});
  console.log('plan-status: ok');
})().catch((e) => { console.error(e); process.exit(1); });
