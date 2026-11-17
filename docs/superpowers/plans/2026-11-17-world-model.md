# World Model (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A block model of the main world's first area that stays equal to the real world with little lab load, queryable over `/api/world/*`, proven by three live checks. No UI.

**Architecture:** The BotUi Paper plugin gains a world feed: it snapshots chunks (import, dirty sections from block events, a slow sweep), encodes sections off the main thread and hands them to the hub on a long-poll. A worker thread in the hub stores the section blobs in SQLite and answers queries; the hub's main loop only relays buffers.

**Tech Stack:** Java 25 against the pinned Paper 26.2 jar (no new libraries), Node 22 (`node:sqlite`, `node:worker_threads`, `node:zlib`), Nix flake checks `botui` and `mcbots-tests`.

**Spec:** `docs/superpowers/specs/2026-11-17-one-view-world-design.md` (sections "World model", "Success checks", "Not verified").

## Global Constraints

- No decoding and no SQLite on the hub's main event loop; it relays buffers only.
- Plugin budget: at most 1 ms of snapshots per tick; at most one snapshot per chunk every 2 s; event handlers only add a key to a set.
- Marks, not payloads: the hub pulls; nothing is lost while the hub is down.
- Unknown is never air: every query lists chunks the model lacks as `unknown`; never-generated chunks as `ungenerated`.
- One section format end to end; the hub stores blobs and never re-encodes.
- Strip `power`, `powered`, `lit`, `triggered` in the encoder; no redstone events.
- Output bounds: blocks 32,768 cells, height map 128 x 128, materials 2,000,000 cells; beyond that HTTP 413.
- First area: centre -270, -20, radius 320 blocks = chunks cx -37..3, cz -22..18 (41 x 41 = 1681). Main Paper world only.
- Freshness: an event-covered change is in the model within 5 s; event-less changes within 3-5 minutes.
- `botui/default.nix` lists Java files by name and compiles with `javac --release 25 -proc:none -Xlint:all,-classfile,-processing -Werror -cp 'libs/*'` (line 32).
- Commit unsigned in the worktree; never push, never deploy. The plugin change restarts Paper (`AGENTS.md` 45-51).
- After code changes run `graphify update .`.
- Single test part: `cd hosts/bandit-lab/services/mcbots/app && node test/<part>.js`. Full checks (after commit):
  `nix build --no-link "git+file://$PWD?rev=$(git rev-parse HEAD)#checks.x86_64-linux.mcbots-tests"` and the same with `#checks.x86_64-linux.botui`.

## Review Focus

1. Negative coordinates (the whole area has negative x): block x = -1 must land in chunk -1, local 15. Pinned in Task 2 (codec), Task 5 (queries), Task 3 (Java `floorDiv`).
2. A query box that straddles known, unknown and ungenerated chunks: no cell of an unknown chunk comes back as a block or as air. Pinned in Task 5.
3. Paper restarts between two pulls (boot id changes, old ack): the hub starts over at ack 0 and identical sections do not move `seq`. Pinned in Task 6.
4. Hub down for hours while blocks change: outbox stays bounded, marks survive, everything arrives after the hub returns. Pinned in Task 8.
5. A duper or fluid storm marking one chunk every tick: one snapshot per 2 s for it, and import and sweep still progress. Pinned in Task 8.

---

## Formats (used by Tasks 2, 3, 6, 7, 9)

**Section blob v1**

```
u8   version = 1
u8   bits      0 when the palette has one entry, else ceil(log2(n)) (1..12)
u16  n         palette length, little-endian
n x (u16 len LE, len bytes UTF-8)    block-state strings; order = first appearance in cell order
ceil(4096 * bits / 8) bytes          cell i = (y << 8) | (z << 4) | x, local 0..15;
                                     value i sits in bits [i*bits, (i+1)*bits) of the byte stream, least significant bit first
```

**Batch frame v1**

```
u8 version = 1 | u64 boot LE | u32 batch LE | u16 count LE
count x ( u8 kind | i32 cx LE | i8 sy | i32 cz LE | kind 0 only: 8 bytes hash | u32 len LE | blob )
kind: 0 section, 1 ungenerated chunk (sy 0), 2 unknown chunk (sy 0, hub -> browser only)
```

`hash` = first 8 bytes of SHA-256(blob), opaque. Sections are sy -4..19 (y -64..319); a chunk is `known` when all 24 exist.

## File Structure

| File | Responsibility |
|---|---|
| `hosts/bandit-lab/services/minecraft/botui/SectionCodec.java` | Pure: strip, encode section, hash, frame. No Bukkit. |
| `.../botui/FeedQueue.java` | Pure: area, dirty marks, settle, debounce, work order, outbox, batches. No Bukkit. |
| `.../botui/WorldFeed.java` | Bukkit glue: events, snapshots, tick drain, `/world/*` routes. |
| `.../botui/SectionCodecCheck.java`, `FeedQueueCheck.java` | Assert-based checks run in the derivation; not in the jar. |
| `.../botui/BotUi.java` | Route `/world/` to WorldFeed, start/stop it, pool 4 -> 6. |
| `.../botui/default.nix` | New files in `cp`/`javac`; run the checks; compare the golden fixture. |
| `hosts/bandit-lab/services/mcbots/app/worldsection.js` | Pure: section and batch codec, constants. |
| `.../app/worldstore.js` | Storage (SQLite, or blob files per Task 1). |
| `.../app/worldquery.js` | Pure: blocks, height, materials with bounds. |
| `.../app/worldmodel-worker.js` | Worker: pull loop, LRU, request handler. |
| `.../app/worldmodel.js` | Main-thread client of the worker. |
| `.../app/worldapi.js` | `/api/world/*` handler, `dirtyBoxes`, `withDirty`, `parseArea`. |
| `.../app/debug.js` | `loopDelayMeter`. |
| `.../app/server.js`, `config.js`, `test.js` | Wiring, `WORLD_AREA`, new test parts. |
| `.../app/test/world-{section,store,query,model,api}.js`, `test/fixtures/world-sections.bin` | Tests and the golden fixture. |
| `tools/world-check/{lib.js,lib.test.js,equality.js,load.js,nobot.js,README.md}` | The three live checks. |

---

### Task 1: Verify the two deciding unknowns

**Files:** none (results are written into this plan, lines "Backend:" and "Java:" below).

- [ ] **Step 1: node:sqlite on the pinned node**

Run from the repo root:
```
nix shell --inputs-from . nixpkgs#nodejs_22 -c node -e "const {DatabaseSync}=require('node:sqlite');const {Worker,isMainThread}=require('node:worker_threads');const d=new DatabaseSync(':memory:');d.exec('create table t(a blob) without rowid') " ; echo "exit $?"
```
Expected: `exit 1` with "PRIMARY KEY missing" means SQLite ran (the table lacks a key on purpose); a line with `ERR_UNKNOWN_BUILTIN_MODULE` or "No such built-in module" means it is not available. An `ExperimentalWarning` is fine.

