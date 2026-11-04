# Kommandostand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chest menus with native dialog screens authored by the hub, opened by Shift+F, using the player's gaze as order input, plus a live map item.

**Architecture:** A small Paper plugin `BotUi` bridges dialogs, clicks, gaze, outlines and map rendering over loopback HTTP. The Node hub (`app/botui.js`) long-polls it, keeps per-viewer state and builds every screen with pure functions (`app/botui-screens.js`, `app/botui-jobs.js`). Orders go through the same path as the dashboard's `POST /api/job`.

**Tech Stack:** Java 25 against the API jars bundled in Paper 26.2-130 (JDK `HttpServer`, Gson from Paper, `ImageIO`), Node 22 (no new dependency), Nix, a local Paper "stand" for end-to-end tests with `minecraft-protocol` from the hub's dependencies.

**Spec:** `docs/specs/2026-11-04-kommandostand.md`

## Global Constraints

- All paths below are relative to worktree `~/src/bandit-craft-kommando` (branch `feat/kommandostand`). `A` = `hosts/bandit-lab/services/mcbots/app`, `M` = `hosts/bandit-lab/services/minecraft`.
- Nothing permanent on the HUD. No chat lines from dialog orders; the existing `fertig:` report stays.
- A dialog must never pop up again after the player closed it. This outranks live refresh.
- Player-facing copy is German. Code, comments and commits are English.
- No new npm dependency. No new SOPS value. No new Paper plugin other than `BotUi`.
- Identity comes only from the plugin's Bukkit player, never from a payload field. Every click is validated on the hub.
- Plugin port `8101`, bearer token = `rcon.password` from `server.properties`, bound to `127.0.0.1`. The env `BOTUI_PORT` and `BOTUI_BLUEMAP` override port and BlueMap base URL for tests only.
- Hub stays fully usable when the plugin is absent: `cfg.botuiUrl` empty means no BotUi at all; a failing plugin only logs (once per outage).
- Commits unsigned, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push. Test command for all hub tasks: `node test/<part>.js` from `A` with `NODE_PATH` as in `docs/runbooks/minecraft/BOTS.md`.

## Review Focus

- A player closes with Escape, or walks off while the hub thinks a dialog is open: no further `/show` may reach them. Test in Task 2.
- Plugin or hub restarts mid-session (the `boot` id changes, connection refused for minutes): polling recovers without a hub restart, viewers are pushed again, one log line per outage. Test in Task 2.
- Forged or garbled click from a viewer's client: Misa ordering `bot1`, unknown action, count `NaN` or `1e9`, 10 KB text, coordinates `a b c`: refused with a result line, the loop survives. Test in Task 4.
- Snapshot with missing fields (offline bot with no `pos`, no `job`, no `tool`; error text with quotes, `§` and newlines; a very long error): builders do not throw and output is valid JSON with truncated text. Test in Task 3.
- Gaze is null (looking at the sky), or corner A in the overworld and B in the Nether, or a box over the job's limit: a clear German reason, never a crash. Test in Task 4.

---

### Task 1: Plugin bridge and test stand

**Files:**
- Create: `M/botui/BotUi.java`, `M/botui/plugin.yml`, `M/botui/default.nix`
- Create: `tools/botui-stand/stand.sh`, `tools/botui-stand/client.js`, `tools/botui-stand/e2e-bridge.js`
- Modify: `flake.nix` (`checks.botui`)

**Interfaces:**
- Produces (HTTP, all require `Authorization: Bearer <token>`, else 401; bad input 400 `{error}`):
  - `POST /viewers {names: string[]}` -> `{ok: true}`. Only these players may open and use Shift+F.
  - `POST /show {player, dialog: string}` -> `{ok: boolean, feedback: string}`; arms open tracking for that player when ok.
  - `POST /close {player}` -> `{ok: true}` (runs `dialog clear`, disarms).
  - `GET /events?since=N&wait=S` -> `{boot: string, last: number, events: Event[]}`; waits up to `S` (max 25) seconds when none is newer. A `since` above `last` returns all queued events.
  - `POST /outline {player, box: {x1,y1,z1,x2,y2,z2} | null}` -> `{ok: true}`.
- `Event = {id, type: 'open'|'click'|'closed'|'mapclick'|'quit', player, pos: [x,y,z], dim: 'overworld'|'the_nether'|'the_end', yaw, gaze: {x,y,z,block} | null, data?: object}`. `data` exists on `click` only: the payload compound as flat JSON (strings stay strings, every number and byte becomes a number, nested values are dropped).
- Produces (Nix): `M/botui/default.nix` is `{pkgs}: <jar derivation>`.

