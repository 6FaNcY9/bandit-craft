# Bots in the game, v2: a real management GUI (2026-11-03)

Owner feedback on v1 (2026-11-02): "viel zu wenige Infos", the menu must be structured and detail-rich.
v1 ships the plumbing (sidebar, `pa data` inbox/outbox, console replies, `/bots` with one lore line per
bot). v2 builds the actual management surface on top of it.

## Prior art (researched 2026-11-03)

| Source | What we take from it |
| --- | --- |
| MineColonies Town Hall GUI (minecolonies.com/wiki/buildings/townhall) | Sections with pages: Actions, Information (event log, work orders), Citizens (list → detail, "recall" for stuck citizens), Statistics (jobs occupied/available). Our mapping: Übersicht, Bot-Detail, Ereignisse, Bedarf/Kisten, Projekte. |
| DeluxeMenus example menus (wiki.helpch.at) | One slot, several items with conditions: the icon itself shows the state (online/offline, available/locked). Live placeholders on an update interval, `[refresh]` on click. |
| Mineflayer ecosystem (minecraftlegion, mineflayer-webpanel) | Only web panels exist; nobody manages mineflayer bots from inside the game. Nothing to copy, nothing to compete with. |
| CommandPanels 4.2.4 docs + lab probes | `$EQUALS/$ATLEAST/$AND/$OR/$NOT` conditions, multi-item slots, `update-interval`, `[session]`, `[open]`, `[refresh]`, `[sound]`, `[msg]`, `[head] <name>` / `[head] <base64>`; `pa data set` keeps U+00A0 (no-break space) inside a value, so a value may be a whole sentence (verified on the lab 2026-11-03: `Holz 12/64 ok` round-trips with NBSP). |

## Owner constraints (2026-11-03, after seeing v1 live)

- **Nothing on the HUD.** The sidebar covered the view; it stays opt-in (off by default) and compact. All information
  lives in GUIs the player opens and closes.
- **No chat noise.** Only replies to the player's own orders appear in chat; no death lines, no status lines, no RCON
  feedback (`broadcast-rcon-to-ops = false`). Chat cards (section 5) are shown only on an explicit click.

## Goals

1. From one `/bots` screen the owner sees at a glance who works, who idles, who is in trouble, and what the
   base needs.
2. One click into a bot shows everything the dashboard's bot card shows (job, progress, runtime, position,
   health, food, tool, armour, free slots, last error, role, settings).
3. Every order the dashboard offers for a single bot is reachable in at most three clicks, including those
   that need a number or a place.
4. Events, supply needs and chests are browsable in the game.
5. Misa (`MidariBread`) gets the same screens but sees only her bots (`MisaBot`, `EM_Trader`).

Non-goals: editing crews/plan/projects, the server panel (restart, whitelist), BlueMap, schematic builds
(`bau` stays a chat order with Litematica), per-player sidebar content.

## Information channels (what v1 already provides, extended)

- **Outbox** (hub → game): `pa data set mcbots <key> <value>` with NBSP for spaces; keys per bot
  `<bot>.<field>`. Pushed only when changed, batched in one RCON call per 5 s tick.
- **Inbox** (game → hub): `pa data set <viewer> order <bot>:<words>` polled every 2 s (v1). v2 adds
  `page:<name>` keys for pages the hub has to fill (events, chests) only when opened.
- **Chat cards**: `tellraw` with hover text and clickable buttons (`suggest_command` fills the chat with the
  chat-grammar order; `run_command` opens panels via `/bots ...` aliases). Used for lists longer than a
  chest row: full inventory, last 10 events, chest contents.
- **Sidebar** (v1, opt-in): unchanged; the summary line lives in the `/bots` screen instead.

## Screens

Chest GUIs are 9 columns wide. `[x]` = item, lore in the lines below. Conditions decide which item sits in a
slot (DeluxeMenus pattern), so the icon is the state.
CommandPanels 4.2.4 decides that only when the panel opens (`PanelFactory`); `update-interval` refreshes the text of the item
already shown (`InventoryPanelUpdater`), so a state change needs the panel opened again.

### 1. `/bots` — Übersicht (6 rows)

