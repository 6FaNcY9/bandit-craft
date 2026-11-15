# Wizard castle, part 1: warehouse and chest move — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bots build the warehouse K2 north-west of the sorter, and every owner container moves into it 1:1 by RCON.

**Architecture:** A small generator (`app/castle/`) describes the warehouse as block lists and writes a `.litematic`
with the existing `litematic-write.js`. It is uploaded to the hub and built by the usual `produce` + `schematic` jobs.
The move is pure RCON (`clone … filtered … move`), checked slot by slot before and after.

**Tech Stack:** Node 22 (mcbots app), prismarine-nbt via `litematic-write.js` / `schematic.js`, hub API, RCON via
`/api/admin/action`.

**Spec:** `docs/superpowers/specs/2026-11-15-wizard-castle-design.md` (phases 0-2; later phases get their own plans).

## Phase 0 results (read 2026-11-15 with `/api/voxels` via bot1, box x -352..-273, y 100..145, z -38..41)

- Warehouse plot x -333..-315, z -11..6, y ≥ 110: only grass, wildflowers, leaf litter, gravel and **2 bee nests**. Free.
- Tall thing at x -327..-316, z 24..28: bot scaffolding (62) + dirt. Not owner work; cleared in a later phase.
- Owner containers outside sorter and depot (209 chest blocks):
  - Hall rows: x -349..-318, y 110..112, z 34 and z 38 (2 rows x 32 x 3 = 192).
  - Birch house: x -289..-288, y 118..120, z 22..25 (14) and -284 118 22 (1).
  - On the hall roof: -318 124 40 and -318 124 41 (2).
  - 6 shulker boxes x -306..-304, y 110, z 6..7; ender chest -295 118 22.
- Sorter faces: see the spec, "Sorter access". The ground under the birch house is probed in phase 3, not here.

## Global Constraints

- Never change a sorter block (x -308..-295, z 11..50, y 111..129) or a depot chest (x -303..-299, y 110..113, z 6..7).
- No owner item may be lost: owner containers move only by RCON `clone … move`, never by bots.
- Every `clear` order stays ≤ 32 x 32 x 24 and outside the sorter.
- Bot-gatherable blocks only in the module (no quartz, glowstone, slime, prismarine, nether/end blocks).
- Visible outer faces are deepslate family; spruce for timber; lanterns for light.
- Commits unsigned in this worktree (`docs/wizard-castle`); the owner pushes. No deploy is needed for this plan.
- Hub calls use `scratchpad/api.sh` (`get`, `post`, `job`, `rcon`); every hub POST needs the `Origin` header.

## Review Focus

- A chest-row cell or the cell above it gets a block from the module → a clone lands on it or a chest cannot open. Test: `rowsStayEmpty`.
- The destination of a clone is not air → `clone` overwrites it. Check: Task 3 Step 2 compares each destination with empty sky first.
- A double chest is split at a 16-block cut → each half keeps its own 27 slots (no loss), but it shows as two singles. Check: Task 3 Step 1 records `type` at the cut.
- Bees attack the bots when they break the nests. Step: Task 2 Step 1 moves the nests first.
- The builder digs grass at floor level only with `clearAll`. Step: Task 2 sends `clearAll: true` (the plot holds no owner blocks).

---

