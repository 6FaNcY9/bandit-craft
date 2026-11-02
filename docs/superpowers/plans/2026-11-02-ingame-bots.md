# Bots in the game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners see every bot's state in a Minecraft sidebar, order bots from a `/bots` chest menu, hear replies in chat from the console, and Misa's trader runs daily.

**Architecture:** A new hub module `app/ingame.js` owns all console traffic for players (sidebar, menu data, order inbox, `tellraw` replies) through the existing `mainConsole` RCON chain, the same way `rescue.js` does. Runners stop whispering and emit a `say` event the hub turns into `tellraw`. Two CommandPanels YAML menus hand orders to the hub by writing `pa data` the hub polls. Misa's trader is configuration only.

**Tech Stack:** Node 22 (CommonJS, no deps beyond the repo), `node:test`-free assert scripts under `app/test/` run by `node test.js`; CommandPanels 4.2.4 YAML; Nix (`default.nix` env), `alejandra` for `.nix`.

**Spec:** `docs/specs/2026-11-02-ingame-bots.md` (read it first; the "Findings" section lists the exact console commands verified on the lab).

## Global Constraints

- App dir: `hosts/bandit-lab/services/mcbots/app`; panels dir: `hosts/bandit-lab/services/minecraft/commandpanels`; hub env: `hosts/bandit-lab/services/mcbots/default.nix`.
- Console calls: `call(commands: string[]) -> Promise<string[]>` (the `queued(opts)` chain from `admin.js`; one chain, never a second RCON connection).
- `enforce-secure-profile` stays `true`. No bot sends `/tell`.
- Sidebar: at most 15 entries; entry = bot name; free text via `scoreboard players display name <bot> mcbots <json component>`; objective `mcbots`, team `mcbots`, color `aqua`, slot `sidebar.team.aqua`.
- Panel data: one word per value (no spaces, `§` is stripped); `pa data set` never overwrites, so always `pa data del <player> <key>` before `pa data set`. Store player for status: `mcbots`. Inbox key: `order` on the viewer's own name, value `<bot>:<words>` with words joined by `_` (e.g. `bot1:hol_32_holz`, `alle:stopp`).
- Viewers default: `fancy8869,MidariBread` (env `INGAME_VIEWERS`, comma list of `\w{1,16}` names).
- Commit messages: `feat(mcbots): ...` / `docs(mcbots): ...` / `feat(minecraft): ...`; commits with `--no-gpg-sign` (pinentry is unavailable in this session); end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Style: match `rescue.js` (one class, `Object.assign(this, ...)`, `catch(() => {})` on console errors, `.unref()` timers). No new abstractions beyond `ingame.js`.

## Review Focus

1. A viewer writes garbage into `order` (`pa data set MidariBread order x`): the hub must delete it and answer `[bots] kenne ich nicht: ...`, never throw (test in Task 2: `parseInbox` returns `null` for `x`, `bot1:`, `bot1:a b`, 200-char input).
2. A bot's activity contains `"`, `\` or `§` (job labels carry free text): the JSON component and the panel token must stay valid (test in Task 2: `sidebarLines` escapes quotes/backslashes; `token` strips `§.` and keeps `[\w./:-]` only).
3. The console is down (RCON refused): the pusher must not pile up calls; one in-flight push at a time, skipped ticks logged once (test in Task 3: a `call` that never resolves yields exactly one call across 3 ticks).
4. More than 15 bots: guests are dropped last, `cfg.names` order kept (test in Task 2: 17 names with 2 guests → 15 lines, both guests absent).
5. A viewer orders a sandbox bot `komm` while standing on the main server: the job fails inside the bot with its own message; the hub must relay that `fail` to the orderer once and then stop watching (test in Task 3: `event({bot, kind: 'fail'})` after an order → one `tellraw`, a second `fail` → none).

---

