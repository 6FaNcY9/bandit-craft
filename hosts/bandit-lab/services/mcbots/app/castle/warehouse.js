'use strict';
// Castle module K2, the warehouse (spec docs/superpowers/specs/2026-11-15-wizard-castle-design.md). Relative
// coordinates, origin = world -333 109 -11. Two storeys: chest rows on the ground floor stay empty (the owner's
// chests are cloned in by RCON), a spruce floor at y 5, a flat tiled roof at y 10 with merlons.
const SIZE = {x: 19, y: 12, z: 18};
const ROWS = [2, 6, 10, 14].map((z) => ({x1: 1, x2: 16, y1: 1, y2: 3, z}));

function warehouse() {
  const cells = new Map(), put = (x, y, z, name, props) => cells.set(`${x},${y},${z}`, {x, y, z, name, ...(props ? {props} : {})});
  const {x: X, z: Z} = SIZE, last = {x: X - 1, z: Z - 1};
  const rim = (x, z) => x === 0 || z === 0 || x === last.x || z === last.z;
  for (let x = 0; x < X; x++) for (let z = 0; z < Z; z++) {
    put(x, 0, z, 'cobblestone');
    put(x, 10, z, 'deepslate_tiles');
    if (rim(x, z) && (x + z) % 2 === 0) put(x, 11, z, 'deepslate_bricks');
    if (!rim(x, z)) { if (!(z === 16 && x <= 4)) put(x, 5, z, 'spruce_planks'); continue; }
    const corner = (x === 0 || x === last.x) && (z === 0 || z === last.z);
    for (let y = 1; y <= 9; y++) put(x, y, z, corner || y === 5 ? 'polished_deepslate' : 'deepslate_bricks');
  }
  for (const y of [1, 2]) cells.delete(`18,${y},4`); // doorway to the forecourt
  for (const y of [7, 8]) for (const p of [4, 8, 12]) for (const x of [0, last.x]) put(x, y, p, 'glass');
  for (const y of [7, 8]) for (const p of [5, 9, 13]) for (const z of [0, last.z]) put(p, y, z, 'glass');
  for (let i = 1; i <= 5; i++) put(i, i, 16, 'spruce_stairs', {facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false'});
  for (const y of [4, 9]) for (const x of [4, 8, 12]) for (const z of [4, 8, 12]) put(x, y, z, 'lantern', {hanging: 'true', waterlogged: 'false'});
  return {size: {...SIZE}, blocks: [...cells.values()]};
}

module.exports = {warehouse, ROWS, SIZE};
