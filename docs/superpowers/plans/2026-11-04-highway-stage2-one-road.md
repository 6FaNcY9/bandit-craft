# Highway stage 2: one road in the sandbox. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bot2` builds the east road from the origin chamber for 2 km on the sandbox, alone, from farm to rail, and survives a death, a hub restart and a deploy.

**Architecture:** A new job type `highway`. `app/road.js` holds the pure parts (geometry, what a block is, what a segment holds), `app/cartride.js` the trip by cart, `app/roadjob.js` the loop that wires them to a bot like `level.js`. The job keeps almost no state: riding out from the origin ends at the road's real end by itself, because the rail stops one cell before the rock.

**Tech Stack:** Node, mineflayer 4.39, Paper 26.2 sandbox, tests in `app/test/<topic>.js` with a fake world.

**Spec:** `docs/specs/2026-11-03-highway-bots-design.md`. Numbers: `docs/runbooks/minecraft/highway-measurements.md`.

Run mcbots tests from `hosts/bandit-lab/services/mcbots/app` with `NODE_PATH` set to the `node_modules` of a built mcbots package: `node test/road.js` for one part, `node test.js` for all.

## Global Constraints

- Roads from x 0, y 0, z 0, straight, in the overworld. `bot2` east, `bot3` west, `bot20` south, `bot21` north.
- Rule: `max_minecart_speed` 200. Dips every 16 blocks. A ramp is 48 boosters.
- A bend or a sideways step to avoid an obstacle is failure: a road that cannot continue straight stops and reports.
- A bot never breaks a player's build, and takes nothing from MidariBread's area or from `GUEST_BOTS` chests.
- No `/give`, `/fill` or `/tp` for building. Only tests and test set-ups on the sandbox use the console.
- Everything here runs on the sandbox: nothing touches the main server before stage 4.
- Agents commit unsigned in this worktree. The owner pushes and deploys.
- Every owner step gets the exact command, the host and when, in a line short enough not to wrap (65 characters): long chains go into a script.
- The owner turned the sandbox's monsters off on 2026-11-04 "for now" (`difficulty peaceful`). Task 10 needs them on: say so to the owner before setting `difficulty normal`.

## Review Focus

1. A death or restart in the middle of a cell (floor laid, no rail): the job reads the blocks on resuming and finishes the cell, without a second rail or a gap. Test: `resumes a half-built cell` in Task 7.
2. Water or lava that keeps flowing back into a road cell: three tries at the same place, then the road stops and reports, no endless loop. Test: `fluid that comes back stops the road` in Task 5.
3. A chest inside a protected area or of a guest bot within 256 blocks of a farm: never a source. Test: `no source in a protected area` in Task 9.
4. A rider who ends up mid-road (a restart during a ride): walks to the nearer end and carries on, instead of building from there. Test: `stranded mid-road walks to the nearer end` in Task 7.
5. The owner's Stop during a ride: the input timer ends, the bot gets off. Test: `stop during a ride` in Task 4.

---

### Task 1: The last unknowns of the trip, measured

Extend the throwaway `tools/mcbots-railspeed/spikes/start.js`. Laid by the console, ridden by a bot, so no unit test can stand in.

**Files:**
- Modify: `tools/mcbots-railspeed/spikes/start.js`
- Modify: `docs/runbooks/minecraft/highway-measurements.md` ("A builder's whole trip")

**Interfaces:**
- Produces: `FLAT_BEFORE_END` and the origin's stop for Task 2, as measured.

- [ ] **Step 1: A dip close to the rail's end.** Add an argument for the flat cells between the last dip and the end of the rail. Run with 3, both directions.
Expected: the cart stands in the landing, unhurt. If it does not, try 8, then 20. The smallest that passes is `FLAT_BEFORE_END`.

- [ ] **Step 2: The origin's end, as Task 8 will build it.** The origin's cart must stop, but a bot must get past: curb at `k 3` (one block at `y 0`, air at `y 1` and `y 2`, roof at `y 3`), landing at `k 4`, first rail at `k 5`, first dip at `k 8`, first booster at `k 12`. Ride in from the far side, then start from `k 5`.
Expected: the cart stands in the landing. `goNear` over the curb works: the bot walks into the 3-high room behind it. A cart on `k 5` starts by input alone and crosses the dip before its first booster. If the cart climbs the curb, use a full wall with the way round through a side cell. If it cannot cross the dip, add a booster at `k 6`. Record either.

