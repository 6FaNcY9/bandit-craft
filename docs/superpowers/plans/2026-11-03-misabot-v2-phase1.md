# MisaBot v2, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-game orders for all bots queue up instead of replacing each other, every chat job reports start and end with a reason, each bot has its own chest with a keep list and deposits there when full, and `handel` runs a stick trade for a time or an emerald target.

**Architecture:** Everything stays in `hosts/bandit-lab/services/mcbots/app`. The order grammar in `owner.js` grows new words that return small command shapes; `BotRunner.bindOwner` in `bots.js` maps them to the existing `enqueue` (append by default now). Per-bot chat-set preferences (chest, keep list, verbose) live in a new `prefs.js` modelled on `loadRole/saveRole` (one JSON file per worker in `STATE_DIR`). The full-inventory branch in the mine/chop upkeep uses the bot's own chest before the supply chest. The trade job gets a time/target stop.

**Tech Stack:** Node 22, mineflayer 4.39, plain `node:assert/strict` tests under `app/test/`, run by `node test.js` (from `app/`, NODE_PATH line in `docs/runbooks/minecraft/BOTS.md`), `nix build .#mcbots` runs the same.

**Spec:** `docs/specs/2026-11-03-misabot-v2-design.md`

## Global Constraints

- Replies German, ≤ 100 chars, only through `this.say` (never `bot.chat`/`bot.whisper` from the runner). Help text ≤ 100 chars (`owner.HELP`); new words go into a second line `owner.HELP2` answered to `hilfe`.
- Movement, pathfinding, `misa.js` area rules, hub/dashboard `enqueue` flags unchanged.
- No new npm dependencies.
- Chat spam limit: no per-block messages; progress only with verbose on, at 10 % steps.
- Tests: one file per topic under `app/test/`, registered in `app/test.js`; no Minecraft server; fake `bot` is an `EventEmitter` with `players`, `inventory`, as in `test/owner-orders.js`.
- Commit per task, unsigned, in the worktree. Message style: `feat(mcbots): ...` / `test(mcbots): ...`.

## Review Focus

1. `jetzt hol 64 kohle` while `hol 256 stein` runs: the stone job must come back after the coal job with its remaining count, not from zero. Test in Task 3.
2. `stopp` with three queued jobs: the running job ends, the three stay and the next starts. Test in Task 3.
3. Own chest set but unreachable/missing block when the inventory fills: the job fails with `kein Kiste bei x y z` (not a silent hang), and the supply chest is used only when no own chest is set. Test in Task 5.
4. `behalte 64 stick` then `lagern`: exactly 64 sticks stay, the rest goes in; tools/food never deposited. Test in Task 5.
5. `handel sticks 10` with zero sticks and no logs: fails within one attempt with `keine Sticks`, no endless wait. Test in Task 6.

---

### Task 1: `prefs.js` — per-bot chat-set preferences

**Files:**
- Create: `app/prefs.js`
- Test: `app/test/prefs.js` (register in `app/test.js` after `'misa'`)

**Interfaces:**
- Produces: `loadPrefs(file, name) -> {chest: {x,y,z}|null, keep: {[item]: n}, verbose: boolean}`; `savePrefs(file, name, patch)` merges `patch` into the bot's entry and writes atomically (`.tmp` + rename, mode 0o600) like `owner.saveRole`. `file` may be `null` (in-memory no-op, returns defaults). Defaults: `{chest: null, keep: {}, verbose: false}`. Invalid stored values fall back to the defaults per key.

- [ ] **Step 1: Write the failing test** `app/test/prefs.js`

