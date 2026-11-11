# Bots Keep Working Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The bots stop clogging their inventories and the supply chest, stop dying twice at the same place, idle the tree farm while wood is plentiful, gain a repeatable archive report, lose the orphan mcagents code, and the church crew can start.

**Architecture:** Pure helpers (keep caps, hall caps, death spots, report summary) get unit tests; the job code in `bots.js`, `treefarm.js`, `graves.js` and `keeper.js` calls them. mcagents leaves bandit-nix first, then bandit-craft. The church start is an owner step after the deploy.

**Tech Stack:** Node 22, mineflayer 4.x, plain `node:assert` tests run by `app/test.js`; Nix flakes (bandit-craft, bandit-nix).

**Spec:** `docs/superpowers/specs/2026-11-11-bots-keep-working-design.md`

## Global Constraints

- App root: `hosts/bandit-lab/services/mcbots/app/` (paths below are relative to it unless they start with `tools/`, `ci/`, `docs/` or a repo name).
- Tests: `NODE_PATH=$(ls -dt /nix/store/*-mcbots-0.1.0/lib/node_modules/mcbots/node_modules | head -1) node test/<topic>.js`; the suite is `node test.js` with the same `NODE_PATH`. `test/goto-crafting.js:41` is a known timing flake under load; rerun alone.
- Never drop: logs, ores, raw metals, ingots, food, gear, anything outside the drop list. Drop list = `JUNK` (`bots.js:2212`) plus `wheat_seeds` and `*_sapling` (owner 2026-11-11).
- No dropping within 48 blocks (horizontal) of the supply chest.
- Guest bots (`GUEST_BOTS`: MisaBot, EM_Trader) keep their own-chest rules (`job.args.own` deposits are unchanged).
- Hall caps: cobblestone 6912, every other `JUNK` kind 1728, wheat_seeds 1728, saplings (all `*_sapling` together) 1728, logs (all `*_log`) 1728.
- Keep caps per bot: stick 64, each `*_planks` 64, coal+charcoal 64, torch 64, crafting_table 1, furnace 1, each tool name (`TOOL_RE`) 2.
- Death spots: radius 32 blocks, window 24 h, far-search avoid box 64 blocks around each spot.
- No Paper restart. Commit unsigned in worktrees; the owner signs and pushes. No full `nix flake check` in bandit-nix (laptop OOM): evaluate the lab toplevel instead.
- Comments in English, one line of why, with the incident and date, as the codebase does.

## Review Focus

1. A stale or empty chest index (`r.world.chests` empty after a restart) must keep, never toss: `surplus` returns 0 when totals are unknown. Test in Task 2.
2. A guest bot depositing into its own chest must not lose items to caps: own deposits ignore keep caps' tossing and hall caps. Test in Task 2.
3. A bot that died twice somewhere then gets an owner order there: the order still runs (only grave and resume are skipped). Test in Task 4.
4. The tree farm with logs over the cap must wait, not fail and not throw (so the order loop does not back off). Test in Task 3.
5. Report on a truncated or malformed `events.jsonl` line: skipped, counted as `bad`, never a crash. Test in Task 5.

---

### Task 1: Keep caps — sticks, planks and spare tools leave the bot

bot19 carried 448 sticks, 7 iron pickaxes and 3 crafting tables; every deposit kept them (`KEEP_RE`, `TOOL_RE`), and withdraws failed 1200 times with "inventory is full of things to keep".

**Files:**
- Modify: `bots.js` (junk() inside `JOBS.deposit`, ~3553; add `beyondKeep`, export it)
- Modify: `treefarm.js:215-219` (still full after a logs-only deposit: one plain deposit)
- Modify: `bots.js:3315-3318` (injected `deposit(r, job, only = 'logs')`)
- Test: `test/inventory.js` (new, add `'inventory'` to the list in `test.js`), `test/jobs/treefarm.js`

**Interfaces:**
- Produces: `beyondKeep(items: {name, count, type, metadata}[]) -> {name, count, type, metadata}[]` — the part of each kept kind above its keep cap (whole stacks first, then a partial count), in inventory order; items not in the keep rules are not returned.
- Produces: treefarm's injected `deposit(r, job, only)` where `only = null` means a plain deposit.

