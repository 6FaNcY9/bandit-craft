# Bot menus: pictures instead of text (design)

Status: approved direction by the owner, 2026-11-06. It builds on `2026-11-06-bot-control-design.md`
(phase 1, deployed as bandit-nix b91a0aa) and replaces its text dialogs as the main control surface.
File refs are under `hosts/bandit-lab/services/` unless stated. The mockups are local only, in
`.superpowers/brainstorm/*/content/bot-menu-v1.html` and `bot-menu-v2.html`, because they use textures
from the owner's Minecraft client and this repo is public.

## Why

The owner's words (2026-11-06): the current menus are "viel zu kompliziert" and "verwirrend". There is
too much text. The Schicht form makes you step through every block one click at a time. He wants items
shown as pictures and a real menu, with the block you want picked from a grid or by pointing in the world
("so ein ingame 3d auswahl wo man gleich sieht was man auswählt"). The bar he set: "das jeder minecraft
spieler automatisch auch die bots kontrollieren kann", meaning anyone who knows Minecraft understands it
just by looking. Misa had too little control before (see the phase 1 design); she must be able to do
everything with her bots.

## Goals

- **One main menu with every option**, made of chest-inventory screens with real item icons. Hovering
  shows the name, exactly like an inventory tooltip. One click is one choice. Nothing is typed.
- **The staff as the shortcut.** Using it on a block opens the vanilla window that block stands for, and
  the bot does that block's job.
- **Vanilla windows for vanilla jobs.** A crafting order looks like a crafting table, a smelting order
  looks like a furnace, a mining shift looks like a hopper.
- **3D area picking.** Click two corners. An outline plus a translucent ghost of the blocks shows the
  selection to that player only.
- The owner and Misa get the same screens. Misa sees only her bots (MisaBot, EM_Trader); the owner sees
  all of them.

## Non-goals

- No client mods and no resource pack. The UI is vanilla 26.2 client only.
- No new bot abilities in this project, except enchanting (step 6). Everything else the menus offer already
  exists as a job in `mcbots/app/bots.js`: craft, smelt, shift, shiftlogs, mine, chop, deposit, withdraw,
  get, guard, goto/follow, build/schematic, treefarm, wheatfarm, light, hunt.
- No web dashboard changes.

## Anti-goals (a failure even if it works)

- Text walls or cycle buttons that step through values one per click.
- Menu items that can be taken, duplicated, or moved into the player's inventory.
- Screens that only make sense once someone has explained them.
- Weaker checks: the viewer is the Bukkit player, never a payload field. The hub validates every order as
  it does today (`VALIDATE` in bots.js, `resolveBots` in `mcbots/app/botui-jobs.js`).

## Constraints

- Paper 26.2 behind Velocity. Players use vanilla clients, some through ViaVersion/ViaBackwards. Chest
  GUIs work on every version; dialogs need 1.21.6+.
- The hub stays the brain. The plugin (`minecraft/botui/BotUi.java`) only renders what the hub sends as
  JSON and emits click events, as `/show` and `click` do today. Viewer check and the hub-timeout
  behaviour stay as they are.
- Any BotUi change restarts Paper, so ship it when nobody plays and warn first (AGENTS.md).
- The existing dialog code stays for confirmations and number input. It is not deleted until the new
  screens cover its flows.

## The design

### Two ways in, one kind of window

1. **Main menu (chest screens).** Opened by left click with the staff or `/bots`.
   - **Overview:** one player head per bot. A durability bar under the head shows its health (`damage`
     on a head with `max_damage` 20). A small badge icon shows what it is doing: pickaxe = mining,
     axe = wood, sword = guarding, lead = following, emerald = trading, clock = standing orders,
     none = idle. The tooltip has at most three lines: name, activity, hearts.
   - Bottom row of the overview: Alle: Stopp (barrier), Alle: Komm (ender pearl), Karte (map),
     Bauplan hochladen (writable book), Meldungen (spyglass, stack count = unread).
   - Clicking a head opens the **bot page**. Every order on it is an icon:
     - Top row (start right away): Folgen (lead), Komm her (ender pearl), Bewachen (iron sword),
       Einlagern (chest), Essen (bread), Stopp (barrier).
     - Middle row (one follow-up choice): Abbauen (pickaxe, opens the Schicht window), Holz (axe),
       Herstellen (crafting table), Schmelzen (furnace), Verzaubern (enchanting table, step 6),
       Bauen (bricks, opens the schematic list as icons), Holen (chest minecart, opens the item grid
       then `get`), Baumfarm (sapling).
     - Bottom row: Wenn frei (clock), Kiste merken (hopper, then "point at a chest"), Inventar ansehen
       (barrel), Zurück (arrow).
     - The active order is shown with a highlighted slot (enchant glint).
   - **Wenn frei:** one screen with an icon per choice from `mcbots/app/idle.js` CHOICES: Nichts
     (barrier), Holz-Schicht (log), Stein-Schicht (cobblestone), Baumfarm (sapling), Bewachen
     (sword), plus Daueraufträge (clock) for owner bots only. The active choice is highlighted.
   - **Item/block grid:** tabs (Erze, Holz, Stein, Erde & Sand, plus Werkzeug, Bau and Essen for
     crafting) as icons in the top row; the "zuletzt benutzt" items come first; pages when needed; a
     "Zeig drauf" stick slot closes the screen and takes the next staff click on a block as the choice.
