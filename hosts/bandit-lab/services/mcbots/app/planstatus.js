'use strict';
// Plan status, world worker side: every cell of a schematic plan against the world model, answered as one gzipped
// JSON. Loaded on the first request only; the hub's main loop never parses or compares, it relays the bytes.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const build = require('./build');
const placing = require('./placing');
const schematic = require('./schematic');
const {BadQuery, TooBig} = require('./worldquery');
const {cellIndex, isAir, SY_MIN, SY_MAX} = require('./worldsection');

const MAX_CELLS = 200000, MAX_FILES = 4, MAX_RESULTS = 8, XZ_MAX = 30000000;
const FLUID = /^(water|lava|bubble_column)$/;

// 'minecraft:oak_stairs[facing=east,half=bottom]' -> {name: 'oak_stairs', props: {facing: 'east', half: 'bottom'}}
function parseState(state) {
  const i = state.indexOf('[');
  return {name: (i < 0 ? state : state.slice(0, i)).replace(/^minecraft:/, ''),
    props: i < 0 ? {} : Object.fromEntries(state.slice(i + 1, -1).split(',').filter(Boolean).map((kv) => kv.split('=')))};
}

// 1 built, 0 missing (the cell is free: something may be placed there), 2 wrong.
function cellStatus(want, state) {
  const have = parseState(state);
  if (placing.matches(want, have)) return 1;
  return isAir(state) || build.REPLACEABLE.has(have.name) || FLUID.test(have.name) ? 0 : 2;
}

// A cache entry is its promise: callers that overlap share one computation, a failure is not kept.
function once(map, key, tag, max, make) {
  const hit = map.get(key);
  if (hit?.tag === tag) return hit.promise;
  const promise = make().catch((e) => { if (map.get(key)?.promise === promise) map.delete(key); throw e; });
  map.delete(key);
  map.set(key, {tag, promise});
  if (map.size > max) map.delete(map.keys().next().value);
  return promise;
}

function makePlanStatus({src, seq, readFile = fs.promises.readFile, stat = fs.promises.stat, maxCells = MAX_CELLS}) {
  const files = new Map(), results = new Map(); // name -> {tag, promise}

  // Status 3 (unknown) for a cell outside the model: never read as air, never as missing.
  function compare(cells) {
    const chunks = new Map(), sections = new Map(), names = new Map(), blocks = [], counts = [0, 0, 0, 0];
    for (const c of cells) {
      const cx = c.x >> 4, cz = c.z >> 4, sy = c.y >> 4;
      let st = chunks.get(`${cx},${cz}`);
      if (st === undefined) chunks.set(`${cx},${cz}`, st = src.chunk(cx, cz));
      let s = 3;
      if (st === 'known' && sy >= SY_MIN && sy <= SY_MAX) {
        let sec = sections.get(`${cx},${sy},${cz}`);
        if (sec === undefined) sections.set(`${cx},${sy},${cz}`, sec = src.section(cx, sy, cz));
        if (sec) s = cellStatus(c, sec.palette[sec.idx ? sec.idx[cellIndex(c.x & 15, c.y & 15, c.z & 15)] : 0]);
      }
      if (!names.has(c.name)) names.set(c.name, names.size);
      counts[s]++;
      blocks.push([c.x, c.y, c.z, names.get(c.name), s]);
    }
    return {palette: [...names.keys()], blocks, counts};
  }

  return async function status({dir, file, origin, rotation, mirror, substitute, anySolid}) {
    if (typeof file !== 'string' || !build.SCHEMATIC_RE.test(file)) throw new BadQuery('bad file');
    if (!['x', 'y', 'z'].every((a) => Number.isInteger(origin?.[a]) && Math.abs(origin[a]) <= XZ_MAX)) throw new BadQuery('bad origin');
    const at = {x: origin.x, y: origin.y, z: origin.z};
    let st;
    try { st = await stat(path.join(dir, file)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    const stamp = `${st.mtimeMs}:${st.size}`; // a file replaced under its name is read again
    const key = JSON.stringify([file, at, rotation, mirror, substitute, anySolid]);
    return once(results, key, `${stamp}|${seq()}`, MAX_RESULTS, async () => {
      const parsed = await once(files, file, stamp, MAX_FILES, async () => schematic.parseLitematic(await readFile(path.join(dir, file))));
      // Equal to the cell count: the parser drops air and fluids, the plan keeps every other block.
      if (parsed.blocks.length > maxCells) throw new TooBig(`plan: ${parsed.blocks.length} cells > ${maxCells}`);
      const {cells} = build.planCells(parsed, {origin: at, rotation, mirror, substitute, anySolid});
      const now = seq(); // read with the compare, no await between: the answer is the world at this seq
      return zlib.gzipSync(JSON.stringify({file, origin: at, seq: now, ...compare(cells)}));
    });
  };
}

module.exports = {parseState, cellStatus, makePlanStatus, MAX_CELLS};
