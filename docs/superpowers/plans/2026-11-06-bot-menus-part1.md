# Bot menus, part 1: staff fix, chest menu, shift hopper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build-order steps 1-3 of the spec. The staff click works, or logs why it does not. `/bots` and a left click open a picture menu (overview, bot page, Wenn frei, inventory). A mining or wood shift is set up in a hopper window by clicking icons or by pointing at a block or chest.

**Architecture:** The plugin gets a generic `/menu` call that opens chest or hopper inventories filled with display items and reports slot clicks as `click` events carrying the slot's payload. The hub renders the new screens in a new `botui-menus.js` and routes them through the existing `BotUi` state machine (`botui.js`). Orders still go through `botui-jobs.js` `build` and `api.submit`. The old dialogs stay reachable from the overview.

**Tech Stack:** Paper 26.2 plugin (Java, `minecraft/botui/BotUi.java`), Node 24 hub (`mcbots/app`), mineflayer stand e2e (`tools/botui-stand`).

**Spec:** `docs/superpowers/specs/2026-11-06-bot-menus-design.md`. Part 2 (crafting and furnace windows, 3D area, enchanting) gets its own plan once Task 2's spike report exists.

**Deferred, with reasons:**
- Part 2 gets the bot-page slots Herstellen, Schmelzen, Verzaubern and Holen, because they need the crafting and furnace windows or the item grid with amounts.
- "Meldungen" in the overview is dropped for now: alerts already arrive in chat.
- "Essen" is dropped: bots eat by themselves (`upkeep`).

## Global Constraints

- Paths below are relative to `hosts/bandit-lab/services/` unless they start with `tools/` or `docs/`.
- No client mods and no resource pack. Display items must never be takeable: every click and drag on a menu view is cancelled.
- The viewer is the Bukkit player, never a payload field. Every bot named in a payload goes through `oneBot` / `allowedBots` (`mcbots/app/botui.js`). Every order goes through `jobs.build` and `api.submit`, exactly as `ACTIONS.send` does today.
- Guests (Misa) see and command only their bots. "Alle" means the viewer's bots (`stopTargets`).
- German UI text, at most three tooltip lines. No cycle buttons, except the four amounts 16/64/256/∞ in the shift window.
- A closed screen never re-opens by itself: a hub refresh with `refresh: true` must be refused once the player closed it.
- Commits: unsigned in this worktree (`git -c commit.gpgsign=false commit`), ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: from `mcbots/app` run `NODE_PATH=/nix/store/zr4ddgnrpj4laxhhby300nslbyx1ld32-mcbots-0.1.0/lib/node_modules/mcbots/node_modules node test/<topic>.js`. The full suite is `node test.js` with the same `NODE_PATH`. `test/goto-crafting.js:41` is a known timing flake under full-suite load; rerun it alone.
- Plugin: from the repo root run `nix build .#checks.x86_64-linux.botui` (it compiles). Stand e2e, from the repo root with the same `NODE_PATH`: `tools/botui-stand/stand.sh up && node tools/botui-stand/e2e-bridge.js; tools/botui-stand/stand.sh down`.

## Review Focus

1. **A player moves items into or out of a menu** (shift-click from their own inventory, number keys, the offhand key, drag, double-click collect). Expected: nothing moves, and no item reaches the player. Pinned in Task 2 by a stand e2e.
2. **A hub refresh arrives after the player closed a menu with Escape.** Expected: the menu stays closed. Pinned in Task 2 (e2e) and Task 3 (hub test).
3. **Menu → menu navigation** (head → bot page → back). Expected: no spurious `closed` event, and the hub keeps the viewer's state. Pinned in Task 2 (e2e) and Task 3.
4. **A guest sends a forged payload naming the owner's bot.** Expected: refused with the existing German error, nothing submitted. Pinned in Tasks 4 and 5.
5. **A pick mode ("zeig auf eine Kiste") is answered late or never** (after 60 s, after quit, by aiming at air or at a non-chest). Expected: no order, one German flash or action-bar line, and the mode ends. Pinned in Task 5.

---

### Task 1: Staff click — evidence and the staff in hand

**Files:**
- Modify: `minecraft/botui/BotUi.java` (`onCommand` ~495, `onLeft` ~534, `onUse` ~544)
- Test: `tools/botui-stand/e2e-bridge.js` (staff block ~115)

