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
async function collect(pred, ms) {
  const end = Date.now() + ms, out = [];
  while (Date.now() < end) {
    const {events, last} = await (await fetch(`${URL}/events?since=${since}&wait=1`, {headers: {Authorization: 'Bearer stand-token'}})).json();
    since = Math.max(since, last);
    out.push(...events.filter(pred));
  }
  return out;
}
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(50); }
  throw new Error('timeout in waitFor');
}

// A 501x1002 RGBA PNG like BlueMap's: the colour half on top (left of column 250 / right of it), junk below.
function png(left, right) {
  const w = 501, h = 1002, raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(y >= 501 ? [255, 0, 255, 255] : [...(x < 250 ? left : right), 255], y * (w * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])));
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const RED = [200, 30, 30], BLUE = [30, 30, 200], GREEN = [30, 200, 30], YELLOW = [230, 230, 30];
const requests = [];
const pngs = new Map();
const tile = (left, right) => { const k = `${left}|${right}`; if (!pngs.has(k)) pngs.set(k, png(left, right)); return pngs.get(k); };
// What the fake BlueMap serves. Tiles far from the origin (the first scenario): red, odd columns "not rendered yet" (404).
// Around the origin each lod has a recognisable pattern for the geometry checks. Column 777 stalls with a half-sent body.
function serve(lod, i, j) {
  if (lod === 1 && i === 777) return 'stall';
  if (lod === 1 && (i >= 5 || j >= 5)) return i % 2 ? null : tile(RED, RED);
  if (lod === 1 && i >= -1 && i <= 0 && j >= -1 && j <= 0) return tile(...(i < 0 ? (j < 0 ? [RED, RED] : [GREEN, GREEN]) : (j < 0 ? [BLUE, BLUE] : [YELLOW, YELLOW])));
  if (lod === 2 && i === 0 && j === 0) return tile(RED, BLUE);
  if (lod === 3 && i === 0 && j === 0) return tile(GREEN, YELLOW);
  return null;
}
const bluemap = http.createServer((req, res) => {
  requests.push(req.url);
  const m = /^\/maps\/world\/tiles\/(\d)\/x(-?\d+)\/z(-?\d+)\.png$/.exec(req.url);
  const t = m && serve(Number(m[1]), Number(m[2]), Number(m[3]));
  if (t === 'stall') { res.writeHead(200, {'content-length': 1000000}); return res.write(Buffer.alloc(100)); }
  if (!t) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', 'image/png');
  res.end(t);
});

