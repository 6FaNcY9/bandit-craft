# Bot control phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner and Misa command and watch their servants in game with a wizard's staff: every order for what they aim at, "Ich brauche X" (the existing `get` order, B51), material for a plan, "Wenn frei" idle orders, owner-only alerts with a join digest, plan upload by click, servants that look alive, and movement counters.

**Architecture:** Extend the Kommandostand. The Paper plugin `BotUi.java` stays a bridge (new: staff item, entity aim, `lage`/`join` events); all decisions live in the hub (`botui*.js`, new small pure modules `idle.js`, `alerts.js`, `alive.js`, `counters.js`, `uploads.js`) with tests in `app/test/`.

**Tech Stack:** Node 24 (mcbots hub, mineflayer 4.39, pathfinder 2.4.5), Paper 26.2 plugin (Java, built by `minecraft/botui/default.nix`), Nix.

**Spec:** `docs/superpowers/specs/2026-11-06-bot-control-design.md` (phase 1, sections 2-7 and 10) and its prompt `2026-11-06-bot-control-design-prompt.md`.

All app paths below are under `hosts/bandit-lab/services/mcbots/app/`. Tests run with
`NODE_PATH=<mcbots node_modules from the nix store> node test/<topic>.js` (BOTS.md has the line); the whole suite is `node test.js`.

## Global Constraints

- Player-facing text is German; code, comments, commits English.
- VALIDATE (`bots.js`) has the last word on every job's args; every click payload is untrusted.
- The viewer is the Bukkit player (`e.player`), never a payload field; `allowedBots`/`resolveBots` stay the only bot mapping and reject foreign bots.
- Guests (`GUEST_BOTS`) stay out of keeper, board and help; owner-only switches stay in `ownerOnly` (`botui.js:13`).
- A closed dialog never re-opens by itself; one tellraw per viewer and bot per gap (`ingame.js` `say`).
- Alerts: one per viewer, bot and kind per 10 min; digest at most 6 lines.
- Upload: one-time token, 10 min, one use, bound to the player; 2 MB per file; 50 files per player; checked with `schematicLib.parseLitematic`.
- Alive loop: never digs or places, never during a job, fight (`combat.busy`), night shelter (`r.sheltered`) or open window.
- Repo is public: no secrets, no per-device data. Commits unsigned in the worktree; the owner pushes and deploys.

## Review Focus

1. A staff right-click on a chest, door or lever must still open it (as the map does): only sneaking or a non-usable block opens the dialog. → test in Task 2 (stand e2e) and code mirrors `onUse` of the map.
2. A "Wenn frei" pref whose zone, chest or schematic is gone must fail like an order and wait, not loop every minute. → Task 4 test `idle: a failing pref waits ORDER_RETRY_MS`.
3. An upload token used twice, by another player, after 10 min, or with a non-litematic body must be refused without writing a file. → Task 7 tests.
4. A digest for a viewer who never quit before (first join after deploy) must not dump the whole event log. → Task 5 test `digest: no last quit = no digest`.
5. Misa's alerts and digest must never mention the owner's bots, and Misa's plan list never shows `fancy8869-*` files. → Task 5 and Task 7 tests.

---

### Task 1: Catalog: "Material für Bauplan", "Hierher rufen", entity rows

**Files:**
- Modify: `botui-jobs.js` (JOBS, `contextJobs`)
- Test: `test/botui-jobs.js`