```js
'use strict';
(async () => {
  const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
  const {loadPrefs, savePrefs} = require('../prefs');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mcbots-prefs-'));
  try {
    const file = path.join(dir, 'prefs.json');
    assert.deepEqual(loadPrefs(file, 'MisaBot'), {chest: null, keep: {}, verbose: false});
    savePrefs(file, 'MisaBot', {chest: {x: 120, y: 64, z: -340}});
    savePrefs(file, 'MisaBot', {keep: {stick: 64}, verbose: true});
    savePrefs(file, 'bot23', {verbose: true});
    assert.deepEqual(loadPrefs(file, 'MisaBot'), {chest: {x: 120, y: 64, z: -340}, keep: {stick: 64}, verbose: true});
    assert.deepEqual(loadPrefs(file, 'bot23'), {chest: null, keep: {}, verbose: true});
    fs.writeFileSync(file, JSON.stringify({MisaBot: {chest: 'nope', keep: 3, verbose: 'yes'}}));
    assert.deepEqual(loadPrefs(file, 'MisaBot'), {chest: null, keep: {}, verbose: false});
    assert.deepEqual(loadPrefs(null, 'MisaBot'), {chest: null, keep: {}, verbose: false});
    savePrefs(null, 'MisaBot', {verbose: true}); // no throw
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
})();
```

- [ ] **Step 2: Run** `node test/prefs.js` — expected: FAIL, cannot find module `../prefs`.
- [ ] **Step 3: Implement `app/prefs.js`** with `loadPrefs(file, name)` and `savePrefs(file, name, patch)`; validate `chest` as three finite integers, `keep` as `{[a-z_]{1,48}: 0..4096}`, `verbose` boolean. Export `{loadPrefs, savePrefs, DEFAULTS}`.
- [ ] **Step 4: Run** `node test/prefs.js` — expected: silent exit 0.
- [ ] **Step 5: Commit** `git add app/prefs.js app/test/prefs.js app/test.js && git commit -m "feat(mcbots): per-bot prefs file (chest, keep list, verbose)"`

### Task 2: Order grammar — new words in `owner.js`

**Files:**
- Modify: `app/owner.js` (`HELP`, `translate`), `app/test/owner-orders.js`

**Interfaces:**
- Produces: `translate(words, ctx)` returns, besides the existing shapes, exactly:
  - `{verbose: true|false}` for `laut` / `leise` / `verbose on|off`
  - `{queue: 'list'}` for `queue` / `liste`; `{queue: {remove: n}}` for `queue weg <n>` / `queue remove <n>`; `{queue: {first: n}}` for `queue erst <n>` / `queue first <n>` (n 1..99 = position in the queue, 1-based)
  - `{stopAll: true}` for `alles stopp` / `clear`; `{stop: true}` unchanged for `stopp|bleib|fertig|cancel`
  - `{now: <inner>}` for `jetzt <order>` where `<inner>` is `translate(rest, ctx)` and must have `.type`, else `{unknown: true}`
  - `{chest: 'look'}` for `kiste`; `{chest: {x,y,z}}` for `kiste <x> <y> <z>` (integers)
  - `{type: 'deposit', args: {own: true}}` for `lagern`
  - `{keep: {item, count}}` for `behalte <n> <item>` (0..4096; `behalte nichts <item>` = 0)
  - `{type: 'trade', args: {item: 'stick', minutes?: n, target?: n}}` for `handel sticks`, `handel sticks 1h` / `30m`, `handel sticks 500`; items other than `sticks`/`stick` → `{unknown: true}`
  - `hol <n> <item>`: n 1..4096 (was 256); `farm <n> <block>` identical to `hol` for mined blocks
  - `{help: true}` for `hilfe`
- `owner.HELP2`: a second ≤ 100-char line listing the new words.

- [ ] **Step 1: Add failing assertions** to `app/test/owner-orders.js` right after the existing `tr(...)` assertions:

```js
  assert.deepEqual(tr('laut'), {verbose: true}); assert.deepEqual(tr('verbose off'), {verbose: false});
  assert.deepEqual(tr('queue'), {queue: 'list'}); assert.deepEqual(tr('liste'), {queue: 'list'});
  assert.deepEqual(tr('queue weg 2'), {queue: {remove: 2}}); assert.deepEqual(tr('queue erst 3'), {queue: {first: 3}});
  assert.deepEqual(tr('alles stopp'), {stopAll: true}); assert.deepEqual(tr('clear'), {stopAll: true}); assert.deepEqual(tr('cancel'), {stop: true});
  assert.deepEqual(tr('jetzt hol 64 kohle'), {now: {type: 'mine', args: {block: 'coal_ore', count: 64}}});
  assert.deepEqual(tr('jetzt status'), {unknown: true});
  assert.deepEqual(tr('kiste'), {chest: 'look'}); assert.deepEqual(tr('kiste 120 64 -340'), {chest: {x: 120, y: 64, z: -340}});
  assert.deepEqual(tr('lagern'), {type: 'deposit', args: {own: true}});
  assert.deepEqual(tr('behalte 64 stick'), {keep: {item: 'stick', count: 64}}); assert.deepEqual(tr('behalte nichts stick'), {keep: {item: 'stick', count: 0}});
  assert.deepEqual(tr('handel sticks'), {type: 'trade', args: {item: 'stick'}});
  assert.deepEqual(tr('handel sticks 1h'), {type: 'trade', args: {item: 'stick', minutes: 60}});
  assert.deepEqual(tr('handel sticks 30m'), {type: 'trade', args: {item: 'stick', minutes: 30}});
  assert.deepEqual(tr('handel sticks 500'), {type: 'trade', args: {item: 'stick', target: 500}});
  assert.deepEqual(tr('hol 4096 stein'), {type: 'mine', args: {block: 'stone', count: 4096}});
  assert.deepEqual(tr('farm 256 deepslate'), {type: 'mine', args: {block: 'deepslate', count: 256}});
  assert.deepEqual(tr('hilfe'), {help: true});
  for (const s of ['hol 4097 stein', 'queue weg 0', 'queue weg x', 'kiste 1 2', 'behalte 5000 stick', 'handel diamonds', 'handel sticks 0h', 'jetzt']) assert.deepEqual(tr(s), {unknown: true});
  assert.ok(HELP2.length <= 100);
```
  (import `HELP2` from `../owner` in the require line; replace the existing `'hol 257 eisen'` refusal with `'hol 4097 eisen'`.)

- [ ] **Step 2: Run** `node test/owner-orders.js` — expected: FAIL at the `laut` assertion.
- [ ] **Step 3: Implement** in `translate` and export `HELP2`. Keep existing branches untouched; add the new ones before the final `{unknown: true}`.
- [ ] **Step 4: Run** `node test/owner-orders.js` — expected: exit 0.
- [ ] **Step 5: Commit** `git commit -am "feat(mcbots): queue, chest, keep, trade and verbose words in the order grammar"`

### Task 3: `bindOwner` — append by default, queue words, `jetzt`, `stopp` keeps the queue

**Files:**
- Modify: `app/bots.js` (`bindOwner` ~401-452, `enqueue` ~660-700, constructor ~322-362), `app/test/owner-orders.js`

**Interfaces:**
- Consumes: Task 2 shapes; `prefs.js` (`this.prefsFile = STATE_DIR/prefs.json`, `this.prefs = loadPrefs(...)` in the constructor next to `rolesFile`).
- Produces: chat orders call `this.enqueue(type, args, {first: !!now})` (no `replace`). `{stop}` → `this.cancel()` only, plus `this.stoppedAt = Date.now()` (queue kept). `{stopAll}` → `this.enqueue('stop')` (existing: drops queue + cancel). `{queue: 'list'}` → receipt `1 mine coal_ore 64, 2 chop 32` (max 5, `leer` when empty). `{queue: {remove: n}}` → removes `this.queue[n-1]` (receipt `weg: <label>`; `n` out of range → `geht nicht: nur <len> in der Liste`). `{queue: {first: n}}` → moves it to index 0 (receipt `als nächstes: <label>`). `{now: inner}` → validate `inner`, then `enqueue(inner.type, inner.args, {first: true})`; `resumeLater` already re-queues the running job with its `t`/`collected` state — extend `RESUMABLE`-independent handling: for `first`, always re-queue the running job (not only RESUMABLE types) with `resume: true`. `{verbose}` → `savePrefs` + `this.prefs.verbose`, receipt `laut`/`leise`. `{help}` → say `HELP2`. `{chest}`, `{keep}`, `deposit {own}` are handled in Task 5 (leave a `throw new Error('noch nicht')` placeholder here).
- `status` receipt becomes: `Leben L, Essen F, <job label or frei> P%, Liste N, Inventar I%, Kiste ja|nein` where `P%` only when `job.total > 0`, `I%` = `Math.round(100 * (36 - freeSlots) / 36)`.

