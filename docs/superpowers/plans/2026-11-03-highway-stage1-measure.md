# Highway bots, stage 1: measure the surface. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure rail at each speed setting and spacing, and boats on blue ice, on the sandbox server, prove a bot can ride a cart, and give the owner a table to choose the road's surface from.

**Architecture:** A laptop tool in `tools/mcbots-railspeed/`, like `tools/mcbots-placetest`. It talks to the sandbox only through the dashboard's existing `POST /api/sandbox/console`, which can never reach the real server, so this stage needs no deploy and changes nothing on the main server. Rails are server-side, so an armour stand can ride for the sweep. Boats are simulated by the client, so only a real player can measure them.

**Tech Stack:** Node 22, `node:assert` tests next to the code as in `tools/mcbots-scenarios/run.test.js`, mineflayer from the `mcbots` package for the riding test.

**Spec:** `docs/specs/2026-11-03-highway-bots-design.md`, section "Surface: measured, then fixed" and stage 1.

## Global Constraints

- Console only through `https://bandit-lab.tail7facc9.ts.net:8445/api/sandbox/console` (`MCBOTS_URL` overrides), with header `Origin` set to that base URL. At most 64 commands per call, at most 1400 characters per command.
- Speed settings: 8, 20, 40, 72, 100, 150, 200, 400, 1000. The rule is `gamerule max_minecart_speed <n>`; the world value is 8 and is restored after every run.
- Read from the sandbox console on 2026-11-04: the rule is 8, the `minecart_improvements` feature pack is enabled, the border is 59999968 wide, no chunks are forced.
- Sweep lane at least 2 km. Ride lanes 5 km. All lanes in the air at `y 200` above generated land, east of the base, never touching the ground.
- Winner rule, from the spec: the highest speed a real client rides 5 km on generated chunks without a kick, derail or stop wins, even if materials slow the road's growth. A tie goes to the cheaper material.
- The laptop bot is `bot50`, password from `~/.local/state/mcbots/seed`, as in `tools/mcbots-placetest/placetest.js`.
- Commits unsigned in this worktree, ending with the `Co-Authored-By` line. The owner pushes.

## Review Focus

- A cart that derails at speed must be recorded as derailed, never as a fast run. Pinned in Task 1.
- A console reply in an unexpected format, or "No entity was found", must give a lost run, never a `NaN` speed. Pinned in Task 1.
- A lagging server must not look like a slow rail: speeds are per game tick, and each row carries its TPS. Pinned in Task 1.
- A sweep cut off by Ctrl-C or a network error must restore the game rule, free the forceloaded chunks and resume where it stopped. Pinned in Task 2.
- A long command list must be split to the console's limits, or the whole call is refused. Pinned in Task 1.

---

### Task 1: Rig commands and run analysis

**Files:**
- Create: `tools/mcbots-railspeed/rig.js`
- Test: `tools/mcbots-railspeed/rig.test.js`

**Interfaces:**
- Produces, all pure: `SPEEDS`, `SPACINGS` (`[2, 4, 8, 16, 38]`), `SWEEP_LANE` (`{x1: 300, x2: 2300, y: 200, z: 10}`), `railLane(lane) -> string[]`, `powerEvery(lane, spacing) -> string[]`, `launch(lane, tag = 'rs') -> string[]`, `iceLane(lane, width) -> string[]`, `setSpeed(n) -> string`, `clearLane(lane, tag = 'rs') -> string[]`, `batches(commands, max = 64) -> string[][]`, `parseSample(replies) -> {tick, x, y, z} | null`, `summarize(samples, lane) -> {top, sustained, tps, derailed, reachedEnd, lost}`, where a sample is `{tick, wall, x, y, z}` or `null`.

- [ ] **Step 1: Write the failing tests** in `rig.test.js`, with these assertions:

