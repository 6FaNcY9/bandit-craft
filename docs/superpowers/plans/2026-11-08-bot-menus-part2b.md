# Bot menus, part 2b: every flow as a picture menu, marks, area ghost, enchanting, dialogs retired

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every flow the coverage ledger still lists as "still a dialog" becomes a picture menu or a one-click choice, build-order steps 5 (3D area mode with a ghost) and 6 (enchanting job + window) ship, and the old dialog screens (`lage`, `bot`, `wennfrei`, `auftrag`, `job`, `karte`, "Alle Befehle (alt)") are deleted. Dialogs stay only for the stop-all confirmation, the upload link and the keeper's quota sliders.

**Architecture:** Same shape as parts 1 and 2a: pure renderers in `mcbots/app/botui-menus.js`, per-viewer state and `ACTIONS` in `mcbots/app/botui.js`, orders through `jobs.build` → `api.submit` in `mcbots/app/botui-jobs.js`. Two new hub concepts: a **marks store** per viewer (one spot or area, set with sneak + staff, reused by build, area jobs, goto and guard) and **pick modes** `area` and `place` next to the existing `block`/`chest` ones. The plugin gets three grouped changes (one Paper restart): the `open` event carries `sneak`, `/outline` can draw a `block_display` ghost of the box, and the ghost can follow the player's gaze (`follow`) for schematic placement. Enchanting is a new bot job in `mcbots/app/bots.js` (mineflayer `openEnchantmentTable`) with a chest look-alike window.

**Tech Stack:** Paper 26.2 plugin (Java 25, `minecraft/botui/BotUi.java`), Node 24 hub (`mcbots/app`), mineflayer stand e2e (`tools/botui-stand`), `minecraft-data` 26.1.

**Spec:** `docs/superpowers/specs/2026-11-06-bot-menus-design.md` ("3D area picking", "Plugin side", build order 5-6, "Dialogs retire flow by flow", "Misa's rules", "Grid contents"). Ledger: `docs/runbooks/minecraft/botui-coverage.md`. Parts 1 / 2a: `docs/superpowers/plans/2026-11-06-bot-menus-part1.md`, `2026-11-07-bot-menus-part2a.md`.

**Out of scope / deferred (owner decisions and non-goals):** ore or block mining from a marked area ("Abbauen nur <Erz>": the owner looks at ore mining later, 2026-11-08; the hopper window stays the only mining entry); `level` (Mining levels: needs y/length/branch numbers, no botui job today); Meldungen and Essen from the spec's overview/bot page (no `eat` job exists, no unread store; listed as open questions); the vanilla `MenuType.ENCHANTING` spike (the spec pre-approves the chest look-alike); Handel auf Knopfdruck.

## Global Constraints

- Paths below are relative to `hosts/bandit-lab/services/` unless they start with `tools/` or `docs/`.
- All user-facing text German and short: menu names ≤ 40 chars, at most three lore lines, no text walls.
- No cycle buttons, no select lists where a choice set fits a grid: a click is one choice (owner, 2026-11-08). The only remaining number inputs are the keeper quota sliders (`ziele` dialog) and the stop-all confirmation.
- Misa (guest) sees and controls only MisaBot and EM_Trader: every bot in a payload goes through `oneBot` / `botOf` / `allowedBots`, every order through `jobs.build` (→ `resolveBots`) and `api.submit` (→ `ground()`), every bot list through `view.snaps` (already filtered). Every new action gets a test with the guest viewer `Midari` (`viewerBots: {Fancy: '*', Midari: ['MisaBot']}`).
- Renderers are pure (same view → same JSON); the viewer is the Bukkit player, never a payload field; coordinates from a payload pass `jobs.point()` and then `ground()` as the old `send` did.
- Menu items are display only: every click/drag on a menu view stays cancelled (part 1/2a plugin code, unchanged).
- No new dependencies. No client mods, no resource pack.
- Tests: from `mcbots/app` run `NODE_PATH=/nix/store/zr4ddgnrpj4laxhhby300nslbyx1ld32-mcbots-0.1.0/lib/node_modules/mcbots/node_modules node test/<topic>.js`; full suite `node test.js` (same `NODE_PATH`; `test/goto-crafting.js:41` flakes under load, rerun alone). Plugin: `nix build .#checks.x86_64-linux.botui` from the repo root (`-Xlint:all -Werror`). Stand e2e, repo root, same `NODE_PATH`: `tools/botui-stand/stand.sh up && node tools/botui-stand/e2e-bridge.js; tools/botui-stand/stand.sh down`.
- Commits: `git -c commit.gpgsign=false commit`, never push, ending with the two lines `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01WeVYxVoPuoRW17SkJQUECp`.
- The plugin changes (Task 6) restart Paper: ship when nobody plays, warn first (AGENTS.md).

### Owner UX requirements (2026-11-08)

1. **No clicking through lists.** Audit result, every `select` and click-to-cycle in the current UI and its replacement: Bauplan select → paged plan grid `schemm` (Task 4); Wohin select → `placem` grid (gaze / where I stand / marked spot / saved places) (Tasks 1, 4); Drehung select → sneak+click rotates the ghost in place mode, plus four rotation slots in `buildm` (Task 4); Wer select → heads (`botpick {back}`) (Task 1); Wann select → two slots Danach / Jetzt (Tasks 4, 7); Wie viel click-cycle in the hopper → one-row `amountm` with four slots 16 / 64 / 256 / ∞ (Task 1); Anzahl slider for hunt → four count slots (Task 3); Radius slider for guard → four radius slots (Task 1); Karte zoom buttons → six map slots, centre → heads (Task 5); keeper/plan/sidebar toggle buttons → glinting slots (Task 5); quota sliders → stay a dialog (numbers).
2. **Schematic picker:** a paged chest grid, one item per plan: icon = the plan's most common block, name = file name without `.litematic`, lore `W × H × D · N Blöcke` and `eigener Plan` / `geteilt`; newest first, the viewer's recently used first. Misa sees only `uploads.visible` plans.
3. **Placement:** after the pick, "Platzieren" mode: a ghost of the plan's bounding box follows the staff's gaze (plugin `follow`), sneak+click rotates 90°, click confirms the origin; action bar one line. Alternatives in the same screen: "An markierter Stelle", "Wo ich stehe", saved places. Then `buildm`: Bauen / Material sammeln (`produce`) / Abbrechen, who (heads), when, rotation.
4. **Mining gets the same:** "Bereich" mode (two staff clicks with the ghost box), "Markierter Bereich", and from `aream` only the area jobs: Ausheben (excavate), Abbauen (clear), Schacht (shaft), Ausleuchten (light), Versiegeln (seal), with who and when. **Owner decision:** no ore mining from an area; the hopper window stays as it is.
5. **One marks store** per viewer (`ui.marks`), not one per screen: a spot or an area, set with sneak + staff right click, reused by build, area jobs, goto and guard; survives a quit, expires after 6 h or a hub restart.

## Review Focus

1. **Ghost left behind.** A `place` or `area` pick that times out, a viewer who quits mid-pick, a menu closed with Escape after corner 1, a plugin disable. Expected: no `block_display` remains for anyone. Pinned in Task 6 (quit, `/outline null`, disable) and Task 7 (expired pick → `/outline {box: null}`).
2. **The ghost and the build disagree on rotation.** A plan with `offset` ≠ 0 rotated 90° or 270°: the ghost box must be the box `placeSchematic` fills. Expected: `schematicBox(info, origin, rotation)` equals the min/max of `placeSchematic(parsed, {origin, rotation})` for every rotation. Pinned in Task 4.
3. **A guest and marked places.** Misa marks a spot in the owner's base and orders a build/goto/guard there. Expected: the mark is hers to set, the order still fails in `ground()` (`api.submit` throws) with a `Fehler:` flash, nothing queued. Pinned in Tasks 1 and 4 (submit stub throws for `Midari`).
4. **Forged chest coordinates.** `{a: 'chestjob', job: 'withdraw', x, y, z}` with coordinates that are not the gazed chest. Expected: the hub uses the coordinates it captured from the staff click (`st.screen.at`), never the payload's. Pinned in Task 2.
5. **Enchanting with too little experience or lapis.** Expected: no item is lost (the tool is taken back out of the table), the job ends with `need N more lapis_lazuli` / `need level N`, the viewer sees the German reason. Pinned in Task 8 (fake table).

