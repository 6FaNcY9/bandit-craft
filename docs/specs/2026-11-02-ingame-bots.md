# Bots in the game: status sidebar, `/bots` menu, console replies; Misa's trader daily (2026-11-02)

Owner request: manage and monitor the bots from inside Minecraft (not only the dashboard), then a bot
that sells sticks to the villagers of Misa's base every day.

## Findings this rests on (verified on the lab, 2026-11-02)

- Paper 26.2 rejects the bots' `/tell` replies: `Received unsigned command packet from MisaBot, but the
  command requires signable arguments`. Offline bots have no chat signing key. The owner's own chat
  reaches the bots fine (signed by a real client). Replies therefore go through the server console.
- CommandPanels 4.2.4 (`/pa`): `pa open <panel> [player]`, `pa data set|get|del|clear <player> <key> [value]`
  work from RCON. `set` does not overwrite (del first), values are one word (no spaces, `§` stripped),
  `<player>` may be any name (`mcbots` works as a store). Panels: `update-interval` (ticks) refreshes
  placeholders of open panels; `%commandpanels_data_<key>,<player>%` reads another player's data;
  `%commandpanels_session_<key>%` with `[session] set`; tags `[console]`, `[open]`, `[close]`, `[refresh]`,
  `[msg]`; heads `material: '[head] <name>'`. PlaceholderAPI 2.12.3 is installed (hook `commandpanels`).
- Sidebar: `scoreboard objectives setdisplay sidebar.team.<color> <obj>` shows the objective only to
  members of teams of that color; 15 lines; `scoreboard players display name <entry> <obj> <component>`
  and `scoreboard objectives modify <obj> numberformat blank` give free text lines (1.20.3+).
- `tellraw` click events cannot run `/tell` (signed argument); `suggest_command` can prefill chat.
- Misa's trading hall (sandbox copy and live server): 32 villagers at x 167..179, z 410..422 on floors
  y 55 and y 59; stick chest `175 59 424` (sticks), emerald chest `171 59 425` (holds emerald blocks).
  Misa's other storage chests line z 424..426 at y 59..61 (pumpkins, gravel, kelp, shulkers): never
  opened by the trader because its stick chests are listed explicitly.
- Hub console access exists: `mainConsole` (RCON to Paper) and `sandboxConsole` in `server.js`, used by
  `rescue.js` and the admin panel. Remote workers talk to the hub over the websocket (`hubclient.js`,
  messages `status`, `observe`, `claim`, ...). Owner orders are parsed in `owner.js` (`parseOrder`,
  `translate`) and run in `bots.js` `bindOwner`; `makeSayer` throttles replies.

## Goals

1. **See** every bot's state in the game without opening a browser: a sidebar for the owners only.
2. **Order** bots from a chest menu (`/bots`): the same orders the chat already understands, for every
   bot (sandbox workers included), with the reply in chat.
3. **Hear** the bots again: order replies and deaths arrive as chat lines from the console; chat
   signing stays on.
4. Misa's trader (`bot23`) sells sticks in her hall every day.

Non-goals: new job types, a bossbar, holograms, Citizens NPCs, per-viewer sidebars (one list for all
owners), changing the dashboard. Anti-goal: anything that needs `enforce-secure-profile = false`.

## Design

### A. Hub module `app/ingame.js` (hub only, needs `cfg.rcon`)

Owns everything that reaches the main server console for the players. One chained call to
`mainConsole` at a time, like `rescue.js`.

- **Viewers**: `INGAME_VIEWERS` env, names, default `fancy8869,MidariBread`. At start: `team add mcbots`,
  `team modify mcbots color aqua`, `team join mcbots <viewers>`, objective `mcbots` (dummy, numberformat
  blank), `setdisplay sidebar.team.aqua mcbots`. A `/bots` menu button toggles the viewer's team
  membership (sidebar off/on).
- **Sidebar push** every 5 s, only when a line changed: one entry per bot (`scoreboard players set
  <bot> mcbots <n>` for order, `display name` with a short coloured component: name, then the status
  text the dashboard shows (`activity`, shortened to ~28 chars, red when `lastError` is younger than
  the current job, grey when idle/offline, dark red when dead). Bots beyond 15 are dropped
  (guests last).
- **Menu data push** with the sidebar: `pa data del mcbots <bot>` + `pa data set mcbots <bot> <token>`
  per changed bot, token = status text with spaces as `_` (one word). The panels show it in the lore
  (`%commandpanels_data_<bot>,mcbots%`), refreshed by `update-interval: 20`.
- **Order inbox** polled every 2 s: `pa data get <viewer> order` for each viewer; a value `<bot>:<words>`
  (words joined by `_`) is deleted (`pa data del`) and handed to the existing order path: `owner.translate`
  with `owner = viewer`, then the same dispatch `POST /api/job` uses (runner lookup, VALIDATE, remote
  runners). Unknown viewer or bot: ignored, logged. The reply goes through C.
- **Replies (C)**: `say(viewer, botName, text)` → `tellraw <viewer> ["",{"text":"[<bot>] ","color":"aqua"},
  {"text":"<text>"}]` on the main console. Throttled per viewer like `makeSayer` (2 s gap). Sandbox
  bots' replies also go to the main console (the viewers play there).

### B. Replies from the runners

`bots.js` `this.say` no longer whispers. A runner emits `say` (hub-local runner: direct call; remote:
message `{t: 'say', bot, to, text}` over the worker link, hub forwards to A). Deaths: the existing
`died` event is mirrored to all viewers once (`[bot1] gestorben bei x y z`). No other events in chat.

### C. CommandPanels `hosts/bandit-lab/services/minecraft/commandpanels/bots.yml`

- Panel `bots`, command `bots`, condition: player name in the viewers list (same two names, kept in
  the YAML), `update-interval: 20`, rows 3. Layout: one head per bot in roster order
  (`[head] <bot>`; name `&b<bot>`, lore: `&7%commandpanels_data_<bot>,mcbots%`, `&8Klick: Befehle`).
  Row 3: `Alle stopp` (`[console] pa data set %player_name% order alle:stopp`), `Sidebar an/aus`
  (`[console] team leave %player_name%` / `team join mcbots %player_name%` on left/right click).
- Panel `botmenu` (opened by a head: `[session] set bot <name>`, `[open] botmenu`; title
  `%commandpanels_session_bot%`): buttons Komm, Folge, Wache, Gib, Stopp, Status, Holz 32, Stein 32,
  Eisen 16, Kohle 32, Zurück. Each: `[console] pa data set %player_name% order
  %commandpanels_session_bot%:<words>`, `[msg] &7gesendet`, `[close]`. Words as the chat grammar:
  `komm`, `folge`, `wache`, `gib`, `stopp`, `status`, `hol_32_holz`, `hol_32_stein`, `hol_16_eisen`,
  `hol_32_kohle`.
- The bot list in the YAML is static (the roster changes rarely); the hub logs a warning when a bot
  of the roster has no head (builder: compare against `cfg.names`).

### D. Misa's trader daily (`hosts/bandit-lab/services/mcbots/default.nix`)

- `TRADE_HALLS = {"misa": {"hall": {x1:166,y1:54,z1:409,x2:181,y2:61,z2:426}, "stores": [{x:171,y:59,z:425}],
  "sticks": [{x:175,y:59,z:424}]}}` (JSON string).
- `TRADE_SCHEDULE = "bot23=misa@mon,tue,wed,thu,fri,sat,sun/18:00+60"`.
- `PROTECTED_AREAS` gets `166,409,181,427` without `@` (no bot digs or builds in the hall).

## Builder's calls (not decided by the owner)

- Status text source: the dashboard's `activity` string, shortened. Exact colours.
- Message framing between worker and hub for `say`; reuse of the job dispatch code (extract a function
  from the `/api/job` handler rather than copying it).
- Whether the sandbox console also gets the sidebar (not required).
- Tests: `owner-orders.js` style unit tests for the inbox parser (`<bot>:<words>` → order), the sidebar
  line builder (length, colours, 15-line cap), and the token builder; a scenario is not required.

## Verification

- Sandbox first (`nix build` of bandit-lab, then the owner deploys): with the owner online, `/bots`
  opens, heads show the tokens, `Komm` on a main-server bot answers `[MisaBot] ok: komme` in chat, the
  sidebar lists every bot and updates within 5 s, `Alle stopp` stops them.
- `TRADE_SCHEDULE` is exercised by the next 18:00 window: hub log `trade` lines for `bot23`, emeralds in
  `171 59 425`.
