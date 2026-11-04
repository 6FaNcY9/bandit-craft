// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-bridge.js
const assert = require('node:assert/strict');
const {connect} = require('./client');

const URL = 'http://127.0.0.1:8101';
const post = (path, body, token = 'stand-token') => fetch(URL + path, {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: JSON.stringify(body)});
let since = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitEvent(pred, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const res = await fetch(`${URL}/events?since=${since}&wait=1`, {headers: {Authorization: 'Bearer stand-token'}});
    const {events, last} = await res.json();
    since = Math.max(since, last);
    const hit = events.find(pred);
    if (hit) return hit;
  }
  throw new Error('timeout waiting for event');
}
async function assertNoEvent(pred, ms) {
  await assert.rejects(waitEvent(pred, ms), /timeout waiting/);
}
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(50); }
  throw new Error('timeout in waitFor');
}
function sampleDialog(size) {
  const actions = [];
  for (let i = 0; JSON.stringify(actions).length < size; i++) {
    actions.push({label: {text: `bot${i} "q" \\ äöü`}, width: 200, tooltip: {sprite: 'block/stone'}, action: {type: 'minecraft:custom', id: 'botui:do', payload: {bot: `bot${i}`}}});
  }
  return {type: 'minecraft:multi_action', title: {text: 'Kommandostand'}, columns: 2, actions, exit_action: {label: {text: 'Zu'}}, can_close_with_escape: true};
}

(async () => {
  assert.equal((await post('/viewers', {names: ['Viewer']}, 'wrong')).status, 401);
  await post('/viewers', {names: ['Viewer']});
  await fetch(`${URL}/events?since=0&wait=0`, {headers: {Authorization: 'Bearer stand-token'}}); // register a hub poll
  const c = await connect('Viewer'), other = await connect('Other');
  await c.command('bots'); // open from /bots
  let ev = await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
  assert.equal(ev.dim, 'overworld'); assert.equal(ev.pos.length, 3);
  await other.command('bots'); // non-viewer: no event, told so by the plugin
  await assertNoEvent((e) => e.player === 'Other', 2000);
  const big = JSON.stringify(sampleDialog(7000)); // 7 KB with quotes, backslash, umlauts, sprite object text
  assert.equal((await (await post('/show', {player: 'Viewer', dialog: big})).json()).ok, true);
  await waitFor(() => c.dialogs.length === 1);
  assert.equal((await (await post('/show', {player: 'Viewer', dialog: '{"type":"bad"}'})).json()).ok, false);
  assert.equal((await post('/show', {player: 'bad name;', dialog: big})).status, 400);
  await c.click('botui:do', {a: 'bot', bot: 'bot7', n: 32});
  ev = await waitEvent((e) => e.type === 'click');
  assert.deepEqual(ev.data, {a: 'bot', bot: 'bot7', n: 32});
  await c.click('other:thing', {x: 1}); // foreign namespace is not reported
  await assertNoEvent((e) => e.type === 'click' && e.data.x === 1, 1000);
  await c.look(90, 10); // moving or turning closes the dialog for the hub
  await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');
  await c.end();
  await waitEvent((e) => e.type === 'quit' && e.player === 'Viewer');
  await other.end();
  console.log('e2e-bridge ok');
})().catch((e) => { console.error(e); process.exit(1); });
