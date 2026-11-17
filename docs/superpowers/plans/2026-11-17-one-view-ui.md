# One View UI (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard becomes one screen: a live 3D world from the block model is always there, bots move in it, the bots' schematic plans stand in it with build status, and the old pages are sheets over it behind a bottom bar.

**Architecture:** The hub's world worker gains one op, `planStatus` (plan cells against the model, cached per world change); the main loop only relays its bytes on `GET /api/plan/status`. In the browser a Web Worker fetches section batches, decodes them with the hub's own `worldsection.js`, keeps a bounded cache, meshes sections and groups plan status; the page thread only draws (three.js r159, render on demand) and runs the old page code inside sheets.

**Tech Stack:** Node 22 (`node:worker_threads`, `node:zlib`, `node:vm` in tests), browser classic scripts and one Web Worker, vendored three.js r159 (`public/vendor/three.min.js`, no addons), headless Chromium for the phone-width look. No new npm dependency, no CDN, no plugin change (no Paper restart).

**Spec:** `docs/superpowers/specs/2026-11-17-one-view-world-design.md` (sections "Layout", "World model" browser routes, "Plans and progress", "Phases" 1, "Success checks" 5). Phase 0 formats: `docs/superpowers/plans/2026-11-17-world-model.md` "Formats". Phase 0 ledger: `.superpowers/sdd/2026-11-17-world-model/progress.md`.

## Global Constraints

