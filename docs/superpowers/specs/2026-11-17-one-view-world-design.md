# One live 3D view: world model, bots, plans, architect chat (design)

Date 2026-11-17. Drafted by the architect (Fable, high effort) in two rounds; approaches picked by the owner in
the visual companion (`.superpowers/brainstorm/131027-1794931349/` in the plan-tab worktree, git-ignored).

## Intent

Owner, 2026-11-17: "ich wollte von Anfang an so eine live 3D Ansicht von der Minecraft-Welt, die die Bots zeigt,
wo der Architekt mitplant, also nicht mehrere Fenster, alles in einem." And on the world source: not BlueMap, but
"so eine Pixel-Map x y z, live mit der Welt abgeglichen, ohne viel Prozessorleistung, die der Architekt und so weiter
nutzen kann, um alles zu entwerfen und gleich ein besseres Bild zu bekommen, damit er weiß, wo welcher Stein ist."

Why: the owner runs his world through bots and has Claude's `architect` design the buildings (wizard castle,
`2026-11-15-wizard-castle-design.md`). Today he juggles 7 dashboard tabs, a 2D map, a separate Plan tab and the
terminal. He wants one place where he sees the world, the bots working, the plans standing where they will be
built, and talks with the architect about them. The same exact world data should make the architect's designs fit
the real terrain. Earlier goal in the same direction: `docs/runbooks/minecraft/CONTROL-CENTRE-GOAL.md` (2026-10-09).

The owner has dyslexia and ADHD: big touch targets, little text, German UI. He uses the phone a lot.

## Goals

- One screen: a live 3D world is always there; everything else is a sheet over it.
- A block model of the world (every block: x, y, z, block state) that stays equal to the real world, read once and
  then followed by changes, with little lab load.
- Bots move live in the view.
- Plans (schematics) stand at their real origins as ghost blocks with build status: built, missing, wrong, unknown.
- The owner chats with the architect inside the dashboard, can drop a 📌 pin on a block with a note, and gets new
  plan versions back as proposals he can take or drop.
- The architect (and other tools) can query the block model for any imported area, with no bot nearby.

## Non-goals (this design)

- Nether and End, biomes, block entities (chest contents), far-terrain level of detail.
- Large redesigns through the chat; those stay in a normal Claude session with the generators (`app/castle/`).
- A systemd unit or always-on host for the bridge.
- Owner block painting (phase 5, still unconfirmed by the owner).

## Anti-goals (failure even if it works)