**Interfaces:**
- Produces: plugin log lines `staff: <player> <action> <hand> ignored: <reason>` (reason one of `not viewer`, `no staff in main hand (<material>, tagged=<bool>)`, `offhand`). They are rate-limited to one per player per 2 s, so the owner's next click on the lab tells us the cause.

- [ ] **Step 1: Extend the e2e first (failing).** After `c.command('zauberstab')`, assert that the held item is the staff: `c.bot.heldItem?.name === 'stick'`, and that its custom name contains `Zauberstab`. Also assert that a chat line contains `Zauberstab` and `Hand`.
- [ ] **Step 2: Run the stand e2e.** Expected: FAIL on the held-item assertion.
- [ ] **Step 3: Put the staff in the hand.** In `onCommand` for `zauberstab`: if the selected hotbar slot is empty, put the staff there. Otherwise move the held item into a free slot and then put the staff in the hand. If the inventory is full, keep today's "Inventar voll". Then send `Der Zauberstab ist jetzt in deiner Hand. Linksklick: Übersicht · Rechtsklick: auf etwas zeigen`.
- [ ] **Step 4: Log why a staff-like click was ignored.** In `onLeft` and `onUse`, when the player is holding a `STICK` (either hand) but the handler returns early, log once per 2 s per player at INFO with the reason format above. Clicks with other items log nothing.
- [ ] **Step 5: Accept the staff in the off hand too.** A click whose hand is `OFF_HAND` while the main hand is not a staff, and the off hand is, opens the same as a main-hand click. Reason: the real-client report could be an off-hand staff, and refusing it gains nothing.
- [ ] **Step 6: Run the stand e2e and the plugin check.** Expected: PASS, and the build passes.
- [ ] **Step 7: Commit** `fix(botui): staff goes into the hand, off-hand staff works, ignored staff clicks are logged`.

### Task 2: Plugin `/menu` — chest and hopper menus, action bar, spike

**Files:**
- Modify: `minecraft/botui/BotUi.java` (route table ~198; new handlers next to `show`/`close`; event handlers next to `onMove`)
- Test: `tools/botui-stand/e2e-bridge.js` (new block after the dialog tests)
- Create: `docs/runbooks/minecraft/botui-menu-spike.md` (spike report only)

**Interfaces:**
- Consumes: the existing `emit(type, player, data)`, `open` set, `sync(...)`, `NAME`, `str(...)`, `MAX_BODY`.
- Produces (hub → plugin):
  - `POST /menu {player, type: "chest"|"hopper", title, rows?: 1..6, refresh?: bool, slots: [{slot, item, name, lore?: [string], count?: 1..99, damage?, maxDamage?, head?: string, glint?: bool, payload: object}]}`. Reply: `{ok: true}`, `{ok: false, feedback: "closed"}` (refresh after a close), or HTTP 400 `player not online` / `bad menu`. `item` is a namespaced or bare item id. An unknown id renders as `PAPER` with the given name and never fails the whole menu. `head` = a player name: use the online player's profile if that player is online, else a plain head. `maxDamage` + `damage` draw the durability bar (max stack size 1).
  - `POST /actionbar {player, text}` → `{ok: true}`.
  - `/show` while a menu is open, and `/menu` while a dialog is open: close the other UI first (no `closed` event, because it is a switch) and open the new one on the next tick.
