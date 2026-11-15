'use strict';
// Castle modules (app/castle, spec docs/superpowers/specs/2026-11-15-wizard-castle-design.md).
const assert = require('node:assert/strict');
const {warehouse, ROWS} = require('../castle/warehouse.js');

const w = warehouse();
const at = new Map(w.blocks.map((b) => [`${b.x},${b.y},${b.z}`, b]));
// size and limits (a schematic job takes at most 32 x 24 x 32)
assert.deepEqual(w.size, {x: 19, y: 12, z: 18});
assert.ok(w.blocks.every((b) => b.x >= 0 && b.x < 19 && b.y >= 0 && b.y < 12 && b.z >= 0 && b.z < 18));
// rowsStayEmpty: the chest rows (RCON clones land there) and the cell above each chest (its lid) stay free
for (const r of ROWS) for (let x = r.x1; x <= r.x2; x++) for (let y = r.y1; y <= r.y2 + 1; y++) assert.ok(!at.has(`${x},${y},${r.z}`), `row cell ${x},${y},${r.z}`);
// doorway open, stairs east, lanterns hang
assert.ok(!at.has('18,1,4') && !at.has('18,2,4'));
assert.equal(w.blocks.filter((b) => b.name === 'spruce_stairs' && b.props.facing === 'east').length, 5);
assert.equal(w.blocks.filter((b) => b.name === 'lantern' && b.props.hanging === 'true').length, 18);
// palette: bot-gatherable only
const OK = /^(cobblestone|deepslate_bricks|polished_deepslate|deepslate_tiles|spruce_planks|spruce_stairs|glass|lantern)$/;
assert.ok(w.blocks.every((b) => OK.test(b.name)), [...new Set(w.blocks.map((b) => b.name))].join());

// A3b armoury and A3a barracks (spec 2026-11-15-castle-armoury-design.md): one 9 x 8 x 11 shell, furniture by RCON
const AR = require('../castle/armoury.js');
const arm = AR.armoury(), bar = AR.barracks();
const has = (m) => { const at2 = new Set(m.blocks.map((x) => `${x.x},${x.y},${x.z}`)); return (x, y, z) => at2.has(`${x},${y},${z}`); };
for (const m of [arm, bar]) {
  assert.deepEqual(m.size, {x: 9, y: 8, z: 11});
  assert.ok(m.blocks.every((x) => x.x >= 0 && x.x < 9 && x.y >= 0 && x.y < 8 && x.z >= 0 && x.z < 11));
  assert.equal(m.blocks.filter((x) => x.name === 'glass').length, 7);
  const lan = m.blocks.filter((x) => x.name === 'lantern');
  assert.deepEqual(lan.map((x) => `${x.x},${x.y},${x.z}`).sort(), ['2,5,3', '2,5,7', '6,5,3', '6,5,7']);
  assert.ok(lan.every((x) => x.props.hanging === 'true' && has(m)(x.x, 6, x.z)), 'hanging under the roof');
  const PAL = /^(cobblestone|deepslate_bricks|cobbled_deepslate|polished_deepslate|deepslate_tiles|stone_bricks|glass|lantern)$/;
  assert.ok(m.blocks.every((x) => PAL.test(x.name)), [...new Set(m.blocks.map((x) => x.name))].join());
}
assert.ok(!has(arm)(8, 1, 5) && !has(arm)(8, 2, 5), 'armoury doorway east, to the main axis');
assert.ok(!has(bar)(4, 1, 10) && !has(bar)(4, 2, 10), 'barracks doorway south');
assert.ok(has(arm)(4, 1, 10) && has(bar)(8, 1, 5), 'each has only its own door');
const O = {x: -323, y: 104, z: -30}, chests = AR.FURNITURE.filter((f) => f.name === 'chest');
assert.equal(chests.length, 10);
assert.ok(chests.every((c) => Math.hypot(c.x + 0.5 - (-322 + 0.5), c.y - 105, c.z - (-26)) <= 6), 'all within rearm reach of the gear point');
for (const f of AR.FURNITURE) {
  assert.ok(!has(arm)(f.x - O.x, f.y - O.y, f.z - O.z), `furniture cell ${f.x} ${f.y} ${f.z} is free`);
  if (f.name === 'chest') assert.ok(!has(arm)(f.x - O.x, f.y + 1 - O.y, f.z - O.z), `lid of ${f.x} ${f.y} ${f.z} is free`);
}
// pairs: a 'left' half joins its clockwise neighbour (facing east: the one to the south, z + 1)
const iron = chests.filter((c) => c.x === -322 && (c.z === -26 || c.z === -25));
assert.deepEqual(iron.map((c) => [c.z, c.props.facing, c.props.type]), [[-26, 'east', 'left'], [-25, 'east', 'right']]);
const cmds = AR.furnitureCommands();
assert.equal(cmds.length, 12);
assert.ok(cmds.includes('setblock -322 105 -26 minecraft:chest[facing=east,type=left]'), cmds[0]);
assert.ok(cmds.includes('setblock -317 105 -21 minecraft:crafting_table'));