```js
const lane = {x1: 300, x2: 2300, y: 200, z: 10};
// Laying
assert.ok(railLane(lane).some((c) => c === 'forceload add 300 10 2300 10'));
assert.ok(railLane(lane).includes('fill 300 199 10 2300 199 10 stone'));
assert.ok(railLane(lane).includes('fill 300 200 10 2300 200 10 rail[shape=east_west]'));
assert.deepStrictEqual(powerEvery({...lane, x2: 340}, 38).slice(0, 2), ['setblock 300 199 10 redstone_block', 'setblock 300 200 10 powered_rail[shape=east_west,powered=true]']);
assert.strictEqual(setSpeed(100), 'gamerule max_minecart_speed 100');
// forceload refuses more than 256 chunks in one command, and a 5 km lane is more
const spans = railLane({x1: 300, x2: 5300, y: 200, z: 40}).filter((c) => c.startsWith('forceload add')).map((c) => c.split(' ').map(Number));
assert.ok(spans.length > 1 && spans.every((s) => Math.floor(s[4] / 16) - Math.floor(s[2] / 16) + 1 <= 256));
assert.strictEqual(spans[0][2], 300);
assert.strictEqual(spans.at(-1)[4], 5300);
// Limits of the console
assert.ok(batches(Array(130).fill('x')).every((b) => b.length <= 64));
assert.strictEqual(batches(Array(130).fill('x')).flat().length, 130);
// Parsing
assert.deepStrictEqual(parseSample(['The time is 1000', 'Minecart has the following entity data: [301.5d, 200.0d, 10.5d]']), {tick: 1000, x: 301.5, y: 200, z: 10.5});
assert.strictEqual(parseSample(['The time is 1000', 'No entity was found']), null);
assert.strictEqual(parseSample(['weird', 'reply']), null);
// Analysis: speed is per game tick, so a lagging server does not read as a slow rail
const run = (speed, n, t0 = 0, msPerTick = 50) => Array.from({length: n}, (_, i) => ({tick: 20 * i, wall: t0 + i * 20 * msPerTick, x: 300 + speed * i, y: 200, z: 10.5}));
assert.strictEqual(summarize(run(40, 30), lane).sustained, 40);
assert.strictEqual(summarize(run(40, 30, 0, 100), lane).sustained, 40, 'half speed server, same rail');
assert.strictEqual(Math.round(summarize(run(40, 30, 0, 100), lane).tps), 10);
// Off the rail is a derail, gone is lost; neither is a speed
const off = run(40, 10); off[9] = {...off[9], y: 180};
assert.strictEqual(summarize(off, lane).derailed, true);
const gone = [...run(40, 5), null];
assert.strictEqual(summarize(gone, lane).lost, true);
assert.strictEqual(summarize(run(40, 60), lane).reachedEnd, true);
```

- [ ] **Step 2: Run it and see it fail**

Run: `node tools/mcbots-railspeed/rig.test.js`
Expected: FAIL, "Cannot find module './rig'".

- [ ] **Step 3: Implement `rig.js`** with the interfaces above.

`railLane` forceloads the lane in spans of at most 256 chunks, then lays stone at `y - 1` and rail at `y`. `powerEvery` puts a redstone block under a powered rail at `x1`, `x1 + spacing`, and so on, redstone block first, so the rail is powered when placed. `iceLane(lane, width)`: width 2 lays blue ice at `z` and `z + 1` at `y - 1` with stone-brick walls two high at `z - 1` and `z + 2`; width 1 lays one column at `z`, with air gaps at `z - 1` and `z + 1` and walls at `z - 2` and `z + 2`. `launch` first kills the tag, then summons a minecart at `x1 + 1` with `Tags`, `Motion:[1.0,0.0,0.0]` and an armour stand passenger, because an occupied cart brakes less than an empty one. `summarize` takes speed from pairs of samples at least 20 ticks apart: `top` is the highest, `sustained` the median over the last third. `tps` comes from ticks against `wall`. A null sample before `reachedEnd` sets `lost`. `y` more than 1.5 or `z` more than 1 from the lane sets `derailed`.

- [ ] **Step 4: Run it and see it pass**

Run: `node tools/mcbots-railspeed/rig.test.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/mcbots-railspeed/rig.js tools/mcbots-railspeed/rig.test.js
git commit --no-gpg-sign -m "feat(railspeed): rig commands and run analysis for the highway measurement"
```

### Task 2: Sweep and tracking, with one live calibration run

**Files:**
- Create: `tools/mcbots-railspeed/run.js`
- Test: `tools/mcbots-railspeed/run.test.js`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `sweep({call, out, now, sleep, done = new Set(), speeds = SPEEDS, spacings = SPACINGS}) -> Promise<void>`, where `call(commands) -> Promise<string[]>`, and `track({call, player, ms, out, now, sleep}) -> Promise<summary>`. CLI: `node run.js sweep [--speed n --spacing n]`, `node run.js track <player> [seconds]`, `node run.js rig rail <speed> <spacing>`, `node run.js rig ice2`, `node run.js rig ice1`.

- [ ] **Step 1: Write the failing tests** in `run.test.js` with a fake `call` that records commands and answers samples:

