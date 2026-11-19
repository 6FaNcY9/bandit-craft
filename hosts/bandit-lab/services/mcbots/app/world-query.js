#!/usr/bin/env node
'use strict';
// world-query: read-only laptop CLI, the architect's eyes on the live world. Hub GETs only: no POST, no RCON,
// no bot orders. Run `node world-query.js --help` for the verbs and conventions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const HUB = process.env.WORLD_HUB || 'https://bandit-lab.tail7facc9.ts.net:8445';
const MAX_OUT = 8192, MAX_LINES = 150, MAX_CONFLICTS = 40, MAX_BOX = 2000000;
const IMPORTED = {x: -270, z: -20, r: 320};
const SITES = path.join(os.homedir(), '.local/share/bandit-bots/sites.json');

const HELP = `world-query: read-only view of the live Minecraft world (hub ${HUB}, override with WORLD_HUB)
usage: node world-query.js <verb> ...

verbs
  map x1 z1 x2 z2 [--step n]   HEIGHT grid (absolute y) and TOP grid (glyph of the top block). At most 32x32
                               cells; a bigger area needs --step n, each cell is then the maximum of its n x n
                               blocks (header says cell=max, NOT for placement) and is ?? if any block is unknown.
  cut x1 y1 z1 x2 y2 z2        one axis must have thickness 1. y thin: plan view (rows z, cols x). z thin:
                               section looking north, east=right. x thin: section looking east, south=right.
                               Sections have the highest y at the top. At most 64 columns.
  cells x1 y1 z1 x2 y2 z2 [--grep text]
                               exact list "x y z full-state", runs along x as "x1..x2 y z state". Air is not
                               listed. Unknown and ungenerated chunks get their own line. Over ${MAX_LINES} lines it stops.
  info x1 z1 x2 z2             placed plans touching the rect (box, built/missing/wrong/unknown), players and
                               bots in it, the 15 most common materials from the lowest surface y - 4 up to the
                               highest top y, unknown chunks, distance to the edge of the imported area.
  png x1 z1 x2 z2 [--out f.png] overview image, at most 128x128 blocks, 8 px per block. Prints the path and line 1.
                               colour = top block, brighter = higher, dark contour lines every 4 y, y number at
                               every 16-block crossing, thin grid every 8, thick on chunk borders (x, z labels),
                               magenta hatch = unknown, dark grey = ungenerated, red box = placed plan,
                               yellow dot = plan cell still missing.
  check plan.json              plan {"set":[[x,y,z,"block-state"]],"remove":[[x,y,z]]}, absolute coordinates,
                               against the world. Exit code 1 on any REPLACE or unknown-chunk cell, 2 on errors.

conventions
  - Line 1: verb, inclusive ranges, size, north=up east=right step. Line 2: surface at the rect's corners
    NW/NE/SW/SE as (x,z) y=top-y block (for cut/cells/check: the corners of the box's x/z footprint).
  - North is up: the first row is the smallest z; x grows to the right. Every row starts with its absolute z
    (or y); the header carries the absolute x (or z) at every 4th column, right-aligned on that column (1-char
    grids use two staggered header rows so the labels never touch).
  - ?? / ? = unknown chunk (never air), -- / - = ungenerated chunk, . = air. A space is never a value.
  - HEIGHT is the top non-air block. A trailing ' means that block is not a full block (fluid, plant, flower,
    leaves, torch, snow layer, slab that is not double, stairs, fence, wall, pane, door, carpet, rail, sign,
    lantern, chest and similar): the ground is lower.
  - Glyphs: fixed ~ water, ! lava, # stone, % deepslate, , grass_block, : dirt, ; sand, + gravel, " leaves,
    | log/wood, = planks, & cobblestone, @ stone_bricks, ^ snow layer, * grass/fern, $ torch, / stairs, _ slab.
    A fixed glyph goes to the most common matching full state; every other state gets a letter or digit per
    call. Each glyph means one full block state within one output; the legend at the bottom gives
    glyph, full state, count, y range.
  - Output is at most ${MAX_OUT} bytes; above that nothing is printed and a smaller area is suggested.
  - Placed plans come from the bots' schematic projects (hub /api/state) plus ${SITES}
    ([{file, origin:[x,y,z]}]), each kept only if the file is in /api/schematics.
  - Imported area: circle centre (${IMPORTED.x},${IMPORTED.z}) radius ${IMPORTED.r} (treated as a circle).
`;

class Fail extends Error {}

