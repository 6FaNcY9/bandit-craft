# Castle Tree Farms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A treefarm job can hand in at its own chest (a depot chest at the castle), so bot1 runs a spruce farm at T1.

**Architecture:** The treefarm job takes an optional `chest {x,y,z}`. When it is set, that chest replaces `r.supplyChest` for:
- deposits;
- sapling and dirt withdrawals;
- the ground height y0;
- the pause. The pause reads that chest's stock through `storage.chestAbove` with a new `logs: 1728` quota, instead of the hall total.

Without `chest`, nothing changes.

**Tech Stack:** Node 22, mineflayer. Tests are plain `node:assert` scripts in `app/test/`.

**Spec:** `docs/superpowers/specs/2026-11-15-castle-tree-farms-design.md`

Paths below are relative to `hosts/bandit-lab/services/mcbots/app/` unless they start with `docs/`.

## Global Constraints

- A treefarm without `chest` behaves exactly as today:
  - `VALIDATE.treefarm` returns exactly `{x1,z1,x2,z2}`;
  - the supply chest and the hall pause are used;
  - the zone and menu jobs keep working.
- Keep the pause text `'enough wood in the hall, waiting'`.
- Stock is keyed by the exact chest half the job opens, so pass the same coordinates everywhere.
- T1 box: x -332..-319, z -55..-42.
- Chest quota: `logs: 1728`.
- Never commit secrets. Commit unsigned in this worktree; the owner signs, pushes and deploys.

## Review Focus

- **A farm chest whose y is far from the ground.** The scan only looks at chest y ±20; T1's ground is y 92..101. Pick a
  chest at y 110 or 111. Task 2 tests that y0 comes from the chest.
- **A bot that carries oak saplings plants oak in the spruce farm.** Send a plain deposit before the job (Task 4).
- **A farm chest nobody drains.** It fills up, and after hours the job fails with "chest full". This is accepted; the
  shortcut comment says so (Task 1).
- **A resumed job after a worker restart.** `job.args.chest` must survive, and it does because args are kept as
  validated. Task 2 tests the validated shape.
- **The menu "Baumfarm".** It sends no chest and must keep working. Task 2 keeps the existing deep-equal assertion.

---

### Task 1: Per-chest log quota

**Files:**
- Modify: `storage.js:55` (`CHEST_QUOTA`)
- Test: `test/inventory.js`

**Interfaces:**
- Produces: `storage.chestAbove('spruce_log', stocks, pos, now)` returns the number of logs (all woods together) in the
  chest at `pos` above 1728. It returns 0 when the reading is older than 30 minutes.

- [ ] **Step 1: Write the failing tests.** Add them after the existing `chestAbove`/`farmEnough` block, and leave line 20
  unchanged:

```js
{ // tree farm chest (castle T1): all logs one kind, quota 1728, stale reading = unknown
  const now = 1e12, pos = {x: 1, y: 110, z: 2}, at = (t) => new Map([['1,110,2', {items: {spruce_log: 1800, oak_log: 10}, t}]]);
  assert.strictEqual(S.chestAbove('spruce_log', at(now), pos, now), 82);
  assert.strictEqual(S.chestAbove('spruce_log', at(now - 31 * 60000), pos, now), 0, '31 minutes old');
}
```

- [ ] **Step 2: Run the test and see it fail.** Run `node test/inventory.js`. Expected: an AssertionError, 0 !== 82.
- [ ] **Step 3: Implement.** Add `logs: 1728` to `CHEST_QUOTA`, with the comment
  `// shortcut: a stale reading (30 min) lets one round in; a never-drained chest fails "chest full" after hours, haul surplus then`.
- [ ] **Step 4: Run the test and see it pass.** Run `node test/inventory.js`. Expected: no assertion error.

### Task 2: treefarm `chest` arg

**Files:**
- Modify: `bots.js:366` (`VALIDATE.treefarm`)
- Modify: `bots.js:3434-3438` (the `makeTreeFarm` wiring)
- Modify: `treefarm.js:190-216`
- Test: `test/jobs/treefarm.js`

**Interfaces:**
- Consumes: Task 1's `storage.chestAbove`.
- Produces: `VALIDATE.treefarm({x1,z1,x2,z2,chest:{x,y,z}})` returns `{x1,z1,x2,z2,chest:{x,y,z}}`, where `chest` goes
  through `xyz()`. The hook `enoughWood(r, job)` now receives the job.