**Interfaces:**
- Produces: JOBS keys `produce` (`{label: 'Material für Bauplan', type: 'produce', general: true, needs: [schematic, where, rotation, chest]}`, args `{file, origin: pt(v.at), rotation, chests: [pt(v.chest)], store: pt(v.chest)}`), `summon` (`{label: 'Hierher rufen', type: 'goto', general: true, needs: []}`, args = the viewer's floored `ctx.pos` as `{x,y,z}`), `followme` (`type: 'follow'`, args `{player: <viewer>}`), `hunt` (`type: 'hunt'`, args `{animal, count: v.n, x,y,z: gaze pos, radius: 24}`, needs `count(1, 32, 1, 4)`).
- Produces: `contextJobs(gaze, allowed, viewer)`; `gaze.entity` = `{type: string, name: string|null, x, y, z}` from Task 2. Rows: entity type `player` and name is a viewer's bot → `{key: 'botscreen', preset: {bot: name}}` (handled in Task 3); other player → `followme`, `guard` (preset at entity pos); `cow|sheep|pig|chicken` → `hunt` (preset `animal`); always `summon` first for any gaze.
- `build(key, data, env)` gets `env.viewer` (string) for `followme`.

- [ ] **Step 1: Write failing tests** in `test/botui-jobs.js`: `build('produce', {file:'house.litematic', where:'pos', rotation:0, chest:'supply'}, env)` returns `{type:'produce', args:{file:'house.litematic', origin:{x:3,y:64,z:4}, rotation:0, chests:[{x:10,y:65,z:10}], store:{x:10,y:65,z:10}}}` (harness supply 10 65 10, pos 3 64 4); `build('summon', {}, env)` → `{type:'goto', args:{x:3,y:64,z:4}}`; `contextJobs({x:1,y:2,z:3,block:'air',entity:{type:'cow',name:null,x:1,y:2,z:3}}, '*', 'Fancy').map(r=>r.key)` equals `['summon','hunt','goto','guard','tidy']`; entity player `MisaBot` for viewer `Midari` (allowed `['MisaBot']`) → first rows `['summon','botscreen']`; entity player `Steve` → includes `followme` and `build('followme', {}, {...env, viewer:'Midari'}).args` = `{player:'Midari'}`.
- [ ] **Step 2: Run** `node test/botui-jobs.js` → FAIL (unknown keys).
- [ ] **Step 3: Implement** the four JOBS entries and the entity branch in `contextJobs`; add `produce` to `CRAFTS`-style lists nowhere (it uses `schematic` input). VALIDATE.produce and VALIDATE.hunt check the args.
- [ ] **Step 4: Run** `node test/botui-jobs.js && node test/botui-screens.js` → PASS.
- [ ] **Step 5: Commit** `feat(botui): material for a plan, summon, orders for aimed-at animals and players`.

### Task 2: Plugin: Zauberstab, entity aim, `lage` and `join` events

**Files:**
- Modify: `../../minecraft/botui/BotUi.java` (emit, onUse, new onLeft, onJoin, onCommand), `../../minecraft/botui/plugin.yml` (command `zauberstab`)
- Modify: the `/bots` panel in `../../minecraft/commandpanels/` (the file that defines `/bots`; grep `bots` there): a button "Zauberstab holen" running `zauberstab`
- Test: `tools/botui-stand/e2e-bridge.js` (extend), stand run `tools/botui-stand/stand.sh`

**Interfaces:**
- Produces events (JSON as today plus): `gaze.entity` = `{type, name, x, y, z}` from `p.getTargetEntity(32)` (type = `getType().getKey().getKey()`, name = player name or null); event types `open` (staff right-click), `lage` (staff left-click: `PlayerInteractEvent` LEFT_CLICK_AIR/BLOCK with the staff, cancelled), `join` (`PlayerJoinEvent` for viewers), `quit` (exists).
- Staff = `Material.STICK` with display name `Zauberstab` (dark purple), lore `Rechtsklick: Befehle · Linksklick: Lage`, and a `PersistentDataContainer` key `botui:staff` (byte 1). `isStaff(ItemStack)` checks only the key. `/zauberstab` gives one to a viewer (non-viewers: "Nicht freigeschaltet"); it carries no rights.

- [ ] **Step 1: Extend the stand e2e** so it sends a staff right-click on air, a staff left-click, a staff right-click on a chest while not sneaking, and a join; expect events `open` (with `gaze`), `lage`, no event for the chest click, `join`.
- [ ] **Step 2: Run** `tools/botui-stand/stand.sh` → FAIL.
- [ ] **Step 3: Implement** in `BotUi.java`: staff item, `isStaff`, right-click handling mirrors the map's `onUse` (usable block without sneaking = vanilla use; cooldown `MAP_CLICK_COOLDOWN_MS`), left-click → `tryOpen(p, "lage")`, entity aim inside `emit`, `onJoin` emits `join` for viewers after `map.join`.
- [ ] **Step 4: Run** the stand e2e → PASS; build the plugin: `nix build .#nixosConfigurations.bandit-lab.config.system.build.toplevel` from bandit-nix with `--override-input bandit-craft git+file://$PWD` (AGENTS.md) → builds.
- [ ] **Step 5: Commit** `feat(botui): the wizard's staff opens orders for what it points at`.

### Task 3: Hub screens: staff events, bot screen from an aimed-at bot, "Wenn frei" button

**Files:**
- Modify: `botui.js` (`handle`: `lage`, `join`; ACTIONS `botscreen`, `idle_open`, `idle_set`), `botui-screens.js` (bot screen button `Wenn frei: <label>`, screen `wennfrei`)
- Test: `test/botui.js`, `test/botui-screens.js`

**Interfaces:**
- Consumes: Task 1 `contextJobs` rows, Task 4 `idle.CHOICES` and `api.idle.get(bot)`/`api.idle.set(bot, choice|null)`.
- Produces: event `lage` → screen `lage`; `join` → `api.digest(viewer)` (Task 5) and no dialog; ACTION `botscreen {bot}` → screen `bot` for an allowed bot; `idle_open {bot}` → screen `{name:'wennfrei', bot}` listing `idle.CHOICES` (labels) plus `Nichts`; `idle_set {bot, choice}` → `api.idle.set` and flash `MisaBot: wenn frei → Holz-Schicht`.

- [ ] **Step 1: Failing tests**: a `lage` event shows the Lagebild; `idle_set` for a foreign bot flashes `nicht dein Bot` and does not call `api.idle.set`; `idle_set {bot:'MisaBot', choice:'holz'}` by Midari calls it with `'holz'`; the bot screen JSON contains `Wenn frei: Nichts` when unset.
- [ ] **Step 2: Run** `node test/botui.js` → FAIL.
- [ ] **Step 3: Implement** (rights through `oneBot`).
- [ ] **Step 4: Run** `node test/botui.js && node test/botui-screens.js && node test/botui-jobs.js` → PASS.
- [ ] **Step 5: Commit** `feat(botui): pick a servant by pointing at it and set what it does when free`.

### Task 4: "Wenn frei" store and hub sweep

**Files:**
- Create: `idle.js`
- Modify: `server.js` (botui api `idle`, the minute sweep after projects), `config.js` nothing
- Test: `test/idle.js` (add to `test.js`)

**Interfaces:**
- Produces: `CHOICES` = ordered list of `{id, label, key, data}`: `holz` (`Holz-Schicht in meine Kiste`, key `shiftlogs`, data `{chest:'own'}`), `stein` (`Stein-Schicht`, `shift`, `{block:'stone', chest:'own'}`), `wache` (`Bewachen hier`, `guard`, `{where:'mark', radius:16}`), `baumfarm` (`Baumfarm`, `treefarm`, `{zone:'first'}`), `keeper` (`Daueraufträge`, owner's bots only, no key: it only clears the pref and leaves the bot to the keeper).
- `class IdleStore { constructor(file); get(bot) -> {id, mark?}|null; set(bot, id|null, mark?) }` (file `STATE_DIR/idle.json`, atomic write like prefs.js). `mark` = the `{x,y,z}` where `wache` was set (the bot's position then).
- `idleToStart({snaps, store, busy: Set<bot>, retryAt: Map, idleSince: Map, now}) -> [{bot, choice}]`: bot online, no job, empty queue, not in `busy` (owner order, unpaused project, keeper work, board slice), idle ≥ 60000 ms, `retryAt` passed.
- Server: for each, resolve `'own'` to the bot's chest pref (else the supply chest for non-guests; guests without a chest → event `Wenn frei braucht eine Kiste`), `'first'` to the first `treefarm` place, `'mark'` to the stored mark, then `submitJob` (agent false, not a standing owner order: `remember: false` flag added to `submitJob` so `ownerOrders` is not set). A thrown error or a later `fail` sets `orderRetryAt` (`agentauth.ORDER_RETRY_MS`).

- [ ] **Step 1: Failing tests** `test/idle.js`: `idleToStart` returns MisaBot after 60 s idle with pref `holz`; nothing at 59 s; nothing while in `busy`; nothing before `retryAt`; `IdleStore` round-trips and survives a missing file; **`idle: a failing pref waits ORDER_RETRY_MS`** (simulate: start, then `retryAt` set → not returned until passed).
- [ ] **Step 2: Run** `node test/idle.js` → FAIL.
- [ ] **Step 3: Implement** `idle.js` and the server wiring (busy = ownerOrders keys ∪ unpaused projects ∪ keeper work bots ∪ board holders).
- [ ] **Step 4: Run** `node test/idle.js && node test.js` → PASS.
- [ ] **Step 5: Commit** `feat(mcbots): servants take their "Wenn frei" order when idle`.

### Task 5: Alerts to the bot's owner and the join digest

**Files:**
- Create: `ownalerts.js` (`alerts.js` is the existing base-alert module)
- Modify: `ingame.js` (`Ingame` gets `viewerBots` and calls `ownalerts`), `server.js` (quit times in `STATE_DIR/viewers.json`, `api.digest`)
- Test: `test/ownalerts.js`

**Interfaces:**
- `classify(event) -> 'dead'|'stuck'|'missing'|'done'|null`: `kind==='death'` → dead; `kind==='fail'` and `/no progress for|No path/` → stuck; text `/no way to get/` → missing; `kind==='done'` and duration `(\d+) s\)` ≥ 600 → done.
- `text(kind, event, snap) -> string` German, ≤ 100 chars: `tot bei x y z`, `steckt fest bei x y z: kein Weg`, `fehlt: <rest of text>`, `fertig: <job>`.
- `ownersOf(bot, viewerBots) -> viewer[]` (`'*'` or list includes bot).
- `class OwnAlerts { constructor({say, viewerBots, now}); event(e, snap) }` rate limit key `viewer|bot|kind`, 600000 ms.
- `digest(events, bots, since, now) -> string[]` (≤ 6 lines, newest first, `Seit du weg warst:` header counted; `since == null` → `[]`).

- [ ] **Step 1: Failing tests**: classify each sample; Misa never gets an alert for `bot2`; two `stuck` for MisaBot within 10 min → one say; **`digest: no last quit = no digest`**; digest for Midari lists only MisaBot/EM_Trader lines.
- [ ] **Step 2: Run** `node test/ownalerts.js` → FAIL.
- [ ] **Step 3: Implement**; wire `events` onAdd → `ownAlerts.event(e, runners.get(e.bot)?.snapshot())`; botui `quit` → store `now`, `join` → `ingame.say` each digest line (bot label `Diener`).
- [ ] **Step 4: Run** `node test/ownalerts.js && node test/ingame.js && node test.js` → PASS.
- [ ] **Step 5: Commit** `feat(mcbots): owners hear when their servant dies, sticks or lacks material, and get a digest on joining`.

### Task 6: Servants look alive when idle

**Files:**
- Create: `alive.js`
- Modify: `bots.js` (BotRunner: start/stop the loop on spawn/end)
- Test: `test/alive.js`

**Interfaces:**
- `aliveStep({me: {x,y,z}, players: [{name, uuid, x, y, z}], owners: uuid[], now, state}) -> {look: {x,y,z}|null, sneak: boolean, aside: {dx, dz}|null, state}`: look at the nearest player ≤ 8 blocks (eye height +1.6); an owner ≤ 3 blocks starts one 500 ms sneak per approach (`state.bowed[uuid]` until they leave 5 blocks); a player ≤ 0.8 blocks → `aside` = one block away from them on the axis with the larger offset.
- Runner loop every 250 ms only when `online && !job && !queue.length && !combat?.busy && !sheltered && !bot.currentWindow`; `aside` moves only if the target cell has a solid floor at the same y and air for feet and head (`bot.blockAt`); uses `bot.lookAt`, `setControlState('sneak')`, a 300 ms `setControlState` walk; never pathfinder, dig or place.

- [ ] **Step 1: Failing tests**: nearest player chosen; nobody → `look: null`; owner at 2 blocks → `sneak: true` once, false on the next step while still near; stranger at 2 blocks → no sneak; player at 0.5 blocks on +x → `aside {dx:-1, dz:0}`.
- [ ] **Step 2: Run** `node test/alive.js` → FAIL.
- [ ] **Step 3: Implement** `alive.js` and the runner hook (owners = `this.ownerUuids`).
- [ ] **Step 4: Run** `node test/alive.js && node test.js` → PASS.
- [ ] **Step 5: Commit** `feat(mcbots): idle servants watch players and bow to their master`.

### Task 7: Plan upload by click

**Files:**
- Create: `uploads.js`, `public/upload.html`
- Modify: `server.js` (routes `GET /upload`, `POST /upload` exempt from the Tailscale-login check but token-gated; `api.uploadLink(viewer)`; `api.schematics(viewer)` filter), `botui.js` (ACTION `upload`), `botui-screens.js` (button `Bauplan hochladen`; result dialog with an `open_url` action)
- Test: `test/uploads.js`, `test/botui.js`

**Interfaces:**
- `class Uploads { constructor({now}); issue(player) -> token (32 hex, crypto.randomBytes(16)); take(token) -> player|null }` (10 min, one use).
- `fileName(player, name) -> '<player lowercased>-<name sanitised to [A-Za-z0-9_-], max 40>.litematic'`.
- `visible(files, viewer, owner) -> files`: shared (no `<anyviewer>-` prefix) plus the viewer's own prefix.
- Limits: body ≤ 2 MB (reject before parsing), ≤ 50 files with the player's prefix, `parseLitematic` must succeed; success → event `schematic <file> uploaded by <player>` and `ingame.say(player, 'Server', 'Bauplan bereit: <name>')`.
- Dialog link: `{type: 'minecraft:open_url', url}` button; the URL is `https://<dashboard host>/upload?t=<token>` from new env `UPLOAD_BASE` (default the existing serve URL).

- [ ] **Step 1: Failing tests**: token works once; second `take` → null; after 10 min → null; **foreign token**: `take` returns the issuing player only; non-litematic body → 400 and no file; 2 MB + 1 → 413; 51st file → 400; `visible` hides `fancy8869-*` from Midari and shows shared files.
- [ ] **Step 2: Run** `node test/uploads.js` → FAIL.
- [ ] **Step 3: Implement**; `upload.html` is one file input and a fetch POST (German text, no external scripts).
- [ ] **Step 4: Run** `node test/uploads.js && node test/botui.js && node test.js` → PASS.
- [ ] **Step 5: Commit** `feat(mcbots): players upload plans from the game through a one-time link`.

### Task 8: Movement counters

**Files:**
- Create: `counters.js`
- Modify: `bots.js` (count at the `No path` and `no progress for` sites, snapshot field `moves`), `botui-screens.js` (bot screen line; Lagebild bot line `wartet auf: …` when `activity` starts with `waiting:`, spec section 3)
- Test: `test/counters.js`, `test/botui-screens.js`

**Interfaces:**
- `class HourCounter { constructor(now); add(); count() }` (timestamps of the last 3600000 ms).
- Snapshot `moves: {pullbacks, noPath, stalls}` (pullbacks from `this.trace.recentCorrections()` as today).
- Bot screen line: `Wege/h: 0 Rücksetzer · 1 kein Weg · 0 fest`.

- [ ] **Step 1: Failing tests**: counter drops entries older than one hour; bot screen shows the line from a snapshot with `moves`; a Lagebild line for activity `waiting: material stone_bricks` reads `wartet auf: material stone_bricks`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `node test/counters.js && node test/botui-screens.js && node test.js` → PASS.
- [ ] **Step 5: Commit** `feat(mcbots): count pullbacks, missing paths and stalls per hour`.

### Task 9: Movement check in the sandbox (doors, ladders, vines, scaffolding)

**Files:**
- Create: `tools/mcbots-parkour/spike.js`, `tools/mcbots-parkour/run.sh`, `tools/mcbots-parkour/README.md` (from the 2026-11-05 scratchpad spike), `docs/runbooks/minecraft/movement-check.md`

- [ ] **Step 1:** Add courses: a closed oak door, a fence gate, a 6-high ladder, vines, a scaffolding tower, a 3-wide water crossing; the existing gap course stays.
- [ ] **Step 2: Run** `tools/mcbots-parkour/run.sh` with bot50 against the sandbox (never live bots); expected: a table per course (success, time, corrections), course removed at the end.
- [ ] **Step 3:** Write the table and what fails into `movement-check.md`; failures become phase 4 items there, no bot code changes in this task.
- [ ] **Step 4: Commit** `tools: movement check course for doors, ladders, vines, scaffolding and water`.

### Task 10: Docs, deploy, live checks

**Files:**
- Modify: `docs/runbooks/minecraft/BOTS.md` (staff, Wenn frei, alerts, upload, alive), `docs/guides/misa-bots.de.html` and regenerate `docs/guides/misa-bots.pdf` (Chromium headless with `--password-store=basic`)
- bandit-nix: tailnet policy grants Misa's node `tcp:8445` on the lab (owner approves the policy change)

- [ ] **Step 1:** Update the docs (German guide: Zauberstab holen, rechts/links klicken, Wenn frei, Bauplan hochladen).
- [ ] **Step 2: Run** `node test.js` → all ok; lab build with this checkout (AGENTS.md command) → builds.
- [ ] **Step 3: Commit** `docs: the wizard's staff for the owner and Misa`; owner deploy script `~/control-deploy.sh` (push, craft-bump, ship-claude) as in the 2026-11-05 deploy.
- [ ] **Step 4: Live checks** (owner and Misa in game): staff from `/bots`; Misa's dialog opens (her client); Misa gives `Holz-Schicht` to MisaBot in under 30 s without help; owner orders `Material für Bauplan` on a test plan and a bot starts fetching; one alert of each kind seen in the sandbox or live; a plan uploaded by Misa shows in her list and not in the owner's.