2. **Staff shortcut.** Right click with the staff opens a screen chosen from what you look at:

   | Looking at | Opens |
   | --- | --- |
   | crafting table | crafting window (below) |
   | furnace, blast furnace, smoker | furnace window |
   | enchanting table | enchanting window (step 6) |
   | ore, stone, log, sand, gravel, clay, any minable block | hopper (Schicht) window, block pre-filled |
   | chest, barrel | "Kiste für <bot>" choice (heads of the viewer's bots) |
   | one of the viewer's bots | that bot's page |
   | another player | "Folgen: <player>" for a chosen bot |
   | ground, nothing | Komm her / Bewachen hier |

   Without sneaking, a right click on a usable block (door, chest) still uses it, as in phase 1. To use the
   staff on such a block, sneak while clicking. The sneak rule applies to the chest, crafting table,
   furnace and enchanting table rows above.

   Which bot? The window title names the bot. The default is the bot last chosen by this viewer, else
   the viewer's only or first bot. A head slot in each window switches it.

### The vanilla windows

The plugin opens real vanilla menu types (Paper `MenuType`): crafting, furnace, hopper and, in step 6,
enchanting. The slots hold display items only. The window shows the result of the order before it is sent.

- **Crafting (Werkbank):** the item is picked first from the grid (Werkzeug/Bau/Essen tabs). The 3×3
  then shows its recipe. An ingredient the bot lacks is greyed out and its tooltip says that the bot gets
  or makes it itself (`get` already resolves chains). The result slot shows how many it can make. Click
  on the result = 1 batch; shift-click = as many as possible, the same as in vanilla.
- **Smelting (Ofen):** the top slot is the input (click = choose from smeltables), the fuel slot shows
  the fuel the bot will use (no choice needed), and the output slot is a preview. Click on the output =
  start; shift-click = everything the bot has.
- **Mining shift (Trichter):** five slots read left to right: Wer (head) → Was (block) → Wie viel
  (stack count 16/64/256/∞; clicking steps through these four only) → Wohin (the bot's chest, click =
  point at another chest) → Los (lime dye). With a log it becomes a wood shift (`shiftlogs`), otherwise
  `shift` with that block. This replaces the current Schicht form completely.
- **Enchanting (Zaubertisch), step 6:** item slot = the bot's best tool (click = another), lapis slot,
  three offers. Bots cannot enchant yet: this needs a new job (walk to a table, put in item and lapis,
  pick an offer). The real offers depend on the table and the bot's seed, so the window may show what the
  bot will try ("Bestes Angebot Stufe 3") instead of exact enchantments. Whether the vanilla enchanting
  menu can be filled without a real table is unverified; if not, use a chest screen with three book icons.

### 3D area picking

From the shift window or the bot page: "Bereich" mode. The next two staff clicks set the corners. The
existing outline (`/outline`) plus a ghost show the box. The ghost is a glowing, scaled `block_display`
per block or per layer, non-persistent, visible only to that player (`setVisibleByDefault(false)` +
`showEntity`), and removed on close, quit and timeout. The action bar shows one line: "Ecke 2 anklicken ·
Schleichen + Klick = fertig". Confirmation is a small chest screen: Los (pickaxe), Hier bauen (bricks),
Neu (compass), Abbrechen (barrier).

### Plugin side

- A new hub→plugin call next to `/show`: `/menu {player, type: chest|crafting|furnace|hopper|enchanting,
  title, rows?, slots: [{slot, item, name, lore, count, damage, maxDamage, head, glint, payload}]}`.
- An `InventoryHolder` per open menu remembers each slot's payload.
- Every `InventoryClickEvent` and `InventoryDragEvent` on such a view is cancelled. This includes
  shift-click from the player's own inventory, number keys, the offhand key and double-click collect. A
  click on a slot emits `click` with that slot's payload plus whether shift was held.
- `InventoryCloseEvent` → `closed`. Switching between a chest screen and a dialog happens one tick later.
- Ghost entities: create, update and clear calls, owned by the plugin, cleared on plugin disable.

### Hub side

Screens are rendered in `mcbots/app/botui-screens.js` (new `menu*` renderers); state and actions live in
`mcbots/app/botui.js`; orders are built and checked in `mcbots/app/botui-jobs.js` exactly as today. The
`lage` event goes to the overview, and `open` goes to the staff table above.

## Build order (each step ships on its own)

1. **Fix the staff click.** With a real client, left/right click with the staff does nothing while `/bots`
   works (owner, 2026-11-06). Find the cause with evidence first: `/data get entity @s SelectedItem` for
   the `botui:staff` custom data, a fresh staff in survival, and a temporary log line in `onLeft`/`onUse`.
   Then fix it, and also put a new staff straight into the hand with a chat line saying where it is.
2. **Chest menu:** `/menu` plus the overview, the bot page and Wenn frei.
3. **Hopper shift window** plus the item/block grid and "Zeig drauf".
4. **Crafting and furnace windows**, from the menu and from the staff on the real block.
5. **3D area mode** with the ghost.
6. **Enchanting:** the new bot job and its window.

## Left to the builder

Exact slot positions, the colours of name text, page sizes, which items go into each grid tab, the
tooltip wording (short German, at most three lines), how the dialog code is retired once the menus cover
it, and test structure (unit tests for every renderer and action; a mineflayer e2e on the stand that
clicks menu slots with `bot.clickWindow` and asserts the emitted payload and that no item moved).

## Settled after the builder check

- **The staff does not gate the menus.** Steps 2-3 ship with `/bots` as the way in when step 1 is still
  open. The staff shortcuts (right click on a block) go live once step 1 is fixed. If the cause turns out
  to be client-side and unfixable, the fallback is Shift+F (swap-hand event, no item check), which needs
  no staff at all.
- **Vanilla menus are spiked first.** Step 2 starts with a spike on the stand: open crafting, furnace,
  hopper and enchanting via `MenuType` without a real block, fill the slots, cancel the clicks. If a type
  misbehaves (ghost items, recipe book, no fill without a block), that window becomes a chest screen with
  the same layout: 3×3 + arrow + result, or input/fuel/output. This fallback is pre-approved because
  the goal is that it looks familiar, not that it is the vanilla menu class.
- **Re-render after every click.** After each click the hub sends the whole menu again and the plugin
  calls `updateInventory()`. A short flicker is acceptable; per-slot updates are not needed.
- **Pick modes live in the hub** ("Zeig drauf", Bereich, Kiste merken). The hub already owns the corner
  selection (`st.sel`). The next staff click arrives as the normal `open` event with its gaze, and the hub
  reads it as the pick. A pick mode ends after 60 s, on quit or on a hub/plugin restart; the action bar
  says so. The plugin removes ghosts on close, quit, plugin disable and a hub `clear` call.
- **Bot inventory comes from the snapshot.** It already lists items as `"<name> xN"` (`/api/state`
  `inventory`). The crafting preview uses it as is. A stale count only makes the preview wrong; the job
  itself still checks for real.
- **Dialogs retire flow by flow.** Step 2 writes a short coverage list (old dialog flow → new screen). A
  dialog goes only when its flow is covered. Dialogs stay for confirmations and for amounts other than
  16/64/256/∞ (a `number_range` slider).
- **Misa's rules are the phase 1 rules.** Every bot list and every order goes through `allowedBots`,
  `resolveBots` and `stopTargets` (`mcbots/app/botui-jobs.js`, `server.js`). "Alle" means only the
  viewer's bots, and the staff rows for a player, the ground or a chest offer only the viewer's bots.
  Each new action gets a test with a guest viewer.
- **Grid contents.** Tabs are curated lists in the hub, filtered to what `VALIDATE` accepts for that job
  (`mcbots/app/bots.js`). A block the job would reject never shows.
- **The stand** is `tools/botui-stand/` (local Paper + the plugin + mineflayer: `stand.sh up`,
  `node tools/botui-stand/e2e-bridge.js`, `stand.sh down`). Every step passes it before shipping, and the
  owner checks with a real client after the deploy.

## My calls (open to the owner's veto)

- Chest screens instead of dialogs for the main menu (the architect's recommendation: real icons, every
  client version).
- Stack counts 16/64/256/∞ as the only amounts in the shift window; other numbers need a dialog slider.
- The bot-picker default is "the bot you used last".
- Enchanting comes last because it is the only step that needs a new bot ability.