async function get(p) {
  const r = await fetch(HUB + p);
  const body = await r.text();
  if (!r.ok) throw new Fail(`hub ${p.split('?')[0]}: ${r.status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}
const qs = (o) => new URLSearchParams(o).toString();
async function pool(jobs, n = 6) {
  let i = 0;
  await Promise.all(Array.from({length: Math.min(n, jobs.length)}, async () => { while (i < jobs.length) await jobs[i++](); }));
}

function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') flags.help = true;
    else if (a.startsWith('--')) { if (i + 1 >= argv.length) throw new Fail(`${a} needs a value`); flags[a.slice(2)] = argv[++i]; }
    else pos.push(a);
  }
  return {pos, flags};
}
function ints(pos, n, usage) {
  const v = pos.slice(0, n).map(Number);
  if (pos.length !== n || !v.every(Number.isInteger)) throw new Fail(`usage: ${usage}`);
  return v;
}
const span = (a, b) => [Math.min(a, b), Math.max(a, b)];

const nameOf = (s) => s.replace(/^minecraft:/, '').replace(/\[.*$/, '');
const isAir = (s) => /^(cave_|void_)?air$/.test(nameOf(s));
const propsOf = (s) => { const i = s.indexOf('['); return i < 0 ? {} : Object.fromEntries(s.slice(i + 1, -1).split(',').filter(Boolean).map((kv) => kv.split('='))); };
const NOT_FULL = /water|lava|bubble_column|leaves|torch|flower|tulip|orchid|allium|bluet|daisy|poppy|dandelion|cornflower|lily|rose|peony|lilac|petals|grass$|fern$|bush|sapling|propagule|mushroom$|fungus|roots|sprouts|vine|lichen|carpet|^snow$|_slab$|_stairs$|fence|_wall$|pane$|bars$|door$|button$|pressure_plate$|rail$|sign$|banner$|lantern$|chain$|ladder$|lever$|candle|head$|skull$|pot$|_bed$|campfire|wheat|carrots|potatoes|beetroots|_stem$|cocoa|sugar_cane|bamboo$|kelp|seagrass|sea_pickle|coral(?!_block)|dripleaf|cactus|cobweb|scaffolding|fire$|redstone_wire|repeater$|comparator$|tripwire|_rod$|cluster$|_bud$|pointed_dripstone|chest$|anvil$|cake$|azalea$|hopper$|cauldron$|brewing_stand|enchanting_table|grindstone|stonecutter|bell$|lectern|conduit|frogspawn|spore_blossom/;
const notFull = (s) => NOT_FULL.test(nameOf(s)) && !(nameOf(s).endsWith('_slab') && propsOf(s).type === 'double');
// a plan state matches the world when the names agree and every property the plan gives agrees
const sameState = (now, want) => nameOf(now) === nameOf(want) && Object.entries(propsOf(want)).every(([k, v]) => propsOf(now)[k] === v);

const chunkKey = (x, z) => `${x >> 4},${z >> 4}`;
function chunkStatus(unknown, ungen) {
  return (x, z) => { const k = chunkKey(x, z); return unknown.has(k) ? 'unknown' : ungen.has(k) ? 'ungenerated' : 'known'; };
}
function addChunks(r, unknown, ungen) {
  for (const [cx, cz] of r.unknown || []) unknown.add(`${cx},${cz}`);
  for (const [cx, cz] of r.ungenerated || []) ungen.add(`${cx},${cz}`);
}

// Heights of a rect, tiled at the hub's 128 per side. at(x, z) -> {y, state, st}
async function heightGrid(x1, z1, x2, z2) {
  const W = x2 - x1 + 1, D = z2 - z1 + 1, ys = new Array(W * D).fill(null), states = new Array(W * D).fill(null);
  const unknown = new Set(), ungen = new Set(), jobs = [];
  for (let tz = z1; tz <= z2; tz += 128) for (let tx = x1; tx <= x2; tx += 128) {
    const bx = Math.min(tx + 127, x2), bz = Math.min(tz + 127, z2), w = bx - tx + 1;
    jobs.push(() => get(`/api/world/height?${qs({x1: tx, z1: tz, x2: bx, z2: bz})}`).then((r) => {
      addChunks(r, unknown, ungen);
      r.heights.forEach((y, i) => {
        const k = (tz + Math.floor(i / w) - z1) * W + (tx + i % w - x1);
        ys[k] = y; states[k] = r.tops[i] < 0 ? null : r.palette[r.tops[i]];
      });
    }));
  }
  await pool(jobs);
  const st = chunkStatus(unknown, ungen);
  return {unknown, ungen, at: (x, z) => { const k = (z - z1) * W + (x - x1); return {y: ys[k], state: states[k], st: st(x, z)}; }};
}

// Non-air blocks of a box, tiled at the hub's 32,768 cells per call. at() is the state or null for air.
async function blockBox(x1, y1, z1, x2, y2, z2, max = MAX_BOX) {
  const W = x2 - x1 + 1, H = y2 - y1 + 1, D = z2 - z1 + 1;
  if (W * H * D > max) throw new Fail(`box has ${W * H * D} cells, max ${max}: use a smaller box`);
  const tx = Math.min(W, 32), tz = Math.min(D, 32), ty = Math.max(1, Math.min(H, Math.floor(32768 / (tx * tz))));
  const map = new Map(), unknown = new Set(), ungen = new Set(), jobs = [];
  for (let y = y1; y <= y2; y += ty) for (let z = z1; z <= z2; z += tz) for (let x = x1; x <= x2; x += tx) {
    const b = {x1: x, y1: y, z1: z, x2: Math.min(x + tx - 1, x2), y2: Math.min(y + ty - 1, y2), z2: Math.min(z + tz - 1, z2)};
    jobs.push(() => get(`/api/world/blocks?${qs(b)}`).then((r) => {
      addChunks(r, unknown, ungen);
      for (const [bx, by, bz, i] of r.blocks) if (!isAir(r.palette[i])) map.set(`${bx},${by},${bz}`, r.palette[i]);
    }));
  }
  await pool(jobs);
  return {unknown, ungen, st: chunkStatus(unknown, ungen), at: (x, y, z) => map.get(`${x},${y},${z}`) ?? null};
}

// ---- text output ----

function line1(verb, b, step = 1) {
  const hasY = b.y1 !== undefined;
  const dims = [b.x2 - b.x1 + 1, ...(hasY ? [b.y2 - b.y1 + 1] : []), b.z2 - b.z1 + 1].join('x');
  return `${verb} x=${b.x1}..${b.x2}${hasY ? ` y=${b.y1}..${b.y2}` : ''} z=${b.z1}..${b.z2} (inclusive, ${dims}) north=up east=right step=${step}` +
    (step > 1 ? ' cell=max, NOT for placement' : '');
}
const surface = (c) => c.st === 'unknown' ? '??' : c.st === 'ungenerated' ? '--' : c.y === null ? 'air' : `y=${c.y} ${nameOf(c.state)}`;
function cornersText(at, x1, z1, x2, z2) {
  return [['NW', x1, z1], ['NE', x2, z1], ['SW', x1, z2], ['SE', x2, z2]].map(([t, x, z]) => `${t}(${x},${z}) ${surface(at(x, z))}`).join(' | ');
}
async function corners(x1, z1, x2, z2) {
  const pts = new Map();
  await Promise.all([[x1, z1], [x2, z1], [x1, z2], [x2, z2]].map(async ([x, z]) => pts.set(`${x},${z}`, (await heightGrid(x, z, x, z)).at(x, z))));
  return cornersText((x, z) => pts.get(`${x},${z}`), x1, z1, x2, z2);
}

const FIXED = [['~', /^(water|bubble_column)$/], ['!', /^lava$/], ['#', /^stone$/], ['%', /^deepslate$/], [',', /^grass_block$/],
  [':', /^(dirt|coarse_dirt|rooted_dirt)$/], [';', /^sand$/], ['+', /^gravel$/], ['"', /_leaves$/], ['|', /_(log|wood)$/],
  ['=', /_planks$/], ['&', /^cobblestone$/], ['@', /^stone_bricks$/], ['^', /^snow$/], ['*', /^(short_grass|grass|tall_grass|fern|large_fern)$/],
  ['$', /torch$/], ['/', /_stairs$/], ['_', /_slab$/]];
const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>{}()[]\\`';
const SPECIAL = {'.': 'air', '?': 'unknown chunk (never air)', '-': 'ungenerated chunk'};

// stats: Map state -> {n, lo, hi}. Returns Map state -> glyph, one glyph per full state.
function glyphs(stats) {
  const order = [...stats.keys()].sort((a, b) => stats.get(b).n - stats.get(a).n || (a < b ? -1 : 1));
  const used = new Set(), g = new Map();
  let p = 0;
  for (const s of order) {
    let c = FIXED.find(([f, re]) => !used.has(f) && re.test(nameOf(s)))?.[0];
    if (!c) c = POOL[p++];
    if (!c) throw new Fail(`more than ${POOL.length + FIXED.length} different blocks: use a smaller area`);
    used.add(c); g.set(s, c);
  }
  return g;
}
function tally(stats, key, y) {
  const t = stats.get(key);
  if (t) { t.n++; t.lo = Math.min(t.lo, y); t.hi = Math.max(t.hi, y); } else stats.set(key, {n: 1, lo: y, hi: y});
}
function legend(stats, g, special) {
  const out = ['legend: glyph  full block-state  count  y-range'];
  for (const [c, n] of Object.entries(special)) if (n) out.push(`${c}  ${SPECIAL[c]}  ${n}`);
  for (const [s, c] of g) { const t = stats.get(s); out.push(`${c}  ${s}  ${t.n}  y=${t.lo}..${t.hi}`); }
  return out;
}

// rows: [[cell string of width cw]], labelled with axis=value; columns carry labels at every 4th column.
function grid(axis, rowVals, colVals, rows, cw) {
  const pre = (v) => `${axis}=${String(v).padStart(4)} |`, P = pre(0).length;
  const heads = cw >= 4 ? [[0, 4]] : [[0, 8], [4, 8]];
  const out = heads.map(([off, every]) => {
    const s = Array(P + colVals.length * cw).fill(' ');
    let free = 0; // first position a label may use: one space after the previous label
    colVals.forEach((v, i) => {
      if (i % every !== off) return;
      const t = String(v), start = P + (i + 1) * cw - (cw >= 4 ? 1 : 0) - t.length; // wide cells end in their marker slot
      if (start < free) return;
      s.splice(start, t.length, ...t); free = start + t.length + 1;
    });
    return s.join('').trimEnd();
  });
  rows.forEach((r, i) => out.push((pre(rowVals[i]) + r.join('')).trimEnd()));
  return out;
}

// ---- verbs ----

async function map(pos, flags) {
  const [a, b, c, d] = ints(pos, 4, 'map x1 z1 x2 z2 [--step n]');
  const [x1, x2] = span(a, c), [z1, z2] = span(b, d), W = x2 - x1 + 1, D = z2 - z1 + 1;
  const step = flags.step === undefined ? 1 : Number(flags.step);
  if (!Number.isInteger(step) || step < 1) throw new Fail('--step must be a whole number >= 1');
  const nx = Math.ceil(W / step), nz = Math.ceil(D / step);
  if (nx > 32 || nz > 32) throw new Fail(`map is ${nx}x${nz} cells, max 32x32: use --step ${Math.ceil(Math.max(W, D) / 32)}`);
  if (W > 1024 || D > 1024) throw new Fail('map: at most 1024 blocks per side');
  const hg = await heightGrid(x1, z1, x2, z2);
  const cells = mapCells(hg.at, x1, z1, x2, z2, step);
  return {text: renderMap(cells, {x1, z1, x2, z2, step}, cornersText(hg.at, x1, z1, x2, z2))};
}

// One cell per step x step blocks: the highest known top; ?? if any block is unknown, -- if none is generated.
function mapCells(at, x1, z1, x2, z2, step) {
  const rows = [];
  for (let z0 = z1; z0 <= z2; z0 += step) {
    const row = [];
    for (let x0 = x1; x0 <= x2; x0 += step) {
      let unk = false, known = 0, best = null;
      for (let z = z0; z <= Math.min(z0 + step - 1, z2); z++) for (let x = x0; x <= Math.min(x0 + step - 1, x2); x++) {
        const c = at(x, z);
        if (c.st === 'unknown') unk = true;
        else if (c.st === 'known') { known++; if (c.y !== null && (!best || c.y > best.y)) best = c; }
      }
      row.push(unk ? {k: '?'} : !known ? {k: '-'} : !best ? {k: '.'} : {y: best.y, state: best.state});
    }
    rows.push(row);
  }
  return rows;
}

function renderMap(cells, b, cornerLine) {
  const stats = new Map(), special = {'.': 0, '?': 0, '-': 0};
  for (const r of cells) for (const c of r) if (c.k) special[c.k]++; else tally(stats, c.state, c.y);
  const g = glyphs(stats), xs = cells[0].map((_, i) => b.x1 + i * b.step), zs = cells.map((_, i) => b.z1 + i * b.step);
  // 3 chars of y, then the marker slot: ' when the top is not a full block, else a space
  const H = cells.map((r) => r.map((c) => (c.k ? c.k.repeat(c.k === '.' ? 1 : 2) : String(c.y)).padStart(3) + (!c.k && notFull(c.state) ? "'" : ' ')));
  const T = cells.map((r) => r.map((c) => c.k || g.get(c.state)));
  return [line1('map', b, b.step), cornerLine,
    `HEIGHT: absolute y of the top non-air block; ' = top is not a full block, the ground is lower`,
    ...grid('z', zs, xs, H, 4),
    'TOP: glyph of the top block',
    ...grid('z', zs, xs, T, 1),
    ...legend(stats, g, special)].join('\n') + '\n';
}

async function cut(pos) {
  const v = ints(pos, 6, 'cut x1 y1 z1 x2 y2 z2');
  const [x1, x2] = span(v[0], v[3]), [y1, y2] = span(v[1], v[4]), [z1, z2] = span(v[2], v[5]);
  const thin = [['x', x1 === x2], ['y', y1 === y2], ['z', z1 === z2]].filter(([, t]) => t).map(([a]) => a);
  if (thin.length !== 1) throw new Fail('cut: exactly one axis must have thickness 1 (e.g. z1 = z2 for a section)');
  const cols = thin[0] === 'x' ? z2 - z1 + 1 : x2 - x1 + 1;
  if (cols > 64) throw new Fail(`cut: ${cols} columns, max 64`);
  const [bb, cl] = await Promise.all([blockBox(x1, y1, z1, x2, y2, z2), corners(x1, z1, x2, z2)]);
  return {text: renderCut(bb, {x1, y1, z1, x2, y2, z2}, thin[0], cl)};
}

function renderCut(bb, b, thin, cornerLine) {
  const range = (lo, hi) => Array.from({length: hi - lo + 1}, (_, i) => lo + i);
  const ys = range(b.y1, b.y2).reverse(), xs = range(b.x1, b.x2), zs = range(b.z1, b.z2);
  // [row axis, row values, column values, cell(row, col) -> [x, y, z], view text]
  const view = thin === 'y' ? ['z', zs, xs, (r, c) => [c, b.y1, r], `plan view at y=${b.y1}, north=up east=right`]
    : thin === 'z' ? ['y', ys, xs, (r, c) => [c, r, b.z1], `section at z=${b.z1}, looking north, east=right, highest y at the top`]
      : ['y', ys, zs, (r, c) => [b.x1, r, c], `section at x=${b.x1}, looking east, south=right, columns are z, highest y at the top`];
  const [axis, rv, cv, xyz, text] = view, stats = new Map(), special = {'.': 0, '?': 0, '-': 0};
  const raw = rv.map((r) => cv.map((c) => {
    const [x, y, z] = xyz(r, c), st = bb.st(x, z);
    if (st !== 'known') { const k = st === 'unknown' ? '?' : '-'; special[k]++; return k; }
    const s = bb.at(x, y, z);
    if (!s) { special['.']++; return '.'; }
    tally(stats, s, y);
    return {s};
  }));
  const g = glyphs(stats);
  const rows = raw.map((r) => r.map((c) => (typeof c === 'string' ? c : g.get(c.s))));
  return [line1('cut', b), cornerLine, text, ...grid(axis, rv, cv, rows, 1), ...legend(stats, g, special)].join('\n') + '\n';
}

async function cells(pos, flags) {
  const v = ints(pos, 6, 'cells x1 y1 z1 x2 y2 z2 [--grep text]');
  const [x1, x2] = span(v[0], v[3]), [y1, y2] = span(v[1], v[4]), [z1, z2] = span(v[2], v[5]);
  const [bb, cl] = await Promise.all([blockBox(x1, y1, z1, x2, y2, z2), corners(x1, z1, x2, z2)]);
  const b = {x1, y1, z1, x2, y2, z2}, lines = cellLines(bb, b, flags.grep);
  if (lines.length > MAX_LINES) throw new Fail(`cells: ${lines.length} lines > ${MAX_LINES}, nothing printed: use a smaller box or --grep text`);
  return {text: [line1('cells', b), cl,
    `x y z full-state, runs along x as x1..x2; air is not listed${flags.grep ? `; only states containing "${flags.grep}"` : ''}; ${lines.length} lines`,
    ...lines].join('\n') + '\n'};
}

function cellLines(bb, b, grep) {
  const out = [];
  for (const [set, what] of [[bb.unknown, 'unknown, never air'], [bb.ungen, 'ungenerated']]) {
    for (const k of [...set].sort()) {
      const [cx, cz] = k.split(',').map(Number), xa = Math.max(cx * 16, b.x1), xb = Math.min(cx * 16 + 15, b.x2), za = Math.max(cz * 16, b.z1), zb = Math.min(cz * 16 + 15, b.z2);
      if (xa <= xb && za <= zb) out.push(`${what === 'ungenerated' ? '--' : '??'} chunk ${k} x=${xa}..${xb} z=${za}..${zb} y=${b.y1}..${b.y2} ${what}`);
    }
  }
  for (let y = b.y1; y <= b.y2; y++) for (let z = b.z1; z <= b.z2; z++) {
    let run = null;
    const flush = () => { if (run) out.push(`${run.a === run.b ? run.a : `${run.a}..${run.b}`} ${y} ${z} ${run.s}`); run = null; };
    for (let x = b.x1; x <= b.x2; x++) {
      const s = bb.st(x, z) === 'known' ? bb.at(x, y, z) : null;
      if (!s || (grep && !s.includes(grep))) { flush(); continue; }
      if (run?.s === s) run.b = x; else { flush(); run = {a: x, b: x, s}; }
    }
    flush();
  }
  return out;
}

// ---- placed plans ----

const PROJECT_RE = /^(\S+\.litematic) origin (-?\d+) (-?\d+) (-?\d+)(?: (\d+) (\S+))?/;
// shortcut: local sites list until One-view phase 2 keeps placed plans in the hub
function readSites(file = SITES) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return []; throw new Fail(`${file}: ${e.message}`); }
}
// Bot projects and local sites whose file the hub has; box is a generous guess until the status gives cells.
function siteList(projects, sites, schematics) {
  const known = new Map(schematics.map((s) => [s.file, s])), list = [];
  const add = (file, origin, src, q) => {
    const s = known.get(file);
    if (!s || !q || list.some((p) => p.file === file && p.origin.join() === origin.join())) return;
    const pad = ['x', 'y', 'z'].map((a) => Math.abs(s.offset?.[a] ?? 0) + Math.max(s.size.x, s.size.y, s.size.z));
    list.push({file, origin, src, q, lo: origin.map((o, i) => o - pad[i]), hi: origin.map((o, i) => o + pad[i])});
  };
  for (const [bot, p] of Object.entries(projects || {})) {
    const m = PROJECT_RE.exec(p.summary || '');
    if (!m) continue;
    const origin = [+m[2], +m[3], +m[4]], plain = (m[5] ?? '0') === '0' && (m[6] ?? 'none') === 'none';
    add(m[1], origin, `${bot} ${p.type}`, plain ? {file: m[1], origin: origin.join()} : p.type === 'schematic' ? {bot} : null);
  }
  for (const s of sites) add(s.file, s.origin, 'sites.json', {file: s.file, origin: s.origin.join()});
  return list;
}
// The plans whose cells touch box {x1,z1,x2,z2[,y1,y2]}, with their status and exact box.
async function plansIn(b) {
  const [state, schematics] = await Promise.all([get('/api/state'), get('/api/schematics')]);
  const yl = b.y1 ?? -64, yh = b.y2 ?? 319;
  const near = siteList(state.projects, readSites(), schematics)
    .filter((p) => p.lo[0] <= b.x2 && p.hi[0] >= b.x1 && p.lo[2] <= b.z2 && p.hi[2] >= b.z1 && p.lo[1] <= yh && p.hi[1] >= yl);
  const out = [];
  await pool(near.map((p) => async () => {
    const r = await get(`/api/plan/status?${qs(p.q)}`);
    if (!r.blocks.length) return;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const c of r.blocks) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); }
    if (lo[0] <= b.x2 && hi[0] >= b.x1 && lo[2] <= b.z2 && hi[2] >= b.z1 && lo[1] <= yh && hi[1] >= yl) out.push({...p, lo, hi, counts: r.counts, blocks: r.blocks});
  }), 4);
  return {plans: out.sort((p, q) => (p.file < q.file ? -1 : 1)), state};
}
const planLine = (p) => `${p.file} origin ${p.origin.join(' ')} [${p.src}] box x=${p.lo[0]}..${p.hi[0]} y=${p.lo[1]}..${p.hi[1]} z=${p.lo[2]}..${p.hi[2]}` +
  ` built ${p.counts[1]} missing ${p.counts[0]} wrong ${p.counts[2]} unknown ${p.counts[3]}`;

