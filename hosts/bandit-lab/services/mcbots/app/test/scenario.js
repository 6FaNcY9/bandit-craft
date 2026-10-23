'use strict';
const assert = require('node:assert');
// ---- scenario: sandbox reset lines, the "box empty" check, run measurement ----
{
  const {resetCommands, emptyCheck, checkCommands, loaded, measure, SCENARIOS} = require('../scenario');
  const box = {x1: 0, y1: 60, z1: 0, x2: 15, y2: 67, z2: 15};
  assert.deepStrictEqual(resetCommands({box}), ['fill 0 60 0 15 67 15 stone', 'fill 0 68 0 15 68 15 air']);
  assert.deepStrictEqual(resetCommands({box: {x1: 15, y1: 67, z1: 15, x2: 0, y2: 60, z2: 0}, fill: 'dirt'}), ['fill 0 60 0 15 67 15 dirt', 'fill 0 68 0 15 68 15 air']);
  assert.throws(() => resetCommands({box: {x1: 0, y1: 0, z1: 0, x2: 63, y2: 15, z2: 63}}), /too big for one fill/);
  assert.strictEqual(emptyCheck(box), 'execute if blocks 0 60 0 15 67 15 0 300 0 all');
  assert.deepStrictEqual(checkCommands(box), ['forceload add 0 0 15 15', 'fill 0 60 0 15 67 15 air replace torch', 'fill 0 60 0 15 67 15 air replace wall_torch', 'execute if blocks 0 60 0 15 67 15 0 300 0 all', 'forceload remove 0 0 15 15']);
  assert.deepStrictEqual(loaded(box, ['x']), ['forceload add 0 0 15 15', 'x', 'forceload remove 0 0 15 15']);

  const bot = (done, extra = {}) => ({name: 'bot5', online: true, dead: false, job: {type: 'part', done}, ...extra});
  const flat = [0, 20, 40, 61].map((s) => ({t: s * 1000, bots: [bot(120)]}));
  assert.deepStrictEqual(measure(flat), {ms: 61000, stalls: 1, deaths: 0});
  const steady = [0, 20, 40, 61, 80].map((s, i) => ({t: s * 1000, bots: [bot(i * 10)]}));
  assert.deepStrictEqual(measure(steady), {ms: 80000, stalls: 0, deaths: 0});
  // Idle bots are no stall (the job is over or waits for a bot); one long stall counts once.
  const idle = [0, 30, 70].map((s) => ({t: s * 1000, bots: [{name: 'bot5', online: true, dead: false, job: null}]}));
  assert.strictEqual(measure(idle).stalls, 0);
  assert.strictEqual(measure([0, 61, 122, 200].map((s) => ({t: s * 1000, bots: [bot(5)]}))).stalls, 1);
  // A death counts when the bot turns dead, not for every sample it stays dead.
  const dying = [false, true, true, false, true].map((dead, i) => ({t: i * 1000, bots: [bot(i, {dead})]}));
  assert.strictEqual(measure(dying).deaths, 2);

  for (const [name, scn] of Object.entries(SCENARIOS)) assert.ok(resetCommands(scn).length === 2 && scn.job.box, name);
}
// ---- scenario-run: refuses without the sandbox console, resets, starts the board job, reports ----
(async () => {
  const {main} = require('../scenario-run');
  const {SCENARIOS, resetCommands, loaded, checkCommands} = require('../scenario');
  const scn = SCENARIOS['excavate-16'];
  const env = {BOT_NAMES: 'bot5', BOT_AUTH: 'none'};
  const sb = {...env, SANDBOX_RCON_HOST: 'minecraft-sandbox', SANDBOX_RCON_PASSWORD: 'pw'};
  const out = [];
  const say = (l) => out.push(l);
  const never = async () => assert.fail('no console call without a sandbox');
  assert.strictEqual(await main(['excavate-16'], {...env, RCON_HOST: 'minecraft', RCON_PASSWORD: 'pw'}, {call: never, out: say}), 2);
  assert.match(out.pop(), /no sandbox console/);
  assert.strictEqual(await main(['nope'], sb, {call: never, out: say}), 2);
  assert.match(out.pop(), /unknown scenario nope/);

  const sent = [];
  const call = async (c) => { sent.push(...c); return c.map((l) => (l.startsWith('execute if blocks') ? 'Test passed. Count: 2048' : 'ok')); };
  assert.strictEqual(await main(['excavate-16'], sb, {call, http: async () => ({status: 400, body: {error: 'box touches the protected area 1 2 3 4'}}), out: say}), 1);
  assert.deepStrictEqual(sent, loaded(scn.box, resetCommands(scn)));
  assert.deepStrictEqual(JSON.parse(out.pop()), {scenario: 'excavate-16', run: 1, ok: false, refused: 'box touches the protected area 1 2 3 4'});

  sent.length = 0;
  let t = 0, polls = 0;
  const http = async (method, p, body) => {
    if (method === 'POST') { assert.deepStrictEqual(body, scn.job); return {status: 200, body: {id: 'j1'}}; }
    if (p === '/api/state') return {status: 200, body: {bots: [{name: 'bot5', online: true, dead: false, job: {done: polls * 10}}]}};
    polls++;
    return {status: 200, body: {jobs: [{id: 'j1', parts: [{state: polls < 3 ? 'claimed' : 'done'}]}]}};
  };
  assert.strictEqual(await main(['excavate-16', '--runs', '2'], sb, {call, http, now: () => t, sleep: async (ms) => { t += ms; }, out: say}), 0);
  assert.deepStrictEqual(sent.slice(0, 4), loaded(scn.box, resetCommands(scn)));
  assert.deepStrictEqual(sent.slice(4, 9), checkCommands(scn.box));
  const lines = out.map((l) => JSON.parse(l));
  assert.deepStrictEqual(lines.map((l) => [l.run, l.ok, l.empty, l.failed, l.stalls]), [[1, true, true, 0, 0], [2, true, true, 0, 0]]);
  assert.strictEqual(lines[0].ms, 4000);
  assert.ok(!sent.some((l) => l.startsWith('kill')), 'no kill in the plain scenario');
  sent.length = 0;
  polls = 0;
  assert.strictEqual(await main(['excavate-16-kill'], sb, {call, http, now: () => t, sleep: async (ms) => { t += ms; }, out: say}), 0);
  assert.deepStrictEqual(sent.filter((l) => l.startsWith('kill')), ['kill bot19'], 'killed once, when half the parts were done');
  console.log('ok');
})();
