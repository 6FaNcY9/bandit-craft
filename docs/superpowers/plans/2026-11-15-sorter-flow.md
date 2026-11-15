# Sorter Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tree-farm surplus above the depot quota goes by itself into the sorter inbox, one kind per slice, never into a full slice.

**Architecture:** Pure helpers in `storage.js` decide (slice table, room in a slice, how much to haul); the tree farm
calls one new injected step `haulSurplus` before it would wait for "enough wood"; `bots.js` wires that step to the
existing `stock`, `withdraw` and `deposit` jobs. Live steps (reach, haul by hand, T2's own chest) bracket the code.

**Tech Stack:** Node (mcbots app), plain `assert` tests run by `app/test.js`, flake check `mcbots-tests`.

**Spec:** `docs/superpowers/specs/2026-11-15-sorter-flow-design.md`

## Global Constraints

- Inbox: loose items into -307 117 12 (double chest -308/-307 117 12). Never an NBT write into the buffer -303 124 22.
- Slice of a kind = z; its top chest -308 120 z is the 80 % mark; feed a kind only while that reading is fresh and empty.
- Full stacks only (64), at most 640 per haul (10 stacks; the inbox buffers 54).
- Reading older than `STOCK_TTL_MS` (30 min) is unknown = no room.
- Slices set live so far: oak_log 25, birch_log 44, spruce_log 47. z 24 stays all shears.
- The depot stays the builders' store; quota `CHEST_QUOTA.logs` 1728 at the farm's own chest.

## Review Focus

- Mixed logs in one farm chest (spruce + birch, shared `logs` quota): haul the kind with a slice and the most stacks, never more than that kind holds → test in Task 2 (`haulCount` with 1800 spruce + 10 oak).
- No reading of the slice's top chest yet (fresh farm, new slice) → no room, no haul → test in Task 2.
- The top chest has items (slice ≥ 80 %) → the farm waits as before, and does not walk to the sorter every round (30 min back-off) → test in Task 3.
- A kind without a slice (e.g. `jungle_log`) → never hauled → test in Task 2.
- `haulSurplus` throws (inbox unreachable) → the farm keeps farming, the error is reported, back-off applies → test in Task 3.

---

### Task 1: Live reach and hand haul (no code)

**Files:** none (scratchpad scripts only).

- [x] **Step 1:** samples spruce_log → -297 122 47 slot 26, birch_log → -297 122 44 slot 26 (done 2026-11-15 09:42).
- [x] **Step 2:** inbox proof: 48 birch_log into -307 117 12 → 48 in -308 116 44 within 1 min (PASS 09:44).
- [x] **Step 3:** (PASS 09:47, both read) `stock` jobs by bot21 on -308 116 47 and -308 120 47. Expect both `job finished`. If "could not reach": build the
  gallery piece (Step 4); else skip Step 4.
- [x] **Step 4 (only if Step 3 fails, skipped: not needed):** `build` job, platform x -311..-309 y115 z10..13 of `cobbled_deepslate` plus a 1-wide
  stair at x -311 z5..9 (each step on a pillar to the ground); bee nest -309 114 12 stays.
- [x] **Step 5:** (PASS 09:52, 104 birch in -308 116 44, inbox reached without the platform) hand haul: bot21 `withdraw {item:"birch_log",count:56,x:-303,y:110,z:7}` then
  `deposit {x:-307,y:117,z:12,only:"birch_log"}`. Expect the deposit job finished and, after the cart, 56 more birch in
  -308 116 44 (104 total). If the deposit cannot reach the inbox, do Step 4 and repeat.

### Task 2: Pure sorter helpers in `storage.js`

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/storage.js:55-69`
- Test: `hosts/bandit-lab/services/mcbots/app/test/inventory.js` (next to the "tree farm chest (castle T1)" block)

**Interfaces:**
- Produces: `SORTER = {inbox: {x:-307,y:117,z:12}, slices: {oak_log:25, birch_log:44, spruce_log:47}, top: (z) => ({x:-308,y:120,z})}`;
  `sorterRoom(name, stocks, now = Date.now()) -> boolean`; `haulCount(name, stocks, pos, now = Date.now()) -> number`
  (multiple of 64, 0..640). All exported.

- [ ] **Step 1: Write the failing test**

```js
{ // sorter (2026-11-15-sorter-flow-design.md): room = fresh empty top chest; haul = full stacks of one kind above quota
  const now = 1e12, top = (items, t = now) => new Map([['-308,120,47', {items, t}]]);
  assert.strictEqual(S.sorterRoom('spruce_log', top({}), now), true);
  assert.strictEqual(S.sorterRoom('spruce_log', top({spruce_log: 64}), now), false, 'slice at 80 %');
  assert.strictEqual(S.sorterRoom('spruce_log', top({}, now - 31 * 60000), now), false, 'stale = unknown');
  assert.strictEqual(S.sorterRoom('spruce_log', new Map(), now), false, 'never read');
  assert.strictEqual(S.sorterRoom('jungle_log', top({}), now), false, 'no slice');
  const pos = {x: 1, y: 110, z: 2}, at = (items) => new Map([['1,110,2', {items, t: now}]]);
  assert.strictEqual(S.haulCount('spruce_log', at({spruce_log: 1800, oak_log: 10}), pos, now), 64, '82 above quota -> 1 stack');
  assert.strictEqual(S.haulCount('spruce_log', at({spruce_log: 3000}), pos, now), 640, 'at most 10 stacks');
  assert.strictEqual(S.haulCount('oak_log', at({spruce_log: 1800, oak_log: 10}), pos, now), 0, 'only 10 oak: no full stack');
  assert.strictEqual(S.haulCount('jungle_log', at({jungle_log: 3000}), pos, now), 0, 'no slice');
  assert.strictEqual(S.haulCount('spruce_log', at({spruce_log: 1728}), pos, now), 0, 'at quota');
}
```

- [ ] **Step 2:** `node test/inventory.js` → FAIL (`S.sorterRoom is not a function`).
- [ ] **Step 3:** implement in `storage.js`: `sorterRoom` reads `stocks.get('-308,120,'+z)`, true only when fresh
  (`now - t <= STOCK_TTL_MS`) and no item count > 0; `haulCount` = `min(640, floor(min(chestAbove(name,...), count of
  that exact name in the chest) / 64) * 64)`, 0 without a slice. One comment line naming the design doc.
- [ ] **Step 4:** `node test/inventory.js` → PASS.
- [ ] **Step 5:** commit `feat(mcbots): sorter slice table, room and haul count`.

### Task 3: Tree farm hauls its surplus to the sorter

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/treefarm.js:136` (deps) and `:210-214` (the "enough wood" wait)
- Modify: `hosts/bandit-lab/services/mcbots/app/bots.js:3434-3439` (makeTreeFarm wiring)
- Test: `hosts/bandit-lab/services/mcbots/app/test/jobs/treefarm.js` (next to "the hall holds enough logs")

**Interfaces:**
- Consumes: Task 2 `SORTER`, `sorterRoom`, `haulCount`.
- Produces: `makeTreeFarm({..., haulSurplus = async () => false})`; `haulSurplus(r, job) -> Promise<boolean>` (true = hauled,
  loop again; false = wait as before).

- [ ] **Step 1: Write the failing test** (extend `fake()` with an optional `haulSurplus` passed into `makeTreeFarm`):

```js
// over quota and the sorter has room: haul instead of waiting, then farm on
let hauls = 0, wood2 = 500;
f = fake({world: w, inv: [{name: 'oak_sapling', count: 9, type: 1}], stopAfterSleeps: 100,
  enoughWood: () => { const n = wood2; wood2 = 0; return n; }, haulSurplus: async () => (++hauls, true)});
await assert.rejects(f.run(), Cancelled);
assert.strictEqual(hauls, 1, 'one haul');
assert.strictEqual(f.calls.dig.length, 36, 'farmed after the haul');
// haul throws: reported, the farm waits as before and does not fail
f = fake({world: w, inv: [{name: 'oak_sapling', count: 9, type: 1}], enoughWood: () => 500, haulSurplus: async () => { throw new Error('could not reach'); }});
await assert.rejects(f.run(), Cancelled);
assert.strictEqual(f.job.t.doing, 'enough wood in the hall, waiting');
assert.ok(f.events.some((e) => /sorter: could not reach/.test(e)), 'error reported');
```

- [ ] **Step 2:** `node test/jobs/treefarm.js` → FAIL (`hauls` 0).
- [ ] **Step 3:** in `treefarm.js`, inside `if (enoughWood(r, job) > 0)`: `try { if (await haulSurplus(r, job)) continue; }
  catch (e) { guard(job); r.emit('info', 'treefarm: sorter: ' + e.message); }` before the existing wait.
- [ ] **Step 4:** in `bots.js` wiring add `haulSurplus`: no `job.args.chest` → false; skip while `job.t.sorterUntil > Date.now()`;
  pick the kind in the chest reading with a slice and the largest count; `n = storage.haulCount(...)`; `n === 0` → false;
  `JOBS.stock` the slice's top chest; `!storage.sorterRoom(...)` → `job.t.sorterUntil = Date.now() + 30 * 60000`, false;
  else `withdraw(r, job, kind, n)` then `JOBS.deposit` to `{...storage.SORTER.inbox, only: kind}`, true. Set the back-off
  also when it throws (in a `finally` on failure).
- [ ] **Step 5:** `node test/jobs/treefarm.js` and `node test/inventory.js` → PASS; commit
  `feat(mcbots): tree farms haul their surplus into the sorter inbox`; then the flake check
  `nix build --no-link "git+file://$PWD?rev=$(git rev-parse HEAD)#checks.x86_64-linux.mcbots-tests"` → exit 0.

### Task 4: T2 own chest, ship, live check

**Files:** `~/sorter-flow-deploy.sh` (owner runs it), memory/board notes.

- [x] **Step 1:** (done: T2 chest -299 112 6) pick an empty depot double chest for T2 (`execute if data block <p> Items[]` fails on both halves); re-post
  bot19 `treefarm -351 -55 -338 -42` with `chest` = it. Expect `job started ... at <p>`.
- [ ] **Step 2:** rebase on origin/main, flake check, write `~/sorter-flow-deploy.sh` (push, craft-bump, ship-claude --deploy);
  owner runs it in a normal terminal.
- [ ] **Step 3:** live: when -299 111 6 holds > 1792 logs of one kind, the farm bot hauls full stacks to the inbox and the
  slice chest fills; with an item in -308 120 47 it waits instead. Read the hub events for `deposit ... at -307 117 12`.