// Farthest and nearest rect point against the imported circle: positive = blocks inside the edge.
function edgeDistance(x1, z1, x2, z2, c = IMPORTED) {
  const far = Math.max(...[[x1, z1], [x2, z1], [x1, z2], [x2, z2]].map(([x, z]) => Math.hypot(x - c.x, z - c.z)));
  const near = Math.hypot(Math.max(x1 - c.x, 0, c.x - x2), Math.max(z1 - c.z, 0, c.z - z2));
  return {far: Math.floor(c.r - far), near: Math.floor(c.r - near)};
}

async function info(pos) {
  const [a, b, c, d] = ints(pos, 4, 'info x1 z1 x2 z2');
  const [x1, x2] = span(a, c), [z1, z2] = span(b, d), W = x2 - x1 + 1, D = z2 - z1 + 1;
  if (W > 256 || D > 256) throw new Fail('info: at most 256 blocks per side');
  const [hg, {plans, state}, world] = await Promise.all([heightGrid(x1, z1, x2, z2), plansIn({x1, z1, x2, z2}), get('/api/world')]);
  let lo = Infinity, hi = -Infinity;
  for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) { const h = hg.at(x, z); if (h.st === 'known' && h.y !== null) { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); } }
  const out = [line1('info', {x1, z1, x2, z2}), cornersText(hg.at, x1, z1, x2, z2)];
  out.push(`placed plans touching the rect (box = the plan's own cells): ${plans.length || 'none'}`, ...plans.map((p) => `  ${planLine(p)}`));
  const jobs = new Map((state.bots || []).map((bt) => [bt.name, bt.job]));
  const inRect = (world.players || []).filter((p) => p.dim === 'overworld' && Math.floor(p.x) >= x1 && Math.floor(p.x) <= x2 && Math.floor(p.z) >= z1 && Math.floor(p.z) <= z2);
  out.push(`players and bots in the rect: ${inRect.length || 'none'}`,
    ...inRect.map((p) => `  ${p.name} ${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}${jobs.has(p.name) ? ` bot job=${jobs.get(p.name)?.type ?? jobs.get(p.name) ?? 'none'}` : ''}`));
  if (lo <= hi) {
    let ylo = lo - 4;
    if ((hi - ylo + 1) * W * D > MAX_BOX) ylo = hi - Math.floor(MAX_BOX / (W * D)) + 1;
    const m = await get(`/api/world/materials?${qs({x1, y1: ylo, z1, x2, y2: hi, z2})}`);
    const top = Object.entries(m.counts).sort((p, q) => q[1] - p[1]);
    out.push(`materials y=${ylo}..${hi} (${ylo === lo - 4 ? 'lowest surface - 4' : 'cut to 2M cells'} .. highest top), air not counted, top 15 of ${top.length}:`,
      ...top.slice(0, 15).map(([n, k]) => `  ${nameOf(n)} ${k}`));
  } else out.push('materials: no known surface in the rect');
  out.push(`unknown chunks (never air): ${[...hg.unknown].sort().join(' ') || 'none'}`, `ungenerated chunks: ${[...hg.ungen].sort().join(' ') || 'none'}`);
  const e = edgeDistance(x1, z1, x2, z2);
  out.push(`imported area: circle centre (${IMPORTED.x},${IMPORTED.z}) radius ${IMPORTED.r}; farthest corner ${e.far >= 0 ? `${e.far} blocks inside` : `${-e.far} blocks outside`} the edge, nearest point ${e.near >= 0 ? `${e.near} inside` : `${-e.near} outside`}`);
  return {text: out.join('\n') + '\n'};
}