```js
// A row already in the results file is skipped, so a cut-off sweep resumes
const a = fake(); await sweep({...a.deps, done: new Set(['8/38']), speeds: [8], spacings: [38]});
assert.strictEqual(a.rows.length, 0);
// Each row is one JSON line with its setting and analysis
const b = fake(); await sweep({...b.deps, speeds: [8], spacings: [38]});
assert.deepStrictEqual(Object.keys(b.rows[0]).slice(0, 2), ['speed', 'spacing']);
// However it ends, the rule goes back and the chunks are freed
const c = fake({failAfter: 3}); await assert.rejects(sweep({...c.deps, speeds: [100], spacings: [2]}));
assert.ok(c.sent.includes('gamerule max_minecart_speed 8'));
assert.ok(c.sent.some((s) => s.startsWith('forceload remove 300 10 2300 10')));
// Every console call stays inside the limits
assert.ok(b.calls.every((cmds) => cmds.length <= 64 && cmds.every((s) => s.length <= 1400)));
// track reads the player's position, and a run with no reply is lost
const d = fake(); const s = await track({...d.deps, player: 'owner', ms: 2000});
assert.ok(d.sent.some((x) => x === 'data get entity owner Pos'));
assert.ok(typeof s.top === 'number' || s.lost === true);
```

- [ ] **Step 2: Run it and see it fail**

Run: `node tools/mcbots-railspeed/run.test.js`
Expected: FAIL, "Cannot find module './run'".

- [ ] **Step 3: Implement `run.js`**

`call` posts to the console as `tools/mcbots-placetest/placetest.js` does. Sampling sends `time query gametime` and `data get entity @e[tag=rs,limit=1] Pos` in one call, every 500 ms. A run ends at `reachedEnd`, derail, lost, or after 150 s. A timeout is still a valid row: at 8 m/s a cart covers only 1200 m in that time. Results append to `~/.local/state/mcbots/railspeed.jsonl`, and the CLI loads `done` from it. `sweep` uses `try`/`finally` for the rule and `clearLane`. It only re-lays rail when the spacing changes.

After `forceload add`, wait until `execute if loaded` passes at both lane ends before the first `fill`, because `fill` refuses unloaded chunks. The CLI's `sleep` rejects after SIGINT, so Ctrl-C takes the same `finally` path as a network error; if the restore call fails too, print the commands to run by hand. `rig` frees its forced chunks once the lane is built, so a rider has to load them as on a real road. The sweep keeps them forced, because an armour stand loads nothing.

- [ ] **Step 4: Run the tests**

Run: `node tools/mcbots-railspeed/rig.test.js && node tools/mcbots-railspeed/run.test.js`
Expected: exit 0.

- [ ] **Step 5: Calibrate live, one run, in the sandbox**

