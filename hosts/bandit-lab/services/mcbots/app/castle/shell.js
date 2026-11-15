'use strict';
// Castle module K1, the sorter shell (spec docs/superpowers/specs/2026-11-15-wizard-castle-design.md, architect's block
// rules 2026-11-15). World coordinates: a 2-thick ring wall round the sorter (x -313..-292, z 8..53, y 110..129) on
// cobblestone footings, the west chest gallery (floor y 115, upper walkway y 120), a ridge roof y 130..135, cut into
// build modules no bigger than one schematic job. The sorter box and the 1-block air gap (z 10, x -294) are in no module.
const SORTER = {x1: -308, x2: -295, y1: 111, y2: 129, z1: 11, z2: 50};
const MODULES = [ // build order: the parts without deepslate first (it has to be mined)
  {id: 't', x1: -311, x2: -310, y1: 105, y2: 115, z1: 2, z2: 7}, // stairs up to the north door
  {id: 'gf', x1: -311, x2: -309, y1: 110, y2: 114, z1: 14, z2: 34}, // fill under the gallery (bee nest -309 114 12 left alone)
  {id: 'g1', x1: -311, x2: -309, y1: 115, y2: 129, z1: 10, z2: 30},
  {id: 'g2', x1: -311, x2: -309, y1: 115, y2: 129, z1: 31, z2: 50},
  {id: 'e2f', x1: -293, x2: -292, y1: 94, y2: 109, z1: 31, z2: 50},
  {id: 'n', x1: -313, x2: -292, y1: 106, y2: 129, z1: 8, z2: 9},
  {id: 'w1', x1: -313, x2: -312, y1: 106, y2: 129, z1: 10, z2: 30},
  {id: 'w2', x1: -313, x2: -312, y1: 106, y2: 129, z1: 31, z2: 50},
  {id: 'sf', x1: -313, x2: -292, y1: 94, y2: 115, z1: 51, z2: 53},
  {id: 's', x1: -313, x2: -292, y1: 116, y2: 129, z1: 51, z2: 53},
  {id: 'e1', x1: -293, x2: -292, y1: 106, y2: 129, z1: 10, z2: 30},
  {id: 'e2', x1: -293, x2: -292, y1: 110, y2: 129, z1: 31, z2: 50},
  {id: 'r1', x1: -313, x2: -292, y1: 130, y2: 135, z1: 8, z2: 30},
  {id: 'r2', x1: -313, x2: -292, y1: 130, y2: 135, z1: 31, z2: 53},
];
const inBox = (b, x, y, z) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2 && z >= b.z1 && z <= b.z2;
const LANTERN = {hanging: 'false', waterlogged: 'false'}, HANGING = {hanging: 'true', waterlogged: 'false'};

// One wall cell of the ring (x in -313/-312/-293/-292 or z in 8/9/52/53).
function wallCell(x, y, z) {
  const ew = x <= -312 || x >= -293, ns = z <= 9 || z >= 52;
  if (y < 110) return ['cobblestone'];
  if (ew && ns) return ['stone_bricks']; // 2 x 2 corners
  const outer = x === -313 || x === -292 || z === 8 || z === 53, along = ew ? z : x;
  if (!outer) {
    if (along % 6 === 0 && (y === 113 || y === 119 || y === 125)) return ['lantern', LANTERN]; // lights the air gap
    return [x === -312 && y >= 116 ? 'deepslate_bricks' : 'cobblestone']; // only the west inner face is seen (gallery)
  }
  if (y === 115 || y === 129) return ['polished_deepslate'];
  return [(along + y) % 3 === 0 ? 'cobbled_deepslate' : 'deepslate_bricks'];
}

