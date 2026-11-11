'use strict';
// The Discord admin bot's door into the hub (docs/specs/2026-11-11-discord-platform.md, phase 4). Its own token
// opens three things: what each bot does, stop, resume. Nothing else of the dashboard API is behind it, so a
// leaked token cannot give jobs, read the map or reach the console.
const crypto = require('node:crypto');

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const bearer = (req) => /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];

// Answers a request under /api/remote/ as [status, body]. `d.trusted`: the peer is where the host's requests come from.
async function handle(req, path, d) {
  // Tailscale Serve marks what it forwards: the door is for a process on the lab host, not for the tailnet.
  // That mark is a second lock only; the token is the gate.
  const given = bearer(req);
  if (!d.token || !d.trusted || req.headers['x-forwarded-for'] || !given || !crypto.timingSafeEqual(hash(given), hash(d.token))) {
    if (given) d.log(`refused ${req.method} ${path}`); // only a tried token: anyone who reaches the port could fill the log otherwise
    return [403, {error: 'forbidden'}];
  }
  try {
    if (req.method === 'GET' && path === '/api/remote/fleet') {
      return [200, {bots: d.snapshots().map((s) => ({name: s.name, online: !!s.online, job: s.job?.label || null, queued: s.queue?.length || 0, paused: d.projects.get(s.name)?.paused ? d.projects.get(s.name).type : null}))}];
    }
    if (req.method === 'POST' && (path === '/api/remote/stop' || path === '/api/remote/resume')) {
      const {bot} = await d.readJson(req);
      if (bot != null && !(typeof bot === 'string' && /^\w{1,32}$/.test(bot))) throw new Error('bot must be a name'); // it goes into the log
      d.log(`${path.slice(12)} ${bot || 'all'}`);
      if (path === '/api/remote/stop') {
        const {unreached, saveErr} = d.submitJob({bots: bot ? [bot] : 'all', type: 'stop'}); // the dashboard's Stop and Stop all
        if (saveErr) return [500, {error: `stopped, but the stopped state could not be saved (${saveErr}): saved jobs may come back after a restart`}];
        return [200, {ok: true, unreached}];
      }
      // Only what is paused: resuming a running project would queue it a second time.
      const names = (bot ? [bot] : d.snapshots().map((s) => s.name)).filter((n) => d.projects.get(n)?.paused);
      if (!names.length) throw new Error('no paused project');
      names.forEach((n) => d.resumeProject(n));
      return [200, {ok: true, resumed: names}];
    }
  } catch (e) {
    return [400, {error: e.message}];
  }
  return [404, {error: 'not found'}];
}

module.exports = {handle};