- [ ] **Step 3: A relog in a cart, and a cart left behind.** Quit the bot in the middle of a ride, log it in again. Then ride a second cart into a cart left standing on the rail.
Expected, to be recorded whichever it is: where the bot stands, whether it still rides, whether the cart is left on the rail, and what a rider at speed does when it meets one. Task 7 builds on this.

- [ ] **Step 4: Torches instead of redstone blocks.** Power the ramp with one redstone torch per booster in a wall niche, laid by the console, on the road's own slots (`k % 16` is 0, 4 or 12), which fit 48 boosters into 256 cells where the test took 290.
Expected: the same speed at the ramp's end as in the runbook, within 10 %.

- [ ] **Step 5: Write the four results into the runbook, and commit.**

```bash
git add tools/mcbots-railspeed/spikes docs/runbooks/minecraft/highway-measurements.md
git commit --no-gpg-sign -m "test(highway): a dip near the rail's end, the origin's curb, a relog in a cart"
```

---

### Task 2: Road geometry

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/road.js`
- Create: `hosts/bandit-lab/services/mcbots/app/test/road.js`
- Modify: `hosts/bandit-lab/services/mcbots/app/test.js` (add `road` to the list of parts)

**Interfaces:**
- Consumes: `FLAT_BEFORE_END` from Task 1.
- Produces, all pure, with `road = {dir, origin: {x, y, z}}` and `k` the distance from the origin:
  - `cell(road, k, h = 0, side = 0) -> {x, y, z}`
  - `isDip(k) -> boolean`, `railHeight(k) -> 0 | -1`
  - `crossSection(road, k) -> {air: [cell], solid: [cell], rail: cell}`
  - `isBoosterSlot(k) -> boolean`, `niche(road, k) -> cell`
  - `mayEndAt(k) -> boolean`
  - `onRoad(road, pos) -> {k, side, h} | null`
  - `FIRST_RAIL = 5`, `RAMP_BOOSTERS = 48`, `RAMP_CELLS = 256`, `BORDER_K = 29999984`

- [ ] **Step 1: Write the failing test**

```js
const road = {dir: 'east', origin: {x: 0, y: 0, z: 0}}, north = {dir: 'north', origin: {x: 0, y: 0, z: 0}};
assert.deepStrictEqual(cell(road, 5, 1, -1), {x: 5, y: 1, z: -1});
assert.deepStrictEqual(cell(north, 5, 0), {x: 0, y: 0, z: -5});
// A dip is two cells in every 16.
assert.deepStrictEqual([7, 8, 9, 10, 24, 25].map(isDip), [false, true, true, false, true, true]);
assert.deepStrictEqual(crossSection(road, 7).rail, {x: 7, y: 0, z: 0});
assert.deepStrictEqual(crossSection(road, 8).rail, {x: 8, y: -1, z: 0});
// Flat: two air, floor, roof, four wall cells. Dip: three air, floor one lower, roof, six wall cells.
assert.deepStrictEqual([crossSection(road, 7).air.length, crossSection(road, 7).solid.length], [2, 6]);
assert.deepStrictEqual([crossSection(road, 8).air.length, crossSection(road, 8).solid.length], [3, 8]);
assert.ok(crossSection(road, 8).solid.some((c) => c.y === -2 && c.x === 8 && c.z === 0));
// Boosters avoid dips: three in every 16, so 48 take 256 cells.
assert.deepStrictEqual(Array.from({length: 16}, (_, k) => isBoosterSlot(k)).flatMap((b, k) => (b ? [k] : [])), [0, 4, 12]);
// The rail ends only where the last dip is far enough back.
assert.ok(!mayEndAt(8) && !mayEndAt(9) && !mayEndAt(7));
assert.deepStrictEqual(onRoad(road, {x: 40.5, y: 0, z: 0.5}), {k: 40, side: 0, h: 0});
assert.strictEqual(onRoad(road, {x: 40.5, y: 0, z: 9.5}), null);
```

- [ ] **Step 2: Run it.** `node test/road.js`. Expected: FAIL, cannot find `../road`.

- [ ] **Step 3: Implement `road.js`.** `mayEndAt(k)`: `k` and `k + 1` are no dip cells, and the last dip lies at least `FLAT_BEFORE_END` cells back. `niche(road, k)` is `cell(road, k, 0, 1)`: the wall cell beside the rail.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** `git commit --no-gpg-sign -m "feat(highway): road geometry"` with the three files.

---

### Task 3: What a block is, and what a segment holds

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/road.js`, `test/road.js`

