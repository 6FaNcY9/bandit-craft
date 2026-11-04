// Run against a running stand (stand.sh up), NODE_PATH = mcbots node_modules: node e2e-map.js
// The stand's BlueMap is http://127.0.0.1:18100 (stand.sh default); this script serves a fake one there.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const zlib = require('node:zlib');
const nbt = require('prismarine-nbt');
const {connect} = require('./client');

const STAND = `${process.env.XDG_RUNTIME_DIR}/botui-stand`;
const CONSOLE = `${STAND}/in`;
const URL = 'http://127.0.0.1:8101';
const post = (path, body) => fetch(URL + path, {method: 'POST', headers: {Authorization: 'Bearer stand-token'}, body: JSON.stringify(body)});
const postJson = async (path, body) => (await post(path, body)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (text) => fs.appendFileSync(CONSOLE, text + '\n');
let since = 0;

async function waitEvent(pred, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const {events, last} = await (await fetch(`${URL}/events?since=${since}&wait=1`, {headers: {Authorization: 'Bearer stand-token'}})).json();
    since = Math.max(since, last);
    const hit = events.find(pred);
    if (hit) return hit;
  }
  throw new Error('timeout waiting for event');
}
const assertNoEvent = (pred, ms) => assert.rejects(waitEvent(pred, ms), /timeout waiting/);
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(50); }
  throw new Error('timeout in waitFor');
}