- [ ] **Step 1: Add failing assertions** to `test/owner-orders.js` after the existing `bot.emit('message', msg('bot1 komm') ...)` block (adapt the first expectation):

```js
    assert.deepEqual(enqueued[0], ['come', {player: 'fancy8869'}, {first: false}]);
    ...
    // queue words: orders append, stopp keeps the queue, jetzt goes first and re-queues the running job
    runner.queue = []; runner.current = null;
    bot.emit('message', msg('hol 16 stein', true), 'chat', uuid);
    bot.emit('message', msg('hol 16 kohle', true), 'chat', uuid);
    bot.emit('message', msg('hol 8 holz', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine', 'mine', 'chop']);
    bot.emit('message', msg('queue', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, 'ok: 1 mine stone 16, 2 mine coal_ore 16, 3 chop 8');
    bot.emit('message', msg('queue weg 2', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['mine', 'chop']);
    bot.emit('message', msg('queue erst 2', true), 'chat', uuid);
    assert.deepEqual(runner.queue.map((j) => j.type), ['chop', 'mine']);
    bot.emit('message', msg('queue weg 9', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, 'geht nicht: nur 2 in der Liste');
    runner.current = {...runner.queue.shift(), status: 'running', t: {done: 3, total: 8}};
    bot.emit('message', msg('stopp', true), 'chat', uuid);
    assert.equal(runner.current.cancelled, true); assert.equal(runner.queue.length, 1);
    runner.current = {id: 77, type: 'mine', args: {block: 'stone', count: 16}, status: 'running', t: {done: 4, total: 16}};
    bot.emit('message', msg('jetzt hol 2 kohle', true), 'chat', uuid);
    assert.equal(runner.queue[0].args.block, 'coal_ore'); assert.equal(runner.queue[1].id, 77); assert.ok(runner.queue[1].resume);
    bot.emit('message', msg('alles stopp', true), 'chat', uuid);
    assert.equal(runner.queue.length, 0);
    bot.emit('message', msg('laut', true), 'chat', uuid);
    assert.equal(runner.prefs.verbose, true); assert.equal(whispers.at(-1).text, 'ok: laut');
    bot.emit('message', msg('hilfe', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, require('../owner').HELP2);
    runner.snapshot = () => ({health: 20, food: 18, job: {label: 'mine stone 16', done: 4, total: 16}, role: runner.role, freeSlots: 18, strangerOrders: 0});
    bot.emit('message', msg('status', true), 'chat', uuid);
    assert.equal(whispers.at(-1).text, 'ok: Leben 20, Essen 18, mine stone 16 25%, Liste 0, Inventar 50%, Kiste nein');
```
  Set `runner.prefsFile = path.join(dir, 'prefs.json')` next to `runner.rolesFile = roles`. The runner in this test has `pump` stubbed, so `current` is set by hand.

- [ ] **Step 2: Run** `node test/owner-orders.js` — expected: FAIL at `enqueued[0]` (`{replace: true}`).
- [ ] **Step 3: Implement** in `bindOwner`/constructor as in Interfaces. `enqueue(..., {first})`: when `first` and `this.current` is not cancelled, call `this.cancel()` and unshift the running job with `{...was, status: 'queued', cancelled: false, resume: was.t?.area || was.startPos || true}` regardless of `RESUMABLE` (a `mine` job keeps `collected`); queue the new job before it.
- [ ] **Step 4: Run** `node test.js` from `app/` — expected: exit 0 (the hub/dashboard tests still pass `replace`/`first` explicitly).
- [ ] **Step 5: Commit** `git commit -am "feat(mcbots): chat orders queue up; stopp keeps the queue; jetzt, queue weg/erst, laut/leise, hilfe"`

### Task 4: Start/end reports and 10 % progress

**Files:**
- Modify: `app/bots.js` (`pump` ~737-800, `emit` ~383), `app/test/owner-orders.js` or new `app/test/reports.js`

**Interfaces:**
- Consumes: `this.chatJobs` (Set of job ids ordered in chat), `this.prefs.verbose`.
- Produces: for a chat job, `pump` says `start: <label>` when it starts (`weiter: <label>` on resume). End messages stay `fertig|Problem|gestoppt: <text>`; the `fail` text is `<label>: <reason>` where reason is `this.lastError` without the `type: ` prefix (already so). With `verbose`, a timer in `pump` (every 10 s, `unref`) says `<label> <P>%` each time `Math.floor(100 * t.done / t.total / 10)` increases; cleared when the job ends. Non-chat jobs (hub, dashboard, keeper) say nothing.