### Task 1: Misa's trader daily (configuration)

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/default.nix:168-174` (comment, `PROTECTED_AREAS`, `TRADE_HALLS`, `TRADE_SCHEDULE`)
- Test: none new; `app/test/trade.js` and `app/test/config.js` keep passing

**Interfaces:**
- Consumes: `parseHalls`, `parseSchedule` in `app/tradeschedule.js`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Verify the strings parse** (before editing Nix): run from `app/`:

```bash
node -e "const t=require('./tradeschedule');console.log(JSON.stringify(t.parseHalls('{\"misa\":{\"hall\":{\"x1\":166,\"y1\":54,\"z1\":409,\"x2\":181,\"y2\":61,\"z2\":426},\"stores\":[{\"x\":171,\"y\":59,\"z\":425}],\"sticks\":[{\"x\":175,\"y\":59,\"z\":424}]}}')), t.parseSchedule('bot23=misa@mon,tue,wed,thu,fri,sat,sun/18:00+60').length)"
```
Expected: the hall object echoed and `1`; no throw. If `parseHalls` rejects `sticks`, read `tradeschedule.js:10-22` and use the key it validates.

- [ ] **Step 2: Edit `default.nix`**: `PROTECTED_AREAS = "-80,-144,80,80;112,368,272,592@MisaBot;166,409,181,427";` `TRADE_HALLS` = the JSON string from Step 1 (Nix string, escape `"` as `\"`), `TRADE_SCHEDULE = "bot23=misa@mon,tue,wed,thu,fri,sat,sun/18:00+60";`. Update the two comments above them: hall known 2026-11-02 (32 villagers, floors y 55/59, stick chest 175 59 424, emerald chest 171 59 425), daily 18:00 for 60 min.

- [ ] **Step 3: Format and evaluate**: `alejandra hosts/bandit-lab/services/mcbots/default.nix` then `nix-instantiate --parse hosts/bandit-lab/services/mcbots/default.nix >/dev/null`. Expected: no output.

- [ ] **Step 4: Run the app tests**: `cd hosts/bandit-lab/services/mcbots/app && node test/trade.js && node test/config.js`. Expected: exit 0.

- [ ] **Step 5: Commit**: `git add hosts/bandit-lab/services/mcbots/default.nix && git commit --no-gpg-sign -m "feat(mcbots): Misa's trader daily: hall, chests and protected box from the 2026-11-02 scan"`

