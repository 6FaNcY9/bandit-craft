'use strict';
// GET /api/plan/status: which plan to compare (a bot's schematic project, or a file at an origin), asked of the
// world worker and relayed untouched like worldapi.js; the main thread decodes nothing.
const build = require('./build');
const INT = /^-?\d{1,9}$/;
const XZ_MAX = 30000000;
const send = (code, obj) => [code, {'Content-Type': 'application/json'}, JSON.stringify(obj)];

// "x,y,z" -> {x, y, z} within the world's bounds, or null
function parseOrigin(text) {
  const p = text.split(',');
  if (p.length !== 3 || !p.every((s) => INT.test(s))) return null;
  const [x, y, z] = p.map(Number);
  return Math.abs(x) <= XZ_MAX && Math.abs(z) <= XZ_MAX && y >= -64 && y <= 319 ? {x, y, z} : null;
}

async function handle(method, url, {model, projects, dir}) {
  if (method !== 'GET' || url.pathname !== '/api/plan/status') return send(404, {error: 'not found'});
  if (!model) return send(503, {error: 'world model is off'});
  const q = url.searchParams, bot = q.get('bot'), file = q.get('file'), at = q.get('origin');
  let plan;
  if (bot !== null && file === null && at === null) {
    const p = projects.get(bot);
    if (p?.type !== 'schematic') return send(404, {error: 'no schematic project'});
    const a = p.args;
    plan = {file: a.file, origin: a.origin, rotation: a.rotation ?? 0, mirror: a.mirror ?? 'none', substitute: a.substitute ?? {}, anySolid: a.anySolid ?? []};
  } else if (bot === null && file !== null && at !== null) {
    const origin = parseOrigin(at);
    if (!build.SCHEMATIC_RE.test(file) || !origin) return send(400, {error: 'bad file or origin'});
    plan = {file, origin, rotation: 0, mirror: 'none', substitute: {}, anySolid: []};
  } else return send(400, {error: 'give bot, or file and origin'});
  const r = await model.request('planStatus', {dir, ...plan});
  return [r.status, {'Content-Type': r.type, ...(r.gzip && {'Content-Encoding': 'gzip'})}, r.body];
}

module.exports = {handle};