## My calls (open to the owner's veto)

- Sneak + staff right click on an ordinary block (not a bot, chest, crafting table, furnace, enchanting table, animal, wheat or spawner, and no pick live) **marks**: first click = spot, a second sneak click within 60 s turns it into an area (spot → corner a, this block → corner b). Plain right click keeps today's routing (minable block → hopper, else overview).
- The ghost is one glowing `light_blue_stained_glass` `BlockDisplay` per layer (y), scaled to the box footprint, at most 48 layers (the tallest area job), `setVisibleByDefault(false)` + `showEntity`, non-persistent. One call: `/outline` gains `ghost: true` and `follow: {x1..z2}` (a box relative to the gazed block, moved every 5 ticks).
- Schematic origin = the gazed block (as the dialog's "Worauf du schaust" and the owner's test C3), rotation about that origin exactly as `placeSchematic` does.
- Enchanting window is the chest look-alike (spec fallback): item, lapis, three `enchanted_book` slots Stufe 1–3. The job picks offer `level-1` and takes the item back out on any failure. Bots do not grind XP in this part.
- `level` is not offered in `aream` (needs numbers); `tidy` from a chest uses radius 16; `guardm` radii are 8 / 16 / 32 / 48; `huntm` counts are 1 / 4 / 8 / 16; `amountm` keeps 16 / 64 / 256 / ∞.
- Karte becomes a menu (`kartem`): six `map` slots (count = blocks per pixel), "Mitte: ich" as the viewer's head, a head per bot in the viewer's world.
- The `ziele` dialog stays only for the quota sliders (+ Speichern, Zurück → `zielm`); toggles and trader-chest removal move to `zielm`.

---

### Task 1: Bot page "Mehr…", Bewachen…, Hingehen (places grid), amounts, generic bot picker, marks store

**Files:**
- Modify: `mcbots/app/botui-menus.js` (`botPage` ~46-60, `shiftPage` ~105, `botPickPage` ~165, `RENDER`), `mcbots/app/botui.js` (`GO` ~41, `ACTIONS` `amount`/`botpick`/`setbot`/`go`, `handle('open')` ~462-474, state init ~458)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- Consumes: `botOf`, `oneBot`, `formOf`, `jobs.build`, `jobs.presetOf`, `jobs.resolveTarget`, `menus.AMOUNTS`, `PICK_MS`.
- Produces (`botui-menus.js`):
  - `botPage` row 1 adds slot 6 `shield` "Bewachen…" → `{a: 'guardm', bot}`; row 2 slot 17 `enchanting_table` "Verzaubern…" → `{a: 'enchm', bot}` (action lands in Task 9; until then it flashes `Unbekannte Aktion`, acceptable); row 3 slot 25 `book` "Mehr…" → `{a: 'morem', bot}`. `GLINT` gains `guard: 'iron_sword'` (kept), `goto: 'ender_eye'`, `enchant: 'enchanting_table'`.
  - `morePage(view, screen)` → chest 1 row, title `<bot>: mehr`: 0 `ender_eye` "Hingehen…" → `{a: 'placem', mode: 'goto', bot}`, 1 `iron_chestplate` "Ausrüsten" → `{a: 'go', bot, job: 'rearm'}` (lore `aus der Vorratskiste`), 2 `red_bed` "Heim" → `go homebed`, 3 `bone` "Gräber holen" → `go graves`, 4 `totem_of_undying` "Helfen" → `go help`, 8 Zurück → `botm`.
  - `guardPage(view, screen)` → chest 1 row, title `<bot>: bewachen`: slots 0-3 `iron_sword` named `Radius 8|16|32|48` (count = radius) lore `Klick: wo du stehst · Shift: worauf du schaust`, payload `{a: 'guardgo', bot, radius}`; slot 5 `red_banner` "Markierte Stelle" (only when `view.mark?.spot`) → `{a: 'guardgo', bot, radius: 16, mark: 1}`; 8 Zurück.
  - `PLACE_ICON = {supply: 'chest', site: 'bricks', home: 'red_bed', afk: 'clock', chest: 'barrel', storage: 'chest', shaft: 'iron_pickaxe', treefarm: 'oak_sapling', wheat: 'wheat', base: 'white_banner'}` (no `protected`).
  - `placePage(view, screen)` (`screen = {name: 'placem', mode: 'goto'|'build', bot}`) → chest 6 rows, title `Wohin?`: 0 `grass_block` "Worauf du schaust" → `{a: 'placego', mode, bot, where: 'gaze'}` (only when `view.ctx.gaze`), 1 `compass` "Wo ich stehe" → `where: 'pos'`, 2 `red_banner` "Markierte Stelle <x y z>" → `where: 'mark'` (only with `view.mark?.spot`), slots 9+ one per `view.places` (kind ≠ protected, ≤ 40, sorted by name) as `PLACE_ICON[kind] || 'oak_sign'` named `place.name` lore `<x> <y> <z>` → `where: 'place:<name>'`; 53 Zurück → `botm` (goto) or `schemm` (build, Task 4).
  - `amountPage(view)` → chest 1 row, title `Wie viel?`: slots 0-3 = `AMOUNTS` as `paper` (count 16/64 for those two, 1 otherwise; ∞ named `∞ immer weiter`) glint on `view.form.amount` → `{a: 'setamount', amount}`; 8 Zurück → `shiftm`. `shiftPage` slot 2 payload becomes `{a: 'amountm'}` with lore `Klick: Menge wählen`.
  - `botPickPage(view, screen)` back slot goes to `screen.back || 'shiftm'` (with `bot` when back is `botm`); heads carry `{a: 'setbot', bot, back}`.
  - `RENDER` adds `morem, guardm, placem, amountm`.