- Produces (plugin → hub events):
  - `click` with `data = {...slotPayload, shift: true|false}` for a click on a menu slot that has a payload. Clicks on empty slots or the player's own inventory are cancelled and send nothing.
  - `closed` when the player closes a menu, except on a hub-initiated switch or replace (`InventoryCloseEvent.Reason.OPEN_NEW` or the plugin's own switch).
- Behaviour: a `/menu` with the same type, rows and title as the menu the player has open updates the slots in place, without reopening (no flicker, cursor kept). A `/menu` with `refresh: true` is refused (`feedback: "closed"`) unless that player has a menu open.

- [ ] **Step 1: Write the e2e block (failing).**
  - `/menu` a 3-row chest titled `Test` with slot 4 = `iron_ore`, payload `{a: 'x', n: 1}` → the client sees a window whose slot 4 is iron_ore.
  - `c.bot.clickWindow(4, 0, 0)` → event `click` with `data` `{a: 'x', n: 1, shift: false}`, and the client's inventory is unchanged.
  - Shift-click (mode 1) on a slot of the client's own inventory that holds an item → no event, and the client's inventory is unchanged.
  - Number-key swap (mode 2) onto slot 4 → no event, and nothing moved.
  - `/menu` again with the same title and a changed slot 4 (`gold_ore`) → no `closed` event, and slot 4 becomes gold_ore.
  - `/menu` with title `Other` → no `closed` event.
  - The client closes the window → one `closed`. A `/menu` with `refresh: true` after that returns `{ok: false, feedback: 'closed'}`.
  - `/menu` with item `no_such_item` → `{ok: true}`, and the slot shows paper.
  - `/actionbar` → `{ok: true}`.
  - A hopper `/menu` with 5 slots opens a 5-slot window.
- [ ] **Step 2: Run the stand e2e.** Expected: FAIL (404 on `/menu`).
- [ ] **Step 3: Implement the menu.**
  - A `MenuHolder implements InventoryHolder` keeps `type`, `rows`, `title` and `Map<Integer, JSONObject> payloads`.
  - Cancel `InventoryClickEvent` and `InventoryDragEvent` whenever the top inventory's holder is a `MenuHolder`. Use priority LOWEST and handle them even if already cancelled.
  - Track `InventoryCloseEvent` as above. Build items with `ItemMeta` (`displayName`, `lore`, non-italic), `Damageable#setMaxDamage` / `setDamage`, `setMaxStackSize(1)` when a bar is drawn, `setEnchantmentGlintOverride`, and `SkullMeta#setPlayerProfile`.
- [ ] **Step 4: Run the stand e2e and the plugin check.** Expected: PASS.
- [ ] **Step 5: Spike (no product code).** On the stand, try opening `MenuType.CRAFTING`, `MenuType.FURNACE` and `MenuType.ENCHANTMENT` for the client without a real block, fill the slots, and cancel the clicks. Note for each whether it opens, whether slots can be set, whether a cancelled result-slot click leaves a ghost item, and whether the recipe book interferes. Write the findings (5-15 lines) to `docs/runbooks/minecraft/botui-menu-spike.md`. Revert any spike code before committing.
- [ ] **Step 6: Commit** `feat(botui): /menu chest and hopper menus with click payloads, /actionbar` (plus the spike note).

### Task 3: Hub menu plumbing and the overview

**Files:**
- Create: `mcbots/app/botui-menus.js`
- Modify: `mcbots/app/botui.js` (`render`/`show`/`post` ~297-320, `handle` `lage` ~271, `tick` refresh ~329, ACTIONS)
- Test: create `mcbots/app/test/botui-menus.js` and register it in `mcbots/app/test.js`; extend `mcbots/app/test/botui.js` (fake plugin answers `/menu`, `/actionbar`)

**Interfaces:**
- Consumes: Task 2's `/menu` contract; the render view `render()` already builds (`{viewer, snaps, allowed, owner, idle, ctx, sel, flash, ...}`).
- Produces:
  - `botui-menus.js` exports `MENUS` (`Set` of screen names rendered as menus) and `menu(screen, view) -> {menu: {type, title, rows?, slots}}`, with one renderer per screen: `overview(view)` here; Tasks 4 and 5 add theirs.
  - Slot helper `slot(i, item, name, payload, extra?)`.
  - Activity badge: `badgeOf(snap) -> item id`. The mapping is mine/shift → `diamond_pickaxe`, chop/shiftlogs/treefarm → `iron_axe`, guard → `iron_sword`, follow → `lead`, trade → `emerald`, keeper → `clock`, idle → no badge (shown in the tooltip only, because a slot holds one item).
  - In `botui.js`: `render` returns `menus.menu(...)` when `menus.MENUS.has(st.screen.name)`. `post` sends `{menu}` objects to `/menu` (with `refresh` as today) and dialogs to `/show`. The `lage` event and `/bots` now open `{name: 'ov'}`. ACTIONS gains `ov: (st) => { st.screen = {name: 'ov'}; }` and `oldmenu: (st) => { st.screen = {name: 'lage'}; }`.
  - `REFRESHING` gains `ov`.
- Overview layout (6 rows):
  - Rows 1-4 hold one head per allowed bot, sorted by name. Each head has `head: <bot>`, `maxDamage: 20`, `damage: 20 - hp`, and the name `<bot>`. Lore: activity (≤ 40 chars), `♥ <hp>/20`, and `Wenn frei: <label>` when set.
  - Payload `{a: 'botm', bot}`. Head slots go at even positions of rows 1-4; the slot to the right of each head shows the badge item when there is one.
  - Bottom row:
    - slot 45: `barrier` "Alle: Stopp" → `{a: 'stopall'}` for the owner (existing confirm dialog), `{a: 'stopmine'}` for a guest (stops the guest's bots via `stopTargets`).
    - slot 46: `ender_pearl` "Alle: Komm zu mir" → `{a: 'comeall'}` (`summon` for every allowed online bot).
    - slot 49: `map` "Karte" → `{a: 'karte'}`.
    - slot 51: `writable_book` "Bauplan hochladen" → `{a: 'upload'}`.
    - slot 53: `book` "Alle Befehle (alt)" → `{a: 'oldmenu'}`.

- [ ] **Step 1: Write failing tests.**
  - `test/botui-menus.js`: the owner view with 3 snaps (one idle, one mining with hp 14, one offline) has 3 head slots, the mining bot's badge is `diamond_pickaxe` with `damage: 6`, and slot 45's payload is `{a: 'stopall'}`.
  - A guest view with `allowed: ['MisaBot']` shows only MisaBot, and slot 45's payload is `{a: 'stopmine'}`.
  - Every slot has a payload with `a` that is a key of `ACTIONS`.
  - `test/botui.js`: a `lage` event posts `/menu` (not `/show`) with a title containing `Bots`.
  - A `click` `{a: 'botm', bot: 'bot1'}` from the owner posts `/menu` again.
  - A `closed` event followed by a tick makes no `/menu` call.
  - A refresh answered `{ok: false, feedback: 'closed'}` sets `open = false` and logs nothing.
  - `stopmine` from a guest submits `stop` only for the guest's bots.
- [ ] **Step 2: Run** `node test/botui-menus.js` and `node test/botui.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `botui-menus.js` (`MENUS`, `menu`, `slot`, `badgeOf`, `overview`) and the `botui.js` routing and actions above. Add `stopmine` and `comeall` to ACTIONS, using `stopTargets` / `allowedBots` and `api.submit`.
- [ ] **Step 4: Run both tests, then the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): picture overview menu for /bots and the staff`.

### Task 4: Bot page, Wenn frei, inventory, staff on own bot and chest

**Files:**
- Modify: `mcbots/app/botui-menus.js`, `mcbots/app/botui.js` (ACTIONS, `handle` `open` ~273)
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- Consumes: Task 3's `menu`, `slot`, `MENUS`; `idle.js` `CHOICES`; `jobs.build`; snapshot fields `chest`, `inventory` (`"<name> xN"` strings), `health`, `food`, `activity`.
- Produces: screens `botm` (bot page, 3 rows), `idlem` (Wenn frei, 1 row), `invm` (inventory, 6 rows, read-only), and `chestm` (heads of the viewer's bots for a gazed chest). ACTIONS:
  - `botm {bot}`, `idlem {bot}`, `invm {bot}`.
  - `go {bot, job}` with `job` one of `followme | summon | guardhere | deposit | chop | treefarm`. Each is built with `jobs.build` on the keys `followme`, `summon`, `guard` (at = viewer pos, radius 16), `deposit` (at = the bot's `chest`, else the supply chest, else flash `Erst eine Kiste merken`), `chop` (n 64), and `treefarm` (zone resolved the way `server.js` feeds `treefarmZone` to `idle.resolveIdle`).
  - `chestfor {bot}` submits `setchest` at `st.ctx.gaze` for that bot, the same way `send` does for key `setchest`.
  - `idle_set` returns to `botm` when its payload carries `m: 1`.
- Bot page layout:
  - Row 1: head (lore: activity, `♥ hp/20 · Essen food/20`, `Kiste: x y z` or `Kiste: keine`); `lead` Folg mir; `ender_pearl` Komm her; `iron_sword` Bewach diesen Ort; `chest` Einlagern; `barrier` Stopp (`{a: 'stop', bot}`).
  - Row 2: `diamond_pickaxe` Abbauen… (`{a: 'shiftm', bot}`, Task 5); `iron_axe` Holz holen; `bricks` Bauen… (`{a: 'job', key: 'schematic', bot}`, the existing dialog); `oak_sapling` Baumfarm.
  - Row 3: `clock` Wenn frei… (lore: the current label); `hopper` Kiste merken (`{a: 'pick', kind: 'chest', bot}`, Task 5); `barrel` Inventar; `arrow` Zurück (`{a: 'ov'}`).
  - The slot of the running job type gets `glint: true`.
- Wenn frei: one slot per `CHOICES` entry the viewer may pick, plus `barrier` Nichts. The items are holz `spruce_log`, stein `cobblestone`, baumfarm `oak_sapling`, wache `iron_sword`, keeper `clock` (owner bots only). The active one has `glint`. Lore is one line explaining it (e.g. `fällt Bäume und füllt seine Kiste`).
- Inventory: the snapshot inventory as items with counts (count capped at 64 per slot, name `<germanName> ×N`), read-only payload `{a: 'invm', bot}`, plus Zurück.
- Staff routing in `handle('open')`:
  - aimed at an allowed bot → `botm`.
  - gaze block is a chest or barrel (`jobs.isChest`) → `chestm`.
  - anything else → unchanged for now (Task 5 adds minable blocks).
  - Sneak-to-use is already handled by the plugin.

- [ ] **Step 1: Write failing tests.**
  - `botm` for a mining bot glints the Abbauen slot.
  - `go {job: 'deposit'}` without any chest flashes `Erst eine Kiste merken` and submits nothing.
  - `go {job: 'followme'}` submits `follow` with `player: viewer`.
  - A guest `go {bot: 'bot1'}` throws the existing rights error and submits nothing.
  - `idlem` for a guest bot has no `clock` slot.
  - `idle_set {m: 1}` returns to `botm`.
  - `invm` renders `iron_ingot ×70` as one slot with count 64 and the name `Eisenbarren ×70`.
  - An `open` event aimed at the player entity `MisaBot` from viewer `midaribread` renders `botm`.
  - An `open` with a chest gaze renders `chestm` with MisaBot's head only.
  - `chestfor` submits `setchest` with the gaze coordinates.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement** the renderers, ACTIONS and routing above.
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): bot page, Wenn frei and inventory as picture menus; staff on a bot or chest`.

### Task 5: Shift hopper, block grid, pick modes, staff on a block

**Files:**
- Modify: `mcbots/app/botui-menus.js`, `mcbots/app/botui.js`
- Test: `mcbots/app/test/botui-menus.js`, `mcbots/app/test/botui.js`

**Interfaces:**
- Consumes: Task 4's `botm`; Task 2's `/actionbar` and `close`; `jobs.BLOCKS`, `jobs.germanName`, `jobs.build`.
- Produces:
  - Per-viewer `st.form = {bot, block, amount, chest}` and `st.pick = {kind: 'block'|'chest', bot, until}`.
  - Screens `shiftm` (hopper), `gridm` (6 rows), `botpick` (heads).
  - Constant `AMOUNTS = [16, 64, 256, 'inf']`.
  - `TABS = {erze: [...the *_ore ids and ancient_debris from BLOCKS], holz: [the logs], stein: ['stone', 'cobblestone', 'deepslate'], erde: ['dirt', 'sand', 'gravel']}`. Every id comes from `jobs.BLOCKS`.
  - ACTIONS:
    - `shiftm {bot?, block?}`: start or keep `st.form`. bot = the payload's bot, else the viewer's last chosen bot, else the viewer's first bot. chest = the bot's `chest`, else the supply chest, else null. amount = `'inf'`.
    - `amount`: next entry of AMOUNTS.
    - `gridm {tab, page}`.
    - `pickblock {block}`: the block must be in `jobs.BLOCKS`, else throw `unbekannter Block`.
    - `botpick` / `setbot {bot}`.
    - `pick {kind, bot?}`.
    - `shiftgo`.
- Hopper slots (0-4):
  - 0: head of `form.bot` → `{a: 'botpick'}`.
  - 1: `form.block`, or `stick` "Was? Klick: aussuchen" → `{a: 'gridm', tab: 'erze', page: 0}`.
  - 2: the amount → `{a: 'amount'}`. It shows `form.block` with count 16/64, or 1 with the name `256` / `∞ immer weiter`.
  - 3: `barrel` "Wohin: x y z", or `barrier` "Keine Kiste – klick und zeig auf eine" → `{a: 'pick', kind: 'chest'}`.
  - 4: `lime_dye` "Los!" → `{a: 'shiftgo'}`.
- Grid:
  - Top row has the tab icons (`iron_ore`, `oak_log`, `stone`, `sand`); the active tab has `glint`.
  - Then come the viewer's last 4 picked blocks (memory only, newest first), then the tab's blocks.
  - Bottom row: `stick` "Zeig drauf" → `{a: 'pick', kind: 'block'}`, `arrow` Zurück → `{a: 'shiftm'}`.
- `shiftgo` mapping (built via `jobs.build`, then `api.submit`):

  | block | amount | job |
  | --- | --- | --- |
  | a log id | `'inf'` | key `shiftlogs` with chest |
  | a log id | a number | key `chop` with n |
  | other | `'inf'` | key `shift` with block + chest |
  | other | a number | key `mine` with block + n |

  - No block → flash `Erst einen Block wählen`.
  - `'inf'` without a chest → flash `Erst eine Kiste wählen`.
  - On success: flash `<bot>: <say>` and go to `botm`.
- Pick modes:
  - `pick` sets `st.pick` with `until = now + 60000`, closes the menu (`ACTIONS.close`) and sends `/actionbar` `Zeig mit dem Stab auf einen Block` or `… auf eine Kiste`.
  - The next `open` event while `st.pick` is live is consumed as the pick:
    - block: the gaze block must be in `jobs.BLOCKS`. If so, set `form.block` and add it to recents.
    - chest: the gaze must satisfy `jobs.isChest`. If so, set `form.chest` (or, from the bot page's Kiste merken, submit `setchest` for `pick.bot` and show `botm`).
    - On a wrong target: flash `Das ist kein passender Block` / `Das ist keine Kiste`, keep the pick until it expires, and do not reopen a menu.
  - When the pick is consumed, show `shiftm` again.
  - An expired pick is dropped silently on the next `open`, which is then handled normally. `quit` clears `st.pick` (states are deleted on quit already).
- Staff routing: an `open` whose gaze block is in `jobs.BLOCKS` (and is not a chest) → `shiftm` with that block preset.

- [ ] **Step 1: Write failing tests.**
  - `shiftm` defaults: amount `inf`, chest from the snapshot.
  - `amount` cycles 16 → 64 → 256 → inf → 16.
  - `pickblock {block: 'bedrock'}` throws.
  - `shiftgo` with each of the four table rows submits key/type and args as in the table: log + inf → `shift` with `block: 'logs'`; `oak_log` + 64 → `chop` count 64; `iron_ore` + inf → `shift` block iron_ore with the chest; `iron_ore` + 16 → `mine` count 16.
  - `shiftgo` without a block flashes `Erst einen Block wählen`.
  - `pick {kind: 'chest'}` then an `open` with a chest gaze sets `form.chest` and renders `shiftm`.
  - `pick` then an `open` with a stone gaze flashes `Das ist keine Kiste` and posts no `/menu`.
  - A pick older than 60 s plus an `open` with a chest gaze leaves `form.chest` unchanged and routes normally (`chestm`).
  - A guest `setbot {bot: 'bot1'}` throws.
  - An `open` with an `iron_ore` gaze renders `shiftm` with block iron_ore.
  - The grid tab `holz` lists only log ids, and every grid block is in `jobs.BLOCKS`.
- [ ] **Step 2: Run** both tests. Expected: FAIL.
- [ ] **Step 3: Implement** the screens, actions, pick handling and routing above.
- [ ] **Step 4: Run both tests and the full suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(mcbots): shift hopper window with block grid and point-to-pick`.

### Task 6: Docs, coverage list, final checks

**Files:**
- Modify: `docs/runbooks/minecraft/BOTS.md` (the "Bot control phase 1" subsection: add "Picture menus"), `docs/guides/misa-bots.de.html` (section 0: replace the dialog description with the menus, ≤ 15 lines), regenerate `docs/guides/misa-bots.pdf` (`chromium --headless --password-store=basic --no-pdf-header-footer --print-to-pdf=...`)
- Create: `docs/runbooks/minecraft/botui-coverage.md` (old dialog flow → new menu or "still dialog", one line each)

- [ ] **Step 1: Write the coverage list** from `botui-screens.js` `SCREENS` and `botui-jobs.js` `JOBS`. Each entry is `covered by <menu>` or `still a dialog (from "Alle Befehle (alt)")`.
- [ ] **Step 2: Update BOTS.md and the guide.** Cover how to open the menu, what the icons mean, the shift window, and pointing with the staff. Regenerate the PDF.
- [ ] **Step 3: Final checks, all must pass:** full suite, stand e2e, `nix build .#checks.x86_64-linux.botui`, and the lab build. For the lab build, make a bandit-nix worktree from origin/main and run `nix build --override-input bandit-craft "git+file:///home/vino/src/bandit-craft-fleet?rev=<HEAD>" .#nixosConfigurations.bandit-lab.config.system.build.toplevel`.
- [ ] **Step 4: Commit** `docs(botui): picture menus in the runbook and Misa's guide; dialog coverage list`.
