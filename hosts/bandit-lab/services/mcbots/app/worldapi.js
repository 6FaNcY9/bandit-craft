'use strict';
// The hub's side of the block model that is not the model itself: the WORLD_AREA text, which RCON commands
// change blocks (so the model can re-read them at once), and the /api/world/* routes in front of worldmodel.js.
const INT = /^-?\d{1,9}$/;
const RADIUS_MAX = 1024; // the first area is 320; a larger one is a deliberate change (phase 5), not a typo

// "x,z,radius" in blocks (the plugin's area is whole chunks) -> chunk bounds
function parseArea(text) {
  const p = String(text).trim().split(',').map((s) => s.trim());
  if (p.length !== 3 || !p.every((s) => INT.test(s)) || Number(p[2]) < 1 || Number(p[2]) > RADIUS_MAX) throw new Error(`WORLD_AREA must be x,z,radius in blocks (radius 1..${RADIUS_MAX})`);
  const [x, z, r] = p.map(Number), chunk = (v) => Math.floor(v / 16);
  return {cx1: chunk(x - r), cz1: chunk(z - r), cx2: chunk(x + r), cz2: chunk(z + r)};
}

// The blocks one console command can change: fill and setblock with absolute coordinates. Relative ones (~ ^)
// and everything else give no box; the plugin's own sweep catches those.
function dirtyBoxes(cmd) {
  const w = String(cmd).trim().replace(/^\//, '').replace(/^minecraft:/, '').split(/\s+/);
  const n = w[0] === 'fill' ? 6 : w[0] === 'setblock' ? 3 : 0;
  const c = w.slice(1, 1 + n);
  if (!n || c.length < n || !c.every((s) => INT.test(s))) return [];
  const v = c.map(Number);
  return [n === 3 ? {x1: v[0], y1: v[1], z1: v[2], x2: v[0], y2: v[1], z2: v[2]} : {x1: v[0], y1: v[1], z1: v[2], x2: v[3], y2: v[4], z2: v[5]}];
}

// Same signature as queued()'s result; boxes are reported after the call resolved, a rejected call reports nothing.
const withDirty = (call, onBox) => async (commands) => {
  const out = await call(commands);
  for (const c of commands) for (const b of dirtyBoxes(c)) onBox(b);
  return out;
};

// Which query parameters each route forwards; blocks/height/materials take theirs raw (the worker parses and bounds them).
const PARAMS = {sections: ['cx', 'cz', 'r'], changes: ['since'], sample: ['n', 'seed', 'box'], stats: []};
const RAW = new Set(['blocks', 'height', 'materials']);
const send = (code, obj) => [code, {'Content-Type': 'application/json'}, JSON.stringify(obj)];

// GET /api/world/<op>?... -> [status, headers, body]; model is null when the world model is off.
async function handle(method, url, model) {
  const op = method === 'GET' && url.pathname.startsWith('/api/world/') ? url.pathname.slice('/api/world/'.length) : null;
  if (!op) return send(404, {error: 'not found'});
  if (!model) return send(503, {error: 'world model is off'});
  if (!RAW.has(op) && !Object.hasOwn(PARAMS, op)) return send(404, {error: 'not found'});
  const args = RAW.has(op) ? Object.fromEntries(url.searchParams) : Object.fromEntries(PARAMS[op].filter((k) => url.searchParams.has(k)).map((k) => [k, url.searchParams.get(k)]));
  const r = await model.request(op, args);
  return [r.status, {'Content-Type': r.type, ...(r.gzip && {'Content-Encoding': 'gzip'})}, r.body];
}

module.exports = {parseArea, dirtyBoxes, withDirty, handle};
