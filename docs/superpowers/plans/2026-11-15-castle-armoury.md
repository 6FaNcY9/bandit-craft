# Thralls' Armoury Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every castle bot keeps a full iron set by taking and handing back gear at a new armoury (castle A3b), restocked from the base chest, with the beds moved into Barracks 1 (A3a).

**Architecture:** A new place kind `armoury` gives every runner a second point, `r.gearChest`, next to `r.supplyChest`. All gear and food trips use `gearPoint(r)` (armoury, else the supply chest); the supply chest stays the material store. The keeper gets one extra target (the armoury chest) filled from the base chest. Two castle modules (armoury, barracks) are generated like the warehouse.

**Tech Stack:** Node (CommonJS), mineflayer, the repo's own test runner (`app/test.js`, parts in `app/test/`), litematic writer `app/litematic-write.js`, Nix flake checks.

**Spec:** `docs/superpowers/specs/2026-11-15-castle-armoury-design.md` (part of `2026-11-15-wizard-castle-design.md`).

All paths below are relative to `hosts/bandit-lab/services/mcbots/` unless they start with `docs/`.

## Global Constraints

- Full set: `iron_helmet`, `iron_chestplate`, `iron_leggings`, `iron_boots`, `iron_sword`, `iron_pickaxe`, `iron_axe`, `shield`; 33 ingots (axe 3).
- Keep on a bot at the armoury: 1 sword, 1 axe, 2 pickaxes, 1 shield, the worn armour; wooden and stone tools of a kind go back once an iron or better one of that kind is held.
- Never: replace a worn piece by a worse one, melt or drop gear, hand back the best piece of a kind.
- Armoury A3b: x -323..-315, z -30..-20, floorY 104; schematic origin world -323 104 -30, size 9 x 8 x 11; doorway x -315, y 105..106, z -25.
- Gear point (the Iron double chest) -322 105 -26 and -25. Sets -322 105 -29/-28; Arms -322 105 -23/-22; Larder -320/-319 105 -29; Hand-back -321/-320 105 -21; crafting table -317 105 -21; furnace -316 105 -21. All within 6 blocks of the gear point.
- Barracks A3a: x -333..-325, z -30..-20, floorY 104, h 7; the owner's bots' beds.
- Guests: only bots named in `GEAR_GUESTS` (MisaBot) get the gear point, only within 250 blocks of it, and never hand back. EM_Trader never.
- Without an `armoury` place, or when the armoury lacks an item, behaviour is exactly today's (supply chest).
- Stock at the armoury: 2 of each set item; `iron_ingot` 64, `bread` 64, `torch` 32, `logs` 16. Taken from the base chest only.
- Palette: cobblestone, deepslate_bricks, cobbled_deepslate, polished_deepslate, deepslate_tiles, stone_bricks, glass, lantern. Chests, table and furnace are placed by RCON `setblock`, not by the schematic.
- Repo rules (AGENTS.md): commit unsigned in this worktree; the owner pushes and deploys; no bot orders, RCON or deploys from this plan's tasks.

## Review Focus

1. Armoury place set, but its chests never counted or empty: bots must still get gear from the base chest, not stall (Task 4, `gearSources` test).
2. The armoury marker is removed or moved on the dashboard: `gearChest` follows or becomes null, and the death rearm goes to the supply chest (Task 3 hub/places test).
3. One worker carrying both MisaBot and EM_Trader: only MisaBot gets the gear point (Task 3 hub test).
4. A bot holding a diamond pickaxe and two iron ones: the hand-back returns one iron pickaxe and keeps the diamond (Task 2 `handBack` test).
5. Hand-back into a full chest: the visit still ends with the equip step and a progress line, no throw (Task 2 rearm test).

---

### Task 1: Iron axe in the gear plan

**Files:**
- Modify: `app/gear.js` (`COST`, `OWNED`)
- Test: `app/test/keeper.js` (gear asserts near line 189)

**Interfaces:**
- Produces: `gearPlan(ingots, owned)` and `ingotsWanted(owned)` now include `iron_axe`, last in order.

