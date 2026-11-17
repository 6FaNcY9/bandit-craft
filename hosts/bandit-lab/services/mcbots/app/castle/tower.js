'use strict';
// Castle module A1, the wizard tower east of K1 (architect's design 2026-11-17). World coordinates round the centre
// -282/21: an octagon oct(8,12) with a 2-thick wall on a cobblestone footing, six plank floors, stair flights along the
// inner walls, a closed deck y 152 with a merlon crown and a hollow stepped spire. Stacked y-band build modules.
const MODULES = [ // build order, each band starts with its floor
  {id: 'f', x1: -290, x2: -274, y1: 103, y2: 112, z1: 13, z2: 29}, // footing
  {id: 'b', x1: -291, x2: -274, y1: 113, y2: 119, z1: 13, z2: 29}, // ground floor, flight 0, doors, connector
  {id: 's1', x1: -291, x2: -274, y1: 120, y2: 125, z1: 13, z2: 29}, // x -291: the connector's lintel row y 120
  {id: 's2', x1: -290, x2: -274, y1: 126, y2: 131, z1: 13, z2: 29},
  {id: 's3', x1: -290, x2: -274, y1: 132, y2: 137, z1: 13, z2: 29},
  {id: 's4', x1: -290, x2: -274, y1: 138, y2: 143, z1: 13, z2: 29},
  {id: 's5', x1: -290, x2: -274, y1: 144, y2: 151, z1: 13, z2: 29}, // top room
  {id: 'c', x1: -290, x2: -274, y1: 152, y2: 154, z1: 13, z2: 29}, // deck, crown, first spire rings
  {id: 'sp', x1: -288, x2: -276, y1: 155, y2: 167, z1: 15, z2: 27}, // spire
];
const inBox = (b, x, y, z) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2 && z >= b.z1 && z <= b.z2;
const CX = -282, CZ = 21, FLOORS = [113, 120, 126, 132, 138, 144];
const oct = (R, S, dx, dz) => Math.abs(dx) <= R && Math.abs(dz) <= R && Math.abs(dx) + Math.abs(dz) <= S;
const isWall = (dx, dz) => oct(8, 12, dx, dz) && !oct(6, 10, dx, dz);
const isOuter = (dx, dz) => Math.abs(dx) === 8 || Math.abs(dz) === 8 || Math.abs(dx) + Math.abs(dz) === 12;
const ring = (R, dx, dz) => oct(R, Math.floor(1.5 * R), dx, dz) && !oct(R - 1, Math.floor(1.5 * (R - 1)), dx, dz);
const stair = (facing) => ({facing, half: 'bottom', shape: 'straight', waterlogged: 'false'});
const HANGING = {hanging: 'true', waterlogged: 'false'};

function outerCell(x, y, z) {
  const ax = Math.abs(x - CX), az = Math.abs(z - CZ);
  if ((ax === 8 && az === 4) || (ax === 4 && az === 8)) return 'stone_bricks'; // the 8 vertex columns
  if (y === 120 || y === 132 || y === 144) return 'polished_deepslate';
  const h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 0x9E3779B1) >>> 24; // K1's hash (shell.js)
  return h < (y <= 119 ? 150 : y <= 137 ? 80 : 40) ? 'cobbled_deepslate' : 'deepslate_bricks';
}