// ---- png ----

const FONT = {0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  '-': '000000111000000', '.': '000000000000010', '=': '000111000111000', ' ': '000000000000000',
  X: '101101010101101', Z: '111001010100111', N: '101111111101101', Y: '101101010010010'};
const COLOURS = [[/^(water|bubble_column)$/, [52, 92, 200]], [/^lava$/, [230, 100, 20]], [/^grass_block$/, [96, 160, 64]],
  [/leaves$/, [44, 110, 44]], [/^leaf_litter$/, [120, 112, 60]], [/_(log|wood)$/, [110, 80, 50]], [/_planks$/, [175, 135, 85]],
  [/^(dirt|coarse_dirt|rooted_dirt|dirt_path|farmland|mud|podzol)$/, [134, 96, 62]], [/sand/, [222, 210, 155]],
  [/^gravel$/, [140, 134, 128]], [/^(snow|snow_block|powder_snow)$/, [245, 248, 250]], [/ice$/, [160, 190, 240]],
  [/deepslate|blackstone|basalt/, [72, 72, 80]], [/stone|cobble|andesite|diorite|granite|tuff|brick/, [128, 128, 128]],
  [/grass|fern|flower|tulip|poppy|dandelion|bush|sapling|petals/, [110, 170, 70]]];
function colourOf(state) {
  const n = nameOf(state), hit = COLOURS.find(([re]) => re.test(n));
  if (hit) return hit[1];
  let h = 0;
  for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [100 + (h & 63), 100 + ((h >> 6) & 63), 70 + ((h >> 12) & 31)]; // olive to grey, never the unknown magenta
}

