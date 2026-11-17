'use strict';
// Bounded queries over the world model: blocks of a box, a height map, a material count. Pure: the section
// data comes from `src` (the store, in the worker thread); nothing here touches disk.
const {cellIndex, nameOf, isAir, SY_MIN, SY_MAX} = require('./worldsection');

const LIMITS = {blocks: 32768, height: 128, materials: 2000000};
const Y_MIN = SY_MIN * 16, Y_MAX = SY_MAX * 16 + 15, XZ_MAX = 30000000; // the world border is 29,999,984
class BadQuery extends Error {}
class TooBig extends Error {}

function int(v, lo, hi) {
  const n = typeof v === 'string' ? (/^-?\d+$/.test(v) ? Number(v) : NaN) : v; // '' and '1.5' are not numbers here
  if (!Number.isInteger(n) || n < lo || n > hi) throw new BadQuery('bad coordinate');
  return n;
}
const order = (a, b) => (a <= b ? [a, b] : [b, a]);
function parseRect(q) {
  const [x1, x2] = order(int(q.x1, -XZ_MAX, XZ_MAX), int(q.x2, -XZ_MAX, XZ_MAX));
  const [z1, z2] = order(int(q.z1, -XZ_MAX, XZ_MAX), int(q.z2, -XZ_MAX, XZ_MAX));
  return {x1, z1, x2, z2};
}
function parseBox(q) {
  const [y1, y2] = order(int(q.y1, Y_MIN, Y_MAX), int(q.y2, Y_MIN, Y_MAX));
  const {x1, z1, x2, z2} = parseRect(q);
  return {x1, y1, z1, x2, y2, z2};
}

const tooBig = (n, max, what) => { if (n > max) throw new TooBig(`${what}: ${n} > ${max}`); };
const volume = (b) => (b.x2 - b.x1 + 1) * (b.y2 - b.y1 + 1) * (b.z2 - b.z1 + 1);

// Visit every chunk of the rect with its sections sy1..sy2 (array index sy - sy1). A chunk that is not 'known'
// is listed once (unknown / ungenerated, cx then cz ascending) and not visited. A known chunk that lacks a
// section in range is inconsistent: shortcut, it is reported unknown as a whole, never read as air.
function walk(src, b, sy1, sy2, visit) {
  const unknown = [], ungenerated = [];
  for (let cx = b.x1 >> 4; cx <= b.x2 >> 4; cx++) for (let cz = b.z1 >> 4; cz <= b.z2 >> 4; cz++) {
    const st = src.chunk(cx, cz);
    if (st === 'ungenerated') { ungenerated.push([cx, cz]); continue; }
    const secs = [];
    if (st === 'known') for (let sy = sy1; sy <= sy2; sy++) { const s = src.section(cx, sy, cz); if (!s) break; secs.push(s); }
    if (secs.length !== sy2 - sy1 + 1) { unknown.push([cx, cz]); continue; }
    visit(cx, cz, secs);
  }
  return {unknown, ungenerated};
}

// fn(x, y, z, state) for every non-air cell of the box inside this chunk.
function eachBlock(cx, cz, secs, sy1, b, fn) {
  const xa = Math.max(b.x1, cx << 4), xb = Math.min(b.x2, (cx << 4) + 15);
  const za = Math.max(b.z1, cz << 4), zb = Math.min(b.z2, (cz << 4) + 15);
  secs.forEach(({palette, idx}, i) => {
    const sy = sy1 + i, ya = Math.max(b.y1, sy << 4), yb = Math.min(b.y2, (sy << 4) + 15), air = palette.map(isAir);
    for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) {
      const p = idx ? idx[cellIndex(x & 15, y & 15, z & 15)] : 0;
      if (!air[p]) fn(x, y, z, palette[p]);
    }
  });
}

const interner = () => { const ids = new Map(), list = []; return {list, id: (s) => { let i = ids.get(s); if (i === undefined) { i = list.push(s) - 1; ids.set(s, i); } return i; }}; };

function makeQuery(src) {
  return {
    blocks(q) {
      const box = parseBox(q);
      tooBig(volume(box), LIMITS.blocks, 'blocks');
      const pal = interner(), blocks = [];
      const miss = walk(src, box, box.y1 >> 4, box.y2 >> 4, (cx, cz, secs) =>
        eachBlock(cx, cz, secs, box.y1 >> 4, box, (x, y, z, s) => blocks.push([x, y, z, pal.id(s)])));
      return {box, palette: pal.list, blocks, ...miss};
    },
    height(q) {
      const rect = parseRect(q), w = rect.x2 - rect.x1 + 1, d = rect.z2 - rect.z1 + 1;
      tooBig(Math.max(w, d), LIMITS.height, 'height');
      const pal = interner(), heights = new Array(w * d).fill(null), tops = new Array(w * d).fill(-1);
      const miss = walk(src, rect, SY_MIN, SY_MAX, (cx, cz, secs) => {
        for (let z = Math.max(rect.z1, cz << 4); z <= Math.min(rect.z2, (cz << 4) + 15); z++)
          for (let x = Math.max(rect.x1, cx << 4); x <= Math.min(rect.x2, (cx << 4) + 15); x++) {
            top: for (let i = secs.length - 1; i >= 0; i--) {
              const {palette, idx} = secs[i];
              if (!idx && isAir(palette[0])) continue;
              for (let ly = 15; ly >= 0; ly--) {
                const s = palette[idx ? idx[cellIndex(x & 15, ly, z & 15)] : 0];
                if (isAir(s)) continue;
                const o = (z - rect.z1) * w + (x - rect.x1);
                heights[o] = (SY_MIN + i) * 16 + ly; tops[o] = pal.id(s);
                break top;
              }
            }
          }
      });
      return {rect, palette: pal.list, heights, tops, ...miss};
    },
    materials(q) {
      const box = parseBox(q);
      tooBig(volume(box), LIMITS.materials, 'materials');
      const counts = new Map();
      const miss = walk(src, box, box.y1 >> 4, box.y2 >> 4, (cx, cz, secs) =>
        eachBlock(cx, cz, secs, box.y1 >> 4, box, (x, y, z, s) => counts.set(s, (counts.get(s) || 0) + 1)));
      const byName = new Map();
      for (const [s, n] of counts) byName.set(nameOf(s), (byName.get(nameOf(s)) || 0) + n);
      return {box, counts: Object.fromEntries(byName), ...miss};
    },
  };
}

module.exports = {LIMITS, parseBox, parseRect, BadQuery, TooBig, makeQuery};