- Produces (`botui.js`):
  - `MARK_MS = 6 * 3600 * 1000`; `this.marks = new Map()` in the constructor; `markOf(ui, viewer) -> {spot, area}` (drops an entry older than `MARK_MS`, returns `{spot: null, area: null}` when none); `setMark(ui, viewer, g, dim)` → first call `{spot: {x,y,z,dim}, area: null, at}`, a second within `PICK_MS` with a spot and no area → `{area: {a: spot, b: g}}` (same `dim`, else flash `Ecken in verschiedenen Welten`). Passed to every render as `view.mark`.
  - `handle('open')` gains `e.sneak === true && g && !g.entity` before the minable-block branch (after bot / windows / chest / Task 3 rows): `setMark` + `outline(ui, viewer, box)` with `ghost: true` (the flag is sent now and ignored by the old plugin until Task 6) + actionbar `Stelle gemerkt: x y z · Schleichen+Klick nochmal = Bereich bis dort` / `Bereich gemerkt: W × H × D`; no menu opens (`return`).
  - `GO` gains `rearm: {key: 'rearm', data: {}}`, `homebed`, `graves`, `help`, `goto: {key: 'goto', data: {}}`, `wheatfarm: {key: 'wheatfarm', data: {}}` (zone branch generalised: `kind = data.job === 'treefarm' ? 'treefarm' : 'wheat'`), `lightspawner: {key: 'lightspawner', data: {}}`, `stock`, `tidy: {key: 'tidy', data: {radius: 16}}`, `deposit`. `go` passes `data.x/y/z` through only when `GO[job].loc` is true (`goto`, `lightspawner`, `stock`, `tidy`), via `jobs.presetOf`.
  - ACTIONS: `morem {bot}`, `guardm {bot}` (screens); `guardgo {bot, radius, shift?, mark?}`: radius ∈ {8,16,32,48} else `unbekannter Radius`; target = `mark` → `markOf().spot` (else flash `Keine Stelle markiert`), `shift` → `where: 'gaze'`, else `where: 'pos'`; `jobs.build('guard', {who: bot, where, radius})` (for `mark`: `x,y,z` preset) → submit → `botm` → flash. `placem {mode, bot}`: mode ∈ {goto, build}. `placego {mode, bot, where}`: `where` ∈ `gaze|pos|mark|place:<name>`; goto → `jobs.build('goto', {who: bot, where})` (`mark` → preset x,y,z from the store) → submit → `botm`; build → Task 4 (`st.build.at = resolved target`, screen `buildm`). `amountm` (screen), `setamount {amount}`: must be in `menus.AMOUNTS` else `unbekannte Menge`; sets `formOf(...).amount`, screen `shiftm`. `botpick {back?}` stores `back` on the screen; `setbot {bot, back?}`: back ∈ `GRID_BACK ∪ {huntm, buildm, aream, enchm}`; for `shiftm` it keeps `formOf(st, ui, viewer, bot)`, for the others it sets `st.lastBot` via `botOf` and the kept screen (`st.build.bot` / `st.hunt.bot` / `st.area.bot` / `st.make.bot` where present).
  - The `amount` action is deleted (replaced by `amountm` / `setamount`).

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `botm` has slot 6 `shield` → `{a: 'guardm', bot}`, slot 25 `book` → `{a: 'morem', bot}`, slot 17 `enchanting_table`; `morem` for `zed` has 5 order slots whose payload `a` is `go`/`placem` and a back slot 8; `guardm` slots 0-3 counts `[8, 16, 32, 48]`, slot 5 absent without a mark and present with `view.mark = {spot: {x: 1, y: 2, z: 3}}`; `placem` with `places: [{name: 'Basis', kind: 'base', x: 1, y: 64, z: 2}, {name: 'geheim', kind: 'protected', ...}]` lists `white_banner` "Basis" and no `geheim`; `amountm` slot 3 is named `∞ immer weiter` and glints for `form.amount = 'inf'`; `shiftm` slot 2 payload is `{a: 'amountm'}`; every payload `a` of every new screen is a key of `ACTIONS` (extend the loop).
  - `test/botui.js`: owner `guardgo {bot: 'bot1', radius: 32}` submits `guard` args `{x: 0, y: 64, z: 0, radius: 32}`; `radius: 5` flashes `Fehler: unbekannter Radius`; guest `guardgo {bot: 'bot1', radius: 16}` → `Fehler: nicht dein Bot`, no submit; `placego {mode: 'goto', bot: 'bot1', where: 'pos'}` submits `goto` `{x: 0, y: 64, z: 0}`; `placego` with `where: 'place:Basis'` and `places` stub → `{x: 1, y: 64, z: 2}`; two sneak `open` events (`sneak: true`, gaze stone at 5 64 5 then 8 66 9) from `Midari` post `/actionbar` with `Stelle gemerkt` then `Bereich gemerkt: 4 × 3 × 5` and `/outline` with `ghost: true`, open no `/menu`; `markOf` after `t += MARK_MS + 1` is empty; a guest `placego {where: 'mark'}` whose submit stub throws `Fremdes Gelände` flashes `Fehler: Fremdes Gelände`; `setamount {amount: 256}` then `shiftgo` submits `mine` count 256; `setamount {amount: 7}` → `Fehler: unbekannte Menge`; `go {bot: 'bot1', job: 'rearm'}` with a keeper stub whose `state().chest` is set submits `rearm` with that chest; from `Midari` (no supply) → flash starts `Fehler:` (`keine Vorratskiste`).
- [ ] **Step 2: Run** `node test/botui-menus.js` and `node test/botui.js`. Expected: FAIL (unknown screens / `Unbekannte Aktion`).
- [ ] **Step 3: Implement** the pages, `GO`, the marks store, the actions and the sneak branch.
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): Mehr/Bewachen/Hingehen menus, amount and place grids, per-viewer marks`.

### Task 2: Chest jobs on the chest screen

**Files:**
- Modify: `mcbots/app/botui-menus.js` (`chestPage` ~86, `GRID_MODES`/`gridPage`), `mcbots/app/botui.js` (`handle('open')` chest branch ~471, ACTIONS `chestfor`, `gridm` back list, `pickitem`)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- `handle('open')` on a chest sets `st.screen = {name: 'chestm', at: {x: g.x, y: g.y, z: g.z}}` (the hub's own gaze, kept for the follow-up clicks).
- `chestPage(view, screen)`: heads now carry `{a: 'chestjobs', bot}`; title `Kiste bei <x y z>: wer?`.
- `chestJobsPage(view, screen)` (`screen = {name: 'chestjobs', bot, at}`) → chest 1 row, title `<bot>: diese Kiste`: 0 `hopper` "Kiste merken" → `{a: 'chestfor', bot}`, 1 `chest` "Hier einlagern" → `{a: 'chestjob', bot, job: 'deposit'}`, 2 `chest_minecart` "Entnehmen…" → `{a: 'gridm', mode: 'withdraw', tab: 'werkzeug', page: 0, back: 'chestjobs', bot}`, 3 `spyglass` "Zählen" → `chestjob stock`, 4 `brush` "Hier aufräumen" → `chestjob tidy`; for a trader bot (`view.traders.includes(bot)`): 6 `stick` "Handelskiste: Sticks" → `{a: 'trader_add', bot, kind: 'sticks'}`, 7 `emerald` "Handelskiste: Smaragde" → `kind: 'stores'`; 8 Zurück → `chestm`. `view.traders` is passed by `render` (`this.api.traders?.() || []`).
- `GRID_MODES.withdraw = {tabs: ITEM_TABS, icons: ITEM_TAB_ICON, pick: 'pickitem', key: 'item'}`; in withdraw mode the item lore is `Klick: 16 · Shift: 64`. `GRID_BACK` gains `chestjobs`; the grid's back slot for `chestjobs` carries `bot`.
- ACTIONS: `chestjobs {bot}` → screen `{name: 'chestjobs', bot: oneBot, at: st.screen.at}` (requires `st.screen.name === 'chestm'` or `chestjobs`, else `Erst eine Kiste anklicken`). `chestjob {bot, job}`: job ∈ {deposit, stock, tidy}; `jobs.build(job, {who: bot, ...st.screen.at, ...(tidy: radius 16)})` with `at` from the screen, never from `data`; submit → `botm` → flash. `pickitem` in withdraw mode → `jobs.build('withdraw', {who: bot, item, n: shift ? 64 : 16, ...at})` where `at = st.screen.at` carried onto the grid screen by `gridm` (copy `st.screen.at` when `back === 'chestjobs'`). `trader_add` sets `st.screen = {name: 'botm', bot}` instead of `auftrag` (its gaze check stays).

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `chestjobs` for `zed` has slots 0-4 with the payloads above and no slot 6 unless `traders: ['zed']`; `gridm` withdraw mode lists `bread` with lore `Klick: 16 · Shift: 64`.
  - `test/botui.js`: owner `open` with gaze `chest` at 3 4 5 → `/menu` title `Kiste bei 3 4 5: wer?`; click `chestjobs {bot: 'bot1'}` → title `bot1: diese Kiste`; `chestjob {bot: 'bot1', job: 'stock', x: 9, y: 9, z: 9}` submits `stock` with `{x: 3, y: 4, z: 5}` (payload coordinates ignored); `chestjob tidy` → args `{x: 3, y: 4, z: 5, radius: 16}`; `gridm` withdraw then `pickitem {item: 'coal', shift: true}` submits `withdraw` `{item: 'coal', count: 64, x: 3, y: 4, z: 5}`; guest `chestjobs {bot: 'bot1'}` → `Fehler: nicht dein Bot`; `chestjobs` without a prior `chestm` → `Fehler: Erst eine Kiste anklicken`.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): chest jobs (einlagern, entnehmen, zählen, aufräumen, Handelskiste) from the chest screen`.

### Task 3: Staff on an animal, wheat or a spawner