- [ ] **Step 2: Record the backend**

Backend: `sqlite` | `blobs` (fill in). With `blobs`, Task 4 implements the same interface on files `STATE_DIR/world/r.<cx>>5>.<cz>>5>.bin` (one batch frame per region, rewritten tmp + rename at most every 5 s; index and `seq` in memory, `seq` starts at `Date.now()` so it stays monotonic across restarts). Only one backend is built.

- [ ] **Step 3: javac and java for pure classes**

```
nix shell --inputs-from . nixpkgs#jdk25_headless -c sh -c 'd=$(mktemp -d) && printf "final class T { public static void main(String[] a) { assert a.length == 0; System.out.println(\"ok\"); } }" > $d/T.java && javac --release 25 -Xlint:all -Werror -d $d $d/T.java && java -ea -cp $d T'
```
Expected: `ok`. Record: Java: `ok` | the error. If `java` is missing in `jdk25_headless`, the checks in Task 3 use `pkgs.jdk25` for the run only.

### Task 2: Section and batch codec (JS)

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/worldsection.js`
- Test: `hosts/bandit-lab/services/mcbots/app/test/world-section.js`; add `'world-section'` to the part list in `app/test.js:8`

**Interfaces:**
- Produces:
  - `encodeSection(palette: string[], idx: Uint16Array|null): Buffer` (`idx` null exactly when `palette.length === 1`)
  - `decodeSection(buf: Buffer): {palette: string[], idx: Uint16Array|null}`; throws `Error('bad section')`
  - `sectionHash(blob: Buffer): Buffer` (8 bytes)
  - `encodeBatch({boot: bigint, batch: number, records}): Buffer`, `decodeBatch(buf): {boot, batch, records}`; record = `{kind, cx, sy, cz, hash?, blob?}`
  - `cellIndex(x, y, z): number`, `nameOf(state: string): string`, `isAir(state): boolean`, `SY_MIN = -4`, `SY_MAX = 19`

- [ ] **Step 1: Write the failing test**

```js
const assert = require('node:assert');
const s = require('../worldsection');
// single value
let b = s.encodeSection(['minecraft:air'], null);
assert.deepStrictEqual([...b.subarray(0, 4)], [1, 0, 1, 0]);
assert.deepStrictEqual(s.decodeSection(b), {palette: ['minecraft:air'], idx: null});
// 3 entries -> 2 bits, 1024 data bytes, LSB first
const idx = new Uint16Array(4096); idx[0] = 1; idx[1] = 2; idx[4095] = 2;
b = s.encodeSection(['minecraft:stone', 'a', 'b'], idx);
assert.strictEqual(b[1], 2);
assert.strictEqual(b[b.length - 1024], 0b1001);            // cell 0 = 1, cell 1 = 2
assert.strictEqual(b[b.length - 1] >> 6, 2);               // cell 4095
assert.deepStrictEqual(s.decodeSection(b).idx, idx);
// widths that cross byte borders, up to 12 bits
for (const n of [2, 17, 257, 4096]) {
  const pal = Array.from({length: n}, (_, i) => 't' + i), ix = Uint16Array.from({length: 4096}, (_, i) => i % n);
  const d = s.decodeSection(s.encodeSection(pal, ix));
  assert.deepStrictEqual(d.idx, ix); assert.strictEqual(d.palette.length, n);
}
assert.throws(() => s.decodeSection(Buffer.from([2, 0, 1, 0])), /bad section/);
assert.throws(() => s.decodeSection(b.subarray(0, b.length - 1)), /bad section/);
// cells and names
assert.strictEqual(s.cellIndex(1, 2, 3), (2 << 8) | (3 << 4) | 1);
assert.strictEqual(s.nameOf('minecraft:oak_stairs[facing=east]'), 'minecraft:oak_stairs');
assert.ok(s.isAir('minecraft:cave_air') && !s.isAir('minecraft:water[level=0]'));
// batch, negative coordinates
const blob = s.encodeSection(['minecraft:air'], null), hash = s.sectionHash(blob);
assert.strictEqual(hash.length, 8);
const recs = [{kind: 0, cx: -37, sy: -4, cz: -22, hash, blob}, {kind: 1, cx: 3, sy: 0, cz: 18}, {kind: 2, cx: -1, sy: 0, cz: 0}];
assert.deepStrictEqual(s.decodeBatch(s.encodeBatch({boot: 5n, batch: 7, records: recs})), {boot: 5n, batch: 7, records: recs});
assert.throws(() => s.decodeBatch(Buffer.from([9])), /bad batch/);
```

- [ ] **Step 2: Run it** — `node test/world-section.js`. Expected: FAIL, `Cannot find module '../worldsection'`.
- [ ] **Step 3: Implement the functions above in `worldsection.js`** per "Formats". No dependencies.
- [ ] **Step 4: Run it** — Expected: exit 0, no output.
- [ ] **Step 5: Commit** — `git add` the three files; `git commit -m "feat(world): section and batch codec"`.

### Task 3: Java encoder with a golden fixture

**Files:**
- Create: `hosts/bandit-lab/services/minecraft/botui/SectionCodec.java`, `SectionCodecCheck.java`
- Create: `hosts/bandit-lab/services/mcbots/app/test/fixtures/world-sections.bin` (written by Java)
- Modify: `hosts/bandit-lab/services/minecraft/botui/default.nix` (the `cp`/`javac` lines)
- Test: `SectionCodecCheck.java` (derivation), `app/test/world-section.js` (fixture part)

**Interfaces:**
- Consumes: Task 2's `decodeBatch`, `decodeSection`, `encodeSection`, `sectionHash`.
- Produces (package-private, static, in `SectionCodec`):
  - `String strip(String state)`
  - `byte[] encode(String[] cells)` (4096 states in cell order, already stripped)
  - `byte[] hash(byte[] blob)` (8 bytes)
  - `byte[] record(int kind, int cx, int sy, int cz, byte[] hash, byte[] blob)`
  - `byte[] frame(long boot, int batch, java.util.List<byte[]> records)`
  - `long sectionKey(int cx, int sy, int cz)`, `long chunkKey(int cx, int cz)`

The fixture, fixed on both sides: `frame(1, 7, ...)` with four records:
1. kind 0 at (-17, 5, -2): all `minecraft:air`.
2. kind 0 at (-1, -4, 0): all `minecraft:stone`, except cell (1,2,3) = `minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]` and cell (15,15,15) = `strip("minecraft:redstone_lamp[lit=true]")`.
3. kind 0 at (3, 19, 18): cell i = `"minecraft:t" + (i % 17)`.
4. kind 1 at (40, 0, -41).

- [ ] **Step 1: Write the failing checks**

`SectionCodecCheck.main(args)`: with `--write <path>` it writes the fixture; with `<path>` it asserts (plain `assert`, run with `-ea`):
```java
assert SectionCodec.strip("minecraft:redstone_lamp[lit=true]").equals("minecraft:redstone_lamp");
assert SectionCodec.strip("minecraft:redstone_wire[east=side,north=none,power=7,south=none,west=up]")
    .equals("minecraft:redstone_wire[east=side,north=none,south=none,west=up]");
