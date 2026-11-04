# Kommandostand: bot management inside the game (2026-11-04)

Replaces the chest menus of `docs/specs/2026-11-03-ingame-bots-v2.md` (phase A is live, phases B to E are dropped).

## Why

Owner, 2026-11-04: inventory interfaces "can't do much"; they wanted "real GUI-like interfaces like the in-game map", and they
hardly used the menu "because it has no functions or only useless ones like komm or wache". They gave full design freedom:
"the best possible thing you can design".

The archive agrees: come, follow and give were started about 30 times each, against 4000+ for help, shift and mine. Live,
6 of 8 bots sat idle. The owner's job is giving the bots big goals, and v1 is a remote control for single bots.

The web dashboard already browses data better than the game can. What only the game has is **the player's position and
gaze as order input**, and state at a glance without alt-tab. So:

- Look at something, press one key, get the orders that make sense for it.
- See who works and what is wrong in one screen, with the reason in plain German.
- Set standing goals (keeper quotas), not only single jobs.
- A live map in hand.

## Anti-goals

- Nothing permanent on the HUD; everything opens and closes (owner 2026-11-03).
- No chat noise: orders given in the Kommandostand answer in the Kommandostand. The short "fertig: ..." line when a job
  ordered by the viewer ends stays, as today.
- A dialog that pops up again after the player closed it. This would make the whole thing hated, so it outranks live refresh.
- Browsing the event archive or the chest index in game: the dashboard does that.
- Client mods: every viewer would have to install one.

## How it is built (decided by the architect review 2026-11-04, spiked the same day)

A small own Paper plugin `BotUi` is a dumb bridge; the Node hub authors every screen as a vanilla dialog.

- Dialogs are native windows: text, item icons, buttons with tooltips, sliders, text fields, option lists. No resource pack.
- Screens are JSON built in Node, tested without a server. The plugin dispatches `dialog show` through
  `Bukkit.createCommandSender` (no console log line per refresh, parse errors come back to the hub). RCON cannot carry them: a
  screen is 3-10 KB and RCON reads 1460 bytes.
- Clicks return as `PlayerCustomClickEvent`. Identity is the event's Bukkit player, never a payload field.
- Only the hub connects: it calls the plugin on `127.0.0.1:8101` (from the container through a new `mc-bridge-botui` proxy) and
  long-polls for events. Bearer token: `rcon.password` from `server.properties`, the same trust as RCON today, no new SOPS value.
- If the plugin or hub is down, bots keep working; `/bots` says the hub is unreachable.

Verified on a local Paper 26.2-130 with ViaVersion and ViaBackwards 5.12.0 (2026-11-04): the API compiles against the jars bundled
in the Paper jar with JDK 25, no extra download; a 7.3 KB JSON dialog passes through `dialog show`; a 26.1 test client receives
`show_dialog` and its `custom_click_action` reaches the event with player, id and typed payload. `viaversion list` on main: the owner
plays 26.2. Misa's client was offline, unchecked: dialogs need 1.21.6+.

Rejected: CommandPanels `type: dialog` (static YAML, one-word channel, no refresh, no gaze), ImageFrame for the map (no markers without
a compositor, per-image command use). Real look and feel can only be judged in game by the owner: no real client could be run for tests.

## Opening

`/bots`, or **Shift + F** (sneak + swap hands, cancelled only for viewers while sneaking). No typing needed; the player keeps aiming at the
thing they mean.

## Screens (German copy; `Lagebild` first)

### 1. Lagebild

Title `Kommandostand`. Body lines:

- `8 Bots · 2 arbeiten · 6 frei · Tag`
- up to 3 problems in red, as cause not raw error: `bot3: Kiste voll, Baumfarm steht (vor 2 min)`
- `Bedarf: coal 20/32, raw_iron 3/16` (keeper quotas under target) or `Alles auf Lager`
- the result of the last order, for 30 s: `✔ bot19: Baumfarm gestartet` / `✖ Geht nicht: ...`

Buttons, two columns: `● bot19  Baumfarm 5/64 · 12 min`, one per bot the viewer may see, dot coloured by state (green works,
gray idle, red problem, dark gray offline). Tooltip: job, activity, next jobs in the queue, health, food, tool, free slots, position.
Below: `Neuer Auftrag`, `Ziele`, `Karte`, `Alle stopp` (confirmation dialog; owner only). Footer `Schließen`.

Refreshes itself every 5 s while open and only when the content changed.

### 2. Auftrag