- [ ] **Step 1: Write failing test** `app/test/reports.js`: build a `BotRunner` like in owner-orders, keep the real `pump`, stub `JOBS` via `runner.jobs = {...}`? — `JOBS` is module-private; instead register a fake job type: set `VALIDATE.fake = (a) => a; JOBS.fake = ...` by exporting `JOBS`/`VALIDATE` from bots.js if not already (`module.exports` check; export both if missing). The fake job sets `job.t.total = 10`, bumps `job.t.done` by 5 twice with `await sleep(15)` in between (test runs the timer with `runner.progressEveryMs = 5`). Assert the `say` events: `['start: fake', 'fake 50%', 'fertig: finished: fake (0 s)']` with verbose on; with verbose off only start and fertig; with a throwing fake job: `'Problem: failed: fake - kaputt'`. Jobs not in `chatJobs`: no say events.
- [ ] **Step 2: Run** `node test/reports.js` — expected: FAIL (no `start:` message).
- [ ] **Step 3: Implement** in `pump` (`this.progressEveryMs ??= 10000`).
- [ ] **Step 4: Run** `node test.js` — expected: exit 0. Register `'reports'` in `test.js`.
- [ ] **Step 5: Commit** `git commit -am "feat(mcbots): chat jobs report start, end and 10 % progress when verbose"`

### Task 5: Own chest, keep list, deposit on full inventory, `lagern`

**Files:**
- Modify: `app/bots.js` (`bindOwner` placeholders from Task 3; `chestOf` line ~1796; the full-inventory branch ~2086-2092; `VALIDATE.deposit` ~125; `JOBS.deposit` `keepBack` ~3194), `app/test/owner-orders.js`, `app/test/jobs/` (new `own-chest.js`, registered from `test/jobs.js` the way its siblings are)

**Interfaces:**
- Consumes: `this.prefs.chest`, `this.prefs.keep`; `misa.boxRule`-style area check is not needed (a chest is a point; use `this.protectedAreas` point check that `deposit` already passes through `goNear`).
- Produces:
  - `{chest: 'look'}`: the block the player looks at = `player.entity` → `bot.blockAtEntityCursor(player.entity)`; must be `chest|trapped_chest|barrel`, else `geht nicht: schau auf eine Kiste`. `{chest: {x,y,z}}`: same block check via `bot.blockAt`. On success `savePrefs(..., {chest})`, receipt `Kiste: x y z`.
  - `{keep}`: `savePrefs(..., {keep: {...prefs.keep, [item]: count}})` (delete the key at 0), receipt `behalte 64 stick` / `behalte stick nicht mehr`.
  - `VALIDATE.deposit` accepts `{own: true}` (returns `{own: true}`) and an optional `keep` object (validated like prefs keep). `JOBS.deposit`: when `job.args.own`, resolve `r.prefs.chest` (throw `keine Kiste zugewiesen` when null) and use `r.prefs.keep` as `keep`; `keepBack` already honours `job.args.keep` — merge `r.prefs.keep` into `spare` for every deposit of this bot.
  - `chestOf(r, job)` returns `r.prefs?.chest || <existing>`; the full-inventory branch's error text when still full: `Kiste voll` after trying the next `chest|barrel` within 2 blocks of the own chest (one extra `JOBS.deposit`), then throws.