### Task 2: `ingame.js` pure helpers

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/ingame.js`
- Create: `hosts/bandit-lab/services/mcbots/app/test/ingame.js`
- Modify: `hosts/bandit-lab/services/mcbots/app/test.js` (add `'ingame'` to the parts list after `'hub-workers'`)

**Interfaces:**
- Produces (module exports, all pure):
  - `token(text: string): string` → `text` trimmed, `§.` removed, every run of chars outside `[A-Za-z0-9./:+-]` replaced by `_`, cut to 32 chars, `'-'` when empty.
  - `sidebarLines(snaps: Snapshot[], {guests: string[], now: number}): {entry: string, score: number, component: string}[]` → at most 15; order = input order with guests moved last then cut; `score` = 15 - index; `component` = JSON string of `["", {text: name + " ", color: "aqua"}, {text: status, color}]` where status = `activity` cut to 28 chars (`…` appended when cut); color `"gray"` when `!online` or activity starts with `idle`, `"dark_red"` when `dead`, `"red"` when `lastErrorAgoS` is a number `< 300`, else `"white"`. Quotes and backslashes JSON-escaped (use `JSON.stringify`).
  - `parseInbox(value: string|null): {bot: string, words: string[]} | null` → `null` unless `/^(\w{1,16}):([\w.\/-]{1,64})$/` matches; `bot` lowercase-insensitive as given, `words = part.split('_').filter(Boolean)`; `null` when words empty.
  - `statusToken(snap: Snapshot): string` → `token(snap.activity || (snap.online ? 'frei' : 'offline'))`.
- Snapshot fields used: `name, online, dead, activity, lastErrorAgoS` (as `BotRunner.snapshot()` / `RemoteRunner.snapshot()` give them).

- [ ] **Step 1: Write the failing tests** in `test/ingame.js` (assert style of `test/owner-orders.js`):

```js
const {token, sidebarLines, parseInbox, statusToken} = require('../ingame');
assert.equal(token('Holz holen 3/8'), 'Holz_holen_3/8');
assert.equal(token('§aStein "x" \\y'), 'Stein_x_y');
assert.equal(token(''), '-');
assert.equal(token('a'.repeat(40)).length, 32);
assert.deepEqual(parseInbox('bot1:hol_32_holz'), {bot: 'bot1', words: ['hol', '32', 'holz']});
assert.deepEqual(parseInbox('alle:stopp'), {bot: 'alle', words: ['stopp']});
for (const bad of [null, '', 'x', 'bot1:', 'bot1:a b', 'bot1:' + 'a'.repeat(200), 'bot1:__']) assert.equal(parseInbox(bad), null, String(bad));
const snap = (name, extra = {}) => ({name, online: true, dead: false, activity: 'idle - no job', lastErrorAgoS: null, ...extra});
const lines = sidebarLines([snap('bot1', {activity: 'walking to "the" \\chest', lastErrorAgoS: 10}), snap('bot2', {dead: true}), snap('bot3', {online: false})], {guests: [], now: 0});
assert.equal(lines.length, 3); assert.deepEqual(lines.map((l) => l.score), [15, 14, 13]);
assert.deepEqual(JSON.parse(lines[0].component)[2], {text: 'walking to "the" \\chest', color: 'red'});
assert.equal(JSON.parse(lines[1].component)[2].color, 'dark_red'); assert.equal(JSON.parse(lines[2].component)[2].color, 'gray');
const many = sidebarLines([...Array(17)].map((_, i) => snap('b' + i)), {guests: ['b3', 'b5'], now: 0});
assert.equal(many.length, 15); assert.ok(!many.some((l) => l.entry === 'b3' || l.entry === 'b5'));
assert.equal(JSON.parse(sidebarLines([snap('b', {activity: 'x'.repeat(40)})], {guests: [], now: 0})[0].component)[2].text.length, 29);
assert.equal(statusToken(snap('b', {online: false})), 'offline');
```

- [ ] **Step 2: Run to verify it fails**: `node test/ingame.js`. Expected: `Cannot find module '../ingame'`.
- [ ] **Step 3: Implement the four functions in `ingame.js`** (file header comment: what the module is, two lines; export at the bottom `module.exports = {token, sidebarLines, parseInbox, statusToken}`; the `Ingame` class comes in Task 3).
- [ ] **Step 4: Run**: `node test/ingame.js && node test.js`. Expected: exit 0 both.
- [ ] **Step 5: Commit**: `git add app/ingame.js app/test/ingame.js app/test.js` (full paths) and `git commit --no-gpg-sign -m "feat(mcbots): ingame helpers: sidebar lines, panel tokens, order inbox parser"`.

### Task 3: `Ingame` class: console push, inbox poll, replies

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/ingame.js`
- Modify: `hosts/bandit-lab/services/mcbots/app/test/ingame.js`