function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mod = (a, n) => ((a % n) + n) % n;
// at(x, z) -> {y, state, st}; plans: [{lo, hi, blocks}]. Returns {w, h, rgb}.
function drawMap(at, b, plans) {
  const S = 8, L = 44, T = 48, W = b.x2 - b.x1 + 1, D = b.z2 - b.z1 + 1, w = L + W * S + 24, h = T + D * S + 12;
  const rgb = Buffer.alloc(w * h * 3, 255);
  const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) { const i = (y * w + x) * 3; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2]; } };
  const rect = (x, y, rw, rh, c) => { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) px(x + i, y + j, c); };
  const dim = (x, y, f) => { if (x >= 0 && y >= 0 && x < w && y < h) { const i = (y * w + x) * 3; for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(rgb[i + k] * f); } };
  const text = (s, x, y, k, c) => { [...s].forEach((ch, n) => { const f = FONT[ch] || FONT[' ']; for (let i = 0; i < 15; i++) if (f[i] === '1') rect(x + (n * 4 + i % 3) * k, y + Math.floor(i / 3) * k, k, k, c); }); };
  const tw = (s, k) => s.length * 4 * k - k;
  const X = (x) => L + (x - b.x1) * S, Z = (z) => T + (z - b.z1) * S;
  let lo = Infinity, hi = -Infinity;
  for (let z = b.z1; z <= b.z2; z++) for (let x = b.x1; x <= b.x2; x++) { const c = at(x, z); if (c.st === 'known' && c.y !== null) { lo = Math.min(lo, c.y); hi = Math.max(hi, c.y); } }
  for (let z = b.z1; z <= b.z2; z++) for (let x = b.x1; x <= b.x2; x++) {
    const c = at(x, z);
    if (c.st === 'unknown') { for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) px(X(x) + i, Z(z) + j, mod(X(x) + i + Z(z) + j, 4) ? [60, 60, 60] : [255, 0, 255]); continue; }
    if (c.st === 'ungenerated' || c.y === null) { rect(X(x), Z(z), S, S, [40, 40, 40]); continue; }
    const f = hi > lo ? 0.65 + 0.6 * (c.y - lo) / (hi - lo) : 1;
    rect(X(x), Z(z), S, S, colourOf(c.state).map((v) => Math.min(255, Math.round(v * f))));
  }
  // contour where the 4-y band changes, drawn on the higher block's side of the edge
  const band = (x, z) => { const c = at(x, z); return c.st === 'known' && c.y !== null ? Math.floor(c.y / 4) : null; };
  for (let z = b.z1; z <= b.z2; z++) for (let x = b.x1; x <= b.x2; x++) {
    const m = band(x, z);
    if (m === null) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < b.x1 || nx > b.x2 || nz < b.z1 || nz > b.z2) continue;
      const n = band(nx, nz);
      if (n === null || n >= m) continue;
      for (let i = 0; i < S; i++) dim(dx ? X(x) + (dx > 0 ? S - 1 : 0) : X(x) + i, dz ? Z(z) + (dz > 0 ? S - 1 : 0) : Z(z) + i, 0.35);
    }
  }
  // grid: thin every 8, thick on chunk borders, labelled
  for (let x = b.x1; x <= b.x2 + 1; x++) {
    if (mod(x, 8)) continue;
    const thick = !mod(x, 16);
    for (let y = T; y < T + D * S; y++) { dim(X(x), y, thick ? 0 : 0.6); if (thick) dim(X(x) - 1, y, 0); }
    if (thick) text(String(x), X(x) - Math.floor(tw(String(x), 2) / 2), T - 13, 2, [0, 0, 0]);
  }
  for (let z = b.z1; z <= b.z2 + 1; z++) {
    if (mod(z, 8)) continue;
    const thick = !mod(z, 16);
    for (let x = L; x < L + W * S; x++) { dim(x, Z(z), thick ? 0 : 0.6); if (thick) dim(x, Z(z) - 1, 0); }
    if (thick) text(String(z), L - 3 - tw(String(z), 2), Z(z) - 4, 2, [0, 0, 0]);
  }
  // plans: yellow dot on missing cells, red outline of the plan's box
  for (const p of plans) {
    const seen = new Set();
    for (const [x, , z, , s] of p.blocks) {
      if (s !== 0 || x < b.x1 || x > b.x2 || z < b.z1 || z > b.z2 || seen.has(`${x},${z}`)) continue;
      seen.add(`${x},${z}`); rect(X(x) + 2, Z(z) + 2, 4, 4, [255, 220, 0]);
    }
    const ax = Math.max(p.lo[0], b.x1), bx = Math.min(p.hi[0], b.x2), az = Math.max(p.lo[2], b.z1), bz = Math.min(p.hi[2], b.z2);
    for (let i = X(ax); i < X(bx + 1); i++) for (const y of [Z(az), Z(az) + 1, Z(bz + 1) - 2, Z(bz + 1) - 1]) px(i, y, [230, 0, 0]);
    for (let j = Z(az); j < Z(bz + 1); j++) for (const x of [X(ax), X(ax) + 1, X(bx + 1) - 2, X(bx + 1) - 1]) px(x, j, [230, 0, 0]);
  }
  // y numbers at the 16-block crossings, on a white box
  for (let z = b.z1; z <= b.z2; z++) for (let x = b.x1; x <= b.x2; x++) {
    const c = at(x, z);
    if (mod(x, 16) || mod(z, 16) || c.st !== 'known' || c.y === null) continue;
    const s = String(c.y);
    rect(X(x) + 1, Z(z) + 1, tw(s, 2) + 4, 14, [255, 255, 255]); text(s, X(x) + 3, Z(z) + 3, 2, [0, 0, 0]);
  }
  text(`X ${b.x1}..${b.x2} Z ${b.z1}..${b.z2}`, L, 6, 2, [0, 0, 0]);
  // north arrow, top right
  const ax = w - 16;
  for (let j = 0; j < 12; j++) rect(ax - Math.floor(j / 2), 6 + j, Math.floor(j / 2) * 2 + 1, 1, [0, 0, 0]);
  rect(ax - 1, 18, 3, 10, [0, 0, 0]);
  text('N', ax - 14, 10, 2, [0, 0, 0]);
  return {w, h, rgb};
}