### Task 1: Warehouse generator

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/castle/warehouse.js`
- Create: `hosts/bandit-lab/services/mcbots/app/castle/make.js`
- Test: `hosts/bandit-lab/services/mcbots/app/test/castle.js`

**Interfaces:**
- Consumes: `writeLitematic({name, author, regions: [{size, position, blocks}]})` from `app/litematic-write.js`;
  `parseLitematic(buffer)` and `placeSchematic(parsed, {origin})` from `app/schematic.js`.
- Produces:
  - `warehouse() -> {size: {x: 19, y: 12, z: 18}, blocks: [{x, y, z, name, props?}]}` (relative, origin = world
    -333 109 -11).
  - `ROWS` = relative chest rows `[{x1: 1, x2: 16, y1: 1, y2: 3, z}]` for z 2, 6, 10, 14.
  - CLI `node app/castle/make.js warehouse <out.litematic>`.

Geometry (relative x 0..18, y 0..11, z 0..17):
- y 0 floor: `cobblestone` (not visible from outside).
- Walls x 0/18 and z 0/17, y 1..9: `deepslate_bricks`; the 4 corner columns `polished_deepslate`; band y 5
  `polished_deepslate`.
- Doorway: air at (18, 1..2, 4), no door yet.
- Window slits `glass` at y 7..8: walls x 0/18 at z 4, 8, 12; walls z 0/17 at x 5, 9, 13.
- y 5 inside (x 1..17, z 1..16): `spruce_planks`, except the stair hole x 1..4, z 16.
- Stairs `spruce_stairs` `{facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false'}` at
  (1,1,16) (2,2,16) (3,3,16) (4,4,16) (5,5,16).
- y 10 roof (whole 19 x 18): `deepslate_tiles`; y 11 merlons `deepslate_bricks` on every even cell of the rim.
- Light: `lantern {hanging: 'true', waterlogged: 'false'}` at y 4 (storey 1) and y 9 (storey 2), x 4, 8, 12,
  z 4, 8, 12 (aisles only).
- Nothing else inside: chest rows and aisles are left out of the block list (structure void), so the module never
  touches them.

- [ ] **Step 1: Write the failing test** `app/test/castle.js`

```js
const assert = require('node:assert/strict');
const {warehouse, ROWS} = require('../castle/warehouse.js');
const w = warehouse();
const at = new Map(w.blocks.map((b) => [`${b.x},${b.y},${b.z}`, b]));
// size and limits (schematic job: <= 32 x 24 x 32)
assert.deepEqual(w.size, {x: 19, y: 12, z: 18});
assert.ok(w.blocks.every((b) => b.x >= 0 && b.x < 19 && b.y >= 0 && b.y < 12 && b.z >= 0 && b.z < 18));
// rowsStayEmpty: chest rows and the cell above each chest stay free
for (const r of ROWS) for (let x = r.x1; x <= r.x2; x++) for (let y = r.y1; y <= r.y2 + 1; y++) assert.ok(!at.has(`${x},${y},${r.z}`), `row cell ${x},${y},${r.z}`);
// doorway open, stairs east, lanterns hang
assert.ok(!at.has('18,1,4') && !at.has('18,2,4'));
assert.equal(w.blocks.filter((b) => b.name === 'spruce_stairs' && b.props.facing === 'east').length, 5);
assert.equal(w.blocks.filter((b) => b.name === 'lantern' && b.props.hanging === 'true').length, 18);
// palette: bot-gatherable only
const OK = /^(cobblestone|deepslate_bricks|polished_deepslate|deepslate_tiles|spruce_planks|spruce_stairs|glass|lantern)$/;
assert.ok(w.blocks.every((b) => OK.test(b.name)), [...new Set(w.blocks.map((b) => b.name))].join());
// round trip through the real writer and parser
(async () => {
  const {writeLitematic} = require('../litematic-write.js');
  const {parseLitematic, placeSchematic} = require('../schematic.js');
  const buf = writeLitematic({name: 'castle-lager', regions: [{size: w.size, position: {x: 0, y: 0, z: 0}, blocks: w.blocks}]});
  const placed = placeSchematic(await parseLitematic(buf), {origin: {x: -333, y: 109, z: -11}});
  assert.equal(placed.length, w.blocks.length);
  assert.ok(placed.every((b) => b.x >= -333 && b.x <= -315 && b.z >= -11 && b.z <= 6 && b.y >= 109 && b.y <= 120));
  console.log('castle ok');
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module '../castle/warehouse.js'`)

Run (from `hosts/bandit-lab/services/mcbots/app`):
`NM=$(ls -dt /nix/store/*-mcbots-0.1.0/lib/node_modules/mcbots/node_modules | head -1); NODE_PATH=$NM /nix/store/9f452rg43l2v41xq7zljq73pdd09vr6l-nodejs-22.23.3/bin/node test/castle.js`

- [ ] **Step 3: Implement `warehouse()` and `ROWS`** in `app/castle/warehouse.js` from the geometry list above
  (plain loops into one array; a later cell overwrites an earlier one via a Map keyed by `x,y,z`).

- [ ] **Step 4: Implement `make.js`**: `node make.js warehouse out.litematic` writes
  `writeLitematic({name: 'castle-lager', author: 'mcbots', regions: [{size, position: {x:0,y:0,z:0}, blocks}]})` to
  the path; unknown module name → exit 1 with `unknown module`.

- [ ] **Step 5: Run the test, expect `castle ok`**, then check `test.js` picks the file up (it runs every
  `test/<topic>.js`; if it uses a list, add `castle`).

- [ ] **Step 6: Commit**

```bash
git add hosts/bandit-lab/services/mcbots/app/castle hosts/bandit-lab/services/mcbots/app/test/castle.js
git commit -m "feat(castle): warehouse module generator"
```

### Task 2: Build the warehouse (live, bots)

**Files:** none in the repo (live operations). Output `scratchpad/castle/castle-lager.litematic`.

**Interfaces:**
- Consumes: Task 1 CLI.
- Produces: the built warehouse; a protected place `Lager` (box x -333..-315, y 109..121, z -11..6).

`LAGER` args (shell variable, like `SORTER17` in `api.sh`): `{file: "castle-lager.litematic", origin: {x: -333, y: 109,
z: -11}, rotation: 0, mirror: "none", chests: <the 17 depot chests of SORTER17>, clearAll: true}`; for `produce` add
`store: {x: -303, y: 111, z: 6}`.

- [ ] **Step 1: Move the 2 bee nests out** (by day, bees inside): find them in the phase-0 voxel read
  (`names[i] == "bee_nest"`), then per nest `rcon "clone X Y Z X Y Z -345 Y2 0 replace move"` onto natural ground
  west of the core wall (check the target is air first with `execute if block -345 Y2 0 minecraft:air`).
  Expect: `execute if block X Y Z minecraft:air` passes at both old spots.
