# Bots redesign: a job board over fixed skills, the model only for language

Status: direction approved by the owner in chat on 2026-10-23 ("mach wie du recommended hast"); this
spec is for review. Supersedes the agent-as-conductor part of `2026-10-12-in-game-bot-control.md`;
the owner-only command rules and the demonstration log of that spec stay.

## Why

The owner, who is not an IT person, wants to steer, manage and watch the bots from inside Minecraft,
and wants them to build a base with farms and redstone from nothing. So far every session was spent
on testing and almost everything went wrong; the dashboard is hard to use.

What the logs show (measured on bandit-lab, 2026-10-16..23):

- `decisions.jsonl`, last 3 000 records (about 22-23 Oct): of 1 501 outcomes **1 308 bad (87 %)**,
  171 good. 1 162 bad ones are one loop: Andy tries to redirect a bot that works on an owner order,
  the code refuses ("only the owner changes it"), Andy sends the same command again within a second.
  Replies are a bare command (`!startShift("coal")` 352x, `!collectBlocks("coal_ore", 10)` 318x),
  no reasoning; the refusal teaches it nothing.
- `journalctl -u mcagents`, 7 days: 7 900 commands, nearly all `collectBlocks`/`startShift`/`digShaft`.
- Hub log, 7 days: 5 005 of 7 300 lines are "air: surfacing ... swimming", 1 500 fight-odds lines;
  real stalls are "no free stone within N blocks" (102), "deposit/withdraw unsafe: water next to it"
  (65), "need planks and have no logs", keeper "done, but the chest did not get more".
- The work that does happen is done by fixed code (shifts, keeper, farms). The model on top produces
  noise and GPU load.
- The sandbox server runs (`minecraft-sandbox`, healthy 12 days) but **no bot joined it in 10 days**:
  the helpers play on the main server, so testing happened there.

What other projects show (research, not measured here):

- 2b2t automation (Baritone ~8.8k stars, HighwayTools, Litematica printer) has solved "dig this
  selection" and "build this schematic" for years with fixed code and a two-corner selection. No model.
- AltoClef beats the game alone with a task tree: a task returns sub-tasks, a catalogue knows how to
  get each item. ChatClef later put a chat layer on top that only turns language into tasks.
- LLM swarms on local models (minecraft-agent-swarm, gpt-oss:20b; MineCollab) gain from a shared
  team board and a stash, and still fail 31 % of actions or more with the model in the loop. Chat
  between agents costs up to 15 % and breaks builds (MineCollab).

## Goals

In this order; the first is the acceptance test.

1. **Dig out an area.** The owner marks a box in game; three bots dig it out together: split, no
   double work, right tool, spoil to storage, progress visible to the owner and shared between the
   bots through data, takeover when a bot fails.
2. **Underground, legitimate only** (owner 2026-10-23: no X-ray on either server): branch and strip
   mining at the right Y levels, shafts, tunnels, stairs, light, sealing lava and water, securing caves.
   Bots know only blocks they could see (exposed faces), never ore inside stone.
3. **Surface:** right tool always, fell and replant trees, make and replace tools, food, sleep, fight
   and flee.
4. **Shared goal from zero:** empty inventories, gather for a farm or redstone build together, then build.
5. **Build from a schematic** (`.litematic`), placed and adapted offline in a Claude Code session.
6. **A world map for planning** good enough for a Claude Code session to place builds.
7. **Control without command lists:** say or show what you want; menus and a selection tool in game.
8. **Management in game:** who does what, storage, progress, problems, emergency stop.
9. **A new dashboard** with a usable map.

## Non-goals and anti-goals

- No X-ray mining anywhere.
- No cloud model for live bots; no live agents on the gaming PCs.
- The model does not choose the bots' next action. It never runs in the work loop.
- Bots never talk to each other in chat to coordinate.
- Anti-goal: anything that digs a player build or a protected zone, starts lava/fire/TNT/water
  damage, or cannot be stopped at once. Such a run is a failure even if the task finished.
- Anti-goal: a rewrite that loses what works today (shifts, keeper, farms, combat, rescue).

## Decided

- Live only on bandit-lab (RTX 4090, 24 GB, Ollama). slayer (RTX 5070, 12 GB) runs batch work at
  night: replay, judge, LoRA training, sandbox scenario runs. Never live agents.