// A 501x1002 RGBA PNG, red in the top half (BlueMap's colour half) and green below it.
function png() {
  const w = 501, h = 1002, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(y < 501 ? [200, 30, 30, 255] : [30, 200, 30, 255], y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const requests = [];
const tile = png();
// Odd tile columns are "not rendered yet" (404), so half the map stays blank.
const bluemap = http.createServer((req, res) => {
  requests.push(req.url);
  const m = /^\/maps\/world\/tiles\/1\/x(-?\d+)\/z(-?\d+)\.png$/.exec(req.url);
  if (!m || Number(m[1]) % 2) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', 'image/png');
  res.end(tile);
});

const itemsOf = (c, id) => c.inv.filter((s) => s && s.itemCount > 0 && s.itemId === id).length;
// the newest full repaint as a set of palette bytes: a rendered tile gives one colour, a 404 tile gives 0
const palette = (c) => new Set(c.maps.findLast((m) => m.data?.length === 128 * 128)?.data || []);
const pixelPackets = (c) => c.maps.filter((m) => m.data).length;
// the icon captions of the newest packet that carries icons (the server repeats them every few ticks)
const names = (c) => (c.maps.findLast((m) => m.icons?.length)?.icons || []).map((i) => (i.displayName ? JSON.stringify(nbt.simplify(i.displayName)) : null));

(async () => {
  await new Promise((r, j) => bluemap.once('error', j).listen(18100, '127.0.0.1', r));
  const FILLED_MAP = require('minecraft-data')('26.1').itemsByName.filled_map.id;
  await post('/viewers', {names: ['Viewer', 'Full']});
  await fetch(`${URL}/events?since=0&wait=0`, {headers: {Authorization: 'Bearer stand-token'}}); // register a hub poll
  const c = await connect('Viewer'), full = await connect('Full'), other = await connect('Other');
  await c.command('bots');
  await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
  // The plugin keeps its tile cache for minutes across runs, so each run looks at tiles nobody has asked for yet.
  const base = 500 * (10 + (Date.now() % 100000)), centre = {x: base, z: base};
  for (const n of ['Viewer', 'Other', 'Full']) cmd(`clear ${n}`); // earlier runs leave items in the saved inventories
  await sleep(800);

  // give: one map in the inventory, and still one after a second give
  assert.deepEqual(await postJson('/map/give', {player: 'Viewer'}), {ok: true});
  await waitFor(() => itemsOf(c, FILLED_MAP) === 1);
  assert.deepEqual(await postJson('/map/give', {player: 'Viewer'}), {ok: true});
  await sleep(500);
  assert.equal(itemsOf(c, FILLED_MAP), 1, 'a second give must not add a copy');
  assert.equal((await post('/map/give', {player: 'bad name;'})).status, 400);
  assert.equal((await post('/map/give', {player: 'Nobody'})).status, 400);
  assert.deepEqual(await postJson('/map/give', {player: 'Other'}), {ok: false, error: 'Nicht freigeschaltet'});

  // a full inventory is refused with a reason and nothing is destroyed
  for (let i = 0; i < 36; i++) cmd(`item replace entity Full container.${i} with stone`);
  await waitFor(() => full.inv.filter((s) => s && s.itemCount > 0).length >= 36);
  assert.deepEqual(await postJson('/map/give', {player: 'Full'}), {ok: false, error: 'Inventar voll'});
  await sleep(300);
  assert.equal(full.inv.filter((s) => s && s.itemCount > 0).length, 36);
  await full.end();

  // /map: bad input is refused; a view with two markers arrives as colours and two named icons
  const view = {player: 'Viewer', zoom: 1, center: centre, markers: [
    {x: base + 10, z: base, dim: 'overworld', kind: 'work', label: 'MisaBot'},
    {x: base, z: base + 12, dim: 'overworld', kind: 'bad', label: '§cbot1 with a very long and \u0007 odd name'},
    {x: base + 5, z: base + 5, dim: 'the_nether', kind: 'idle', label: 'WrongWorld'},
    {x: base + 5000, z: base, dim: 'overworld', kind: 'idle', label: 'FarAway'},
  ]};
  for (const bad of [{...view, zoom: 3}, {...view, zoom: 'x'}, {...view, markers: 'x'}, {...view, center: {x: 'a', z: 1}}, {...view, markers: [{x: 1, z: 1, dim: 'overworld', kind: 'nope', label: 'a'}]}]) {
    assert.equal((await post('/map', bad)).status, 400, JSON.stringify(bad).slice(0, 80));
  }
  assert.deepEqual(await postJson('/map', {...view, player: 'Other'}), {ok: true}); // not a viewer: accepted, nothing stored
  assert.deepEqual(await postJson('/map', view), {ok: true});
  await waitFor(() => names(c).filter(Boolean).length >= 2 && palette(c).size === 2 && palette(c).has(0));
  assert.equal(names(c).length, 2, 'two markers, the other two are in another world or off the map');
  const icons = names(c).filter(Boolean).join('|');
  assert.match(icons, /MisaBot/); assert.match(icons, /"bot1 with a very"/); assert.doesNotMatch(icons, /§|\u0007|WrongWorld|FarAway/); // colour code and control char gone, 16 chars at most
  assert.ok(requests.length > 0 && requests.every((u) => u.startsWith('/maps/world/tiles/1/')), requests.join(' '));
  // tiles are cached, also the missing ones: more updates fetch nothing new
  const fetched = requests.length;
  await post('/map', {...view, markers: [view.markers[0]]});
  await sleep(2500);
  assert.equal(requests.length, fetched, 'cached tiles are not fetched again');

  // idle views cost nothing: the same view again repaints no pixels (the server resends the icons every few ticks on its own)
  await post('/map', {...view, markers: [view.markers[0]]});
  await sleep(2500);
  const seen = pixelPackets(c);
  for (let i = 0; i < 3; i++) await post('/map', {...view, markers: [view.markers[0]]});
  await sleep(2500);
  assert.equal(pixelPackets(c), seen, 'an unchanged view must not redraw');

  // right click: main hand opens the dialog (event), the off hand does not
  c.useItem();
  const click = await waitEvent((e) => e.type === 'mapclick' && e.player === 'Viewer');
  assert.equal(click.dim, 'overworld');
  cmd('give Viewer minecraft:filled_map'); // an untagged map next to ours stays a plain item
  await sleep(500);
  c.swap(); // plain F: the tagged map goes to the off hand
  await sleep(500);
  c.useItem('off_hand');
  await assertNoEvent((e) => e.type === 'mapclick', 1500);

  // a non-viewer: a plain map does nothing, and viewers lose the map when the hub drops them
  cmd('give Other minecraft:filled_map');
  await sleep(500);
  other.useItem();
  await assertNoEvent((e) => e.type === 'mapclick' && e.player === 'Other', 1500);
  c.swap(); // tagged map back into the main hand
  await sleep(500);
  const before = pixelPackets(c);
  await post('/viewers', {names: ['Other']});
  c.useItem();
  await assertNoEvent((e) => e.type === 'mapclick', 1500);
  await post('/map', {...view, zoom: 2});
  await sleep(2500);
  assert.equal(pixelPackets(c), before, 'a dropped viewer gets no map update');

  await c.end(); await other.end();
  bluemap.close();
  console.log('e2e-map ok');
})().catch((e) => { console.error(e); bluemap.close(); process.exit(1); });