async function png(pos, flags) {
  const [a, b, c, d] = ints(pos, 4, 'png x1 z1 x2 z2 [--out f.png]');
  const [x1, x2] = span(a, c), [z1, z2] = span(b, d);
  if (x2 - x1 + 1 > 128 || z2 - z1 + 1 > 128) throw new Fail('png: at most 128x128 blocks');
  const [hg, {plans}] = await Promise.all([heightGrid(x1, z1, x2, z2), plansIn({x1, z1, x2, z2})]);
  const img = drawMap(hg.at, {x1, z1, x2, z2}, plans), out = path.resolve(flags.out || `world-${x1}_${z1}_${x2}_${z2}.png`);
  fs.writeFileSync(out, encodePng(img.w, img.h, img.rgb));
  return {text: `${out}\n${line1('png', {x1, z1, x2, z2})}\n`};
}

// ---- check ----

function readPlan(file) {
  let plan;
  try { plan = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Fail(`${file}: ${e.message}`); }
  const set = plan.set ?? [], remove = plan.remove ?? [];
  const xyz = (c) => Array.isArray(c) && c.slice(0, 3).every(Number.isInteger);
  if (!Array.isArray(set) || !Array.isArray(remove) || !set.every((c) => xyz(c) && typeof c[3] === 'string') || !remove.every(xyz)) {
    throw new Fail('plan must be {"set":[[x,y,z,"block-state"]],"remove":[[x,y,z]]}');
  }
  if (!set.length && !remove.length) throw new Fail('plan is empty');
  return {set: set.map(([x, y, z, s]) => [x, y, z, s.includes(':') ? s : `minecraft:${s}`]), remove};
}
const boxOf = (cells) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); }
  return {x1: lo[0], y1: lo[1], z1: lo[2], x2: hi[0], y2: hi[1], z2: hi[2]};
};