**Interfaces:**
- Produces:
  - `kindOf(name) -> 'air' | 'fluid' | 'falling' | 'natural' | 'structure' | 'keep' | 'danger' | 'player'`
  - `inspect(blockAt, road, fromK, toK) -> {stop: null | {why, at, name}, fluids: [cell], open: [cell]}`: looks 3 to each side, at heights -3 to +4, and 3 cells ahead of `toK`, because the spec's limit is 3 blocks from the segment.

- [ ] **Step 1: Write the failing test**

```js
for (const n of ['stone', 'deepslate', 'tuff', 'deepslate_iron_ore', 'moss_block', 'sculk', 'pointed_dripstone', 'obsidian']) assert.strictEqual(kindOf(n), 'natural', n);
for (const n of ['gravel', 'sand', 'red_sand']) assert.strictEqual(kindOf(n), 'falling', n);
for (const n of ['water', 'lava', 'bubble_column']) assert.strictEqual(kindOf(n), 'fluid', n);
for (const n of ['oak_planks', 'oak_fence', 'rail', 'cobweb', 'chiseled_tuff', 'waxed_copper_block']) assert.strictEqual(kindOf(n), 'structure', n);
for (const n of ['chest', 'barrel', 'hopper', 'spawner', 'trial_spawner', 'vault']) assert.strictEqual(kindOf(n), 'keep', n);
assert.strictEqual(kindOf('sculk_shrieker'), 'danger');
for (const n of ['torch', 'wall_torch', 'cobblestone', 'cobblestone_stairs', 'white_bed', 'oak_sign', 'powered_rail']) assert.strictEqual(kindOf(n), 'player', n);
// A world of stone, with one thing put in per case.
assert.strictEqual(inspect(world(), east, 16, 32).stop, null);
assert.strictEqual(inspect(world({'20,3,3': 'torch'}), east, 16, 32).stop.why, 'player', 'within 3 blocks');
assert.strictEqual(inspect(world({'20,3,4': 'torch'}), east, 16, 32).stop, null, 'one further off');
assert.strictEqual(inspect(world({'20,0,0': 'chest'}), east, 16, 32).stop.why, 'keep', 'in the road');
assert.strictEqual(inspect(world({'20,0,2': 'chest'}), east, 16, 32).stop, null, 'a chest beside the road stays and does not stop it');
assert.strictEqual(inspect(world({'20,0,0': 'oak_planks'}), east, 16, 32).stop, null, 'a mineshaft is dug through');
assert.strictEqual(inspect(world({'20,2,0': 'sculk_shrieker'}), east, 16, 32).stop.why, 'danger');
assert.strictEqual(inspect(world({'35,0,0': 'torch'}), east, 16, 32).stop.why, 'player', '3 ahead');
assert.strictEqual(inspect(world({'36,0,0': 'torch'}), east, 16, 32).stop, null, '4 ahead');
assert.strictEqual(inspect(world({'20,0,0': null}), east, 16, 32).stop.why, 'unloaded');
```

- [ ] **Step 2: Run it.** Expected: FAIL, `kindOf` is not a function.

- [ ] **Step 3: Implement.** Extend `NATURAL` from `bots.js` rather than copying it: move the regex to `road.js` and import it back. Everything not named counts as `player`, as the spec says. A player's plain rail or planks look like a mineshaft's, the spec's known limit. The east road's mineshafts at 400, 1500 and 1600 lie on the 2 km test. `unloaded` is not a stop for the owner: the job waits and reads again, and reports only if it lasts, because a bot was seen with no chunk 20 s after a teleport (runbook).

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** `git commit --no-gpg-sign -m "feat(highway): what a block is, what a segment holds"`.

---