- [ ] **Step 1: Write `M/botui/default.nix`.** `fetchurl` the Paper jar (`https://fill-data.papermc.io/v1/objects/715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba/paper-26.2-130.jar`, sha256 `715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba`), `unzip -j 'META-INF/libraries/*.jar'` into `libs/` (comment why: the API ships inside the Paper jar, so no snapshot URL can rot), `javac --release 25 -proc:none -Xlint:all,-classfile,-processing -Werror -cp 'libs/*'` with `pkgs.jdk25_headless`, copy `plugin.yml`, deterministic `jar --date 1980-01-01T00:00:02Z`, same shape as `M/botgate/default.nix`. Add `botui = import ./hosts/bandit-lab/services/minecraft/botui {inherit pkgs;};` to `checks`.

- [ ] **Step 2: Write `tools/botui-stand/stand.sh`** with `up` and `down`. `up`: builds the jar with `nix build .#checks.x86_64-linux.botui`, creates `${XDG_RUNTIME_DIR}/botui-stand`, fetches the same Paper jar and the ViaVersion and ViaBackwards jars pinned in `M/plugins.nix` (verify hashes), writes `eula.txt` and a `server.properties` with `online-mode=false`, `server-port=25599`, `server-ip=127.0.0.1`, flat world, `enforce-secure-profile=false`, `rcon.password=stand-token`, starts Paper with stdin from a FIFO, waits for `Done (`. `down`: sends `stop`. JDK via `nix shell nixpkgs#jdk25_headless`. Exit non-zero on a timeout.

