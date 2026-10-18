'use strict';
// Tunnel highways the bots build with the schematic job (tight + anySolid): walking over the hills between the base,
// the iron farm and the sorter site, they missed their 90 s leg deadlines, met mobs at night and left pillars and
// dirt bridges (main server 2026-10-18). Fast minecarts are still an experiment in 26.x; a lit tunnel the pathfinder
// can sprint through is the fastest way they can use today.
const fs = require('node:fs');
const {writeLitematic} = require('./litematic-write');

// Straight legs between points along x or z: `width` blocks of walkway with `height` air above, a wall each side,
// floor and ceiling. A rise is spread over its leg (flat walking before and after): the higher block's floor is a
// stair facing uphill, so it is walked up without a jump. -> {blocks, air} in world coordinates. Where legs meet,
// air wins over wall.
function tunnel(points, {width = 3, height = 3, block = 'cobblestone', stairs = 'cobblestone_stairs', light = 6} = {}) {
  if (!Array.isArray(points) || points.length < 2 || !Number.isInteger(width) || width < 1 || width % 2 !== 1 ||
    !Number.isInteger(height) || height < 2 || !Number.isInteger(light) || light < 1) throw new Error('invalid tunnel options or points');
  const solid = new Map(), air = new Set();
  const key = (x, y, z) => `${x},${y},${z}`;
  const put = (x, y, z, name, props = {}) => solid.set(key(x, y, z), {x, y, z, name, props});
  const half = (width - 1) / 2;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    // A leg down is the same leg up, walked the other way.
    const [a, b] = points[i].y < points[i - 1].y ? [points[i], points[i - 1]] : [points[i - 1], points[i]];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.abs(dx || dz), rise = b.y - a.y;
    if (!len || (dx && dz) || rise > len) throw new Error('a leg runs along x or z and rises no more than its length');
    const n = Math.sign(dx || dz), along = dx ? 'x' : 'z', across = dx ? 'z' : 'x';
    const dir = dx ? (n > 0 ? 'east' : 'west') : (n > 0 ? 'south' : 'north');
    const flat = Math.floor((len - rise) / 2);
    let prev = a.y;
    for (let j = 0; j <= len; j++) {
      const y = a.y + Math.max(0, Math.min(rise, j - flat)), up = y > prev;
      prev = y;
      const at = (w) => ({x: a.x + (along === 'x' ? n * j : 0) + (across === 'x' ? w : 0), z: a.z + (along === 'z' ? n * j : 0) + (across === 'z' ? w : 0)});
      for (let w = -half - 1; w <= half + 1; w++) {
        const c = at(w), wall = Math.abs(w) > half;
        if (!wall && up) put(c.x, y - 1, c.z, stairs, {facing: dir, half: 'bottom', shape: 'straight', waterlogged: 'false'});
        else put(c.x, y - 1, c.z, block);
        put(c.x, y + height, c.z, block);
        for (let h = 0; h < height; h++) {
          if (wall) put(c.x, y + h, c.z, block);
          else air.add(key(c.x, y + h, c.z));
        }
      }
      if (j && ++walked % light === 0) {
        // On alternate walls, in the walkway cell beside the wall it hangs on, pointing into the tunnel.
        const side = (walked / light) % 2 ? -1 : 1, c = at(side * half);
        put(c.x, y + Math.min(2, height - 1), c.z, 'wall_torch', {facing: side < 0 ? {x: 'east', z: 'south'}[across] : {x: 'west', z: 'north'}[across]});
      }
    }
  }
  for (const k of air) if (solid.get(k)?.name !== 'wall_torch') solid.delete(k);
  for (const [k, b] of solid) if (b.name === 'wall_torch') air.delete(k);
  const toXyz = (k) => { const [x, y, z] = k.split(',').map(Number); return {x, y, z}; };
  return {blocks: [...solid.values()], air: [...air].map(toXyz)};
}

// The schematic for one tunnel, its region at 0,0,0: build it with the returned `origin`.
function schematic(points, opts = {}) {
  const {blocks, air} = tunnel(points, opts);
  const all = [...blocks, ...air], lo = {}, hi = {};
  for (const ax of ['x', 'y', 'z']) { lo[ax] = Math.min(...all.map((c) => c[ax])); hi[ax] = Math.max(...all.map((c) => c[ax])); }
  const rel = (c) => ({...c, x: c.x - lo.x, y: c.y - lo.y, z: c.z - lo.z});
  const size = {x: hi.x - lo.x + 1, y: hi.y - lo.y + 1, z: hi.z - lo.z + 1};
  const cells = [...blocks.map(rel), ...air.map((c) => ({...rel(c), name: 'air', props: {}}))];
  const counts = {};
  for (const c of cells) counts[c.name] = (counts[c.name] || 0) + 1;
  return {origin: lo, size, counts, buffer: writeLitematic({name: opts.name || 'Tunnel highway', regions: [{name: 'Highway', position: {x: 0, y: 0, z: 0}, size, blocks: cells}]})};
}

if (require.main === module) {
  const [out, ...raw] = process.argv.slice(2);
  const points = raw.map((s) => {
    const p = s.split(',').map(Number);
    if (p.length !== 3 || !p.every(Number.isInteger)) throw new Error(`invalid point: ${s}`);
    return {x: p[0], y: p[1], z: p[2]};
  });
  if (!out || points.length < 2) throw new Error('usage: node highway.js out.litematic x,y,z x,y,z ...');
  const s = schematic(points, {name: require('node:path').basename(out, '.litematic')});
  fs.writeFileSync(out, s.buffer);
  const length = points.slice(1).reduce((t, p, i) => t + Math.abs(p.x - points[i].x) + Math.abs(p.z - points[i].z), 0);
  console.log(JSON.stringify({origin: s.origin, size: s.size, counts: s.counts, length}));
}
module.exports = {tunnel, schematic};