- [ ] **Step 1: Write the failing tests** in `test/inventory.js`:
```js
const {beyondKeep} = require('../bots');
const it = (name, count) => ({name, count, type: 1, metadata: 0});
assert.deepStrictEqual(beyondKeep([it('stick', 64), it('stick', 64), it('stick', 20)]).map((i) => [i.name, i.count]), [['stick', 64], ['stick', 20]]);
assert.deepStrictEqual(beyondKeep([it('iron_pickaxe', 1), it('iron_pickaxe', 1), it('iron_pickaxe', 1)]).map((i) => i.name), ['iron_pickaxe']);
assert.deepStrictEqual(beyondKeep([it('crafting_table', 3)]).map((i) => i.count), [2]);
assert.deepStrictEqual(beyondKeep([it('coal', 40), it('charcoal', 40)]).map((i) => [i.name, i.count]), [['charcoal', 16]]);
assert.deepStrictEqual(beyondKeep([it('oak_log', 64), it('bread', 64), it('torch', 64)]), []);
```
  In `test/jobs/treefarm.js`: a fake bot whose inventory stays at 3 free slots after the logs-only deposit gets a second `deposit(r, job, null)` call before the job throws; when the plain deposit frees slots, the job goes on (assert the call order `['logs', null]`).
- [ ] **Step 2: Run** `node test/inventory.js` and `node test/jobs.js` — Expected: FAIL (`beyondKeep is not a function`; treefarm throws after one deposit).
- [ ] **Step 3: Implement** `beyondKeep` in `bots.js` next to `KEEP_RE` with the Global Constraints keep caps (coal and charcoal share one cap; every `*_planks` name has its own). In `JOBS.deposit`, the non-own `junk()` adds `beyondKeep(kept items)` to what it files. In `treefarm.js`, after the logs-only deposit, if fewer than 4 slots are free, `await deposit(r, job, null)` once, then the existing throw.
- [ ] **Step 4: Run** both tests and `node test/autoempty.js test/materials.js` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(mcbots): spare sticks, planks and tools leave the bot on a deposit; treefarm empties more than logs`

### Task 2: Hall caps — surplus is dropped at the site, never pushed back into the supply chest

**Files:**
- Modify: `storage.js` (add `HALL_CAPS`, `hallTotals`, `surplus`; export)
- Modify: `bots.js` `JOBS.deposit` (toss step at the top; fallback ~3663; carry-out ~3634)
- Test: `test/inventory.js`

**Interfaces:**
- Consumes: `storage-layout.js` `SLOTS`, `keyOf`; `r.world.chests` (Map key -> `{items}`).
- Produces: `hallTotals(chests: Map) -> {name: count} | null` (null when no hall slot is indexed); `surplus(name, totals) -> number` (count above the kind's hall cap, 0 for kinds without a cap or `totals === null`; logs have a cap for the tree farm pause but are not droppable); `DROPPABLE(name) -> boolean` (`JUNK`, `wheat_seeds`, `*_sapling`; tossing needs `DROPPABLE` and `surplus > 0`).

- [ ] **Step 1: Write the failing tests** in `test/inventory.js`:
```js
const S = require('../storage');
const hall = new Map([['-263,58,-219', {items: {cobblestone: 7000, wheat_seeds: 2000}}]]);
const t = S.hallTotals(hall);
assert.strictEqual(S.surplus('cobblestone', t), 88);
assert.strictEqual(S.surplus('wheat_seeds', t), 272);
assert.strictEqual(S.surplus('oak_log', {oak_log: 2000, birch_log: 100}), 372, 'all logs are one kind (the tree farm pause reads it)');
assert.strictEqual(S.DROPPABLE('oak_log'), false, 'logs are never dropped');
assert.strictEqual(S.DROPPABLE('oak_sapling') && S.DROPPABLE('wheat_seeds') && S.DROPPABLE('cobblestone'), true);
assert.strictEqual(S.surplus('cobblestone', null), 0, 'no index: keep');
assert.strictEqual(S.hallTotals(new Map([['1,2,3', {items: {cobblestone: 9}}]])), null, 'chests outside the hall do not count');
```
  A deposit job test (fake bot 100 blocks from the chest, hall over cap, inventory `cobblestone x64, oak_log x10`) asserts `tossStack` was called for the cobblestone only; the same bot 20 blocks from the chest tosses nothing; an `own: true` deposit tosses nothing. A base-chest fallback test asserts over-cap cobblestone is not deposited back into the base chest (it stays with the bot) when the hall rejects it.
- [ ] **Step 2: Run** `node test/inventory.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** `HALL_CAPS` and the droppable rule as in Global Constraints; `hallTotals` sums `items` of chests whose key is a `SLOTS` key. In `JOBS.deposit` (non-own, the target is the base chest): if the bot is more than 48 blocks from the chest, toss each droppable stack while its kind's `surplus` is above 0 (reuse the `tossJunk` loop's guards: `jobWants`, `prefs.keep`, one pillar stack). The "rooms full" fallback filters `storeFor(...) === 'room'` and over-cap items out of what it puts back; the carry-out withdraws a stack only when the hall run (or misc) for its category has an indexed chest with `free > 0`.
- [ ] **Step 4: Run** `node test/inventory.js test/keeper.js test/jobs.js` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(mcbots): hall caps - surplus stone, seeds and saplings are dropped at the site, never put back in the supply chest`

### Task 3: Tree farm waits while the hall has enough logs

**Files:**
- Modify: `treefarm.js` (`makeTreeFarm` takes `enoughWood(r) -> number | 0`; the round start waits)
- Modify: `bots.js:3315` (inject `enoughWood: (r) => storage.surplus('oak_log', storage.hallTotals(r.world?.chests || new Map()))`; all `*_log` are one kind, Task 2)
- Test: `test/jobs/treefarm.js`

- [ ] **Step 1: Write the failing test:** with `enoughWood` returning 500, one loop pass sets `job.t.doing` to `enough wood in the hall, waiting` and calls neither `digAt` nor `deposit`; when it returns 0 the next pass chops as before. The job never throws for this.
- [ ] **Step 2: Run** `node test/jobs.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the check at the top of the `for (;;)` round (after `waitCalm`), waiting 60 s in 1 s `guard`ed sleeps, then `continue`.
- [ ] **Step 4: Run** `node test/jobs.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): the tree farm idles while the hall holds enough logs (owner 2026-11-11)`