### Task 4: A trip by cart

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/cartride.js`
- Create: `hosts/bandit-lab/services/mcbots/app/test/cartride.js`
- Modify: `app/test.js`

**Interfaces:**
- Produces: `makeRide({guard, sleep}) -> {ride, leave, takeCart}`
  - `ride(r, job, railPos, {limitMs}) -> Vec3`: puts the cart from the inventory on `railPos`, boards from where the bot stands, starts by input, waits for 2 s without a `move_minecart` packet after the first one, gets off, takes the cart back, and returns where the bot is. Throws `cart did not start` when no packet comes in 20 s.
  - `leave(r)`: `player_input` with `shift`, then none, then clears `bot.vehicle`, which mineflayer leaves set. The same call gets a bot off that logged in riding (Task 1, step 3).
  - `takeCart(r, job)`: iron or better pickaxe in hand, `bot.attack` every 900 ms, at most 8 times. By hand it heals faster than a bot hits.

- [ ] **Step 1: Write the failing test**, with a fake bot whose `_client` is an `EventEmitter`:

```js
// 'rides until the packets stop': packets for 5 s, then silence, the bot gets off after 2 s.
assert.deepStrictEqual(bot.written.map((w) => w.inputs?.shift), [true, undefined]);
assert.strictEqual(bot.vehicle, null);
assert.strictEqual(bot.attacks >= 1, true, 'the cart goes back in the inventory');
// 'packets for another entity do not count': only another cart's packets means it never started.
await assert.rejects(ride(r, job, rail, {limitMs: 30000}), /cart did not start/);
// 'stop during a ride': job.cancelled while packets come: the input timer ends and the bot gets off.
assert.strictEqual(bot.timersLeft(), 0);
assert.deepStrictEqual(bot.written[0].inputs, {shift: true});
// 'no cart in the inventory' fails at once, before anything is placed.
```

- [ ] **Step 2: Run it.** Expected: FAIL, cannot find `../cartride`.

- [ ] **Step 3: Implement** from `spikes/start.js`, which proved each step. `limitMs` ends a ride that never stops, with an error.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** `git commit --no-gpg-sign -m "feat(highway): a trip by cart"`.

---

### Task 5: One cell of road

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/roadjob.js`
- Create: `hosts/bandit-lab/services/mcbots/app/test/roadjob.js`
- Modify: `app/test.js`

**Interfaces:**
- Consumes: `crossSection`, `kindOf` (Tasks 2, 3); `refFace` from `seal.js`; `digAt`, `goNear`, `guard`, `sleep`, `waitCalm` from `bots.js`, passed in as `level.js` does.
- Produces:
  - `makeRoad(deps) -> {highway, buildCell}`, with `buildCell(r, job, road, k) -> 'ok' | {out: 'lining'} | {stop: why}`: leaves cell `k` finished. It is told apart from `stop` because running out of lining ends a shift, not the road.
  - `checkCell(blockAt, road, k) -> [problem]`, pure, in `road.js`, because `road-check.js` uses it too: what is wrong with a finished cell.
  - `LINING = /^(cobbled_deepslate|cobblestone)$/`: what digging deepslate and stone yields without Silk Touch.

- [ ] **Step 1: Write the failing test**, fake world with `blockAt`, `bot.dig`, `bot.placeBlock` as in `test/jobs/part.js`:

```js
// 'digs and lays a flat cell', 'digs and lays a dip': checkCell is empty afterwards.
// 'lines what is open': floor, walls and roof that are air, water or gravel end up solid, from the bot's own waste rock.
// 'keeps natural rock': a wall of granite is left alone, nothing placed there.
// 'rails go on in road order': placing k, then k + 1, through a dip. That order gave the right shapes live, east and north.
// 'fluid that comes back stops the road': a cell that fills again after each lining returns {stop: 'cannot continue'} on the third try.
// 'a block it must not dig': a chest in the cell returns {stop: 'keep'} and digs nothing.
// 'runs out of lining': no rock to line with, returns {out: 'lining'}, and the cell is left closed, not open.
// 'keeps rock for lining': jobWants says yes, so tossJunk leaves it; above 4 stacks the job throws the rest away.
```

- [ ] **Step 2: Run it.** Expected: FAIL, cannot find `../roadjob`.

