# Bot control: the evil wizard and his servants (design)

Status: draft for the owner, 2026-11-06. Built from `2026-11-06-bot-control-design-prompt.md` (the why, the
players, constraints, success and anti-goals live there and are not repeated). Drafted by the architect.
File refs are under `hosts/bandit-lab/services/mcbots/app/` unless stated.

## Decisions

**Owner's** (2026-11-05/06): the owner is an evil wizard and the bots are his servants; Misa does everything
with MisaBot and EM_Trader that the owner can; no commands to learn by heart; orders and watching happen in
game; idle servants look alive in an uncannily quick, bot-like way; they move so well that Misa is impressed;
the owner and Misa set what idle servants do, not Claude.

**Design calls** (architect, open to the owner's veto):
- Extend the Kommandostand (BotUi), do not replace it. Everything asked for already has a job
  (`schematic`, `produce`, `get`, `excavate`, `guard`, ...); what is missing is discoverability, idle
  defaults, alerts and a few survival activities.
- A themed **Zauberstab** item is the one entry point. An LLM that turns plain German into orders comes in
  phase 3, always behind a confirmation dialog.
- Dropped: a task board in the world (duplicates board.js/keeper.js, needs sign parsing); a summoning item
  (it is `goto` to the player's position, folded into the staff); an LLM-first UI (anti-goal); syncing
  Litematica placements (needs a client mod).

Invariants: VALIDATE has the last word (`bots.js:107-339`, `botui-jobs.js` build); the viewer is the Bukkit
player, never a payload field; `resolveBots` (`botui-jobs.js:147-162`) stays the only mapping of
frei/alle/name to bots and rejects foreign bots; guests stay out of keeper, board and help (`config.js:120-127`);
a closed screen never re-opens by itself; one tellraw per viewer and bot per gap (`ingame.js:61-71`).

## 1. Capability map

V = `bots.js` VALIDATE line, J = JOBS line, B = `botui-jobs.js` catalog line, O = `owner.js` grammar.

| Activity | Today | Size | Why | Wanted |
|---|---|---|---|---|
| Build from a plan (Litematica) | `schematic` V277/J3745, B61; chat `bau <name>` O43 | have | the castle is this | daily (next project) |
| Get all materials for a plan | `produce` V298/J3746 with `store`; `get` V300 via acquire.js | have, `produce` not in BotUi | no catalog entry | daily |
| Mine ore / stone | `mine` V116, `shift` V181, `level` V251, `shaft` V232 | have | | daily |
| Chop wood | `chop` V125, `treefarm` V324 | have | | daily |
| Dig a room / clear / terraform down | `excavate` V204, `clear` V213, `seal` V257 | have | 32x32x24 per box (B70-74) | daily |
| Fill / flatten up | none | small-medium | a "fill box with block" blueprint for `build` V270 | weekly (castle grounds) |
| Light an area / spawner | `light` V195 | have | | weekly |
| Carry, deposit, withdraw, count | V129/V186/V187, `tidy` V141, `filechests` V185 | have | | daily |
| Sort items into a warehouse | `storage-layout.js` + `filechests` (owner's hall only) | medium | generic "sort chest A into room B by kind" | weekly (castle warehouse) |
| Craft / smelt / cook | V165/V171, B59-60; raw meat smelts | have | CRAFTS/SMELTS lists short (B23-24), "Oder Name" covers the rest | daily |
| Follow, come, give | V111-113, O28 | have | | weekly |
| Guard / fight | `guard` V115, combat.js | have | | nightly |
| Sleep / spawn point | `bed` V310, `homebed` V315 | have | | once |
| Hunt animals | `hunt` V305 (sheep, cow, pig, chicken) | have | | weekly |
| Breed animals | none | small | `activateEntity` with wheat/seeds, the size of hunt.js | weekly |
| Fish | none | small | mineflayer `bot.fish()` | rare |
| Trade with villagers | `trade` V148 (sticks to emeralds) | medium | "buy X" needs offer parsing | weekly (Misa) |
| Repair (anvil) | none | medium | anvil plugin, needs levels | rare |
| Enchant, brew | none | large | XP, lapis, ingredient chains | rare |
| Explore | far `goto` | medium | safe wandering and return | rare |
| Travel by cart | `cartride.js` (highway internal) | small | expose "fahr nach <Ort>" | rare |
| Boat, nether portal | none | out of reach | no boat control, no cross-dimension path | rare |
| Standing stock (quotas) | keeper.js PLANS 35-82 | have, owner only | guests skipped by design | daily |

## 2. Giving orders: the Zauberstab

A named stick `Zauberstab` (lore line), handed once to each viewer. Right-click opens the Auftrag screen as
Shift+F does today, and the plugin also resolves the aimed-at **entity** (`player.getTargetEntity`), so
`contextJobs()` (B85-100), already the "what can my servants do here" list, grows instead of being replaced.
Left-click opens the Lagebild.

New context rows (German): villager `Handeln`; animal `Jagen`, `Züchten`; water `Angeln`; a player `Folgen`,
`Bewachen`; a bot `Stopp`, `Hierher`, `Wenn frei…`; any block `Hierher rufen` (goto the player: the
"summoning"); chest: the existing rows plus `Sortieren nach…` (phase 2).

- **"Ich brauche X"**: the general `Besorgen` button (`get`, B51), label kept as people say it.
- **`Material für Bauplan`**: new catalog entry for `produce` (schematic, rotation, store chest).
- **Castle-sized order `Bauplan hier`**: one chain `produce` then `schematic`, both validated as today,
  default bot pick `alle`, `chests: [store]`. Progress in the Lagebild from `job.progress` (bots.js:2993).
- **Plain German chat** (phase 3): Andy-4.2 on the lab Ollama turns one sentence into `{type, args}`; the hub
  shows a BotUi confirm dialog (`Ich verstehe: MisaBot holt 64 Eichenstämme. Richtig?`) before anything is
  queued. Only the speaker's bots; never runs unseen.

## 3. Watching and alerts

The Lagebild (`botui-screens.js:90-119`) stays the one place.
- Each bot line gains `wartet auf: …` from `job.t.doing` when it starts with `waiting:`.
- Alerts through `Ingame.say` only to the viewer whose bot it is, one per bot and kind per 10 min: dead;
  stuck (`no progress for`, a second `No path`); missing material (`produce` "no way to get"); finished, for
  jobs over 10 min. Samples: `[MisaBot] steckt fest bei -120 64 30: kein Weg`, `[bot19] fehlt: 64 Steinziegel, wartet`.
- On joining, one digest: `Seit du weg warst: bot2 fertig Bauen Turm, bot3 tot bei …, 2 Bots frei`.
- No alerts for idle bots; the Lagebild count covers them.

## 4. Rights

Keep `INGAME_VIEWERS` (`config.js:139-147`): `fancy8869=*;MidariBread=MisaBot,EM_Trader`. A third player is
`;Name=botX` there plus `botX` in `GUEST_BOTS`. Owner-only stays the `ownerOnly` set (`botui.js:13`: stop all,
keeper, plan, goals). The staff carries no rights; the player's name does. Misa's base stays in
`PROTECTED_AREAS` with her bot named.

## 5. Idle: "Wenn frei"

Per bot an `idle` pref in `prefs.json` (`prefs.js`), set from the bot screen button `Wenn frei: …`: `Nichts`,
`Daueraufträge` (owner's bots; the keeper), `Holz-Schicht in meine Kiste`, `Stein-Schicht`, `Bewachen hier`,
`Baumfarm <Zone>`. Stored as `{key, data}` of a catalog job. A hub loop beside the existing minute sweep
(server.js): a bot idle at least 60 s with a pref and no error in the last 5 min gets `build(key, data)`
queued. Guests may set it for their bots. Players set it; Claude never does.

## 6. Alive while idle

One runner-level idle loop, off during any job, fight or night shelter (`r.sheltered`): look at the nearest
player within 8 blocks (`humanlook`, bots.js:602, today behind `HUMAN_LOOK=1`, soak it first); the owner within
3 blocks gets a bow (sneak 0.5 s); step aside when a player walks into it; every 20-40 s a two-block pace and
back within a 4-block radius, never off a drop, never outside at night, never digging or placing (no
pathfinder calls except the pace, `maxDropDown` 0). Dropped: chat lines, arm swings, wandering (grief and
danger). Theme touches (the bow, eyes on the master) fit the evil wizard's servants.

## 7. Movement

Measured today: `pullbacks` (bots.js:960), `No path` handling (bots.js:1419-1490), `no progress for` stalls.
Add per-bot hourly counters of all three to the status and a Lagebild line.

Targets (main server, 24 h, all helpers): 0 pullbacks per hour; under 2 `No path` per bot-hour; under 1 stall
per bot-hour; no pillar or bridge left outside a job (blocklog.js counts).

Order: (1) counters; (2) diagonals with sprint in the sandbox on a corner course, 30 s soak (parkour spike
script in the 2026-11-05 scratchpad, to be copied into `tools/`), on only at 0 corrections; (3) ladders, vines,
scaffolding and doors: check pathfinder 2.4.5 in a 20-line sandbox run, own moves only if it fails;
(4) swimming: liquid costs, soak in the pool (BOTS.md:531); (5) recovery: keep the WIDER budgets
(bots.js:1423), jump before pillaring.

## 8. Phases

1. **Days**: staff item and entity aim; `produce` and `get` in the catalog; `Wenn frei`; dead, stuck and
   missing alerts plus the join digest; the cheap "alive" part (look, bow, step aside); movement counters; the door, ladder and scaffold sandbox check. Done when Misa gives `Holz-Schicht` to MisaBot with the staff in under
   30 s without help; the owner orders `Bauplan hier` on a test plan and the bots start fetching material;
   each alert kind was seen once in the sandbox; tests in `test/botui-jobs.js`, `test/ingame.js`, `test/prefs.js`.
2. **Castle**: `produce` then `schematic` as one order with `alle`; fill/flatten blueprint; sort job for the
   warehouse. Done when the wizard tower builds from a Litematica file without Claude.
3. **LLM chat** with the confirm dialog; breed, fish, villager trade, cart travel. Done when three test
   sentences become the intended job after confirmation and nothing runs without it.
4. **Movement polish** (diagonals, climbing fixes, swimming) against the targets of section 7; idle pacing
   after the `humanlook` soak.

## 9. Risks

Misa's client must be 1.21.6 or newer for dialogs (unchecked); entity aiming is new Java in a plugin that is a
plain bridge today; `humanlook` was parked because its scenarios were unverified; idle pacing near a build can
clash with reserved blocks (use `runner.reserved`); a castle `produce` may need thousands of smelts and show
`wartet` for hours; alert rate limits live in memory and repeat once after a hub restart.

## 10. Settled after the builder check (Claude's calls unless marked)

1. **Dialogs on Misa's client.** The server is 26.2, so any client that joins natively has dialogs (1.21.6+);
   only a much older client through ViaVersion would not. Phase 1 starts with a one-dialog test on her client;
   if it fails, her entry point is the existing `/bots` CommandPanels menu with the same catalog. The staff's
   right-click is a Bukkit `PlayerInteractEvent` and `getTargetEntity`, both plain Paper API.
2. **Who gets a bot, in this order**: a running job; the owner's order (standing order); its project (resumes
   by itself, 2026-11-05); a board slice; the keeper; the `Wenn frei` pref last. `build(key, data)` and VALIDATE
   run again at every requeue, so stale zones, chests or rights fail as a normal order fails. A failed idle
   job waits like an owner order (`orderRetryAt`, 5 min, growing to 20 min after "gave up") and never runs during a
   death hold or night shelter. `Daueraufträge` stays the keeper (owner's bots only), not a second path.
3. **`Bauplan hier`** (phase 2) is no new job type: the hub queues `produce` on one bot and `schematic` on the
   chosen others with the same args and one store chest, exactly as the church crew ran on 2026-11-04/05.
   `schematic` already shares cells between crew members and both resume as projects after a restart. The
   store chest is a pick in the dialog (default: the player's own chest pref, else the supply chest for the
   owner). Partial material shows as `wartet auf` and the missing-material alert; cancel is the bot's Stopp.
4. **Plans** come from the hub's schematics folder, listed in the dialog (already there, B61). "Hier" is the
   aimed-at block or the player's position (the existing `where` input).
   **Upload from in game, no mods (owner 2026-11-06, phase 1):** vanilla Minecraft cannot send files, so a
   `Bauplan hochladen` button (staff screen and `/bots`) gives the player a click: a dialog `open_url` action
   or a tellraw link to a small upload page on the hub, with a one-time token bound to that player (10 min,
   one use). The browser opens, the player picks the `.litematic`, the hub checks it with `parseLitematic`
   (as `POST /api/schematic` does), stores it under the player's name (`midaribread-<name>.litematic`) and
   tells them in game that it is ready. Each player's plan list shows their own plans plus shared ones; only
   the owner's plans and shared ones reach the owner's bots' lists by default. Misa reaches the lab over the
   tailnet already (her connection comes from a 100.x address); the tailnet policy must let her node reach
   the upload page's port and nothing else of the dashboard. Size cap: 2 MB per file, 50 files per player.
5. **Alive and movement earlier** (the owner stressed both): phase 1 gets the cheap part of section 6 (look
   at a near player, the bow, step aside; no pacing) and the door/ladder/scaffold sandbox check of section 7;
   counters move to phase 1 too, so phase 4 has a baseline. Pacing and diagonals stay in phase 4.
6. **LLM (phase 3)**: emits only catalog jobs, for the speaker's bots, through the same `build()` path, so it
   can never do what the speaker's dialog cannot. German item names go through the catalog's name table plus
   the model; unknown names are asked back, never guessed. Model and GPU budget are picked in the phase 3
   plan (Andy-4.2 is a candidate, not a decision).
7. **Alerts**: "his" bots = the viewer's `INGAME_VIEWERS` list; the digest covers the time since the
   viewer's last quit (kept in the hub state file), one message of at most 6 lines; after a hub restart an
   alert may repeat once (accepted). Idle steps never enter `runner.reserved` cells.
8. **The staff**: a stick with a plugin-checked item tag. A viewer takes a new one from the `/bots` menu at any
   time; a non-viewer using one gets nothing; it drops on death like any item. It carries no rights.

## 11. Left to the builder

Exact German labels beyond the samples, the staff's look, digest wording, the counters' storage, test layout.
