// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-hub.js
// The real BotUi and screens with a fake api (8 snapshots) against the Paper plugin: open, navigate, close for good.
const assert = require('node:assert/strict');
const {BotUi} = require('../../hosts/bandit-lab/services/mcbots/app/botui');
const {connect} = require('./client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snaps = Array.from({length: 8}, (_, i) => ({name: `bot${i + 1}`, online: true, dead: false, health: 20, food: 20, freeSlots: 20, pos: [0, 64, i], dimension: 'overworld', isDay: true,
  activity: i % 2 ? 'idle' : 'chopping', job: i % 2 ? null : {label: 'Baumfarm', progress: `${i}/64`, runningS: 700}, queue: [], inventory: [], armour: [null, null, null, null], lastError: null, lastErrorAgoS: null}));
const submits = [];
const api = {snapshots: () => snaps, places: () => [], schematics: async () => [], keeper: {state: () => ({available: true, quotas: [], chest: {x: 1, y: 2, z: 3}})},
  submit: (v, j) => { submits.push(j); return {ok: true, unreached: []}; }, stopAll: () => ({ok: true})};

async function waitFor(fn, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (fn()) return;
  throw new Error('timeout in waitFor');
}
const buttons = (d) => (d.actions || []).map((a) => a.action.payload);

(async () => {
  const ui = new BotUi({url: 'http://127.0.0.1:8101', token: 'stand-token', viewerBots: {Viewer: '*'}, api, log: (m) => console.log('hub:', m), refreshMs: 1000});
  ui.start();
  const c = await connect('Viewer');
  await sleep(1500); // the first poll skips the backlog, so open only after it
  await c.command('bots');
  await waitFor(() => c.dialogs.length === 1);
  let d = c.dialogs[0];
  assert.equal(buttons(d).filter((p) => p.a === 'bot').length, 8);
  assert.deepEqual(buttons(d).slice(8).map((p) => p.a), ['new', 'ziele', 'karte', 'stopall']);
  await c.click('botui:do', {a: 'bot', bot: 'bot3'});
  await waitFor(() => c.dialogs.length === 2);
  d = c.dialogs[1];
  assert.equal(d.title.text, 'bot3');
  assert.ok(buttons(d).some((p) => p.a === 'stop' && p.bot === 'bot3'));
  await c.click('botui:do', {a: 'quick', bot: 'bot3', job: 'deposit'});
  await waitFor(() => submits.length === 1);
  assert.deepEqual(submits[0], {bots: ['bot3'], type: 'deposit', args: {x: 1, y: 2, z: 3}});
  await waitFor(() => c.dialogs.length === 3);
  await c.click('botui:do', {a: 'close'});
  await sleep(500);
  const shown = c.dialogs.length;
  snaps[0].job.progress = '9/64'; // a changing snapshot must not bring the dialog back
  await sleep(7000);
  assert.equal(c.dialogs.length, shown);
  ui.stop();
  await c.end();
  console.log('e2e-hub ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
