'use strict';
const nbt = require('prismarine-nbt');
const mcData = require('minecraft-data');
const {itemOf, placement, skip, DIRS} = require('./placing');

const AIR = new Set(['air', 'cave_air', 'void_air', 'structure_void']);
const SKIP = new Set([...AIR, 'water', 'lava', 'fire', 'soul_fire', 'bubble_column', 'piston_head', 'moving_piston', 'frosted_ice', 'light']);
const AXES = ['x', 'y', 'z'];

async function parseLitematic(buffer) {
  const root = nbt.simplify((await nbt.parse(buffer)).parsed);
  if (!root.Regions || typeof root.Regions !== 'object' || Array.isArray(root.Regions)) throw new Error('litematic: missing Regions');
  const blocks = [];
  const min = {x: Infinity, y: Infinity, z: Infinity};
  const max = {x: -Infinity, y: -Infinity, z: -Infinity};
  for (const [region, r] of Object.entries(root.Regions)) {
    const palette = r?.BlockStatePalette;
    if (!Array.isArray(palette) || !palette.length || palette.some((p) => !p || typeof p.Name !== 'string' || !p.Name.length ||
      (p.Properties != null && (typeof p.Properties !== 'object' || Array.isArray(p.Properties) || Object.values(p.Properties).some((v) => typeof v !== 'string'))))) throw new Error(`region ${region}: bad palette`);
    const size = {}, origin = {};
    for (const ax of AXES) {
      if (!Number.isInteger(r.Size?.[ax]) || !r.Size[ax] || !Number.isInteger(r.Position?.[ax])) throw new Error(`region ${region}: invalid Size or Position`);
      size[ax] = Math.abs(r.Size[ax]);
      origin[ax] = r.Position[ax] + (r.Size[ax] < 0 ? r.Size[ax] + 1 : 0);
    }
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
    const count = size.x * size.y * size.z;
    if (!Number.isSafeInteger(count) || !Array.isArray(r.BlockStates) || r.BlockStates.length < Math.ceil(count * bits / 64)) throw new Error(`region ${region}: truncated BlockStates`);
    const longs = r.BlockStates.map((v) => {
      if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isInteger)) throw new Error(`region ${region}: invalid BlockStates long`);
      return (BigInt(v[0] >>> 0) << 32n) | BigInt(v[1] >>> 0);
    });
    // Container contents (a sorter's filter items) by region-local position, attached to their block.
    const items = new Map();
    for (const t of Array.isArray(r.TileEntities) ? r.TileEntities : []) {
      if (!Array.isArray(t?.Items) || !t.Items.length || ![t.x, t.y, t.z].every(Number.isInteger)) continue;
      items.set(`${t.x},${t.y},${t.z}`, t.Items.map((i) => ({slot: Number(i.Slot), name: String(i.id).replace(/^minecraft:/, ''), count: Number(i.Count ?? i.count ?? 1)}))
        .filter((i) => Number.isInteger(i.slot) && i.count > 0).sort((a, b) => a.slot - b.slot));
    }
    const mask = (1n << BigInt(bits)) - 1n;
    for (let i = 0; i < count; i++) {
      const bit = i * bits, word = Math.floor(bit / 64), shift = bit % 64;
      let value = longs[word] >> BigInt(shift);
      if (shift + bits > 64) value |= longs[word + 1] << BigInt(64 - shift);
      const p = palette[Number(value & mask)];
      if (!p) throw new Error(`region ${region}: bad palette index at block ${i}`);
      const name = p.Name.replace(/^minecraft:/, '');
      if (AIR.has(name)) continue;
      const lx = i % size.x, ly = Math.floor(i / (size.x * size.z)), lz = Math.floor(i / size.x) % size.z;
      const b = {x: origin.x + lx, y: origin.y + ly, z: origin.z + lz, name, props: {...p.Properties}};
      if (items.has(`${lx},${ly},${lz}`)) b.items = items.get(`${lx},${ly},${lz}`);
      blocks.push(b);
      for (const ax of AXES) {
        min[ax] = Math.min(min[ax], b[ax]);
        max[ax] = Math.max(max[ax], b[ax]);
      }
    }
  }
  // Blocks start at 0,0,0; offset is where that corner lies relative to the schematic's own origin,
  // which a Litematica placement puts at its origin (regions with negative sizes start below it).
  const size = {x: 0, y: 0, z: 0}, offset = {x: 0, y: 0, z: 0};
  if (blocks.length) for (const ax of AXES) {
    size[ax] = max[ax] - min[ax] + 1;
    offset[ax] = min[ax];
    for (const b of blocks) b[ax] -= min[ax];
  }
  return {name: root.Metadata?.Name ?? '', size, offset, blocks};
}