```
row 1  [Σ Bots 7/8]  [⚠ Probleme 1]  [⛏ Bedarf: Eisen 13/16]  [☀ Tag]  [📜 Ereignisse]  [📦 Kisten]  [≡ Sidebar]  [? Hilfe]  [■ Alle stopp]
row 2  [bot1]  [bot2]  [bot3]  [bot19]  [bot20]  [bot21]  [MisaBot]  [EM_Trader]  [ ]
row 3  (free for up to 9 more bots)
row 4-6 filler
```

Head icon by state (`<bot>.state`): `work` → player head; `idle` → grey head (`[head]` of a grey texture);
`error` → `BARRIER`; `dead` → `SKELETON_SKULL`; `offline` → `GRAY_DYE`; `sheltered` → `RED_BED`.
Lore of a head (every line one data key):

```
&b bot19 &7· Arbeiter·Holz+Kohle          <bot>.role
&f Baumfarm: 5 Stämme, 0 Setzlinge        <bot>.job
&7 seit 5 min · hebt oak_log auf          <bot>.since · <bot>.activity
&c Fehler vor 2 min: kein Weg zur Kiste   <bot>.error   (line hidden when empty)
&7 ❤ 20  🍗 15  ⛏ iron_pickaxe 70/250     <bot>.vitals
&7 -311 80 -157 Oberwelt · 42 Blöcke weg  <bot>.where   (distance from the viewer: see "Viewer position")
&8 Klick: Befehle · Rechtsklick: Status im Chat
```