- Offline planning may use Claude Code (schematics, build sites, new skill code) with the owner present.
- **An own Paper plugin may go on the server** (owner 2026-10-23).
- **Legitimate mining only, on both servers** (owner 2026-10-23).
- **The helper bots pause on the main server** until the new version passes its sandbox tests
  (owner 2026-10-23).
- **Architecture C+D below** (owner 2026-10-23).

## Architectures compared

| | A: model conducts a clean skill library | B: offline Voyager (Claude writes skills, owner approves) | C: fixed base + job board, model for language, goals, exceptions | D: no model in the loop, model only translates language into jobs |
| --- | --- | --- | --- | --- |
| How it works | Andy/another local model picks the next skill each turn | live is A or D; new skills come from Claude Code sessions, tested in sandbox | code does all work; the model sets goals and handles exceptions | code does all work; the model turns one sentence into one job, nothing else |
| Reliability | low: measured 87 % bad decisions; literature 23-49 % task success | as the live part | medium: exception handling by the model is where it fails | high: like Baritone/AltoClef; failures are code bugs we can test |
| Effort | small now, endless later (prompting around the model) | medium per skill, needs a human | medium | medium; the same base as C |
| Risk | the model fights owner orders (seen) | generated code with bugs reaches live if review is thin | the model can still loop on exceptions | gaps become visible stalls, not silent loops |
| For the owner | unpredictable | invisible | mostly predictable | predictable: a job is a row they can see and cancel |
| VRAM on lab | Andy 5.6 GB, always busy | none extra live | 6-14 GB, busy on exceptions | 6-14 GB, busy only when the owner speaks |
| What stays of 14 400 lines | most skills, Andy wiring | all | skills, acquire, world, combat, hub | the same as C; mcagents shrinks to a translator |

**Recommendation and choice: C with D's rule.** The base is D (no model in the work loop). From C we
keep one narrow model use: when a job fails with a reason the code cannot resolve, the board shows it
to the owner as a problem with buttons ("skip", "retry", "move zone"); the model may *word* a
suggestion but never acts. B is how new skills get written: Claude Code writes, the sandbox scenario
proves it, the owner approves the PR. A is dropped.

## Building blocks (the logic)

The owner asked whether every rule must be coded again. Answer: behaviour is code, but not one rule
per situation.

1. **Skills** (30-40): dig block, walk to, place, open/fill/empty chest, craft, smelt, eat, sleep,
   fight, flee, light, seal fluid. Each declares what it needs (tool tier, free slots, item) and what
   it yields. Most exist today inside `bots.js`, `crafting.js`, `combat.js`, `fluids.js`, `seal.js`,
   `placing.js`, `homebed.js`; they move into one module each with that declaration.
2. **One resolver** for missing needs, written once. **It exists already:** `acquire.js` plans "how
   does a bot get N of an item" from game data (inventory, known chests, craft, smelt, drop, mob) by
   cost. It gets two more need kinds it lacks today: *free inventory* (go to storage) and *a usable
   tool* (repair chain), and is called before every skill instead of jobs handling gaps themselves.
   This is AltoClef's task catalogue.
3. **Jobs as data** on the board: "dig this box", "mine level y=-58", "build this schematic". A new farm
   is a schematic plus a job, not code.
4. **Reflexes** stay fixed and pre-empt everything: low air, lava/water next to a dig, low health,
   hostile mob, night. Today's versions (`combat.js`, `odds.js`, `fluids.js`, `rescue.js`) stay.

New code is needed only for a new skill. A failed need that the resolver cannot meet becomes a
problem on the board with its reason, never a retry loop.

What stays of the app (`hosts/bandit-lab/services/mcbots/app`, 14 394 lines): `acquire.js`,
`recipes.js`, `world.js` (claims with TTL), `combat.js`, `odds.js`, `fluids.js`, `seal.js`,
`placing.js`, `homebed.js`, `graves.js`, `rescue.js`, `blocklog.js`, `places.js`, `owner.js`,
`schematic.js`, `storage-layout.js`, the hub/worker transport (`hub.js`, `hubclient.js`). `bots.js`
(3 620) is split into skills and a job runner. `plan.js`/`plan-config.js`/`keeper.js` are replaced by
the board (their quotas become standing jobs). `crews.js` goals and the Andy agent loop go. `server.js`
(dashboard) is replaced in its own PR. Estimate (guess): 60-70 % of the lines stay, moved.

