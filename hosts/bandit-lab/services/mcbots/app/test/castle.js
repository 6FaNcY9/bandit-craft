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