**Files:**
- Modify: `mcbots/app/botui-menus.js` (new `whomPage`, `huntPage`, `RENDER`), `mcbots/app/botui.js` (`handle('open')`, ACTIONS)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- `handle('open')`, before the sneak/mark branch: `g.entity && /^(cow|sheep|pig|chicken)$/.test(g.entity.type)` → `st.hunt = {animal: g.entity.type, at: {x, y, z of the entity}, bot: botOf(...)}`, screen `huntm`; `!g.entity && /wheat|farmland/.test(g.block)` → screen `{name: 'whom', job: 'wheatfarm'}`; `/spawner/.test(g.block)` → `{name: 'whom', job: 'lightspawner', at: {x, y, z}}`.
- `whomPage(view, screen)` → heads of `view.snaps` (as `chestPage`), title `Weizenfarm: wer?` / `Spawner ausleuchten: wer?`, payload `{a: 'go', bot, job: screen.job, ...(screen.at || {})}`; back → `ov`.
- `huntPage(view)` (`view.hunt`) → chest 1 row, title `<animal DE> jagen: <bot>`: 0 `<animal>_spawn_egg` named `germanName(animal)` (display, payload `{a: 'huntm'}`), 2-5 `iron_sword` count 1/4/8/16 named `1|4|8|16 jagen` → `{a: 'huntgo', n}`, 7 `player_head` of the bot → `{a: 'botpick', back: 'huntm'}`, 8 Zurück → `ov`. `DE` gains `cow: 'Kühe', sheep: 'Schafe', pig: 'Schweine', chicken: 'Hühner'`.
- ACTIONS: `huntm` (re-render), `huntgo {n, shift?}`: n ∈ {1,4,8,16} else `unbekannte Anzahl`; `jobs.build('hunt', {who: st.hunt.bot, animal: st.hunt.animal, n, ...st.hunt.at})` → submit → `botm` → flash `${bot}: ${n} ${germanName(animal)} jagen`.

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `huntm` with `hunt: {animal: 'cow', bot: 'zed'}` has slot 0 `cow_spawn_egg`, slots 2-5 counts `[1, 4, 8, 16]`; `whom` with `job: 'lightspawner', at: {x: 1, y: 2, z: 3}` gives heads whose payload is `{a: 'go', bot, job: 'lightspawner', x: 1, y: 2, z: 3}`.
  - `test/botui.js`: `open` with gaze `{block: 'air', entity: {type: 'cow', x: 10, y: 64, z: 10}}` → `/menu` title matches `/Kühe jagen/`; `huntgo {n: 4}` submits `hunt` `{animal: 'cow', count: 4, x: 10, y: 64, z: 10, radius: 24}`; `huntgo {n: 3}` → `Fehler: unbekannte Anzahl`; gaze `spawner` at 1 2 3 then `go {bot: 'bot1', job: 'lightspawner', x: 1, y: 2, z: 3}` submits `light` `{spawner: {x: 1, y: 2, z: 3}}`; gaze `wheat` with a `places` stub holding a `wheat` zone → `go wheatfarm` submits `wheatfarm` with that box; guest `go {bot: 'bot1', job: 'wheatfarm'}` → `Fehler: nicht dein Bot`.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): staff on an animal, wheat or a spawner opens Jagen / Weizenfarm / Ausleuchten`.

### Task 4: Schematic grid, placement state and the build menu (hub side; the live ghost arrives with Task 6/7)

**Files:**
- Modify: `mcbots/app/server.js` (`listSchematics` ~473: add `top`; `api.schematics` ~350 returns infos), `mcbots/app/schematic.js` (export `schematicBox`), `mcbots/app/botui-menus.js` (new `schemPage`, `buildPage`; `botPage` slot 14 → `{a: 'schemm', bot}`), `mcbots/app/botui.js` (ACTIONS, `st.build`, `placego` build branch, `consumePick` `place` branch)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`, `mcbots/app/test/build-blueprint.js` (`schematicBox`)

**Interfaces:**
- `server.js`: `listSchematics()` info gains `top` (the most frequent `blocks[].name` without `minecraft:`, `'stone'` when none), `offset: s.offset`, `mtime: st.mtimeMs`, `owner: <viewer prefix or null>` (the `<viewer>-` prefix `uploads.visible` uses, lower-cased). `api.schematics(viewer)` returns the visible **infos** (`{file, name, size, offset, blocks, top, mtime, owner}`), not file names; `jobs.build`'s `env.schematics` keeps taking file names (`infos.map((i) => i.file)` at the call sites).
- `schematic.js`: `schematicBox({size, offset}, origin, rotation) -> {x1,y1,z1,x2,y2,z2}` = the min/max over the four xz corners of `[offset.x, offset.x+size.x-1] × [offset.z, offset.z+size.z-1]` under the same `transform` as `placeSchematic`, plus `origin`; y from `origin.y + offset.y` to `+ size.y - 1`.
- `botui-menus.js`:
  - `schemPage(view, screen)` (`screen = {name: 'schemm', bot, page}`) → chest 6 rows, title `Bauplan für <bot>`: plans = `view.schematics` sorted by `view.recentPlans` index first, then `mtime` desc; 45 per page at slots 0-44 as `top` (falls back to `paper` when `top` is not an item in `minecraft-data` `itemsByName`), name = file without `.litematic` (≤ 40), lore `[`${size.x} × ${size.y} × ${size.z} · ${blocks} Blöcke`, owner ? 'eigener Plan' : 'geteilt']`, payload `{a: 'pickplan', file}`; 45 `arrow` "Vorherige Seite" / 53 `arrow` "Nächste Seite" when there are pages (`{a: 'schemm', bot, page}`), 49 Zurück → `botm`. No plans → slot 22 `barrier` "Keine Baupläne · Bauplan hochladen" → `{a: 'upload'}`.
  - `buildPage(view)` (`view.build = {file, bot, rotation, at, when, mode}`) → chest 3 rows, title `Bauen: <file>`: 0 `player_head` bot → `{a: 'botpick', back: 'buildm'}`; 1 `top` item of the plan (display, lore size); 3-6 `compass` named `0° | 90° | 180° | 270°` glint on `rotation` → `{a: 'rotate', rotation}`; 8 Zurück → `schemm`; 9 `grass_block` "Platzieren (zeig mit dem Stab)" → `{a: 'pick', kind: 'place'}`; 10 `red_banner` "Markierte Stelle" (with `view.mark.spot`) → `{a: 'placego', mode: 'build', where: 'mark'}`; 11 `compass` "Wo ich stehe" → `where: 'pos'`; 12 `oak_sign` "Gespeicherte Orte…" → `{a: 'placem', mode: 'build'}`; 14 `target` named `Wohin: <x y z>` or `barrier` "Noch kein Ort" (display); 18 `clock` "Danach" / 19 `clock` "Jetzt (ersetzt die Arbeit)" glint on `when` → `{a: 'setwhen', when}`; 21 `bricks` "Bauen" → `{a: 'buildgo', mode: 'schematic'}`; 22 `chest` "Material sammeln" lore `legt alles in die Kiste des Bots` → `{a: 'buildgo', mode: 'produce'}`; 26 `barrier` "Abbrechen" → `{a: 'botm', bot}`.
  - `RENDER` adds `schemm, buildm`. `view.schematics`, `view.recentPlans`, `view.build`, `view.mark` come from `render` (schematics via `await this.api.schematics(viewer)`; menus render becomes async-aware: `render` already `await`s for dialogs, so `menus.menu` receives the infos).
