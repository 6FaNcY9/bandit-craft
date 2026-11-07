# Bot menus, part 2a: crafting look-alike, furnace window, Holen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build-order step 4 of the spec, without enchanting. The bot page gets Herstellen, Schmelzen and Holen. Herstellen opens a chest screen that looks like a crafting table (3×3 recipe, result slot with the count), Schmelzen opens a real `MenuType.FURNACE` view (input, fuel, output preview), Holen opens the item grid and orders `get`. Sneak + right click with the staff on a crafting table or a furnace opens the matching window. Every order goes through the existing `craft`, `smelt` or `get` job.

**Architecture:** The plugin's `/menu` learns a third type, `furnace`, opened with `MenuType.FURNACE` (the spike found it clean). Its top inventory has no `MenuHolder`, so open menus are tracked per player in a map and every menu handler asks that map instead of `instanceof MenuHolder`. A recipe-book click on any of our views is cancelled. The hub keeps the part 1 shape: renderers in `botui-menus.js`, state and actions in `botui.js`, orders through `botui-jobs.js` `build` and `api.submit`. Recipe cells come from `minecraft-data` through one new helper in `recipes.js`; the bot's inventory comes from the snapshot as in `invm`.

**Tech Stack:** Paper 26.2 plugin (Java 25, `minecraft/botui/BotUi.java`), Node 24 hub (`mcbots/app`), mineflayer stand e2e (`tools/botui-stand`), `minecraft-data` 26.1 (already a dependency of `recipes.js`).

**Spec:** `docs/superpowers/specs/2026-11-06-bot-menus-design.md` (sections "The vanilla windows", "Plugin side", "Hub side", build-order step 4). Spike: `docs/runbooks/minecraft/botui-menu-spike.md`. Part 1: `docs/superpowers/plans/2026-11-06-bot-menus-part1.md`.

**Out of scope (part 2b):** 3D area ghost, enchanting, Meldungen, Essen.

## Global Constraints

- Paths below are relative to `hosts/bandit-lab/services/` unless they start with `tools/` or `docs/`.
- No client mods and no resource pack. Display items must never be takeable: every click and drag on a menu view is cancelled, including the furnace view and recipe-book placements.
- The viewer is the Bukkit player, never a payload field. Every bot named in a payload goes through `oneBot` / `allowedBots` (`mcbots/app/botui.js`). Every order goes through `jobs.build` and `api.submit`, exactly as `ACTIONS.send` and `shiftgo` do today.
- Guests (Misa) see and command only their bots. Every new action gets a test with a guest viewer.
- German UI text, at most three tooltip lines. No cycle buttons. Amounts in this part are only click = one batch / shift-click = as many as possible (and 16 / 64 for Holen).
- A closed screen never re-opens by itself: a hub refresh with `refresh: true` must be refused once the player closed it. This holds for the furnace view too.
- Commits: unsigned in this worktree (`git -c commit.gpgsign=false commit`), ending with the two lines `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01WeVYxVoPuoRW17SkJQUECp`.
- Tests: from `mcbots/app` run `NODE_PATH=/nix/store/zr4ddgnrpj4laxhhby300nslbyx1ld32-mcbots-0.1.0/lib/node_modules/mcbots/node_modules node test/<topic>.js`. The full suite is `node test.js` with the same `NODE_PATH`. `test/goto-crafting.js:41` is a known timing flake under full-suite load; rerun it alone.
- Plugin: from the repo root run `nix build .#checks.x86_64-linux.botui` (it compiles with `-Xlint:all -Werror`: a deprecated API needs `@SuppressWarnings("deprecation")` on that handler). Stand e2e, from the repo root with the same `NODE_PATH`: `tools/botui-stand/stand.sh up && node tools/botui-stand/e2e-bridge.js; tools/botui-stand/stand.sh down`.

## Review Focus

