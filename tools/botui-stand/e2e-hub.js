// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-hub.js
// The real BotUi and screens with a fake api (8 snapshots) against the Paper plugin: open, navigate, close for good.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {BotUi} = require('../../hosts/bandit-lab/services/mcbots/app/botui');
const {connect} = require('./client');

const CONSOLE = `${process.env.XDG_RUNTIME_DIR}/botui-stand/in`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snaps = Array.from({length: 8}, (_, i) => ({name: `bot${i + 1}`, online: true, dead: false, health: 20, food: 20, freeSlots: 20, pos: [0, 64, i], dimension: 'overworld', isDay: true,
  activity: i % 2 ? 'idle' : 'chopping', job: i % 2 ? null : {label: 'Baumfarm', progress: `${i}/64`, runningS: 700}, queue: [], inventory: [], armour: [null, null, null, null], lastError: null, lastErrorAgoS: null}));
const submits = [];
const places = [{name: 'Eichen', kind: 'treefarm', dim: 'overworld', x: 0, y: 64, z: 0, box: {x1: 0, y1: 60, z1: 0, x2: 9, y2: 70, z2: 9}}, {name: 'Lager', kind: 'storage', dim: 'overworld', x: 3, y: 64, z: 4}];
const wants = [], chestCalls = [];
const keeper = {enabled: false, state() { return {available: true, enabled: this.enabled, quotas: [{item: 'logs', want: 64, have: 10}, {item: 'coal', want: 32, have: null}], chest: {x: 1, y: 2, z: 3}}; },
  setEnabled(on) { this.enabled = on; }, setWant(item, n) { wants.push([item, n]); }};
const api = {snapshots: () => snaps, places: () => places, schematics: async () => ['house.litematic'], keeper, plan: {enabled: false, setEnabled: (on) => { api.plan.enabled = on; }}, traders: () => ['bot2'], sidebar: () => {},
  traderChests: {add: (...a) => chestCalls.push(['add', ...a]), remove: (...a) => chestCalls.push(['remove', ...a]), list: () => ({sticks: [{x: 5, y: 6, z: 7}], stores: []})},
  submit: (v, j) => { submits.push(j); return {ok: true, unreached: []}; }, stopAll: () => ({ok: true})};

async function waitFor(fn, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (fn()) return;
  throw new Error('timeout in waitFor');
}
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(text).join('') : c && typeof c === 'object' ? (c.text || '') + text(c.extra) : '');
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

  // Auftrag: every dialog goes through the real Paper, which is the only validator of the dialog format.
  const step = async (data) => { const n = c.dialogs.length; await c.click('botui:do', data); await waitFor(() => c.dialogs.length === n + 1); return c.dialogs.at(-1); };
  const [px, py, pz] = ui.state('Viewer').ctx.pos.map(Math.floor), chest = [px + 3, py, pz];
  fs.appendFileSync(CONSOLE, `setblock ${chest.join(' ')} chest[facing=west]\n`);
  await sleep(1000);
  await c.look(-90, 25);
  await sleep(500);
  let n = c.dialogs.length;
  await c.command('bots'); // a fresh open with the chest in the crosshair
  await waitFor(() => c.dialogs.length === n + 1);
  assert.ok(buttons(c.dialogs.at(-1)).some((p) => p.a === 'new'));
  assert.equal(text(c.dialogs.at(-1).actions.find((a) => a.action.payload.a === 'new').label), 'Auftrag: Truhe ▸');
  d = await step({a: 'new'});
  assert.match(text(d.body[0].contents), /^Du schaust auf: Truhe/);
  assert.ok(d.actions.some((a) => text(a.label) === 'Hier einlagern'));
  d = await step({a: 'job', key: 'deposit', x: chest[0], y: chest[1], z: chest[2]});
  assert.deepEqual(d.inputs.map((i) => i.key), ['who', 'when']);
  await c.click('botui:do', {a: 'send', key: 'deposit', x: chest[0], y: chest[1], z: chest[2], who: 'bot2', when: 'next'}); // sliders arrive as floats
  await waitFor(() => submits.length === 2);
  assert.deepEqual(submits[1], {bots: ['bot2'], type: 'deposit', args: {x: chest[0], y: chest[1], z: chest[2]}, replace: false});
  await waitFor(() => /bot2: Einlagern/.test(JSON.stringify(c.dialogs.at(-1))));
  // step 2 with every input kind: slider, selects, text, optional target, radius, schematic, rotation, zone
  for (const key of ['mine', 'craft', 'tidy', 'guard', 'schematic', 'treefarm', 'shift', 'help']) {
    d = await step({a: 'job', key});
    assert.ok(d.inputs.length >= 2, key);
    assert.equal(d.actions.length, 2, key);
  }
  // corners: A closes the dialog, the next open shows step 1 with B, then the area jobs (shaft disabled for one block)
  n = c.dialogs.length;
  await c.click('botui:do', {a: 'corner', which: 'a'});
  await sleep(500);
  assert.equal(c.dialogs.length, n);
  await c.command('bots');
  await waitFor(() => c.dialogs.length === n + 1);
  assert.ok(c.dialogs.at(-1).actions.some((a) => text(a.label) === 'Ecke B setzen'));
  d = await step({a: 'corner', which: 'b'});
  assert.match(text(d.body[1].contents), /^Bereich: 1 x 1 x 1/);
  assert.ok(d.actions.some((a) => text(a.label) === 'Raum graben' && a.action));
  assert.ok(d.actions.some((a) => text(a.label) === 'Schacht' && !a.action));
  d = await step({a: 'job', key: 'excavate'});
  assert.deepEqual(d.inputs.map((i) => i.key), ['who', 'when']);
  d = await step({a: 'clearsel'});
  assert.ok(d.actions.some((a) => text(a.label) === 'Ecke A setzen'));
  // Ziele: number_range sliders and a dynamic save action through the real Paper (the first slider screen in the stand)
  d = await step({a: 'ziele'});
  assert.deepEqual(d.inputs.map((i) => [i.key, i.end]), [['want_logs', 256], ['want_coal', 128]]);
  assert.ok(buttons(d).some((p) => p.a === 'keeper' && p.on === 1) && buttons(d).some((p) => p.a === 'trader_del' && p.bot === 'bot2'));
  await c.click('botui:do', {a: 'saveziele', want_logs: 100, want_coal: 7.0}); // sliders arrive as floats
  await waitFor(() => wants.length === 2);
  assert.deepEqual(wants, [['logs', 100], ['coal', 7]]);
  await waitFor(() => /Ziele gespeichert/.test(JSON.stringify(c.dialogs.at(-1))));
  d = await step({a: 'keeper', on: 1});
  assert.equal(keeper.enabled, true);
  assert.ok(buttons(d).some((p) => p.a === 'keeper' && p.on === 0));
  d = await step({a: 'new'});
  assert.ok(buttons(d).some((p) => p.a === 'trader_add' && p.bot === 'bot2' && p.kind === 'stores'));
  await step({a: 'trader_add', bot: 'bot2', kind: 'sticks'});
  assert.deepEqual(chestCalls, [['add', 'bot2', 'sticks', {x: chest[0], y: chest[1], z: chest[2]}]]);
  await step({a: 'lage'});
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