- `botui.js`:
  - `st.build = {file, bot, rotation: 0, at: null, when: 'next', mode: 'schematic'}`; `st.recentPlans` (≤ 4 files).
  - ACTIONS: `schemm {bot?, page?}`; `pickplan {file}`: file must be in the visible infos else `Bauplan nicht gefunden`; sets `st.build` (bot = `botOf`, previous rotation kept for the same file), `recentPlans`, screen `buildm`; `rotate {rotation}` ∈ {0,90,180,270}; `setwhen {when}` ∈ {next, now}; `placego` build branch: `st.build.at = jobs.resolveTarget(where, st.ctx, places)` (`mark` → the store's spot), screen `buildm`, and `outline(ui, viewer, schematicBox(info, at, rotation), {ghost: true})`; `pick {kind: 'place'}`: `st.pick = {kind: 'place', until}`, closes the menu, sends `/outline {player, box: null, ghost: true, follow: schematicBox(info, {x:0,y:0,z:0}, rotation)}` (relative box; ignored by the old plugin until Task 6) and actionbar `Klick = hier bauen · Schleichen+Klick = drehen`; `consumePick` `place`: `g.block !== 'air'` required; sneak → `rotation = (rotation + 90) % 360`, re-send `follow`, pick stays, no menu; plain → `st.build.at = {x,y,z,dim}`, `/outline` with the absolute box (ghost, no follow), screen `buildm`, `return true`. `buildgo {mode}`: needs `st.build.at` (else flash `Erst einen Ort wählen`); `schematic` → `jobs.build('schematic', {who: bot, file, rotation, when, ...at})`; `produce` → the same with key `produce` and `chesttext` = the bot's chest else `supply` (no chest → flash `Erst eine Kiste merken`); submit → `clearSel` (outline + ghost off) → `botm` → flash. The `open` event's `sneak` field arrives with Task 6; until then `consumePick` treats a missing field as `false`.

- [ ] **Step 1: Write failing tests.**
  - `test/build-blueprint.js`: for `parsed = {size: {x: 3, y: 2, z: 5}, offset: {x: 1, y: 0, z: -2}}` and `origin = {x: 10, y: 64, z: 10}`, `schematicBox(parsed, origin, r)` equals the min/max over `placeSchematic({...parsed, blocks: <one block per cell>, air: []}, {origin, rotation: r})` for every `r` in `[0, 90, 180, 270]`.
  - `test/botui-menus.js`: `schemm` with two infos (`a.litematic` mtime 1, `fancy-b.litematic` mtime 2 owner `fancy`, `top: 'stone_bricks'`) lists `fancy-b` first with lore `[`4 × 3 × 4 · 20 Blöcke`, 'eigener Plan']`; `recentPlans: ['a.litematic']` puts `a` first; no infos → slot 22 `barrier` with payload `{a: 'upload'}`; `buildm` glints slot 4 for rotation 90 and slot 19 for `when: 'now'`.
  - `test/botui.js`: `api.schematics` stub returns infos; owner `pickplan {file: 'a.litematic'}` → `/menu` title `Bauen: a`; `pickplan {file: 'x.litematic'}` → `Fehler: Bauplan nicht gefunden`; `placego {mode: 'build', where: 'pos'}` then `buildgo {mode: 'schematic'}` submits `schematic` `{file: 'a.litematic', origin: {x: 0, y: 64, z: 0}, rotation: 0, chests: []}` and then posts `/outline` with `box: null`; `rotate {rotation: 90}` + `pick {kind: 'place'}` posts `/outline` with `follow` equal to `schematicBox(info, {x: 0, y: 0, z: 0}, 90)`; a following `open` with `sneak: true` posts `/outline` with the 180° box and no `/menu`; a plain `open` on stone at 5 64 5 → `/menu` `Bauen: a` and `buildgo {mode: 'produce'}` with a bot chest submits `produce` with `store` = that chest; guest `pickplan` of an owner-only file (not in her visible infos) → `Fehler: Bauplan nicht gefunden`; guest `buildgo` whose submit stub throws → flash `Fehler:` and `/outline null` not sent (selection kept).
- [ ] **Step 2: Run** the three tests. Expected: FAIL.
- [ ] **Step 3: Implement** `schematicBox`, the server infos, the pages, `st.build`, the actions and the pick branch.
- [ ] **Step 4: Run the tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): schematic grid, placement state with rotation, build/produce menu`.

### Task 5: Einstellungen menu (keeper, plan, sidebar, trader chests), Karte as a menu, Ziele dialog reduced

**Files:**
- Modify: `mcbots/app/botui-menus.js` (`overview` slot 53, new `zielPage`, `kartePage`, `ZOOMS` moves here), `mcbots/app/botui-screens.js` (`ziele` ~261: sliders only; `karte` deleted; `ZOOMS` import), `mcbots/app/botui.js` (ACTIONS `karte`/`zoom`/`center`/`keeper`/`plan`/`sidebar`/`trader_del`/`saveziele`, `handle('mapclick')`)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui-screens.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- `overview` slot 53 becomes `comparator` "Einstellungen" → `{a: 'zielm'}` ("Alle Befehle (alt)" is gone from the menu here; the screens die in Task 10).
- `zielPage(view)` → chest 2 rows, title `Einstellungen`: owner only: 0 `clock` `Daueraufträge: an|aus` glint when on → `{a: 'keeper', on: !enabled}` (only with `keeper.state().available`), 1 `map` `Plan: an|aus` → `{a: 'plan', on}` (with `view.plan`), 2 `writable_book` "Ziele (Zahlen)…" → `{a: 'ziele'}` (only with configured quotas); everyone: 4 `oak_sign` `Seitenleiste an` → `{a: 'sidebar', on: 1}`, 5 `oak_sign` `Seitenleiste aus`; row 2: one slot per trader chest of the viewer's traders (`view.traderChests.list(t)`): `stick`/`emerald` named `<trader> <Sticks|Smaragde> <x y z>` lore `Klick: entfernen` → `{a: 'trader_del', bot, kind, x, y, z}` (≤ 8); 17 Zurück → `ov`. Lore on the keeper slot: `Sandbox` note when `view.snaps.some((s) => s.sandbox)`.
- `ZOOMS = [1, 2, 5, 10, 25, 50]` lives in `botui-menus.js` (exported); `kartePage(view)` → chest 2 rows, title `Bot-Karte`: 0-5 `map` count z named `${z} ${z === 1 ? 'Block' : 'Blöcke'} pro Pixel` glint on `mapState.zoom` → `{a: 'zoom', z}`; 9 `player_head` of the viewer "Mitte: ich" glint when no centre → `{a: 'center', me: 1}`; 10+ heads of in-world bots → `{a: 'center', bot}`; 17 Zurück → `ov`.
- `ziele(view)` dialog keeps only: body line, the quota sliders, `Speichern` (dynamic `saveziele`), `Zurück` → `zielm`; `exit` = CLOSE. Owner only (the action already checks).
- ACTIONS: `zielm` (screen); `karte` → `/map/give` then screen `kartem` + `pushMap` (error → `ov` + flash); `zoom`/`center` set screen `kartem`; `keeper`/`plan`/`sidebar`/`trader_del` set screen `zielm`; `saveziele` sets `ziele` (dialog stays open with the saved numbers); `ziele` action stays owner-only. `handle('mapclick')` → `kartem`. `REFRESHING` gains `kartem` (the head list changes with bots) and `zielm`.

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `zielm` for the owner with `keeper: {state: () => ({available: true, enabled: false, configured: [['coal', 64]]})}` has slot 0 `clock` payload `{a: 'keeper', on: true}` no glint, slot 2 `writable_book`; for `Midari` no slots 0-2 and the sidebar slots present; with `traderChests: {list: () => ({sticks: [{x: 1, y: 2, z: 3}]})}` and `traders: ['MisaBot']` a `stick` slot with payload `{a: 'trader_del', bot: 'MisaBot', kind: 'sticks', x: 1, y: 2, z: 3}`; `kartem` has six `map` slots with counts `[1, 2, 5, 10, 25, 50]` and glint on 5; `ov` slot 53 is `comparator` → `{a: 'zielm'}`.
  - `test/botui-screens.js`: the Ziele block (~153-182) asserts only sliders, `Speichern` and `Zurück` → `zielm`, no toggle buttons; the Karte block (~183) is deleted.
  - `test/botui.js`: `mapclick` → `/menu` title `Bot-Karte`; `zoom {z: 25}` posts `/map` with zoom 25 and re-renders `kartem`; guest `keeper {on: 1}` → `Fehler: nur für den Besitzer`.
- [ ] **Step 2: Run** the three tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): Einstellungen and Karte as menus; Ziele dialog keeps only the sliders`.

