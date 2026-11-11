# Bots keep working: no hoarding, no death loops, no dead code (2026-11-11)

## Why

The owner wants the bots to keep working on their projects, their logic stress-tested and improved, missing
things added and old things removed. Four days of the main server's event archive (12133 fails, 1732 done,
131 deaths) show why they do not keep working today:

- **Hoarding.** The storage hall holds 45,260 cobblestone, 26,129 wheat seeds, 15,485 oak logs, 6,461 oak
  saplings, 4,740 dirt. Its stone chests are full, so a deposit's "hall full" fallback puts the surplus back
  into the supply chest (-271 66 -214, 1 slot free). With the supply chest full, every deposit fails
  ("inventory still full after depositing (chest full?)") and treefarm and mining orders stop.
- **Death loop.** bot1 died about 40 times at an ocean monument (~-300 60 -830): keeper chop far-searched
  600 blocks north, died, the grave job and the resumed chop walked back, died again. The 3-deaths-in-30-min
  hold covers owner orders and projects only, and one round trip takes longer than 10 min.
- **Idle crew.** The board bots (bot2, bot3, bot20, bot21) only get work from board jobs; since the LLM
  agent path went (bb87d35) nothing posts any.
- **Dead code.** The mcagents Nix module (default off), tools/mcagents, ci/mcagents-tests.nix and the
  `ollama-andy` model import are orphans.

Already fixed on this branch (3949200): rescue vs role prefixes, light jobs on unloaded zones, order/project
retry backoff with an alert, keeper jobs without far search, keeper tidy of a full supply chest.

## Owner decisions (2026-11-11)

1. Cheap surplus may be thrown away: cobblestone, dirt, gravel and the other `JUNK` stones, wheat seeds and
   saplings above a cap. Logs, ores, ingots, food and gear never.
2. The four free bots build the Untergrund-Kirche, plan `kirche-hauptplatz.litematic`, at -108 24 180 (the
   owner's last placement, 2026-11-05 22:44).
3. bot19's tree farm pauses while there is enough wood and goes on when it falls below the cap.

## Goals

- G1 The supply chest stays usable: no deposit puts over-cap items into it, surplus leaves the system at
  the work site.
- G2 A bot that died twice at the same place does not go back there by itself.
- G3 The tree farm order idles (not fails) while the hall has enough logs.
- G4 A repeatable stress test: a report over the event archive, run before and after each deploy.
- G5 mcagents gone from both repos without breaking either build.
- G6 The church crew runs at -108 24 180 after the deploy (handoff step).

## Non-goals and anti-goals

- No disposal machine (lava, cactus) at the base; no hall expansion.
- No fleet-wide, persisted danger map; per bot, in memory, is enough for the evidence.
- No dropping within 48 blocks of the supply chest (bots would pick it up again).
- Never drop anything outside the explicit list; guest bots (MisaBot, EM_Trader) keep their own chest rules.
- No Paper restart. `/var/lib/mcagents*` and `/srv/ollama` data stay (owner 2026-10-15: keep all LLM data).

## Design (architect review, Fable, 2026-11-11)

### Hall caps at the source (G1)
- `storage.js`: `HALL_CAPS` per kind (cobblestone 6912, every other `JUNK` stone 1728, wheat_seeds 1728,
  saplings 1728) and a pure `surplus(name, hallTotals)`. Totals come from the bot's chest index over the
  storage-layout slots.
- `bots.js` deposit: more than 48 blocks from the chest, toss over-cap items first (the `tossJunk` loop,
  keeping `jobWants`, `prefs.keep` and the one pillar stack). The "hall full" fallback never puts over-cap or
  `room` items back into the base chest; the carry-out withdraws a stack only if the hall has room for it.
- A stale index errs toward keeping.

### Keep caps (G1, found while planning)
- bot19 carried 448 sticks, 7 iron pickaxes and 3 crafting tables: every deposit keeps sticks, planks, coal, torches,
  tables, furnaces and all tools. Above a per-bot cap (stick 64, each planks 64, coal 64, torch 64, table 1, furnace 1,
  2 of each tool) they are filed like any other item. The tree farm deposits logs only; when that leaves the bot
  full it makes one plain deposit before failing.

### Death spots (G2)
- Per bot, in memory: death positions of the last 24 h. A death within 32 blocks of an earlier one: no
  grave trip, the interrupted job is not resumed, one alert ("left the grave at X, 2 deaths there").
- Far search treats 64-block boxes around those spots like protected areas.
- The keeper skips a bot while its order hold (`orderRetryAt`) is on.

### Tree farm pause (G3)
- The treefarm job checks the hall's log total against a cap (logs 1728, the same rule as above); over the
  cap it waits (`doing`: enough wood in the hall) instead of chopping, and resumes when it falls below.
  My call: the check runs at the start of each round, not per tree.

### Stress test (G4)
- A pure `summarize(lines)` over `events.jsonl` (and its rotated files) plus a small Node CLI: fails by bot,
  job and message with digits masked, deaths clustered on a 32-block grid, done/fail per bot per day.
  Node only (the lab has no python3).

### Small fixes
- Night shelter: check that the held item is a block right before placing the lid, retry once (combat
  re-equips a sword in between).
- Light job: a spot the server refuses gets a 24 h cooldown.

### mcagents removal (G5), in this order
1. bandit-nix (fresh worktree from origin/main): drop the `mcagents-tests` inherit in `flake.nix` and the
   `"${craft}/mcagents"` import in `hosts/bandit-lab/default.nix` (fix its comment). Works with old and new
   craft. Check: evaluate the lab toplevel drvPath, no full flake check (laptop OOM).
2. bandit-craft: delete `hosts/bandit-lab/services/mcagents/`, `tools/mcagents/`, `ci/mcagents-tests.nix`,
   their `flake.nix` lines, `services.ollama-andy` and its model binding in `ollama/default.nix`; update
   AGENTS.md, README.md, CI and runbook mentions (agent training docs marked historical).
3. bandit-nix: bump the craft lock, evaluate, deploy. Effect on the lab: the `ollama-andy` oneshot goes away.
   Optional later owner step: `docker exec ollama ollama rm andy-4.2` (5.6 GB).

### Church crew (G6, after the deploy)
- bot2 produces the materials into a store chest near the site, bot3, bot20 and bot21 build
  `kirche-hauptplatz.litematic` at -108 24 180, rotation 0. The 2026-11-05 try failed at once because its
  store chest (-37 65 -200) did not exist: the handoff names a real chest first.

## Left to the builder

Exact cap numbers within reason, where the death memory lives in the runner, the report's output format,
and the church's store chest (an existing chest near the site, or one placed by a bot).

## Parked

coal_block crafting for MisaBot's order; EM_Trader needs a chest from Misa ("Als Kiste merken"); llamacpp,
slayer tunnel and `tools/slayer/train` (orphaned after G5, bandit-nix still enables the tunnel); Paper item
despawn rate; the stale project `grave -313 33 37`, zero-block `cleanup-N` schematics and old worktrees
(a list for the owner, the owner deletes).
