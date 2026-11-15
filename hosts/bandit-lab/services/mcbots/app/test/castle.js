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

(async () => {
  // round trip through the real writer and parser, placed at the warehouse origin
  const {writeLitematic} = require('../litematic-write.js');
  const {parseLitematic, placeSchematic} = require('../schematic.js');
  const buf = writeLitematic({name: 'castle-lager', regions: [{size: w.size, position: {x: 0, y: 0, z: 0}, blocks: w.blocks}]});
  const placed = placeSchematic(await parseLitematic(buf), {origin: {x: -333, y: 109, z: -11}});
  assert.equal(placed.length, w.blocks.length);
  assert.ok(placed.every((b) => b.x >= -333 && b.x <= -315 && b.z >= -11 && b.z <= 6 && b.y >= 109 && b.y <= 120));
  console.log('castle ok');
})().catch((e) => { console.error(e); process.exit(1); });
