'use strict';
// A sandbox scenario run: rebuilds the test box over the sandbox console, starts the scenario's board job,
// samples the hub every 2 s and reports one JSON line per run. The hub runs it in-process (POST /api/scenarios,
// owner only): from a shell in the container the dashboard API refuses anyone but the owner's Tailscale identity.
// Never the real server's console.
const fs = require('node:fs');
const path = require('node:path');
const {loadConfig} = require('./config');
const {resetCommands, checkCommands, loaded, measure, SCENARIOS} = require('./scenario');

const SAMPLE_MS = 2000;
const MAX_MS = 30 * 60 * 1000;

// argv: [name, '--runs', n]. call(lines) -> replies: the sandbox console. http(method, path, body) -> {status, body}:
// /api/state, /api/board and POST /api/board/jobs.
async function main(argv, env, {call, http, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), out = console.log}) {
  const name = argv[0];
  const runs = Number(argv[argv.indexOf('--runs') + 1]) || 1;
  const scn = SCENARIOS[name];
  if (!scn) { out(`unknown scenario ${name || '(none)'}; known: ${Object.keys(SCENARIOS).join(', ')}`); return 2; }
  const cfg = loadConfig(env);
  if (!cfg.sandboxRcon) { out('no sandbox console (SANDBOX_RCON_HOST unset); scenarios never run on the real server'); return 2; }
  for (let run = 1; run <= runs; run++) {
    await call(loaded(scn.box, resetCommands(scn)));
    const made = await http('POST', '/api/board/jobs', scn.job);
    if (made.status !== 200) { out(JSON.stringify({scenario: name, run, ok: false, refused: made.body?.error || made.status})); return 1; }
    const id = made.body.id, t0 = now(), samples = [];
    let job, killed = false;
    while (now() - t0 < MAX_MS) {
      const [st, board] = await Promise.all([http('GET', '/api/state'), http('GET', '/api/board')]);
      samples.push({t: now(), bots: st.body?.bots || []});
      job = board.body?.jobs?.find((j) => j.id === id);
      if (scn.kill && !killed && job && job.parts.filter((p) => p.state === 'done').length * 2 >= job.parts.length) {
        killed = true;
        await call([`kill ${scn.kill}`]);
      }
      if (!job || !job.parts.some((p) => p.state === 'open' || p.state === 'claimed')) break;
      await sleep(SAMPLE_MS);
    }
    const replies = await call(checkCommands(scn.box));
    const empty = /^Test passed/.test(replies[replies.length - 2] || '');
    const failed = job ? job.parts.filter((p) => p.state === 'failed').length : null;
    const line = {scenario: name, run, at: new Date(t0).toISOString(), ok: empty && failed === 0, empty, failed, ...measure(samples), problem: job?.problem?.reason || null};
    out(JSON.stringify(line));
    if (env.STATE_DIR) fs.appendFileSync(path.join(env.STATE_DIR, 'scenarios.jsonl'), JSON.stringify(line) + '\n');
  }
  return 0;
}

module.exports = {main};
