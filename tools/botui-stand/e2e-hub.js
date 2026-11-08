// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-hub.js
// The real BotUi and screens with a fake api (8 snapshots) against the Paper plugin: the overview menu, the dialogs left, close for good.
const assert = require('node:assert/strict');
const {BotUi} = require('../../hosts/bandit-lab/services/mcbots/app/botui');
const {connect} = require('./client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snaps = Array.from({length: 8}, (_, i) => ({name: `bot${i + 1}`, online: true, dead: false, health: 20, food: 20, freeSlots: 20, pos: [0, 64, i], dimension: 'overworld', isDay: true,
  activity: i % 2 ? 'idle' : 'chopping', job: i % 2 ? null : {label: 'Baumfarm', progress: `${i}/64`, runningS: 700}, queue: [], inventory: [], armour: [null, null, null, null], lastError: null, lastErrorAgoS: null}));
const places = [{name: 'Eichen', kind: 'treefarm', dim: 'overworld', x: 0, y: 64, z: 0, box: {x1: 0, y1: 60, z1: 0, x2: 9, y2: 70, z2: 9}}, {name: 'Lager', kind: 'storage', dim: 'overworld', x: 3, y: 64, z: 4}];
const wants = [];
const keeper = {enabled: false, state() { return {available: true, enabled: this.enabled, quotas: [{item: 'logs', want: 64, have: 10}, {item: 'coal', want: 32, have: null}], chest: {x: 1, y: 2, z: 3}}; },
  setEnabled(on) { this.enabled = on; }, setWant(item, n) { wants.push([item, n]); }};
const api = {snapshots: () => snaps, places: () => places, schematics: async () => [], keeper, uploadLink: (v) => `https://stand.test/upload?t=tok-${v}`, traders: () => ['bot2'], sidebar: () => {},
  traderChests: {add: () => {}, remove: () => {}, list: () => ({sticks: [{x: 5, y: 6, z: 7}], stores: []})},
  submit: () => ({ok: true, unreached: []}), stopAll: () => ({ok: true})};

async function waitFor(fn, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (fn()) return;
  throw new Error('timeout in waitFor');
}
const buttons = (d) => (d.actions || []).map((a) => a.action.payload).filter(Boolean);

(async () => {
  const ui = new BotUi({url: 'http://127.0.0.1:8101', token: 'stand-token', viewerBots: {Viewer: '*'}, api, log: (m) => console.log('hub:', m), refreshMs: 1000});
  ui.start();
  const c = await connect('Viewer');
  await sleep(1500); // the first poll skips the backlog, so open only after it
  await c.command('bots'); // the overview is a menu now: a chest window, no dialog
  await waitFor(() => c.win.id !== 0 && c.win.items.some((i) => i && i.itemId !== undefined));
  assert.equal(c.dialogs.length, 0);
  assert.equal(ui.state('Viewer').screen.name, 'ov');

  // The dialogs left go through the real Paper, which is the only validator of the dialog format.
  const step = async (data) => { const n = c.dialogs.length; await c.click('botui:do', data); await waitFor(() => c.dialogs.length === n + 1); return c.dialogs.at(-1); };
  let d = await step({a: 'stopall'});
  assert.equal(d.title.text, 'Alle stoppen?');
  assert.deepEqual(buttons(d), [{a: 'stopall_ok'}]);
  const w = c.windows.length;
  await c.click('botui:do', {a: 'stopall_ok'}); // back on the overview menu
  await waitFor(() => c.windows.length > w);
  assert.equal(ui.state('Viewer').screen.name, 'ov');
  d = await step({a: 'upload'});
  assert.equal(d.title.text, 'Bauplan hochladen');
  assert.ok(JSON.stringify(d).includes('https://stand.test/upload?t=tok-Viewer'));
  // Ziele: number_range sliders and a dynamic save action
  d = await step({a: 'ziele'});
  assert.deepEqual(d.inputs.map((i) => [i.key, i.end]), [['want_logs', 256], ['want_coal', 128]]);
  assert.deepEqual(buttons(d).map((p) => p.a), ['zielm']); // the Speichern button is a dynamic/custom action
  await c.click('botui:do', {a: 'saveziele', want_logs: 100, want_coal: 7.0}); // sliders arrive as floats
  await waitFor(() => wants.length === 2);
  assert.deepEqual(wants, [['logs', 100], ['coal', 7]]);
  await waitFor(() => /Ziele gespeichert/.test(JSON.stringify(c.dialogs.at(-1))));
  const w2 = c.windows.length;
  await c.click('botui:do', {a: 'zielm'}); // the toggles live in a menu
  await waitFor(() => c.windows.length > w2);
  await c.click('botui:do', {a: 'keeper', on: 1});
  await waitFor(() => keeper.enabled === true);
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