Run: `node tools/mcbots-railspeed/run.js sweep --speed 8 --spacing 38`
Expected: one row with `sustained` between 7 and 8.5 (the wiki's 7.97 m/s at this spacing), `derailed: false`, `lost: false`, TPS near 20. If the rule's name or the summon format is refused, fix `rig.js` and its test from the console's real reply, and record the reply in the commit message.

- [ ] **Step 6: Commit**

```bash
git add tools/mcbots-railspeed/run.js tools/mcbots-railspeed/run.test.js tools/mcbots-railspeed/rig.js tools/mcbots-railspeed/rig.test.js
git commit --no-gpg-sign -m "feat(railspeed): sweep and tracking over the sandbox console"
```

### Task 3: Full sweep and the rail table

**Files:**
- Create: `docs/runbooks/minecraft/highway-measurements.md`

**Interfaces:**
- Consumes: `node tools/mcbots-railspeed/run.js sweep`.
- Produces: the rail table the owner reads in Task 5.

- [ ] **Step 1: Run the sweep in the background**

Run: `node tools/mcbots-railspeed/run.js sweep` (45 rows, at most 150 s each, under two hours).
Expected: 45 lines in `~/.local/state/mcbots/railspeed.jsonl`.

- [ ] **Step 2: Check that the numbers can be believed**

For each row: TPS at least 18, otherwise re-run it. `sustained` must not fall when the spacing gets denser at the same setting, by more than 2 m/s; look at the row if it does. The rule must really be the limit: at the top of the table, `sustained` either stays under the setting, or the row says why not.

- [ ] **Step 3: Write the table**

One row per setting at its best spacing: setting, sustained m/s, top m/s, spacing, derails, and material per km (rails, powered rails, gold, iron, redstone). Plus one line for the reach that gold allows at each spacing: 846 powered rails in stock, 759 ingots more. German is not needed: this is a runbook.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/minecraft/highway-measurements.md
git commit --no-gpg-sign -m "docs(highway): measured rail speeds in the sandbox"
```

### Task 4: A bot boards and rides a cart

**Files:**
- Create: `tools/mcbots-railspeed/ride.js`

**Interfaces:**
- Consumes: `railLane`, `powerEvery`, `setSpeed`, `batches` from Task 1, and the console `call` from Task 2.
- Produces: the facts stage 2's `ride` code needs: whether `bot.mount`, `bot.moveVehicle` and `bot.dismount` work on Paper 26.2, whether `bot.entity.position` follows the cart, and how a bot's connection copes at speed.

This is a live test with a real server and no fake can stand in for it, so it has no unit test. It is a throwaway proof in the style of `placetest.js`.

- [ ] **Step 1: Write `ride.js`.** It connects `bot50` with the same `createBot` options as `placetest.js` (`fakeHost: 'sandbox.bots'`), lays a 2 km lane at `z 30` with the best setting from Task 3, teleports the bot beside the start over the console, summons a cart on the rail, and calls `bot.mount(cart)`. Once on `mount` it calls `bot.moveVehicle(0, 1)` and logs `bot.vehicle.position` and `bot.entity.position` every 500 ms. At the lane's end it calls `bot.dismount()`, then prints one JSON line: `{mounted, moved, top, followed, dismounted, kicked, stationaryStart}`. `stationaryStart` tests whether the bot's input alone starts a cart that stands on a powered rail. Cleanup in `finally`.

- [ ] **Step 2: Run it**

Run: `NODE_PATH=<mcbots node_modules, see BOTS.md> node tools/mcbots-railspeed/ride.js`
Expected: `mounted`, `moved` and `dismounted` true, `kicked` false. If `bot.entity.position` does not follow, record that: stage 2 must read `bot.vehicle.position` and resynchronise after dismounting.

- [ ] **Step 3: Add the result to `highway-measurements.md` and commit**

```bash
git add tools/mcbots-railspeed/ride.js docs/runbooks/minecraft/highway-measurements.md
git commit --no-gpg-sign -m "test(railspeed): a bot boards, rides and leaves a cart on the sandbox"
```

### Task 5: The owner rides, and the surface is chosen

**Files:**
- Modify: `docs/runbooks/minecraft/highway-measurements.md`
- Modify: `docs/specs/2026-11-03-highway-bots-design.md` (surface decision, and cross-section if blue ice wins)

**Interfaces:**
- Consumes: `node run.js rig ...`, `node run.js track <player>`.
- Produces: the decision that stage 2's plan starts from.

- [ ] **Step 1: Build the ride lanes**

Run: `node tools/mcbots-railspeed/run.js rig rail <best setting> <best spacing>` and `rig ice2`, `rig ice1`. 5 km each at `y 200`, `z 40`, `z 50` and `z 60`, from x 300.
Expected: `execute if block` checks at the far end of each lane pass while the chunks are still forced, and `forceload query` lists none afterwards. The chunks stay generated.

- [ ] **Step 2: Give the owner the exact steps**

Numbered, with host and time: on Velocity `/server sandbox`, then the coordinates, the gear (given over the sandbox console), and which lane to ride first. While the owner rides, run `node run.js track <player>` on the laptop for each lane.
Expected: per lane a row with `top`, `sustained`, and the owner's verdict: kicks, stops at chunk borders, whether it is rideable. If a rail ride fails, lower the rule to the next setting in the table and ride again. The rule applies at once; only a different spacing needs `rig rail` again.

- [ ] **Step 3: Apply the winner rule, and hand over the table**

The winner rule from Global Constraints decides. Give the owner the table, the winner and the gold reach.

- [ ] **Step 4: Clean up the sandbox and record the decision**

Remove the lanes with `fill ... air`, free the chunks, put the rule back to 8. Write the decision into the design.

```bash
git add docs/runbooks/minecraft/highway-measurements.md docs/specs/2026-11-03-highway-bots-design.md
git commit --no-gpg-sign -m "docs(highway): surface chosen from the owner's ride"
```

---

## After this plan

Stages 2 to 7 of the design get their own plan once the surface is chosen, because the cross-section, the materials, the `highway` job's segment loop and the riding code all depend on this stage's numbers. If blue ice wins, the design goes back to the owner first: it then needs a Silk Touch source and iceberg mining.
