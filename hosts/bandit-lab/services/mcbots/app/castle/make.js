'use strict';
// Writes a castle module as a .litematic for the hub's schematic upload: node castle/make.js warehouse out.litematic
const {writeLitematic} = require('../litematic-write.js');
const MODULES = {warehouse: ['castle-lager', () => require('./warehouse.js').warehouse()]};

const [what, out] = process.argv.slice(2);
if (!MODULES[what] || !out) { console.error(`unknown module (one of: ${Object.keys(MODULES).join(', ')}) or no output path`); process.exit(1); }
const [name, build] = MODULES[what], {size, blocks} = build();
require('node:fs').writeFileSync(out, writeLitematic({name, author: 'mcbots', regions: [{size, position: {x: 0, y: 0, z: 0}, blocks}]}));
console.log(`${out}: ${blocks.length} blocks, ${size.x} x ${size.y} x ${size.z}`);
