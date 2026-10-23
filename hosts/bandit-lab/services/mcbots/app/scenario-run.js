#!/usr/bin/env node
'use strict';
// mcbots-scenario <name> [--runs N]: rebuilds a sandbox test box over the sandbox console, starts the
// scenario's board job, samples the hub every 2 s and prints one JSON line per run. Runs inside the mcbots
// container (ssh bandit-lab docker exec mcbots mcbots-scenario excavate-16 --runs 3). Never the real server.
const fs = require('node:fs');
const path = require('node:path');
const {loadConfig} = require('./config');
const {queued} = require('./admin');
const {resetCommands, checkCommands, loaded, measure, SCENARIOS} = require('./scenario');

const SAMPLE_MS = 2000;
const MAX_MS = 30 * 60 * 1000;

async function main(argv, env, {call, http, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), out = console.log} = {}) {
  const name = argv[0];
  const runs = Number(argv[argv.indexOf('--runs') + 1]) || 1;
  const scn = SCENARIOS[name];
  if (!scn) { out(`unknown scenario ${name || '(none)'}; known: ${Object.keys(SCENARIOS).join(', ')}`); return 2; }
  const cfg = loadConfig(env);
  if (!cfg.sandboxRcon) { out('no sandbox console (SANDBOX_RCON_HOST unset); scenarios never run on the real server'); return 2; }
  call ||= queued(cfg.sandboxRcon);
  http ||= async (method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${cfg.port}${p}`, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body && JSON.stringify(body)});
    return {status: r.status, body: await r.json().catch(() => null)};
  };
  for (let run = 1; run <= runs; run++) {
    await call(loaded(scn.box, resetCommands(scn)));
    const made = await http('POST', '/api/board/jobs', scn.job);
    if (made.status === 404) { out('no board on this hub (BOARD_BOTS unset or an older mcbots)'); return 2; }
    if (made.status !== 200) { out(JSON.stringify({scenario: name, run, ok: false, refused: made.body?.error || made.status})); return 1; }
    const id = made.body.id, t0 = now(), samples = [];
    let job;
    while (now() - t0 < MAX_MS) {
      const [st, board] = await Promise.all([http('GET', '/api/state'), http('GET', '/api/board')]);
      samples.push({t: now(), bots: st.body?.bots || []});
      job = board.body?.jobs?.find((j) => j.id === id);
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

if (require.main === module) main(process.argv.slice(2), process.env).then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1); });

module.exports = {main};
