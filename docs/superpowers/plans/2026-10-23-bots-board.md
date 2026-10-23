# Bots board: spike, sandbox bench, helpers to the sandbox, board + excavate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** three bots dig out a 16 x 16 x 8 box in the sandbox through a job board, 3 of 3 runs without
stall or double work, one run with a bot killed mid-way.

**Architecture:** the board (`app/board.js`, pure) lives in the hub process next to `plan.js`. It cuts
a job into slices, hands each slice to an idle bot with the existing `runner.enqueue('part', ...)`
(local and remote bots alike), and reads heartbeat, progress and outcome from the status snapshots
the hub already has. A scenario runner resets a sandbox area over the sandbox RCON, starts a job and
measures it.

**Tech Stack:** Node (CommonJS, `node:assert` test scripts, no framework), mineflayer, Nix
(`oci-containers`), bandit-nix contract checks.

**Spec:** `docs/specs/2026-10-23-bots-redesign.md` (read "The job board" and "Settled after the
builder check" first).

## Global Constraints

- Work in the worktree `~/src/bandit-craft-redesign`; commits unsigned (`git -c commit.gpgsign=false`); never push, never touch `main`. The owner pushes and deploys.
- Experiments only in the sandbox (virtual host `sandbox.bots`); never jobs on the main server.
- No secrets read or printed (`/run/mcbots/seed.env`, RCON passwords stay in the process env).
- Legitimate digging only: the dig loop's `NATURAL` filter and `insideAreas` protected-area check stay.
- Tests: `cd hosts/bandit-lab/services/mcbots/app && NODE_PATH=<see BOTS.md> node test/<topic>.js`; full `node test.js` before every commit. Nix: `nix fmt -- <files>`, `nix flake check`, lab build in bandit-nix with `--override-input bandit-craft git+file://$PWD`.
- Match the surrounding style: `'use strict'`, two-space indent, one-line why-comments, no new dependencies.

## Review Focus

1. A box partly inside a protected zone: refused when the job is created, with the zone named (test in Task 4).
2. A bot that goes offline (worker container stopped) while holding a part: the part reopens after 45 s and another bot finishes it (test in Task 4, scenario in Task 7).
3. Emergency stop during a board job: every part's bot stops, the job is `paused`, no bot gets a new part until resume (test in Task 6).
4. A hub restart mid-job: `board.json` reloads, running parts come back as `open` (their bots were stopped by the restart), the job goes on (test in Task 4).
5. A slice that keeps failing (lava, unreachable): after 3 tries the part is `failed`, the job shows a problem with the last error and the other parts keep running (test in Task 4).

---

## Spike (at most one day, throwaway, no tests)

Proves the riskiest assumptions before PR work. Code lives in `~/src/bandit-craft-redesign/spike/` and is never committed to the branch.

- [x] **S1: three bots reach the sandbox from the laptop.** Ask the owner to run on the laptop:
  `MC_VHOST=sandbox.bots nix run ~/src/bandit-craft-redesign#mcbots-worker -- bot5 bot6 bot7`
  Expected: the lab dashboard lists bot5-7 online; the sandbox log shows three "joined the game". If not, stop and report: this is the first blocker.
- [x] **S2: a test box.** Pick a 16 x 16 x 8 box at least 32 blocks outside every zone in `places.js`/`PROTECTED_AREAS`. The owner fills it in the sandbox as op: `/fill <x1> <y1> <z1> <x2> <y2> <z2> stone`. Record the coordinates in `spike/notes.md`.
- [x] **S3: minimal board.** `spike/board.mjs`: polls the dashboard `GET /api/state`, cuts the box into 4 slices with `strip()` from `plan.js`, posts `POST /api/job` (`{bots: [name], type: 'excavate', args: <slice>}`, header `Origin` = the dashboard origin) per idle bot. Today's `excavate` caps a box at 9 x 9 x 5, so the spike cuts the box into 16 pieces of 4 wide x 8 long x 4 high and digs the upper pieces before the lower ones. Reopen a piece when its bot's snapshot shows `lastError` or `online: false` for 45 s.
- [x] **S4: three runs.** Run 3 times (owner refills with `/fill` between runs); in run 3 the owner kills bot6 in game (`/kill bot6`) half-way. Record per run: minutes, pieces failed, blocks left (count by eye or `/execute if blocks <box> <air box above> all`), deaths. Also time the stop: `POST /api/job {bots:'all', type:'stop'}` while all dig; seconds until all snapshots show no job.
- [ ] **S5 (deferred: slayer stays idle, owner 2026-10-23): translator on slayer.** Ten German orders in `spike/orders.txt` (for example "grab das hier aus", "hol mir 20 Eisen", "bring alles ins Lager", "hör auf", "bau hier eine Fackel-Reihe", ...) with the wanted job JSON next to each. On slayer, through its llama-server/Ollama at the lab's quantisation: Andy-4.2, Qwen3-14B Q4_K_M, gpt-oss:20b. One prompt with the job schema; count exact jobs. Target: 8 of 10 for the winner.
- [x] **S6: report.** `spike/notes.md` with the numbers from S4, S5 and the stop time; tell the owner in German. If S4 fails for reasons the board cannot fix (dig loop stalls), Task 5 starts with that cause.

## PR 1: sandbox bench

### Task 1: scenario library (pure)

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/scenario.js`
- Test: `hosts/bandit-lab/services/mcbots/app/test/scenario.js`; add `'scenario'` to the list in `app/test.js`

**Interfaces:**
- Produces:
  - `resetCommands(scn) -> string[]`: console lines that rebuild the area: `fill` of `scn.box` with `scn.fill` (default `stone`), then `fill` of a 1-block air margin above.
  - `emptyCheck(box) -> string`: `execute if blocks x1 y1 z1 x2 y2 z2 x1 300 z1 all` (air reference above build height of the box, same x/z, height `y2-y1` from y 300).
  - `measure(samples, {stallMs = 60000}) -> {ms, stalls, deaths, refused}` over snapshot samples `{t, bots: [{name, online, job, claims, deaths}]}`: a stall is a window of `stallMs` where no bot's `job.done` grew while a job ran.
  - `SCENARIOS`: `{'excavate-16': {box, fill: 'stone', job: {kind: 'excavate', box}}}` with the box chosen in S2.

- [ ] **Step 1: tests.** `resetCommands` for box `{x1:0,y1:60,z1:0,x2:15,y2:67,z2:15}` returns `['fill 0 60 0 15 67 15 stone', 'fill 0 68 0 15 68 15 air']`; `emptyCheck` returns `'execute if blocks 0 60 0 15 67 15 0 300 0 all'`; `measure` with samples where `done` stays 120 for 61 s returns `stalls: 1`, with steady growth `stalls: 0`; a box over 32 768 blocks makes `resetCommands` throw `/too big for one fill/`.
- [ ] **Step 2:** `node test/scenario.js` fails (module missing).
- [ ] **Step 3:** implement in `scenario.js`.
- [ ] **Step 4:** `node test/scenario.js` prints `ok`; `node test.js` passes.
- [ ] **Step 5:** commit `feat(mcbots): scenario library for sandbox runs`.

### Task 2: scenario runner CLI

> Changed while building: the dashboard API admits only the owner's Tailscale identity, so a CLI in the container would get 403, and trusting loopback would let the worker containers (same network namespace) in. The runner is a library (`scenario-run.js` `main`) that the hub runs in-process on `POST /api/scenarios {name, runs}` (owner only, Task 6); results go to the event log and `STATE_DIR/scenarios.jsonl`. No `mcbots-scenario` bin.

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/scenario-run.js`
- Modify: `hosts/bandit-lab/services/mcbots/package.nix` (a `mcbots-scenario` bin next to `mcbots-worker`)

**Interfaces:**
- Consumes: `scenario.js` (Task 1); `rcon(opts, commands)` from `admin.js`; `loadConfig(env).sandboxRcon` from `config.js`; dashboard HTTP on `127.0.0.1:${DASHBOARD_PORT}` with header `Origin` as `sameOrigin` in `server.js` expects.
- Produces: `mcbots-scenario <name> [--runs N]`: resets, starts the scenario's job (`POST /api/board/jobs` once Task 6 exists; until then exits with "no board"), samples `/api/state` every 2 s, ends on job done/failed or 30 min, checks `emptyCheck` over RCON, prints one JSON line per run `{scenario, run, ok, ms, stalls, deaths, refused}` and appends it to `STATE_DIR/scenarios.jsonl`.
- Run on the lab: `ssh bandit-lab docker exec mcbots mcbots-scenario excavate-16 --runs 3`.

- [ ] **Step 1:** implement; refuse to run when `sandboxRcon` is null (`SANDBOX_RCON_HOST` unset) with exit code 2 and "no sandbox console". It never uses `RCON_HOST` (the real server).
- [ ] **Step 2:** test in `test/scenario.js`: a fake RCON (loopback `net` server as in `test/pillars-admin-blocklog.js`) receives exactly the reset lines in order; with `sandboxRcon: null` the runner exits 2.
- [ ] **Step 3:** `node test.js` passes; `nix build .#checks.x86_64-linux.<mcbots check>` (the package's own check) passes.
- [ ] **Step 4:** commit `feat(mcbots): mcbots-scenario runs a sandbox scenario`.

## PR 2: helpers into the sandbox, Andy off

### Task 3: point every bot at the sandbox

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/default.nix` (the `mcbots` container environment and `workerContainers` environment: `MC_VHOST = "sandbox.bots";` with a one-line why: "owner 2026-10-23: helpers test in the sandbox until the board passes")
- Modify: `hosts/bandit-lab/services/mcagents/default.nix` (`enable` default `false`, same why)
- Modify (bandit-nix, separate worktree from `origin/main`): `ci/lab-minecraft.nix:62`, the assertion "the three helper bots play on main" becomes "every mcbots container uses `MC_VHOST = sandbox.bots`".

**Interfaces:** none new. With `MC_VHOST` set the hub's existing `evictTick` (`server.js:771`) kicks any bot that lands on the real server.

- [ ] **Step 1:** edit, `nix fmt -- <files>`, `nix flake check` here.
- [ ] **Step 2:** bandit-nix: `nix build --override-input bandit-craft git+file://$HOME/src/bandit-craft-redesign .#nixosConfigurations.bandit-lab.config.system.build.toplevel` and `nix flake check` with the same override. Expected: both pass.
- [ ] **Step 3:** commit both (two repos, two commits) `feat(mcbots): helpers play in the sandbox, agents off`.
- [ ] **Step 4 (owner, after shipping):** check from the laptop: `ssh bandit-lab 'docker logs --since 10m minecraft-sandbox 2>&1 | grep -c "joined the game"'` expected 6 (bot1-3, 19-21) and `systemctl is-active mcagents` expected `inactive`.

Rollback: revert both commits, redeploy.

## PR 3: job board + excavate

### Task 4: `board.js` (pure)

**Files:**
- Create: `hosts/bandit-lab/services/mcbots/app/board.js`
- Test: `hosts/bandit-lab/services/mcbots/app/test/board.js`; add `'board'` to `app/test.js`

**Interfaces:**
- Consumes: `strip(args, axis, i, n)`, `failedSince(s, at, now)`, `stoppedSince(s, at, now)` from `plan.js`; `insideAreas`-style check via an injected `locked(box) -> string|null`.
- Produces: `class Board` with
  - `constructor({file, now = Date.now, locked})`: loads `file` (JSON, atomic write like `crews.js`); parts that were `claimed` come back `open`.
  - `create({kind: 'excavate', box, by}) -> Job` throws on `locked(box)` reason, on a box over 64 x 32 x 64, or an empty one. Cuts the box along its longer horizontal axis into slices of at most 4 wide; each part `{id: '<job>.<n>', box, state: 'open', tries: 0, progress: {done: 0, total}}`.
  - `assign(idleBots: string[], posOf: (bot) => {x,z}|null) -> [{bot, part}]`: each idle bot gets the nearest open part of the highest-priority running job; marks it `claimed` with `{bot, since: now}`.
  - `observe(snaps: Map<bot, snapshot>)`: for each claimed part: snapshot `online` and `job.type === 'part' && job.label` naming the part id -> heartbeat, `progress.done = job.done`; offline or no snapshot for `CLAIM_MS = 45000` -> back to `open`; idle after the claim with `failedSince` and a `lastError` that is the part's own (`part:` prefix, or `died`) -> `tries++`, `lastError`, `open` (or `failed` at `tries === 3`, setting `job.problem = {reason: lastError, part}`); any other fresh `lastError` -> `open` without a try (spike run 1: the keeper's "light: no torches available" failed a piece that was dug); idle with `stoppedSince` -> `open`; idle otherwise -> `done`. A job whose parts are all `done` is `done`.
  - `pause(jobId)`, `resume(jobId)`, `cancel(jobId)`, `pauseAll() -> string[]` (bots that held parts), `state()` (for the API).
- Values: `SLICE = 4`, `CLAIM_MS = 45000`, `MAX_TRIES = 3`, box caps 64 x 32 x 64.

- [ ] **Step 1: tests**, each with a fake clock:
  - 16 x 8 x 16 box -> 4 parts of 4 x 8 x 16 covering it exactly, no overlap.
  - `assign(['bot2','bot3','bot19'])` -> three different parts; a fourth call with `['bot3']` after bot3's part is done gives it the last part.
  - bot19 offline 46 s -> its part `open`, progress kept; next `assign(['bot2'])` gives it to bot2.
  - three failures with `lastError: 'part: unsafe: lava'` -> part `failed`, `job.problem.reason` contains `lava`, other parts still `claimed`.
  - a fresh `lastError: 'light: no torches available'` -> part `open`, `tries === 0`.
  - `create` on a box touching a locked zone throws with the zone name.
  - reload from `file` with a claimed part -> part `open`.
  - `pauseAll()` returns the holding bots; `assign` gives nothing while paused.
- [ ] **Step 2:** `node test/board.js` fails.
- [ ] **Step 3:** implement `board.js` (`failedSince`/`stoppedSince` are already exported by `plan.js`). Box notation everywhere is `{x1,y1,z1,x2,y2,z2}`; "16 x 16 x 8" in the spec means x 16, z 16, y 8.
- [ ] **Step 4:** `node test/board.js` prints `ok`; `node test.js` passes.
- [ ] **Step 5:** commit `feat(mcbots): job board with slices, claims and takeover`.

### Task 5: `part` job in the bot

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/bots.js`: `VALIDATE.part` next to `VALIDATE.excavate` (`:170`), `JOBS.part` next to `JOBS.excavate` (`:3381`), `NIGHT_JOBS` and the walk's `digOnly` list gain `part`; `RESUMABLE` and `KEEP` do not (the board resumes a part, never the bot).
- Test: `hosts/bandit-lab/services/mcbots/app/test/jobs/part.js`, added to `test/jobs.js`

**Interfaces:**
- Produces: job type `part`, args `{part: '<job>.<n>', x1, y1, z1, x2, y2, z2}`; validation: box at most 4 x 32 x 64 along any axis order (slice), part id `/^[\w.-]{1,40}$/`. `jobLabel` for it contains the part id (the board matches on it).
- Behaviour (spike findings a-c, f in brackets): resolve the needs first (pickaxe, food, free slots) wherever the bot stands, then walk near the slice (`goNear`, as `shaft` does, so chunks load) [a: excavate from 130 blocks away ended at once on unloaded chunks; bots with empty hands walked off for tools after arriving]. Dig it layer by layer from the top with `JOBS.excavate` on one-layer child jobs (as `shaft` calls it), setting `job.t.total`/`job.t.done` over the whole slice. Before each layer: `upkeep`, and `goNear` again if upkeep took the bot more than 8 blocks away [a]. While the root job is `part`, `care` skips `ensureGear` (armour, shield, iron smelting): only the job's needs send a bot away [b: gear trips pulled bots off mid-piece]. `part` joins `NIGHT_JOBS` (a fit bot digs on; an unfit one shelters, which the board reads as stopped, not failed) [c]. After the last layer a clean-up pass digs every solid block left in the slice except torches: excavate digs only NATURAL blocks, so its own cobblestone scaffold stayed (52 blocks in run 1, 23 in run 2) [f]. Then recount from the bot's view; blocks left -> throw `part: N blocks left`. A layer that ends "were not dug" is retried once, then the job throws with that message (`part:` prefix, the board counts it).

- [ ] **Step 1: test** with the fake bot of `test/jobs/rearm-excavate-shaft.js`: a 4 x 2 x 3 slice of stone is dug fully, `t.done === t.total === 24`; the same slice with one cobblestone block in it ends with that block dug too and a torch left; a slice of 5 wide is refused by `VALIDATE.part`; a slice already air ends `noop`; with the root job `part`, `care` does not call `ensureGear`.
- [ ] **Step 2:** fails. **Step 3:** implement. **Step 4:** `node test/jobs.js` and `node test.js` pass.
- [ ] **Step 5:** commit `feat(mcbots): part job digs one board slice`.

### Task 6: wire the board into the hub

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/server.js`: create `Board` (file `STATE_DIR/board.json`, `locked` from `cfg.protectedAreas` and `places.list` zones of kind `protected`), tick it in `keeperTick` before `plan?.tick()`, routes below, stop-all also calls `board.pauseAll()`.
- Modify: `hosts/bandit-lab/services/mcbots/app/config.js`: `BOARD_BOTS` (comma list, default empty = board off); must not overlap `PLAN_ROSTER`/`AGENT_BOTS` (throw like the existing roster checks).
- Modify: `hosts/bandit-lab/services/mcbots/app/keeper.js`: a `skip` set (the `BOARD_BOTS`) left out of `free()` and `dayFree()` (spike finding d: the keeper took idle board bots for `light` and `treefarm`; it waits 10 s idle, the board refills in 3 s, so it struck after errors and when the job ended).
- Modify: `hosts/bandit-lab/services/mcbots/default.nix`: `BOARD_BOTS = "bot1,bot2,bot3,bot19,bot20,bot21";`, `AGENT_BOTS = "";` (if `config.js` rejects an empty `AGENT_BOTS`, allow it: the agents are off since Task 3).
- Test: `hosts/bandit-lab/services/mcbots/app/test/board.js` (API part, loopback HTTP as `test/debug-api.js` does)

**Interfaces:**
- Consumes: `Board` (Task 4), job type `part` (Task 5), `runners`, `r.snapshot()`, `r.enqueue`.
- Produces: `GET /api/board` -> `board.state()`; `POST /api/board/jobs {kind, box}` (same `sameOrigin` + JSON check as `/api/job`) -> job or 400 with the reason; `POST /api/board/jobs/<id> {action: pause|resume|cancel}`. Each tick: idle `BOARD_BOTS` (online, no job, no owner order) -> `board.assign` -> `r.enqueue('part', part.box + {part: part.id})`; then `board.observe(snapshots)`.

- [ ] **Step 1: tests:** POST a job overlapping a protected area -> 400 with the area; POST a valid one -> `GET /api/board` lists 4 open parts; stop-all -> job `paused`; a keeper with `skip: ['bot2']` and bot2 the only idle bot assigns nothing.
- [ ] **Step 2:** fails. **Step 3:** implement. **Step 4:** `node test.js` passes; `nix flake check`; bandit-nix lab build with the override.
- [ ] **Step 5:** commit `feat(mcbots): board in the hub with its API`.

### Task 7: acceptance run in the sandbox

**Files:**
- Modify: `hosts/bandit-lab/services/mcbots/app/scenario.js` (`SCENARIOS['excavate-16']` with the S2 box; `excavate-16-kill`: same plus `kill bot19` over sandbox RCON when progress passes 50 %)
- Modify: `docs/runbooks/minecraft/BOTS.md` (section "Board and scenarios": how to start a board job, how to run `mcbots-scenario`, what the numbers mean)

- [ ] **Step 1:** implement the kill hook in `scenario-run.js` (Task 2's sampler triggers it once).
- [ ] **Step 2:** commit, hand to the owner for shipping (bandit-craft push, bandit-nix input bump, `lab-apply`).
- [ ] **Step 3 (after deploy):** from the laptop `curl -X POST -H 'content-type: application/json' -d '{"name":"excavate-16","runs":3}' https://bandit-lab.tail7facc9.ts.net:8445/api/scenarios`, then `excavate-16-kill` with one run; read the lines from `/api/events` (`scenario`). Expected: 4 lines with `"ok":true`, `"stalls":0`, the console check "box empty" (torches excepted) passing, and each run under 30 min (spike run 2 with today's dig loop: 24.9 min). Report the numbers to the owner in German; a failed run goes back to Task 5 with its cause.