- [ ] **Step 2: Clear the plot**: `job '{"bots":["bot20"],"type":"clear","args":{"x1":-333,"y1":110,"z1":-11,"x2":-315,"y2":125,"z2":6,"anywhere":true}}'`
  (`anywhere` = the owner's own order; without it `clear` only works on ground that names the bot, `misa.boxRule`).
  Expect: job done; a voxel read of that box shows no blocks above y 109.
- [ ] **Step 3: Write and upload the schematic**: `node app/castle/make.js warehouse $S/castle/castle-lager.litematic`,
  then `curl -s -H "Origin: $HUB" -H 'content-type: application/octet-stream' --data-binary @$S/castle/castle-lager.litematic "$HUB/api/schematic?name=castle-lager"`.
  Expect: `GET /api/schematics` lists `castle-lager.litematic`.
- [ ] **Step 4: Materials**: one `produce` job (bot19) with `LAGER` + store. Read its activity after 2 min: if it
  names `cobbled_deepslate` as something the bots cannot make, give `mine` jobs
  (`{"block":"deepslate","count":512}`) to bot2 and bot3 in the Shaft zone and rerun `produce` when they are done.
  Expect: the produce job finishes without "nothing the bots can make".
- [ ] **Step 5: Build**: `schematic` jobs with `LAGER` for bot2, bot3, bot20, bot21, MisaBot. Resend on "no progress
  for 300 s" after reading `lastError` (a foreign block in a planned cell is reported there; dig it only if it is not an
  owner block). Expect: every builder shows `placed N/N` with N = the block count of Task 1.
- [ ] **Step 6: Check**: RCON `execute if block -315 110 -7 minecraft:air` (doorway), `execute if block -329 113 -7 minecraft:lantern[hanging=true]`,
  `execute if block -332 110 5 minecraft:spruce_stairs[facing=east]`; voxel read of the 4 chest rows shows only air.
- [ ] **Step 7: Protect it**: `post /api/places '{"action":"set","place":{"name":"Lager","kind":"protected","dim":"overworld","x":-324,"y":110,"z":-2,"box":{"x1":-333,"y1":109,"z1":-11,"x2":-315,"y2":121,"z2":6}}}'`.
  Expect: `/api/areas` `.protectedAreas` contains `[-333,-11,-315,6,109,121]`.

### Task 3: Move the owner containers (live, RCON)

**Files:** `scratchpad/castle/before.tsv`, `scratchpad/castle/after.tsv` (not in the repo).

**Interfaces:**
- Consumes: Task 2 (warehouse built, rows empty).
- Produces: every owner container inside K2; old spots empty.

Moves (`clone <from> <to> <dest> filtered <block> move`; dest = lowest corner):

| # | from | to | dest | filter |
|---|---|---|---|---|
| 1 | -349 110 34 | -334 112 34 | -332 110 -9 | minecraft:chest |
| 2 | -333 110 34 | -318 112 34 | -332 110 -5 | minecraft:chest |
| 3 | -349 110 38 | -334 112 38 | -332 110 -1 | minecraft:chest |
| 4 | -333 110 38 | -318 112 38 | -332 110 3 | minecraft:chest |
| 5 | -289 118 22 | -288 120 25 | -332 115 -9 | minecraft:chest |
| 6 | -284 118 22 | -284 118 22 | -329 115 -9 | minecraft:chest |
| 7 | -318 124 40 | -318 124 41 | -327 115 -9 | minecraft:chest |
| 8 | -306 110 6 | -304 110 7 | -324 115 -9 | #minecraft:shulker_boxes |
| 9 | -295 118 22 | -295 118 22 | -320 115 -9 | minecraft:ender_chest |

- [ ] **Step 1: Record before**: for every chest/shulker cell of the 9 sources, the number of filled slots
  (`execute if data block X Y Z Items[]` → `Test passed, count: N`, empty → `Test failed` = 0), and at the cuts
  x -334/-333 the `type` state (`execute if block -334 110 34 minecraft:chest[type=right]` etc.). Write
  `x y z slots` lines to `before.tsv`. Expect: 209 chest + 6 shulker + 1 ender lines.
- [ ] **Step 2: Destinations empty**: for each move, `execute if blocks <dest box> <same box at y 300> all` must pass
  (the sky above is air). Stop if one fails.
- [ ] **Step 3: Run the 9 clones** one by one with a bot near (bot1 at -311 111 1 keeps the chunks loaded). Expect:
  each reply `Successfully cloned N blocks` with N = the source count of that move.
- [ ] **Step 4: Record after** at the moved coordinates (source + (dest − from)) into `after.tsv`; `diff` against
  `before.tsv` after shifting. Expect: no difference; every source cell `minecraft:air`.
- [ ] **Step 5: Owner check**: ask the owner to open a few chests in the warehouse in game (in-game action).
- [ ] **Step 6: Notes**: memory note `projects/bandit-craft` (basic-memory, project `main`): warehouse built, move
  verified, hall now empty but still protected (its fate is phase 8).