- [ ] **Step 1: Write the failing asserts** in `app/test/keeper.js` after the existing `gearPlan` asserts:

```js
assert.strictEqual(ingotsWanted([]), 33, 'full set with the axe');
assert.strictEqual(gearPlan(Infinity, []).at(-1), 'iron_axe', 'the axe comes last');
assert.ok(gearPlan(Infinity, ['wooden_axe', 'stone_axe']).includes('iron_axe'), 'wood and stone axes do not count');
assert.ok(!gearPlan(Infinity, ['diamond_axe']).includes('iron_axe'));
assert.ok(!gearPlan(Infinity, ['iron_pickaxe']).includes('iron_pickaxe') && gearPlan(Infinity, ['iron_pickaxe']).includes('iron_axe'), 'a pickaxe is not an axe');
```

Update any existing assert that expects 30 for a full set.

- [ ] **Step 2: Run** `node app/test/keeper.js` → FAIL on the 33 assert.
- [ ] **Step 3: Implement:** add `iron_axe: 3` as the last `COST` entry; `OWNED` treats `axe` like `pickaxe|sword` (`^(iron|diamond|netherite)_axe$`).
- [ ] **Step 4: Run** `node app/test/keeper.js` → `keeper` part passes.
- [ ] **Step 5: Commit** `feat(mcbots): iron axe belongs to the gear set`

### Task 2: Hand-back at the armoury

**Files:**
- Modify: `app/gear.js` (new `handBack`), `app/bots.js` (`JOBS.rearm`, end of the chest loop)
- Test: `app/test/keeper.js` (pure), `app/test/jobs/rearm-excavate-shaft.js` (job)