assert SectionCodec.strip("minecraft:lever[face=wall,facing=north,powered=true]").equals("minecraft:lever[face=wall,facing=north]");
assert SectionCodec.strip("minecraft:dispenser[facing=up,triggered=false]").equals("minecraft:dispenser[facing=up]");
assert SectionCodec.strip("minecraft:stone").equals("minecraft:stone");
assert SectionCodec.strip("minecraft:powered_rail[powered=true,shape=north_south,waterlogged=false]")
    .equals("minecraft:powered_rail[shape=north_south,waterlogged=false]");   // name untouched
assert SectionCodec.sectionKey(-1, -4, 0) != SectionCodec.sectionKey(0, -4, -1);
assert java.util.Arrays.equals(fixture(), java.nio.file.Files.readAllBytes(java.nio.file.Path.of(args[0])));
```
Add to `app/test/world-section.js`:
```js
const fx = s.decodeBatch(require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/world-sections.bin')));
assert.deepStrictEqual([fx.boot, fx.batch, fx.records.map((r) => [r.kind, r.cx, r.sy, r.cz])], [1n, 7, [[0, -17, 5, -2], [0, -1, -4, 0], [0, 3, 19, 18], [1, 40, 0, -41]]]);
assert.deepStrictEqual(s.decodeSection(fx.records[0].blob), {palette: ['minecraft:air'], idx: null});
const two = s.decodeSection(fx.records[1].blob);
assert.deepStrictEqual(two.palette, ['minecraft:stone', 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]', 'minecraft:redstone_lamp']);
assert.strictEqual(two.idx[s.cellIndex(1, 2, 3)], 1); assert.strictEqual(two.idx[4095], 2); assert.strictEqual(two.idx[0], 0);
const three = s.decodeSection(fx.records[2].blob);
assert.strictEqual(three.palette.length, 17); assert.strictEqual(fx.records[2].blob[1], 5); assert.strictEqual(three.idx[4095], 4095 % 17);
for (const r of fx.records.slice(0, 3)) {           // both encoders agree byte for byte
  const d = s.decodeSection(r.blob);
  assert.ok(s.encodeSection(d.palette, d.idx).equals(r.blob)); assert.ok(s.sectionHash(r.blob).equals(r.hash));
}
```

- [ ] **Step 2: Run** — `node test/world-section.js`. Expected: FAIL, `ENOENT ... world-sections.bin`.
- [ ] **Step 3: Implement `SectionCodec`** per "Formats" (`ByteBuffer` little-endian, `MessageDigest` SHA-256, `Math.floorDiv` nowhere needed here; palette by `HashMap<String,Integer>` in first-appearance order).
- [ ] **Step 4: Write the fixture**
```
nix shell --inputs-from . nixpkgs#jdk25_headless -c sh -c 'd=$(mktemp -d) && cd hosts/bandit-lab/services/minecraft/botui && javac --release 25 -Xlint:all -Werror -d $d SectionCodec.java SectionCodecCheck.java && java -ea -cp $d SectionCodecCheck --write ../../mcbots/app/test/fixtures/world-sections.bin && java -ea -cp $d SectionCodecCheck ../../mcbots/app/test/fixtures/world-sections.bin && echo ok'
```
Expected: `ok`.
- [ ] **Step 5: Wire the derivation** — in `botui/default.nix`: `cp` the two new files; add `SectionCodec.java` to the existing `javac` line; after it compile the check into `checks/` (`javac ... -cp classes -d checks SectionCodecCheck.java`) and run `java -ea -cp classes:checks SectionCodecCheck ${../../mcbots/app/test/fixtures/world-sections.bin}`. `checks/` is not jarred.
- [ ] **Step 6: Run** — `node test/world-section.js` exits 0. Commit (`feat(world): Java section encoder with golden fixture`), then the `botui` flake check builds.

### Task 4: Store

**Files:**
- Create: `app/worldstore.js`; Test: `app/test/world-store.js` (+ part list)

**Interfaces:**
- Produces: `openStore(dir: string)` returning
  - `put(cx, sy, cz, hash: Buffer, blob: Buffer): boolean` (false and no `seq` move when the stored hash is equal; removes an ungenerated mark of that chunk)
  - `markUngenerated(cx, cz): boolean` (false when the chunk has sections)
  - `get(cx, sy, cz): Buffer|null`
  - `chunk(cx, cz): 'known'|'unknown'|'ungenerated'`
  - `column(cx, cz): [{sy, hash, blob}]`
  - `since(seq: number, limit: number): {seq, sections: [[cx, sy, cz]], more: boolean}`
  - `seq(): number`, `counts(): {sections, ungenerated}`, `tx(fn)`, `close()`

SQLite layout (Backend `sqlite`): file `<dir>/model.sqlite`, WAL, `synchronous=NORMAL`; `sections(dim INTEGER DEFAULT 0, cx, cz, sy, hash BLOB, blob BLOB, seq INTEGER, PRIMARY KEY(dim, cx, cz, sy)) WITHOUT ROWID`, index on `seq`; `ungenerated(dim DEFAULT 0, cx, cz, PRIMARY KEY(dim, cx, cz))`.

- [ ] **Step 1: Write the failing test**
```js
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-'));
let st = openStore(dir);
const A = Buffer.from('a'), hA = Buffer.alloc(8, 1), hB = Buffer.alloc(8, 2);
assert.strictEqual(st.chunk(-37, -22), 'unknown');
assert.strictEqual(st.put(-37, -4, -22, hA, A), true);
assert.strictEqual(st.put(-37, -4, -22, hA, A), false);              // same hash: no change
assert.strictEqual(st.seq(), 1);
assert.strictEqual(st.put(-37, -4, -22, hB, Buffer.from('b')), true);
assert.strictEqual(st.seq(), 2);
assert.strictEqual(st.chunk(-37, -22), 'unknown');                   // 1 of 24 sections
for (let sy = -3; sy <= 19; sy++) st.put(-37, sy, -22, hA, A);
assert.strictEqual(st.chunk(-37, -22), 'known');
assert.deepStrictEqual(st.get(-37, -4, -22), Buffer.from('b'));
assert.strictEqual(st.get(0, 0, 0), null);
assert.strictEqual(st.markUngenerated(3, 18), true);
assert.strictEqual(st.chunk(3, 18), 'ungenerated');
assert.strictEqual(st.markUngenerated(-37, -22), false);             // has sections
st.put(3, 0, 18, hA, A);
assert.strictEqual(st.chunk(3, 18), 'unknown');                      // generated meanwhile
const page = st.since(2, 10);
assert.strictEqual(page.sections.length, 10); assert.strictEqual(page.more, true);
assert.deepStrictEqual(st.since(st.seq(), 10), {seq: st.seq(), sections: [], more: false});
st.close(); st = openStore(dir);                                     // survives a restart
assert.strictEqual(st.chunk(-37, -22), 'known'); assert.strictEqual(st.counts().sections, 25);
```
- [ ] **Step 2: Run** — FAIL, module missing.
- [ ] **Step 3: Implement `openStore`** with the backend recorded in Task 1.
- [ ] **Step 4: Run** — exit 0. **Step 5: Commit** (`feat(world): section store`).

### Task 5: Queries

**Files:** Create `app/worldquery.js`; Test `app/test/world-query.js` (+ part list)

**Interfaces:**
- Consumes: `decodeSection`, `nameOf`, `isAir`, `cellIndex`, `SY_MIN`, `SY_MAX`.
- Produces:
  - `LIMITS = {blocks: 32768, height: 128, materials: 2000000}`
  - `parseBox(q): {x1,y1,z1,x2,y2,z2}` and `parseRect(q): {x1,z1,x2,z2}` (ordered corners; throw `BadQuery`)
  - `class BadQuery extends Error`, `class TooBig extends Error`
  - `makeQuery(src)` with `src = {section(cx, sy, cz): {palette, idx}|null, chunk(cx, cz): 'known'|'unknown'|'ungenerated'}` returning
    - `blocks(box): {box, palette: string[], blocks: [[x,y,z,i]], unknown: [[cx,cz]], ungenerated: [[cx,cz]]}` (air left out)
    - `height(rect): {rect, palette, heights: (number|null)[], tops: number[], unknown, ungenerated}` (index `(z - z1) * width + (x - x1)`; height = y of the highest non-air cell; `null` / `-1` where unknown, ungenerated or all air)
    - `materials(box): {box, counts: {[name]: number}, unknown, ungenerated}` (names without properties, no air)

- [ ] **Step 1: Write the failing test** — build `src` from a `Map`: chunk (-1, 0) known with stone at y 0..63 and `minecraft:oak_stairs[facing=east]` at world (-1, 64, 0); chunk (0, 0) unknown; chunk (1, 0) ungenerated.
```js
const r = q.blocks({x1: -2, y1: 63, z1: 0, x2: 17, y2: 65, z2: 0});
assert.deepStrictEqual(r.unknown, [[0, 0]]); assert.deepStrictEqual(r.ungenerated, [[1, 0]]);
assert.ok(r.blocks.every(([x]) => x < 0));                                  // nothing from unknown chunks
assert.deepStrictEqual(r.blocks.find(([x, y]) => x === -1 && y === 64), [-1, 64, 0, r.palette.indexOf('minecraft:oak_stairs[facing=east]')]);
const h = q.height({x1: -2, z1: 0, x2: 1, z2: 0});
assert.deepStrictEqual(h.heights, [63, 64, null, null]);
assert.strictEqual(h.tops[2], -1);
assert.deepStrictEqual(q.materials({x1: -16, y1: -64, z1: 0, x2: -1, y2: 319, z2: 15}).counts, {'minecraft:stone': 16 * 16 * 64, 'minecraft:oak_stairs': 1});
assert.throws(() => q.blocks({x1: 0, y1: 0, z1: 0, x2: 32, y2: 31, z2: 31}), TooBig);        // 33*32*32
assert.doesNotThrow(() => q.blocks({x1: -32, y1: 0, z1: 0, x2: -1, y2: 31, z2: 31}));        // exactly 32,768
assert.throws(() => q.height({x1: 0, z1: 0, x2: 128, z2: 0}), TooBig);
assert.throws(() => q.materials({x1: 0, y1: -64, z1: 0, x2: 127, y2: 319, z2: 127}), TooBig); // 6.3M
assert.throws(() => parseBox({x1: '1', y1: '0', z1: '0', x2: 'NaN', y2: '0', z2: '0'}), BadQuery);
assert.throws(() => parseBox({x1: '0', y1: '-65', z1: '0', x2: '0', y2: '0', z2: '0'}), BadQuery);
assert.deepStrictEqual(parseBox({x1: '5', y1: '9', z1: '0', x2: '-5', y2: '0', z2: '0'}), {x1: -5, y1: 0, z1: 0, x2: 5, y2: 9, z2: 0});
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** A chunk in `unknown`/`ungenerated` contributes no cells. **Step 4: Run** — exit 0. **Step 5: Commit** (`feat(world): bounded block, height and material queries`).

### Task 6: Worker and its client

**Files:** Create `app/worldmodel-worker.js`, `app/worldmodel.js`; Test `app/test/world-model.js` (+ part list)

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces:
  - `makeModel({store, fetch, url, token, area: {cx1,cz1,cx2,cz2}, now = Date.now, lru = 2048})` returning `{pullOnce(): Promise<number>, handle(op, args): Promise<{status, type, body: Buffer, gzip?: true}>, stats(): object}`; exported from `worldmodel-worker.js`, which also wires `parentPort` when not on the main thread.
  - Ops: `sections {cx, cz, r}` (r 0..8, else 413; body = gzip of a batch frame, batch 0, with kind 0 records plus kind 1/2 for ungenerated/unknown chunks), `changes {since}` (limit 1024), `blocks`, `height`, `materials` (JSON bodies; `BadQuery` -> 400, `TooBig` -> 413), `sample {n, seed, box?}` and `stats` (proxied to `GET {url}/world/sample|stats`; plugin down -> 502), `dirty {box}` (`POST {url}/world/dirty`).
  - Pull: `GET {url}/world/pull?ack=<batch>&wait=25&area=<cx1>,<cz1>,<cx2>,<cz2>` with `Authorization: Bearer <token>`; all records of a batch in one `store.tx`; a changed `boot` resets `ack` to 0; on error wait 2 s.
  - `startWorldModel({dir, url, token, area, log, Worker?})` (main thread) returning `{request(op, args): Promise<{status, type, body, gzip?}>, dirty(box): void, seq(): number, stop(): Promise<void>}`. Request timeout 35 s -> 503. A worker error or exit is logged, pending requests answer 503, the worker restarts after 5 s; nothing throws on the main thread.

- [ ] **Step 1: Write the failing test** (fake `fetch`, no thread, then one thread smoke test against a loopback HTTP server as `test/botui.js` does)
```js
// two batches, then the plugin restarts
const urls = [];
const replies = [frame(1n, 1, chunk24(-37, -22)), frame(1n, 2, [{kind: 1, cx: 3, sy: 0, cz: 18}]), frame(2n, 1, chunk24(-37, -22))];
const m = makeModel({store, url: 'http://p', token: 't', area: {cx1: -37, cz1: -22, cx2: 3, cz2: 18},
  fetch: async (u, o) => { urls.push(u); assert.strictEqual(o.headers.authorization, 'Bearer t'); return {ok: true, arrayBuffer: async () => replies.shift()}; }});
assert.strictEqual(await m.pullOnce(), 24);
assert.match(urls[0], /\/world\/pull\?ack=0&wait=25&area=-37,-22,3,18$/);
await m.pullOnce(); assert.match(urls[1], /ack=1&/);
const seq = store.seq();
assert.strictEqual(await m.pullOnce(), 0);                 // new boot, same content: nothing changes
assert.strictEqual(store.seq(), seq); assert.match(urls[2], /ack=2&/);
replies.push(frame(2n, 2, [])); await m.pullOnce(); assert.match(urls[3], /ack=1&/);   // ack follows the new boot
// requests
let r = await m.handle('sections', {cx: -37, cz: -22, r: 1});
const out = decodeBatch(zlib.gunzipSync(r.body));
assert.strictEqual(out.records.filter((x) => x.kind === 0).length, 24);
assert.strictEqual(out.records.filter((x) => x.kind === 2).length, 8);          // 3x3 minus the known one
assert.strictEqual((await m.handle('sections', {cx: 0, cz: 0, r: 9})).status, 413);
r = await m.handle('blocks', {x1: '-592', y1: '0', z1: '-352', x2: '-577', y2: '0', z2: '-337'});
assert.strictEqual(r.status, 200); assert.deepStrictEqual(JSON.parse(r.body).unknown, []);
assert.strictEqual((await m.handle('blocks', {x1: 'x'})).status, 400);
assert.strictEqual((await m.handle('materials', {x1: '0', y1: '-64', z1: '0', x2: '127', y2: '319', z2: '127'})).status, 413);
assert.deepStrictEqual(JSON.parse((await m.handle('changes', {since: String(store.seq())})).body).sections, []);
assert.strictEqual((await makeModel({store, url: 'http://p', token: 't', area, fetch: async () => { throw new Error('down'); }}).handle('stats', {})).status, 502);
// LRU stays bounded
const small = makeModel({store, fetch, url: 'http://p', token: 't', area, lru: 2});
for (let sy = -4; sy < 4; sy++) await small.handle('blocks', {x1: '-592', y1: String(sy * 16), z1: '-352', x2: '-592', y2: String(sy * 16), z2: '-352'});
assert.strictEqual(small.stats().lru, 2);
// thread smoke test: startWorldModel against a loopback fake plugin; seq() reaches 24, request('height', ...) is 200, stop() resolves
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement both files.** The worker posts `{t: 'seq', seq}` at most once a second; bodies are transferred, not copied. **Step 4: Run** — exit 0. **Step 5: Commit** (`feat(world): hub worker with pull loop and request handler`).

### Task 7: Hub wiring

**Files:**
- Create: `app/worldapi.js`; Test: `app/test/world-api.js` (+ part list), `app/test/config.js`, `app/test/debug-api.js`
- Modify: `app/config.js` (near 134-136, 181), `app/debug.js`, `app/server.js` (147 `mainConsole`, ~316 after `botui`, 471 `state()`, the route list after the `authorized` gate at 574, 750-767 `/api/debug`, the shutdown path), `docs/runbooks/minecraft/BOTS.md` (one paragraph: `WORLD_AREA`, the routes)

**Interfaces:**
- Consumes: `startWorldModel` (Task 6).
- Produces:
  - `dirtyBoxes(cmd: string): [{x1,y1,z1,x2,y2,z2}]`
  - `withDirty(call, onBox): call` (same signature as `queued()`'s result: `(commands: string[]) => Promise<string[]>`; boxes are reported after the call resolves)
  - `parseArea(text: string): {cx1,cz1,cx2,cz2}` (`"x,z,radius"` in blocks)
  - `handle(method: string, url: URL, model|null): Promise<[status, headers, body]>` for `/api/world/{sections,changes,blocks,height,materials,sample,stats}`
  - `loopDelayMeter({windowMs = 60000} = {}): () => {p50, p99, max, windowS}|null` in `debug.js` (ms, one decimal, the last complete window)
  - `cfg.worldArea` (null when `WORLD_AREA` is unset), `state().worldSeq` (0 when off), `/api/debug` field `loopDelayMs`

- [ ] **Step 1: Write the failing tests**
```js
// world-api.js
assert.deepStrictEqual(parseArea('-270,-20,320'), {cx1: -37, cz1: -22, cx2: 3, cz2: 18});
assert.throws(() => parseArea('-270,-20'), /WORLD_AREA/);
assert.deepStrictEqual(dirtyBoxes('fill -3 70 -3 3 70 3 minecraft:stone'), [{x1: -3, y1: 70, z1: -3, x2: 3, y2: 70, z2: 3}]);
assert.deepStrictEqual(dirtyBoxes('/minecraft:setblock -323 105 -30 minecraft:chest[facing=north]'), [{x1: -323, y1: 105, z1: -30, x2: -323, y2: 105, z2: -30}]);
assert.deepStrictEqual(dirtyBoxes('fill ~ ~ ~ ~1 ~ ~ stone'), []);
assert.deepStrictEqual(dirtyBoxes('minecraft:list'), []);
const seen = []; const call = withDirty(async (c) => c.map(() => 'ok'), (b) => seen.push(b));
assert.deepStrictEqual(await call(['setblock 1 2 3 stone', 'tps']), ['ok', 'ok']); assert.strictEqual(seen.length, 1);
await assert.rejects(withDirty(async () => { throw new Error('rcon'); }, (b) => seen.push(b))(['setblock 1 2 3 stone'])); assert.strictEqual(seen.length, 1);
const u = (p) => new URL('http://x' + p);
assert.strictEqual((await handle('GET', u('/api/world/blocks?x1=0'), null))[0], 503);
const model = {request: async (op, args) => ({status: 200, type: 'application/json', body: Buffer.from(JSON.stringify({op, args}))})};
const [code, headers, body] = await handle('GET', u('/api/world/height?x1=1&z1=2&x2=3&z2=4'), model);
assert.deepStrictEqual([code, headers['Content-Type'], JSON.parse(body)], [200, 'application/json', {op: 'height', args: {x1: '1', z1: '2', x2: '3', z2: '4'}}]);
assert.strictEqual((await handle('GET', u('/api/world/nope'), model))[0], 404);
assert.strictEqual((await handle('POST', u('/api/world/blocks'), model))[0], 404);
assert.strictEqual((await handle('GET', u('/api/world/sections?cx=0&cz=0&r=1'), {request: async () => ({status: 200, type: 'application/octet-stream', body: Buffer.alloc(1), gzip: true})}))[1]['Content-Encoding'], 'gzip');
// config.js part: WORLD_AREA without BOTUI_URL throws /WORLD_AREA needs BOTUI_URL/; unset gives worldArea === null
// debug-api.js part: const read = loopDelayMeter({windowMs: 50}); assert.strictEqual(read(), null); after 120 ms read() has numeric p50 <= p99 <= max and windowS === 0.05
```
- [ ] **Step 2: Run** the three parts — FAIL.
- [ ] **Step 3: Implement `worldapi.js`, `loopDelayMeter`, the config field.**
- [ ] **Step 4: Wire `server.js`**: `mainConsole = withDirty(queued(cfg.rcon), (b) => worldModel?.dirty(b))`; `worldModel` started only with `cfg.worldArea` and `STATE_DIR` (store in `STATE_DIR/world`); the `/api/world/` GET branch after the `authorized` gate writes `handle`'s triple with the existing `no-store`/`nosniff` headers; `state()` gets `worldSeq`; `/api/debug` gets `loopDelayMs`; `worldModel?.stop()` where the hub shuts down.
- [ ] **Step 5: Run** the three parts — exit 0. Start the hub locally without `WORLD_AREA` (`nix run .#mcbots` as in `BOTS.md`) and check `curl -s localhost:<port>/api/world/stats` gives `{"error":"world model is off"}` with 503.
- [ ] **Step 6: Commit** (`feat(world): hub routes, worldSeq, RCON dirty hook, loop delay in /api/debug`).

### Task 8: Feed queue (pure Java)

**Files:** Create `botui/FeedQueue.java`, `botui/FeedQueueCheck.java`; Modify `botui/default.nix`

**Interfaces:**
- Consumes: `SectionCodec.sectionKey/chunkKey/record/frame`.
- Produces (package-private):
```java
final class FeedQueue {
  static final int OUTBOX_MAX = 4096, SETTLE_TICKS = 5, DEBOUNCE_TICKS = 40, BATCH_RECORDS = 256, BATCH_BYTES = 1 << 20;
  enum Kind { DIRTY, IMPORT, SWEEP }
  record Work(int cx, int cz, Kind kind) {}
  record Rec(int kind, int cx, int sy, int cz, byte[] hash, byte[] blob) {}
  FeedQueue(long boot);
  synchronized boolean setArea(int cx1, int cz1, int cx2, int cz2);   // true when it changed: every chunk queued for IMPORT, sent hashes kept
  synchronized boolean inArea(int cx, int cz);
  synchronized void mark(int cx, int cz, long tick);                  // ignored outside the area
  synchronized void offerSweep(int cx, int cz);
  synchronized Work next(long tick);                                  // null when nothing is due or the outbox is full
  synchronized void done(Work w, long tick, java.util.List<Rec> recs); // drops records whose hash was already sent; latest per section wins
  synchronized boolean dirty(int cx, int cz);
  synchronized byte[] batch(long ack);                                // acks the previous batch, returns the next frame (count 0 when empty)
  synchronized int importLeft(); synchronized int dirtyCount(); synchronized int outboxSize();
}
```
Order in `next`: DIRTY chunks whose mark is at least `SETTLE_TICKS` old and whose last snapshot is at least `DEBOUNCE_TICKS` old, then IMPORT, then SWEEP. A wrong `ack` resends the same batch with the same id. `done` for an IMPORT with one kind 1 record marks the chunk ungenerated.

- [ ] **Step 1: Write the failing check** (`FeedQueueCheck.main`, asserts):
```java
FeedQueue q = new FeedQueue(1);
assert q.setArea(-37, -22, 3, 18) && !q.setArea(-37, -22, 3, 18) && q.importLeft() == 1681;
q.mark(100, 100, 0); assert q.dirtyCount() == 0;                          // outside the area
q.mark(-1, 0, 10);
assert q.next(14).kind() == FeedQueue.Kind.IMPORT;                        // mark not settled yet
FeedQueue.Work w = q.next(15); assert w.kind() == FeedQueue.Kind.DIRTY && w.cx() == -1;
q.done(w, 15, java.util.List.of(rec(-1, 0, 0, "a")));
for (int t = 16; t < 55; t++) q.mark(-1, 0, t);                           // storm on one chunk
for (int t = 16; t < 55; t++) assert q.next(t).kind() != FeedQueue.Kind.DIRTY;   // debounced, import goes on
assert q.next(60).kind() == FeedQueue.Kind.DIRTY;
// same hash again: nothing new to send
q.done(new FeedQueue.Work(-1, 0, FeedQueue.Kind.SWEEP), 100, java.util.List.of(rec(-1, 0, 0, "a")));
// hub down: outbox fills, marks stay, memory bounded
FeedQueue f = new FeedQueue(1); f.setArea(0, 0, 40, 40);
for (int i = 0; i < 300; i++) { FeedQueue.Work x = f.next(i); if (x == null) break; f.done(x, i, sections24(x.cx(), x.cz(), i)); }
assert f.outboxSize() <= FeedQueue.OUTBOX_MAX + 24 && f.next(1000) == null && f.importLeft() > 0;
f.mark(0, 0, 1000); assert f.dirty(0, 0);
// batches and acks
byte[] b1 = f.batch(0), again = f.batch(0); assert java.util.Arrays.equals(b1, again);     // not acked: same frame
byte[] b2 = f.batch(batchId(b1)); assert batchId(b2) == batchId(b1) + 1 && count(b1) == 256;
int left = f.outboxSize(); assert left <= FeedQueue.OUTBOX_MAX + 24 - 256 && f.next(1001) != null;   // room again
```
- [ ] **Step 2: Run locally** (the Task 3 command with `FeedQueue.java FeedQueueCheck.java SectionCodec.java`) — FAIL to compile.
- [ ] **Step 3: Implement `FeedQueue`.** **Step 4: Run** — exits 0. **Step 5:** add both files to `default.nix` as in Task 3 (`java -ea -cp classes:checks FeedQueueCheck`). **Step 6: Commit** (`feat(world): feed queue with settle, debounce, bounded outbox`).

### Task 9: WorldFeed (Bukkit glue and routes)

**Files:** Create `botui/WorldFeed.java`; Modify `botui/BotUi.java` (153-165 start, 172-177 `onDisable`, 205-216 `handle`, the pool size), `botui/default.nix`

**Interfaces:**
- Consumes: `FeedQueue`, `SectionCodec`.
- Produces:
```java
final class WorldFeed implements org.bukkit.event.Listener {
  static final long TICK_BUDGET_NANOS = 1_000_000; static final int SWEEP_PER_SEC = 6, IMPORT_PER_SEC = 20;
  WorldFeed(org.bukkit.plugin.Plugin plugin, org.bukkit.World world, long boot);
  void start();   // registers events, a 1-tick drain task, a single encoder thread "botui-world"
  void stop();
  void handle(com.sun.net.httpserver.HttpExchange x, String path) throws Exception;   // /world/pull, /world/dirty, /world/sample, /world/stats
}
```
- `BotUi.handle`: after the bearer check, `if (path.startsWith("/world/")) { world.handle(x, path); return; }`. `world` = `Bukkit.getWorlds().get(0)`. Pool `newFixedThreadPool(4)` -> `6`.
- Events (`MONITOR`, `ignoreCancelled = true`), each only `queue.mark(cx, cz, tick)` for every touched block (and piston destinations, explosion block lists, `StructureGrowEvent.getBlocks()`): `BlockPlaceEvent`, `BlockBreakEvent`, `BlockExplodeEvent`, `EntityExplodeEvent`, `BlockPistonExtendEvent`, `BlockPistonRetractEvent`, `BlockFromToEvent`, `BlockGrowEvent`, `BlockFormEvent` (covers spread), `BlockFadeEvent`, `BlockBurnEvent`, `LeavesDecayEvent`, `EntityChangeBlockEvent`, `StructureGrowEvent`, `PlayerBucketEmptyEvent`, `PlayerBucketFillEvent`.
- `ChunkUnloadEvent`: when `queue.dirty(cx, cz)` and `queue.next` would allow it (outbox not full), snapshot at once; otherwise the mark stays and the drain reloads the chunk later.
- Drain (every tick): `while (System.nanoTime() - t0 < TICK_BUDGET_NANOS && (w = queue.next(tick)) != null)`. Loaded chunk: `getChunkSnapshot(false, false, false)`, hand to the encoder thread, which builds 24 `Rec`s through `SectionCodec.strip(getBlockData(x, y, z).getAsString())` and calls `queue.done`. Not loaded: `world.getChunkAtAsync(cx, cz, false)`, at most `IMPORT_PER_SEC` requests a second; a `null` chunk gives one kind 1 record; a loaded one gets `addPluginChunkTicket` until its snapshot is taken.
- Sweep: `SWEEP_PER_SEC` loaded chunks of the area per second, round-robin over `world.getLoadedChunks()`, through `queue.offerSweep`.
- `/world/pull?ack=&wait=&area=cx1,cz1,cx2,cz2`: `queue.setArea(...)`, then wait up to `min(wait, 25)` s for a non-empty batch; reply `application/octet-stream`.
- `/world/dirty` (POST JSON `{x1,y1,z1,x2,y2,z2}`): marks every chunk of the box; more than 4096 chunks -> 400.
- `/world/sample?n=&seed=&box=`: `n` 1..2000, up to 25 random sections of the area (or the box), `n / 25` cells each from `java.util.Random(seed)`; chunks loaded with `getChunkAtAsync(gen=false)`; reads `world.getBlockAt(x, y, z).getBlockData().getAsString()` on the main thread, stripped; 30 s limit. Reply `{"samples": [[x,y,z,"state"]], "skipped": <ungenerated chunks>}`.
- `/world/stats`: `{boot, area, importLeft, dirty, outbox, loadedInArea, snapshots, mainMsLastMinute, maxTickMs, encodeMsLastMinute, sent}`.

- [ ] **Step 1: Implement `WorldFeed` and the `BotUi` changes.** No unit test here: every decision lives in `FeedQueue` and `SectionCodec`, which are tested; this file is glue. The gate is Step 2 plus the live checks of Task 11.
- [ ] **Step 2: Compile under the real flags** — add `WorldFeed.java` to the `cp` and `javac` lines, commit, run the `botui` flake check. Expected: builds, no warnings (`-Werror`).
- [ ] **Step 3: Stand test** — `tools/botui-stand/stand.sh` (local Paper with the plugin): `curl -s -H "Authorization: Bearer $PW" 'http://127.0.0.1:8101/world/stats'` shows `"area":null`; one `curl ... '/world/pull?ack=0&wait=1&area=0,0,1,1' | wc -c` is greater than 15; stats then show `importLeft` falling to 0.
- [ ] **Step 4: Commit** (`feat(world): WorldFeed in BotUi (events, snapshots, pull, dirty, sample, stats)`).

### Task 10: Live check scripts

**Files:** Create `tools/world-check/lib.js`, `lib.test.js`, `equality.js`, `load.js`, `nobot.js`, `README.md`

**Interfaces:**
- Produces (in `lib.js`):
  - `diffSamples(samples: [x,y,z,state][], reply): [{x,y,z,want,got}]` (`got` = the model's state, `minecraft:air` when the cell is absent in a known chunk, `?unknown` in an unknown or ungenerated chunk; air states compare equal to each other)
  - `farSpot(area: {x1,z1,x2,z2}, points: [x,z][], minDist = 300, size = 32): {x1,z1,x2,z2}|null`
  - `parseMspt(text: string): number|null` (the 1-minute average)
  - `compareLoad(before, after): {msptDelta, loopP99Delta, ok}` (`ok` when `msptDelta <= 0.5` and `loopP99Delta <= 2`)
- Scripts take `--hub` (default `https://bandit-lab.tail7facc9.ts.net:8445`), need no dependencies, run on the laptop. Exit codes: 0 pass, 1 differences or limits broken, 2 cannot run, 3 steps skipped.

- [ ] **Step 1: Write the failing test** (`lib.test.js`, `node --test tools/world-check/`)
```js
const reply = {palette: ['minecraft:stone'], blocks: [[1, 2, 3, 0]], unknown: [[5, 5]], ungenerated: []};
assert.deepStrictEqual(diffSamples([[1, 2, 3, 'minecraft:stone'], [1, 3, 3, 'minecraft:cave_air']], reply), []);
assert.deepStrictEqual(diffSamples([[1, 3, 3, 'minecraft:dirt']], reply), [{x: 1, y: 3, z: 3, want: 'minecraft:dirt', got: 'minecraft:air'}]);
assert.strictEqual(diffSamples([[80, 0, 80, 'minecraft:air']], reply)[0].got, '?unknown');
assert.deepStrictEqual(farSpot({x1: -590, z1: -340, x2: 50, z2: 300}, [[-270, -20]]), {x1: -590, z1: -340, x2: -559, z2: -309});
assert.strictEqual(farSpot({x1: 0, z1: 0, x2: 100, z2: 100}, [[50, 50]]), null);
assert.strictEqual(parseMspt('Server tick times (avg/min/max) from last 5s, 10s, 1m: 9.1/5.0/20.0, 9.3/5.1/20.2, 9.6/5.0/31.4'), 9.6);
assert.deepStrictEqual(compareLoad({mspt: 9.0, loopP99: 12}, {mspt: 9.4, loopP99: 15}), {msptDelta: 0.4, loopP99Delta: 3, ok: false});
```
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement `lib.js`.** **Step 4: Run** — pass.
- [ ] **Step 5: Write `equality.js`**
  1. `GET /api/world/stats`; exit 2 unless `plugin.importLeft === 0`.
  2. Static: `GET /api/world/sample?n=500&seed=<now>`, one `GET /api/world/blocks` per sampled section, `diffSamples`; on differences wait 5 s, read both again with the same seed; any left -> print the first 20, exit 1.
  3. Scripted, with `--spot x,y,z` (exit 2 unless the box spot +-6 is all air in the model and inside the area). Commands go through `POST /api/admin/action {action: 'command', cmd}`. After each step wait 5 s, `sample?n=500&box=<spot +-6>`, compare once, exit 1 on any difference:
     - basin: `fill x-4 y z-4 x+4 y+1 z+4 minecraft:stone`, then `fill x-3 y+1 z-3 x+3 y+1 z+3 minecraft:air`
     - piston: `setblock x y+1 z minecraft:sticky_piston[facing=east]`, `setblock x+1 y+1 z minecraft:glass`, `setblock x y+2 z minecraft:redstone_block`
     - water: `setblock x-2 y+1 z-2 minecraft:water`, compare, then `fill x-3 y+1 z-3 x+3 y+1 z+3 minecraft:air`
     - TNT: `summon minecraft:tnt x+2 y+2 z+2 {fuse:1}`
     - clean up: `fill x-6 y-6 z-6 x+6 y+6 z+6 minecraft:air`, `execute positioned x y z run kill @e[type=minecraft:item,distance=..16]`, compare
  4. Bot, with `--bot name --bot-spot x,y,z`: `POST /api/job {bots: [name], type: 'build', args: {origin, blocks: [{x: 0, y: 0, z: 0, block: 'cobblestone'}]}}`, poll the cell in `/api/world/blocks` every second up to 120 s, compare; the same with `remove: true`. Without the flags print `SKIP bot` and end with exit 3.
- [ ] **Step 6: Write `load.js`** — `run --minutes 30 --out f.json`: every 60 s read `/api/admin/status` (`parseMspt`), `/api/debug` (`loopDelayMs.p99`, null on an old hub), `/api/world/stats` (`plugin.mainMsLastMinute`, null when off); write the means. `compare before.json after.json`: print the deltas, exit 1 unless `compareLoad(...).ok`.
- [ ] **Step 7: Write `nobot.js`** — bots and players from `/api/state` (`bots[].pos`, `world.players`), `farSpot` over the area (blocks x -590..50, z -340..300); exit 2 when null. `/api/world/height` for the 32 x 32 rect and `/api/world/blocks` for the 32 x 32 x 32 box centred on the median height: exit 1 unless both `unknown` lists are empty; then `sample?n=500&box=` and `diffSamples` must be empty. Print the ground height at the centre (the number the architect must name in phase 3).
- [ ] **Step 8: README** (commands for the three scripts, exit codes) and **commit** (`feat(world): live checks for equality, load and a no-bot area`).

### Task 11: Ship in two steps and run the checks

**Files:** Modify `hosts/bandit-lab/services/mcbots/default.nix` (next to `BOTUI_URL`, ~172) in step B only.

- [ ] **Step 1: Full checks on the branch head** — both `nix build` commands from Global Constraints. Expected: both build. `graphify update .`.
- [ ] **Step 2: Baseline before any deploy** — `node tools/world-check/load.js run --minutes 30 --out before-old.json` (mspt only; the old hub has no `loopDelayMs`).
- [ ] **Step 3: Hand over deploy A (model off)** — tell the coordinator: the branch is ready; `WORLD_AREA` is not set, so the plugin gets no area and takes no snapshots. This deploy replaces `BotUi.jar` and restarts Paper: the owner ships it when nobody plays and runs the restart warning first (`AGENTS.md` 45-51). Agents do not push, bump or deploy.
- [ ] **Step 4: After deploy A** — `curl -s $HUB/api/world/stats` is 503 "world model is off"; `load.js run --minutes 30 --out before.json` (now with loop delay). `compare before-old.json before.json` must pass (the event handlers alone cost nothing measurable).
- [ ] **Step 5: Commit B** — add `WORLD_AREA = "-270,-20,320";` to `mcbots/default.nix`; commit (`feat(world): switch the world model on for base and castle`); hand over deploy B (hub container only, no Paper restart).
- [ ] **Step 6: After deploy B** — wait until `/api/world/stats` shows `plugin.importLeft: 0` (about 90 s) and note `hub.sections`, the size of `STATE_DIR/world`, `plugin.maxTickMs`, `plugin.loadedInArea`. Then:
  - `node tools/world-check/equality.js --spot <x,y,z> --bot <name> --bot-spot <x,y,z>` -> exit 0 (the coordinator names a free air spot near y 280 inside the area and a ground spot a bot can reach). The scripted part writes blocks and summons TNT in the owner's real world: get the owner's OK for the spots first; without it run only the static part (no `--spot`/`--bot`, exit 3 is expected).
  - `node tools/world-check/load.js run --minutes 30 --out after.json && node tools/world-check/load.js compare before.json after.json` -> exit 0 (mspt +0.5 ms or less, loop p99 +2 ms or less)
  - `node tools/world-check/nobot.js` -> exit 0
- [ ] **Step 7: Report** the three results and the Step 6 numbers; on a failed load check, report `plugin.mainMsLastMinute` and stop (do not tune without the coordinator).

## Self-review notes

- Spec coverage: WorldFeed (Tasks 3, 8, 9), worker and store (4, 6), routes and bounds (5, 7), `worldSeq`, RCON hook, loop delay (7), first-area import and start re-sweep (area on every pull, Tasks 6, 8, 9), the three checks (10, 11). Out of scope here by instruction: plan status, browser, chat.
- The architect half of success check 3 needs the bridge (phase 3); `nobot.js` prints the number to compare then.
- Whole-chunk snapshots only (no per-section dirty masks): one mechanism; `/world/stats` shows whether the encoder needs the finer mask later.