- [ ] **Step 3: Implement.** Order within a cell: `solid` cells first, so that a fluid is shut off before the cell opens, then `air`, then `rail`. `digRefusal` (`bots.js:1561`) refuses a dig beside a fluid, so water in an `air` cell is filled first and then dug. The bot stands on `k - 2`, never in an unfinished cell, and `r.digOnly = /$^/` keeps the pathfinder from digging its own ways for the whole job.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** `git commit --no-gpg-sign -m "feat(highway): one cell of road"`.

---

### Task 6: The moving ramp

A shift can end for several reasons: no rails, no lining, the last pickaxe, or the owner's stop. So the ramp is laid when the shift ends, by walking back, whatever the reason was. That is one path instead of predicting the end of a load. It costs about 9 minutes a trip by estimate, against about 5 for laying it on the way out: Task 10 measures it, and only then is the other way worth its code.

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/roadjob.js`, `test/roadjob.js`

**Interfaces:**
- Consumes: `isBoosterSlot`, `niche`, `FIRST_RAIL`, `RAMP_CELLS` (Task 2).
- Produces, in `makeRoad`:
  - `layBooster(r, job, road, k) -> boolean`: digs the niche, places the torch and the powered rail. False, and the slot stays plain rail, when anything but rock is around the niche: a niche must not open a cave or a fluid into the road.
  - `removeBooster(r, job, road, k) -> boolean`: plain rail back, torch taken, the niche filled with rock again, so that `checkCell` needs no case for an old niche.
  - `layRamp(r, job, road, head) -> number`: walks back over the last `RAMP_CELLS`, `layBooster` on each slot not yet a booster, then back to the head. Returns how many stand.
  - `collectRamp(r, job, road, head) -> number`: the same walk with `removeBooster`. Returns how many it took. Never touches the origin's ramp, which is the slots up to `FIRST_RAIL + RAMP_CELLS`, and which the job lays as it builds those cells on the first trip.

- [ ] **Step 1: Write the failing test**

```js
// 'a booster swaps in place': after layBooster: powered_rail at k, redstone_torch in the niche, one of each fewer in the inventory.
// 'no niche into a cave': air behind the niche: false, nothing dug.
// 'a ramp is laid walking back': head at 1000: 48 powered rails in the slots behind it, bot back at the head.
// 'collecting leaves the road as it was': after collectRamp: rail in all slots, 48 powered rails and 48 torches back, checkCell empty for all cells.
// 'the origin's ramp stays': head at 300: collectRamp touches no slot up to FIRST_RAIL + RAMP_CELLS.
// 'a ramp with holes': two slots already plain, collectRamp returns 46 and does not fail.
```

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** `git commit --no-gpg-sign -m "feat(highway): the ramp that moves with the head"`.

---

### Task 7: The job

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/roadjob.js`, `test/roadjob.js`
- Modify: `hosts/bandit-lab/services/mcbots/app/bots.js`: `VALIDATE.highway` (line 105), `JOBS.highway` (line 3158), wiring beside `makeLevel` (line 3081), `KEEP` (line 62), `NIGHT_JOBS` (line 1094: underground changes nothing, on the surface an unfit bot shelters), `upkeep` must not call `lightUp` for this job (line 2187): a torch in the road is what stops a road
- Modify: `hosts/bandit-lab/services/mcbots/app/notify.js`: `event()` sends an alert whose text starts `highway:` as high priority, as it does for `solver:`
- Modify: `tools/mcbots-scenarios/scenarios.js`: the live check

**Interfaces:**
- Consumes: everything above; `ride` from Task 4. Tasks 8 and 9 come later: until then `buildOrigin` and `restock` are arguments of the loop that the tests pass in, and the scenario brings its own load.
- Produces:
  - `VALIDATE.highway(args) -> {dir, length?, origin?, frontier?}`: `dir` one of the four. `origin` and `length` are what tests use. `frontier` is written by the job: `keptOf` carries `job.args` across restarts.
  - `highway(r, job)`, one loop: where am I, then one of: fetch a load, ride out, walk to an end, or work.

- [ ] **Step 1: Write the failing test**