function shell() {
  const cells = new Map(), put = (x, y, z, name, props) => cells.set(`${x},${y},${z}`, {x, y, z, name, ...(props ? {props} : {})});
  const ring = (x, z) => x <= -312 || x >= -293 || z <= 9 || z >= 52;
  // walls with their footings (n, w1, w2, e1, e2, e2f, sf, s)
  for (const m of MODULES.filter((m) => /^(n|w1|w2|e1|e2|e2f|sf|s)$/.test(m.id))) {
    for (let x = m.x1; x <= m.x2; x++) for (let y = m.y1; y <= m.y2; y++) for (let z = m.z1; z <= m.z2; z++) {
      if (ring(x, z)) put(x, y, z, ...wallCell(x, y, z));
      else if (m.id === 'sf' && z === 51) put(x, y, z, 'cobblestone'); // the south gap is filled to the gallery floor
    }
  }
  for (const z of [42, 48]) for (const y of [101, 107]) put(-293, y, z, 'lantern', LANTERN); // the deep east gap (ground falls from z 40)
  for (const x of [-310, -304, -298]) for (const y of [105, 111]) put(x, y, 51, 'lantern', LANTERN); // under the sorter's south end
  for (let x = -311; x <= -300; x++) put(x, 120, 51, 'spruce_planks'); // platform for the button -302 121 50
  // openings
  for (const x of [-311, -310]) for (let y = 116; y <= 118; y++) for (const z of [8, 9]) cells.delete(`${x},${y},${z}`); // north door
  for (const z of [15, 21, 27, 33, 39, 45]) for (const y of [122, 123]) { put(-313, y, z, 'iron_bars'); cells.delete(`-312,${y},${z}`); }
  for (const x of [-293, -292]) for (let y = 117; y <= 119; y++) put(x, y, 21, 'spruce_planks'); // tower door, taken out later
  // stairs up to the north door (t)
  for (let i = 0; i < 6; i++) for (const x of [-311, -310]) {
    for (let y = 105; y < 110 + i; y++) put(x, y, 2 + i, 'cobblestone');
    put(x, 110 + i, 2 + i, 'stone_brick_stairs', {facing: 'south', half: 'bottom', shape: 'straight', waterlogged: 'false'});
  }
  // gallery: fill, floor y 115, upper walkway y 120 on x -311..-310 (none over the stairs x -311, z 31..35), lanterns
  for (let x = -311; x <= -309; x++) for (let z = 14; z <= 34; z++) for (let y = 110; y <= 114; y++) put(x, y, z, 'cobblestone');
  for (let z = 10; z <= 50; z++) {
    for (let x = -311; x <= -309; x++) put(x, 115, z, 'spruce_planks');
    put(-310, 120, z, 'spruce_planks');
    if (z < 31 || z > 35) put(-311, 120, z, 'spruce_planks');
  }
  for (let i = 0; i < 5; i++) put(-311, 116 + i, 31 + i, 'spruce_stairs', {facing: 'south', half: 'bottom', shape: 'straight', waterlogged: 'false'});
  for (let z = 13; z <= 49; z += 6) { put(-310, 119, z, 'lantern', HANGING); if (z < 31 || z > 35) put(-311, 121, z, 'lantern', LANTERN); }
  // roof: d = distance to the long outer edge; slabs and tiles in turn, spruce purlins under, brick gables
  for (let x = -313; x <= -292; x++) {
    const d = Math.min(x + 313, -292 - x), top = 130 + Math.floor(d / 2);
    for (let z = 8; z <= 53; z++) {
      put(x, top, z, d % 2 === 0 ? 'deepslate_tile_slab' : 'deepslate_tiles', d % 2 === 0 ? {type: 'bottom', waterlogged: 'false'} : undefined);
      if (z === 8 || z === 53) for (let y = 130; y < top; y++) put(x, y, z, 'deepslate_bricks');
      else if (d % 2 === 0 && d >= 2) {
        put(x, top - 1, z, 'spruce_log', {axis: 'z'});
        if ((d === 6 || d === 10) && z % 6 === 3) put(x, top - 2, z, 'lantern', HANGING);
      }
    }
  }
  return [...cells.values()];
}

// One module as a schematic: blocks relative to its origin (the module box's low corner).
function shellModule(id) {
  const m = MODULES.find((b) => b.id === id);
  if (!m) throw new Error(`unknown shell module ${id}`);
  const blocks = shell().filter((b) => inBox(m, b.x, b.y, b.z)).map((b) => ({...b, x: b.x - m.x1, y: b.y - m.y1, z: b.z - m.z1}));
  return {origin: {x: m.x1, y: m.y1, z: m.z1}, size: {x: m.x2 - m.x1 + 1, y: m.y2 - m.y1 + 1, z: m.z2 - m.z1 + 1}, blocks};
}

module.exports = {shell, shellModule, MODULES, SORTER, inBox};