{ // K1 sorter shell: never inside the sorter or its air gap, every cell in exactly one module, openings free
  const {shell, shellModule, MODULES, SORTER, inBox} = require('../castle/shell.js');
  const cells = shell(), key = (x, y, z) => `${x},${y},${z}`, has = new Set(cells.map((b) => key(b.x, b.y, b.z)));
  assert.ok(!MODULES.some((m) => m.x1 <= SORTER.x2 && m.x2 >= SORTER.x1 && m.y1 <= SORTER.y2 && m.y2 >= SORTER.y1 && m.z1 <= SORTER.z2 && m.z2 >= SORTER.z1), 'a module box overlaps the sorter');
  assert.ok(cells.every((b) => !inBox(SORTER, b.x, b.y, b.z)));
  assert.ok(!cells.some((b) => b.y <= 129 && ((b.x === -294 && b.z >= 10 && b.z <= 50) || (b.z === 10 && b.x >= -308 && b.x <= -294))), 'air gap');
  assert.ok(!MODULES.some((m) => m.x1 <= -294 && m.x2 >= -294 && m.z1 <= 50 && m.z2 >= 10 && m.y1 <= 129), 'no module over the east gap');
  for (const m of MODULES) assert.ok(m.x2 - m.x1 < 32 && m.y2 - m.y1 < 24 && m.z2 - m.z1 < 32, `${m.id} too big`);
  for (const b of cells) assert.equal(MODULES.filter((m) => inBox(m, b.x, b.y, b.z)).length, 1, `cell ${key(b.x, b.y, b.z)}`);
  for (let i = 0; i < MODULES.length; i++) for (let j = i + 1; j < MODULES.length; j++) {
    const a = MODULES[i], c = MODULES[j];
    assert.ok(!(a.x1 <= c.x2 && a.x2 >= c.x1 && a.y1 <= c.y2 && a.y2 >= c.y1 && a.z1 <= c.z2 && a.z2 >= c.z1), `${a.id} overlaps ${c.id}`);
  }
  // openings: north door, chest front x -309 above the gallery floor, west slits, gap z 51 above the fill, bee nest
  for (const x of [-311, -310]) for (let y = 116; y <= 118; y++) for (const z of [8, 9]) assert.ok(!has.has(key(x, y, z)), 'north door');
  for (let z = 10; z <= 50; z++) for (let y = 116; y <= 129; y++) assert.ok(!has.has(key(-309, y, z)), `chest front -309 ${y} ${z}`);
  for (const z of [15, 21, 27, 33, 39, 45]) assert.ok(!has.has(key(-312, 122, z)) && cells.some((b) => b.x === -313 && b.y === 122 && b.z === z && b.name === 'iron_bars'));
  assert.ok(!has.has(key(-309, 114, 12)), 'bee nest');
  assert.ok(cells.some((b) => b.x === -302 && b.y === 120 && b.z === 51), 'button platform');
  // every lantern stands on or hangs from a block
  for (const b of cells.filter((c) => c.name === 'lantern')) assert.ok(has.has(key(b.x, b.props.hanging === 'true' ? b.y + 1 : b.y - 1, b.z)), `lantern ${key(b.x, b.y, b.z)}`);
  // palette: the spec's blocks only
  const K1 = /^(cobblestone|cobbled_deepslate|deepslate_bricks|polished_deepslate|stone_bricks|stone_brick_stairs|deepslate_tiles|deepslate_tile_slab|spruce_log|spruce_planks|spruce_stairs|iron_bars|lantern)$/;
  assert.ok(cells.every((b) => K1.test(b.name)), [...new Set(cells.map((b) => b.name))].join());
  // a module is its cells, relative to its low corner
  const g1 = shellModule('g1');
  assert.deepEqual([g1.origin, g1.size], [{x: -311, y: 115, z: 10}, {x: 3, y: 15, z: 21}]);
  assert.equal(g1.blocks.length, cells.filter((b) => inBox(MODULES[2], b.x, b.y, b.z)).length);
  assert.ok(g1.blocks.every((b) => b.x >= 0 && b.x < 3 && b.y >= 0 && b.y < 15 && b.z >= 0 && b.z < 21));
}

(async () => {
  // round trip through the real writer and parser, placed at the warehouse origin
  const {writeLitematic} = require('../litematic-write.js');
  const {parseLitematic, placeSchematic} = require('../schematic.js');
  const buf = writeLitematic({name: 'castle-lager', regions: [{size: w.size, position: {x: 0, y: 0, z: 0}, blocks: w.blocks}]});
  const placed = placeSchematic(await parseLitematic(buf), {origin: {x: -333, y: 109, z: -11}});
  assert.equal(placed.length, w.blocks.length);
  assert.ok(placed.every((b) => b.x >= -333 && b.x <= -315 && b.z >= -11 && b.z <= 6 && b.y >= 109 && b.y <= 120));
  const placedA = placeSchematic(await parseLitematic(writeLitematic({name: 'castle-ruestkammer', regions: [{size: arm.size, position: {x: 0, y: 0, z: 0}, blocks: arm.blocks}]})), {origin: O});
  assert.equal(placedA.length, arm.blocks.length);
  assert.ok(placedA.every((x) => x.x >= -323 && x.x <= -315 && x.z >= -30 && x.z <= -20 && x.y >= 104 && x.y <= 111));
  console.log('castle ok');
})().catch((e) => { console.error(e); process.exit(1); });
