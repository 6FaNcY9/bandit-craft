'use strict';
// A road read block by block, for stage 2's check: what stands in its way before a bot digs, and that it touched nothing but its own cells after.
//   node road-check.js snapshot <dir> <length> <file>   bot50 in spectator is teleported along the road and writes every cell inspect looks at (it is the
//                                                       console's bot: stop a local instance first). The console cannot name a block, so it is read with bot.blockAt.
//   node road-check.js stops <file>                     every place inspect would stop the road
//   node road-check.js check <file>                     checkCell on every built cell
//   node road-check.js diff <before> <after>            every changed cell must have been natural or generated, and be the road's own
const fs = require('fs');
const {originPlan, cell, inspect, checkCell, kindOf, crossSection, niche, isBoosterSlot, FIRST_RAIL} = require('../../hosts/bandit-lab/services/mcbots/app/road');

const SIDES = 3, LOW = -3, HIGH = 4, AHEAD = 3, ORIGIN = {x: 0, y: 0, z: 0};
const key = ({x, y, z}) => `${x},${y},${z}`;
const reader = (cells) => (x, y, z) => {
  const c = cells[`${x},${y},${z}`];
  if (c === undefined) return null;
  const [name, empty, shape] = c.split('|');
  return {name, boundingBox: empty ? 'empty' : 'block', ...(shape ? {getProperties: () => ({shape})} : {})};
};
const kOf = ({dir, origin}, c) => ({east: c.x - origin.x, west: origin.x - c.x, south: c.z - origin.z, north: origin.z - c.z}[dir]);

// inspect stops at the first thing it meets; this goes on past it, so the whole list is seen at once.
function allStops(blockAt, road, from, to) {
  const out = [];
  for (let k = from; k <= to;) {
    const end = Math.min(k + 15, to), {stop} = inspect(blockAt, road, k, end);
    if (!stop) { k = end + 1; continue; }
    out.push({k: kOf(road, stop.at), ...stop});
    if (stop.why === 'unloaded') break;
    const next = kOf(road, stop.at) + 1;
    k = next > k ? next : k + 1; // what it saw ahead of k is read again from there
  }
  return out;
}

function problems(blockAt, road, from, to) {
  const out = [];
  for (let k = from; k <= to; k++) for (const p of checkCell(blockAt, road, k)) out.push(`k ${k}: ${p}`);
  return out;
}

// What a road may change: its own cross-section, and the niche of a booster. What it may replace: anything not a player's.
function changes(before, after, road, length) {
  const own = new Set();
  const plan = originPlan(road.origin || {x: 0, y: 0, z: 0});
  for (const c of [...plan.room, ...plan.curbs, ...plan.stair.flatMap((s) => [...s.air, s.floor])]) own.add(key(c));
  for (let k = FIRST_RAIL; k <= length + 1; k++) {
    const {air, solid} = crossSection(road, k);
    for (const c of [...air, ...solid]) own.add(key(c));
    if (isBoosterSlot(k)) own.add(key(niche(road, k)));
  }
  const bad = [];
  let changed = 0;
  for (const [k, was] of Object.entries(before)) {
    const now = after[k];
    if (now === undefined || now.split('|')[0] === was.split('|')[0]) continue;
    changed++;
    const name = was.split('|')[0];
    if (['player', 'keep', 'danger'].includes(kindOf(name))) bad.push(`${k}: a ${name} is gone`);
    if (!own.has(k)) bad.push(`${k}: ${name} -> ${now.split('|')[0]}, not the road's cell`);
  }
  return {changed, bad};
}

async function snapshot(dir, length, file) {
  const {connect} = require('./spikes/riders');
  const {consoleCall} = require('./run');
  const {Vec3} = require('vec3');
  const call = consoleCall(process.env.MCBOTS_URL || 'https://bandit-lab.tail7facc9.ts.net:8445');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const road = {dir, origin: ORIGIN}, cells = {}, bot = await connect('bot50');
  await call(['gamemode spectator bot50']);
  for (let k = 0; k <= length + AHEAD; k += 64) {
    const to = Math.min(k + 63, length + AHEAD), mid = cell(road, k + 32, 1);
    await call([`tp bot50 ${mid.x + 0.5} ${mid.y} ${mid.z + 0.5}`]);
    for (let n = k; n <= to; n++) for (let side = -SIDES; side <= SIDES; side++) for (let h = LOW; h <= HIGH; h++) {
      const c = cell(road, n, h, side);
      let b = bot.blockAt(new Vec3(c.x, c.y, c.z));
      for (let tries = 0; !b && tries < 300; tries++) { await sleep(100); b = bot.blockAt(new Vec3(c.x, c.y, c.z)); }
      if (!b) throw new Error(`no chunk at k ${n}`);
      const shape = /rail$/.test(b.name) ? b.getProperties?.().shape : '';
      cells[key(c)] = `${b.name}|${b.boundingBox === 'empty' ? 'e' : ''}|${shape || ''}`;
    }
    console.log(`read to k ${to}`);
  }
  await call(['gamemode survival bot50']); // left a spectator it can neither dig nor board a cart
  fs.writeFileSync(file, JSON.stringify({dir, length, origin: ORIGIN, cells}));
  bot.quit?.();
  console.log(`${Object.keys(cells).length} cells in ${file}`);
}

async function main() {
  const [mode, a, b, c] = process.argv.slice(2);
  const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  if (mode === 'snapshot') return snapshot(a, Number(b), c);
  if (mode === 'stops') {
    const s = load(a), list = allStops(reader(s.cells), {dir: s.dir, origin: s.origin}, 8, s.length);
    for (const x of list) console.log(`k ${x.k}: ${x.why} ${x.name} at ${key(x.at)}`);
    return console.log(`${list.length} stops in ${s.length} m ${s.dir}`);
  }
  if (mode === 'check') {
    const s = load(a), list = problems(reader(s.cells), {dir: s.dir, origin: s.origin}, FIRST_RAIL, s.length);
    list.slice(0, 40).forEach((p) => console.log(p));
    console.log(`${list.length} problems in k ${FIRST_RAIL}..${s.length}`);
    process.exitCode = list.length ? 1 : 0;
    return undefined;
  }
  if (mode === 'diff') {
    const x = load(a), y = load(b), {changed, bad} = changes(x.cells, y.cells, {dir: x.dir, origin: x.origin}, Math.min(x.length, y.length));
    bad.slice(0, 40).forEach((p) => console.log(p));
    console.log(`${changed} cells changed, ${bad.length} of them wrong`);
    process.exitCode = bad.length ? 1 : 0;
    return undefined;
  }
  throw new Error('usage: road-check.js snapshot <dir> <length> <file> | stops <file> | check <file> | diff <before> <after>');
}
module.exports = {allStops, problems, changes, reader};
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