- The hub's main event loop relays buffers only: no schematic parsing, no status compare, no decoding on it. Browser: decoding, meshing and status parsing only in the Web Worker.
- No new npm dependency; three.js is the vendored r159 classic build; no CDN. The page keeps one inline `<script>` (the CSP hashes the first one, `server.js:165-166`); every other script is a file under `/oneview/` or `/vendor/`.
- Unknown is never drawn as air: an unknown or ungenerated chunk shows a grey tile; a plan cell in such a chunk has status 3, never 0.
- Status `s`: 0 missing, 1 built, 2 wrong, 3 unknown. Drawing: built solid, missing a 35 % ghost, wrong red at scale 1.02, unknown a grey ghost, `polygonOffset` against the terrain.
- First area only (centre -270, -20, radius 320; chunks cx -37..3, cz -22..18), main world only. The whole area has negative x: every chunk, tile and block conversion uses `Math.floor`, never `| 0` or `Math.trunc`.
- The new browser code calls only `/api/world/sections`, `/api/world/changes`, `/api/plan/status` and `/api/architect/status`. Never `sample` (no single-flight on the hub, loads Paper chunks), `blocks`, `height`, `materials`.
- No chat code. The 💬 button exists hidden and shows only when `GET /api/architect/status` answers 200 (it answers 404 in this phase). No `plan-sites.json`, no follow camera, no pins (phases 2 and 3).
- Misa and staff (other allowed logins) get world, bots and plans: every new route sits behind the existing `authorized` gate (`server.js:578`), nothing more.
- UI text: German, short, simple words; text reaches the page through `textContent` only (`el()` in `index.html`). Touch targets at least 44 px, bar buttons 56 px. Phone width (390 px) first, desktop second. `public/legacy.html` is not touched.
- Numbers (fixed here, inside the spec's bounds): tile = 3 x 3 chunks (`sections?r=1`), 2 section requests in flight, view radius 5 chunks on a phone (`max-width: 899px`) and 9 on desktop, columns kept to radius + 1, retry after 2 s doubling to 30 s, `changes` single-flight as soon as `worldSeq` moves, plan status at most every 5 s per plan and only after `worldSeq` moved, nothing fetched while `document.hidden`, a plan of more than 200,000 cells answers 413.
- Commit unsigned in the worktree; never push, never deploy. After code changes run `graphify update .`.
- Tests: pure parts `cd hosts/bandit-lab/services/mcbots/app && node test/<part>.js`; parts that load npm modules (`plan-status`, `plan-api`, `world-model`, `debug-api`, the stand) need `NODE_PATH=$(ls -dt /nix/store/*-mcbots-0.1.0/lib/node_modules/mcbots/node_modules | head -1)`. Full check after commit: `nix build --no-link "git+file://$PWD?rev=$(git rev-parse HEAD)#checks.x86_64-linux.mcbots-tests"`. New files must be `git add`ed or the flake does not see them.

## Review Focus

1. A phone panned across the whole area (1681 chunks): loaded columns stay at 225 or fewer, far ones are dropped and their geometry disposed. Pinned in Task 4 (bound), Task 11 (dispose, stats).
2. Hub or world-worker restart while the page is open (503s, `/ws` drops, `worldSeq` 0 for a moment): the world stays on screen, requests retry with backoff, nothing reloads, no error toast loop. Pinned in Task 4 (seq 0, backoff), Task 8 (worker test, hub down).
3. `worldSeq` jumps: a Paper restart re-sweep, a tab asleep for an hour (`more: true`), a wiped store (lower seq): one resync or reset, not thousands of requests. Pinned in Task 4, Task 8.
4. Plan data that is not there: plan chunks unknown (status 3, never missing), a bot without a schematic project (404, no chip, no toast), a plan file deleted or replaced while shown, a plan over 200,000 cells ("zu groß"). Pinned in Task 5, Task 6, Task 8, Task 12.
5. Two viewers polling the same plan at once (phone and desktop, or Misa): one computation per world change, and the cached bytes survive being sent to the main thread. Pinned in Task 5.

---

## Shared definitions (used by Tasks 1-12)

**Dual modules.** Every pure file in `public/oneview/` runs in Node (tests), in the page and in the worker. It declares no top-level name (the worker loads them all into one scope) and uses this wrapper, here for `mesher.js`:

```js
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./blocks.js'));
  else (root.OV = root.OV || {}).mesher = factory(root.OV.blocks);
})(typeof self !== 'undefined' ? self : globalThis, function (blocks) {
  return {meshSection};
});
```

Browser names: `OV.section` (`app/worldsection.js`), `OV.blocks`, `OV.mesher`, `OV.worldcache`, `OV.planview`, `OV.makeView`, `OV.makeLayers`.

**Worker messages** (`public/oneview/worker.js`; typed arrays are transferred):

```
page -> worker
  {t:'view', cx, cz, viewR}        target chunk; the first one creates the cache
  {t:'seq', seq}                   state.worldSeq of every /ws message
  {t:'cut', y}                     last visible world y; 319 = no cut
  {t:'plans', list:[{key, bot}]}   the plans to follow (planview.plansOf)
  {t:'pause', on}                  document.hidden
worker -> page
  {t:'mesh', cx, sy, cz, pos, col, idx}    pos null = the section has no faces (remove its mesh)
  {t:'chunk', cx, cz, state}               0 known, 1 ungenerated, 2 unknown, -1 dropped (remove everything of the column)
  {t:'reset'}                              drop all terrain
  {t:'plan', key, file, counts, percent, box, groups}   or {t:'plan', key, state:'gone'|'big'}
  {t:'net', ok}                            false after a failed request, true after the next good one
```

**Plan status reply** (`GET /api/plan/status`, gzip JSON): `{file, origin: {x,y,z}, seq, palette: [name], blocks: [[x,y,z,i,s]], counts: [missing, built, wrong, unknown]}`; absolute coordinates, names without `minecraft:` and without properties, `counts[s]` = cells with status `s`.

## File Structure

| File | Responsibility |
|---|---|
| `app/worldsection.js` | Unchanged format; the decode path works without `Buffer` and `require`; exports as `OV.section` in a browser. |
| `app/public/oneview/blocks.js` | Pure: block name, drawn or not, colour (the old `planColor`). |
| `app/public/oneview/mesher.js` | Pure: one section -> faces. |
| `app/public/oneview/worldcache.js` | Pure: which tiles to fetch, what to mesh again, eviction, `worldSeq` and `changes`. |
| `app/public/oneview/planview.js` | Pure: plan keys, status reply -> draw groups, counts, percent. |
| `app/public/oneview/worker.js` | Web Worker glue: fetch, decode, cache, mesh, plan polling. |
| `app/public/oneview/view.js` | Page: three.js scene, camera, terrain meshes, grey tiles, tap pick. |
| `app/public/oneview/layers.js` | Page: bot and player markers with name tags, plan ghosts. |
| `app/public/index.html` | Canvas always there, bottom bar, sheets around the old pages; Karte removed, the Plan tab becomes the 🏰 segment „Datei ansehen“. |
| `app/planstatus.js` | Worker side: plan cells against the model, caches. |
| `app/planapi.js` | Main side: `/api/plan/status` arguments and relay. |
| `app/build.js`, `projects.js`, `voxels.js`, `worldmodel-worker.js`, `server.js`, `test.js` | `planCells` export; `file`/`origin` in `view()`; `NOT_DRAWN` from `blocks.js`; op `planStatus`; routes; new test parts. |
| `app/test/view-{blocks,mesher,cache,plan,worker,page}.js`, `test/plan-{status,api}.js` | Tests (plain asserts, registered in `test.js`). |
| `tools/oneview-stand/{stand.js,check.js}` | Local stand: real hub, fake plugin, fake worker bots, one plan; HTTP and headless-browser checks. |

(`app/` = `hosts/bandit-lab/services/mcbots/app/`.)

---

### Task 1: Block names, drawn or not, colours

**Files:**
- Create: `app/public/oneview/blocks.js`
- Modify: `app/voxels.js:7` (import `NOT_DRAWN` instead of defining it)
- Test: `app/test/view-blocks.js`; add `'view-blocks'` to the list in `app/test.js:8`

**Interfaces:**
- Produces (`OV.blocks`):
  - `NOT_DRAWN: RegExp` (the regex of `voxels.js:7`, moved, same source)
  - `nameOf(state: string): string` (`'minecraft:oak_stairs[facing=east]'` -> `'oak_stairs'`)
  - `drawn(name: string): boolean` (`!NOT_DRAWN.test(name)`)
  - `rgb(name: string): [r, g, b]` (0..255: the `PLANCOL` table of `index.html:768-769`, first match wins; else hue = string hash % 360 with the hash of `planColor`, saturation 0.3, lightness 0.55, converted without three.js)

- [ ] **Step 1: Write the failing test**

```js
const assert = require('node:assert');
const b = require('../public/oneview/blocks.js');
assert.strictEqual(b.nameOf('minecraft:oak_stairs[facing=east,half=bottom]'), 'oak_stairs');
assert.strictEqual(b.nameOf('stone'), 'stone');
for (const n of ['air', 'cave_air', 'short_grass', 'torch', 'oak_wall_sign', 'rail']) assert.ok(!b.drawn(n), n);
for (const n of ['stone', 'water', 'glass', 'oak_leaves', 'chest']) assert.ok(b.drawn(n), n);
assert.deepStrictEqual(b.rgb('stone'), [0x8a, 0x8a, 0x8a]);
assert.deepStrictEqual(b.rgb('glass'), [0xbf, 0xe8, 0xf5]);
assert.deepStrictEqual(b.rgb('dark_oak_planks'), [0x4a, 0x30, 0x18]);
const c = b.rgb('zzz_new_block');
assert.ok(c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
assert.deepStrictEqual(b.rgb('zzz_new_block'), c);
assert.strictEqual(require('../voxels').collect({x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 0}, () => 'torch').blocks.length, 0); // voxels.js still hides what blocks.js hides
```

- [ ] **Step 2: Run it** — `node test/view-blocks.js`. Expected: FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `blocks.js`** (wrapper from "Shared definitions", no dependency) and change `voxels.js:7` to `const {NOT_DRAWN} = require('./public/oneview/blocks.js');`.
- [ ] **Step 4: Run it** and `node test/debug-api.js` (with `NODE_PATH`; its voxels part must still pass). Expected: exit 0.
- [ ] **Step 5: Commit** — `feat(view): block names and colours shared by hub tests, page and worker`.

### Task 2: The section codec in a browser, and the `/oneview/` files

**Files:**
- Modify: `app/worldsection.js` (decode path, export tail), `app/server.js` (file map next to `:161`, route next to the `/vendor/three.min.js` route `:669`)
- Test: `app/test/world-section.js` (append), `app/test/debug-api.js` (append inside the spawned-server block, after the `/api/world/stats` asserts)

**Interfaces:**
- Produces:
  - `decodeSection(buf: Uint8Array)`, `decodeBatch(buf: Uint8Array)`: same results as today; a `Buffer` is a `Uint8Array`, so hub callers do not change. In a browser the file sets `OV.section` to the same object it exports in Node.
  - `GET /oneview/<name>.js` behind the login gate: `app/worldsection.js` as `worldsection.js` plus every `public/oneview/*.js` (read once at start, names matching `/^[\w-]+\.js$/`). Headers: `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; script-src 'self'; connect-src 'self'` (a worker takes its policy from its own script). Any other name: 404 JSON.

- [ ] **Step 1: Write the failing tests**

`world-section.js`:
```js
// the browser's copy is this same file: no require, no Buffer on the decode path
const vm = require('node:vm'), fs = require('node:fs');
const ctx = vm.createContext({TextDecoder}); ctx.self = ctx;
vm.runInContext(fs.readFileSync(require.resolve('../worldsection'), 'utf8'), ctx);
assert.strictEqual(typeof ctx.Buffer, 'undefined');
const bin = new Uint8Array(fs.readFileSync(`${__dirname}/fixtures/world-sections.bin`));
const web = ctx.OV.section.decodeBatch(bin), node = s.decodeBatch(Buffer.from(bin));
assert.strictEqual(web.records.length, 4);
web.records.forEach((r, i) => {
  const n = node.records[i];
  assert.deepStrictEqual([r.kind, r.cx, r.sy, r.cz], [n.kind, n.cx, n.sy, n.cz]);
  if (r.kind !== 0) return;
  const w = ctx.OV.section.decodeSection(r.blob), d = s.decodeSection(n.blob);
  assert.deepStrictEqual([[...w.palette], w.idx && Array.from(w.idx)], [d.palette, d.idx && Array.from(d.idx)]);
});
```

`debug-api.js` (`H = {'tailscale-user-login': 'a@github'}`):
```js
const ov = (f, h = H) => fetch(`http://127.0.0.1:${port}/oneview/${f}`, {headers: h});
assert.strictEqual((await ov('blocks.js', {})).status, 403);
const js = await ov('worldsection.js');
assert.deepStrictEqual([js.status, js.headers.get('content-type'), js.headers.get('content-security-policy'), js.headers.get('cache-control')],
  [200, 'text/javascript; charset=utf-8', "default-src 'none'; script-src 'self'; connect-src 'self'", 'no-store']);
assert.ok((await js.text()).includes('decodeBatch'));
assert.strictEqual((await ov('blocks.js')).status, 200);
for (const bad of ['nope.js', '..%2Fserver.js', 'blocks.js.map', '']) assert.strictEqual((await ov(bad)).status, 404, bad);
```

- [ ] **Step 2: Run both** — Expected: FAIL (`require is not defined` in the vm context; 404 for `/oneview/`).
- [ ] **Step 3: Implement.** `worldsection.js`: `const crypto = typeof require === 'function' ? require('node:crypto') : null;`; `decodeSection`/`decodeBatch` read through `new DataView(buf.buffer, buf.byteOffset, buf.byteLength)` and one `TextDecoder`, keep `subarray` views for `hash` and `blob`; the last line becomes `if (typeof module === 'object' && module.exports) module.exports = api; else (self.OV = self.OV || {}).section = api;`. Do not re-indent the file. `server.js`: the map and the route as above.
- [ ] **Step 4: Run** `node test/world-section.js`, then `world-store`, `world-query`, `world-model`, `debug-api`. Expected: exit 0.
- [ ] **Step 5: Commit** — `feat(view): section codec runs in a browser, hub serves /oneview/*.js`.

### Task 3: Mesher

**Files:**
- Create: `app/public/oneview/mesher.js`
- Test: `app/test/view-mesher.js`; add `'view-mesher'` to `test.js`

**Interfaces:**
- Consumes: `blocks.nameOf`, `blocks.drawn`, `blocks.rgb`; a section is `{palette: string[], idx: Uint16Array|null}` as `decodeSection` returns it, cell `i = (y << 8) | (z << 4) | x`.
- Produces (`OV.mesher`): `meshSection(sec, nb, capY = 16): {pos: Uint8Array, col: Uint8Array, idx: Uint16Array} | null`
  - `nb`: six neighbour sections in the order -x, +x, -y, +y, -z, +z; `null` = not loaded.
  - A cell is solid when its block is `drawn` and its local `y < capY`. A face is emitted when its cell is solid and the cell behind the face is not. Behind a border face stands the neighbour's cell; a `null` neighbour counts as solid on -x, +x, -z, +z and -y (no walls at the loading edge) and as empty on +y. Cells at local `y >= capY` are empty, in the section and in its four side neighbours (same height); the section below is never cut, and the caller passes `null` as +y neighbour when the section above is cut away.
  - Per face 4 vertices (local 0..16, counter-clockwise seen from outside), 6 indices (`0,1,2, 0,2,3`), colour per vertex = `rgb(name)` times 1 (top), 0.5 (bottom), 0.8 (±x), 0.65 (±z), rounded. `null` when there is no face. Shortcut, as a code comment: every drawn block is an opaque full cube (water, glass, stairs); upgrade with a second translucent mesh if the owner misses seeing through windows.

- [ ] **Step 1: Write the failing test**

```js
const assert = require('node:assert');
const {meshSection} = require('../public/oneview/mesher.js');
const AIR = {palette: ['minecraft:air'], idx: null}, STONE = {palette: ['minecraft:stone'], idx: null};
const A6 = [AIR, AIR, AIR, AIR, AIR, AIR], S6 = [STONE, STONE, STONE, STONE, STONE, STONE];
const one = (x, y, z, state = 'minecraft:stone') => { const idx = new Uint16Array(4096); idx[(y << 8) | (z << 4) | x] = 1; return {palette: ['minecraft:air', state], idx}; };
const faces = (m) => (m ? m.idx.length / 6 : 0);
// one block: 6 faces, every triangle looks away from the block's centre, four brightness steps
let m = meshSection(one(3, 4, 5), A6);
assert.deepStrictEqual([m.pos.length, m.col.length, m.idx.length], [72, 72, 36]);
for (let t = 0; t < 36; t += 3) {
  const [a, b, c] = [0, 1, 2].map((k) => [0, 1, 2].map((j) => m.pos[m.idx[t + k] * 3 + j]));
  const u = b.map((v, j) => v - a[j]), w = c.map((v, j) => v - a[j]);
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  assert.ok(n[0] * (a[0] - 3.5) + n[1] * (a[1] - 4.5) + n[2] * (a[2] - 5.5) > 0, 'triangle ' + t / 3);
}
assert.deepStrictEqual([...new Set(m.col)].sort((p, q) => p - q), [69, 90, 110, 138]);
// buried: nothing. Nothing loaded around: only the top. One open side: only that side.
assert.strictEqual(meshSection(STONE, S6), null);
assert.strictEqual(faces(meshSection(STONE, [null, null, null, null, null, null])), 256);
assert.strictEqual(faces(meshSection(STONE, [AIR, null, null, STONE, null, null])), 256);
// border cells look into the neighbour
assert.strictEqual(faces(meshSection(one(0, 4, 5), [STONE, AIR, AIR, AIR, AIR, AIR])), 5);
assert.strictEqual(faces(meshSection(one(15, 15, 15), [AIR, STONE, AIR, STONE, AIR, STONE])), 3);
// what is not drawn makes no face and hides none
assert.strictEqual(meshSection(one(1, 1, 1, 'minecraft:short_grass'), A6), null);
assert.strictEqual(faces(meshSection(one(0, 4, 5), [{palette: ['minecraft:torch'], idx: null}, AIR, AIR, AIR, AIR, AIR])), 6);
// the height cut puts a lid on the cut layer
assert.strictEqual(faces(meshSection(STONE, S6, 8)), 256);
assert.strictEqual(meshSection(one(3, 9, 5), A6, 8), null);
assert.strictEqual(meshSection(STONE, A6, 0), null);
// worst case (3D checkerboard) fits 16-bit indices
const chk = new Uint16Array(4096); for (let i = 0; i < 4096; i++) chk[i] = ((i & 15) + ((i >> 4) & 15) + (i >> 8)) & 1;
m = meshSection({palette: ['minecraft:air', 'minecraft:stone'], idx: chk}, A6);
assert.ok(faces(m) === 12288 && m.idx instanceof Uint16Array && m.pos.length === 12288 * 12);
```

- [ ] **Step 2: Run it** — FAIL, `Cannot find module`.
- [ ] **Step 3: Implement `meshSection`.** Classify the palette once (drawn, colour); single-palette sections that are not drawn return `null` at once.
- [ ] **Step 4: Run it** — exit 0.
- [ ] **Step 5: Commit** — `feat(view): face-culled section mesher`.

### Task 4: World cache

**Files:**
- Create: `app/public/oneview/worldcache.js`
- Test: `app/test/view-cache.js`; add `'view-cache'` to `test.js`

**Interfaces:**
- Produces (`OV.worldcache`): `makeCache({viewR, now = Date.now})` returning
  - `setView(cx, cz): void`
  - `next(): {id, cx, cz, r} | null` — the next request, `null` while 2 are in flight or nothing is due. Order: stale chunks (`r: 0`), then stale tiles, then missing tiles of the view nearest first (`r: 1`, centre `3t + 1` for tile `t = Math.floor(c / 3)`). A tile is in the view when its nearest chunk is at most `viewR` away on both axes.
  - `done(id, records): {mesh: [cx, sy, cz][], chunks: [cx, cz, state][]}` — `records` as from `decodeBatch`, kind 0 with `sec` (decoded) added. A section whose hash is new or changed is listed in `mesh` together with its loaded neighbours (up, down, four sides); a column whose state changed is listed in `chunks` (0 known, 1 ungenerated, 2 unknown) and loses its sections when it is not known.
  - `fail(id): void` — that tile or chunk is offered again after 2 s, then 4 s … up to 30 s; a success resets the wait.
  - `evict(): [cx, cz][]` — removes and returns the columns of tiles whose nearest chunk is farther than `viewR + 1` from the view.
  - `section(cx, sy, cz): sec | null`, `neighbours(cx, sy, cz): (sec | null)[6]` (order as the mesher), `loaded(): [cx, sy, cz][]`
  - `onSeq(n): 'changes' | 'reset' | null` — the first `n > 0` only sets `seq`; `n > seq`: `'changes'`; `0 < n < seq`: clears everything, sets `seq = n`, `'reset'`; `n === 0` or equal: `null`.
  - `changes(reply, seen): void` — `reply` of `/api/world/changes`, `seen` = the `worldSeq` that triggered the call. Loaded chunks in `reply.sections` become stale; with `more: true` every loaded tile becomes stale instead and `seq = seen`; else `seq = reply.seq`.
  - `seq(): number`, `size(): number` (loaded columns)

- [ ] **Step 1: Write the failing test** (`view-cache.js`). Helpers: `col(cx, cz, h = 1)` = 24 kind-0 records (sy -4..19) with `hash: Uint8Array.of(h, 0, 0, 0, 0, 0, 0, 0)` and `sec: {palette: ['minecraft:stone'], idx: null}`; `tile(req, h)` = `col` for the 9 chunks of a request; `load(c)` = loop `next()`/`done()` until `next()` is `null`. Assertions:

```js
// 1 negative tiles, two in flight
let c = makeCache({viewR: 1}); c.setView(-16, -1);               // four tiles in view; the view's own tile comes first
const a = c.next(); assert.deepStrictEqual([a.cx, a.cz, a.r], [-17, -2, 1]);
assert.ok(c.next() !== null); assert.strictEqual(c.next(), null);
// 2 first tile: 9 columns, 216 sections to mesh
let r = c.done(a.id, tile(a)); assert.deepStrictEqual([r.mesh.length, r.chunks.length, c.size()], [216, 9, 9]);
// 3 a tile beside it meshes the 3 touching columns again
c = makeCache({viewR: 0}); c.setView(-17, -2); r = c.done(c.next().id, tile({cx: -17, cz: -2}));
c.setView(-14, -2); const b = c.next(); assert.deepStrictEqual([b.cx, b.cz], [-14, -2]);
assert.strictEqual(c.done(b.id, tile(b)).mesh.length, 216 + 72);
// 4 same hash: nothing; one changed section: itself and its 6 neighbours
c = makeCache({viewR: 1}); c.setView(-17, -2); load(c);
c.onSeq(40); assert.strictEqual(c.onSeq(41), 'changes');
c.changes({seq: 41, sections: [[-17, 0, -2], [99, 0, 99]], more: false}, 41);
const q = c.next(); assert.deepStrictEqual([q.cx, q.cz, q.r, c.seq()], [-17, -2, 0, 41]);
assert.strictEqual(c.done(q.id, col(-17, -2)).mesh.length, 0);
c.changes({seq: 42, sections: [[-17, 0, -2]], more: false}, 42);
const ch = col(-17, -2); ch[4].hash = Uint8Array.of(9, 0, 0, 0, 0, 0, 0, 0);      // sy 0
assert.strictEqual(c.done(c.next().id, ch).mesh.length, 7);
// 5 unknown is a state, not sections
c.changes({seq: 43, sections: [[-17, 0, -2]], more: false}, 43);
r = c.done(c.next().id, [{kind: 2, cx: -17, sy: 0, cz: -2}]);
assert.deepStrictEqual(r.chunks, [[-17, -2, 2]]); assert.strictEqual(c.section(-17, 0, -2), null);
// 6 Review Focus 1: a walk across the whole area never holds more than 225 columns at viewR 5
c = makeCache({viewR: 5});
for (let cx = -37; cx <= 3; cx++) { c.setView(cx, -2); load(c); c.evict(); assert.ok(c.size() <= 225, 'at ' + cx); }
assert.strictEqual(c.section(-37, 0, -2), null);
// 7 Review Focus 2 and 3: seq 0 is ignored, a long gap resyncs by tile, a lower seq resets
c = makeCache({viewR: 1}); c.setView(0, 0); load(c); const tiles = c.size() / 9;
assert.deepStrictEqual([c.onSeq(0), c.onSeq(40), c.onSeq(40), c.onSeq(0)], [null, null, null, null]);
c.changes({seq: 500, sections: [[0, 0, 0]], more: true}, 900);
assert.strictEqual(c.seq(), 900);
let n = 0; for (let x; (x = c.next());) { assert.strictEqual(x.r, 1); c.done(x.id, tile(x)); n++; } assert.strictEqual(n, tiles);
assert.deepStrictEqual([c.onSeq(30), c.size(), c.seq()], ['reset', 0, 30]);
// 8 Review Focus 2: a failed tile waits 2 s, 4 s … 30 s; others go on
let t = 0; c = makeCache({viewR: 0, now: () => t}); c.setView(0, 0);
let f = c.next(); c.fail(f.id); assert.strictEqual(c.next(), null);
t = 1999; assert.strictEqual(c.next(), null); t = 2000; f = c.next(); assert.ok(f); c.fail(f.id);
t = 5999; assert.strictEqual(c.next(), null); t = 6000; f = c.next(); assert.ok(f);
for (let i = 0; i < 8; i++) { c.fail(f.id); t += 30000; f = c.next(); assert.ok(f, 'never more than 30 s'); }
```

- [ ] **Step 2: Run it** — FAIL. **Step 3: Implement `worldcache.js`** (wrapper, no dependency; hashes compared as hex strings). **Step 4: Run it** — exit 0.
- [ ] **Step 5: Commit** — `feat(view): bounded section cache with tile requests, change refresh and resync`.

### Task 5: Plan status in the world worker

**Files:**
- Create: `app/planstatus.js`
- Modify: `app/build.js:455-461` and its exports (extract `planCells`), `app/worldmodel-worker.js` (op `planStatus`)
- Test: `app/test/plan-status.js` (new, in `test.js`), `app/test/world-model.js` (append)

**Interfaces:**
- Consumes: `schematic.parseLitematic`, `placing.matches`, `build.REPLACEABLE`, `worldquery.TooBig`/`BadQuery`, the worker's `section(cx, sy, cz)` and `store.chunk`, `store.seq`.
- Produces:
  - `build.planCells(parsed, {origin, rotation = 0, mirror = 'none', substitute = {}, anySolid = []}): {cells, fluids}` — exactly the `placed`, `fluids` and `cells` lines of `schematicPlan`, which now calls it. No behaviour change for the bots.
  - `planstatus.parseState(state: string): {name, props}` (name without `minecraft:`)
  - `planstatus.cellStatus(want, state: string): 0 | 1 | 2` — 1 when `placing.matches(want, parseState(state))`; else 0 when the cell is free (an air kind, a `REPLACEABLE` name, `water`, `lava`, `bubble_column`); else 2
  - `planstatus.MAX_CELLS = 200000`
  - `planstatus.makePlanStatus({src: {section, chunk}, seq: () => number, readFile = fs.promises.readFile, stat = fs.promises.stat, maxCells = MAX_CELLS})` returning `status(args): Promise<Buffer | null>`; `args = {dir, file, origin: {x, y, z}, rotation, mirror, substitute, anySolid}`. The Buffer is the gzipped "Plan status reply"; `null` when the file does not exist; rejects `TooBig` over `maxCells`, `BadQuery` for a `file` that fails `build.SCHEMATIC_RE` or an origin that is not three integers. A cell whose chunk is not `'known'` (or whose y is outside -64..319) has status 3.
  - Caches: parsed files by name, 4 entries, valid while `mtimeMs:size` is equal; results by `JSON.stringify([file, origin, rotation, mirror, substitute, anySolid])`, 8 entries, valid while the stamp and `seq()` are equal. The cache holds the promise, so calls that overlap share one computation.
  - Worker op `planStatus(a)`: 200 `{type: 'application/json', gzip: true, body}` or 404 `{error: 'no such schematic'}`. `planstatus.js` is required on first use (a hub nobody looks at never loads it). The op answers with a copy of the cached body (`Buffer.from(body)`): `run()` transfers the answer's memory to the main thread, which would empty the cache entry.

- [ ] **Step 1: Write the failing test** (`plan-status.js`)

```js
const assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const {writeLitematic} = require('../litematic-write');
const {parseState, cellStatus, makePlanStatus} = require('../planstatus');
const {TooBig, BadQuery} = require('../worldquery');
assert.deepStrictEqual(parseState('minecraft:oak_stairs[facing=east,half=bottom]'), {name: 'oak_stairs', props: {facing: 'east', half: 'bottom'}});
assert.deepStrictEqual(parseState('minecraft:stone'), {name: 'stone', props: {}});
const stairs = {name: 'oak_stairs', props: {facing: 'east', half: 'bottom'}};
assert.strictEqual(cellStatus(stairs, 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]'), 1);
assert.strictEqual(cellStatus(stairs, 'minecraft:oak_stairs[facing=west,half=bottom,shape=straight,waterlogged=false]'), 2);
assert.strictEqual(cellStatus(stairs, 'minecraft:stone'), 2);
for (const free of ['minecraft:air', 'minecraft:cave_air', 'minecraft:short_grass', 'minecraft:water[level=3]', 'minecraft:lava[level=0]']) assert.strictEqual(cellStatus(stairs, free), 0, free);
assert.strictEqual(cellStatus({name: 'cobblestone', props: {}, anySolid: true}, 'minecraft:deepslate'), 1);
assert.strictEqual(cellStatus({name: 'redstone_lamp', props: {}}, 'minecraft:redstone_lamp'), 1); // the model strips lit and powered
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  const write = (names) => fs.writeFileSync(path.join(dir, 'p.litematic'), writeLitematic({name: 'p', regions: [{position: {x: 0, y: 0, z: 0}, size: {x: 17, y: 1, z: 17},
    blocks: [[0, 0], [1, 0], [2, 0], [16, 0], [0, 16]].map(([x, z], i) => ({x, y: 0, z, name: names[i] || 'stone_bricks'}))}]}));
  write([]);
  // chunk 0,0 known: x 0 stone_bricks, x 1 air, x 2 dirt at y 64; chunk 1,0 ungenerated; everything else unknown
  const idx = new Uint16Array(4096); idx[0] = 1; idx[2] = 2;
  const SEC = {palette: ['minecraft:air', 'minecraft:stone_bricks', 'minecraft:dirt'], idx}, AIR = {palette: ['minecraft:air'], idx: null};
  const src = {chunk: (cx, cz) => (cx === 0 && cz === 0 ? 'known' : cx === 1 ? 'ungenerated' : 'unknown'), section: (cx, sy) => (sy === 4 ? SEC : AIR)};
  let seq = 5, reads = 0;
  const readFile = (f) => { reads++; return fs.promises.readFile(f); };
  const status = makePlanStatus({src, seq: () => seq, readFile});
  const args = {dir, file: 'p.litematic', origin: {x: 0, y: 64, z: 0}, rotation: 0, mirror: 'none', substitute: {}, anySolid: []};
  const open = (buf) => JSON.parse(zlib.gunzipSync(buf));
  const [b1, b2] = await Promise.all([status(args), status(args)]);              // Review Focus 5: two viewers, one computation
  assert.ok(b1 === b2 && reads === 1);
  const j = open(b1);
  assert.deepStrictEqual([j.file, j.origin, j.seq, j.palette, j.counts], ['p.litematic', {x: 0, y: 64, z: 0}, 5, ['stone_bricks'], [1, 1, 1, 2]]);
  assert.deepStrictEqual(j.blocks.sort((p, q) => p[0] - q[0] || p[2] - q[2]), [[0, 64, 0, 0, 1], [0, 64, 16, 0, 3], [1, 64, 0, 0, 0], [2, 64, 0, 0, 2], [16, 64, 0, 0, 3]]); // Review Focus 4: unknown, never missing
  assert.strictEqual(await status(args), b1);
  seq = 6; const b3 = await status(args);
  assert.ok(b3 !== b1 && open(b3).seq === 6 && reads === 1, 'a world change computes again, the parsed file stays');
  assert.deepStrictEqual(open(await status({...args, substitute: {stone_bricks: 'cobblestone'}})).counts, [1, 0, 2, 2]);
  write(['glass']); fs.utimesSync(path.join(dir, 'p.litematic'), new Date(), new Date(Date.now() + 5000)); // replaced under its name
  assert.deepStrictEqual(open(await status(args)).palette, ['glass', 'stone_bricks']);
  await assert.rejects(makePlanStatus({src, seq: () => 1, maxCells: 3})(args), TooBig);
  await assert.rejects(status({...args, file: '../p.litematic'}), BadQuery);
  await assert.rejects(status({...args, origin: {x: 0.5, y: 64, z: 0}}), BadQuery);
  fs.rmSync(path.join(dir, 'p.litematic'));
  assert.strictEqual(await status(args), null);                                  // Review Focus 4: file gone
})().catch((e) => { console.error(e); process.exit(1); });
```

`world-model.js`, in the `makeModel` part: `handle('planStatus', {dir, file: 'nope.litematic', origin: {x: 0, y: 0, z: 0}})` is 404; with `file: '../x'` it is 400. In `thread()` (real thread, chunk -37,-22 all stone): write a one-block `stone` plan, then `request('planStatus', {dir, file: 'p.litematic', origin: {x: -592, y: 0, z: -352}, rotation: 0, mirror: 'none', substitute: {}, anySolid: []})` twice in a row: both 200, `gzip: true`, bodies equal and longer than 0, `counts` `[0, 1, 0, 0]` (this is the transfer check).

- [ ] **Step 2: Run** `node test/plan-status.js` — FAIL, `Cannot find module '../planstatus'`.
- [ ] **Step 3: Implement** `planCells` (move the three lines, export it), `planstatus.js`, the worker op.
- [ ] **Step 4: Run** `plan-status`, `world-model`, and the parts that cover `schematicPlan`: `highways-light-night`, `rescue-litematic`, `production-projects`. Expected: exit 0.
- [ ] **Step 5: Commit** — `feat(plan): plan status against the world model in the world worker`.

### Task 6: `GET /api/plan/status` and plan identity in the state

**Files:**
- Create: `app/planapi.js`
- Modify: `app/projects.js:47-49` (`view()`), `app/server.js` (route next to `/api/world/` `:754`)
- Test: `app/test/plan-api.js` (new, in `test.js`), `app/test/debug-api.js` (append)

**Interfaces:**
- Consumes: Task 5's op `planStatus`; `projects.get(bot)`; `build.SCHEMATIC_RE`; `SCHEMATIC_DIR`.
- Produces:
  - `planapi.handle(method, url: URL, {model, projects, dir}): Promise<[status, headers, body]>` for `/api/plan/status`:
    - `?bot=<name>`: that bot's project must be `type: 'schematic'`; its `file`, `origin`, `rotation`, `mirror`, `substitute`, `anySolid` go on (defaults `0`, `'none'`, `{}`, `[]`); else 404 `{error: 'no schematic project'}`.
    - `?file=<name>&origin=x,y,z`: `file` passes `SCHEMATIC_RE`, origin three integers, |x|, |z| ≤ 30,000,000, y -64..319; rotation 0, no mirror; else 400.
    - Both or neither: 400. Not GET: 404. `model` null: 503 `{error: 'world model is off'}`.
    - Otherwise `model.request('planStatus', {dir, file, origin, rotation, mirror, substitute, anySolid})`, relayed as `worldapi.handle` relays (status, `Content-Type`, `Content-Encoding: gzip` when `gzip`).
  - `Projects.view()`: a `schematic` entry also carries `file` and `origin: [x, y, z]`.
  - `server.js`: the route writes the same headers as the `/api/world/` branch.

- [ ] **Step 1: Write the failing tests**

`plan-api.js`:
```js
const assert = require('node:assert');
const {handle} = require('../planapi');
const {Projects} = require('../projects');
const u = (q) => new URL('http://x/api/plan/status' + q);
const projects = {get: (b) => ({bot1: {type: 'schematic', args: {file: 'a.litematic', origin: {x: 1, y: 64, z: -3}, rotation: 90, mirror: 'none', chests: [{x: 0, y: 0, z: 0}], substitute: {smooth_stone: 'cobblestone'}}}, bot2: {type: 'shaft', args: {}}}[b] || null)};
const asked = [];
const model = {request: async (op, args) => { asked.push([op, args]); return {status: 200, type: 'application/json', body: Buffer.from('gz'), gzip: true}; }};
const ctx = {model, projects, dir: '/s'};
(async () => {
  let r = await handle('GET', u('?bot=bot1'), ctx);
  assert.deepStrictEqual([r[0], r[1]['Content-Type'], r[1]['Content-Encoding'], String(r[2])], [200, 'application/json', 'gzip', 'gz']);
  assert.deepStrictEqual(asked.pop(), ['planStatus', {dir: '/s', file: 'a.litematic', origin: {x: 1, y: 64, z: -3}, rotation: 90, mirror: 'none', substitute: {smooth_stone: 'cobblestone'}, anySolid: []}]);
  await handle('GET', u('?file=b.litematic&origin=-323,104,-30'), ctx);
  assert.deepStrictEqual(asked.pop()[1], {dir: '/s', file: 'b.litematic', origin: {x: -323, y: 104, z: -30}, rotation: 0, mirror: 'none', substitute: {}, anySolid: []});
  for (const [q, code] of [['?bot=bot2', 404], ['?bot=nobody', 404], ['', 400], ['?bot=bot1&file=a.litematic&origin=0,0,0', 400], ['?file=../x.litematic&origin=0,0,0', 400],
    ['?file=a.litematic', 400], ['?file=a.litematic&origin=1,2', 400], ['?file=a.litematic&origin=1,999,2', 400], ['?file=a.litematic&origin=1.5,2,3', 400]]) assert.strictEqual((await handle('GET', u(q), ctx))[0], code, q);
  assert.strictEqual(asked.length, 0, 'a refused request never reaches the worker');   // Review Focus 4: a bot without a schematic project
  assert.strictEqual((await handle('POST', u('?bot=bot1'), ctx))[0], 404);
  assert.strictEqual((await handle('GET', u('?bot=bot1'), {...ctx, model: null}))[0], 503);
  const p = new Projects('');
  p.note('bot1', 'schematic', {file: 'a.litematic', origin: {x: 1, y: 2, z: 3}, rotation: 0});
  p.note('bot2', 'shaft', {x: 1});
  assert.deepStrictEqual([p.view().bot1.file, p.view().bot1.origin, 'file' in p.view().bot2], ['a.litematic', [1, 2, 3], false]);
})().catch((e) => { console.error(e); process.exit(1); });
```

`debug-api.js` (the spawned server has no world model): `GET /api/plan/status?bot=bot1` is 403 without the login and 503 with it; `GET /api/architect/status` with the login is 404 (the 💬 button depends on it).

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `plan-api`, `debug-api`, `world-combat` (it asserts `view()`), `botui-screens`, `botui-menus`. Expected: exit 0.
- [ ] **Step 5: Commit** — `feat(plan): /api/plan/status by bot or by file and origin`.

### Task 7: Plan view (pure)

**Files:**
- Create: `app/public/oneview/planview.js`
- Test: `app/test/view-plan.js`; add `'view-plan'` to `test.js`

**Interfaces:**
- Produces (`OV.planview`):
  - `planKey(file, origin): string` (`origin` as `{x,y,z}` or `[x,y,z]`; `'a.litematic@-1,64,3'`)
  - `plansOf(projects): [{key, bot, file}]` — from `state.projects`: `schematic` entries that carry `file` and `origin`, one per key (the first bot in name order), sorted by key
  - `planGroups(reply, cutY = 319): {groups: [{name, s, xyz: Int32Array}], counts: {missing, built, wrong, unknown, total}, percent, box}` — groups hold the cells with `y <= cutY`: status 0 and 1 per palette name, status 2 and 3 as one group each with `name: null`; order: by `s`, then palette index; empty groups left out. `counts`, `percent` (`Math.floor(100 * built / total)`, 0 when empty) and `box` (`{x1,y1,z1,x2,y2,z2}`, `null` when empty) cover the whole plan, not the cut.

- [ ] **Step 1: Write the failing test**

```js
const assert = require('node:assert');
const {planKey, plansOf, planGroups} = require('../public/oneview/planview.js');
assert.strictEqual(planKey('a.litematic', {x: -1, y: 64, z: 3}), 'a.litematic@-1,64,3');
assert.strictEqual(planKey('a.litematic', [-1, 64, 3]), 'a.litematic@-1,64,3');
assert.deepStrictEqual(plansOf({bot2: {type: 'schematic', file: 'a.litematic', origin: [1, 2, 3]}, bot1: {type: 'schematic', file: 'a.litematic', origin: [1, 2, 3], paused: true},
  bot3: {type: 'shaft'}, bot4: {type: 'schematic'}}), [{key: 'a.litematic@1,2,3', bot: 'bot1', file: 'a.litematic'}]);
assert.deepStrictEqual(plansOf(undefined), []);
const reply = {file: 'a.litematic', origin: {x: 0, y: 64, z: 0}, seq: 7, palette: ['stone_bricks', 'glass'],
  blocks: [[0, 64, 0, 0, 1], [1, 64, 0, 0, 0], [0, 65, 0, 1, 0], [1, 65, 0, 0, 2], [-1, 66, -2, 1, 3], [0, 66, 0, 0, 1]]};
const g = planGroups(reply);
assert.deepStrictEqual(g.counts, {missing: 2, built: 2, wrong: 1, unknown: 1, total: 6});
assert.strictEqual(g.percent, 33);
assert.deepStrictEqual(g.box, {x1: -1, y1: 64, z1: -2, x2: 1, y2: 66, z2: 0});
assert.deepStrictEqual(g.groups.map((x) => [x.name, x.s, [...x.xyz]]),
  [['stone_bricks', 0, [1, 64, 0]], ['glass', 0, [0, 65, 0]], ['stone_bricks', 1, [0, 64, 0, 0, 66, 0]], [null, 2, [1, 65, 0]], [null, 3, [-1, 66, -2]]]);
const cut = planGroups(reply, 64);
assert.deepStrictEqual(cut.groups.map((x) => [x.name, x.s, x.xyz.length / 3]), [['stone_bricks', 0, 1], ['stone_bricks', 1, 1]]);
assert.deepStrictEqual(cut.counts, g.counts);
assert.strictEqual(planGroups({...reply, blocks: reply.blocks.map((b) => [...b.slice(0, 4), 1])}).percent, 100);
assert.deepStrictEqual([planGroups({...reply, blocks: []}).percent, planGroups({...reply, blocks: []}).box], [0, null]);
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — exit 0.
- [ ] **Step 5: Commit** — `feat(view): plan keys, draw groups and percent from a status reply`.

### Task 8: The Web Worker

**Files:**
- Create: `app/public/oneview/worker.js`
- Test: `app/test/view-worker.js`; add `'view-worker'` to `test.js`

**Interfaces:**
- Consumes: `OV.section`, `OV.mesher`, `OV.worldcache`, `OV.planview`; the routes `/api/world/sections?cx=&cz=&r=`, `/api/world/changes?since=`, `/api/plan/status?bot=`.
- Produces: the "Worker messages" of "Shared definitions". Behaviour:
  - Starts with `importScripts('/oneview/worldsection.js', '/oneview/blocks.js', '/oneview/mesher.js', '/oneview/worldcache.js', '/oneview/planview.js')`.
  - One `pump()` after every message, answer and timer: while `cache.next()` gives a request, fetch it, `decodeBatch(new Uint8Array(await res.arrayBuffer()))`, decode kind-0 blobs, `cache.done`, post `chunk` messages, mesh each listed section (`capY = Math.max(0, Math.min(16, cut + 1 - sy * 16))`, neighbours from the cache, the +y neighbour replaced by `null` when `cut < (sy + 1) * 16`) and post `mesh`; then `cache.evict()` and post `chunk` -1 for each. A non-200 answer or a thrown fetch: `cache.fail(id)`, post `{t:'net', ok:false}` once, `setTimeout(pump, 2000)`.
  - `seq`: `cache.onSeq`. `'changes'`: when no `changes` call is in flight, `GET /api/world/changes?since=<cache.seq()>`, `cache.changes(reply, seq)`, `pump()`. `'reset'`: post `{t:'reset'}`, `pump()`.
  - `cut`: store it, mesh again every `cache.loaded()` section with `sy >= Math.min(old, new) >> 4`, regroup and post every plan.
  - `plans`: a plan is fetched when it was never fetched, or when `seq` moved since its last fetch and that was 5 s or more ago (checked in `pump()`; a 5 s timer pumps while plans exist). 200: `planGroups(reply, cut)`, posted only when the joined status column or the cut changed. 404: `{t:'plan', key, state:'gone'}`. 413: `state:'big'`. Any other failure: nothing, retried on the next round. A key that left the list: `state:'gone'`.
  - `pause`: while on, no request starts; switching off pumps.

- [ ] **Step 1: Write the failing test** (`view-worker.js`). Harness: a `vm` context with `self = ctx`, `TextDecoder`, `setTimeout`, `clearTimeout`, `importScripts(...urls)` that runs `worldsection.js` and the `public/oneview/` files by base name, `postMessage(msg)` that records, and a `fetch(url)` fake that records every URL and answers from a table (sections: raw `encodeBatch` bytes, a browser has already inflated them). The fake world: every chunk stone for sy -4..3 and air above; chunk 1,1 is kind 2. `send(msg)` = `ctx.onmessage({data: msg})`; `settle()` waits until no fetch is in flight and no new message came for 50 ms. Assertions:
  1. `send({t:'view', cx: 0, cz: 0, viewR: 1})`, settle: a `chunk` message `{cx: 1, cz: 1, state: 2}`; taking the last `mesh` message per section, exactly 35 have `pos` (one per known column, all `sy === 3`, 256 faces each); no mesh for column 1,1.
  1b. `send({t:'cut', y: 47})`, settle: the last mesh of `0,3,0` has `pos: null`, `0,2,0` has 256 faces (the lid). `send({t:'cut', y: 319})`, settle: as after 1.
  2. Review Focus 3 — `send({t:'seq', seq: 5})` asks nothing. Table change: `/api/world/changes?since=5` answers `{seq: 6, sections: [[0, 3, 0]], more: false}` and `sections?cx=0&cz=0&r=0` now has air at sy 3. `send({t:'seq', seq: 6})`, settle: both URLs were asked once; the last mesh of `0,3,0` has `pos: null`, `0,2,0` has 256 faces, `1,3,0` has more than 256.
  3. Review Focus 3 — `changes` answers `more: true`: after `send({t:'seq', seq: 9})` every further request is `r=1` and there are exactly 4 (the loaded tiles). A `{t:'seq', seq: 2}` then posts `{t:'reset'}`.
  4. Review Focus 2 — the fake rejects every fetch: `send({t:'view', cx: 30, cz: 0, viewR: 1})`, settle: one `{t:'net', ok:false}`, no exception; the fake answers again, wait 2.2 s: `{t:'net', ok:true}` and mesh messages for the new columns.
  5. Review Focus 4 — `send({t:'plans', list: [{key: 'a.litematic@0,64,0', bot: 'bot1'}, {key: 'b.litematic@0,0,0', bot: 'bot2'}, {key: 'c.litematic@0,0,0', bot: 'bot3'}]})` with bot1 -> the reply of Task 7's test, bot2 -> 404, bot3 -> 413: plan messages `percent: 33` with 5 groups, `state: 'gone'`, `state: 'big'`. `send({t:'cut', y: 64})`: a new plan message for `a` with 2 groups, no new fetch of `/api/plan/status`.
  6. `send({t:'pause', on: true})` then a new view: no fetch; `on: false`: fetches start.
  7. Every recorded URL starts with `/api/world/sections?`, `/api/world/changes?` or `/api/plan/status?`.
- [ ] **Step 2: Run** — FAIL (`worker.js` missing). **Step 3: Implement `worker.js`.** **Step 4: Run** — exit 0 (about 3 s).
- [ ] **Step 5: Commit** — `feat(view): web worker that loads, refreshes and meshes the world and follows plans`.

### Task 9: Local stand

**Files:**
- Create: `tools/oneview-stand/stand.js`, `tools/oneview-stand/check.js` (usage in each file's header comment)

**Interfaces:**
- Produces:
  - `node tools/oneview-stand/stand.js [--port 8195] [--live]` (with `NODE_PATH`): prints `http://127.0.0.1:8195/` and runs until Ctrl-C, then removes its temp dir. It starts:
    - a fake plugin on a loopback port (pattern: `test/world-model.js:239-260`): `/world/pull` answers the first call with one frame for the area `-270,-20,40` (chunks cx -20..-15, cz -4..1): stone up to y 59, dirt to 62, `grass_block` at `63 + Math.round(4 * Math.sin(x / 9) * Math.cos(z / 7))`, water up to y 62 where the ground is lower; chunk -15,1 is left out (unknown), chunk -20,-4 is kind 1. Later calls wait 25 s and answer an empty frame; with `--live` one block of a pillar at -260,64+n,-12 is added every 5 s. `/world/stats` answers `{"importLeft":0}`, `/world/dirty` 200, everything else 404.
    - a temp `STATE_DIR` with `schematics/haus.litematic` (`litematic-write.js`: a hollow 6 x 5 x 6 box of `stone_bricks`, one `glass` per wall, one `oak_stairs[facing=east]`) and `projects.json` `{"bot1": {"type": "schematic", "args": {"file": "haus.litematic", "origin": {"x": -268, "y": 68, "z": -24}, "rotation": 0, "mirror": "none", "chests": []}, "t": 1, "paused": true}}`. The fake terrain already holds the plan's bottom layer and one `dirt` where a wall block belongs (so built, missing and wrong all appear).
    - the real `app/server.js` as a child: env as `test/debug-api.js:128` but without `ALLOWED_TS_LOGINS`, plus `STATE_DIR`, `SCHEMATIC_DIR`, `WORLD_AREA=-270,-20,40`, `BOTUI_URL=http://127.0.0.1:<fake>`, `RCON_HOST=127.0.0.1`, `RCON_PASSWORD=stand-token`, `BOT_NAMES=bot1,bot2`.
    - a fake worker (frames as in `test/hub.js:59-96`): `ws://127.0.0.1:<WORKER_PORT>/worker` with `Authorization: Bearer <WORKER_TOKEN>`, `{t:'hello', v:1, host:'stand', wid:'a1'.repeat(16), bots:['bot8','bot9']}`, then every second `{t:'status', bots:[…]}`: `bot8` online in `overworld` walking a circle of radius 6 around -266,68,-10, `bot9` standing at -262,68,-22.
  - `node tools/oneview-stand/check.js [--port 8195] [--out <dir>]`: against a running stand, exit 0 or 1 with the failed line. Part A (HTTP, this task): `/api/world/stats` reaches `hub.sections === 34 * 24`; `/api/state` has `worldSeq > 0`, `bot8` with a `pos` array, `projects.bot1.file === 'haus.litematic'`; `/api/plan/status?bot=bot1` is 200 with `counts[0] > 0`, `counts[1] > 0`, `counts[2] === 1`, `counts[3] === 0`; `/api/plan/status?bot=bot2` is 404; `/oneview/worker.js` is 200. Part B (browser) is added by Tasks 10-12 through one helper `chrome(args)` = `nix shell nixpkgs#chromium -c chromium --headless=new --password-store=basic --no-first-run --hide-scrollbars --enable-unsafe-swiftshader --use-angle=swiftshader --virtual-time-budget=15000 …` (`--password-store=basic` is required: without it the GNOME keyring dialog pops up on the owner's screen).

- [ ] **Step 1: Write `stand.js`.**
- [ ] **Step 2: Write `check.js` part A and the `chrome()` helper; prove WebGL in headless once:** `chrome(['--dump-dom', 'data:text/html,<canvas id=c></canvas><script>document.title=String(!!document.getElementById("c").getContext("webgl"))</script>'])` must print `<title>true</title>`. If it prints `false`, try `--use-gl=angle --use-angle=swiftshader-webgl` and keep the flags that work in the helper (not verified at planning time).
- [ ] **Step 3: Run** — `node tools/oneview-stand/stand.js &` then `node tools/oneview-stand/check.js`. Expected: `stand ok`, exit 0.
- [ ] **Step 4: Commit** — `test(view): local stand with a real hub, a fake world, two bots and one plan`.

### Task 10: Page shell — bottom bar and sheets, Karte removed, Plan tab becomes „Datei ansehen“

Owner decision 2026-11-17: the view-only Plan tab stays until phase 2 (sites) as the 🏰 sheet's second segment „Datei ansehen“, so any uploaded file or architect draft can still be looked at. Its markup, script block and the `/api/schematic/blocks` route stay unchanged; only its place moves.

**Files:**
- Modify: `app/public/index.html`, `tools/oneview-stand/check.js` (part B). `app/server.js` `/api/schematic/blocks` and its `test/debug-api.js` asserts stay.
- Test: `app/test/view-page.js` (new, in `test.js`), `check.js`

**Interfaces:**
- Produces (in `index.html`):
  - Markup: `<div id="world"><canvas id="view"></canvas><div id="tags"></div><span class="dot" id="conn"></span><button class="b stop" id="stopAll">⏹</button><div id="fab"><button class="b" id="camTop">🗺️</button><button class="b" id="cutBtn">▤</button></div><input type="range" id="cutY" min="-64" max="319" value="319" hidden><div id="pickBar" hidden></div><div id="worldMsg" hidden></div></div>`, `<div id="sheet" hidden>` with a head row (segment buttons, a ✕ button `id="sheetClose"`) and the old `main[data-page]` blocks moved inside it unchanged, `<nav id="bar">` with `<button data-sheet="bots"><b>🤖</b>Bots</button>`, `data-sheet="plan"` `🏰` `Plan`, `id="chatBtn" hidden` `💬` `Chat`, `data-sheet="menu"` `☰` `Mehr`.
  - `SHEETS = {bots: ['home', 'orders'], plan: ['project', 'plan'], menu: ['chests', 'server']}`, segment labels `{home: 'Bots', orders: 'Auftrag', project: 'Bau', plan: 'Datei ansehen', chests: 'Kisten', server: 'Server'}`.
  - `sheet(name, page): void` — writes `location.hash` (`''`, `#bots`, `#bots/orders`, `#plan`, `#plan/plan`, `#menu`, `#menu/server`); a `hashchange` handler shows exactly one `main[data-page]`, sets `body.dataset.sheet`, marks the bar button, and runs the old loaders (`server` -> `loadServer`, `chests` -> `loadChests`, `project` -> `loadSchematics`, `plan` -> the old Plan tab's own loader, unchanged). Tapping the open sheet's bar button closes it; so does the phone's back button. Desktop with an empty hash opens `#bots`.
  - Layout: `--bar: 60px` plus the safe-area inset. Phone: `#world` fills the screen above the bar; an open `bots` or `plan` sheet takes the lower 50 dvh and `#world` ends above it; the `menu` sheet is full height. From 900 px: the sheet is a 380 px dock on the left, `#world` starts beside it, `#stopAll` sits at the right end of the bar (CSS only).
  - Moved: `#me` to the top of the `orders` page (label "Dein Name"); `#stopAll` and `#conn` into `#world`. Each bot row's detail gets a button `🎯 Auftrag`: `picked = new Set([b.name])`, stored, `sheet('bots', 'orders')`.
  - Removed: `<header>`, `nav.tabs`, `main[data-page="map"]`, its CSS, `tab()`, the script block `// ---- map ----` (up to `// ---- chests ----`, keep `COLORS`), the `drawMap()` call in `ws.onmessage`. Kept and moved into the sheet: `main[data-page="plan"]` and the `// ---- Plan:` script block (its own renderer and canvas stay; it only renders while its segment is open; any call it makes to the removed `tab()` goes through `sheet('plan', 'plan')`). The hint in `orders` becomes "Hinschicken: in der Welt eine Stelle antippen."
  - 💬: once at start `fetch('/api/architect/status').then((r) => { $('chatBtn').hidden = !r.ok; }, () => {})`.

- [ ] **Step 1: Write the failing tests**

`view-page.js`:
```js
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.strictEqual((html.match(/<script>/g) || []).length, 1, 'one inline script: the CSP hashes the first only');
for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) assert.match(m[1], /^\/(oneview|vendor)\/[\w.-]+\.js$/);
for (const gone of ['drawMap', '/api/tile/', 'data-page="map"', 'id="tabs"', 'architect/chat']) assert.ok(!html.includes(gone), gone);
assert.ok(html.includes('/api/schematic/blocks') && html.includes('Datei ansehen'), 'the Plan tab lives on as „Datei ansehen“');
for (const need of ['id="view"', 'id="bar"', 'data-sheet="bots"', 'data-sheet="plan"', 'data-sheet="menu"', 'id="chatBtn"', 'id="sheet"', 'id="stopAll"', 'id="me"', '/api/architect/status']) assert.ok(html.includes(need), need);
assert.match(html, /<button[^>]*id="chatBtn"[^>]*hidden/);
for (const page of ['home', 'orders', 'chests', 'project', 'plan', 'server']) assert.ok(html.includes(`data-page="${page}"`), page);
```

`check.js` part B, phone `--window-size=390,844`, one `--dump-dom` per URL (a visible element has no `hidden` attribute in its tag):
  - `/`: `#sheet` hidden; `#chatBtn` hidden; `#bar` present.
  - `/#bots`: `main[data-page="home"]` visible, `orders` hidden. `/#bots/orders`: `orders` visible.
  - `/#plan`: `project` visible. `/#plan/plan`: `plan` visible (segment „Datei ansehen“). `/#menu/server`: `server` visible, `body` has `data-sheet="menu"`.
  - Screenshots `phone.png` (`/`), `phone-bots.png` (`/#bots`), `desktop-bots.png` (`--window-size=1280,800`, `/#bots`) into `--out`.

- [ ] **Step 2: Run** `node test/view-page.js` — FAIL.
- [ ] **Step 3: Rebuild `index.html`** as above.
- [ ] **Step 4: Run** `view-page`, `debug-api`, then the stand and `check.js`. Open the three screenshots (Read tool): the bar is at the bottom with three big buttons, the half sheet leaves the upper half free, the desktop sheet is a left dock, no text is cut off at 390 px.
- [ ] **Step 5: Commit** — `feat(view): bottom bar and sheets replace the tabs; 2D map removed, Plan tab kept as „Datei ansehen“`.

### Task 11: The 3D world on the canvas

**Files:**
- Create: `app/public/oneview/view.js`
- Modify: `app/public/index.html` (script tags after the inline script: `blocks.js`, `planview.js`, `view.js`; start-up glue), `tools/oneview-stand/check.js`
- Test: `check.js` part B (browser), `test/view-page.js` (script order)

**Interfaces:**
- Consumes: the worker messages `mesh`, `chunk`, `reset`, `net`; `chosen()` and `sendJob()` of the page.
- Produces: `OV.makeView(canvas, {worker, onPick(x, y, z)})` returning
  - `flyTo(x, y, z, r = 30): void`, `topDown(on: boolean): void`, `draw(): void` (one frame on the next animation frame, at most one queued)
  - `project(x, y, z): {x, y, visible}` (CSS pixels inside `#world`), `onWorker(msg): void`, `stats(): {chunks, meshes, tris}`, `scene`, `camera`
  - three.js is loaded by a script element on start (the old `planThree`, renamed `loadThree`), then `makeView`. The page calls `startWorld()` from `window.addEventListener('load', …)`: creates `new Worker('/oneview/worker.js')`, the view, sends `{t:'pause', on: document.hidden}` on `visibilitychange`. The `/ws` handler touches the world only after `startWorld()` ran (messages can arrive before the files have loaded).
- Decisions:
  - Colours are raw bytes end to end: `THREE.ColorManagement.enabled = false`, `renderer.outputColorSpace = THREE.LinearSRGBColorSpace`, pixel ratio `Math.min(devicePixelRatio, 2)`, background `0x0b0d10`.
  - Terrain: one shared `MeshBasicMaterial({vertexColors: true})`. Per section a `BufferGeometry` with `position` = `BufferAttribute(pos, 3)`, `color` = `BufferAttribute(col, 3, true)`, the index, `computeBoundingSphere()`; mesh at `(cx * 16, sy * 16, cz * 16)`, `matrixAutoUpdate = false`. A new `mesh` message for the same section disposes the old geometry; `pos: null`, `chunk` with state ≠ 0 and `reset` remove and dispose.
  - Unknown and ungenerated chunks: a flat 16 x 16 tile at y 63, shared geometry, grey `0x9aa1aa` (unknown) or `0x555b66` (ungenerated), opacity 0.25. Never empty space.
  - Camera: fov 50, near 0.5, far 2000; state `{x, y, z, az, el, r}`, default `-270, 70, -20, 0.7, 0.9, 90`, limits `r` 8..400, `el` 0.15..1.55, kept in `localStorage` key `cam`. Touch: one finger pans the target over the ground, pinch zooms, a two-finger twist turns. Mouse: left drag pans, right drag or shift-drag turns and tilts, wheel zooms. `#camTop` toggles `el` between 1.55 and 0.9. No OrbitControls (it is a module; the CSP takes classic scripts only).
  - Fog hides the loading edge and follows the zoom: `scene.fog = new THREE.Fog(bg, r + viewR * 9, r + viewR * 17)`, set before every frame.
  - `{t:'view', cx: Math.floor(x / 16), cz: Math.floor(z / 16), viewR}` goes to the worker when the target's chunk changes; `viewR` = 5 when `matchMedia('(max-width: 899px)').matches`, else 9.
  - Tap (moved under 6 px, under 500 ms): raycast the terrain, block = `Math.floor(point - normal * 0.5)`, `onPick`. The page shows `#pickBar`: "📍 x / z", a button "Bots hierher" (`sendJob(chosen(), 'goto', {x, z}, …)`), a ✕. This replaces the 2D map's send.
  - `#worldMsg`: "Welt lädt …" until the first mesh; "Keine Welt-Daten" while `net` is not ok and nothing is loaded. A tap on `#conn` shows `stats()` as a toast ("169 Chunks · 412 000 Dreiecke").
  - For the check: `canvas.dataset.chunks`, `.meshes`, `.tris`, written at most once a second. `webglcontextrestored` -> `draw()`. A `ResizeObserver` on `#world` resizes the renderer.

- [ ] **Step 1: Write the failing check** — `check.js` part B, `/` at phone width: `<canvas id="view"` carries `data-chunks` ≥ 34 and `data-meshes` ≥ 34 (Review Focus 1: the numbers the phone look reports); `#worldMsg` hidden; screenshot `phone.png`. `view-page.js`: the three script tags stand after the inline script.
- [ ] **Step 2: Run** — FAIL (no `data-chunks`).
- [ ] **Step 3: Implement `view.js` and the glue.**
- [ ] **Step 4: Run** the stand and `check.js`; open `phone.png` and `desktop-bots.png`: green ground with hills and blue water, a grey tile at one corner (the unknown chunk), nothing black where chunks are known. Then `stand.js --live` and two screenshots 20 s apart with `--virtual-time-budget=25000`: the pillar at -260,-12 exists in the second.
- [ ] **Step 5: Commit** — `feat(view): live terrain on the canvas with pan, zoom, top view and tap to send`.

### Task 12: Bots, players and plans in the world

**Files:**
- Create: `app/public/oneview/layers.js`
- Modify: `app/public/index.html` (script tag, glue, `#planChips` at the top of the `project` page), `tools/oneview-stand/check.js`
- Test: `check.js` part B

**Interfaces:**
- Consumes: `OV.makeView` (`scene`, `draw`, `project`, `flyTo`), `OV.blocks.rgb`, `OV.planview.plansOf`, the worker's `plan` messages, `/ws` state (`bots[].name/online/pos/dimension`, `world.players`, `projects`, `worldSeq`).
- Produces: `OV.makeLayers(view, tagsEl)` returning
  - `bots(state): void` — a marker (box 0.6 x 1.8 x 0.6, `COLORS[i % 6]` by index in `state.bots`) for every online bot whose `dimension` contains `overworld` and that has a `pos`; a white marker for every player whose name does not match `/^(bot\d+|MisaBot|EM_Trader)$/`. A marker eases to a new position over 1000 ms. Each has a name tag (`div` in `#tags`, `textContent`), placed with `view.project` on every frame, hidden when not visible.
  - `plan(msg): void` — replaces that plan's meshes: one `InstancedMesh` per group over a shared `BoxGeometry(1, 1, 1)`, cells centred at +0.5. Materials (`MeshBasicMaterial`, all with `polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1`): `s` 1 colour `rgb(name)` opaque; `s` 0 the same colour, `transparent`, `opacity: 0.35`, `depthWrite: false`; `s` 2 `0xef4444`, opacity 0.6, scale 1.02; `s` 3 `0x9aa1aa`, opacity 0.35. `state: 'gone'` removes the plan and its chip.
- Page glue:
  - On every `/ws` message: `layers.bots(last)`; `{t:'seq', seq: last.worldSeq}` to the worker; `{t:'plans', list}` when `plansOf(last.projects)` changed.
  - `#planChips`: per plan one button: a ring (`conic-gradient` by percent), "62 %" (with " ?" when `counts.unknown > 0`), the file name without `.litematic`; `state: 'big'` shows "zu groß" instead of the percent. Tap: `view.flyTo` to the box centre with `r = longest side * 1.5 + 10`. No plan: the text "Kein Bauplan aktiv."
  - A tap on a bot row also calls `view.flyTo(...b.pos)` when the bot has a position in the overworld.
  - `#cutBtn` shows or hides `#cutY` (vertical, at the right edge); its value goes to the worker as `{t:'cut', y}` 150 ms after the last move; a small label shows "Höhe 104" or "Höhe: alles" at 319.

- [ ] **Step 1: Write the failing check** — `check.js` part B: `/#plan` at phone width: `#planChips` contains `haus` and a percent from 1 to 99 (Review Focus 4: a real number, no "?" in the stand); `<canvas id="view"` carries `data-bots="2"` and `data-plans="1"`; `#tags` contains `bot8` and `bot9`. Screenshots `phone-plan.png` and `desktop-plan.png`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement `layers.js` and the glue** (`layers` writes `canvas.dataset.bots` and `.plans`; the page keeps the last `plan` message per key for the chips).
- [ ] **Step 4: Run** the stand and `check.js`; open the screenshots: two bot markers with names, the house with a solid bottom layer, ghost walls above it, one red block; the chip shows the ring. With the stand's `projects.json` emptied by hand and the stand restarted: the sheet says "Kein Bauplan aktiv." and no toast appears.
- [ ] **Step 5: Commit** — `feat(view): bots, players and plans with build status in the world`.

### Task 13: Checks on the branch head, hand over, live look

**Files:** Modify `docs/runbooks/minecraft/BOTS.md` (one paragraph: the one view, `/api/plan/status`, the stand).

- [ ] **Step 1: Full checks** — commit, then the `mcbots-tests` build of "Global Constraints" (3-5 min). Expected: builds. `graphify update .`. Run the stand and the whole `check.js` once more on the head.
- [ ] **Step 2: Hand over** to the coordinator: hub only, no plugin change, so no Paper restart; the hub container restarts and the bots reconnect. Phase 0 must be live first (deploy B, `plugin.importLeft: 0`). Agents do not push, bump or deploy.
- [ ] **Step 3: After the owner's deploy — load (success check 5).** `node tools/world-check/load.js run --minutes 10 --out view-idle.json` with no dashboard open; then with the view open on the phone and in one desktop tab, the 🏰 sheet open and a schematic project present, `run --minutes 10 --out view-open.json`; `node tools/world-check/load.js compare view-idle.json view-open.json` -> exit 0 (hub loop p99 +2 ms or less, mspt +0.5 ms or less).
- [ ] **Step 4: Phone look by the owner** (the coordinator asks, in two short lines): the world appears within about 5 s; dragging is smooth; a tap on the dot shows the chunk and triangle numbers. If dragging stutters: lower the phone radius from 5 to 4 first; greedy merging only if that is not enough (spec). After the next hub restart the open page comes back by itself (dot green, world still there).
- [ ] **Step 5: Report** the check results, the two load files' deltas, the numbers from the dot, and what the owner said.

## Calls made without the owner (veto while reading)

- A tap in the 3D world replaces the 2D map's "Bots hierher"; players stay visible as white markers.
- The phone loads 5 chunks around the view (at most 225), the desktop 9; beyond that is fog, not far terrain.
- Every drawn block is an opaque cube for now (water, glass, stairs).
- "Wrong" is any other block that is not air, a plant or a fluid, natural ground included: a plan set into a hill shows the hill red where it is in the way.
- The desktop shows one docked sheet at a time (not the spec sketch's two fixed columns); the right column waits for the chat.
- The view-only Plan tab lives on as the 🏰 segment „Datei ansehen“ (owner 2026-11-17) until phase 2 sites put every file at its place in the world.
- `state.projects` now names the plan file and origin of schematic projects to every dashboard login.

## Not verified (builder checks first)

- WebGL in headless Chromium with the flags of Task 9 (Step 2 proves it), and `--virtual-time-budget` with an open `/ws`.
- `Uint8Array` positions in three.js r159 for drawing and for `Raycaster` (if either fails: `Float32Array` on the page side, the worker format stays).
- The vertical range input (`writing-mode: vertical-lr`) on the owner's phone browser.
- `/api/world/sections?r=1` size for a real tile (expected around 100 KB before gzip).

## Self-review notes

- Spec coverage: layout, bar, sheets, dropped tabs (Task 10); terrain meshes in a Web Worker with the existing colour function (1, 3, 8, 11); browser routes `sections`/`changes` with `worldSeq` (4, 8); bots from `/ws` (12); plan status route and drawing (5, 6, 7, 12); height slider ▤ and top-down button (11, 12); 💬 hidden on 404 (6, 10); success check 5 (13). Out of scope by instruction: sites, follow camera, chat, pins, proposals.
- Phase 0 ledger items that touch this phase: `sample` has no single-flight (the UI never calls it, Task 8 asserts the URLs); stale chunks after an area change (phase 5; the view shows what the hub answers); gzip without `Vary` (browsers always accept gzip).
- The spec says status "runs `schematicPlan`": the plan runs the same cell pipeline (`planCells`, extracted from it) without the build order and the `.filled` files, so the worker's caches stay bounded.
