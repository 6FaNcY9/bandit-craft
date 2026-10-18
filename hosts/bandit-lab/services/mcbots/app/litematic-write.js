'use strict';
const nbt = require('prismarine-nbt');
const {gzipSync} = require('node:zlib');

const str = (v) => ({type: 'string', value: String(v)});
const int = (v) => ({type: 'int', value: v});
const long = (v) => ({type: 'long', value: v});
const compound = (value) => ({type: 'compound', value});
function writeLitematic({name, author = 'mcbots', regions}) {
  if (!Array.isArray(regions) || !regions.length) throw new Error('regions must be a non-empty list');
  let totalBlocks = 0, totalVolume = 0;
  const rs = {};
  for (const r of regions) {
    const {size, position, blocks} = r;
    if (!['x', 'y', 'z'].every((a) => Number.isInteger(size?.[a]) && size[a] > 0 && Number.isInteger(position?.[a])) || !Array.isArray(blocks)) throw new Error('invalid region');
    const volume = size.x * size.y * size.z;
    if (!Number.isSafeInteger(volume)) throw new Error('region too large');
    const stateKey = (b) => JSON.stringify([`minecraft:${b.name.replace(/^minecraft:/, '')}`, b.props || {}]);
    const palette = [{Name: str('minecraft:air')}], paletteIndex = new Map([[stateKey({name: 'air'}), 0]]);
    for (const b of blocks) if (!paletteIndex.has(stateKey(b))) { const ix = palette.length; paletteIndex.set(stateKey(b), ix); palette.push({Name: str(`minecraft:${b.name.replace(/^minecraft:/, '')}`), ...(Object.keys(b.props || {}).length ? {Properties: compound(Object.fromEntries(Object.entries(b.props).map(([k, v]) => [k, str(v)])))} : {})}); }
    const voidKey = stateKey({name: 'structure_void'});
    if (!paletteIndex.has(voidKey)) { paletteIndex.set(voidKey, palette.length); palette.push({Name: str('minecraft:structure_void')}); }
    const states = Array(volume).fill(paletteIndex.get(voidKey));
    for (const b of blocks) {
      if (![b.x, b.y, b.z].every(Number.isInteger) || b.x < 0 || b.x >= size.x || b.y < 0 || b.y >= size.y || b.z < 0 || b.z >= size.z) throw new Error('block outside region');
      const i = b.x + size.x * (b.z + size.z * b.y);
      states[i] = paletteIndex.get(stateKey(b));
    }
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length))), words = Array(Math.ceil(volume * bits / 64)).fill(0n), mask = (1n << BigInt(bits)) - 1n;
    states.forEach((v, i) => { const bit = i * bits, word = Math.floor(bit / 64), shift = bit % 64; words[word] |= BigInt(v) << BigInt(shift); if (shift + bits > 64) words[word + 1] |= BigInt(v) >> BigInt(64 - shift); });
    const longs = words.map((v) => [Number(BigInt.asIntN(32, v >> 32n)), Number(BigInt.asIntN(32, v & 0xffffffffn))]);
    rs[r.name] = compound({Position: compound(Object.fromEntries(['x','y','z'].map((a) => [a, int(position[a])]))), Size: compound(Object.fromEntries(['x','y','z'].map((a) => [a, int(size[a])]))), BlockStatePalette: {type: 'list', value: {type: 'compound', value: palette}}, BlockStates: {type: 'longArray', value: longs}, TileEntities: {type: 'list', value: {type: 'compound', value: []}}, Entities: {type: 'list', value: {type: 'compound', value: []}}, PendingBlockTicks: {type: 'list', value: {type: 'compound', value: []}}, PendingFluidTicks: {type: 'list', value: {type: 'compound', value: []}}});
    totalBlocks += blocks.length; totalVolume += volume;
  }
  const now = Date.now(), metadata = {Name: str(name), Author: str(author), Description: str(''), RegionCount: int(regions.length), TotalBlocks: long(totalBlocks), TotalVolume: long(totalVolume), EnclosingSize: compound(Object.fromEntries(['x','y','z'].map((a) => [a, int(Math.max(...regions.map((r) => r.size[a])))]))), TimeCreated: long(now), TimeModified: long(now)};
  const root = {Version: int(6), MinecraftDataVersion: int(4189), Metadata: compound(metadata), Regions: compound(rs)};
  return gzipSync(nbt.writeUncompressed({type: 'compound', name: '', value: root}));
}
module.exports = {writeLitematic};
