# MisaBot v2: queue, chest, reports, self-supply (2026-11-03)

**Status (2026-11-03): Phase 1 built, not yet deployed.** Phases 2 and 3 are open. See "Phase 1 as built" at the end for the differences from this design.

Source: `~/Downloads/MisaBot-Anforderungen-v2.pdf` (MidariBread, November 2026). Owner decision (chat, 2026-11-03):
the request is hers and the owner's; everything that is not Misa-specific applies to **all bots**. Phase 0
(analysis) is in this document; the build follows the phases below, one shippable step at a time, with
`worker` subagents and the existing `node test.js` harness.

Code base: `hosts/bandit-lab/services/mcbots/app`. Orders enter through `BotRunner.bindOwner` (bots.js) →
`owner.parseOrder` / `owner.translate` (owner.js) → `VALIDATE[type]` → `enqueue`. Replies go through `say`
(2 s gap, 100 chars, German). Jobs run in `JOBS[type]` (bots.js). Per-bot state: `settings.js`
(STATE_DIR/settings.json), roles in owner.js, shared places in `places.js`.

## Phase 0: what exists (per PDF chapter)

| PDF | Status | Where | Verdict |
|---|---|---|---|
| 4.1 status, start/end/reason messages, verbose | partial | `status` receipt (life, food, job, role); done/failed/stopped chat for chat-ordered jobs; `job.progress` free text; ntfy only for the owner | direct |
| 4.2 queue | partial | `this.queue`, `enqueue({replace,first})`, `stop`, `remove <id>` exist for hub/dashboard; **chat orders always replace** (cancel running, drop queue); no chat queue words | direct |
| 4.3 personal chest, deposit on full, keep list | partial | deposit job, supply chest + storage hall (`storage.js`), keeper quotas; full inventory **throws** instead of depositing; no per-bot chest | direct |
| 4.4 trading sticks → emeralds | exists | `trade.js` (fletcher sell loop, sold-out wait), `tradeschedule.js`; no owner order, no stick self-supply, no time/target limit | direct |
| 4.5 idle work | missing | `keeper.js` standing orders are the closest thing | direct, Phase 2 |
| 4.6 `hole <item>` strategies, combat, nether | partial | `hol` = mine/chop only; `combat.js` (defend, retreat, weapon tiers, eat); crafting/smelt exist; **no nether hazard logic** | larger change |
| 4.7 tools, food, furnaces | partial | durability read, auto-eat (`eatBelow`), `smelt`/`craft` jobs; **no tool replacement** | direct |
| 4.8 shulker, large quantities | missing/partial | `hol` max 256, mine/chop validator max 2048; no shulker handling; no 10 % progress | Phase 3 |
| 4.9 LLM | out | redesign spec 2026-10-23: model only for language, not in the loop; solver API exists for the owner's PC | later, separate spec |
| 4.10 elevator | out | nothing | not now; "waypoint with actions" possible later |

