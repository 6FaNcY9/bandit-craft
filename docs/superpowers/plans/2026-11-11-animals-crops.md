# Animals and Crops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bot tends an animal pen (breed, shear, eggs, cull the surplus) or a crop field (carrots, potatoes, beetroot, sugar cane) as an open-ended job, started from the in-game picture menu, with hall-cap pauses and saved farms.

**Architecture:** Two new jobs, `cropfarm` and `animalfarm`, built like `treefarm.js`/`wheatfarm.js`: a factory with injected deps, pure helpers with unit tests, and fakes for the job tests. `wheatfarm.js` gets a crop table and a box limit parameter, wheat stays the default. Output caps and the pause reuse plan 1's `storage.surplus`. The menu gets its own page `farmm`, so "Abbauen (Bereich)" never sits next to "Karotten".

**Tech Stack:** Node 22, mineflayer 4.x (Minecraft 26.1, `bots.js:621`), plain `node:assert` tests, `app/test.js`.

**Spec:** `docs/superpowers/specs/2026-11-11-animals-crops-design.md`

## Global Constraints

- App root: `hosts/bandit-lab/services/mcbots/app/`; paths below are relative to it unless they start with `docs/` or `tools/`. Jobs sit flat in `app/`, job tests in `test/jobs/<name>.js`.
- Tests: `NODE_PATH=$(ls -dt /nix/store/*-mcbots-0.1.0/lib/node_modules/mcbots/node_modules | head -1) node test/<topic>.js`; job parts run through `node test/jobs.js` (list at `test/jobs.js:5`); a new topic file is added to the list in `test.js:8`.
- Base branch: craft `origin/main` once it holds the new menu layout `79451b4` (`git branch -r --contains 79451b4`); until then branch from `integrate/2026-11-11-evening`. Slot 21 of the bot page is free only in that layout.
- Farm jobs: box at most 16 x 16 (`farmBox(a, {max: 16})`); `wheatfarm` keeps 9 x 9 and its text. Comments in English, one line of why, as the codebase does. Menu texts in German.
- Animals: kinds cow, sheep, pig, chicken only. Keep 8 adults per kind, cull at most 4 per round, breed only while a kind has >= 2 adults and fewer than 16 (pen total 64). Never named animals (`named(e)`), never babies (`baby(e)`). Fed animals are remembered 5 minutes.
- Food: cow and sheep `wheat`, pig `carrot`, chicken `wheat_seeds`; withdraw 16 when short.
- Crops: ripe age carrots and potatoes 7, beetroot 3; sugar cane: dig only the block above the base, never the base; no planting of cane, no water placing.
- Outputs: hall cap 864 per kind, eggs 432. Pause: hall surplus above 0 skips that crop or that animal kind; everything skipped sets `job.t.doing = 'enough in the hall, waiting'` and sleeps 60 s in guarded 1 s slices. A missing input (food, shears, seeds, hoe) skips the chore, says so in `job.t.doing`, retries after 5 minutes (`RETRY_MS = 300000`) and never throws (a throw starts the order loop's backoff).
- `animalfarm` never digs and never places pillars. Rights: protected areas go into every scan and target filter; guests follow `wheatfarm`'s rule in `misa.js`.
- No Paper restart. Commit unsigned in a worktree; the owner signs and pushes.

## Review Focus

1. A named cow, a calf, or a horse, wolf or cat inside the pen is never fed for breeding, sheared, culled or hit. Test in Task 4 (census) and Task 5 (cull).
2. A gate the bot opened is closed again; a gate the owner left open stays open; a failed close never throws. Test in Task 5.
3. A stale or empty chest index must not pause or cull (`enough` returns 0 without totals). Test in Task 3 and Task 5.
4. A sheep whose sheared flag is misread (index 18 bit 0x10 is a guess) is not sheared again within 5 minutes. Test in Task 4.
5. Hall full and a full inventory: the hand-in fails, the job waits and retries, it does not throw. Test in Task 5.
6. `wheatfarm` is byte-for-byte unchanged in behaviour: its existing tests pass untouched. Task 2.

---

### Task 1: Output caps and routing

**Files:**
- Modify: `storage.js` (`kindOf`, `HALL_CAPS`)
- Test: `test/inventory.js`

**Interfaces:**
- Produces: `storage.surplus(name, totals)` returns a surplus for the new kinds; `kindOf('red_wool') === 'wool'`.

- [ ] **Step 1: Write the failing test.** Assertions: `S.surplus('carrot', {carrot: 865}) === 1`; `S.surplus('egg', {egg: 433}) === 1`; `S.surplus('red_wool', {white_wool: 800, red_wool: 100}) === 36`; the same 864 cap for `potato, beetroot, beetroot_seeds, sugar_cane, beef, porkchop, mutton, chicken, leather, feather`; `S.surplus('stick', {stick: 9999}) === 0`. Routing: with `isFood = (n) => !!require('minecraft-data')('26.1').foodsByName[n]`, `layout.categoryOf(n, isFood)` is `farm_food` for `carrot potato beetroot beetroot_seeds sugar_cane beef porkchop mutton chicken`, `build` for `white_wool`, `mobs` for `egg feather leather` (`storage-layout.js:29`).
- [ ] **Step 2: Run** `node test/inventory.js` — Expected: FAIL on the first new cap.
- [ ] **Step 3: Implement.** `kindOf`: `*_wool` is `wool`. `HALL_CAPS` gets the 13 kinds above (864, `egg` 432). If a routing assertion fails, extend `RULES` in `storage-layout.js`, nothing else.
- [ ] **Step 4: Run** `node test/inventory.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): hall caps for farm outputs (animals and crops plan)`

### Task 2: Crop table and box limit in the wheat helpers

**Files:**
- Modify: `wheatfarm.js` (`CROPS`, `farmBox`, `scan`, `pickups`, exports)
- Test: `test/jobs/wheatfarm.js`

**Interfaces:**
- Produces: `CROPS = {wheat, carrot, potato, beetroot}`, each `{block, ripe, seed, drops: RegExp}` (`wheat` `{'wheat', 7, 'wheat_seeds', /^(wheat|wheat_seeds|bread)$/}`, `carrot` `{'carrots', 7, 'carrot', /^carrot$/}`, `potato` `{'potatoes', 7, 'potato', /^(potato|poisonous_potato)$/}`, `beetroot` `{'beetroots', 3, 'beetroot_seeds', /^(beetroot|beetroot_seeds)$/}`).
- Produces: `farmBox(a, {max = 9, what = 'wheat field'} = {}) -> box`; `scan(blockAt, box, y0, areas, crop = CROPS.wheat)`; `pickups(entities, box, areas, me, wanted = CROPS.wheat.drops)`. `chooseWork` is unchanged (`seeds` = count of `crop.seed`).

- [ ] **Step 1: Write the failing tests** in `test/jobs/wheatfarm.js`: `scan` with `CROPS.carrot` marks age 7 `ripe` and age 6 `growing`; with `CROPS.beetroot` age 3 is `ripe`; `farmBox({x1:0,z1:0,x2:15,z2:15}, {max: 16, what: 'farm'})` passes and 17 wide throws `a farm is at most 16 x 16`; `farmBox` of 10 x 10 without options still throws `a wheat field is at most 9 x 9`.
- [ ] **Step 2: Run** `node test/jobs.js` — Expected: FAIL (`CROPS` undefined).
- [ ] **Step 3: Implement** as in Interfaces. `scan` replaces `above.name === 'wheat'` and `wheatAge(above) >= 7` with `crop.block` and `crop.ripe`; `WANTED_DROP` stays the default of `pickups`. Export `CROPS`.
- [ ] **Step 4: Run** `node test/jobs.js` — Expected: PASS with every old wheat test unchanged.
- [ ] **Step 5: Commit** `refactor(mcbots): wheat scan and pickups take a crop table`

### Task 3: The `cropfarm` job

**Files:**
- Create: `cropfarm.js`, `test/jobs/cropfarm.js`
- Modify: `bots.js` (`VALIDATE.cropfarm`; the registries listed in Step 3; wiring next to `makeWheatFarm`; `JOBS`), `projects.js:7`, `misa.js:21`, `test/jobs.js:5`

**Interfaces:**
- Consumes: Task 1 caps, Task 2 `CROPS`, `scan`, `chooseWork`, `pickups`, `farmBox`.
- Produces: `makeCropFarm({goNear, guard, sleep, digAt, waitCalm, deposit, withdraw, at, enough = () => 0}) -> {cropfarm}`; `cropfarm(r, job)` with `job.args = {x1, z1, x2, z2, crop: 'carrot'|'potato'|'beetroot'|'sugar_cane', y?}` (VALIDATE: box by `farmBox(a, {max: 16, what: 'farm'})`, crop from that list). `scanCane(blockAt, box, y0, areas) -> {cells}` with `{x, z, gy, state: 'ripe'|'growing'|'blocked'}`; `ripe` means a stack of at least 2 `sugar_cane`, the dig target is `gy + 2`. `enough(r, item) -> number` is `storage.surplus(item, storage.hallTotals(r.world?.chests))`, 0 without totals.

- [ ] **Step 1: Write the failing tests** (`flat()` world and `fake()` harness as in `test/jobs/treefarm.js`; ends by `assert.rejects(f.run(), Cancelled)` after N fake sleeps): (a) a ripe carrot is dug, the drop picked up, the same cell replanted with `carrot`; (b) beetroot at age 3 is harvested; (c) cane: only the block above the base is dug, the base never (assert the `digAt` calls); (d) `enough` returning 500 for the crop's output: no `digAt`, no `deposit`, `job.t.doing === 'enough in the hall, waiting'`; returning 0 resumes; (e) no seeds, no hoe: no throw, `job.t.doing` names the lack, the chore is retried after 300 s of fake time and not before; (f) a protected column is untouched; (g) output hand-in is `deposit(r, job, item)` and a failing deposit does not throw.
- [ ] **Step 2: Run** `node test/jobs.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `cropfarm.js`: each round `waitCalm`, pause check, scan, harvest, pickups, replant from the drops (else withdraw seeds from the hall, else `later(cell, RETRY_MS)`), till wet soil only with a hoe, hand in with `deposit` + `only` when 64 of an item or fewer than 4 empty slots, an idle round sleeps 10 x 1 s guarded. Mirror `wheatfarm.js`'s loop, `later` map and `job.t.open = true`; no bread, no bucket. Registries in `bots.js`: add `cropfarm` wherever `wheatfarm` is listed (`RESUMABLE` :72, `KEEP` :74, `AREA_JOBS` :133, the `digOnly`/`digBox` lists :941-942, `NIGHT_JOBS` :1208, `EMPTIES` :2240), plus `projects.js` `PROJECTS` and the type list in `misa.js:21` (`groundRule` reads boxes per type; an unlisted type bypasses guest rules).
- [ ] **Step 4: Run** `node test/jobs.js` and `node test/inventory.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): cropfarm tends carrots, potatoes, beetroot and sugar cane`

### Task 4: Animal helpers

**Files:**
- Create: `animals.js`, `test/animals.js`
- Modify: `hunt.js` (export `named`, `baby`), `test.js:8`

**Interfaces:**
- Produces: `KINDS = {cow: {food: 'wheat', outputs: ['beef','leather']}, sheep: {food: 'wheat', outputs: ['mutton','wool']}, pig: {food: 'carrot', outputs: ['porkchop']}, chicken: {food: 'wheat_seeds', outputs: ['chicken','egg','feather']}}`; `census(entities, box, areas) -> {cow, sheep, pig, chicken}` each `{adults: Entity[], babies: number}` (position floor inside the box, edges included, `isValid !== false`, not named, not in protected areas); `sheared(e) -> boolean` is `(e.metadata?.[18] & 0x10) !== 0`; `planRound(counts, {now, fed: Map<id, ms>, shorn: Map<id, ms>, have: {food, shears}, paused}) -> {breed: [Entity, Entity] | null, shear: Entity[], cull: Entity[], lacks: string[]}` per kind.

- [ ] **Step 1: Write the failing tests:** named, baby, a horse and an animal outside the box are not counted; the box edge counts; 2 adults and food breed the two oldest unfed; fed within 5 minutes are skipped; 1 adult, 16 in the pen or no food: no breed and `lacks` names the food; 12 adults cull 4 (the cap), 9 cull 1, 8 cull none, never a named or baby animal; a sheared sheep or one in `shorn` is not sheared, no shears: `shear` empty and `lacks` has `shears`; `paused` gives an empty plan.
- [ ] **Step 2: Run** `node test/animals.js` — Expected: FAIL.
- [ ] **Step 3: Implement** the three functions; order candidates by entity id (stable). `hunt.js` exports its module-level `named` and `baby`.
- [ ] **Step 4: Run** `node test/animals.js` and `node test/jobs.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): animal census and round planning`

### Task 5: The `animalfarm` job

**Files:**
- Create: `animalfarm.js`, `test/jobs/animalfarm.js`
- Modify: `hunt.js` (`makeHunt` also returns `engage`), `bots.js` (VALIDATE, registries as in Task 3, wiring, `JOBS`), `projects.js:7`, `misa.js:21`, `test/jobs.js:5`

**Interfaces:**
- Consumes: Task 4 helpers, `engage(r, job, e, shears) -> 'done' | 'lost'` (`hunt.js:82`), Task 1 caps.
- Produces: `makeAnimalFarm({goNear, guard, sleep, waitCalm, deposit, withdraw, crafting, at, engage, enough = () => 0}) -> {animalfarm}`; `borderGates(blockAt, box) -> [{x, y, z}]` (closed `*_fence_gate` blocks on the box border); `job.args = {x1, z1, x2, z2, y?}` (box <= 16 x 16). The pause is per kind: a kind is paused when `enough(r, item) > 0` for any item in its `outputs`.

- [ ] **Step 1: Write the failing tests** (harness as Task 3, fake entities with `metadata`): (a) cows with wheat: two adults are fed with `activateEntity`, `fed` remembers them, the next round within 300 s feeds nobody; (b) 13 cows: exactly 4 `engage` calls, never a named or baby cow; (c) a sheep is sheared with shears via `engage(r, job, e, shears)`, no shears: no throw, `job.t.doing` says so; (d) gates: one closed at start and found open after a crossing gets one `activateBlock`, a gate open at start gets none, a close that throws does not end the job; (e) every kind paused: `job.t.doing === 'enough in the hall, waiting'`, 60 x 1 s sleeps, no `engage`; `enough` returning 0 resumes; a null hall index never pauses (Review Focus 3); (f) a failing `deposit` does not throw (Review Focus 5); (g) the job's runner flags: `digOnly` matches no block name (`/(?!)/`) and `noScaffold` is true while it runs.
- [ ] **Step 2: Run** `node test/jobs.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `animalfarm.js`: per round `waitCalm`, `census`, `planRound` per kind, feed (equip food, `goNear`, `activateEntity`), shear and cull through `engage`, pick up eggs and drops inside the box, hand in outputs by `deposit(r, job, item)`, close the border gates noted at start after every crossing of the box edge. Withdraw 16 food from the hall when short; none there: `lacks`, retry in 5 minutes. In `bots.js`, `animalfarm` is not in `NIGHT_JOBS` (hostiles in a dark pen) and gets `digOnly = /(?!)/` and `noScaffold = true` at job start (restore like `bots.js:2435-2450`).
- [ ] **Step 4: Run** `node test/jobs.js` and `node test/hunt.js` (if the hunt topic exists, else `node test.js`) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): animalfarm breeds, shears, collects and culls a pen`

### Task 6: Saved farms and "Wenn frei"

**Files:**
- Modify: `places.js` (`ZONE_KINDS`, `clean`), `idle.js` (`CHOICES`, `resolveIdle`), `server.js:289-292` (`idleJob`), `botui-menus.js:86` (`PLACE_ICON`)
- Test: the topic tests for places and idle (find with `grep -ln "resolveIdle\|ZONE_KINDS" test/*.js`)

**Interfaces:**
- Produces: place kinds `pen` and `field` (box required, as the other zone kinds); a place of kind `field` may carry `crop` (one of the four crops, else dropped); `resolveIdle(choice, {..., zoneOf})` with `zoneOf(kind) -> place | null` replacing `treefarmZone`; choices `{id: 'tiere', label: 'Tiere', key: 'animalfarm', data: {zone: 'first', kind: 'pen'}}` and `{id: 'feld', label: 'Feld', key: 'cropfarm', data: {zone: 'first', kind: 'field'}}`; the tree farm choice gets `kind: 'treefarm'`.

- [ ] **Step 1: Write the failing tests:** `clean` keeps `crop: 'carrot'` on a `field`, drops it on other kinds and rejects `crop: 'cactus'`; a `pen` without a box throws; `resolveIdle` for `tiere` returns the first pen box, throws a short refusal without one (the existing `keine Baumfarm-Zone` text stays for the tree farm); `idleJob` passes only pens that pass the guest ground rule.
- [ ] **Step 2: Run** the two topic files — Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. A saved field's `crop` becomes the job's `crop`.
- [ ] **Step 4: Run** the two topic files and `node test/botui-menus.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): pen and field places, Tiere and Feld as idle choices`

### Task 7: The menu page `farmm`

**Files:**
- Modify: `botui-jobs.js` (`JOBS.animalfarm`, `JOBS.cropfarm`, a `farmArea` need), `botui-menus.js` (`farmPage`, `RENDER.farmm`, slot 21 of `botPage`), `botui.js` (`ACTIONS.farmm`, `ACTIONS.farmgo`, `GO` and `go` for saved farms), `server.js` (the `ui.api` object gets `savePlace(viewer, place)`), fixtures in `test/botui-crawl.js:11-18`
- Test: `test/botui-menus.js`, `test/botui-jobs.js`, `test/botui-crawl.js`

**Interfaces:**
- Produces: `farmPage(view)`: pictures for Tiere (wheat), Karotten (carrot), Kartoffeln (potato), Rote Bete (beetroot), Zuckerrohr (sugar_cane); "Zwei Ecken zeigen" (blaze rod, `{a: 'pick', kind: 'area'}`) and "Markierter Bereich" (red banner, `{a: 'areafrom', from: 'mark'}`) as on the Bereich page; saved pens and fields as pictures that start in one click. The new jobs use `needs: [farmArea]`, not `area`, so `AREA` (`botui-jobs.js` filter on `needs.includes(area)`) and the Bereich page never list them. `farmgo` builds the job through `jobs.build`, submits it with `ui.api.submit`, then saves the box as a `pen` or `field` place (with `crop`) through `ui.api.savePlace`.

- [ ] **Step 1: Write the failing tests:** `AREA` does not contain the farm jobs; `farmPage` slots are unique and in range, every payload `a` is a key of `ACTIONS`, icons exist in minecraft-data 26.1; `botPage` slot 21 opens `farmm`; a valid `farmgo` with two corners submits `animalfarm` and saves a `pen`; a 17 x 17 box refuses with a short text; the crawler fixtures `PLACES` get one pen and one field so the new buttons are clicked.
- [ ] **Step 2: Run** `node test/botui-menus.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** Clone `areaPage` for the layout; `farmm` state lives next to `st.area`. Add `ui.api.savePlace` in `server.js` over the same `places.set` the dashboard uses (guest ground rights as `wheatfarm`).
- [ ] **Step 4: Run** `node test/botui-menus.js`, `node test/botui-jobs.js`, `node test/botui.js` (it runs the crawler) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(botui): Tiere & Felder page`

### Task 8: Docs and owner handoff

**Files:**
- Modify: `docs/runbooks/minecraft/BOTS.md`, `docs/guides/owner-test.*` if it lists menu tests

- [ ] **Step 1:** Add a "Farms" section to `BOTS.md`: the two jobs, the 5-minute retries, the caps, the pause, and the owner rules (fence with a gate, name-tag pets because leashed animals are not visible to the bots, first two animals by hand, field with water by hand).
- [ ] **Step 2:** Add the menu test steps for the owner (three clicks the first time, two after).
- [ ] **Step 3: Run** `node test.js` (background, about 5 minutes) — Expected: `ok`.
- [ ] **Step 4: Commit** `docs: animals and crops`