### Task 4: Death spots — no second trip to where a bot died

**Files:**
- Modify: `graves.js:58` (`graveAfterDeath` takes `deaths: {x, z, t}[]`, `now`)
- Modify: `bots.js:742-761` (`this.deathSpots`; skip `resumeLater` and the grave on a repeat; one alert); `bots.js` far search call (~2572: pass avoid boxes with the protected areas)
- Modify: `keeper.js` (option `held: (name) => boolean`, consulted in `idle()`), `server.js` (pass `held: (n) => (orderRetryAt.get(n) || 0) > Date.now()`)
- Test: `test/stop-and-death.js`, `test/keeper.js`

**Interfaces:**
- Produces: `repeatDeath(deaths, pos, now) -> boolean` in `graves.js` (true when an earlier death within 32 blocks and 24 h exists); `deathAvoid(deaths, now) -> [x1, z1, x2, z2][]` (64-block boxes, same shape as `protectedAreas` entries).

- [ ] **Step 1: Write the failing tests:** two deaths 10 blocks apart within 24 h → `graveAfterDeath` returns null, the runner queues no grave, `resumeLater` is not called for the interrupted job, exactly one `alert` event matching `/2 deaths there/`; a death 100 blocks from the first → a grave as today; an owner order queued after the repeat still runs; `farHeading` with a death box on the north route picks another heading. Keeper: a bot with `held` true gets nothing.
- [ ] **Step 2: Run** `node test/stop-and-death.js test/keeper.js test/farsearch.js` — Expected: FAIL.
- [ ] **Step 3: Implement** with the Global Constraints values; `deathSpots` keeps entries of the last 24 h only.
- [ ] **Step 4: Run** the same three plus `node test/jobs.js` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(mcbots): a second death at the same place ends the grave trip and the resumed job (bot1 at the monument, 40 deaths)`

### Task 5: Archive report — the repeatable stress test

**Files:**
- Create: `tools/mcbots-report/report.js` (pure `summarize(lines, {days, now})` + CLI), `tools/mcbots-report/report.test.js`, `tools/mcbots-report/README.md`
- Modify: `docs/runbooks/minecraft/BOTS.md` (one paragraph: how to fetch `events.jsonl` and run the report before and after a deploy)

**Interfaces:**
- Produces: `summarize(lines: string[], {days = 4, now = Date.now()}) -> {bad, perBotDay: {bot: {day: {done, fail, death}}}, fails: [{bot, text, n}] (top 30, digits masked as #), deaths: [{bot, cell: 'x,z' (32-block grid), n}]}`; CLI `node tools/mcbots-report/report.js <events.jsonl>... [--days N]` prints it as plain text.

- [ ] **Step 1: Write the failing test** with six fixture lines (`{"server_session":"a","event":{...}}`): two identical fails with different numbers collapse to one entry `n: 2`; two deaths 10 blocks apart share a cell; a line `{"broken` counts `bad: 1`; an event older than `days` is ignored.
- [ ] **Step 2: Run** `node tools/mcbots-report/report.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `summarize` and the CLI (reads files line by line; no dependencies).
- [ ] **Step 4: Run** the test, then the CLI on the downloaded archive (`curl -s https://bandit-lab.tail7facc9.ts.net:8445/api/archive/events.jsonl > /tmp/ev.jsonl`) — Expected: PASS; output shows bot19's `goto ... No path` cluster at the top.
- [ ] **Step 5: Commit** `feat(tools): mcbots-report - fails, deaths and done per bot from the event archive`

### Task 6: Small fixes — shelter lid and refused light spots

**Files:**
- Modify: `bots.js` night shelter (~1245-1250): re-equip the lid item right before `placeBlock`, retry once if the held item is not a block
- Modify: `bots.js` `JOBS.light` (~3420-3440): a spot whose `placeBlock` the server refused goes into `r.refusedLight` (key -> until, 24 h) and is skipped while blocked
- Test: `test/highways-light-night.js`

- [ ] **Step 1: Write the failing test:** a light job whose fake `placeBlock` rejects with `Server refused to place torch` for one spot: a second run within 24 h does not call `placeBlock` for that spot.
- [ ] **Step 2: Run** `node test/highways-light-night.js` — Expected: FAIL.
- [ ] **Step 3: Implement** both changes.
- [ ] **Step 4: Run** the test and `node test/fighting-air.js` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(mcbots): shelter lid re-equips before placing; a refused light spot waits 24 h`

### Task 7: Remove mcagents (bandit-nix first, then bandit-craft)

**Files (bandit-nix, new worktree `~/src/bandit-nix-bots11` from `origin/main`):**
- Modify: `flake.nix:282` (drop the `mcagents-tests` inherit), `hosts/bandit-lab/default.nix:34` (drop `"${craft}/mcagents"`), its comment at :102

**Files (bandit-craft, this worktree):**
- Delete: `hosts/bandit-lab/services/mcagents/`, `tools/mcagents/`, `ci/mcagents-tests.nix`
- Modify: `flake.nix` (lines 23 and 44), `hosts/bandit-lab/services/ollama/default.nix` (drop `services.ollama-andy`, its model binding, then-unused args; keep the volume and tmpfiles rule if `llamacpp` still names `/var/lib/ollama-import`), `.github/workflows/ci.yml:15`, `AGENTS.md`, `README.md`, `docs/runbooks/minecraft/BOTS.md` mentions; mark `docs/runbooks/minecraft/AGENT-TRAINING.md` and `AGENT-HANDOFF.md` historical (first line), do not delete.

- [ ] **Step 1 (bandit-nix):** edit, then `nix eval --raw .#nixosConfigurations.bandit-lab.config.system.build.toplevel.drvPath` — Expected: a store path. Also with `--override-input bandit-craft git+file://$HOME/src/bandit-craft-bots11` after Step 3 — Expected: a store path.
- [ ] **Step 2 (bandit-nix): Commit** `chore(lab): stop importing the retired mcagents module` (unsigned; the owner signs).
- [ ] **Step 3 (bandit-craft):** delete and edit; `grep -rn mcagents --exclude-dir=node_modules .` shows only the historical docs and the spec/plan.
- [ ] **Step 4 (bandit-craft):** `nix fmt -- --check .` and `nix build .#checks.x86_64-linux.mcbots` (or the flake's mcbots check name) — Expected: PASS.
- [ ] **Step 5 (bandit-craft): Commit** `chore: remove the retired mcagents module, tools and CI check`
- [ ] **Step 6:** lab build with both: `nix build --no-link --override-input bandit-craft git+file://$HOME/src/bandit-craft-bots11 git+file://$HOME/src/bandit-nix-bots11#nixosConfigurations.bandit-lab.config.system.build.toplevel` — Expected: a store path.

### Task 8: Handoff — deploy, test, church start

**Files:**
- Create: `HANDOFF-2026-11-11-bots.md` at the worktree root (git-ignored is fine; not committed if the repo has no such files — then `docs/superpowers/handoffs/2026-11-11-bots.md`, committed)
- Create: `~/bots-deploy.sh` (set -e, self-removing; at most ~65 characters per line): push craft branch head to main, bandit-nix: rebase `~/src/bandit-nix-bots11` on `origin/main`, `nix flake update bandit-craft`, commit, `tools/ship-claude --deploy`, smoke check (`docker-mcbots` active, 8 bots online via `/api/debug`)
- Create: `~/kirche-start.sh X Y Z` (the store chest the owner placed near -108 24 180): one `produce` for bot2 into that chest, `schematic kirche-hauptplatz.litematic` origin -108 24 180 rotation 0 with `chests: [X Y Z]` for bot3, bot20, bot21, via `POST /api/job`
- Modify: the shared-memory note (`projects/bandit-craft`, create if missing) with the open tasks

- [ ] **Step 1:** run the full suite and the report before/after numbers; write the handoff in plain short German for the owner: what changed (5 lines), how to test (3 steps), how to merge (`sh ~/bots-deploy.sh`), the church step (place a chest, `sh ~/kirche-start.sh X Y Z`), the optional `ollama rm andy-4.2`, the parked list.
- [ ] **Step 2:** final review of the whole branch by the `architect` agent (Fable), fix what it finds.
- [ ] **Step 3: Commit** the handoff doc; report the two worktree paths to the owner.