### Task 6: Plugin: `sneak` on open events, ghost block_display on `/outline`, gaze-following ghost

**Files:**
- Modify: `minecraft/botui/BotUi.java` (`emit` ~663-710, `outline` ~534-568, `drawOutlines`/`onQuit`/`onDisable` ~159, ~975-1010; imports `org.bukkit.entity.BlockDisplay`, `org.bukkit.entity.Display`, `org.bukkit.util.Transformation`, `org.joml.Vector3f`, `org.joml.AxisAngle4f`)
- Test: `tools/botui-stand/e2e-bridge.js` (outline block ~153-160; a new ghost block)

**Interfaces:**
- `emit`: every event gains `"sneak": p.isSneaking()`.
- `/outline` body: `{player, box: {x1..z2}|null, ghost?: true, follow?: {x1..z2}}`. `box` keeps the particle outline. `ghost: true` with a `box` → the ghost stands on that box; `follow` (a box relative to the gazed block; requires `ghost: true`, `box` may be null) → the ghost is re-placed every 5 ticks at `p.getTargetBlockExact(64)` + `follow` (hidden when there is no target block). `box: null` without `follow` removes outline and ghost. Validation as today (`bad box` for a bad `box` or `follow`).
- Ghost: `private final Map<UUID, Ghost> ghosts` with `record Ghost(World world, List<BlockDisplay> layers, double[] follow)`. `spawnGhost(Player p, World w, double[] box6)`: one `BlockDisplay` per y layer (≤ 48; a taller box uses the lowest 48), `Material.LIGHT_BLUE_STAINED_GLASS`, `setTransformation(new Transformation(new Vector3f(0,0,0), new AxisAngle4f(), new Vector3f(dx, 1, dz), new AxisAngle4f()))`, `setGlowing(true)`, `setBrightness(new Display.Brightness(15, 15))`, `setPersistent(false)`, `setVisibleByDefault(false)`, `p.showEntity(this, e)`. `clearGhost(UUID)` removes every layer. The 5-tick task (`runTaskTimer`) moves follow ghosts with `teleport` (same layer count, so no respawn). Cleared on `/outline null`, `onQuit`, `onDisable` (every ghost), and when a follow ghost's player changes world.

- [ ] **Step 1: Extend the e2e (failing).** After the outline block: `/outline {player: 'Viewer', box, ghost: true}` → `ok`; `waitFor(() => Object.values(c.bot.entities).filter((e) => e.name === 'block_display').length === 3)` for a box 3 high; `/outline {box: null}` → the count returns to 0; `/outline {box: null, ghost: true, follow: {x1: 0, y1: 0, z1: 0, x2: 2, y2: 1, z2: 2}}` → 2 displays appear near the client's target block (the stand client looks down at its feet: assert `|e.position.y - c.bot.entity.position.y| < 4`); `/outline {box: null}` → 0. Sneak: `c.bot.setControlState('sneak', true)` + a staff right click → the next `open` event has `sneak: true`; released → `false`. Bad `follow` (`x1: 'x'`) → 400. Quit: a second client that received a ghost disconnects, then reconnects → sees 0 displays.
- [ ] **Step 2: Run the stand e2e.** Expected: FAIL at the first ghost assertion.
- [ ] **Step 3: Implement** the fields, the ghost map, spawn/clear, the follow task and the cleanup hooks.
- [ ] **Step 4: Run** `nix build .#checks.x86_64-linux.botui` and the stand e2e. Expected: both pass.
- [ ] **Step 5: Commit** `feat(botui): sneak on events, block_display ghost on /outline, gaze-following ghost`.

### Task 7: Area mode and the area menu (hub side)