## The job board

One shared state in the hub, persisted in `STATE_DIR/board.json` (atomic write like `crews.json`),
served to bots over the existing worker socket and to the dashboard and plugin over HTTP.

```
Job      {id, kind: excavate|mine_level|build|gather|standing, by: owner|plan,
          box/target, created, state: open|running|paused|done|failed|cancelled,
          priority, parts: [PartId], problem?: {reason, since, part?}}
Part     {id, job, box (a slice), state: open|claimed|done|failed,
          claim?: {bot, since, heartbeat}, progress: {done, total}, tries, lastError?}
Lock     {box, job, reason: protected|player_build|fluid|job}   // areas no other job may touch
Event    {t, job, part?, bot?, what}                             // append-only, feeds UI and training log
```

Rules:

- A job is cut into parts when created: an excavate box into vertical slices of at most 4 wide along
  its long axis, each slice dug top down. Slices, not single blocks: a bot keeps one place and the
  claim traffic stays small. The existing per-block claims in `world.js` stay as the fine guard so two
  bots never dig the same block at a slice border.
- An idle bot asks the board for the best open part (priority, then distance) and claims it. A claim
  holds while the bot sends a heartbeat (every 10 s with its progress); after 45 s without one the part
  goes back to `open` with its progress kept.
- Progress is counted from the world, not from the bot's word: a part's `done` is the number of
  target blocks in its slice that are air (or the wanted block for builds), read from the bot's
  view. So a takeover starts where the last bot really stopped.
- A part fails after 3 tries with the same error; the job shows a problem with that reason and keeps
  its other parts running.
- Locks are checked before a job is accepted and before every dig: protected zones (`places.js`),
  blocks the block log records as placed by a player, and fluid cells. A job overlapping a lock is
  refused at creation with the reason shown.
- Emergency stop sets every running job to `paused` and tells every bot to stop at once (existing stop
  path); resume is per job.

### Example: three bots dig out 16 x 16 x 8

1. The owner marks the box with the selection tool. The board creates job `j1` with four slices
   (`p1`..`p4`, 4 x 16 x 8 each, 512 blocks), checks locks, shows "j1: 0/2048" in the boss bar.
2. bot2, bot3, bot19 are idle; each claims the nearest open slice: bot2 `p1`, bot3 `p2`, bot19 `p3`.
3. Before digging, the resolver checks needs: bot19 has no pickaxe; acquire finds one in the base
   chest and fetches it. bot2's inventory fills at 200 blocks; the free-inventory need sends it to
   storage, the claim stays held by heartbeat.
4. bot3 finishes `p2`, the board marks it done, bot3 claims `p4`.
5. bot19 dies at 300/512 in `p3`. Its heartbeat stops; after 45 s `p3` is open again with 300/512
   counted from the world. bot2, done with `p1`, claims `p3` and digs the remaining 212.
6. All parts done: job `j1` done, the boss bar shows "fertig", the event log has every step.

## Owner control in game

Recommendation: an own Paper plugin (`bandit-bots`, Java, built by Nix like `botgate`) that talks to
the hub over its HTTP API on the internal network. No client mod.