const itemsOf = (c, id) => c.inv.filter((s) => s && s.itemCount > 0 && s.itemId === id).length;
// a rendered tile gives one palette byte, a 404 tile gives 0
// The client's picture: every pixel packet applied in order (later updates only carry the changed rectangle).
const canvasOf = (c) => {
  const a = new Uint8Array(128 * 128);
  for (const m of c.maps) if (m.data) for (let r = 0; r < m.rows; r++) for (let q = 0; q < m.columns; q++) a[(m.y + r) * 128 + m.x + q] = m.data[r * m.columns + q];
  return a;
};
const palette = (c) => new Set(canvasOf(c));
const at = (a, x, y) => a[y * 128 + x];
const iconsOf = (c) => c.maps.findLast((m) => m.icons?.length)?.icons || [];
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
  const ev0 = await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
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

  // a cursor-only change (a bot moved) updates the icon and repaints no pixels
  const px0 = pixelPackets(c);
  await post('/map', {...view, markers: [{...view.markers[0], x: base + 13}]});
  await waitFor(() => iconsOf(c).some((i) => i.x === 26));
  await sleep(1500);
  assert.equal(pixelPackets(c), px0, 'a moved marker must not repaint the pixels');

  // geometry. lod 1 around a negative centre: the tile edge is where floor() puts it, with the right tile on each side
  const live = async (v, pred, what) => { await post('/map', {player: 'Viewer', markers: [], ...v}); await waitFor(() => pred(canvasOf(c)), 12000).catch(() => { throw new Error('geometry: ' + what); }); return canvasOf(c); };
  const q = await live({zoom: 1, center: {x: -30, z: -30}}, (a) => at(a, 10, 10) && at(a, 120, 120) && at(a, 120, 10) !== at(a, 10, 10), 'lod 1 quadrants');
  const [tl, tr, bl, br] = [at(q, 10, 10), at(q, 120, 10), at(q, 10, 120), at(q, 120, 120)];
  assert.equal(new Set([tl, tr, bl, br, 0]).size, 5, 'four different tiles');
  assert.deepEqual([at(q, 93, 10), at(q, 94, 10), at(q, 10, 93), at(q, 10, 94)], [tl, tr, tl, bl]); // bx = x - 94: tile -1 below 94
  // lod 2 (zoom 10) and lod 3 (zoom 50): block offset 1250 / 6250 is column 250 of the tile, in the middle of the map; the PNG's lower half is ignored
  for (const [zoom, cx, left, right] of [[10, 1250, tl, tr], [50, 6250, bl, br]]) {
    const a = await live({zoom, center: {x: cx, z: cx}}, (m) => at(m, 0, 0) === left && at(m, 127, 127) === right, `lod zoom ${zoom}`);
    for (const y of [0, 64, 127]) assert.deepEqual([at(a, 63, y), at(a, 64, y)], [left, right]);
  }

  // the player arrow follows the yaw: direction 0 is south, 4 is west, 8 is north
  const arrow = async (yaw, dir) => {
    c.look(yaw, 0);
    await post('/map', {player: 'Viewer', zoom: 1, center: null, markers: []});
    await waitFor(() => iconsOf(c).length === 1 && iconsOf(c)[0].direction === dir && !iconsOf(c)[0].displayName, 9000).catch(() => { throw new Error(`arrow for yaw ${yaw}: ${JSON.stringify(iconsOf(c))}`); });
  };
  await arrow(90, 4); await arrow(180, 8);

  // a stalled BlueMap body must not freeze the map: after the fetch timeout the rest of the view still arrives
  await live({zoom: 1, center: {x: 777 * 500, z: 5000 + 250}}, (a) => at(a, 10, 64) !== 0 && at(a, 120, 64) === 0, 'stalled tile'); // waits out the 10 s fetch bound

  // right click: main hand opens the dialog (event), the off hand does not
  await sleep(600);
  c.useItem();
  const click = await waitEvent((e) => e.type === 'mapclick' && e.player === 'Viewer');
  assert.equal(click.dim, 'overworld');

  // as in vanilla: a chest in reach is used, stone and sneaking give the dialog; a held button gives one event
  const [bx, by, bz] = [ev0.pos[0] + 1, ev0.pos[1], ev0.pos[2]];
  cmd(`setblock ${bx} ${by} ${bz} chest`);
  await sleep(800);
  await sleep(600);
  c.useBlock(bx, by, bz);
  await waitFor(() => c.windows.length > 0);
  assert.deepEqual(await collect((e) => e.type === 'mapclick', 1200), [], 'a chest opens instead of the dialog');
  c.closeWindow(c.windows.at(-1));
  c.sneak(true); await sleep(300);
  c.useBlock(bx, by, bz);
  assert.equal((await collect((e) => e.type === 'mapclick', 1200)).length, 1, 'sneaking: the dialog');
  c.sneak(false); await sleep(300);
  cmd(`setblock ${bx} ${by} ${bz} stone`);
  await sleep(800);
  const windows = c.windows.length;
  c.useBlock(bx, by, bz);
  assert.equal((await collect((e) => e.type === 'mapclick', 1200)).length, 1, 'a plain block: the dialog');
  assert.equal(c.windows.length, windows);
  for (let i = 0; i < 6; i++) { c.useItem(); await sleep(60); }
  assert.equal((await collect((e) => e.type === 'mapclick', 1500)).length, 1, 'rapid clicks give one event');
  cmd(`setblock ${bx} ${by} ${bz} air`);

  // a non-viewer holding a plain map, then the viewer's real tagged map: no event, and nothing of the viewer's map reaches them
  cmd('give Other minecraft:filled_map');
  await sleep(500);
  other.useItem();
  assert.deepEqual(await collect((e) => e.type === 'mapclick' && e.player === 'Other', 1000), []);
  cmd('item replace entity Other weapon.mainhand from entity Viewer weapon.mainhand');
  await waitFor(() => itemsOf(other, FILLED_MAP) >= 1);
  await post('/map', {...view, markers: [{...view.markers[0], x: base + 20}]});
  other.useItem();
  assert.deepEqual(await collect((e) => e.type === 'mapclick' && e.player === 'Other', 3500), []);
  assert.ok(other.maps.length > 0, 'the other player does get map packets for the item they hold');
  assert.ok(other.maps.every((m) => !m.icons?.length && (!m.data || m.data.every((b) => b === 0))), 'neither pixels nor bot icons leak to a non-viewer');

  cmd('give Viewer minecraft:filled_map'); // an untagged map next to ours stays a plain item
  await sleep(500);
  c.swap(); // plain F: the tagged map goes to the off hand
  await sleep(500);
  c.useItem('off_hand');
  assert.deepEqual(await collect((e) => e.type === 'mapclick', 1500), []);

  // viewers lose the map when the hub drops them
  c.swap(); // tagged map back into the main hand
  await sleep(500);
  const before = pixelPackets(c);
  await post('/viewers', {names: ['Other']});
  c.useItem();
  assert.deepEqual(await collect((e) => e.type === 'mapclick', 1500), []);
  await post('/map', {...view, zoom: 2});
  await sleep(2500);
  assert.equal(pixelPackets(c), before, 'a dropped viewer gets no map update');

  await c.end(); await other.end();
  bluemap.closeAllConnections();
  bluemap.close();
  console.log('e2e-map ok');
})().catch((e) => { console.error(e); bluemap.closeAllConnections(); bluemap.close(); process.exit(1); });