**Files:**
- Modify: `mcbots/app/botui-menus.js` (new `areaPage`; `botPage` slot 10 lore `Klick: Block abbauen · Shift: Bereich`; `shiftPage` slot 4 lore; `RENDER`), `mcbots/app/botui.js` (`pick` kind `area`, `consumePick`, `outline` helper with `ghost`, ACTIONS `aream`, `areago`, `areaclear`, expiry in `handle`)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- `AREA_ICON = {excavate: 'diamond_shovel', clear: 'diamond_pickaxe', shaft: 'ladder', light: 'torch', seal: 'stone_bricks'}` (every key of `jobs.areaJobs`; no `mine`/`shift`: owner decision).
- Entry points: `botm` slot 10 shift-click → `{a: 'shiftm'}` stays on click; the plugin sends `shift: true` and `shiftm` with `data.shift` calls `ACTIONS.aream`. `aream` also from `morem` slot 5 `diamond_shovel` "Bereich…" → `{a: 'aream', bot}`.
- `areaPage(view)` (`view.area = {bot, when}`, `view.sel`, `view.mark`) → chest 3 rows, title `Bereich: <W × H × D>` or `Bereich wählen`: 0 head → `{a: 'botpick', back: 'aream'}`; 2 `stick` "Zwei Ecken zeigen" → `{a: 'pick', kind: 'area'}`; 3 `red_banner` "Markierter Bereich" (with `view.mark.area`) → `{a: 'areafrom', from: 'mark'}`; 5 `clock` Danach / 6 `clock` Jetzt glint on `when` → `{a: 'setwhen', when, screen: 'aream'}`; 8 `barrier` "Abbrechen" → `{a: 'areaclear'}`; row 2 (only with both corners): `jobs.areaJobs(sel)` as slots 9+ `AREA_ICON[key]` named `JOBS[key].label` → `{a: 'areago', key}` when `ok`, else `gray_stained_glass_pane` named the label with lore `[why]` and payload `{a: 'aream'}`; 26 Zurück → `botm`.
- `botui.js`: `outline(ui, viewer, box, extra = {})` sends `{player, box, ...extra}`; `clearSel` sends `box: null` (ghost off too). `st.area = {bot, when: 'next'}`. ACTIONS: `aream {bot?}` (bot via `botOf`); `pick {kind: 'area'}`: `st.sel` reset, `st.pick = {kind: 'area', until}`, close, actionbar `Ecke 1 anklicken`; `consumePick` `area`: first click → `st.sel.a`, `outline(box(a, a), {ghost: true})`, actionbar `Ecke 2 anklicken`, `until` renewed, pick stays, `return false`-like without a flash (no menu); second click → `st.sel.b` (other world → flash `Ecken in verschiedenen Welten`, pick stays), `outline(box(a, b), {ghost: true})`, pick ends, screen `aream`, `return true`. `areafrom {from: 'mark'}`: `st.sel = {a: mark.area.a, b: mark.area.b, dim}` + outline with ghost. `setwhen` accepts `screen: 'aream'` to set `st.area.when` instead of `st.build.when`. `areago {key}`: key ∈ `jobs.AREA` (export it) else `unbekannter Auftrag`; `jobs.build(key, {who: st.area.bot, when: st.area.when}, env with `sel: st.sel`)` → submit → `clearSel` → `botm` → flash; a build error keeps the selection and flashes `Fehler: <explain>`. Expiry: in `handle`, an expired `st.pick` of kind `area` or `place` also calls `clearSel` (so the ghost goes with it). The old `corner` and `clearsel` actions are deleted here (their tests move to the new ones).

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `aream` without corners has slots 0, 2, 5, 6, 8, 26 and no row-2 slots; with `sel` 3×3×3 it has five row-2 slots whose `a` is `areago`, and for a 40×40×30 box `excavate` is a `gray_stained_glass_pane` with lore starting `zu groß`; with `mark.area` slot 3 is present.
  - `test/botui.js`: `pick {kind: 'area'}` posts `/close` and `/actionbar` `Ecke 1 anklicken`; an `open` at 0 64 0 posts `/outline` with `ghost: true` and no `/menu`; a second `open` at 2 66 2 posts `/outline` box `{x1: 0, y1: 64, z1: 0, x2: 2, y2: 66, z2: 2}` and `/menu` title `Bereich: 3 × 3 × 3`; `areago {key: 'excavate'}` submits `excavate` with that box and then `/outline {box: null}`; `areago {key: 'mine'}` → `Fehler: unbekannter Auftrag`; after `t += PICK_MS + 1` with corner a set, the next `open` posts `/outline {box: null}` and handles the click normally; guest `aream {bot: 'bot1'}` → `Fehler: nicht dein Bot`; `shiftm {bot: 'bot1', shift: true}` → `/menu` title `Bereich wählen`.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): Bereich mode with two staff clicks and a ghost; area jobs menu`.

### Task 8: The `enchant` bot job

**Files:**
- Create: `mcbots/app/enchant.js`
- Modify: `mcbots/app/bots.js` (`VALIDATE` ~116: `enchant`; `JOBS` runner table ~3455; `crafting` object ~2890), `mcbots/app/crafting.js` (`makeCrafting` return ~354: add `station`), `mcbots/app/botui-jobs.js` (`JOBS.enchant`, `DE`)
- Test: `mcbots/app/test/goto-crafting.js` (VALIDATE + runner with a fake table), `mcbots/app/test/botui-jobs.js`

**Interfaces:**
- `VALIDATE.enchant(a) -> {item, level}`: `item` matches `/^(wooden|stone|iron|golden|diamond|netherite)_(pickaxe|axe|shovel|sword|hoe)$|^bow$|^fishing_rod$|^(leather|iron|golden|diamond|netherite)_(helmet|chestplate|leggings|boots)$|^book$/` else `item must be a tool, weapon, armour or book`; `level` = `num(a.level ?? 3, 1, 3, 'level')`.
- `enchant.js`: `makeEnchant({station, guard, count, getMore}) -> async (r, job)`; `lapisNeeded(level) = level` (vanilla: the offer `i` costs `i+1` lapis); flow: `guard`; `count(bot, item) < 1` → throw `need 1 ${item}`; lapis short → `await getMore(r, job, 'lapis_lazuli', level - have)` (bots.js wires it to `JOBS.get` via `child`, as `smelt` wires `withdraw`); `block = await station(r, job, 'enchanting_table', 0)`; `table = await bot.openEnchantmentTable(block)`; `try { putTargetItem; putLapis; await ready(table, 10000); const offer = table.enchantments[level - 1]; if (!offer || offer.level < 0) throw new Error('no offer at level ' + level); if (bot.experience.level < offer.level) throw new Error(`need level ${offer.level}, have ${bot.experience.level}`); await table.enchant(level - 1); } finally { await table.takeTargetItem().catch(() => {}); table.close(); }`; `job.progress = `${item} enchanted (offer ${level})``. `ready(table, ms)` resolves on the `ready` event or when `table.enchantments.some((e) => e.level >= 0)`, else rejects `enchanting table gave no offers`.
- `crafting.js` `makeCrafting` returns `{ensureItem, ensurePlanks, smelt, count, station}`.
- `bots.js`: `JOBS.enchant = enchantLib.makeEnchant({station: crafting.station, guard, count: crafting.count, getMore: (r, job, item, n) => JOBS.get(r, child(job, {type: 'get', args: {item, count: n}}))})`.
- `botui-jobs.js`: `JOBS.enchant = {label: 'Verzaubern', type: 'enchant', general: true, needs: [item, count(1, 3, 1, 3)], args: (v) => ({item: v.item, level: R(v.n)}), say: (v) => `${germanName(v.item)} verzaubern (Stufe ${v.n})`}`; `DE` gains `lapis_lazuli: 'Lapislazuli', enchanting_table: 'Zaubertisch', iron_axe: 'Eisenaxt', diamond_pickaxe: 'Diamantspitzhacke', diamond_sword: 'Diamantschwert', book: 'Buch'`.

- [ ] **Step 1: Write failing tests.**
  - `test/goto-crafting.js`: `VALIDATE.enchant({item: 'iron_pickaxe'})` → `{item: 'iron_pickaxe', level: 3}`; `{item: 'cobblestone'}` throws `/tool, weapon/`; `{item: 'bow', level: 4}` throws. Runner with a fake `r` (`bot.inventory` with `iron_pickaxe x1`, `lapis_lazuli x3`, `experience.level 30`, `openEnchantmentTable` returning a fake table whose `enchantments = [{level: 1}, {level: 5}, {level: 12}]` and that records `putTargetItem`, `putLapis`, `enchant(2)`, `takeTargetItem`, `close`), `station` returning a block: resolves and the fake saw `enchant(2)` then `takeTargetItem`; with `experience.level 3` rejects `/need level 12/` and `takeTargetItem` was still called; with `lapis_lazuli x1` the `getMore` stub is called with `('lapis_lazuli', 2)`; with `enchantments` all `-1` rejects `/no offers/` within the test's fake timer.
  - `test/botui-jobs.js`: `build('enchant', {who: 'bot1', item: 'iron_pickaxe', n: 2}, env)` → `type 'enchant'`, args `{item: 'iron_pickaxe', level: 2}`, say `Eisenspitzhacke verzaubern (Stufe 2)`.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement** `enchant.js`, the VALIDATE entry, the wiring and the botui job.
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): enchant job (walk to a table, lapis, pick an offer, take the item back)`.

### Task 9: Enchanting window and the staff on an enchanting table

