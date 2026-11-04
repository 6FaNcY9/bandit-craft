// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-bridge.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {connect} = require('./client');

const STAND = `${process.env.XDG_RUNTIME_DIR}/botui-stand`;
const CONSOLE = `${STAND}/in`, LOG = `${STAND}/logs/latest.log`;

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
  const ev0 = ev;
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
  // payload parser: quote+backslash, byte, float, bare-looking strings, nested values dropped while the other keys survive
  const nest = {type: 'compound', value: {s: {type: 'string', value: '}"{,]'}, i: {type: 'int', value: 1}}};
  await c.click('botui:do', {
    q: 'sh"a\'ft \\ \u00e4', b: {type: 'byte', value: 1}, f: 2.5, nest,
    lst: {type: 'list', value: {type: 'string', value: ['a,b', '}']}}, ia: {type: 'intArray', value: [1, 2]},
    sf: '12f', sd: 'bold', sb: '7b', ss: 'abs', sl: '9l', z: 'end',
  });
  ev = await waitEvent((e) => e.type === 'click');
  assert.deepEqual(ev.data, {q: 'sh"a\'ft \\ \u00e4', b: 1, f: 2.5, sf: '12f', sd: 'bold', sb: '7b', ss: 'abs', sl: '9l', z: 'end'});
  await c.click('other:thing', {x: 1}); // foreign namespace is not reported
  await assertNoEvent((e) => e.type === 'click' && e.data.x === 1, 1000);

  // /close disarms; a failed /show does not arm
  assert.equal((await (await post('/close', {player: 'Viewer'})).json()).ok, true);
  assert.equal((await (await post('/show', {player: 'Viewer', dialog: '{"type":"bad"}'})).json()).ok, false);
  await c.look(45, 10);
  await assertNoEvent((e) => e.type === 'closed', 1500);

  // moving or turning closes an armed dialog for the hub
  assert.equal((await (await post('/show', {player: 'Viewer', dialog: big})).json()).ok, true);
  await c.look(90, 10);
  await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');

  // gaze: a chest three blocks to the east, looked at from the side
  const [px, py, pz] = ev0.pos;
  const chest = [px + 3, py, pz];
  fs.appendFileSync(CONSOLE, `setblock ${chest.join(' ')} chest[facing=west]\n`);
  await sleep(1000);
  await c.look(-90, 25);
  await sleep(500);
  await c.command('bots');
  ev = await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
  assert.deepEqual(ev.gaze, {x: chest[0], y: chest[1], z: chest[2], block: 'chest'});

  // Shift+F: needs sneaking, and a plain F is left alone
  c.swap();
  await assertNoEvent((e) => e.type === 'open', 1500);
  c.sneak(true);
  await sleep(300);
  c.swap();
  await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
  c.sneak(false);

  // outline: particles arrive, stop on null, a bad box is refused
  const [a, b2, d] = ev0.pos;
  const box = {x1: a - 1, y1: b2, z1: d - 1, x2: a + 1, y2: b2 + 1, z2: d + 1};
  assert.equal((await post('/outline', {player: 'Viewer', box: {...box, x1: 'x'}})).status, 400);
  assert.equal((await (await post('/outline', {player: 'Viewer', box})).json()).ok, true);
  await waitFor(() => c.counts.particles > 0);
  assert.equal((await (await post('/outline', {player: 'Viewer', box: null})).json()).ok, true);
  await sleep(500);
  const seen = c.counts.particles;
  await sleep(1000);
  assert.equal(c.counts.particles, seen);

  await c.end();
  await waitEvent((e) => e.type === 'quit' && e.player === 'Viewer');
  await other.end();
  assert.ok(!fs.readFileSync(LOG, 'utf8').includes('Displayed dialog'), 'dialog show must not log to the console');
  console.log('e2e-bridge ok');
})().catch((e) => { console.error(e); process.exit(1); });