- Anyone but the owner reaching the architect chat (Anthropic forbids sharing subscription access; owner: "nur für
  mich, niemand anderes").
- Bot physics or Paper tick time getting measurably worse.
- The model showing air where it simply does not know (unknown must never look like air).
- A running build switching plans mid-way because a file was overwritten.
- A UI that needs reading: walls of text, small buttons.

## Constraints

- Hub (`hosts/bandit-lab/services/mcbots/app/`) also runs bot physics on its event loop; no decoding or SQLite on
  that loop.
- No Anthropic key and no Claude process on the lab. Chat runs only while the owner's laptop is on (accepted).
- The repo is public: security comes from Tailscale identity and the existing bearer tokens, never from obscurity.
- Shipping as always: commit unsigned in a worktree, owner pushes, bandit-nix bumps `bandit-craft`, owner deploys.
  The plugin change restarts Paper (players disconnect): ship it when nobody plays, with the restart warning
  script (`AGENTS.md`).
- Smallest complete change; reuse existing code (WebSocket `/ws`, three.js vendored, BotUi HTTP bridge, schematic
  upload and `schematicPlan`).

## Approaches

**World source** (owner picked A after rejecting BlueMap):

| Way | Lab load | Effort | Accuracy |
|---|---|---|---|
| **A. BotUi plugin snapshots + dirty sections (picked)** | Main thread copies chunks under a per-tick cap; encoding async | One Java class, one hub worker; transport and token exist (`BotUi.java` 153-216, `botui.js` long-poll) | One encoder for import and changes; events within 5 s, event-less changes by a sweep |
| B. Region files + block events | Lowest | Anvil/NBT decoder in node, world-dir access, plus the event path | Disk lags until autosave; two decoders must agree |
| C. No stored copy, ask the live world each time | Grows with use, loads chunks on the game server | Lowest | Exact, but nothing works while Paper is down |

Also rejected: BlueMap tiles as a height field (owner: not exact blocks, not usable by the architect), the bots'
own chunks via `/api/voxels` (only where a bot stands, costs bot physics), per-block deltas per event type (misses
types), packet/NMS hooks (break on Paper updates).

**Architect participation** (owner picked the in-dashboard chat on his subscription):

- A. Owner talks in the terminal, view shows changes live. B. Chat field in the dashboard on an API key (cost per
  message). C. Pins only, answered in the next session. Picked: B's experience without B's cost: chat in the
  dashboard, powered by a bridge on the owner's laptop that runs Claude Code headless on his subscription; pins
  from C are part of it.

## Decisions by the owner

- One view instead of tabs.
- Own block model, way A.
- Architect chat inside the dashboard, through the laptop bridge on the owner's subscription; owner-only.
- Accepted defaults ("weiter" after seeing them): no PIN on top of the Tailscale login; Misa and staff see the 3D
  world, bots and plans, but never the chat; event-less changes (WorldEdit, `/fill` typed by hand) may take 3-5
  minutes; first area is base + castle, whole world later; changes visible within 5 s.
- From the plan-tab round (same day): co-planning later means painting blocks layer by layer.

## Design

### Layout

The canvas is always there; today's `main[data-page]` blocks become sheets over it, so their code stays.

```
PHONE                          DESKTOP
+--------------------+   +------+-----------------+---------+
| o            [⏹]  |   | Bots |                 | 💬      |
|                    |   | list |    3D world     | Archi-  |
|     3D world       |   |      |  bots + plans   | tekt    |
|  bots + ghosts     |   |------|                 |         |
|            [📌][▤] |   | Plan |        [📌][▤]  | [text ] |
|====================|   | 62 % |                 |         |
| sheet (half high)  |   +------+-----------------+---------+
|--------------------|   | 🤖   🏰   💬   ☰               [⏹] |
| 🤖   🏰   💬   ☰   |   +----------------------------------+
+--------------------+
```

- 🤖 Bots: today's Übersicht list; tapping a bot flies the camera to it and shows its orders (Aufträge moves here).
- 🏰 Plan: plan chips with a percent ring, pause/resume (Projekt moves here), height slider ▤.
- 💬 Architekt: the chat; the button is hidden when `/api/architect/status` answers 404.
- ☰: Kisten and Server, unchanged, full height.
- Dropped: the 2D Karte tab (a top-down camera button replaces it; `legacy.html` stays reachable as today) and the
  separate Plan tab.

### World model

```
Paper (BotUi + WorldFeed.java)
  import: getChunkAtAsync(gen=false) -> snapshot -> sections
  live:   block events -> dirty (chunk, section) -> snapshot -> changed sections
  sweep:  loaded chunks round-robin, hash compare (catch-all)
      |  GET /world/pull?ack=&wait=25   (127.0.0.1:8101, existing bearer)
hub worker thread (worldmodel.js): node:sqlite in STATE_DIR, LRU of decoded sections
      |  messages (buffers only)
hub server.js
  /api/world/sections?cx&cz&r      browser: columns near the camera
  /api/world/changes?since=        browser: when state().worldSeq moves
  /api/world/blocks | height | materials   architect, plan status
```

- One section format end to end: key (dim, cx, sy, cz); a palette of block-state strings, a bit width, packed
  indices (Minecraft's own layout). The hub stores blobs and never re-encodes.
- Strip volatile redstone properties in the encoder (`power`, `powered`, `lit`, `triggered`) and do not subscribe
  to redstone events, or the sorter and dupers dirty their sections every tick.
- Plugin budget: at most 1 ms of snapshots per tick, at most one snapshot per chunk every 2 s; event handlers only
  add a key to a set. A dirty chunk is snapshotted in `ChunkUnloadEvent` before it goes.
- Marks, not payloads: the hub pulls, so nothing is lost while the hub is down.
- Events: place, break, explode (block and entity), piston, fluid flow, grow, spread, form, fade, burn, leaves
  decay, entity change block, structure grow.
- After its own RCON `/fill` or `/setblock` (e.g. `castle/armoury.js` furniture) the hub posts the box to
  `/world/dirty`.
- Every query lists chunks the model lacks as `unknown`; unknown is never air. Chunks never generated
  (`gen=false` import) get their own `ungenerated` marker, so they are not retried forever.
- Which world: the main Paper only. All bots play there today (no module sets `MC_VHOST`; checked 2026-11-17 on
  craft main 298ba71, which is live). If sandbox mode returns, sandbox bots are left out of the view, as
  `markersOf` already does.
- On every plugin start, a full hash re-sweep of the imported area (dirty marks live in plugin memory and are
  lost on a Paper restart; ~90 s for the first area).
- Output bounds: blocks up to 32,768 cells, height map up to 128 x 128, materials up to 2M cells; beyond that 413.
- First area: centre -270, -20, radius 320 blocks (41 x 41 = 1681 chunks): castle, sorter, armoury, supply chest,
  iron farm, church. About 90 s to import at ~20 chunks/s; about 20 MB (estimate, not measured).
- Plugin: new `hosts/bandit-lab/services/minecraft/botui/WorldFeed.java`, listed by name in the `cp` and `javac`
  lines of `botui/default.nix`.

### Plans and progress

- A plan is identified by `(file, origin)`, not by a bot. `GET /api/plan/status?file=&origin=` (or `?bot=`,
  which resolves to that bot's schematic project and its args) runs `schematicPlan` (`build.js`, rotation,
  mirror, substitutes) and reads the world model; returns `{origin, palette, blocks: [[x,y,z,i,s]]}` with absolute
  coordinates. `s`: 0 missing, 1 built, 2 wrong, 3 unknown.
- Drawing: built solid, missing a 35 % ghost, wrong red at scale 1.02, unknown a grey ghost, architect proposal a
  blue ghost; `polygonOffset` against the terrain.
- Sites: `STATE_DIR/plan-sites.json` (file -> origin) so unbuilt modules show. Written by the hub when a
  schematic project starts and by the bridge's reply `origin` (an owner-gated route); seeded once by hand from the
  origins in the `castle/make.js` comments.
- Terrain: one mesh per section, face-culled, built in a Web Worker, coloured by the existing block colour
  function. Greedy merging only if phone frame rate measures poorly.

### Architect chat and bridge

- Routes under `/api/architect/`: `GET status` (`bridge: on|off`, on = last inbox poll < 15 s ago), `GET chat?since=`,
  `POST chat {text, pin?}` for the browser (polls every 3 s while the sheet is open); `GET inbox?after=`,
  `POST reply {to, text, plan?: {file, base, origin}}` for the bridge. State in `STATE_DIR/architect.json`: last 200
  messages, text up to 2000 characters.
- Owner-only gate, fail closed: new env `ARCHITECT_LOGIN` holds exactly one login. Every `/api/architect/*` route
  requires a trusted proxy peer and `tailscale-user-login === ARCHITECT_LOGIN`, else 404. Unset means chat off,
  also in local mode. Do not reuse `cfg.allowed`. No chat data in `state()` or `/ws` (broadcast to all clients).
- Pins are chat messages with `pin: {x,y,z,file}`; markers are drawn from the chat history.
- Bridge on the laptop: reaches the hub through `tailscale serve` under the owner's login (no new secret). Polls
  `inbox` every 3 s, runs `claude -p --agent architect --model fable --output-format json --resume <sid>` in a
  scratch directory holding the plan JSON and the castle spec, tools limited to Read and an allowlisted
  `node world-query.js` for model queries. Effort: high (owner asked for Fable high; flag on the bridge, costs
  subscription limit).
- Plan changes: reply = text + optional `{"set":[[x,y,z,"block"]],"remove":[[x,y,z]]}` in absolute world
  coordinates; the block is a full block-state string with properties (`minecraft:oak_stairs[facing=east,half=bottom]`).
  `remove` drops the cell from the plan; bots leave what is already built (clearing to air is a later owner call).
  The bridge checks bounds, block names and count, subtracts the origin, applies it to the base, writes with
  `litematic-write.js`, uploads via `POST /api/schematic` as `<base>-vN`.
- Proposals only for plans the writer can round-trip: rotation 0, no mirror, no substitute, no tile entities
  (the castle-generator modules). For any other plan the architect may answer and pin, but the bridge rejects a
  proposal with a short reason (the writer drops tile entities and explicit air, and would need the inverse
  transform). Never overwrite a plan file (`build.js` re-parses a replaced file; names are cut at
  40 characters by the upload sanitiser). Architect drafts stay out of the in-game plan list.
- Laptop off: messages queue, the sheet shows "Architekt schläft", answered at the next start.
- "Nehmen": if a project for the base file exists, it is paused and its bot gets the schematic job with the new
  file at the same origin, keeping the old args (`anySolid` etc.). With no project, the sheet asks which bot (the
  existing bot picker). "Weg" hides the proposal.

## Phases

0. World model, no UI: WorldFeed, hub worker, store, `/api/world/*`, first-area import, the three checks below.
1. One view from the model: canvas, terrain meshes, bots from `/ws`, plans with status, bottom bar and sheets.
2. Sites and follow camera.
3. Chat, pins, bridge (started by hand) with the world query script.
4. Proposals (blue ghosts, Nehmen / Weg).
5. Whole world (import unknown chunks on first load, owner-set areas), owner painting.

Each phase ships on its own.

## Success checks

1. Equality: plugin route `GET /world/sample?n=500&seed=` returns true block states from the live world (also
   unloaded chunks via `getChunkAtAsync`); a script compares them with `/api/world/blocks` and expects 0 differences
   (a mismatch is re-read once after 5 s). A second run follows scripted changes: a bot places and breaks, a
   piston, TNT, a water bucket, an RCON `/fill`.
2. Load: 30 minutes before and after, same bot jobs. Paper `mspt` +0.5 ms or less, hub loop delay p99 +2 ms or
   less (add `perf_hooks.monitorEventLoopDelay` to `/api/debug`), plugin main-thread ms per minute from
   `/world/stats`.
3. No bot: a box at least 300 blocks from every bot and player returns no `unknown` from `/api/world/height` and
   `/blocks` and equals the sample; then one bridge run where the architect answers the ground height there.
4. Chat gate: a test that a second allowed login gets 404 on every `/api/architect/*` route.
5. Per slice: `mcbots-tests` flake check, a phone-width look, hub loop lag while status polls run.

## Not verified (builder checks first)

- Snapshot cost on Paper 26.2 (`getChunkSnapshot(false,false,false)`); `/world/stats` will show it.
- `node:sqlite` on the lab's `nodejs_22` (needs 22.13+ unflagged): `node -e "require('node:sqlite')"`. Fallback: one
  blob file per region.
- Number of loaded chunks (sets the sweep period); plugin HTTP pool has 4 threads and the long-poll holds one.
- `claude -p --agent architect` end to end and the `--allowedTools` Bash pattern syntax: one manual run.
- Whether a schematic build removes blocks a new version drops (`build.js` `step()` / `clear`).
- Hub allowlist and env as deployed (mcbots runs as the `docker-mcbots` container from this `default.nix`).

## Calls made without the owner (builder check, 2026-11-17)

Marked so the owner can veto while reading: main world only; plan identity `(file, origin)`; `plan-sites.json`
writers; `remove` = drop from plan; proposals only for round-trippable plans; Nehmen keeps the old bot and args;
re-sweep on plugin start; `ungenerated` marker; bridge effort high.

## Left to the builder

File layout inside `app/`, section blob compression, LRU size, mesh colours, sheet animations, exact polling
intervals within the stated bounds, the bridge script's language (node, like the hub).