function billOfMaterials(blocks, version = '26.1') {
  const data = mcData(version);
  if (!data) throw new Error(`unsupported Minecraft version: ${version}`);
  const items = new Map(), unknown = new Map();
  for (const {name, props = {}, items: inside = []} of blocks) {
    for (const it of inside) if (Object.hasOwn(data.itemsByName, it.name)) items.set(it.name, (items.get(it.name) || 0) + it.count);
    if (SKIP.has(name) || props.half === 'upper' || props.part === 'head') continue;
    const mapped = itemOf(name);
    const count = /_slab$/.test(name) && props.type === 'double' ? 2 : Number(props.candles ?? props.pickles ?? props.eggs ?? (name === 'snow' ? props.layers : undefined) ?? 1);
    const parts = name.startsWith('potted_') ? ['flower_pot', name.slice(7)] : [mapped];
    for (const part of parts) {
      if (Object.hasOwn(data.itemsByName, part)) items.set(part, (items.get(part) || 0) + count);
      else unknown.set(name, (unknown.get(name) || 0) + count);
    }
  }
  const sorted = (entries) => [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {items: Object.fromEntries(sorted(items)), unknown: sorted(unknown).map(([name]) => name)};
}

const byPosition = (a, b) => a.y - b.y || a.z - b.z || a.x - b.x;

function placeSchematic(parsed, {origin, rotation = 0, mirror = 'none'}) {
  if (![0, 90, 180, 270].includes(rotation)) throw new Error('schematic: invalid rotation');
  if (!['none', 'left_right', 'front_back'].includes(mirror)) throw new Error('schematic: invalid mirror');
  const transform = (x, z) => {
    if (mirror === 'left_right') z = -z;
    if (mirror === 'front_back') x = -x;
    return rotation === 90 ? [-z, x] : rotation === 180 ? [-x, -z] : rotation === 270 ? [z, -x] : [x, z];
  };
  const horizontal = ['north', 'east', 'south', 'west'];
  const direction = (d) => {
    if (!horizontal.includes(d)) return d;
    const [x, , z] = DIRS[d], [tx, tz] = transform(x, z);
    return horizontal.find((key) => DIRS[key][0] === tx && DIRS[key][2] === tz);
  };
  const flip = (v) => v === 'left' ? 'right' : v === 'right' ? 'left' : v;
  return parsed.blocks.map((b) => {
    const [x, z] = transform(b.x + parsed.offset.x, b.z + parsed.offset.z);
    const props = {}, name = b.name.replace(/^minecraft:/, '');
    for (const [key, value] of Object.entries(b.props || {})) props[horizontal.includes(key) ? direction(key) : key] = value;
    if (props.facing) props.facing = direction(props.facing);
    if (rotation % 180 && ['x', 'z'].includes(props.axis)) props.axis = props.axis === 'x' ? 'z' : 'x';
    if (/rail$/.test(name) && props.shape) {
      if (props.shape.startsWith('ascending_')) props.shape = `ascending_${direction(props.shape.slice(10))}`;
      else {
        const dirs = props.shape.split('_').map(direction);
        if (dirs.includes('north') && dirs.includes('south')) props.shape = 'north_south';
        else if (dirs.includes('east') && dirs.includes('west')) props.shape = 'east_west';
        else props.shape = `${dirs.includes('south') ? 'south' : 'north'}_${dirs.includes('east') ? 'east' : 'west'}`;
      }
    }
    if (mirror !== 'none') {
      if ((name === 'chest' || name === 'trapped_chest') && props.type) props.type = flip(props.type);
      if (/_door$/.test(name) && props.hinge) props.hinge = flip(props.hinge);
      if (/_stairs$/.test(name) && /^(inner|outer)_(left|right)$/.test(props.shape)) {
        const [part, side] = props.shape.split('_');
        props.shape = `${part}_${flip(side)}`;
      }
    }
    if (Object.hasOwn(props, 'rotation')) {
      let r = Number(props.rotation);
      if (mirror === 'left_right') r = 16 - r;
      if (mirror === 'front_back') r = 8 - r;
      props.rotation = String((r + rotation / 90 * 4 + 16) % 16);
    }
    return {x: origin.x + x, y: origin.y + b.y + parsed.offset.y, z: origin.z + z, name: b.name, props, ...(b.items ? {items: b.items} : {})};
  }).sort(byPosition);
}

function buildOrder(targets) {
  const rest = [], last = [], unsupported = [], deferred = new Set();
  const power = new Set(['redstone_block', 'redstone_torch', 'redstone_wall_torch', 'lever', 'observer',
    'piston', 'sticky_piston', 'daylight_detector', 'tripwire_hook']);
  const attachments = new Set(['redstone_wire', 'repeater', 'comparator', 'torch', 'wall_torch', 'soul_torch',
    'soul_wall_torch', 'ladder', 'lantern', 'soul_lantern']);
  const nameOf = (b) => b.name.replace(/^minecraft:/, '');
  const attached = (b) => attachments.has(nameOf(b)) || /rail$|_(button|carpet|trapdoor)$/.test(nameOf(b));
  let skipped = 0;
  for (const b of targets) {
    if (skip(b.name, b.props)) { skipped++; continue; }
    if (placement(b.name, b.props) === null) { unsupported.push({x: b.x, y: b.y, z: b.z, name: b.name}); continue; }
    if (power.has(nameOf(b)) || /_pressure_plate$/.test(nameOf(b))) last.push(b);
    else rest.push(b);
  }
  rest.sort((a, b) => a.y - b.y || Number(attached(a)) - Number(attached(b)) || a.z - b.z || a.x - b.x);
  last.sort(byPosition);
  for (const b of last) deferred.add(`${b.x},${b.y},${b.z}`);
  return {order: [...rest, ...last], deferred, unsupported: unsupported.sort(byPosition), skipped};
}

module.exports = {parseLitematic, billOfMaterials, placeSchematic, buildOrder};