function tower() {
  const cells = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  const put = (x, y, z, name, props) => cells.set(key(x, y, z), {x, y, z, name, ...(props ? {props} : {})});
  const del = (x, y, z) => cells.delete(key(x, y, z));
  const each = (fn) => { for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) fn(dx, dz, CX + dx, CZ + dz); };
  // footing, wall, floors, deck, crown, campfires
  each((dx, dz, x, z) => {
    if (isWall(dx, dz)) {
      for (let y = 103; y <= 112; y++) put(x, y, z, 'cobblestone');
      for (let y = 113; y <= 151; y++) put(x, y, z, isOuter(dx, dz) ? outerCell(x, y, z) : 'deepslate_bricks');
      put(x, 152, z, 'polished_deepslate');
      if (isOuter(dx, dz)) {
        put(x, 153, z, 'stone_bricks');
        if ((Math.abs(dx) === 8 ? dz : dx) % 2 === 0) put(x, 154, z, 'stone_bricks');
      }
    } else if (oct(6, 10, dx, dz)) for (const y of [...FLOORS, 152]) put(x, y, z, 'spruce_planks');
  });
  for (const sx of [-6, 6]) for (const sz of [-5, 5]) put(CX + sx, 153, CZ + sz, 'campfire', {facing: 'north', lit: 'true', signal_fire: 'false', waterlogged: 'false'});
  // beacon on the deck (owner 2026-11-17): tier-1 iron base; its beam rises through the hollow spire and the glass tip
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) put(CX + dx, 152, CZ + dz, 'iron_block');
  put(CX, 153, CZ, 'beacon');
  // spire: each ring R for two layers (R 6: three); its top layer also covers ring R-1, so the next ring stands on it
  for (const [R, y1, y2] of [[6, 153, 155], [5, 156, 157], [4, 158, 159], [3, 160, 161], [2, 162, 163], [1, 164, 165]]) {
    for (let y = y1; y <= y2; y++) each((dx, dz, x, z) => { if (ring(R, dx, dz) || (y === y2 && ring(R - 1, dx, dz))) put(x, y, z, 'deepslate_tiles'); });
  }
  for (const y of [165, 166, 167]) put(CX, y, CZ, 'purple_stained_glass'); // the beam turns purple
  // flight 0 along the west wall (x -288), landing at the K1 door, up through floor 120
  for (let i = 0; i < 3; i++) put(-288, 114 + i, 18 + i, 'spruce_stairs', stair('south'));
  put(-288, 116, 21, 'spruce_planks');
  for (let i = 0; i < 4; i++) put(-288, 117 + i, 22 + i, 'spruce_stairs', stair('south'));
  for (let z = 21; z <= 24; z++) del(-288, 120, z);
  // flights 1..4: south wall (z 27) going east, north wall (z 15) going west; the top stair is a cell of the next floor
  FLOORS.slice(1, 5).forEach((F, n) => {
    const east = n % 2 === 0, z = east ? 27 : 15, x0 = east ? -285 : -279, s = east ? 1 : -1;
    for (let i = 0; i < 6; i++) put(x0 + s * i, F + 1 + i, z, 'spruce_stairs', stair(east ? 'east' : 'west'));
    for (let i = 1; i <= 4; i++) del(x0 + s * i, F + 6, z);
  });
  // doors: to K1 (west) and north
  for (const x of [-290, -289]) for (let y = 117; y <= 119; y++) del(x, y, 21);
  for (const z of [13, 14]) for (let y = 114; y <= 116; y++) del(-282, y, z);
  // connector across the gap to K1 (x -291)
  put(-291, 116, 21, 'polished_deepslate');
  for (const z of [20, 22]) for (let y = 116; y <= 120; y++) put(-291, y, z, 'deepslate_bricks');
  put(-291, 120, 21, 'deepslate_bricks');
  // slits: iron bars in the outer cell, the inner cell open, on each face's axis
  const FACES = {n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0]};
  for (const [F, faces] of [[113, 'es'], [120, 'nes'], [126, 'nes'], [132, 'nesw'], [138, 'nesw'], [144, 'nesw']]) {
    for (const f of faces) for (const off of F === 144 ? [-2, 0, 2] : [0]) for (const y of F === 144 ? [146, 147, 148] : [F + 2, F + 3]) {
      const [ux, uz] = FACES[f], ax = ux ? 0 : off, az = uz ? 0 : off; // off runs along the face
      put(CX + 8 * ux + ax, y, CZ + 8 * uz + az, 'iron_bars');
      del(CX + 7 * ux + ax, y, CZ + 7 * uz + az);
    }
  }
  // lanterns hanging from the floor above
  for (const y of [119, 125, 131, 137, 143, 151]) for (const dx of [-3, 3]) for (const dz of [-3, 3]) put(CX + dx, y, CZ + dz, 'lantern', HANGING);
  return [...cells.values()];
}

// One module as a schematic: blocks relative to its origin (the module box's low corner).
function towerModule(id) {
  const m = MODULES.find((b) => b.id === id);
  if (!m) throw new Error(`unknown tower module ${id}`);
  const blocks = tower().filter((b) => inBox(m, b.x, b.y, b.z)).map((b) => ({...b, x: b.x - m.x1, y: b.y - m.y1, z: b.z - m.z1}));
  return {origin: {x: m.x1, y: m.y1, z: m.z1}, size: {x: m.x2 - m.x1 + 1, y: m.y2 - m.y1 + 1, z: m.z2 - m.z1 + 1}, blocks};
}

module.exports = {tower, towerModule, MODULES, inBox};