**Interfaces:**
- Produces: `handBack(items, worn) -> [{name, count}]` in `gear.js`. `items` = carried `{name, count}`, `worn` = names in the 4 armour slots plus off-hand. Returns what goes back.
- Consumes in `rearm`: `r.gearChest` (Task 3; until then undefined, so no hand-back) and `r.gearRange` (null for the owner's bots).

- [ ] **Step 1: Write failing pure tests** in `app/test/keeper.js`:

```js
const {handBack} = require('../gear');
const back = (items, worn = []) => Object.fromEntries(handBack(items, worn).map((i) => [i.name, i.count]));
assert.deepStrictEqual(back([{name: 'iron_sword', count: 3}, {name: 'iron_pickaxe', count: 3}]), {iron_sword: 2, iron_pickaxe: 1}, 'bot1 today');
assert.deepStrictEqual(back([{name: 'diamond_pickaxe', count: 1}, {name: 'iron_pickaxe', count: 2}]), {iron_pickaxe: 1}, 'best two pickaxes stay');
assert.deepStrictEqual(back([{name: 'wooden_axe', count: 1}, {name: 'stone_axe', count: 1}, {name: 'iron_axe', count: 1}]), {wooden_axe: 1, stone_axe: 1});
assert.deepStrictEqual(back([{name: 'wooden_axe', count: 1}]), {}, 'the only axe stays');
assert.deepStrictEqual(back([{name: 'iron_helmet', count: 1}, {name: 'shield', count: 1}], ['iron_helmet', 'shield']), {iron_helmet: 1, shield: 1}, 'carried armour and a second shield go back when one is worn');
assert.deepStrictEqual(back([{name: 'iron_helmet', count: 1}], []), {}, 'an unworn helmet with an empty head slot stays (rearm wears it)');
assert.deepStrictEqual(back([{name: 'bread', count: 30}, {name: 'oak_log', count: 64}]), {}, 'only gear is handed back');
```

- [ ] **Step 2: Run** `node app/test/keeper.js` → FAIL (`handBack` not a function).
- [ ] **Step 3: Implement `handBack(items, worn)`**: per kind (sword, axe, pickaxe, shield, helmet, chestplate, leggings, boots) keep the best N by tier (`wooden < stone < golden < iron < diamond < netherite`; sword/axe/shield 1, pickaxe 2, each armour kind 1 counting the worn one), and return the rest; within the kept set drop wood/stone when an iron-or-better of that kind is kept.
- [ ] **Step 4: Write the failing job test** in `app/test/jobs/rearm-excavate-shaft.js` with the existing `botOf`/`chestOf` helpers: a bot with 3 iron swords, `r.gearChest = {x: 0, y: 64, z: 0}`, `rearm` at `{x: 0, y: 64, z: 0}` → the chest holds 2 more `iron_sword` afterwards and `job.progress` matches `/handed back 2/`; the same with `r.gearRange = 250` (guest) → nothing deposited; the same with the chest's `deposit` throwing "chest full" → no throw, progress still set, equip step still ran.
- [ ] **Step 5: Run** `node app/test/jobs.js` → the new cases FAIL.
- [ ] **Step 6: Implement in `rearm`**: when `job.args` has the gear chest's x/y/z and `!r.gearRange`, after taking, deposit `handBack(...)` into the first opened container that accepts it (try each, `guard(job)` between, failures logged with `r.emit('info', 're-arm: could not hand back …')`), before the equip step; append `, handed back N` to `job.progress`.
- [ ] **Step 7: Run** `node app/test/keeper.js && node app/test/jobs.js` → pass.
- [ ] **Step 8: Commit** `feat(mcbots): bots hand back duplicate gear at the armoury`

### Task 3: The armoury point reaches every runner

**Files:**
- Modify: `app/places.js` (`KINDS`), `app/config.js` (`GEAR_GUESTS`), `app/server.js` (`applyPlaces`, runner creation, botui ctx), `app/hub.js` (constructor, welcome, `broadcastPolicy`, new `gearFor(conn)`), `app/hubclient.js` (`applyPolicy`, welcome runner opts), `app/botui-jobs.js` (`rearm` args), `app/botui-menus.js:89` (label), `default.nix` (`GEAR_GUESTS = "MisaBot"` on the hub), `docs/runbooks/minecraft/BOTS.md` (one paragraph)
- Test: `app/test/hub.js` (next to the `chestFor` asserts, line ~119, and the client policy asserts, line ~387), `app/test/config.js`, `app/test/botui.js` (line ~984)

**Interfaces:**
- Produces on every runner: `r.gearChest` (`{x,y,z}` or null) and `r.gearRange` (null, or 250 for a guest).
- Hub frames (`welcome`, `policy`) gain `gearChest` and `gearBots` (names on that worker that use it). `hub.gearFor(conn) -> {gearChest, gearBots}`.
- `cfg.gearGuests`: array of names, each must be in `GUEST_BOTS`.

- [ ] **Step 1: Write failing tests:**
  - `test/hub.js`: with `gearChest {x: -322, y: 105, z: -26}` and `gearGuests ['MisaBot']`, `hub.gearFor({bots: new Set(['MisaBot', 'EM_Trader'])})` deep-equals `{gearChest: {x: -322, y: 105, z: -26}, gearBots: ['MisaBot']}`; for `new Set(['bot2', 'bot3'])` `gearBots` is both; with `gearChest null` it is `{gearChest: null, gearBots: []}`.
  - `test/hub.js` client: `client.handle({t: 'policy', protectedAreas: [], supplyChest: null, gearChest: {x: 1, y: 2, z: 3}, gearBots: ['MisaBot']})` sets `gearChest` on the MisaBot stub and `gearRange` 250, and leaves an EM_Trader stub with `gearChest` null; a later policy without `gearChest` clears both.
  - `test/config.js`: `loadConfig({BOT_NAMES: 'bot1', GUEST_BOTS: 'MisaBot', GEAR_GUESTS: 'MisaBot'}).gearGuests` is `['MisaBot']`; `GEAR_GUESTS: 'bot1'` throws `/GEAR_GUESTS must be names in GUEST_BOTS/`.
  - `test/botui.js`: with a gear point in ctx, the `rearm` submit uses its x/y/z; without one, the supply chest as today.
- [ ] **Step 2: Run** `node app/test/hub.js; node app/test/config.js; node app/test/botui.js` → the new asserts FAIL.
- [ ] **Step 3: Implement:** `armoury` joins the point kinds; `applyPlaces` sets `gearChest = places.first('armoury')` (x/y/z only, or null) on local runners (`gearRange` null), on the hub and `hub.broadcastPolicy()`; local guest runners follow the same name rule as the hub; `applyPolicy` and the welcome path set `r.gearChest`/`r.gearRange` per runner name from `gearBots`; botui `rearm` args prefer the gear point; the menu lore reads `aus der Rüstkammer` when one is set. `default.nix`: `GEAR_GUESTS = "MisaBot";` beside `GUEST_BOTS`.
- [ ] **Step 4: Run** the three tests → pass.
- [ ] **Step 5: Commit** `feat(mcbots): armoury place kind and gear point for runners and workers`

### Task 4: Gear and food trips go to the armoury

**Files:**
- Modify: `app/bots.js`: new `gearPoint(r)` and `gearSources(r)` (exported), death handler (~911), `nightShelter` (~1278), `ensureGear` (~2305), `care` food rearm (~2412), the pickaxe rearm (~2602), `JOBS.rearm` start (nearest rule)
- Test: `app/test/stop-and-death.js`, `app/test/world-combat.js` (pure helpers, beside the BotRunner at line ~424)

**Interfaces:**
- Produces: `gearPoint(r) -> {x,y,z} | null`: `r.gearChest` when set and (`!r.gearRange` or the bot is within `r.gearRange` blocks of it, xz distance), else `r.supplyChest`. `gearSources(r) -> [{x,y,z}]`: `gearPoint(r)` then `r.supplyChest` if different, nulls dropped.
- Death rearm job: `{type: 'rearm', args: {...gearPoint(r), nearest: true}}`. `JOBS.rearm` with `args.nearest`: when `r.supplyChest` is nearer to the bot than `args`, it re-arms at the supply chest (respawn at the old beds).

- [ ] **Step 1: Write failing tests:**
  - pure: `gearPoint({gearChest: A, supplyChest: B})` is A; `{gearChest: null, supplyChest: B}` is B; a guest `{gearChest: A, gearRange: 250, supplyChest: null, bot: {entity: {position: 720 blocks away}}}` is null, 100 blocks away is A; `gearSources({gearChest: A, supplyChest: B})` deep-equals `[A, B]`, `{gearChest: null, supplyChest: B}` → `[B]`.
  - `stop-and-death.js`: a runner with `gearChest {x: -322, y: 105, z: -26}` and `supplyChest {x: -271, y: 66, z: -214}` dies → `queue[0]` is `rearm` with args `{x: -322, y: 105, z: -26, nearest: true}`; without `gearChest` → args are the supply chest with `nearest: true`.
- [ ] **Step 2: Run** `node app/test/stop-and-death.js; node app/test/world-combat.js` → FAIL.
- [ ] **Step 3: Implement:** replace `r.supplyChest` / `this.supplyChest` by `gearPoint(r)` in the five gear/food call sites (the grave call keeps `chest: this.supplyChest`). In `ensureGear`, when `r.gearChest` and something is missing: first `JOBS.rearm` at `gearPoint(r)` and recount `owned`; then fetch ingots and raw iron from each of `gearSources(r)` in order until enough (same `withdraw … far: true` calls as today); the 5-minute timer and `postNeed` stay as they are, `postNeed` naming the supply chest.
- [ ] **Step 4: Run** the two tests, then `node app/test/jobs.js` (rearm and supply parts unchanged) → pass.
- [ ] **Step 5: Commit** `feat(mcbots): gear and food trips use the armoury, base chest as fallback`

### Task 5: The keeper restocks the armoury

**Files:**
- Modify: `app/keeper.js` (new `ARMOURY_STOCK`, `armouryPlan`, `armoury` field, a step in `tick`, `finish`, `state`), `app/server.js` (`applyPlaces` sets `keeper.armoury`), `docs/runbooks/minecraft/BOTS.md` (keeper paragraph)
- Test: `app/test/keeper.js`

**Interfaces:**
- Consumes: `world.stockAt(chest)`, `r.enqueue`, the existing `withdraw`, `craft`, `deposit`, `stock` jobs.
- Produces: `keeper.armoury` = `{x,y,z}` or null (set from the `armoury` place). `ARMOURY_STOCK` = `[['iron_ingot', 64], ['bread', 64], ['torch', 32], ['logs', 16], ['iron_helmet', 2], ['iron_chestplate', 2], ['iron_leggings', 2], ['iron_boots', 2], ['iron_sword', 2], ['iron_axe', 2], ['iron_pickaxe', 2], ['shield', 2]]`. `armouryPlan(item, n, base, armoury, baseStock) -> chain | {blocked}`: plain items = `withdraw` n at base, `deposit {...armoury, only: item}`; gear items = `withdraw` the ingots (`COST` from `gear.js` × n) and 2 logs at base, `craft {item, count: n}`, `deposit {...armoury, only: item}`, `deposit {...armoury, only: 'iron_ingot'}`; `{blocked}` when the base stock lacks the inputs.

- [ ] **Step 1: Write failing tests** in `app/test/keeper.js` with the file's existing fake runners/world: base stock `{iron_ingot: 600, oak_log: 200, bread: 100, torch: 64}`, armoury stock counted and empty, keeper enabled, one idle bot → after `tick()` the bot's queue is `withdraw` (base, iron_ingot) → `deposit` (armoury, only iron_ingot); with the armoury stock missing → the queue is one `stock` job at the armoury; with `keeper.armoury = null` → no armoury job; `armouryPlan('iron_chestplate', 2, …)` withdraws 16 `iron_ingot`; with base `iron_ingot: 3` it returns `{blocked}`; the main quotas still go first when both are short and `MAX_BOTS` is reached (no third bot).
- [ ] **Step 2: Run** `node app/test/keeper.js` → FAIL.
- [ ] **Step 3: Implement:** all keeper stock goes into the gear-point chest (the keeper counts one chest; the Sets, Arms and Larder chests fill from hand-backs and by hand, and `rearm` reads them all). After step 2 of `tick`, the same shortest-first loop over `ARMOURY_STOCK` against `world.stockAt(this.armoury)`, with work keys `armoury:<item>`, sharing `busy`, `MAX_BOTS`, cooldowns and `finish` (which reads the armoury stock for `armoury:` keys); a missing or old armoury stock first gets a `stock` job there; `state()` adds `armoury: [{item, want, have, bot, note}]`.
- [ ] **Step 4: Run** `node app/test/keeper.js` → pass.
- [ ] **Step 5: Commit** `feat(mcbots): keeper fills the armoury from the base chest`

### Task 6: Armoury and barracks modules

**Files:**
- Create: `app/castle/armoury.js`
- Modify: `app/castle/make.js` (`MODULES`)
- Test: `app/test/castle.js`

**Interfaces:**
- Produces: `armoury() -> {size, blocks}`, `barracks() -> {size, blocks}`, `FURNITURE` (world blocks with `name` and `props`, from Global Constraints), `furnitureCommands() -> string[]` (`setblock x y z minecraft:chest[facing=east,type=…]` etc.). `MODULES.armoury = ['castle-ruestkammer', …]`, `MODULES.barracks = ['castle-kaserne1', …]`.

- [ ] **Step 1: Write failing asserts** in `app/test/castle.js`: armoury size `{x: 9, y: 8, z: 11}`, all blocks inside; doorway `8,1,5` and `8,2,5` empty; 4 hanging lanterns at y 5 on (2,3), (6,3), (2,7), (6,7); 7 glass; every furniture cell and the cell above each chest empty in the schematic; palette as in Global Constraints; barracks size `{x: 9, y: 8, z: 11}` with its doorway at `4,1,10` and `4,2,10` (south wall, world x -329, z -20) empty; `FURNITURE` has 10 chests, all within 6 blocks of -322 105 -26; `furnitureCommands()` has 12 lines; round trip through `writeLitematic`/`placeSchematic` at origin -323 104 -30 stays inside x -323..-315, z -30..-20, y 104..111.
- [ ] **Step 2: Run** `node app/test/castle.js` → FAIL (module missing).
- [ ] **Step 3: Implement** with the warehouse's `put`/`rim` pattern: one shared shell (floor cobblestone y 0, walls y 1..5 deepslate_bricks mixed with cobbled_deepslate, polished_deepslate corners, deepslate_tiles roof y 6, stone_bricks merlons on every second rim cell at y 7); `armoury()` and `barracks()` differ in doorway and slits. Chest `type` per half: for chests facing east, the half with the larger z is `type=left`; mark it in a one-line comment to verify in the sandbox.
- [ ] **Step 4: Run** `node app/test/castle.js` and `node app/castle/make.js armoury "$TMPDIR/a.litematic" && node app/castle/make.js barracks "$TMPDIR/b.litematic"` → `castle ok` and both files written.
- [ ] **Step 5: Commit** `feat(castle): armoury and barracks modules`

### Task 7: Beds move into Barracks 1

**Files:**
- Modify: `app/homebed.js` (`ROOM`, `SLOTS`, `slotSpot`)
- Test: `app/test/jobs/homebed-graves.js`

**Interfaces:**
- Produces: `slotSpot(slot) -> {x, y, z, facing}`: slots 0..6 = x -332..-326, feet z -28, facing north (heads on z -29); slots 7..12 = the same x without the door column -329, feet z -22, facing south (heads on z -21); `y` 105. `SLOTS` = 13. `CREW` unchanged.

- [ ] **Step 1: Write failing asserts:** `slotSpot(0)` is `{x: -332, y: 105, z: -28, facing: 'north'}`, `slotSpot(6)` x -326, `slotSpot(7)` is `{x: -332, y: 105, z: -22, facing: 'south'}`, no slot has x -329 with z -22, `SLOTS` is 13, `homeSpot('bot1', {})` is slot 0; update the existing asserts that name storage-room coordinates.
- [ ] **Step 2: Run** `node app/test/jobs.js` → FAIL on the new asserts.
- [ ] **Step 3: Implement** the new `ROOM`/`slotSpot`; the comment above `ROOM` names A3a and the spec.
- [ ] **Step 4: Run** `node app/test/jobs.js` → pass.
- [ ] **Step 5: Commit** `feat(mcbots): bed slots move into Barracks 1`

### Task 8: Whole-suite check

- [ ] **Step 1:** `nix build --no-link "git+file://$PWD?rev=$(git rev-parse HEAD)#checks.x86_64-linux.mcbots-tests"` from the repo root (laptop or lab) → builds. Without Nix: `cd app && npm ci --ignore-scripts && node test.js` → ends without a failure.
- [ ] **Step 2:** `nix flake check` → passes (covers `default.nix`).
- [ ] **Step 3:** Commit any fixes as `fix(mcbots): …`.

## Hand-over (not tasks: owner and the bot manager, in game)

1. Phase 0 at A3b and A3a: no owner blocks; ground probe; one `clear` per building above y 104, cobblestone footing below.
2. Ship the commits (owner: push, bump `bandit-craft` in bandit-nix, `lab-apply`).
3. Upload `castle-ruestkammer.litematic`, then `castle-kaserne1.litematic`; `schematic` jobs at -323 104 -30 and -333 104 -30.
4. RCON the 12 `furnitureCommands()` lines; open one double chest to check the pairing (swap `left`/`right` if wrong).
5. Set the dashboard marker `armoury` at -322 105 -26; the keeper then counts and fills it.
6. `homebed` job for bot1, bot2, bot3 (crew slots) and bot19, bot20, bot21 with `slot` 3..5.