Summary items (row 1): `sum.bots` (online/total), `sum.problems` (count + first bot), `sum.need` (first keeper
quota under target), `sum.day` (Tag/Nacht from any bot's `isDay`). `Ereignisse`, `Kisten`, `Hilfe` open
screens 3, 4 and a chat card; `Alle stopp` as in v1 with a confirmation sub-panel (2 clicks, MineColonies
style for destructive actions).

### 2. `botmenu` — one bot (6 rows), title `<bot> · <role>`

```
row 1  [head: full lore as above + inventory headline + settings]   [ ] [ ] [ ] [ ] [ ] [ ] [ ] [■ Stopp]
row 2  Bewegung:  [Komm] [Folge] [Wache hier] [Wache beim Spieler] [Heim (Bett)]
row 3  Sammeln:   [Holz] [Stein] [Eisen] [Kohle] [Diamant]     ← left 16 · right 32 · shift-left 64
row 4  Lager:     [Gib mir alles] [Einlagern] [Ausrüsten] [Aufräumen] [Bestand melden]
row 5  Arbeit:    [Weizenfarm] [Baumfarm] [Handel] [Gräber holen] [Rolle: helfer/sammler/farmer/wache ▸]
row 6  Info:      [Status im Chat] [Inventar im Chat] [Ereignisse dieses Bots] [Einstellungen ▸] [◀ Zurück]
```

Each button sends `<bot>:<words>` through the inbox. Words extend the chat grammar where needed
(`hol_<n>_<block>` exists; new: `bett`, `einlagern`, `ausruesten`, `aufraeumen`, `bestand`, `weizen`,
`baumfarm`, `handel`, `graeber`, `inventar`, `ereignisse`, `einstellung_<key>_<an|aus>`). The hub maps them
to the existing job types (`homebed`, `deposit`, `rearm`, `tidy`, `stock`, `wheatfarm`, `treefarm`,
`trade`, `graves`) with the same defaults the dashboard uses (supply chest, wheat zones, tree farm box
from `places`). Orders a guest bot may not take are refused with the dashboard's reason.

`Einstellungen` sub-panel: toggles for `defend`, `torches`, and `retreatHealth` 4/8/12 as three items;
each shows its current value from `<bot>.set.<key>`.

### 3. `events` — Ereignisse (6 rows)

Nine `PAPER` items (newest first) from `ev.1 … ev.9`, lore = `&7hh:mm &b<bot> &f<text>`, colour by kind
(`fail`/`death` red, `done` green, `alert` gold). Filled by the hub on every push from `events.since`.
Button `Mehr im Chat` → chat card with the last 25 lines. Button `Nur Probleme` → `[session] set filter`.

### 4. `supply` — Bedarf und Kisten (6 rows)

Row 1-2: keeper quotas as item icons (`OAK_LOG`, `COBBLESTONE`, `COAL`, `TORCH`, `STONE_BRICKS`,
`RAW_IRON`, `IRON_PICKAXE`, …) with lore `have/want`, `note`, who is fetching; green/red glint by state;
`Keeper an/aus` toggle. Rows 3-5: one chest per known chest (`/api/chests`), icon `CHEST`/`BARREL`, lore
= top 6 items + free slots + age; click → chat card with the full contents and a `Bestand melden`
button. Hub keys `need.<item>` and `chest.<n>`.

### 5. Chat cards (tellraw)

- **Status-Karte**: the head lore as 6 chat lines plus buttons `[Komm] [Folge] [Stopp] [Menü]` (suggest/run).
- **Inventar**: `inventory` list grouped (tools, armour, blocks, food, junk) with counts.
- **Ereignisse**: 25 lines, timestamps, bot names clickable (`/bots <bot>` opens its menu).
- **Hilfe**: the chat grammar and the panel map.

### Viewer position

For `Wache hier` and the distance line the hub needs the viewer's position: on every push the hub runs
`execute as <viewer> run data get entity @s Pos` for online viewers (one RCON command each) and keeps it
for 5 s. Not visible viewers (offline) skip the distance line.

### Misa's view

`INGAME_VIEWERS` becomes a map `name=bot,bot;name=*` (env `INGAME_VIEWERS = "fancy8869=*;MidariBread=MisaBot,EM_Trader"`).
The hub pushes `view.<viewer>.<n>` = bot name for the heads the viewer may see; panel heads are
conditioned on `%commandpanels_data_view.%player_name%.1,mcbots% $EQUALS bot1` etc. Orders to a bot
outside the viewer's list are refused ("nicht dein Bot").

## Open questions for the owner (answer in chat; defaults in brackets)

1. Which bots should Misa see and order? [MisaBot and EM_Trader]
2. Amounts for the Sammeln buttons: 16 / 32 / 64 by click type, or a fixed 32? [click type]
3. Confirmation for `Alle stopp`? [yes, a 2-button sub-panel]
4. Should `Komm` for a sandbox bot be hidden (it cannot reach a player on the main server)? [shown, refused with reason]
5. Is a bossbar with the one-line summary wanted on top of the sidebar? [no]

## Plan (phases, each shippable)

| Phase | Delivers | Hub work | Panel work | Risk / spike first |
| --- | --- | --- | --- | --- |
| A (done 2026-11-03: no distance line, it would need keys per viewer) | Detail lore on `/bots` (6 lines per head), summary row, state icons | `ingame.js` field builders (`job`, `since`, `activity`, `error`, `vitals`, `where`, `state`, `sum.*`), NBSP values, per-key change tracking, viewer position | `bots.yml` rebuilt (multi-item slots with conditions) | Spike 1: NBSP renders as a space in lore (`/bots` after deploy). Spike 2 (done 2026-11-03, live): `.` in a key nests a YAML section, so `v2.spike` and `v2` collide (`pa data get` returns a MemorySection). Keys use `_` only: `bot1_job`, `sum_work`. |
| B | Full `botmenu` with 20 orders, click-type amounts, settings sub-panel, confirmation for Alle stopp | inbox words → job types + defaults (`places`, supply chest), `einstellung_*` → `settings`, viewer position for `wache hier` | `botmenu.yml`, `botsettings.yml`, `botconfirm.yml` | Guest-bot refusals must match the dashboard (`agentauth`-style checks). |
| C | Chat cards | `tellraw` builders with hover + click; `/bots <bot>` alias → `pa open botmenu` with session bot (needs a console path to set session data: test `pa data` vs session; fallback: per-bot panels generated by Nix from the roster) | — | Spike 3 (partly done): `pa data set/get/del` from the console works on the live server (v1 already relies on it); session keys are not reachable from the console, so `/bots <bot>` sets `pa data set <viewer> sel <bot>` and then `pa open botmenu <viewer>`, which v1's botmenu already reads. Verify `pa open <panel> <player>` from the console in phase A. |
| D | Ereignisse and Bedarf/Kisten screens | `ev.*`, `need.*`, `chest.*` pushes on change; keeper toggle via inbox `keeper:an/aus` | `events.yml`, `supply.yml` | Console volume: cap at 40 commands per tick, oldest keys dropped. |
| E | Misa's view | viewer→bots map, `view.*` keys, refusal text | conditions on heads and menus | Misa online for the test. |

Effort: A+B are the bulk (two sessions), C–E one session each. Tests as in v1: pure builders unit-tested
(`test/ingame.js`), panels YAML-validated, the rest verified in the game with the owner online.