**Files:**
- Modify: `mcbots/app/botui-menus.js` (new `enchPage`; `GRID_MODES.enchant`), `mcbots/app/botui.js` (ACTIONS `enchm`, `enchgo`; `pickitem` enchant branch; `handle('open')` route; `GRID_BACK`)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- `TOOL_RE` = the `VALIDATE.enchant` item regex (export it from `bots.js` as `ENCHANTABLE`); `bestTool(have) -> item | null` = the first inventory item matching `ENCHANTABLE`, preferring `netherite > diamond > iron > stone > wooden` and `pickaxe > sword > axe > shovel`.
- `GRID_MODES.enchant = {tabs: {dabei: <filled per view>}, ...}`: the enchant grid lists the bot's enchantable inventory items (`gridPage` reads `view.make.bot`'s snapshot when `mode === 'enchant'`); empty → slot 22 `barrier` "Nichts zum Verzaubern dabei". `pick: 'pickitem', key: 'item'`.
- `enchPage(view)` (`view.make = {kind: 'enchant', bot, item}`) → chest 3 rows, title `Verzaubern: <bot>`: 8 head; 10 item (chosen, else `bestTool`, else `barrier` "Kein Werkzeug dabei") lore `Klick: anderes Item` → `{a: 'gridm', mode: 'enchant', tab: 'dabei', page: 0, back: 'enchm'}`; 11 `lapis_lazuli` count `have` (grey pane `Kein Lapis dabei · der Bot holt es` when 0); 14/15/16 `enchanted_book` count 1/2/3 named `Stufe 1|2|3` lore `[`${n} Lapis`, 'bestes Angebot dieser Stufe']` → `{a: 'enchgo', level: n}` (absent without an item); 26 Zurück → `botm`.
- ACTIONS: `enchm {bot?}` like `craftm` with `kind: 'enchant'` (item = `bestTool` when none kept); `pickitem` enchant mode → `st.make.item = item` (must match `ENCHANTABLE` and be in the snapshot inventory), screen `enchm`; `enchgo {level}` ∈ {1,2,3}: `order(st, ui, viewer, bot, 'enchant', {item, n: level})`. `handle('open')`: `g.block === 'enchanting_table'` joins the crafting/furnace branch → `enchm`. `GRID_BACK` gains `enchm`.

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `enchm` for a bot with `['iron_pickaxe x1', 'lapis_lazuli x3']` has slot 10 `iron_pickaxe`, slot 11 `lapis_lazuli` count 3, slots 14-16 `enchanted_book` with payloads `{a: 'enchgo', level: 1|2|3}`; with no lapis slot 11 is `gray_stained_glass_pane`; with no tool slot 10 is `barrier` and no book slots; `gridm` enchant mode lists exactly the enchantable items the bot carries.
  - `test/botui.js`: owner `enchm {bot: 'bot1'}` then `enchgo {level: 3}` submits `enchant` `{item: 'iron_pickaxe', level: 3}`; `enchgo {level: 4}` → `Fehler:`; `pickitem {item: 'cobblestone'}` in enchant mode → `Fehler: unbekanntes Item`; `open` with gaze `enchanting_table` → `/menu` title `Verzaubern: bot1`; guest `enchm {bot: 'bot1'}` → `Fehler: nicht dein Bot`.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): Verzaubern window; staff on an enchanting table`.

### Task 10: Retire the dialogs, docs, guides, final checks

**Files:**
- Modify: `mcbots/app/botui-screens.js` (keep `safe`, `explain`, `dialog`/`button`/`line`/`txt`/`lines`/`slider`, `flashLine`, `confirmStop`, `ziele` (sliders), `upload`, `SCREENS = {upload, stopall: confirmStop, ziele}`, `REFRESHING = new Set(['ov', 'botm', 'kartem', 'zielm'])`; `render(screen, view)` throws `unbekannter Bildschirm` for a name not in `SCREENS`, and `BotUi.render` sends every name that is neither a menu nor a dialog to the overview (`st.screen = {name: 'ov'}`) so a stale state never breaks a viewer; delete `lage`, `bot`, `wennfrei`, `auftrag`, `jobScreen`, `inputsOf`, `targetSelect`, `chestSelect`, `nameSelect`, `karte`, `QUICK`, `JOB_NAME`/`jobName`/`jobText`/`tooltip`/`problems`, `COLOR`/`STATE_WORD`/`ELSEWHERE`/`inWorldFirst`/`mine`/`traders` when orphaned), `mcbots/app/botui-jobs.js` (delete `contextJobs`, the `general`/`here` fields stay harmless; keep `areaJobs`, `presetOf`, `resolveTarget`), `mcbots/app/botui.js` (delete ACTIONS `lage`, `oldmenu`, `bot`, `botscreen`, `idle_open`, `new`, `job`, `send`, `quick`, `corner`, `clearsel`; `idle_set` always → `botm`; `stopall_ok` → `ov`; `upload` dialog's back → `ov`; initial `st.screen = {name: 'ov'}`; `handle('open')` fallback → `ov`; `render` no longer passes `keeper/plan/places/schematics/traderChests/traders/mapState` to dialogs except what `ziele` needs (`keeper`, `owner`, `flash`); drop the `QUICK`/`ZOOMS` imports), `mcbots/app/test/botui-screens.js` (reduce to: contract fields of the three dialogs, `explain`, hostile input through `safe`, Ziele sliders, stop-all confirmation), `mcbots/app/test/botui.js` (remove tests of deleted actions; the stub `REFRESHING` set loses `lage`/`auftrag`/`bot`), `mcbots/app/test/botui-jobs.js` (drop `contextJobs` tests), `tools/botui-stand/e2e-hub.js` (if it drives `lage`/`auftrag`: switch to `ov`/`botm`)
- Docs: `docs/runbooks/minecraft/botui-coverage.md` (rewrite: every row "covered by …"; "Dialogs left: `stopall`, `upload`, `ziele` sliders"), `docs/runbooks/minecraft/BOTS.md` ("Picture menus" ~214: part 2b paragraph ≤ 10 lines: marks, Mehr/Bewachen/Hingehen, chest jobs, staff on animal/wheat/spawner, schematic grid + Platzieren ghost, Bereich, Verzaubern, Einstellungen/Karte menus, dialogs left), `docs/guides/misa-test.de.html` (new sections I "Markieren, Bereich, Bauen" and J "Verzaubern, Kiste, Mehr", 5-6 rows each; the closing "Als Nächstes" line updated), `docs/guides/owner-test.de.html` (sections C/D rewritten for the grid + Platzieren flow, new F "Bereich und Zaubertisch", "Was noch nicht im Menü ist" → Handel, Upload, Erz aus Bereich (owner decision), Meldungen/Essen), regenerate both PDFs: `nix shell nixpkgs#chromium -c chromium --headless --password-store=basic --no-pdf-header-footer --print-to-pdf=docs/guides/misa-test.pdf docs/guides/misa-test.de.html` and the same for `owner-test`.

- [ ] **Step 1: Delete the screens and actions**, fix the imports, run `grep -n "lage\|auftrag\|'bot'\|wennfrei\|karte'" mcbots/app/botui*.js mcbots/app/test/botui*.js tools/botui-stand/*.js` and clear every remaining reference (the plugin's `lage` **event** name stays). Keep `explain` (used by `areago`/`buildgo` flashes); delete every helper the grep shows orphaned.
- [ ] **Step 2: Rewrite the tests** named above; add to `test/botui.js`: a fresh viewer's first `open` on air posts `/menu` title `Bots` (no `/show`); a click `{a: 'lage'}` flashes `Unbekannte Aktion`; `/show` is posted only for `stopall`, `upload` and `ziele`.
- [ ] **Step 3: Run** the full suite. Expected: PASS (rerun `goto-crafting` alone if it flakes).
- [ ] **Step 4: Update the docs and guides**, regenerate the PDFs. Test rows for Misa (I): I1 Schleichen + Stab auf den Boden → „Stelle gemerkt“; I2 nochmal woanders → „Bereich gemerkt“; I3 MisaBots Seite → Mehr… → Bereich… → „Markierter Bereich“ → Schaufel (Ausheben) → Fenster zu, MisaBot gräbt; I4 Ziegel (Bauen…) → ein Plan als Bild → „Platzieren“ → der blaue Geisterkasten folgt dem Blick, Schleichen+Klick dreht ihn, Klick setzt ihn → „Bauen“; I5 dasselbe mit „Material sammeln“ → MisaBot füllt seine Kiste; I6 Esc während der Geist zu sehen ist, eine Minute warten → der Geist ist weg. (J): J1 Zaubertisch (Verzaubern…) → Werkzeug, Lapis, drei Bücher → Stufe 1 → MisaBot läuft zum Zaubertisch; J2 Schleichen + Stab auf eine Kiste → Kopf → „Entnehmen…“ → Kohle → MisaBot holt 16 Kohle aus genau dieser Kiste; J3 Stab auf eine Kuh → „4 jagen“; J4 Mehr… → Heim; J5 Übersicht → Einstellungen → Seitenleiste aus/an; J6 Karte → Zoom-Karten und Köpfe, kein Textfenster mehr.
- [ ] **Step 5: Final checks, all must pass:** full suite, `nix build .#checks.x86_64-linux.botui`, stand e2e, lab build from a bandit-nix worktree on origin/main: `nix build --override-input bandit-craft "git+file:///home/vino/src/bandit-craft-fleet?rev=<HEAD>" .#nixosConfigurations.bandit-lab.config.system.build.toplevel`. Expected: exit 0 each, no e2e assertion error.
- [ ] **Step 6: Commit** `refactor(mcbots): retire the dialog screens; coverage ledger, runbook and test guides for part 2b`.

## Risks for the owner (in-game, after the deploy)

- The Paper restart (Task 6) must land when nobody plays; the hub keeps working with the old plugin until then (ghost and sneak are ignored, marks still set, placement falls back to "Wo ich stehe" / "Markierte Stelle").
- `BlockDisplay` glow and translucency on ViaVersion clients older than 1.19.4: the display entity does not exist there, the particle outline still shows. Misa's client version decides whether she sees the ghost.
- `getTargetBlockExact(64)` follows the crosshair; a plan placed on a slope has its origin on the gazed block, the bot digs and fills as the build job always did (owner test C warning).
- Enchanting needs experience: a bot with few levels fails with `need level N` in the status text; whether bots should grind XP is an open question.

## Open questions for the owner

1. Should bots earn XP for enchanting (mob grinding, mining) or is a failing "zu wenig Erfahrung" acceptable for now?
2. Meldungen (spyglass, unread count) and Essen (bread) from the spec's overview/bot page: there is no `eat` job and no unread store; part 2c or drop?
3. Marks expire after 6 h (hub memory). Should they be written to `STATE_DIR` so a hub restart keeps them?