- [ ] **Step 1: Write the failing tests** in `test/jobs/treefarm.js`:
  - Near line 8:
    ```js
    assert.deepStrictEqual(VALIDATE.treefarm({x1: 8, z1: 0, x2: 0, z2: 8, chest: {x: 1, y: 110, z: 2}}), {x1: 0, z1: 0, x2: 8, z2: 8, chest: {x: 1, y: 110, z: 2}}, 'farm chest kept');
    assert.throws(() => VALIDATE.treefarm({x1: 0, z1: 0, x2: 8, z2: 8, chest: {x: 1}}), 'chest needs x y z');
    ```
  - After the "needs the supply chest" case: a fake whose `job.args` is `{...small, chest: {x: -3, y: 65, z: -3}}`, with
    `r.supplyChest = null` and 9 oak saplings carried. It must plant 9 saplings, and `enoughWood` must be called with
    the job, e.g. `enoughWood: (r, j) => { seen = j.args.chest; return 0; }`, then
    `assert.deepStrictEqual(seen, {x: -3, y: 65, z: -3})`.

    `fake()` needs an `args` option for this (default `small`).
- [ ] **Step 2: Run the tests and see them fail.** Run `node test/jobs/treefarm.js`. Expected: the deep-equal fails
  (`chest` is dropped), or it fails with "needs the supply chest".
- [ ] **Step 3: Implement.**
  - `bots.js:366`:
    ```js
    treefarm: (a) => ({...treeFarmJob.farmBox(zoned(a)), ...(a.chest ? {chest: xyz(a.chest)} : {})})
    ```
    Update its comment: "logs go to the supply chest, or to `chest`".
  - `bots.js` wiring:
    ```js
    enoughWood: (r, job) => (job.args.chest ? storage.chestAbove('oak_log', r.world?.stocks, job.args.chest) : storage.surplus('oak_log', storage.hallTotals(r.world?.chests)))
    ```
    In `deposit` and `withdraw`, replace `...r.supplyChest` with `...(job.args.chest || r.supplyChest)`.
  - `treefarm.js`:
    - `const home = box.chest || r.supplyChest;`
    - the throw becomes `if (!home)`, with the same message;
    - `const y0 = home.y;`
    - `enoughWood(r, job)`.
- [ ] **Step 4: Run the tests and see them pass.** Run `node test/jobs/treefarm.js` and `node test/inventory.js`.
  Expected: no assertion error. (Run them with the `NODE_PATH` from the latest mcbots store path, as in the warehouse
  plan.)
- [ ] **Step 5: Commit.**
  ```bash
  git add hosts/bandit-lab/services/mcbots/app/{storage.js,bots.js,treefarm.js,test/inventory.js,test/jobs/treefarm.js}
  git commit -m "feat(mcbots): treefarm hands in at its own chest (castle spruce farm)"
  ```

### Task 3: Full check, map and spec

**Files:**
- Modify: `docs/superpowers/specs/2026-11-15-wizard-castle-design.md` (the plots table)
- Modify: the scratchpad map script `map/options.py` (not in the repo)

- [ ] **Step 1: Run the flake check.**
  ```bash
  nix build --no-link "git+file://$PWD?rev=$(git rev-parse HEAD)#checks.x86_64-linux.mcbots-tests"
  ```
  Expected: exit 0.
- [ ] **Step 2: Update the castle spec's plots table.** Add these rows:
  - T1 spruce farm: x -332..-319, z -55..-42.
  - T2: x -351..-338, z -55..-42 (reserved).
  - T3: x -305..-292, z -55..-42 (reserved).
  - M1: keep the air above it free up to y 140.

  Commit as `docs: castle plots T1-T3, M1 air`.
- [ ] **Step 3: Run `graphify update .`** if `graphify-out/` exists.
- [ ] **Step 4: Owner ships.** The owner pushes the branch, and the bandit-craft bump in bandit-nix follows the deploy
  memory. Give the owner one short command.

### Task 4: Live start (after deploy)

- [ ] **Step 1: Check the T1 box.** Read the voxels for x -332..-319, z -55..-42, y 90..115. Do this through a hub bot
  near the box.
  - Expected: natural blocks only.
  - Stop at an owner build. The map shows a grey patch around -330..-326 / -49..-45.
- [ ] **Step 2: Pick the farm chest.** Choose an empty depot chest half at y 110 or 111. Check that it is empty by RCON:
  `execute if data block X Y Z Items[0]` must fail.
- [ ] **Step 3: Stock the chest with saplings and dirt.**
  - Put the 10 spruce saplings in it: bot1 runs a `withdraw` from the supply chest, then a `deposit` at the farm chest.
  - Add 32 dirt from the depot.
- [ ] **Step 4: Start bot1.**
  - First a plain `deposit`, so bot1 carries no oak saplings.
  - Then `treefarm {x1:-332, z1:-55, x2:-319, z2:-42, chest:{X,Y,Z}}` with `replace: true`.
- [ ] **Step 5: Watch the first cycle.** Expected: the progress shows "N saplings planted". Check for:
  - no "could not reach" on the walk to the depot;
  - no oak planted;
  - shelter holes on the road at night.
- [ ] **Step 6: Update the memory note `projects/bandit-craft`** with the farm, the chest and the bot.