Not planned (honest): real redstone understanding (4.10), LLM chat (4.9), villager job assignment (4.4 open
point: no, as the PDF suggests), fletcher hunting across the map (trade stays in a configured hall or the
nearest fletcher within the bot's area).

## Goals / non-goals

Goals: an order is never silently lost; the bot says what it does and why it stopped; long jobs survive a full
inventory, a broken pickaxe and hunger; Misa can give several orders in a row.
Non-goals: dashboard changes beyond what the existing JSON state already shows; new mineflayer plugins
(`mineflayer-tool`, `-pvp`, `-auto-eat`, `-armor-manager` are **not** added: the app already has its own
combat, eat and tool code; adding plugins would duplicate it and break the "nothing kaputt" rule).
Anti-goal: chat spam (owner constraint from v1: no HUD, no noise; ≤ ~15 lines per 10 minutes without
verbose).

## Constraints

- Movement, pathfinding, existing orders and the `misa.js` area rules stay as they are. Every new job that
  digs or places runs through the same protected-area check.
- All replies German, ≤ 100 chars, via `say` (whisper to the person who gave the order; broadcast only when
  the order came from public chat). Owner's rule: nothing on the HUD.
- Each bot keeps its own state (queue, chest, keep list) in `STATE_DIR/<bot>/...` next to `settings.json`.
- Tests: plain Node, `node:assert/strict`, one part per topic under `app/test/`, added to `app/test.js`.
  No Minecraft server in tests; job logic is tested through the fake-bot helpers that `test/jobs/` already uses.
- Order words stay German and in the style of the existing grammar (`hol 64 kohle`), the PDF's English words
  are accepted as aliases where cheap (`status`, `queue`).

## Orders (final grammar, all bots)

Prefix `<bot>` or `alle` in chat; no prefix in whispers. New or changed:

| Order | Meaning |
|---|---|
| `status` | one line: job + progress, queue length, inventory fill %, life, food, chest set or not |
| `laut` / `leise` (`verbose on|off`) | per bot, persisted; `laut` adds progress lines every 10 % |
| `queue` / `liste` | numbered pending jobs (max 5 shown) |
| `queue weg <n>`, `queue erst <n>` | remove / move to front |
| `stopp` | cancel the running job, **queue stays** (today: everything dropped) |
| `alles stopp` / `clear` | cancel and empty the queue |
| `jetzt <order>` | run now: running job goes back to the front, resumed after |
| `hol <n> <item>` | **acquire** by strategy (see 4.6), n ≤ 4096; keeps the old mine/chop fast path |
| `farm <n> <block>` | alias for `hol` for mined blocks (PDF word) |
| `kiste` / `kiste x y z` | this bot's chest = the container the player looks at / at coordinates; persisted |
| `lagern` | deposit everything not on the keep list into the bot's chest now |
| `behalte <n> <item>` / `behalte nichts <item>` | keep list, persisted |
| `handel <item> [1h|<n>]` | trade loop: sticks→emeralds at a fletcher, for a time or until n emeralds |
| `idle an|aus`, `idle <farm,trade,essen>`, `idle hier <r>` | idle behaviour per bot, persisted |

Default for a new order: **append**. Only `jetzt` and the meta orders change the running job. This flips the
current `replace:true` for chat orders; hub/dashboard callers keep their explicit flags.

## Behaviour by phase

### Phase 1: foundation (4.1, 4.2, 4.3, 4.4)

1. **Reports.** Every job emits start (`start: hol 64 kohle`), end (`fertig: 64 kohle, 3 min`) or failure
   with the reason (`abgebrochen: kein Fletcher in Reichweite`). Reasons are the existing throw messages,
   already German. `laut`: progress at 10 % steps, computed from `t.done/total` where a job has a total.
   Nothing per block. The ntfy path is untouched.
2. **Queue words.** Chat orders append. `stopp` cancels only the running job. `jetzt` = `enqueue(first)` plus
   re-queue of the running job with its remaining count (count jobs record `done`; others restart). Queue is
   persisted per bot and reloaded on restart (running job goes back to the front). A failing job reports and
   the next one starts.
3. **Own chest.** `kiste` stores the container block position per bot (`STATE_DIR/<bot>/chest.json`). Inventory
   check in the mine/chop/collect loops (the place that throws today): when ≥ 90 % full, walk to the chest,
   deposit everything except tools, weapons, armour, food and the keep list, walk back, continue the same job.
   Chest full: report, use the next container within 2 blocks of the chest if any, else stop with reason.
   Tools/food never deposited (extend the existing KEEP set). `lagern` is the same routine as an order.
4. **Trade order.** `handel sticks [1h|n]` reuses `trade.js`: sticks come from the bot's chest or the hall's
   stick chests; if none, make them (chop → planks → sticks via the existing `craft` path); find the nearest
   fletcher (`villagerProfession` metadata) inside the bot's area or the configured hall; trade until sold
   out, wait `SOLD_OUT_MS`, switch to another fletcher if one exists, stop with a count after the time or
   target. Emeralds go to the chest via step 3.

Acceptance (from the PDF, used as tests): four orders in a row run in order; a failing job does not block;
`status` within 1 s; full inventory during a mine job deposits and resumes; chest survives a restart;
`handel sticks 1h` ends with an emerald count.

### Phase 2: autonomy (4.5, 4.6, 4.7)

5. **Acquire strategies.** `hol` consults a small table `acquire.js`: item → ordered strategies
   `[chest, mine, chop, craft, smelt, hunt]`. Chest first (own chest, then supply), then the first strategy
   whose preconditions hold. `gunpowder` → `hunt creeper` at night / in dark areas within the bot's area
   (existing `hunt` job). Unknown item with no strategy: `geht nicht: weiss nicht wie man <item> bekommt`.
6. **Nether hazards.** In `combat.js` threat scoring: magma cube, ghast, piglin without gold armour, lava
   proximity. The reaction stays the existing defend/retreat paths; the new part is that these mobs count as
   threats at all and that lava within 3 blocks of the path forces a detour (pathfinder `avoid` blocks).
   Measured by the death log (ntfy death count).
7. **Self-supply.** Tool durability < 10 % → internal `rearm` (existing job) before the next block: craft
   from inventory/chest materials, else report and stop. Food below the existing `eatBelow` already eats;
   add: keep ≥ 8 food items for jobs longer than 10 minutes, fetch from chest when under. Furnace: the
   existing `smelt` job gains "find or place a furnace near the chest, fuel from chest or chop".
8. **Idle.** After `IDLE_AFTER` (default 5 min, per bot) with an empty queue and idle enabled: pick in order
   food < 8 → food; tool worn → rearm; chest stock below keep targets → farm; else the configured idle task
   list, inside `idle hier <r>` around the chest. An incoming order cancels the idle job within one tick
   (idle jobs are ordinary queue jobs flagged `idle:true`, and new orders `first` them out).

### Phase 3: scale (4.8, more trading)

9. Large counts: `hol 1000 redstone` runs as rounds of inventory size, depositing in between, progress at
   10 %. 10. Shulker: `shulker füllen|leeren` — open as container (`openContainer` works on shulker boxes),
   break and carry keeps the contents as item NBT; the bot places it next to the chest. 11. Time-based
   trading rounds via the queue.

## Left to the builder

File split (`queue.js`, `chest.js`, `acquire.js`, `report.js` are suggestions, not requirements), exact
persistence format, how `jetzt` resumes non-count jobs (restart is fine), test fixtures. The help text must
stay ≤ 100 chars: put the new words into a second `hilfe 2` line.

## Phase 1 as built

Where the build differs from the design above:

- Prefs (chest, keep list, verbose) live in one file `STATE_DIR/prefs.json`, not `STATE_DIR/<bot>/chest.json`.
- The queue is not persisted as such (deferred): `keptOf` keeps the running job only if it is a long (`KEEP`) job, plus everything from the first one on, silently (within 5 minutes, `resumeUntil`); shorter orders ahead of them are lost on a worker restart.
- `hilfe` answers one line with the new words only (`HELP2`); the older list (`HELP`) comes with an unknown word.
- The own-chest deposit starts when fewer than 4 slots are free.
- Failure reasons were not already German: about 15 common ones have a table (`owner.germanReason`), rare ones stay English.
- `handel` does not chop when out of sticks (Phase 2, self-supply): it ends with `keine Sticks`.
- `komm`, `folge`, `wache`, `gib` go first, and chat orders go ahead of open-ended and non-chat jobs, which resume after.
- Own deposits also store sticks, coal and torches (`KEEP_RE` does not apply); the bot cannot fetch them back yet.

## Verification

`nix build .#mcbots` (runs `node test.js`), then deploy with the usual craft-bump line and a live check on the
lab with MisaBot: four orders, `status`, a full inventory during `hol 256 stein`, `handel sticks 10`.