```js
// 'a new road': no rail at FIRST_RAIL, the bot builds from there.
// 'rides out to the real end': rail exists, the bot at the origin rides, then finds the end by reading blocks, whatever frontier said.
// 'resumes a half-built cell': floor laid, no rail, at the frontier: no second rail, no gap.
// 'stranded mid-road walks to the nearer end': at k 1000 of a road ending at 1500: takes its cart back, walks to the head and works; at k 200: walks to the origin.
// 'a player block stops the road': alert 'highway: ...' once, the job ends, the frontier stays, nothing dug.
// 'keeps the frontier': job.args.frontier follows the head after each segment.
// 'ends at length, and at the border': at length the job is done, at BORDER_K too.
// 'a shift ends at a place mayEndAt allows': 16 rails left, or lining out, or food out, or one pickaxe left: on to the next such place, ramp laid behind, rides home.
// 'the last pickaxe is for the ramp and the cart': with one pickaxe left no more cells are dug.
// 'a road shorter than the ramp is walked': head below FIRST_RAIL + RAMP_CELLS, both ways.
// 'no cart at the head walks home': the cart was lost: no ride, no failure.
// 'a warden or a shrieker near': no fight, walks back along the road, tries again after 5 minutes, stops after the second time.
assert.deepStrictEqual(VALIDATE.highway({dir: 'east'}), {dir: 'east'});
assert.throws(() => VALIDATE.highway({dir: 'up'}), /dir must be/);
```

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement.** Segments of 16 cells, one dip each. `inspect` before each, from `k` 8 on, because chamber and stair are the bot's own. `job.progress = "east: 1234 m, 0.4 m/s"`, which `/bots` and the dashboard show as they are. Per Task 1 step 3, a bot that logs in riding gets off first.

- [ ] **Step 4: Run it, then the whole suite.** `node test/roadjob.js`, `node test.js`. Expected: PASS, then `ok`.

- [ ] **Step 5: Live, 40 cells.** A scenario in the sky lab: a stone block with a cave, water and gravel in the way, a full load given over the console, `highway` with `origin` and `length: 40`. Passing `origin` also skips the chamber. Success: `checkCell` holds for all 40. The local instance is `~/.cache/bandit-bot-test/run-failmem.sh`, with its `cd` pointed at this worktree.
Expected: the table prints PASS. Also read the rate here: seconds per cell, for the load in Task 9.

- [ ] **Step 6: Commit** `git commit --no-gpg-sign -m "feat(highway): the highway job"`.

---

### Task 8: The origin

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/road.js`, `roadjob.js`, `bots.js` (`digRefusal` line 1564, `placeRefusal` line 1577), and both tests

**Interfaces:**
- Produces:
  - `originPlan(origin) -> {room: [cell], curbs: [cell], stair: [{air: [cell]}], top}`: pure. A room at `|x| <= 2`, `|z| <= 2`, `y 0..3`. Each road's curb at `k` 3, landing at `k` 4, first rail at `FIRST_RAIL`. A corridor from the room's north side at `x 2` to `z -5`, then a stair rising east along `z -5`, three air cells a step, to the surface.
  - `buildOrigin(r, job, road)`: claims `highway:origin` with `r.world.claim(r.name, key)`, so that only one bot builds it.
  - `r.mayBuild(p) -> boolean`, set by the job for as long as it runs and cleared in `finally`: true at `y <= 6` and on the stair's cells, which is the spec's exception to the protected box.

The crafting table and the chests the spec puts in the chamber come with the depot in stage 6: until then a bot carries its own table (`KEEP_RE`) and gets its load at the farms.

Why `z -5`: `inspect` looks 3 to each side of a road, so stair and lining stay out of the east road's view. For the north road, `inspect` starts at `k` 8 and never looks back. `-80,-144,80,80` is a protected area, and `digRefusal` and `placeRefusal` refuse everything inside it, so the first stretch of every road needs `mayBuild` too. Everything else about that box stays as it is.

- [ ] **Step 1: Write the failing test**

```js
// 'the stair has three air cells a step, and rises one a step'
// 'each road's first rail is at k 5, its curb at 3': for all four dirs
// 'no stair cell within 3 of a road beyond k 8'
// 'a player block on the stair's way stops the origin and reports it, digs nothing'
// 'the origin is built once': a second bot finds it claimed and waits, then finds it built
// 'the exception opens only its own cells': in the box with the job: y 6 and a stair cell allowed, y 7 refused. Without the job: all refused.
```

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement.** Check the stair's way along `z -5` against the copy of the world before building: if a player's block stands there, move the stair's `z` further north by one and say so in the commit.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** `git commit --no-gpg-sign -m "feat(highway): the chamber at the origin and the stair down"`.

---

### Task 9: A load from the farms

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/roadjob.js`, `test/roadjob.js`
- Modify: `hosts/bandit-lab/services/mcbots/app/config.js`, `bots.js` (`acquireWorld`, line 2864), `../default.nix`

