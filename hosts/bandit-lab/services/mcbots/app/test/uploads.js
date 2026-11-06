'use strict';
// One-time upload links: token rules, file names, visibility, and the /upload handler over a loopback server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {Uploads, fileName, visible, handle, MAX_BYTES} = require('../uploads');
const {parseLitematic} = require('../schematic');
const {writeLitematic} = require('../litematic-write');
const {SCHEMATIC_RE} = require('../build');

(async () => {
  let t = 0;
  const up = new Uploads({now: () => t});
  const tok = up.issue('MidariBread');
  assert.match(tok, /^[0-9a-f]{32}$/);
  assert.equal(up.take('x'.repeat(32)), null, 'unknown token');
  assert.equal(up.take('../etc'), null);
  assert.equal(up.take(undefined), null);
  assert.equal(up.take(tok), 'MidariBread', 'the issuing player, nobody else');
  assert.equal(up.take(tok), null, 'one use');
  const tok2 = up.issue('A');
  t += 10 * 60 * 1000 - 1;
  assert.equal(up.peek(tok2), 'A');
  t += 1;
  assert.equal(up.take(tok2), null, 'expired after 10 min');

  assert.equal(fileName('MidariBread', 'My House!.litematic'), 'midaribread-My_House_.litematic');
  assert.equal(fileName('Abc', 'x'.repeat(80)).length, 4 + 40 + 10);
  assert.ok(SCHEMATIC_RE.test(fileName('a'.repeat(16), 'x'.repeat(80))), 'longest name still fits the schematic pattern');
  const files = ['fancy8869-a.litematic', 'midaribread-b.litematic', 'shared.litematic'];
  assert.deepEqual(visible(files, 'MidariBread', false, ['fancy8869', 'MidariBread']), ['midaribread-b.litematic', 'shared.litematic']);
  assert.deepEqual(visible(files, 'fancy8869', true, ['fancy8869', 'MidariBread']), files, 'the owner sees everything');

  assert.deepEqual(visible(['MIDARIBREAD-x.litematic', 'Fancy8869-y.litematic'], 'MidariBread', false, ['fancy8869', 'MidariBread']), ['MIDARIBREAD-x.litematic'], 'prefix match ignores case');

  // the handler
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
  const events = [], said = [];
  const deps = {uploads: new Uploads(), dir, parse: parseLitematic, page: '<p>seite</p>', csp: "default-src 'none'", events: {add: (...a) => events.push(a)},
    say: (...a) => said.push(a), fileRe: SCHEMATIC_RE, sameOrigin: () => true};
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/upload' && (req.method === 'GET' || req.method === 'POST')) return handle(req, res, url, deps);
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (q, body, type = 'application/octet-stream') => fetch(`${base}/upload?${q}`, {method: 'POST', body, headers: {'content-type': type}});
  const good = writeLitematic({name: 't', regions: [{name: 'r', position: {x: 0, y: 0, z: 0}, size: {x: 1, y: 1, z: 1}, blocks: [{x: 0, y: 0, z: 0, name: 'stone'}]}]});
  const stored = () => fs.readdirSync(dir).sort();

  assert.equal((await fetch(`${base}/upload`)).status, 403, 'no token');
  assert.equal((await fetch(`${base}/upload?t=${'a'.repeat(32)}`)).status, 403);
  assert.match(await (await fetch(`${base}/upload?t=zz`)).text(), /ungültig/);
  let tk = deps.uploads.issue('MidariBread');
  let r = await fetch(`${base}/upload?t=${tk}`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-security-policy'), "default-src 'none'");
  assert.equal(deps.uploads.peek(tk), 'MidariBread', 'GET does not consume');

  r = await post(`t=${tk}&name=junk`, Buffer.from('not a litematic'));
  assert.equal(r.status, 400); assert.deepEqual(stored(), []);
  assert.equal(deps.uploads.peek(tk), 'MidariBread', 'a failed upload keeps the token');
  r = await post(`t=${tk}&name=big`, Buffer.alloc(MAX_BYTES + 1));
  assert.equal(r.status, 413); assert.deepEqual(stored(), []);
  assert.equal(deps.uploads.peek(tk), 'MidariBread');
  r = await post(`t=${tk}&name=x`, good, 'text/plain');
  assert.equal(r.status, 403);
  r = await post(`t=${tk}&name=House&player=fancy8869`, good);
  assert.equal(r.status, 200);
  assert.deepEqual(stored(), ['midaribread-House.litematic'], 'the player comes from the token');
  assert.deepEqual(events.at(-1).slice(2), ['schematic midaribread-House.litematic uploaded by MidariBread']);
  assert.deepEqual(said.at(-1), ['MidariBread', 'Server', 'Bauplan bereit: midaribread-House']);
  r = await post(`t=${tk}&name=House2`, good);
  assert.equal(r.status, 403); assert.match((await r.json()).error, /ungültig/, 'token used up, German JSON');
  assert.deepEqual(stored(), ['midaribread-House.litematic']);

  // 50 files per player; overwriting one of them is still fine
  for (let i = 0; i < 49; i++) fs.writeFileSync(path.join(dir, `midaribread-f${i}.litematic`), good);
  tk = deps.uploads.issue('MidariBread');
  r = await post(`t=${tk}&name=one-too-many`, good);
  assert.equal(r.status, 400); assert.match((await r.json()).error, /Zu viele.*\(50\)/);
  assert.equal(deps.uploads.peek(tk), 'MidariBread');
  assert.equal((await post(`t=${tk}&name=f0`, good)).status, 200);
  assert.equal(stored().filter((f) => f.endsWith('.tmp')).length, 0, 'no temp file left');
  // per token: a parallel POST gets 409 while the first parses; the mark clears after a failed parse and after success
  const slow = Object.assign(deps, {parse: (b, o) => new Promise((res) => setTimeout(res, 150)).then(() => parseLitematic(b, o))});
  tk = deps.uploads.issue('MidariBread');
  const [a, b] = await Promise.all([post(`t=${tk}&name=f0`, good), new Promise((res) => setTimeout(res, 30)).then(() => post(`t=${tk}&name=f1`, good))]);
  assert.equal(b.status, 409); assert.deepEqual(await b.json(), {error: 'Upload läuft schon'}); assert.equal(a.status, 200);
  assert.equal(deps.uploads.busy.size, 0);
  tk = deps.uploads.issue('MidariBread');
  assert.equal((await post(`t=${tk}&name=junk2`, Buffer.from('nope'))).status, 400);
  assert.equal((await post(`t=${tk}&name=f0`, good)).status, 200, 'usable again after a failed parse');
  deps.parse = slow.parse;
  // /upload caps a region at 3 M cells (the dashboard keeps 8 M)
  const nbt = require('prismarine-nbt'), zlib = require('node:zlib');
  const parsed = await nbt.parse(good);
  const sz = parsed.parsed.value.Regions.value.r.value.Size.value;
  sz.x.value = 3001; sz.y.value = 1000; sz.z.value = 1;
  tk = deps.uploads.issue('MidariBread');
  r = await post(`t=${tk}&name=huge`, zlib.gzipSync(nbt.writeUncompressed(parsed.parsed)));
  assert.equal(r.status, 400); assert.equal((await r.json()).error, 'Bauplan zu groß (max 3 Mio. Blöcke)');
  assert.equal(deps.uploads.peek(tk), 'MidariBread');
  srv.close();
  fs.rmSync(dir, {recursive: true});
  console.log('uploads ok');
})().catch((e) => { console.error(e); process.exit(1); });

// parseLitematic caps (DoS): a gzip bomb and a Size that multiplies past the cell cap
(async () => {
  const zlib = require('node:zlib');
  await assert.rejects(parseLitematic(zlib.gzipSync(Buffer.alloc(40 * 1024 * 1024))), /zu groß/);
  const big = writeLitematic({name: 't', regions: [{name: 'r', position: {x: 0, y: 0, z: 0}, size: {x: 1, y: 1, z: 1}, blocks: [{x: 0, y: 0, z: 0, name: 'stone'}]}]});
  const nbt = require('prismarine-nbt');
  const parsed = await nbt.parse(big);
  const sz = parsed.parsed.value.Regions.value.r.value.Size.value;
  sz.x.value = 3000; sz.y.value = 3000; sz.z.value = 3000;
  await assert.rejects(parseLitematic(zlib.gzipSync(nbt.writeUncompressed(parsed.parsed))), /8 Mio/);
  console.log('uploads caps ok');
})().catch((e) => { console.error(e); process.exit(1); });