1. **The furnace view leaks an item.** Shift-click on the output, number key onto the input, drag over the fuel slot, double-click collect, and a recipe-book placement. Expected: nothing moves in either half, no event except `click` on a payload slot. Pinned in Task 1 (stand e2e; the recipe book only by the owner's in-game check, see Risks).
2. **A refresh after Escape on the furnace view.** Expected: `{ok: false, feedback: 'closed'}`, the window stays closed. Pinned in Task 1.
3. **The crafting preview and the order disagree.** The preview says "3 batches" but the bot lacks a stick: the order must still succeed through `get`, never fail silently. Expected: the result click routes to `craft` only when every ingredient of that many batches is in the snapshot inventory, else to `get`. Pinned in Task 2.
4. **A guest forges `{a: 'craftgo', bot: 'bot1'}` or `{a: 'pickitem', item: 'bedrock'}`.** Expected: the existing rights error, or `unbekanntes Item`; nothing submitted. Pinned in Tasks 2 and 3.
5. **Staff on a furnace without sneaking.** Expected: the furnace opens as in vanilla, no menu (the plugin's `usable` rule, unchanged). With sneaking: our window. Pinned in Task 4 (hub routing test) and by the owner in game.

## My calls

- Crafting is a chest look-alike (spike: CRAFTING recomputes the result slot and has a recipe-book risk). Layout, 3 rows: grid at slots 1-3 / 10-12 / 19-21, `arrow` "ergibt" at 14, result at 15, bot head at 8 (display only), `crafting_table` "Anderes Item…" at 17, Zurück at 26.
- "Greyed out" ingredient = `gray_stained_glass_pane` named after the ingredient (vanilla cannot grey a real item), lore `Fehlt: <have>/<need> · der Bot holt oder macht es selbst`. Present ingredients are the real item with the needed count.
- Recipe = the first `minecraft-data` recipe of the item (shaped `inShape` as given; shapeless `ingredients` laid out from slot 0). Torch therefore shows coal, not charcoal.
- Result click = 1 batch (`result.count` items), shift = `batches × result.count` from the snapshot inventory, capped at 64 (`craft` VALIDATE max); 0 batches → 1 batch via `get`. The job is `craft` when the inventory covers every ingredient for that many batches, else `get` (resolves chains, fetches fuel).
- Furnace: input click opens the grid in smelt mode; fuel shows the first `crafting.FUELS` entry the bot carries, else the grey pane "Kein Brennstoff dabei · der Bot besorgt ihn"; output = `SMELT` reverse of the input. Output click = 8, shift = everything carried (cap 64). With input and fuel in the inventory → `smelt`, else → `get` of the result item. The flame (`FurnaceView#setBurnTime`) is not animated.
- Holen has no window of its own: the grid in get mode orders on the click, 16 items, shift = 64. Tabs Werkzeug / Bau / Essen / Rohstoffe from `jobs.ITEMS ∪ jobs.CRAFTS`.
- The head in the crafting and furnace windows does not switch the bot yet (shortcut comment; the bot page is one click away). The default bot is the one the viewer used last (`st.lastBot`), as in the shift window.
- The recipe-book guard uses `com.destroystokyo.paper.event.player.PlayerRecipeBookClickEvent` (verified in `paper-api-26.2.build.130-stable.jar`: `implements Cancellable`; the `org.bukkit` twin is not cancellable). A raw-protocol client cannot click the recipe book, so the stand only proves the handler compiles and the view stays clean under ordinary clicks.

---

### Task 1: Plugin `/menu` type `furnace`, tracked views, recipe-book guard

**Files:**
- Modify: `minecraft/botui/BotUi.java` (`MenuHolder` ~315, `menuOf` ~336, `menuItem`/`applyMenu` ~359-416, `menu` validation ~418, `onMenuClick`/`onMenuCreative`/`onMenuDrag`/`onMenuClose` ~479-509; imports)
- Test: `tools/botui-stand/e2e-bridge.js` (menu block ~165; line 168 asserts `type: 'furnace'` → 400 and must flip)

**Interfaces:**
- Consumes: part 1's `/menu` contract, `emit`, `sync`, `switching`, `pending`.
- Produces (hub → plugin): `POST /menu` accepts `type: "furnace"`; `rows` is ignored, slots are `0` input, `1` fuel, `2` output; same slot fields as before. Reply contract unchanged (`{ok: true}`, `{ok: false, feedback: "closed"}`, 400 `bad menu`).
- Internal:
  - `private final Map<UUID, MenuHolder> menus` — the menu each player has open (chest, hopper and furnace alike). `MenuHolder` gains nothing; `h.inv` is the view's top inventory.
  - `private MenuHolder menuOf(Player p)` → `menus.get(id)` when its `inv` is `p.getOpenInventory().getTopInventory()`, else null (replaces the `instanceof MenuHolder` check).
  - `private MenuHolder menuOf(InventoryView v)` → the same check for an event's view; every menu event handler uses it.
  - `applyMenu`: for `furnace`, `FurnaceView view = MenuType.FURNACE.builder().title(Component.text(title)).build(p)` then `p.openInventory(view)` inside `switching`; `h.inv = view.getTopInventory()`. "Same menu" updates set the 3 slots in place. The entry is removed from `menus` in `onMenuClose` and in `closeMenu`.
  - `@EventHandler(priority = HIGHEST) onRecipeBook(PlayerRecipeBookClickEvent e)`: `if (menuOf(e.getPlayer()) != null) e.setCancelled(true)`.

- [ ] **Step 1: Extend the e2e (failing).** Replace line 168 with a furnace block after the hopper test:
  - `/menu {type: 'furnace', title: 'Ofen', slots: [{slot: 0, item: 'raw_iron', name: 'Roheisen', payload: {a: 'in'}}, {slot: 1, item: 'coal', name: 'Kohle', payload: {a: 'fuel'}}, {slot: 2, item: 'iron_ingot', name: 'Eisenbarren', count: 8, payload: {a: 'out'}}]}` → `{ok: true}`; `c.bot.currentWindow.type === 'minecraft:furnace'`; `c.win.items.length === 3 + 36`; `nameAt(c, 2) === 'iron_ingot'`.
  - `c.clickWindow(2, 0, 0)` → event `click` `{a: 'out', shift: false}`; `c.clickWindow(2, 0, 1)` → `{a: 'out', shift: true}`.
  - `c.clickWindow(0, 0, 2)` (number key), `c.clickWindow(1, 0, 5)`-drag, `c.clickWindow(39, 0, 1)` (shift-click own hotbar) → no event within 1500 ms, `JSON.stringify(c.inv)` unchanged.
  - Same title again with slot 2 `count: 16` → updated in place (`c.windows.length` unchanged), no `closed`.
  - A chest `/menu` while the furnace is open → no `closed` (switch); then the client closes → one `closed`; `/menu {type: 'furnace', refresh: true}` → `{ok: false, feedback: 'closed'}`.
  - `/menu {type: 'furnace', slots: [{slot: 3, ...}]}` → 400.
- [ ] **Step 2: Run the stand e2e.** Expected: FAIL at the first furnace assertion (today 400).
- [ ] **Step 3: Implement** the `menus` map, both `menuOf` overloads, the furnace branch in `applyMenu` and `menu` (size 3, `rows` ignored, `"furnace".equals(type)` joins the type check), the handler rewrite to `menuOf(e.getView())`, and `onRecipeBook`. Imports: `org.bukkit.inventory.MenuType`, `org.bukkit.inventory.InventoryView`, `org.bukkit.inventory.view.FurnaceView`, `com.destroystokyo.paper.event.player.PlayerRecipeBookClickEvent`. If javac reports the Paper event as deprecated, add `@SuppressWarnings("deprecation")` to that one handler and a one-line comment why.
- [ ] **Step 4: Run** `nix build .#checks.x86_64-linux.botui` and the stand e2e. Expected: build passes; e2e prints its final ok line with no assertion error.
- [ ] **Step 5: Commit** `feat(botui): /menu furnace view, tracked menu views, recipe-book clicks cancelled`.

### Task 2: Item grid modes, recipe helper, crafting look-alike

**Files:**
- Modify: `mcbots/app/recipes.js` (export one helper next to `cells`), `mcbots/app/botui-menus.js` (`TABS`/`gridPage` ~90-114, `RENDER` ~125, exports), `mcbots/app/botui.js` (`formOf` ~45, ACTIONS `gridm`/`pickblock` ~114-118, new actions)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- `recipes.js`: `recipeGrid(item, version = '26.1') -> {cells: string[9] (item name or null per 3×3 cell), per: number} | null`. Shaped recipes keep their `inShape` position (top-left anchored); shapeless ones fill from cell 0.
- `botui-menus.js`:
  - `haveOf(snap) -> {[item]: count}` parsed from `snap.inventory` lines `"<name> xN"` (the regex `inventoryPage` uses today; reuse it there).
  - `ITEM_TABS = {werkzeug: ['stone_pickaxe', 'iron_pickaxe', 'iron_sword', 'bucket'], bau: ['oak_planks', 'stick', 'torch', 'chest', 'crafting_table', 'furnace'], essen: ['bread'], rohstoffe: ['coal', 'raw_iron', 'iron_ingot', 'cobblestone', 'oak_log']}`, `ITEM_TAB_ICON` likewise.
  - `GRID_MODES = {block: {tabs: TABS, icons: TAB_ICON, pick: 'pickblock', key: 'block'}, craft: {tabs: ITEM_TABS filtered to jobs.CRAFTS, empty tabs dropped}, smelt: {tabs: {schmelzgut: jobs.SMELTS}}, get: {tabs: ITEM_TABS}}`; every item mode uses `pick: 'pickitem', key: 'item'`. `gridPage(view, screen)` reads `screen.mode` (default `'block'`); only block mode shows "Zeig drauf"; the back slot goes to `screen.back` (`shiftm` | `craftm` | `smeltm` | `botm`). In get mode the item lore is `Klick: 16 holen · Shift: 64`.
  - `craftPage(view, screen)` renders `view.make` (`{kind: 'craft', bot, item}`) with `recipeGrid` and `haveOf`: ingredient slots as in My calls, result slot `{item, count: max(1, min(64, batches × per)), lore: [batches ? `${batches}× möglich · Klick: 1 · Shift: alle` : 'Zutaten fehlen · der Bot besorgt sie'], payload: {a: 'craftgo'}}`; no item chosen → the 3×3 is empty and slot 15 is `crafting_table` "Was herstellen? Klick" → `{a: 'gridm', mode: 'craft', tab: 'werkzeug', page: 0, back: 'craftm'}`. Title `Herstellen: <bot>`.
  - Exports add `haveOf, ITEM_TABS, GRID_MODES`.
- `botui.js`:
  - `botOf(st, ui, viewer, bot)` → the payload's bot through `oneBot`, else `st.lastBot`, else the viewer's first bot; sets `st.lastBot`. `formOf` uses it (line 47 moves into it).
  - `st.make = {kind: 'craft'|'smelt', bot, item: null}` per viewer; `view.make` is passed in `render` next to `form`.
  - ACTIONS: `craftm {bot?}` (sets `st.make` for `craft`, keeps the item when the bot is unchanged, screen `craftm`); `gridm {mode?, tab, page, back?}` stores them on the screen; `pickitem {item}`: the item must be in the active mode's tabs (else `unbekanntes Item`); craft/smelt → `st.make.item = item`, screen back to `craftm`/`smeltm`; get → Task 3. `craftgo {shift}`: `n = shift ? max(1, batches) : 1` batches × `per`, capped 64; `jobs.build(covered ? 'craft' : 'get', {who: bot, item, n}, env)` → `api.submit` → `done` → flash `${bot}: ${o.say}` → screen `botm`.
  - `pure helper craftOrder(make, snap) -> {key: 'craft'|'get', item, n}` exported for the test (`module.exports` already exposes `ACTIONS`).

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `recipeGrid('stone_pickaxe').cells` equals `['cobblestone','cobblestone','cobblestone', null,'stick',null, null,'stick',null]`, `per === 1`; `recipeGrid('oak_planks').per === 4`; `recipeGrid('bedrock') === null`.
  - `craftm` for a bot with inventory `['cobblestone x5', 'stick x1']` and item `stone_pickaxe`: slot 1 is `cobblestone` count 1 with no lore, slot 19 is `gray_stained_glass_pane` named `Stock` with a lore line starting `Fehlt: 1/2`, slot 15 is `stone_pickaxe` count 1 with lore `Zutaten fehlen · der Bot besorgt sie`, payload `{a: 'craftgo'}`.
  - Same bot with `stick x8`: slot 15 count 1 and lore `1× möglich · Klick: 1 · Shift: alle`; `oak_planks` with `oak_log x3`: result count 12, lore starts `3× möglich`.
  - `gridm` in craft mode lists no `bread` and no `essen` tab; every listed item is in `jobs.CRAFTS`; get mode lists `bread` and `coal`; smelt mode lists exactly `jobs.SMELTS`.
  - Every slot payload `a` is a key of `ACTIONS` (extend the existing loop over screens with `craftm` and the three grid modes).
  - `test/botui.js`: `pickitem {item: 'bedrock'}` flashes `Fehler: unbekanntes Item` and posts no `/api` submit; `craftgo` from the owner with a covered recipe submits type `craft` with `args {item: 'stone_pickaxe', count: 1}`; with `shift: true` and 3 batches → count 3; with a missing ingredient → type `get`; a guest `craftm {bot: 'bot1'}` throws the existing rights error (flash starts `Fehler:`), nothing submitted.
- [ ] **Step 2: Run** `node test/botui-menus.js` and `node test/botui.js`. Expected: FAIL (`recipeGrid is not a function`, then unknown screens).
- [ ] **Step 3: Implement** the helper, the grid modes, `craftPage`, `botOf`, the actions and `craftOrder`.
- [ ] **Step 4: Run both tests, then the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): crafting window as a chest look-alike; item grid with craft/smelt/get tabs`.

### Task 3: Furnace window and Holen

**Files:**
- Modify: `mcbots/app/botui-menus.js` (`RENDER`, new `smeltPage`), `mcbots/app/botui.js` (ACTIONS `smeltm`, `smeltgo`, `pickitem` get branch; `post` must accept `type: 'furnace'` unchanged)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- Consumes: Task 1's furnace `/menu`, Task 2's `GRID_MODES`, `haveOf`, `botOf`, `st.make`; `recipes.SMELT`, `crafting.FUELS`.
- `botui-menus.js`:
  - `SMELT_RESULT = Object.fromEntries(Object.entries(SMELT).map(([out, inp]) => [inp, out]))` (so `raw_iron → iron_ingot`, `oak_log → charcoal`, `sand → glass`, `cobblestone → stone`).
  - `fuelOf(have) -> item | null` = first of `FUELS` with `have[f] > 0`.
  - `smeltPage(view, screen)` → `{type: 'furnace', title: 'Schmelzen: <bot>', slots}`: slot 0 = the chosen input (count = `min(64, have[input])` or 1, lore `Klick: anderes Schmelzgut`) or `stick` "Was schmelzen? Klick" → `{a: 'gridm', mode: 'smelt', tab: 'schmelzgut', page: 0, back: 'smeltm'}`; slot 1 = fuel item with lore `Brennstoff: <germanName>` or the grey pane "Kein Brennstoff dabei · der Bot besorgt ihn" (payload `{a: 'smeltm'}`, display only); slot 2 = `SMELT_RESULT[input]` with `count: min(64, have[input]) || 8`, lore `Klick: 8 · Shift: alles was er hat`, payload `{a: 'smeltgo'}`; without an input slot 2 is absent.
- `botui.js` ACTIONS:
  - `smeltm {bot?}` like `craftm` with `kind: 'smelt'`.
  - `smeltgo {shift}`: no input → flash `Erst Schmelzgut wählen`; `n = shift ? min(64, max(1, have[input])) : 8`; key = `smelt` when `have[input] >= n && fuelOf(have)`, else `get` of `SMELT_RESULT[input]`; build → submit → flash → `botm`.
  - `pickitem` in get mode: `n = data.shift ? 64 : 16`, `jobs.build('get', {who: bot, item, n}, env)` → submit → flash → `botm`.
  - `smeltOrder(make, snap, shift) -> {key, item, n}` pure, exported like `craftOrder`.

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `smeltm` with `raw_iron x20, coal x3` and input `raw_iron`: `type === 'furnace'`, slot 0 `raw_iron` count 20, slot 1 `coal`, slot 2 `iron_ingot` count 20 payload `{a: 'smeltgo'}`; with no fuel slot 1 is `gray_stained_glass_pane`; with no input there is no slot 2 and slot 0 is `stick`.
  - `smeltOrder` cases: 20 raw_iron + coal, shift → `{key: 'smelt', item: 'raw_iron', n: 20}`; click → n 8; no fuel → `{key: 'get', item: 'iron_ingot', n: 8}`; 3 raw_iron, click → `get` (8 > 3).
  - `test/botui.js`: `smeltgo` submits type `smelt` args `{item: 'raw_iron', count: 8}`; `pickitem {item: 'bread'}` while the grid is in get mode submits `get` `{item: 'bread', count: 16}`, with `shift: true` count 64; a guest `smeltm {bot: 'bot1'}` throws; a `smeltm` click posts `/menu` with `type: 'furnace'`.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement** `smeltPage`, `fuelOf`, `SMELT_RESULT`, the actions and `smeltOrder`.
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): furnace window with input, fuel and output preview; Holen through the item grid`.

### Task 4: Bot page slots and the staff on a crafting table or furnace

**Files:**
- Modify: `mcbots/app/botui-menus.js` (`botPage` ~43-57), `mcbots/app/botui.js` (`handle` `open` routing ~390-400)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- Bot page row 2 becomes: 10 `diamond_pickaxe` Abbauen…, 11 `iron_axe` Holz holen, 12 `crafting_table` Herstellen… → `{a: 'craftm', bot}`, 13 `furnace` Schmelzen… → `{a: 'smeltm', bot}`, 14 `bricks` Bauen…, 15 `chest_minecart` Holen… → `{a: 'gridm', mode: 'get', tab: 'werkzeug', page: 0, back: 'botm', bot}` (the action calls `botOf` with `data.bot` so the grid orders for that bot), 16 `oak_sapling` Baumfarm. `GLINT` gains `craft: 'crafting_table'`, `smelt: 'furnace'`, `get: 'chest_minecart'`.
- `handle('open')` gains, after the `mineBot` branch and before the chest branch: `g.block === 'crafting_table'` → `ACTIONS.craftm(st, {}, this, viewer)`; `/^(furnace|blast_furnace|smoker)$/.test(g.block)` → `ACTIONS.smeltm(...)`. Both wrapped in the same try/flash as `shiftm`. The plugin already needs sneaking for a usable block (`BotUi.java` ~817), nothing changes there.

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: `botm` has slots 12 `crafting_table` with payload `{a: 'craftm', bot}`, 13 `furnace`, 15 `chest_minecart` with `mode: 'get'`; a bot whose job type is `craft` glints slot 12.
  - `test/botui.js`: an `open` with gaze `{block: 'crafting_table', x, y, z}` from the owner posts `/menu` with a title starting `Herstellen:`; gaze `blast_furnace` → `type: 'furnace'` and title `Schmelzen:`; a guest with gaze `furnace` and `allowed: ['MisaBot']` gets `Schmelzen: MisaBot`; a live `st.pick` still wins over a furnace gaze (flash `Das ist keine Kiste`, no `/menu`).
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement** the slots and the routing.
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): Herstellen, Schmelzen and Holen on the bot page; staff on a crafting table or furnace`.

### Task 5: Docs and final checks

**Files:**
- Modify: `docs/runbooks/minecraft/BOTS.md` ("Picture menus" subsection ~214: add the three windows and the staff rows, ≤ 6 lines), `docs/runbooks/minecraft/botui-coverage.md` (line 26: move `get`, `craft`, `smelt` to "covered by craftm / smeltm / gridm get"), `docs/guides/misa-test.de.html` (new section H "Herstellen, Schmelzen, Holen", 5-6 rows in the A1-G2 style), regenerate `docs/guides/misa-test.pdf` (`chromium --headless --password-store=basic --no-pdf-header-footer --print-to-pdf=docs/guides/misa-test.pdf docs/guides/misa-test.de.html`)
- Also: `docs/runbooks/minecraft/botui-menu-spike.md` gets one line: furnace shipped as `/menu` type `furnace` (2026-11-07), recipe-book guard via Paper's `PlayerRecipeBookClickEvent`.

- [ ] **Step 1: Update the docs** above. Test rows for Misa: H1 Werkbank-Icon → 3×3 of a Steinspitzhacke, fehlende Zutaten grau; H2 Klick aufs Ergebnis → "MisaBot: Steinspitzhacke herstellen" (oder "besorgen"); H3 Ofen-Icon → echtes Ofenfenster, Schmelzgut wählen, Ausgabe anklicken; H4 Rezeptbuch im Ofenfenster anklicken → nichts bewegt sich; H5 Schleichen + Rechtsklick auf eine Werkbank / einen Ofen → dasselbe Fenster; H6 Holen → Brot 16.
- [ ] **Step 2: Final checks, all must pass:** full suite (`node test.js`, rerun `test/goto-crafting.js` alone if it flakes), `nix build .#checks.x86_64-linux.botui`, stand e2e, and the lab build: from a bandit-nix worktree on origin/main run `nix build --override-input bandit-craft "git+file:///home/vino/src/bandit-craft-fleet?rev=<HEAD>" .#nixosConfigurations.bandit-lab.config.system.build.toplevel`. Expected: each exits 0; the e2e prints no assertion error.
- [ ] **Step 3: Commit** `docs(botui): crafting, furnace and Holen menus in the runbook, coverage list and Misa's test guide`.

## Risks for the owner (in-game, after the deploy)

- Recipe-book click inside the furnace window (test row H4): the stand cannot send it. Expected: nothing moves out of the player inventory, nothing lands in the view. If it does, the Paper event did not fire for the virtual view; fallback is to open the furnace with a `LocationInventoryViewBuilder.location(...)` far away or to make Schmelzen a chest look-alike like Herstellen.
- Sneak + right click on a furnace with the staff must open our window, a plain right click the real furnace (part 1's `usable` rule).
- The crafting preview trusts the snapshot inventory; a stale count only makes the preview count wrong, the job still checks for real (spec).