Opening it reads what the player looks at (up to 128 blocks). Step 1 is a list of buttons:

- **Für diesen Block** (when the gaze hits one), e.g. looking at iron ore: `Eisenerz abbauen`, `Schicht: Eisenerz`. Chest: `Hier einlagern`,
  `Hieraus holen`, `Inhalt zählen`, `Handelskiste ...`. Spawner: `Spawner ausleuchten`. Wheat: `Weizenfarm`. Any block: `Hierhin gehen`,
  `Hier bewachen`, `Hier aufräumen`.
- **Bereich**: `Ecke A` / `Ecke B` take the gazed block. Corners persist while the player walks to the next one (close, walk, Shift+F
  again) and show as a particle outline only that player sees. With both set: `Ausheben`, `Abräumen`, `Schacht`, `Ausleuchten`, `Abdichten`, with the
  box size in the tooltip; a box too large is gray and says why.
- **Allgemein**: `Besorgen` (any item, `get`), `Holz`, `Schicht`, `Baumfarm`, `Weizenfarm`, `Gräber holen`, `Einlagern`, `Ausrüsten`, `Heim`, `Helfen`, `Bauen`.

Step 2 shows only the inputs that job needs (count slider, block or item, target, chest) plus `Wer` (`Erster freier`, `Alle freien`, named bots)
and `Wann` (`Jetzt`, `Danach`). `Senden` runs the same validation and job path as the dashboard's `POST /api/job`, then returns to the Lagebild with the result line.

Targets: `Block vor mir`, `Wo ich stehe`, each of the dashboard's places, or typed `x y z`.

### 3. Bot

Full state: job, activity, queue, health, food, armour, tool, free slots, top of the inventory, position, last error. Buttons: `Stopp`, `Auftrag für <bot>`
(step 1 with the bot preselected), and the one-click jobs `Einlagern`, `Ausrüsten`, `Heim`, `Gräber holen`. Refreshes like the Lagebild.

### 4. Ziele

Keeper on/off, one slider per quota item (persisted, survives a restart), plan on/off when a plan is configured, sidebar on/off for the viewer. Trader chests
are set from the chest context in Auftrag and listed here with a remove button; they persist and replace the fixed `TRADE_HALLS` chests of that bot.
Highway road rows come when `feat/highway-bots` lands.

### 5. Karte

`Karte` puts a filled map named `Bot-Karte` into the player's hand (reusing an existing one). It shows BlueMap's low-res terrain around the player, or around a chosen bot, with
each visible bot as a coloured named marker and the player as an arrow. Right click with it in hand opens the map dialog: zoom (1, 2, 5, 10, 25, 50 blocks per pixel), `Mitte: ich` or
a bot. Off hand, chest or item frame: it stays a normal map item. No cursor exists on a held map, so orders stay in the dialogs.

## Who sees what

`INGAME_VIEWERS` becomes `fancy8869=*;MidariBread=MisaBot,EM_Trader` (a bare name still means `*`). Every screen and order is filtered by this list on the hub. Non-viewers
get `Nicht freigeschaltet`.

A viewer whose entry is not `*` is a guest and gets an allow-list, enforced in `build()` (a forged click is refused, hiding buttons is
not the guard): `mine`, `chop`, `goto`, `guard`, `homebed`, `graves`, plus Stopp for their own bots. Everything else is refused (supply
chest, `get`, `deposit`, `withdraw`, `stock`, `tidy`, `craft`, `smelt`, `schematic`, farms, `rearm`, `help`, `shift*`, all area jobs; chat
still confines her `abbau` and `bau` to her own area). Her screens show no corner selection, and her targets are only the gazed block,
her own position or typed coordinates: no named places and no Vorratskiste, as that list reveals the owner's base. The Lagebild's
`Bedarf` line is the owner's. Trader chests (`trader_add`) are the gazed chest in the overworld, the same reach as chat `kiste`, which
checks only that the block is a chest.

## What goes away

CommandPanels `/bots` and `botmenu`, the `pa data` push and inbox. Stays: the opt-in sidebar (now a button in Ziele), the chat grammar, the "fertig" line.

## Live refresh safety

A dialog is "open" for the hub from `show` until any of: the `Schließen` click (Escape runs the same exit action, per the wiki), the player moving or turning (the plugin reports `closed`, since a player with a dialog on
screen cannot do either), quitting, or 10 minutes without a click. Input screens never refresh, so a slider is not reset under the player's hand.

## Left to the builder

Exact labels, tooltips and widths, German block names beyond the common ones, icons.
