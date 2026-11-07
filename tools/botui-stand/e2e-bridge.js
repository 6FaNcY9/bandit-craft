// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-bridge.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {connect} = require('./client');
const items = require('minecraft-data')('26.1').items;
const nameAt = (c, slot) => { const i = c.win.items[slot]; return i && i.itemCount > 0 ? items[i.itemId].name : null; };

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
  await waitEvent((e) => e.type === 'join' && e.player === 'Viewer'); // viewers only: Other's join stays silent
  await c.command('bots'); // open from /bots
  let ev = await waitEvent((e) => e.type === 'lage' && e.player === 'Viewer'); // /bots opens the Lagebild
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

  // a refresh show never re-opens a closed dialog; a plain show does and re-arms; a refresh show while tracked works
  const shown = c.dialogs.length;
  assert.deepEqual(await (await post('/show', {player: 'Viewer', dialog: big, refresh: true})).json(), {ok: false, feedback: 'closed'});
  await sleep(500);
  assert.equal(c.dialogs.length, shown);
  assert.equal((await (await post('/show', {player: 'Viewer', dialog: big})).json()).ok, true);
  assert.equal((await (await post('/show', {player: 'Viewer', dialog: big, refresh: true})).json()).ok, true);
  await waitFor(() => c.dialogs.length === shown + 2);
  await c.look(45, 10);
  await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');

  // gaze: a chest three blocks to the east, looked at from the side
  const [px, py, pz] = ev0.pos;
  const chest = [px + 3, py, pz];
  fs.appendFileSync(CONSOLE, `setblock ${chest.join(' ')} chest[facing=west]\n`);
  await sleep(1000);
  await c.look(-90, 25);
  await sleep(500);
  await c.command('bots'); // the lage event carries the gaze too
  ev = await waitEvent((e) => e.type === 'lage' && e.player === 'Viewer');
  assert.deepEqual(ev.gaze, {x: chest[0], y: chest[1], z: chest[2], block: 'chest'});

  // Shift+F: needs sneaking, and a plain F is left alone
  c.swap();
  await assertNoEvent((e) => e.type === 'open', 1500);
  c.sneak(true);
  await sleep(300);
  c.swap();
  await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
  c.sneak(false);

  // staff: /zauberstab hands it out (viewers only); right click opens with gaze, left click is a report, a usable block is left to vanilla
  await other.command('zauberstab');
  await sleep(500);
  assert.ok(!other.inv.some((i) => i && i.itemCount > 0), 'non-viewer gets no staff');
  await c.command('zauberstab');
  await waitFor(() => c.inv.some((i) => i && i.itemCount > 0));
  // the staff lands in the selected hotbar slot (slot 0 = window slot 36), with the hint in chat
  await waitFor(() => c.chats.some((m) => m.includes('Zauberstab') && m.includes('Hand')));
  assert.ok(c.inv[36] && c.inv[36].itemCount > 0 && JSON.stringify(c.inv[36]).includes('Zauberstab'), `staff in hand: ${JSON.stringify(c.inv[36])}`);
  // Paper drops a use_item that aims at a block within reach (the client would send block_place), so aim at a stone 8 blocks away
  const stone = [px + 8, py + 1, pz];
  fs.appendFileSync(CONSOLE, `setblock ${stone.join(' ')} stone\n`);
  await sleep(1000);
  await c.look(-90, 0);
  await sleep(300);
  c.useItem('main_hand', {x: -90, y: 0});
  ev = await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
  assert.deepEqual(ev.gaze, {x: stone[0], y: stone[1], z: stone[2], block: 'stone'});
  c.leftClick();
  ev = await waitEvent((e) => e.type === 'lage' && e.player === 'Viewer');
  assert.equal(ev.gaze.block, 'stone');
  const windows = c.windows.length;
  await sleep(600); // the right-click cooldown
  c.useBlock(...chest); // a chest while not sneaking
  await assertNoEvent((e) => e.player === 'Viewer' && e.type !== 'closed', 1500);
  await waitFor(() => c.windows.length > windows); // vanilla opened the chest
  c.closeWindow(c.windows[c.windows.length - 1]);
  // entity aim: an armor stand between the viewer and the stone
  fs.appendFileSync(CONSOLE, `summon armor_stand ${px + 2.5} ${py} ${pz + 0.5}\n`);
  await sleep(1000);
  await sleep(600);
  c.useItem('main_hand', {x: -90, y: 0});
  ev = await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
  assert.deepEqual(ev.gaze.entity, {type: 'armor_stand', name: null, x: px + 2, y: py, z: pz});
  assert.equal(ev.gaze.block, 'stone');

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

  // menus: a chest and a hopper of display items; every click and drag is cancelled, only slots with a payload report
  const menuBody = (o) => ({player: 'Viewer', type: 'chest', title: 'Test', slots: [{slot: 4, item: 'iron_ore', name: 'Eisen', lore: ['a', 'b'], payload: {a: 'x', n: 1}}], ...o});
  const mpost = async (o) => (await post('/menu', menuBody(o))).json();
  assert.equal((await post('/menu', menuBody({slots: [{slot: 27, item: 'stone', name: 'x', payload: {}}]}))).status, 400);
  assert.equal((await post('/menu', menuBody({player: 'Nobody'}))).status, 400);
  assert.equal((await mpost({})).ok, true);
  await waitFor(() => c.win.items.length > 0 && nameAt(c, 4) === 'iron_ore');
  assert.equal(c.win.items.length, 27 + 36);
  const invBefore = JSON.stringify(c.inv);
  assert.ok(c.inv[36] && c.inv[36].itemCount > 0, 'the staff is still in hand');
  c.clickWindow(4, 0, 0);
  ev = await waitEvent((e) => e.type === 'click' && e.player === 'Viewer');
  assert.deepEqual(ev.data, {a: 'x', n: 1, shift: false});
  c.clickWindow(4, 0, 1);
  ev = await waitEvent((e) => e.type === 'click' && e.player === 'Viewer');
  assert.deepEqual(ev.data, {a: 'x', n: 1, shift: true});
  c.clickWindow(54, 0, 1); // shift-click on the player's own hotbar slot 0
  c.clickWindow(4, 0, 2); // number key 1 onto the menu slot
  c.clickWindow(4, 40, 2); // offhand key
  c.clickWindow(4, 0, 5); // drag start/end over the menu slot
  c.clickWindow(4, 1, 5); c.clickWindow(4, 2, 5);
  c.clickWindow(54, 0, 6); c.clickWindow(4, 0, 6); // double-click collect
  c.clickWindow(5, 0, 0); // an empty menu slot
  await assertNoEvent((e) => e.type === 'click' || e.type === 'closed', 1500);
  assert.equal(JSON.stringify(c.inv), invBefore);
  assert.equal(nameAt(c, 4), 'iron_ore');
  // same type, rows and title: updated in place, no close, no reopen
  const wins = c.windows.length;
  assert.equal((await mpost({slots: [{slot: 4, item: 'gold_ore', name: 'Gold', payload: {a: 'y'}}]})).ok, true);
  await waitFor(() => nameAt(c, 4) === 'gold_ore');
  assert.equal(c.windows.length, wins);
  c.clickWindow(4, 0, 0);
  assert.deepEqual((await waitEvent((e) => e.type === 'click' && e.player === 'Viewer')).data, {a: 'y', shift: false});
  // another title replaces the window without a close event
  assert.equal((await mpost({title: 'Other'})).ok, true);
  await waitFor(() => c.windows.length === wins + 1 && nameAt(c, 4) === 'iron_ore');
  await assertNoEvent((e) => e.type === 'closed', 1000);
  // an unknown item renders as paper
  assert.equal((await mpost({slots: [{slot: 0, item: 'no_such_item', name: 'Q', payload: {}}]})).ok, true);
  await waitFor(() => nameAt(c, 0) === 'paper');
  // a client close is one closed event; a refresh after it is refused
  c.closeWindow(c.win.id);
  await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');
  await assertNoEvent((e) => e.type === 'closed', 500);
  assert.deepEqual(await mpost({refresh: true}), {ok: false, feedback: 'closed'});
  // a dialog and a menu replace each other without a closed event
  assert.equal((await mpost({})).ok, true);
  await waitFor(() => c.windows.length === wins + 3);
  const dl = c.dialogs.length;
  assert.equal((await (await post('/show', {player: 'Viewer', dialog: big})).json()).ok, true);
  await waitFor(() => c.dialogs.length === dl + 1);
  assert.equal((await mpost({title: 'After dialog'})).ok, true);
  await waitFor(() => c.windows.length === wins + 4);
  await assertNoEvent((e) => e.type === 'closed', 1000);
  c.closeWindow(c.win.id);
  await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');
  // hopper: five slots
  assert.equal((await mpost({type: 'hopper', slots: [0, 1, 2, 3, 4].map((i) => ({slot: i, item: 'stone', name: `S${i}`, payload: {i}}))})).ok, true);
  await waitFor(() => c.win.items.length === 5 + 36 && nameAt(c, 4) === 'stone');
  c.closeWindow(c.win.id);
  await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');
  // furnace: a real FURNACE view, slots 0 input / 1 fuel / 2 output; nothing moves, only payload clicks report
  const fslots = (n) => [{slot: 0, item: 'raw_iron', name: 'Roheisen', payload: {a: 'in'}}, {slot: 1, item: 'coal', name: 'Kohle', payload: {a: 'fuel'}}, {slot: 2, item: 'iron_ingot', name: 'Eisenbarren', count: n, payload: {a: 'out'}}];
  assert.equal((await post('/menu', menuBody({type: 'furnace', slots: [{slot: 3, item: 'stone', name: 'x', payload: {}}]}))).status, 400);
  assert.equal((await mpost({type: 'furnace', title: 'Ofen', slots: fslots(8)})).ok, true);
  await waitFor(() => c.win.type === 14 && // menu type id 14 = furnace
     nameAt(c, 2) === 'iron_ingot');
  assert.equal(c.win.items.length, 3 + 36);
  const finv = JSON.stringify(c.inv);
  c.clickWindow(2, 0, 0);
  assert.deepEqual((await waitEvent((e) => e.type === 'click' && e.player === 'Viewer')).data, {a: 'out', shift: false});
  c.clickWindow(2, 0, 1);
  assert.deepEqual((await waitEvent((e) => e.type === 'click' && e.player === 'Viewer')).data, {a: 'out', shift: true});
  c.clickWindow(0, 0, 2); // number key onto the input
  c.clickWindow(1, 0, 5); // drag over the fuel
  c.clickWindow(30, 0, 1); // shift-click the player's own hotbar slot 0
  await assertNoEvent((e) => e.type === 'click' || e.type === 'closed', 1500);
  assert.equal(JSON.stringify(c.inv), finv);
  const fw = c.windows.length;
  assert.equal((await mpost({type: 'furnace', title: 'Ofen', slots: fslots(16)})).ok, true);
  await waitFor(() => c.win.items[2] && c.win.items[2].itemCount === 16);
  assert.equal(c.windows.length, fw);
  await assertNoEvent((e) => e.type === 'closed', 500);
  // a chest replaces the furnace without a close; the client close is one closed, and a refresh is refused
  assert.equal((await mpost({})).ok, true);
  await waitFor(() => c.win.items.length === 27 + 36 && nameAt(c, 4) === 'iron_ore');
  await assertNoEvent((e) => e.type === 'closed', 1000);
  assert.equal((await mpost({type: 'furnace', title: 'Ofen', slots: fslots(8)})).ok, true);
  await waitFor(() => c.win.items.length === 3 + 36);
  c.closeWindow(c.win.id);
  await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');
  await assertNoEvent((e) => e.type === 'closed', 500);
  assert.deepEqual(await mpost({type: 'furnace', title: 'Ofen', slots: fslots(8), refresh: true}), {ok: false, feedback: 'closed'});
  // /close takes an open menu away too, quietly (no closed event: the hub asked for it)
  assert.equal((await mpost({})).ok, true);
  await waitFor(() => c.win.id !== 0 && nameAt(c, 4) === 'iron_ore');
  assert.equal((await post('/close', {player: 'Viewer'})).status, 200);
  await waitFor(() => c.win.id === 0);
  await assertNoEvent((e) => e.type === 'closed', 1000);
  assert.equal((await (await post('/actionbar', {player: 'Viewer', text: 'hi'})).json()).ok, true);
  assert.equal((await post('/actionbar', {player: 'Nobody', text: 'hi'})).status, 400);

  // a non-viewer's forged click reaches neither the queue nor the raytrace
  await other.click('botui:do', {a: 'bot', bot: 'bot7'});
  await assertNoEvent((e) => e.player === 'Other', 1500);

  // teleport and death take a dialog away without its exit action: no refresh may bring it back.
  // Its own player: the later e2e files log Viewer in again, and a dead player stays dead across a relog.
  await post('/viewers', {names: ['Viewer', 'Dying']});
  const dying = await connect('Dying');
  for (const cmd of ['tp Dying 0 120 0', 'kill Dying']) {
    assert.equal((await (await post('/show', {player: 'Dying', dialog: big})).json()).ok, true);
    fs.appendFileSync(CONSOLE, cmd + '\n');
    await waitEvent((e) => e.type === 'closed' && e.player === 'Dying');
    assert.deepEqual(await (await post('/show', {player: 'Dying', dialog: big, refresh: true})).json(), {ok: false, feedback: 'closed'});
  }
  await dying.end();

  await c.end();
  await waitEvent((e) => e.type === 'quit' && e.player === 'Viewer');
  await other.end();
  assert.ok(!fs.readFileSync(LOG, 'utf8').includes('Displayed dialog'), 'dialog show must not log to the console');
  console.log('e2e-bridge ok');
})().catch((e) => { console.error(e); process.exit(1); });