- [ ] **Step 3: Write `tools/botui-stand/client.js`** exporting `connect(username) -> Promise<{dialogs: object[], maps: object[], click(id, data), command(text), look(yaw, pitch), end()}>`. Use `minecraft-protocol` with version `'26.1'`. `click` writes raw: `varint(0x44) + string(id) + varint(len) + tag`, where `tag` is `prismarine-nbt` `writeUncompressed` of an unnamed compound with bytes 1-2 removed (the length prefix and network form come from the spike: `minecraft-data`'s option/anonymousNbt shape makes Paper drop the connection). Numbers go as `float`, strings as `string`. Dialogs are simplified with `nbt.simplify`.

- [ ] **Step 4: Write the failing `tools/botui-stand/e2e-bridge.js`** (run with `node`, exits non-zero on the first failed `assert`):

```js
// against a running stand, token 'stand-token', port 8101
assert.equal((await post('/viewers', {names: ['Viewer']}, 'wrong')).status, 401);
await post('/viewers', {names: ['Viewer']});
const c = await connect('Viewer'), other = await connect('Other');
await c.command('bots');                         // open from /bots
let ev = await waitEvent((e) => e.type === 'open' && e.player === 'Viewer');
assert.equal(ev.dim, 'overworld'); assert.equal(ev.pos.length, 3);
await other.command('bots');                     // non-viewer: no event, told so by the plugin
await assertNoEvent((e) => e.player === 'Other', 2000);
const big = JSON.stringify(sampleDialog(7000));  // 7 KB with quotes, backslash, umlauts, sprite object text
assert.equal((await (await post('/show', {player: 'Viewer', dialog: big})).json()).ok, true);
await waitFor(() => c.dialogs.length === 1);
assert.equal((await (await post('/show', {player: 'Viewer', dialog: '{"type":"bad"}'})).json()).ok, false);
assert.equal((await post('/show', {player: 'bad name;', dialog: big})).status, 400);
await c.click('botui:do', {a: 'bot', bot: 'bot7', n: 32});
ev = await waitEvent((e) => e.type === 'click');
assert.deepEqual(ev.data, {a: 'bot', bot: 'bot7', n: 32});
await c.click('other:thing', {x: 1});            // foreign namespace is not reported
await assertNoEvent((e) => e.type === 'click' && e.data.x === 1, 1000);
await c.look(90, 10);                            // moving or turning closes the dialog for the hub
await waitEvent((e) => e.type === 'closed' && e.player === 'Viewer');
await c.end();
await waitEvent((e) => e.type === 'quit' && e.player === 'Viewer');
```

- [ ] **Step 5: Run it.** `tools/botui-stand/stand.sh up` fails at the Nix build (`M/botui/BotUi.java` absent). Expected: the build error.

- [ ] **Step 6: Implement `BotUi extends JavaPlugin implements Listener`.** Parts:
  - `onEnable`: read `rcon.password` from `server.properties` in the working directory (log an error and stay disabled when empty), start `com.sun.net.httpserver.HttpServer` on `127.0.0.1:${BOTUI_PORT:-8101}` with a 4-thread pool. `onDisable` stops it. Compare the token with `MessageDigest.isEqual`. Cap bodies at 256 KB.
  - Every Bukkit call runs on the main thread through `Bukkit.getScheduler().callSyncMethod(...).get(5, SECONDS)`.
  - `/show`: validate the player name with `^\w{1,16}$` and that they are online; `Bukkit.dispatchCommand(Bukkit.createCommandSender(feedback), "dialog show " + name + " " + dialog)` where the consumer collects plain text; `ok` is the command's success with no failure feedback (assert behaviour in Step 7, a parse failure must give `ok:false`). When ok, add to `open` (`Set<UUID>`).
  - `@EventHandler PlayerCustomClickEvent`: ignore unless the connection is a `PlayerGameConnection` and `getIdentifier().namespace()` is `botui`. Payload via `TagStringIO` to `CompoundBinaryTag`, flattened to Gson JSON, dropped when its string form exceeds 8192 chars. Queue a `click` event; remove the player from `open` only when the data has `a == "close"`.
  - `@EventHandler PlayerMoveEvent` (priority MONITOR): only if the UUID is in `open`; on any change of block position or rotation remove it and queue `closed`.
  - `PlayerQuitEvent` queues `quit`, removes from `open` and `outlines`.
  - `/bots` (registered in `plugin.yml`, open to all): not in viewers -> message `Nicht freigeschaltet`. No poll in the last 40 s -> message `Hub nicht erreichbar`. Else queue `open`.
  - `PlayerSwapHandItemsEvent`: when sneaking and a viewer, cancel it and treat as `/bots`.
  - `Event` builder computes `pos`, `yaw`, `dim` (`world.getKey().getKey()`) and `gaze` from `rayTraceBlocks(128, FluidCollisionMode.NEVER)`, `block` = material key without namespace.
  - Queue: `ArrayDeque` capped at 256, ids from an `AtomicLong`; `boot` = start time as a string. `/events` waits on a monitor up to `wait` seconds and records the poll time.
  - `/outline` stores a box per player. A repeating task every 10 ticks spawns `Particle.END_ROD` for that player only along the 12 edges, at most 96 points per edge, when they are online, within 96 blocks of the box and in the box's world (the world at the moment the box was set).

- [ ] **Step 7: Run `tools/botui-stand/stand.sh up && node tools/botui-stand/e2e-bridge.js`.** Expected: exit 0. `grep "Displayed dialog" "$XDG_RUNTIME_DIR/botui-stand/logs/latest.log"` is empty (no console line per dialog). Fix any plugin behaviour the test reveals.

- [ ] **Step 8: Format and commit.** `nix fmt -- M/botui/default.nix flake.nix`. Commit with message `feat(botui): Paper plugin that bridges dialogs, clicks and gaze to the hub, with a local test stand`.

### Task 2: Hub transport, viewer rights, refresh and close logic

**Files:**
- Create: `A/botui.js`, `A/test/botui.js`
- Modify: `A/test.js` (add `'botui'` to the parts), `A/config.js:131-133` (`ingameViewers`, new `viewerBots`, `botuiUrl`), `A/server.js` (extract `submitJob`, build BotUi next to `ingame` at line 169), `A/test/config.js`

**Interfaces:**
- Consumes: Task 1's HTTP API.
- Produces in `A/config.js`: `cfg.ingameViewers` stays `string[]`; `cfg.viewerBots`: `{[viewer]: '*' | string[]}`, parsed from `INGAME_VIEWERS` entries `name` (means `*`) or `name=bot,bot` separated by `,` for bare names or `;`; `cfg.botuiUrl` from `BOTUI_URL`.
- Produces in `A/server.js`: `submitJob({bots, type, args, replace, agent = false}) -> {ok, keeperOff, unreached, saveErr?}`, the body of `POST /api/job` after origin checks; throws on errors; the route calls it. Behaviour of the route unchanged.
- Produces in `A/botui.js`: `class BotUi { constructor({url, token, viewerBots, api, log, now = Date.now, fetch = globalThis.fetch, refreshMs = 5000, idleLimitMs = 600000, screens = require('./botui-screens')}); start(); stop(); handle(event) /* async, used by tests */; tick() /* async */; state(viewer) }`.
- `api` (from `server.js`): `snapshots() -> snapshot[]`, `submit(viewer, {bots, type, args, replace}) -> Promise|{ok}`, `stopAll(viewer)`, `keeper`, `plan`, `places() -> place[]`, `schematics() -> Promise<string[]>`, `sidebar(viewer, on)`, `traderChests` (Task 5), `markers(viewer)` (Task 6).
- Per-viewer state `{screen: {name, ...params}, open, lastJson, flash: {text, ok, until} | null, sel: {a, b, dim}, ctx: {pos, dim, yaw, gaze}, lastClick}`.
- `screens.render(screen, view) -> dialog object`, `screens.REFRESHING = new Set(['lage', 'bot'])`, where `view` = `{viewer, snaps, allowed, keeper, plan, flash, ctx, sel, places, schematics, traderChests, mapState}`; until Task 3 lands, tests pass a stub `screens`.
- Click routing: `data.a` selects a handler in a `const ACTIONS = {...}` table (`close`, `lage`, plus those added by later tasks). An unknown `a` sets a flash `Unbekannte Aktion` and re-renders.

- [ ] **Step 1: Write failing tests in `A/test/botui.js`** with a loopback fake plugin (an `http.Server` recording calls and serving queued events) and a stub `screens`:

```js
test('poll loop: open event shows the Lagebild once to a viewer', ...)      // /viewers then /show with stub JSON
test('a non-viewer event is ignored', ...)                                   // no /show
test('tick re-sends only a changed REFRESHING screen', ...)                  // same JSON: no /show; changed: one /show
test('close click stops refresh', ...)                                       // {a:'close'}: tick sends nothing
test('closed event stops refresh; quit forgets the viewer', ...)
test('10 minutes without a click stops refresh', ...)                        // fake now
test('input screens never refresh', ...)                                     // screen name outside REFRESHING
test('boot id change resets since and pushes viewers again', ...)
test('connection refused: one log line per outage, resumes by itself', ...)
test('a throwing handler sets a flash and keeps polling', ...)
```

- [ ] **Step 2: Run `node test/botui.js`.** Expected: FAIL, `Cannot find module '../botui'`.

- [ ] **Step 3: Implement `A/botui.js`.** The poll loop awaits `GET /events?since=N&wait=25` with a 30 s `AbortSignal.timeout`, backs off 2 s doubling to 30 s on failure, handles events in order. `show(viewer)` renders, sets `open` true, stores `lastJson`, posts `/show`; a failed `/show` logs the feedback and sets `open` false. Reset `lastJson` when a click arrives so a click always re-shows.

- [ ] **Step 4: Implement config and server changes.** Extract `submitJob`, wire `new BotUi` when `cfg.botuiUrl` is set with `token: process.env.RCON_PASSWORD` (`cfg.rcon` password). `api.submit` refuses with `nicht dein Bot` when a named bot is outside `viewerBots[viewer]`, and passes `agent: false`. Add a config test for `INGAME_VIEWERS = 'fancy8869=*;MidariBread=MisaBot,EM_Trader'` and for a plain `'a,b'`.

- [ ] **Step 5: Run `node test/botui.js && node test/config.js && node test/debug-api.js`.** Expected: PASS.

- [ ] **Step 6: Commit** `feat(botui): the hub polls the plugin, keeps per-viewer state and never re-opens a closed dialog`.

### Task 3: Lagebild and Bot screens

**Files:**
- Create: `A/botui-screens.js`, `A/test/botui-screens.js`
- Modify: `A/test.js`, `A/botui.js` (actions `lage`, `bot`, `stop`, `stopall`, `stopall_ok`, `quick`)

**Interfaces:**
- Consumes: `view` from Task 2; snapshot fields as listed by `/api/state` (`name, online, dead, job, activity, queue, health, food, armour, tool, freeSlots, inventory, pos, dimension, lastError, lastErrorAgoS, sheltered, isDay`).
- Produces: `explain(error: string) -> string`, `lage(view)`, `bot(view, name)`, `confirmStop(view)`, `render(screen, view)`, `REFRESHING`. Every action button uses `{type: 'minecraft:custom', id: 'botui:do', payload: {a, ...}}`; `after_action: 'none'` and `pause: false` on every dialog; `exit_action` label `Schließen` with payload `{a: 'close'}`.
- Reuse `botState`, `ago` and `DIMENSION` from `A/ingame.js` (export `ago` and `DIMENSION`).

- [ ] **Step 1: Write failing tests:**

```js
test('lage: header counts, one button per allowed bot', () => {
  const d = lage(view({snaps: [work('bot1'), idle('bot2'), off('bot3')], allowed: ['bot1', 'bot2']}));
  assert.match(text(d.body[0]), /2 Bots · 1 arbeiten · 1 frei/);
  assert.equal(botButtons(d).length, 2);
});
test('lage: problems say the cause, at most 3', ...);  // lastError 'inventory still full after depositing (chest full?)' -> 'Kiste voll'
test('explain maps real errors', () => {
  assert.match(explain('no free iron_ore within 96 blocks (collected 0/64, searched 12 more spots)'), /nichts .*Reichweite/i);
  assert.match(explain('could not reach 1 2 3: No path to the goal!'), /kein Weg/i);
  assert.match(explain('unsafe: water next to it'), /Wasser/);
  assert.match(explain('need 3 more iron_ingot'), /3 .*iron_ingot/);
  assert.equal(explain('something new'), 'something new');
});
test('lage: bedarf lists quotas under target, else Alles auf Lager', ...);
test('lage: a flash shows until it expires', ...);
test('lage is valid JSON and survives hostile snapshots', () => {            // Review Focus
  const s = {name: 'bot1', online: false, lastError: '"§c\n' + 'x'.repeat(500), lastErrorAgoS: 1};
  const d = lage(view({snaps: [s], allowed: ['bot1']}));
  const j = JSON.stringify(d);
  assert.doesNotMatch(j, /§/); assert.ok(JSON.parse(j)); assert.ok(longestText(d) <= 200);
});
test('bot: shows job, queue, inventory top 8, buttons Stopp and Auftrag', ...);
test('bot: offline bot has no position line and does not throw', ...);
test('Alle stopp needs a confirmation and only the owner (*) gets the button', ...);
```

- [ ] **Step 2: Run `node test/botui-screens.js`.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement.** Texts go through `safe(text, max)`, which strips `§.` and control characters and truncates. Button width 200, two columns, tooltip per the spec. Item sprite in labels: `{type: 'object', atlas: 'minecraft:items', sprite: 'item/<name>'}` only for fixed names from a local table. Quick jobs on the Bot screen use the supply chest from `api.keeper.state().chest`: `deposit` (`x,y,z`), `rearm` (`x,y,z`), `homebed`, `graves`.

- [ ] **Step 4: Run tests.** Expected: PASS.

- [ ] **Step 5: Extend `tools/botui-stand/e2e-bridge.js` or add `e2e-hub.js`:** run the real `BotUi` with real `screens`, fake `api` with 8 snapshots against the stand: `/bots` -> a `show_dialog` with 8 bot buttons plus 4 others; click a bot -> the Bot screen; click `close` -> no dialog in the next 7 s while a snapshot changes. Run it. Expected: exit 0.

- [ ] **Step 6: Commit** `feat(botui): Lagebild and bot screens with causes in plain German`.

### Task 4: Auftrag with gaze context and area selection

**Files:**
- Create: `A/botui-jobs.js`, `A/test/botui-jobs.js`
- Modify: `A/botui-screens.js`, `A/botui.js`, `A/test.js`, `A/server.js` (`api.schematics`)

**Interfaces:**
- Consumes: `VALIDATE` from `A/bots.js`; `POST /outline`.
- Produces in `A/botui-jobs.js`:
  - `JOBS: {[key]: {label, type, icon, needs: Input[], args(values, ctx) -> jobArgs}}`. `Input` kinds: `count(min, max, step, initial)`, `block`, `item`, `chest`, `where`, `radius`, `schematic`, `rotation`, `area`.
  - `contextJobs(gaze) -> [{key, preset}]`. Table: `/_ore$|ancient_debris/` -> `mine`, `shift` with block; `/_log$|_wood$/` -> `chop`, `shiftlogs`; `/chest$|barrel/` -> `deposit`, `withdraw`, `stock`, trader chest actions; `spawner` -> `lightspawner`; `/wheat|farmland/` -> `wheatfarm`. Always, when gaze exists: `goto`, `guard`, `tidy`.
  - `areaJobs(sel) -> [{key, ok, why}]` with the limits from `VALIDATE`: excavate 9x9x5, clear 32x32x24, shaft 3..16 square, light 64x64x48, seal per `sealJob`. `ok:false` when both corners are set but the box is over the limit, or dims differ (`why`: `Ecken in verschiedenen Welten`).
  - `resolveTarget(value, ctx, places) -> {x,y,z}`, throws a German reason: value `gaze`, `pos`, `place:<name>`, `text`.
  - `resolveBots(value, snaps, allowed) -> string[]`, value `frei` (first free), `alle`, or a name; throws `Kein freier Bot` when empty and `nicht dein Bot` for a name outside `allowed`. Free = online, not dead, no job, empty queue.
- Actions added: `new` (step 1), `job` (step 2, payload `{key, preset...}`), `send` (dynamic; inputs plus `{key}`), `corner` (`{which: 'a'|'b'}`), `clearsel`.

- [ ] **Step 1: Write failing tests:**

```js
test('context: iron ore offers mine and shift first, then goto', ...);
test('context: chest offers deposit, withdraw, stock', ...);
test('context: no gaze offers nothing and no crash', ...);                   // Review Focus
test('every job builds args its VALIDATE accepts', () => {
  for (const [key, job] of Object.entries(JOBS)) VALIDATE[job.type](job.args(sampleValues(job), sampleCtx()));
});
test('mine from a slider float', () => assert.deepEqual(JOBS.mine.args({block: 'iron_ore', n: 64.0}, ctx), {block: 'iron_ore', count: 64}));
test('resolveTarget: text "1 2 3" works, "a b c" refuses', ...);            // Review Focus
test('resolveTarget: gaze without a gaze refuses in German', ...);
test('resolveBots: frei picks a free bot of the viewer only', ...);
test('send: Misa cannot order bot1', ...);                                   // Review Focus; no api.submit call, flash 'nicht dein Bot'
test('send: NaN, 1e9 and 10 KB text refused with a flash, loop alive', ...); // Review Focus
test('areaJobs: too large is not ok and says why; different dims refuse', ...);
test('corner: stores gaze, posts /outline; clearsel posts null', ...);
test('step 2 shows only that job\'s inputs plus Wer and Wann', ...);
test('send: Wann danach means replace false, Jetzt means replace true', ...);
```

- [ ] **Step 2: Run `node test/botui-jobs.js`.** Expected: FAIL.

- [ ] **Step 3: Implement the catalog and screens.** Job types and args per `VALIDATE` in `A/bots.js:105-320`; `Besorgen` = `get` (max 256), `Holz` = `chop`, `Schicht` = `shift` with `chest` input defaulting to the supply chest, `Baumfarm`/`Weizenfarm` take boxes from `places` of kind `treefarm` / `wheat`, `Bauen` = `schematic` with `{file, origin: target, rotation, chests: [supply]}`, and `Einlagern`, `Ausrüsten`, `Heim`, `Gräber holen`, `Helfen`. Count sliders: `get` 1-256 step 1, `mine` and `chop` 16-2048 step 16, `withdraw` 1-1728 step 1, `craft` and `smelt` 1-64 step 1. Block and item inputs are `single_option` from a table of the owner's common names, plus the gazed block, plus a text field `Oder Name`. Slider floats are rounded with `Math.round` and range-checked by `VALIDATE`. `api.submit` carries out the order; the result returns as a flash on the Lagebild.

- [ ] **Step 4: Run tests.** Expected: PASS. Then run the full `node test.js`. Expected: `ok` as before.

- [ ] **Step 5: Stand check:** extend `e2e-hub.js`: look at a placed chest (`setblock` via stand console), `/bots`, `new` -> the dialog offers `Hier einlagern`; `job` then `send` -> fake `api.submit` got `{type: 'deposit', args: {x, y, z}}`. Run it. Expected: exit 0.

- [ ] **Step 6: Commit** `feat(botui): orders from what the player looks at, with area corners and job-specific inputs`.

### Task 5: Ziele: quotas, toggles, trader chests

**Files:**
- Modify: `A/keeper.js`, `A/test/keeper.js`, `A/botui-screens.js`, `A/botui.js`, `A/server.js`, `A/hub.js`, `A/test/botui-screens.js`
- Create: `A/traderchests.js`, `A/test/traderchests.js`; add to `A/test.js`

**Interfaces:**
- Produces in `A/keeper.js`: `setWant(item: string, want: number)`, bounds `0..4096`, unknown item throws; persisted in the keeper file as `{enabled, wants: {item: n}}`, read in the constructor. A keeper file without `wants` keeps working.
- Produces in `A/traderchests.js`: `class TraderChests { constructor({file, halls, log}); list(bot) -> {sticks: xyz[], stores: xyz[]}; add(bot, kind: 'sticks'|'stores', xyz); remove(bot, kind, xyz); apply() }`. `halls` is the same object as `cfg.tradeHalls`, which `TradeSchedule`, runners and hub already share; `apply()` merges overrides into the bot's hall in place and calls `onChange()`. The hall key is `bot.toLowerCase()`, falling back to `misa` as in `A/bots.js:446`. An empty override keeps the configured chests. Persisted as JSON in `STATE_DIR/trader-chests.json` with an atomic rename.
- `A/hub.js`: `sendTradeHalls()` re-sends `this.tradeHalls` to connected workers in a message the worker already handles (`A/hubclient.js:327`).
- Actions added: `ziele`, `keeper` (`{on}`), `plan` (`{on}`), `sidebar` (`{on}`), `saveziele` (dynamic: `want_<item>` values), `trader_add`, `trader_del`.

- [ ] **Step 1: Write failing tests:** `setWant` persists and survives a new `Keeper` on the same file; bad item and `-1` throw; old-format file loads. `TraderChests.add` then `list`; survives reload; the override shows in the same `halls` object; `remove` of the last one restores the configured chests; a corrupt file logs and starts empty. Screen test: Ziele has one `number_range` per quota, `key = want_<item>`; a non-owner viewer (`viewerBots` not `*`) sees no keeper or plan inputs, only their trader chest list.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** Ziele reads quotas from `keeper.state().quotas` and sets each slider's `end` to `Math.max(64, want * 4)`. Keeper, plan and quotas are owner only (`viewerBots[viewer] === '*'`). Sidebar: `api.sidebar` runs `team join mcbots <viewer>` or `team leave <viewer>` over the main console, the same commands as `M/bots-panel.nix:91-92`. Add the `Handelskiste` buttons to the chest context from Task 4, listing only trader bots the viewer may command.

- [ ] **Step 4: Run tests and `node test/trade.js`.** Expected: PASS.

- [ ] **Step 5: Commit** `feat(botui): goals screen with quota sliders; trader chests set in game`.

### Task 6: Live map

**Files:**
- Create: `M/botui/BotMap.java`
- Modify: `M/botui/BotUi.java`, `M/botui/default.nix` (compile both), `A/botui.js`, `A/botui-screens.js`, `A/server.js`, `A/test/botui-screens.js`, `tools/botui-stand/client.js`, `tools/botui-stand/e2e-map.js` (new)

**Interfaces:**
- Produces (HTTP): `POST /map {player, zoom: 1|2|5|10|25|50, center: {x,z} | null, markers: [{x, z, dim, kind: 'work'|'idle'|'bad'|'off', label}]}` -> `{ok}`; `center: null` follows the player. `POST /map/give {player}` -> `{ok, error?}`.
- Event `mapclick` when a viewer right clicks while holding the tagged map.
- Hub: `api.markers(viewer) -> marker[]` built from snapshots filtered by rights. `tick()` posts `/map` for every viewer every `refreshMs` (cheap loopback; the plugin ignores offline players). State: `mapState: {zoom, center, follow}`. Actions: `karte` (gives the map, shows the map dialog), `zoom` (`{z}`), `center` (`{bot}` or `{me: 1}`).

- [ ] **Step 1: Write the failing `tools/botui-stand/e2e-map.js`:** start a tiny HTTP server as fake BlueMap serving a solid 501x1002 PNG with a red top half for `/maps/world/tiles/1/x<i>/z<j>.png`, with the stand started with `BOTUI_BLUEMAP` pointing there. `POST /map/give` -> the client inventory gets a `filled_map`; give it again -> still one. `POST /map` with two markers -> the client receives `map` packets with a colour array that is not all zero and two icons named by label. Right click (`use_item`) -> `mapclick` event. Add the unit test: `lage`'s `Karte` action, and `karte` screen with six zoom buttons and one centre button per allowed bot; `api.markers` for Misa contains only her bots.

- [ ] **Step 2: Run them.** Expected: FAIL (404 on `/map`).

- [ ] **Step 3: Implement `BotMap`.** One `MapView` per viewer, id stored in `plugins/BotUi/maps.properties`, recreated renderer on enable. `new MapRenderer(true)`. Render only when `dirty` and the player matches, drawing the prepared `BufferedImage` with `canvas.drawImage` and setting cursors via `MapCursorCollection`. `view.setTrackingPosition(false)`, `setLocked(true)`, `setUnlimitedTracking(false)`. An async task every 2 s per online viewer holding the map composes the image: blocks per pixel `z` -> lod (`1,2`->1, `5,10`->2, `25,50`->3), tile size `500 * 5^(lod-1)` blocks, source pixel `(x - tx * size) / 5^(lod-1)` in the top 500x500, nearest neighbour. Map ids per dim: `overworld` -> `world`, `the_nether` -> `world_the_nether`, `the_end` -> `world_the_end`. Tile URL `<base>/maps/<map>/tiles/<lod>/x<i>/z<j>.png`, default base `http://127.0.0.1:8100`, via `java.net.http.HttpClient` with a 5 s timeout, an LRU of 64 tiles with 5 minutes TTL, and failed fetches cached 60 s (a missing tile is dark). The tag lives in the item's `PersistentDataContainer`; name `Bot-Karte`. `give`: an existing tagged map moves to the held slot; else fill the held slot when empty, else the first empty slot and select it; full inventory returns `error: 'Inventar voll'`. Cursors: `BANNER_LIME` work, `BANNER_LIGHT_GRAY` idle, `BANNER_RED` bad, `BANNER_GRAY` off, with the label as caption; `PLAYER` for the viewer with direction from yaw. Skip markers outside the map, or in another dimension.

- [ ] **Step 4: Implement hub actions and the Karte screen.** Run `node test/botui-screens.js`, then `tools/botui-stand/stand.sh up && node tools/botui-stand/e2e-map.js`. Expected: PASS and exit 0. Confirm the BlueMap URL shape once more on the lab: `ssh -o BatchMode=yes bandit-lab 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8100/maps/world/tiles/1/x-1/z-1.png'` prints `200`.

- [ ] **Step 5: Commit** `feat(botui): a live map item with bots as named markers`.

### Task 7: Retire v1, wire Nix, docs

**Files:**
- Delete: `M/bots-panel.nix`, `M/commandpanels/botmenu.yml`
- Modify: `M/default.nix:20` (panel generation), `M/nix-minecraft.nix` (symlink `plugins/BotUi.jar`, `bridgePorts.mc-bridge-botui = 8101`, `bridgeRule` ports, main server only, not the sandbox), `hosts/bandit-lab/services/mcbots/default.nix` (`BOTUI_URL = "http://${bridgeGw}:8101"`, `INGAME_VIEWERS = "fancy8869=*;MidariBread=MisaBot,EM_Trader"`), `A/ingame.js` (remove `word`, `botFields`, `summary`, `parseInbox`, `push` values, `poll`; keep sidebar, `say`, `event`), `A/server.js:169-200` (remove the `order` path if only `poll` used it), `A/test/ingame.js`, `docs/runbooks/minecraft/BOTS.md`, `docs/specs/2026-11-03-ingame-bots-v2.md` (header line: superseded)
- Modify in bandit-nix (worktree from `origin/main`, branch `feat/kommandostand`): `ci/lab-minecraft.nix:134,140,141` (port `8101` in the three lists), any `ci/lab-mcbots.nix` env assertion that names `INGAME_VIEWERS`

**Interfaces:** none new.

- [ ] **Step 1: Write the check first:** add to bandit-nix `ci/lab-minecraft.nix` the expected ports and a misrouting assert `bridgeTarget 8101 == "127.0.0.1:8101"`, and that the sandbox's symlinks stay unchanged. Build the lab with `--override-input bandit-craft git+file://$HOME/src/bandit-craft-kommando`: expected FAIL (bridge lacks 8101).

- [ ] **Step 2: Make the Nix changes in `M/` and the mcbots module.** Confirm `Sidebar` works with the same `team` commands and `scoreboard ... sidebar.team.aqua` setup in `Ingame.setup`, which drops only `pa data clear mcbots`.

- [ ] **Step 3: Remove the v1 parts from `A/ingame.js`** and their tests; run `node test.js` from `A`. Expected: `ok`. `git grep -n "pa data" -- hosts/ docs/runbooks` is empty except for unrelated panels (check `kits` and `admin` panels are not touched).

- [ ] **Step 4: Update `BOTS.md`** (a section "Kommandostand": how to open, screens, plugin, troubleshooting `/bots` says unreachable, how to run the stand).

- [ ] **Step 5: Verify:** `nix fmt -- <changed nix files>`, `nix flake check` here, in bandit-nix `nix build --override-input bandit-craft git+file://$HOME/src/bandit-craft-kommando .#nixosConfigurations.bandit-lab.config.system.build.toplevel` plus `ci` checks `lab-minecraft` and `lab-mcbots`. Expected: all pass.

- [ ] **Step 6: Commit** in both repos: `feat(botui): the Kommandostand replaces the chest menus` and `feat(minecraft): contract for the BotUi bridge port`.

### Task 8: Whole-branch review and handover

- [ ] **Step 1: Run the whole stand suite:** `tools/botui-stand/stand.sh up`, every `e2e-*.js`, `stand.sh down`. Expected: exit 0.
- [ ] **Step 2: Review:** one fresh `architect` on the branch diff against `origin/main`: trust boundary, closed-dialog rule, deploy order, failure with the plugin absent. Fix findings.
- [ ] **Step 3: Hand over to the owner** per the deploy memory: a short script, exact commands, host and time (a Paper restart, so when nobody plays), and the in-game checklist: Shift+F, Lagebild look, Escape closes and stays closed, an order from a gazed chest, corners with the outline, quota slider, map in hand.