// world: {st(x, z), at(x, y, z)}; plans: placed plans with blocks. Pure, so the test runs it offline.
function comparePlan(plan, world, plans) {
  const key = (x, y, z) => `${x},${y},${z}`, setKeys = new Set(plan.set.map(([x, y, z]) => key(x, y, z))), rmKeys = new Set(plan.remove.map(([x, y, z]) => key(x, y, z)));
  const r = {intoAir: 0, same: 0, replace: [], present: 0, alreadyAir: 0, unknown: [], unsupported: 0, overlaps: [], materials: new Map()};
  for (const [x, y, z, want] of plan.set) {
    r.materials.set(nameOf(want), (r.materials.get(nameOf(want)) || 0) + 1);
    if (world.st(x, z) !== 'known') { r.unknown.push([x, y, z, want]); continue; }
    const now = world.at(x, y, z);
    if (!now) r.intoAir++; else if (sameState(now, want)) r.same++; else r.replace.push([x, y, z, now, want]);
    if (!setKeys.has(key(x, y - 1, z)) && (!world.at(x, y - 1, z) || rmKeys.has(key(x, y - 1, z)))) r.unsupported++;
  }
  for (const [x, y, z] of plan.remove) {
    if (world.st(x, z) !== 'known') { r.unknown.push([x, y, z, 'remove']); continue; }
    if (world.at(x, y, z)) r.present++; else r.alreadyAir++;
  }
  for (const p of plans) {
    const n = p.blocks.filter(([x, y, z]) => setKeys.has(key(x, y, z)) || rmKeys.has(key(x, y, z))).length;
    if (n) r.overlaps.push([p.file, n]);
  }
  return r;
}