**Interfaces:**
- Consumes: `getItem` from `bots.js` with `child(job, {type: 'get', args: {item, count}})`, which plans chests, crafts and mining by itself, but sees chests only within 256 blocks.
- Produces:
  - `parseFarms(text) -> [{x, y, z, items: [name]}]` in `road.js`, called in `config.js` as `parseHalls` is for `TRADE_HALLS`. `HIGHWAY_FARMS` in Nix as JSON, from the spec's table: iron `-296 -186` (also cobblestone) and `293 746`, sticks `-36 -97`, base `14 11` for rails, powered rails and bread. The heights, and where redstone and gold lie, come from `GET /api/chests`.
  - `LOAD = {rail: 1024, iron_pickaxe: 8, powered_rail: 48, redstone_torch: 48, minecart: 1, bread: 32, cobblestone: 128, iron_sword: 1}`: pure. This replaces the spec's 1,920 rails: 8 pickaxes do about 1 km of deepslate, so more rails would not get laid. Armour comes from `gearPlan` (`gear.js`) and is worn, so that `fit()` holds and the bot fights what comes through a cave. The cobblestone is there so that a cave right after the start does not end a shift. A first trip adds 48 powered rails and torches for the origin's ramp. All of it takes 30 to 32 of 36 slots.
  - `restock(r, job) -> 'ok' | 'waiting'`: for each item short, the nearest farm that lists it, walk there, `getItem`, next farm on failure. With all farms out: wait and report, as the spec says.

- [ ] **Step 1: Write the failing test**

```js
// 'fetches only what is short': holding 1000 rails, asks for 24.
// 'next farm when one is empty': first farm throws, second is asked.
// 'all empty waits and says so': alert 'highway: ...', 'waiting', no failure.
// 'crafts from what it fetched': through getItem, so rails need no list of their own.
// 'no source in a protected area': a chest inside r.protectedAreas, or a guest bot's, within 256 blocks: never in acquireWorld's stores for this job.
assert.throws(() => parseFarms('[{"x":1}]'), /HIGHWAY_FARMS/);
```

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Implement.** The filter in `acquireWorld` (`bots.js:2864`) applies to this job only: the others keep what they do today. `r.world.chests` knows a chest only once a bot has read it, so a farm with nothing known gets a `stock` over its chests first.

- [ ] **Step 4: Run it, then the whole suite.** Expected: PASS, then `ok`.

- [ ] **Step 5: Commit** `git commit --no-gpg-sign -m "feat(highway): a load from the farms"`.

---

### Task 10: 2 km east, and the stage's check

**Files:**
- Create: `tools/mcbots-railspeed/road-check.js`: `snapshot <dir> <length>` has `bot50`, in spectator, teleported along the road, write every cell within 3 of it at heights -3 to +4 to a file, and `diff` compares two such files. It uses `bot.blockAt`, because the console cannot name a block. `checkCell` and `inspect` work on what it reads.
- Modify: `docs/specs/2026-11-03-highway-bots-design.md` (stage 2 done), `docs/runbooks/minecraft/BOTS.md` (the job)

This task needs the owner four times, each time with the exact line. The bots' units on the lab are `docker-mcbots` (the hub) and `docker-mcbots-worker-2` (`bot2`).

- [ ] **Step 1: Before any bot digs.** `node tools/mcbots-railspeed/road-check.js snapshot east 2000`, then run `inspect` over it.
Expected: a list of every place the road would stop. If the mineshafts at 400, 1500 or 1600 stop it there, fix the list before the bot gets there, and tell the owner about what is not generated structure.

