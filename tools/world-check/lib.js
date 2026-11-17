'use strict';
// Shared by equality.js, load.js and nobot.js: the pure checks (tested in lib.test.js) and the small hub client.
// Plain Node, no dependencies. Exit codes of every script: 0 pass, 1 differences or limits broken, 2 cannot run, 3 steps skipped.

const HUB = 'https://bandit-lab.tail7facc9.ts.net:8445';
const isAir = (s) => /^minecraft:(cave_|void_)?air$/.test(s);
const chunk = (v) => Math.floor(v / 16); // floor, not truncation: the whole area has negative coordinates

// samples: [[x, y, z, state]] from the plugin; reply: the hub's /api/world/blocks answer for a box that holds them.
// got is the model's state: air when the cell is absent in a known chunk, '?unknown' in an unknown or ungenerated one.
function diffSamples(samples, reply) {
  const cells = new Map(reply.blocks.map(([x, y, z, i]) => [`${x},${y},${z}`, reply.palette[i]]));
  const missing = new Set([...reply.unknown, ...reply.ungenerated].map(([cx, cz]) => `${cx},${cz}`));
  const diffs = [];
  for (const [x, y, z, want] of samples) {
    const got = missing.has(`${chunk(x)},${chunk(z)}`) ? '?unknown' : cells.get(`${x},${y},${z}`) ?? 'minecraft:air';
    if (got !== want && !(isAir(got) && isAir(want))) diffs.push({x, y, z, want, got});
  }
  return diffs;
}

// The first size x size rect (scanning from the area's corner in 16-block steps) at least minDist blocks from every [x, z] point.
function farSpot(area, points, minDist = 300, size = 32) {
  for (let x = area.x1; x + size - 1 <= area.x2; x += 16) {
    for (let z = area.z1; z + size - 1 <= area.z2; z += 16) {
      const far = points.every(([px, pz]) => Math.hypot(px - Math.min(Math.max(px, x), x + size - 1), pz - Math.min(Math.max(pz, z), z + size - 1)) >= minDist);
      if (far) return {x1: x, z1: z, x2: x + size - 1, z2: z + size - 1};
    }
  }
  return null;
}

// Paper's /mspt: "... from last 5s, 10s, 1m: a/min/max, a/min/max, a/min/max" -> the 1 minute average.
function parseMspt(text) {
  const m = [...String(text ?? '').matchAll(/(\d+(?:\.\d+)?)\/\d+(?:\.\d+)?\/\d+(?:\.\d+)?/g)];
  return m.length >= 3 ? Number(m[2][1]) : null;
}

const round1 = (x) => Math.round(x * 10) / 10;
// before/after: {mspt, loopP99}; a null (old hub, no loop delay) leaves that limit unjudged, a missing mspt fails.
function compareLoad(before, after) {
  const delta = (a, b) => (a == null || b == null ? null : round1(b - a));
  const msptDelta = delta(before.mspt, after.mspt), loopP99Delta = delta(before.loopP99, after.loopP99);
  return {msptDelta, loopP99Delta, ok: msptDelta !== null && msptDelta <= 0.5 && (loopP99Delta === null || loopP99Delta <= 2)};
}

class Exit extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --key value, or --key alone (true); the rest is in _
function parseArgs(argv) {
  const out = {_: []};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { out._.push(argv[i]); continue; }
    const v = argv[i + 1];
    out[argv[i].slice(2)] = v === undefined || v.startsWith('--') ? true : (i++, v);
  }
  return out;
}

function parseTriple(text, what) {
  const v = typeof text === 'string' ? text.split(',').map((s) => (/^-?\d+$/.test(s.trim()) ? Number(s) : NaN)) : [];
  if (v.length !== 3 || v.some(Number.isNaN)) throw new Exit(2, `${what} must be x,y,z in whole blocks`);
  return v;
}

// api(path) is a GET, api(path, body) a JSON POST; both give the parsed body, any failure is Exit(2).
// The hub's tailscale serve adds the identity header, nothing else is sent (no Origin).
function makeApi(hub = HUB) {
  const base = String(hub).replace(/\/+$/, '');
  return async (path, body) => {
    let res;
    try {
      res = await fetch(base + path, {...(body !== undefined && {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}), signal: AbortSignal.timeout(40000)});
    } catch (e) {
      throw new Exit(2, `cannot reach ${base}: ${e.cause?.code || e.cause?.errors?.[0]?.code || e.cause?.message || e.message}`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Exit(2, `${path.split('?')[0]}: HTTP ${res.status} ${data?.error ?? ''}`.trim());
    return data;
  };
}

// box: [x1, y1, z1, x2, y2, z2]
const blocksPath = ([x1, y1, z1, x2, y2, z2]) => `/api/world/blocks?x1=${x1}&y1=${y1}&z1=${z1}&x2=${x2}&y2=${y2}&z2=${z2}`;

// Sample n real cells of the box, read the model's box once, compare. n is the number of cells the plugin returned.
async function checkBox(api, box, n, seed = Date.now()) {
  const {samples} = await api(`/api/world/sample?n=${n}&seed=${seed}&box=${box.join(',')}`);
  const reply = await api(blocksPath(box));
  return {n: samples.length, reply, diffs: diffSamples(samples, reply)};
}

const showDiffs = (diffs, max = 20) => {
  for (const d of diffs.slice(0, max)) console.log(`  ${d.x} ${d.y} ${d.z}: world ${d.want}, model ${d.got}`);
  if (diffs.length > max) console.log(`  ... and ${diffs.length - max} more`);
};

// Runs main() and turns its result into the exit code: a number it returns, an Exit it throws, anything else is 2.
const run = (main) => main().then((code = 0) => { process.exitCode = code; }, (e) => {
  console.error(e instanceof Exit && e.code === 1 ? `FAIL: ${e.message}` : `cannot run: ${e.message}`);
  process.exitCode = e instanceof Exit ? e.code : 2;
});

module.exports = {HUB, diffSamples, farSpot, parseMspt, compareLoad, Exit, sleep, parseArgs, parseTriple, makeApi, blocksPath, checkBox, showDiffs, run};