- [ ] **Step 1: Failing tests.** In `owner-orders.js`: `bot.blockAtEntityCursor = () => ({name: 'chest', position: {x: 1, y: 2, z: 3}})`; `kiste` → receipt `ok: Kiste: 1 2 3`, `loadPrefs(prefsFile,'bot1').chest` equals; `bot.blockAt = () => ({name: 'stone'})`; `kiste 5 6 7` → `geht nicht: schau auf eine Kiste` variant `keine Kiste bei 5 6 7`; `behalte 64 stick` → prefs.keep `{stick: 64}`; `lagern` → `enqueued.at(-1)` is `['deposit', {own: true}, {first: false}]`. In `test/jobs/own-chest.js` (fake-bot style of its siblings): `JOBS.deposit` with `{own: true}` and `prefs = {chest: {x,y,z}, keep: {stick: 64}}` deposits all but 64 sticks, no tools, no food; with `prefs.chest = null` rejects `keine Kiste zugewiesen`; `chestOf(r, job)` prefers `prefs.chest`.
- [ ] **Step 2: Run** `node test/owner-orders.js && node test/jobs.js` — expected: FAIL (`noch nicht`).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `node test.js` — expected: exit 0.
- [ ] **Step 5: Commit** `git commit -am "feat(mcbots): own chest per bot (kiste), keep list (behalte), lagern; full inventory deposits there"`

### Task 6: `handel sticks [1h|n]` — trade order with a stop condition

**Files:**
- Modify: `app/bots.js` (`VALIDATE.trade` ~137-147, `builderOrder`-level resolution in `bindOwner`), `app/trade.js` (`makeTrade` loop), `app/test/trade.js`, `app/test/owner-orders.js`

**Interfaces:**
- Consumes: `cfg.tradeHalls` is hub-side; the runner receives halls? — check `hub.js` welcome payload; if halls are not sent to workers, add `tradeHalls` to the welcome message next to `settings` (hub.js:485) and store it on the runner as `this.tradeHalls` (hubclient.js welcome handler). The hall for a bot: `this.tradeHalls[this.name.toLowerCase()] || this.tradeHalls.misa` for guest bots, else none (owner's hall = `trade.js` defaults).
- Produces: `VALIDATE.trade` accepts `item: 'stick'`, `minutes` 1..1440, `target` 1..4096 (passed through). In `makeTrade`, `job.args.minutes`/`target` end the loop: `Date.now() - job.startedAt >= minutes*60000` or `emeralds >= target` → return normally; `job.t.open` is false when either is set so the 10 % progress works against `target`. On no sticks and `ensureItem('stick')` failing: throw `keine Sticks` (the existing wait applies only to the owner's hall without args). Chat receipt: `handle sticks (60 min)` / `(bis 500)`; done text includes `Smaragde: N` (set `job.progress = `Smaragde: ${emeralds}`` so the done message carries it).
- [ ] **Step 1: Failing tests.** `test/trade.js`: a fake runner runs `trade` with `{minutes: 0.001}` and resolves; with `{target: 3}` and a fake villager offering 1 emerald per trade resolves after 3 and `job.progress === 'Smaragde: 3'`; with no sticks and `ensureItem` rejecting → rejects `/keine Sticks/`. `owner-orders.js`: `handel sticks 1h` → `enqueued.at(-1)[0] === 'trade'` with `{item: 'stick', minutes: 60, hall..., stores...}` for a runner with `tradeHalls = {misa: {...}}`; without halls and a bot name that is not an owner bot → `geht nicht: keine Handelshalle`.
- [ ] **Step 2: Run** `node test/trade.js` — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node test.js` — expected: exit 0.
- [ ] **Step 5: Commit** `git commit -am "feat(mcbots): handel sticks [time|target] order with a stop condition"`

### Task 7: Docs, runbook, Nix build

**Files:**
- Modify: `docs/runbooks/minecraft/BOTS.md` (orders table), `docs/guides/` Misa guide source (new words: kiste, lagern, behalte, queue, jetzt, stopp vs alles stopp, laut, handel), `docs/specs/2026-11-03-misabot-v2-design.md` (Phase 1 marked shipped, queue persistence noted as deferred)

- [ ] **Step 1:** Update the docs above.
- [ ] **Step 2: Run** `nix build .#mcbots` from the repo root — expected: build succeeds (runs `node test.js`).
- [ ] **Step 3: Commit** `git commit -am "docs(mcbots): phase 1 orders (queue, kiste, handel) in runbook and Misa guide"`

## Deferred (noted, not in this plan)

- Queue persistence across worker restarts beyond the existing `KEEP`/`keptOf` mechanism.
- Phase 2 (acquire strategies, nether hazards, tool replacement, idle) and Phase 3 (shulker, large rounds) get their own plans after Phase 1 is live.
