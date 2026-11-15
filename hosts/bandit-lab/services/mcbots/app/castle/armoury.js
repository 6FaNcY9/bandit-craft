'use strict';
// Castle A3b, the Thralls' Armoury, and A3a, Barracks 1 with the bots' beds (spec
// docs/superpowers/specs/2026-11-15-castle-armoury-design.md). One shell, 9 x 8 x 11, relative coordinates; origins world
// -323 104 -30 (armoury) and -333 104 -30 (barracks). Chests, crafting table and furnace stay out of the schematic: RCON setblock
// (furnitureCommands) places them with their pairing, so the room cells they take are left empty here.
const SIZE = {x: 9, y: 8, z: 11};

function shell(door) {
  const cells = new Map(), put = (x, y, z, name, props) => cells.set(`${x},${y},${z}`, {x, y, z, name, ...(props ? {props} : {})});
  const last = {x: SIZE.x - 1, z: SIZE.z - 1};
  const rim = (x, z) => x === 0 || z === 0 || x === last.x || z === last.z;
  for (let x = 0; x < SIZE.x; x++) for (let z = 0; z < SIZE.z; z++) {
    put(x, 0, z, 'cobblestone');
    put(x, 6, z, 'deepslate_tiles');
    if (!rim(x, z)) continue;
    if ((x + z) % 2 === 0) put(x, 7, z, 'stone_bricks');
    const corner = (x === 0 || x === last.x) && (z === 0 || z === last.z);
    for (let y = 1; y <= 5; y++) put(x, y, z, corner ? 'polished_deepslate' : (x + y + z) % 3 ? 'deepslate_bricks' : 'cobbled_deepslate');
  }
  for (const y of [1, 2]) cells.delete(`${door.x},${y},${door.z}`);
  for (const z of [2, 5, 8]) for (const x of [0, last.x]) put(x, 3, z, 'glass');
  put(4, 3, 0, 'glass');
  for (const [x, z] of [[2, 3], [6, 3], [2, 7], [6, 7]]) put(x, 5, z, 'lantern', {hanging: 'true', waterlogged: 'false'});
  return {size: {...SIZE}, blocks: [...cells.values()]};
}

const armoury = () => shell({x: 8, z: 5}); // east, to the main axis A7
const barracks = () => shell({x: 4, z: 10}); // south: the east wall faces the armoury one block away

// A 'left' chest joins the chest on its clockwise side (Minecraft ChestBlock): facing east, the one to the south.
// shortcut: taken from the game's code, not tried; open one double chest after the RCON run and swap left/right if wrong.
const CW = {north: [1, 0], east: [0, 1], south: [-1, 0], west: [0, -1]};
const pair = ([ax, az], [bx, bz], facing) => {
  const [dx, dz] = CW[facing], aLeft = ax + dx === bx && az + dz === bz;
  return [[ax, az, aLeft ? 'left' : 'right'], [bx, bz, aLeft ? 'right' : 'left']].map(([x, z, type]) => ({x, y: 105, z, name: 'chest', props: {facing, type}}));
};
const FURNITURE = [
  ...pair([-322, -26], [-322, -25], 'east'), // Iron: the gear point; the keeper fills this one
  ...pair([-322, -29], [-322, -28], 'east'), // Sets
  ...pair([-322, -23], [-322, -22], 'east'), // Arms
  ...pair([-320, -29], [-319, -29], 'south'), // Larder
  ...pair([-321, -21], [-320, -21], 'north'), // Hand-back
  {x: -317, y: 105, z: -21, name: 'crafting_table'},
  {x: -316, y: 105, z: -21, name: 'furnace', props: {facing: 'north', lit: 'false'}},
];
const furnitureCommands = () => FURNITURE.map((f) => `setblock ${f.x} ${f.y} ${f.z} minecraft:${f.name}${f.props ? `[${Object.entries(f.props).map(([k, v]) => `${k}=${v}`).join(',')}]` : ''}`);

module.exports = {armoury, barracks, FURNITURE, furnitureCommands, SIZE};