**Interfaces:**
- Consumes: Task 2 helpers; `call(commands) -> Promise<string[]>`.
- Produces: `class Ingame` exported alongside the helpers:
  - `constructor({call, viewers: string[], guests: string[], snapshots: () => Snapshot[], order: (viewer: string, bot: string, words: string[]) => string, log: (msg) => void, now = Date.now})`. `order` returns the receipt text to send back (`ok: ...`) and throws with a German message on refusal (the hub wires it in Task 4).
  - `async setup(): Promise<void>` → sends once: `team add mcbots`, `team modify mcbots color aqua`, `team join mcbots <v>` per viewer, `scoreboard objectives add mcbots dummy`, `scoreboard objectives modify mcbots numberformat blank`, `scoreboard objectives setdisplay sidebar.team.aqua mcbots`, `pa data clear mcbots`. Errors logged, never thrown.
  - `async push(): Promise<void>` → for each `sidebarLines(...)` entry whose `component` differs from the last pushed: `scoreboard players set <entry> mcbots <score>` + `scoreboard players display name <entry> mcbots <component>`; for entries that vanished: `scoreboard players reset <entry> mcbots`; for each bot whose `statusToken` changed: `pa data del mcbots <bot>`, `pa data set mcbots <bot> <token>`. One `call` with all commands; skipped (and logged once) while a previous push is in flight; no call when nothing changed.
  - `async poll(): Promise<void>` → `call(viewers.map(v => 'pa data get ' + v + ' order'))`; a reply matching `/Value: (\S+)/` with a value other than `null` → `pa data del <v> order`, then `parseInbox`; `null` → `say(v, 'bots', 'kenne ich nicht: ' + value)`; else `order(v, bot, words)` → `say(v, bot, receipt)`, on throw `say(v, bot, 'geht nicht: ' + e.message)`. After a successful order the pair `(bot, viewer)` is remembered as pending until `event()` sees `done|fail|stop` for that bot (Review Focus 5) or 30 min pass.
  - `say(viewer: string, bot: string, text: string): void` → queues `tellraw <viewer> ["",{"text":"[<bot>] ","color":"aqua"},{"text":"<text>"}]` (text cut to 100 chars, JSON-escaped); at most one tellraw per viewer per 2 s (coalesce like `owner.makeSayer`: the newest text wins, sent when the gap is over).
  - `event(e: {bot, kind, text}): void` → `kind === 'say'` and `text` matching `/^(\w{1,16}): (.*)$/` → `say(viewer=$1, e.bot, $2)`; `kind === 'death'` → `say(v, e.bot, 'gestorben: ' + text)` for every viewer; `done|fail|stop` with a pending order for `e.bot` → `say(orderer, e.bot, {done:'fertig', fail:'Problem', stop:'gestoppt'}[kind] + ': ' + text)` and clear the pending entry.
  - `start(): void` → `setup()`, then `setInterval(push, 5000)` and `setInterval(poll, 2000)`, both `.unref()`.

- [ ] **Step 1: Write the failing tests** (append to `test/ingame.js`; fake `call` records commands and answers from a queue):