- **Selection tool:** a named golden shovel from `/bots`. Left click and right click set the two
  corners, shown with particles; then a menu: "ausgraben", "hier bauen", "Zone schützen", "abbrechen".
  (Like WorldEdit's wand; WorldEdit itself is not needed.)
- **Menus:** CommandPanels stays for the existing kit menus; the bot menu moves into the plugin
  because it needs live state (job list with progress, bot list, stop buttons).
- **Status:** a boss bar per running job (progress), action bar for the bot the owner looks at,
  a small sidebar scoreboard on demand (`/bots status`). Holograms only if needed later.
- **Emergency stop:** `/stop` alias `/bots halt`, a red item in the menu, and the dashboard button.
  All three go to the same hub call.
- **Natural language:** chat lines addressed to the bots (`bots, grab das aus`) go to the translator
  model, which returns one job or a question; the plugin shows the job as a confirm button before it
  goes on the board. Voice via Simple Voice Chat is a later option (speech-to-text on lab), not in scope.
- Only the owner (UUID check as `owner.js` today) can use any of it.

## World map for planning

Recommendation (sketch, own spec later): a hub endpoint and a CLI that export a box of the world from
the bots' view and the region files:

- a height map (PNG plus a JSON grid) of the surface, top block per column;
- slices per Y level as text grids for a box (what a Claude Code session reads best);
- a block export of a box as a `.litematic`/`.schem` so a schematic can be compared and adapted;
- BlueMap renders as the picture of the area.

A Claude Code session reads these, adapts the schematic (materials, rotation, ground) and writes the
result plus a placement (origin, rotation) as a build job. Builds are checked against the world after
each section ("is the build correct?" = diff of the box against the schematic).

Versions: the server is Paper 26.2, the bots speak 26.1 through ViaBackwards. A schematic block or
item mineflayer's 26.1 data does not know is refused when the job is created, with a list, until a
substitute is chosen. Foreign `.litematic` files stay out of this public repo (licence); they live in
the state volume.

## Dashboard

Recommendation (sketch, own spec and wireframe artifact later). Six views, one nav bar, emergency stop
always visible top right:

```
+------------------------------------------------------------------+
| Bots  [Übersicht] [Karte] [Bots] [Aufträge] [Lager] [Probleme]  [ NOT-AUS ] |
+------------------------------------------------------------------+
| Übersicht: 3 Bots aktiv · 1 Auftrag läuft · 0 Probleme            |
|  j1 Ausgraben 16x16x8   ███████░░░ 1430/2048   bot2 bot3 bot19   |
|  Lager: Cobblestone 1 820 · Holz 210 · Eisen 34                   |
+------------------------------------------------------------------+
| Karte: BlueMap tile view, bots as dots, jobs as boxes, drag a box |
|        to create a job, protected zones hatched                   |
| Bots:  name · state · job/part · health · food · tool · last error|
| Aufträge: job list, parts with progress, pause/cancel/priority    |
| Lager: categories, totals, full chests                            |
| Probleme: open problems with reason and buttons (retry/skip/move) |
+------------------------------------------------------------------+
```

## The model's remaining job

The translator: one German sentence (plus the owner's position and current selection) in, one job or
one clarifying question out, as JSON checked against the job schema. Candidates, to be measured on
slayer at the same quantisation, must fit the lab next to nothing else (Andy goes): Andy-4.2 (5.6 GB,
baseline), Qwen3-14B Q4/Q8, gpt-oss:20b (about 13 GB). Unmeasured; choose by the spike.
Training on slayer at night uses the demonstration log (owner sentence -> job -> outcome) for LoRA on
the translator, judged by replay.

## Safety and logistics (part of every PR)

- Every dig and place is checked against locks; every block a bot changes goes to `blocklog.js`.
- Storage has categories (`storage-layout.js`); "inventory full", "tool broken", "material missing"
  are resolver needs, not job code.
- Fluids: the existing seal-before-dig stays a reflex for every dig skill.

## Measurement

Every capability gets a sandbox scenario: a test area reset from a saved schematic by the sandbox
console, a fixed job, and a runner that records success, time, stalls (no progress 60 s), double work
(a block dug by two bots, from `blocklog.js`) and deaths. Runs on the lab sandbox; batches at night may
run from slayer. A change that lowers a scenario's success rate does not ship.

## Plan (small PRs)

Each PR: goal, check, rollback. Live bots stay paused on the main server until PR 3 passes.

1. **Sandbox test bench.** A reset area in the sandbox (saved schematic, pasted by sandbox RCON), three
   test bots on the sandbox virtual host, a scenario runner with the measurements above.
   Check: an empty scenario resets and reports in 3 of 3 runs. Rollback: revert; the sandbox world is
   reset by re-seed.
2. **Pause the helpers on the main server.** Their worker containers stop or move to the sandbox
   virtual host. Check: no bot joins the main server for a day. Rollback: revert the Nix change.
3. **Job board + excavate (acceptance test).** `board.js` in the hub, slices, claims with heartbeat,
   world-counted progress, takeover, locks; excavate as the first job kind (the current 9 x 9 x 5 limit
   in `bots.js` VALIDATE.excavate goes); resolver needs for free inventory and tool. Check: 16 x 16 x 8
   in the sandbox, three bots, 3 of 3 runs without stall or double work, one run with a bot killed
   mid-way. Rollback: revert; plan.js still in place until PR 5.
4. **Plugin: selection, menus, boss bar, stop.** Check: the owner marks a box in the sandbox and
   watches PR 3's run; stop halts all bots within 2 s. Rollback: remove the jar from the plugin list.
5. **Translator.** mcagents becomes the translator; Andy's work loop and `crews.js` goals go; plan.js
   quotas become standing jobs. Check: the spike's 10 sentences, 8 of 10 right. Rollback: revert.
6. **Underground (legitimate), then surface skills.** One scenario per skill.
7. **Schematic builds and the world-map export** (own spec, builds on `2026-10-13-schematic-builds.md`).
8. **New dashboard** (own spec with wireframes).
9. **Helpers back on the main server** when PRs 3-6 pass their scenarios.

## Spike (at most one day, throwaway)

Proves the riskiest assumptions first:

1. Three bots reach the sandbox (bot5 path) at all; if not, that is the first blocker.
2. A minimal board (slices, claims with heartbeat, world-counted progress) in front of today's dig code
   digs a 16 x 16 x 8 box in the sandbox in 3 of 3 runs without stall or double work, killing one bot
   in one run.
3. On slayer, ten free German orders ("grab das hier aus", "hol mir 20 Eisen", ...) through Andy-4.2
   and one or two candidates at the lab's quantisation: count right jobs. Target 8 of 10 for the
   winner.

The spike's code is thrown away; PR 3 is written properly with tests.

## Settled after the builder check (author's calls, not the owner's)

- **Player builds.** `blocklog.js` cannot tell a player from the world (it records bots and
  "world"). Until the plugin exists, locks are the `places.js` protected zones only, and jobs on the
  main server stay off (helpers paused anyway). PR 4's plugin records player place/break events
  (BlockPlaceEvent/BlockBreakEvent) into a hub endpoint; from then on `player_build` locks apply.
  The helpers return to the main server (PR 9) only after that.
- **Job creation in PR 3:** a hub HTTP call `POST /api/board/jobs` (owner auth like the dashboard) plus
  a scenario-runner call. PR 3's check is the formal test of the board; goal 1 counts done when PR 4
  repeats it with the owner marking the box in game.
- **Who owns an idle bot.** In the sandbox only the board dispatches (plan.js and the Andy loop are off
  for the test bots by config). A part runs on the bot as a new `part` job type in the existing job
  runner: it digs its slice with the excavate dig loop and reports progress; it is not RESUMABLE
  locally, the board is the only source of resumption.
- **Size limits.** The 9 x 9 x 5 cap belongs to today's one-bot room job. The part job takes a slice of
  at most 4 x 64 x 16 (top down, in layers); a job box is at most 64 x 64 x 32 and is cut into such
  slices. `VALIDATE.excavate` stays for the old job until it goes.
- **Test bots.** PR 2 points the three helper worker containers at the sandbox virtual host instead of
  stopping them; they are the test bots (same names, separate world). The scenario runner kills a bot
  by stopping its container or by the sandbox console `/kill`.
- **Progress in unloaded chunks.** Progress is counted by the sandbox/main server console
  (`/execute if blocks` per layer, or the plugin once it exists), not by bot view, so it is known
  wherever the slice is.
- **Protocol.** New frames on the worker socket (`part_claim`, `part_beat`, `part_done`) are additive;
  a worker that does not know them is never given a part. Windows PCs run no bots, so no skew there.
- **Stop.** Whether the existing stop path meets 2 s mid-path and mid-dig is unmeasured; the spike
  times it. If it does not, PR 4 includes bot-side abort work. Pause is per job; on resume the board
  recounts every part.
- **Plugin build:** plain `javac` against the pinned Paper API jar, like `botgate/default.nix` does
  against the Velocity jar. No Gradle.
- **Translator interface:** hosted by the `mcagents` service on lab Ollama. The plugin sends
  `{text, player pos, selection?}` to the hub; the hub calls the translator and validates the result
  with the same job schema module the board uses (`board-schema.js`, one copy). PR 5 fixes the fields
  of `gather` (`item`, `count`), `mine_level` (`y`, `length`, `branch`, origin) and `standing`
  (`item`, `want`, as today's keeper quotas).

## Left to the builder

Module layout of the split `bots.js`, slice width (4 is a guess), heartbeat timings, the plugin's
internal design and HTTP auth (reuse the agent token pattern), scenario file format, which candidate
models besides the three named.

## Open (only the owner)

- Which farm or redstone build is the first shared goal (PR 7).
