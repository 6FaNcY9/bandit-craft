'use strict';
// Writes a castle module as a .litematic for the hub's schematic upload: node castle/make.js warehouse out.litematic
const {writeLitematic} = require('../litematic-write.js');
const MODULES = {
  warehouse: ['castle-lager', () => require('./warehouse.js').warehouse()],
  armoury: ['castle-ruestkammer', () => require('./armoury.js').armoury()], // origin -323 104 -30, then RCON: armoury.js furnitureCommands
  barracks: ['castle-kaserne1', () => require('./armoury.js').barracks()], // origin -333 104 -30
};
for (const {id} of require('./shell.js').MODULES) MODULES[`shell-${id}`] = [`castle-k1-${id}`, () => require('./shell.js').shellModule(id)];

const [what, out] = process.argv.slice(2);
if (!MODULES[what] || !out) { console.error(`unknown module (one of: ${Object.keys(MODULES).join(', ')}) or no output path`); process.exit(1); }
const [name, build] = MODULES[what], {size, blocks, origin} = build();
require('node:fs').writeFileSync(out, writeLitematic({name, author: 'mcbots', regions: [{size, position: {x: 0, y: 0, z: 0}, blocks}]}));
console.log(`${out}: ${blocks.length} blocks, ${size.x} x ${size.y} x ${size.z}${origin ? `, origin ${origin.x} ${origin.y} ${origin.z}` : ''}`);