async function check(pos) {
  if (pos.length !== 1) throw new Fail('usage: check plan.json');
  const plan = readPlan(pos[0]), b = boxOf([...plan.set, ...plan.remove]);
  const [bb, {plans}, cl] = await Promise.all([blockBox(b.x1, b.y1 - 1, b.z1, b.x2, b.y2, b.z2), plansIn(b), corners(b.x1, b.z1, b.x2, b.z2)]);
  const r = comparePlan(plan, bb, plans);
  const conflicts = [...r.replace.map(([x, y, z, now, want]) => `${x} ${y} ${z} ${now} -> ${want}`), ...r.unknown.map(([x, y, z, want]) => `${x} ${y} ${z} ?? (unknown chunk) -> ${want}`)];
  const out = [line1('check', b), cl,
    `plan ${pos[0]} box x=${b.x1}..${b.x2} y=${b.y1}..${b.y2} z=${b.z1}..${b.z2}`,
    `set ${plan.set.length}: ${r.intoAir} into air, ${r.same} same, ${r.replace.length} REPLACE`,
    `remove ${plan.remove.length}: ${r.present} present, ${r.alreadyAir} already air`,
    `unknown-chunk cells: ${r.unknown.length}`,
    ...(r.overlaps.length ? r.overlaps.map(([f, n]) => `overlaps placed plan ${f}: ${n}`) : ['overlaps placed plan: none']),
    `unsupported (air below, not in plan): ${r.unsupported}`,
    `conflicts (x y z now -> plan): ${conflicts.length}${conflicts.length > MAX_CONFLICTS ? `, first ${MAX_CONFLICTS}` : ''}`,
    ...conflicts.slice(0, MAX_CONFLICTS).map((s) => `  ${s}`),
    `materials (set): ${[...r.materials].sort((p, q) => q[1] - p[1]).map(([n, k]) => `${n} ${k}`).join(', ')}`,
    r.replace.length || r.unknown.length ? 'result: NOT CLEAN (REPLACE or unknown), exit 1' : 'result: clean, exit 0'];
  return {text: out.join('\n') + '\n', exit: r.replace.length || r.unknown.length ? 1 : 0};
}

// ---- main ----

const VERBS = {map, cut, cells, info, png, check};
const AXES = {map: [[0, 2], [1, 3]], info: [[0, 2], [1, 3]], png: [[0, 2], [1, 3]], cut: [[0, 3], [1, 4], [2, 5]], cells: [[0, 3], [1, 4], [2, 5]]};
// The same command with each free axis shrunk so the output should fit.
function shrink(verb, pos, bytes) {
  const v = pos.map(Number), axes = (AXES[verb] || []).map(([i, j]) => [i, j, Math.abs(v[j] - v[i]) + 1]).filter(([, , n]) => n > 1);
  const f = Math.pow(MAX_OUT * 0.7 / bytes, 1 / Math.max(1, axes.length));
  for (const [i, j, n] of axes) v[j] = v[i] + Math.sign(v[j] - v[i]) * (Math.max(1, Math.floor(n * f)) - 1);
  return v.join(' ');
}

async function main(argv) {
  const {pos, flags} = parseArgs(argv);
  const verb = pos.shift();
  if (!verb || flags.help || verb === 'help') { process.stdout.write(HELP); return 0; }
  if (!VERBS[verb]) throw new Fail(`unknown verb "${verb}"; see --help`);
  const {text, exit = 0} = await VERBS[verb](pos, flags);
  const n = Buffer.byteLength(text);
  if (n > MAX_OUT) throw new Fail(`output ${n} bytes > ${MAX_OUT}, nothing printed. A smaller area that should fit: ${verb} ${shrink(verb, pos, n)}${Object.entries(flags).map(([k, v]) => ` --${k} ${v}`).join('')}`);
  process.stdout.write(text);
  return exit;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    process.stderr.write(`world-query: ${e instanceof Fail ? e.message : e.stack}\n`);
    process.exit(2);
  });
}

module.exports = {parseArgs, notFull, sameState, glyphs, tally, legend, grid, line1, cornersText, mapCells, renderMap, renderCut,
  cellLines, siteList, readSites, edgeDistance, encodePng, drawMap, comparePlan, readPlan, shrink, PROJECT_RE, MAX_OUT, Fail};