```js
const calls = []; let replies = [];
const call = async (cmds) => { calls.push(...cmds); return cmds.map(() => replies.shift() ?? ''); };
let snaps = [snap('bot1'), snap('bot23')];
const orders = [];
const g = new Ingame({call, viewers: ['fancy8869', 'MidariBread'], guests: ['bot23'], snapshots: () => snaps, order: (v, b, w) => { orders.push([v, b, w]); if (b === 'nope') throw new Error('unbekannter Bot'); return 'ok: komme'; }, log: () => {}, now: () => 0});
await g.setup();
assert.ok(calls.includes('team join mcbots MidariBread') && calls.includes('scoreboard objectives setdisplay sidebar.team.aqua mcbots'));
calls.length = 0; await g.push();
assert.ok(calls.some((c) => c.startsWith('scoreboard players display name bot1 mcbots ')) && calls.includes('pa data set mcbots bot1 idle_-_no_job'));
calls.length = 0; await g.push(); assert.equal(calls.length, 0);               // nothing changed
snaps = [snap('bot1', {activity: 'chopping'})]; calls.length = 0; await g.push();
assert.ok(calls.includes('scoreboard players reset bot23 mcbots') && calls.includes('pa data del mcbots bot1'));
replies = ['[CommandPanels] Value: bot1:komm', '[CommandPanels] Value: null']; calls.length = 0; await g.poll();
assert.deepEqual(orders, [['fancy8869', 'bot1', ['komm']]]); assert.ok(calls.includes('pa data del fancy8869 order'));
assert.ok(calls.some((c) => c.startsWith('tellraw fancy8869 ') && c.includes('ok: komme')));
g.event({bot: 'bot1', kind: 'fail', text: 'kein Weg'}); g.event({bot: 'bot1', kind: 'fail', text: 'nochmal'});
// flush the 2 s coalescing: construct with a fake clock or expose flush(); exactly one tellraw with 'Problem: kein Weg', none with 'nochmal'
replies = ['[CommandPanels] Value: nope:komm', '']; calls.length = 0; await g.poll();
assert.ok(calls.some((c) => c.includes('geht nicht: unbekannter Bot')));
replies = ['[CommandPanels] Value: garbage', '']; calls.length = 0; await g.poll();
assert.ok(calls.some((c) => c.includes('kenne ich nicht: garbage')) && calls.includes('pa data del fancy8869 order'));
g.event({bot: 'bot2', kind: 'say', text: 'MidariBread: ok: folge dir'});
g.event({bot: 'bot2', kind: 'death', text: 'died at 1 2 3'});
// after flush: a tellraw to MidariBread containing '[bot2] ok: folge dir' and one per viewer containing 'gestorben: died at 1 2 3'
const stuck = new Ingame({call: () => new Promise(() => {}), viewers: ['a'], guests: [], snapshots: () => snaps, order: () => '', log: () => {}});
let n = 0; const s2 = new Ingame({...}); // Review Focus 3: wrap call to count; push() three times → 1 call
```
Use a `now` injectable clock and make `say` schedule with `setTimeout`; in tests use a real 2100 ms wait once (`await new Promise((r) => setTimeout(r, 2100))`) to flush, or pass `{gapMs: 0}` as a constructor option (builder's call; keep the default 2000).

- [ ] **Step 2: Run to verify it fails**: `node test/ingame.js`. Expected: `Ingame is not a constructor`.
- [ ] **Step 3: Implement `class Ingame` in `ingame.js`** as specified; `tellraw` JSON built with `JSON.stringify`; the pending map keyed by bot: `{viewer, since}`.
- [ ] **Step 4: Run**: `node test/ingame.js && node test.js`. Expected: exit 0.
- [ ] **Step 5: Commit**: `git commit --no-gpg-sign -m "feat(mcbots): Ingame: sidebar and menu data over the console, order inbox, tellraw replies"`.

### Task 4: Wire the hub and the runners

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/bots.js:361` (`this.say`) and `:387-400` (`emit`)
- Modify: `hosts/bandit-lab/services/mcbots/app/events.js:7` (`KINDS` + `'say'`)
- Modify: `hosts/bandit-lab/services/mcbots/app/config.js` (`ingameViewers` from `INGAME_VIEWERS`, default `['fancy8869', 'MidariBread']`, each `/^\w{1,16}$/` else throw `bad INGAME_VIEWERS`)
- Modify: `hosts/bandit-lab/services/mcbots/app/server.js:97` (events `onAdd` → also `ingame?.event(e)`) and after `:156` (construct and start `Ingame` when `mainConsole`)
- Modify: `hosts/bandit-lab/services/mcbots/default.nix` (env `INGAME_VIEWERS = "fancy8869,MidariBread";` next to `RESCUE_SPOT`, two-line comment)
- Test: `hosts/bandit-lab/services/mcbots/app/test/owner-orders.js` (the sayer assertion), `test/config.js` (viewers parsing)

**Interfaces:**
- Consumes: `Ingame` (Task 3); `owner.translate(words, {owner, ownerPos: null})` from `owner.js`; `runners: Map<name, BotRunner|RemoteRunner>` with `enqueue(type, args, {replace})` and `snapshot()`.
- Produces: `cfg.ingameViewers: string[]`; runner event `say` with text `"<player>: <text>"`.

- [ ] **Step 1: Failing test for the runner's say**: in `test/owner-orders.js` find where a `BotRunner`'s `say` or whisper is asserted (grep `whisper`); change the expectation: `onEvent` receives `('bot1', 'say', 'fancy8869: ok: komme')` and no `bot.whisper` call. In `test/config.js` add: `loadConfig({...base, INGAME_VIEWERS: 'a,b'}).ingameViewers` deep-equals `['a','b']`; missing → the default pair; `'bad name!'` → throws `/INGAME_VIEWERS/`.
- [ ] **Step 2: Run both**: `node test/owner-orders.js; node test/config.js`. Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement**: `bots.js:361` → `this.say = owner.makeSayer((text) => { if (this.answerTo) this.emit('say', \`${this.answerTo}: ${text}\`); });` (keep `makeSayer`'s throttle). In `emit`, nothing else changes (a `say` reaches `onEvent` like every kind). `events.js` KINDS gains `'say'`. `config.js` parses `INGAME_VIEWERS`. `server.js`: after the rescuers block:

```js
const ingame = mainConsole ? new (require('./ingame').Ingame)({call: mainConsole, viewers: cfg.ingameViewers, guests: cfg.guestBots, log: (m) => log('ingame', m),
  snapshots: () => [...runners.values()].map((r) => r.snapshot()),
  order: (viewer, name, words) => { /* mirror bots.js bindOwner 420-437: */ }}) : null;
if (ingame) ingame.start();
```
`order`: `name === 'alle'` → only `words[0] === 'stopp'` allowed: enqueue `stop` on every runner (same loop as `/api/job` with `bots: 'all'`, `type: 'stop'`, including `keeper.setEnabled(false)`, `plan`, `board.pauseAll()`, `toResume = {}`, `saveJobs(true)`), return `'ok: alle stoppen'`; otherwise `const r = runners.get(name)` (throw `unbekannter Bot` when missing), `const c = owner.translate(words, {owner: viewer, ownerPos: null})`; `c.unknown` → throw with `owner.HELP`; `c.type` → `VALIDATE[c.type](c.args)`, `r.enqueue(c.type, c.args, {replace: true})`, `ownerOrders.set(name, {type, args})`, `saveOrders()`, return `'ok: ' + c.type`; `c.stop` → `r.enqueue('stop')`, `ownerOrders.delete(name)`, return `'ok: bleibe stehen'`; `c.status` → return the same receipt string `bindOwner` builds from `r.snapshot()`; `c.role` → throw `'Rolle nur im Chat'`. Extract the shared "stop all" lines from the `/api/job` handler into a function `stopAll()` in `server.js` and call it from both places. `events` `onAdd`: add `ingame?.event(e)` next to the rescuers loop. The dashboard's `cleanEvent` in `hub.js` passes unknown kinds through `KINDS` (check `events.clean`); nothing to change there if `say` is in `KINDS`.
- [ ] **Step 4: Run**: `node test.js`. Expected: exit 0. Then `node -e "require('./server.js')"` must not be run (it binds ports); instead `node --check server.js`.
- [ ] **Step 5: Nix**: add `INGAME_VIEWERS` to the hub env in `default.nix`; `alejandra` it; `nix-instantiate --parse`.
- [ ] **Step 6: Commit**: `git commit --no-gpg-sign -m "feat(mcbots): replies over the console (tellraw), /bots orders from the panel inbox, sidebar wiring"`.

### Task 5: CommandPanels menus

**Files:**
- Create: `hosts/bandit-lab/services/minecraft/commandpanels/bots.yml`
- Create: `hosts/bandit-lab/services/minecraft/commandpanels/botmenu.yml`
- Test: `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" <both files>` (or `nix shell nixpkgs#yq -c 'yq . file'`) → parses; plus a grep check that every name in `BOT_NAMES` of `default.nix` (hub and workers: `bot1,bot2,bot3,bot19,bot20,bot21,MisaBot,bot23`; read the actual lists) has a head item.

**Interfaces:**
- Consumes: inbox contract from Global Constraints (`pa data set %player_name% order <bot>:<words>`), status store `%commandpanels_data_<bot>,mcbots%`.
- Produces: commands `/bots` (alias `/b`) and panel `botmenu`.

- [ ] **Step 1: `bots.yml`** following `owner.yml`'s shape: `title: '&8Bots'`, `type: inventory`, `command: bots`, `aliases: [b]`, `conditions: '%player_name% $EQUALS fancy8869 $OR %player_name% $EQUALS MidariBread'` (check the condition syntax on `docs.commandpanels.net/Logic/Conditions`; if `$OR` is not supported, use two layout entries with one condition each or `$HASPERM bandit.owner` plus a LuckPerms note), `update-interval: 20`, `rows: 3`. Layout slots 0..7: one head per bot in the order `bot1, bot2, bot3, bot19, bot20, bot21, MisaBot, bot23`; slot 18: `allstop`; slot 26: `sidebar`. Item `<bot>`: `material: '[head] <bot>'`, `name: '&b<bot>'`, `lore: ['&7%commandpanels_data_<bot>,mcbots%', '&8Klick: Befehle']`, `left-click: commands: ['[session] set bot <bot>', '[open] botmenu']`. `allstop`: `material: BARRIER`, `name: '&cAlle stopp'`, `left-click: ['[console] pa data set %player_name% order alle:stopp', '[msg] &7gesendet']`. `sidebar`: `material: OAK_SIGN`, `name: '&eSeitenleiste'`, `lore: ['&7links: aus', '&7rechts: an']`, `left-click: ['[console] team leave %player_name%']`, `right-click: ['[console] team join mcbots %player_name%']`.
- [ ] **Step 2: `botmenu.yml`**: `title: '&8%commandpanels_session_bot%'`, `type: inventory`, `command: botmenu`, same `conditions`, `rows: 2`. Items (slot: name, material, words): 0 Komm `COMPASS` `komm`; 1 Folge `LEAD` `folge`; 2 Wache `SHIELD` `wache`; 3 Gib `CHEST` `gib`; 4 Status `PAPER` `status`; 5 Stopp `BARRIER` `stopp`; 9 Holz 32 `OAK_LOG` `hol_32_holz`; 10 Stein 32 `COBBLESTONE` `hol_32_stein`; 11 Eisen 16 `RAW_IRON` `hol_16_eisen`; 12 Kohle 32 `COAL` `hol_32_kohle`; 17 Zurück `ARROW` → `['[open] bots']`. Each order item: `left-click: commands: ['[console] pa data set %player_name% order %commandpanels_session_bot%:<words>', '[msg] &7gesendet an %commandpanels_session_bot%', '[close]']`.
- [ ] **Step 3: Validate**: YAML parses (command above); `grep -c "\[head\]" bots.yml` = 8.
- [ ] **Step 4: Commit**: `git add hosts/bandit-lab/services/minecraft/commandpanels/bots.yml hosts/bandit-lab/services/minecraft/commandpanels/botmenu.yml && git commit --no-gpg-sign -m "feat(minecraft): /bots and botmenu panels: heads with live status, orders into the hub inbox"`.

### Task 6: Runbook

**Files:**
- Modify: `docs/runbooks/minecraft/BOTS.md` (new section `## In the game: sidebar, /bots, replies` after `## Guest bot (MidariBread, 2026-10-29)`; update line ~65-68 "Orders are whispered ... whispers back" to say replies come from the console; update line ~78 trade schedule to daily and the hall coordinates)
- Modify: `docs/runbooks/minecraft/ADMIN.md` only if it lists the panels (grep `owner.yml`); add the two new files there.

- [ ] **Step 1: Write the section** (~25 lines): what the sidebar shows and for whom (team `mcbots`, color aqua, `INGAME_VIEWERS`), `/bots` and `botmenu` (inbox contract, one word values, `update-interval`), replies (`tellraw`, `say` events, death lines), the 2 s/5 s polling and its console cost, how to turn the sidebar off (`team leave`), troubleshooting: `pa data get mcbots bot1`, `pa data get <you> order`, `scoreboard objectives list`.
- [ ] **Step 2: Commit**: `git commit --no-gpg-sign -m "docs(mcbots): in-game sidebar, /bots menu, console replies; trader daily"`.

### Task 7: Ship

- [ ] **Step 1: Full test run**: `cd hosts/bandit-lab/services/mcbots/app && node test.js` → exit 0.
- [ ] **Step 2: Push the branch** `feat/ingame-bots` to GitHub (`git push -u origin feat/ingame-bots`), then from `~/src/bandit-nix`: `tools/craft-bump <sha>` and report the printed `ship-claude` line plus the one-line deploy command for the owner (see memory: deploy line + `lab-apply` fallback). Deploy only when nobody plays (BotGate restarts Velocity on name changes; no names change here, but the hub restarts).
- [ ] **Step 3: After deploy, with the owner online**: `/bots` opens; sidebar visible; `Komm` on MisaBot answers in chat; `pa data get mcbots bot1` shows a token. Record the result in BOTS.md if something differs.