- [ ] **Step 2: Ask the owner to deploy.** A script as in `~/trader-deploy.sh`, then `sh ~/highway-deploy.sh` on the laptop `bandit`, fallback `lab-apply`. Then set `gamerule max_minecart_speed 200` over the sandbox console.
Expected: `bot2` runs the new code: `POST /api/job` with `{"bots": ["bot2"], "type": "highway", "args": {"dir": "east", "length": 2000}}` is accepted.

- [ ] **Step 3: Monsters on.** Tell the owner the sandbox goes back to `difficulty normal` for this run, then set it.

- [ ] **Step 4: Let it run**, with a background watcher that reports only the result.
Expected on the way: a load fetched, the chamber and stair built, about 0.3 to 0.6 m/s in rock.

- [ ] **Step 5: A death.** At about 500 m, `kill bot2` on the sandbox console.
Expected: respawn, grave fetched, back at the head, no gap in the road.

- [ ] **Step 6: A hub restart.** At about 1 km, the owner runs `sudo systemctl restart docker-mcbots` on `bandit-lab`.
Expected: the job resumes by itself at the head.

- [ ] **Step 7: A deploy.** At about 1.5 km, a real one: a fix the run has called for by then, or else a comment changed in `app/`, because a rebuild with nothing changed restarts nothing.
Expected: the same.

- [ ] **Step 8: A restart during a ride.** During a trip home, the owner runs `sudo systemctl restart docker-mcbots-worker-2` on `bandit-lab`.
Expected: Review Focus 4 live: the bot gets off, takes its cart, walks to the nearer end, carries on.

- [ ] **Step 9: Check the road.** `snapshot` again, then `diff` against step 1, and `checkCell` on every cell.
Expected: no cell with a problem, dead straight, and every changed cell was natural or generated before and is in the road's own list now.

- [ ] **Step 10: A bot rides it.** `bot2` rides the whole 2 km both ways, from the origin's ramp and the head's.
Expected: about 25 s a way, as in the runbook.

- [ ] **Step 11: Report to the owner**, with the rate, the time a load lasts and the time a trip costs, including what laying the ramp by walking back really takes, and commit.

```bash
git add tools/mcbots-railspeed/road-check.js docs
git commit --no-gpg-sign -m "docs(highway): stage 2 done, one road in the sandbox"
```

---

## Stages 3 to 7

Each gets its own short plan once the stage before it has passed, because the rate and the trip's cost from Task 10 set most of their numbers. What is known now:

**3. Four roads, sandbox.** `bot3`, `bot20`, `bot21` on the same job, 2 km each. New code:
- Guards: TPS below 15 for a minute pauses all roads, from the bots' own time packets; under 300 GB free stops them (`fs.statfs`); a client view distance for these bots.
- `GET /api/highway` and the dashboard card, with a saved frontier per road, so that a road the owner stopped starts again from where it was.
- The west stair: it has wall torches and more steps within 3 blocks, so excepting the one block is not enough. It takes two lists: a box at x -53..-47 whose blocks are seen and left alone, and `-49 1 0` as the only block the road may replace. Check that lining leaves the stair's half at z -1 walkable.
- The rule at z -1303: whether the road's cells hit a container there.
- Four riders on chunks far apart, which stage 1 did not measure.
- A grave far along a road: riding to it, because walking stops working after about 10 km.

**4. Main server, one worker.** Prerequisites from the spec: the combat bug fixed (awaiting a live check after today's trader fix), the live border read and `BORDER_K` taken from it, the game rule set to 200, `bot2` and `bot3` moved with `mcbots-worker-2`. The rule applies to every minecart in the world, as the owner accepted. Velocity restarts only if BotGate changes. The owner rides the first road: the world keeps up fully only at about rule 100 (runbook), so this is where a person decides whether 200 stays. View distance 10 there is not measured.

**5. Main server, all four.** `mcbots-worker-4` moves. A week within the guards.

**6. Suppliers.** The depot in the chamber; `highway-supply` as a job; `bot19` in the sandbox first; `EM_Trader` first on the main server, then `MisaBot` with its stop on MidariBread's arrival. Needs: `MisaBot`'s own things stay untouched, tested.

**7. Gold farm.** Less urgent than the design assumed: the ramps need 384 boosters out of 1,605. Waits for crossing dimensions in MisaBot v2 phase 2, and for finding out what the farm holds.
