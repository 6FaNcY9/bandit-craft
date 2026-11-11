# Animals and crops: bots tend pens and fields (2026-11-11)

## Why

The owner wants the bots to do everything a normal player can, ordered from the in-game picture menu
"einfach und easy, wie jetzt" (owner 2026-11-11). Order agreed with the owner: 1) the bots-keep-working plan
(`docs/superpowers/plans/2026-11-11-bots-keep-working.md`), 2) this one, 3) brewing and repair, 4) fishing and
exploring, 5) Nether and End. Today the bots farm wheat (`wheatfarm.js`) and trees (`treefarm.js`); no animals,
no other crops.

## Owner decisions (2026-11-11)

1. Orders only through the in-game picture menu (BotUi). No chat or LLM path.
2. Kill for meat: yes. 8 grown animals per kind stay; only the surplus above that is killed. Never babies,
   never named animals.
3. The owner builds the fenced pen with a gate, brings the first 2 animals, and makes the tilled field with
   water. Bots only tend. Bots building pens or catching animals is a later, larger feature.

## Goals

- G1 A bot tends a pen of cows, sheep, pigs and chickens: breeds, shears, collects eggs and drops, culls the
  surplus for meat.
- G2 A bot tends a field of carrots, potatoes, beetroot or sugar cane: harvests ripe crops and replants.
- G3 The owner starts either in 3 menu clicks (plus 2 staff clicks for the corners) the first time, 2 clicks
  after that (saved farm).
- G4 Neither farm fills the storage hall: per-kind hall caps pause the work, as the tree farm pause does.
- G5 `wheatfarm` behaves exactly as today.

## Non-goals and anti-goals

- No water placing, no cane planting, no cooking meat, no staff-click shortcut on an animal or crop (v1).
- No pen building, no catching or leading animals.
- Failure even if it works: an animal pen left open (the herd walks off), a named pet or a baby killed,
  horses/wolves/cats touched, entity lag from an unbounded herd, a farm that stops with an error because food
  or shears ran out, `wheatfarm` changed.

## Design (architect, Fable, 2026-11-11)

### Two jobs, not one
- `animalfarm` and `cropfarm`, both open-ended (run until stopped, resumable, kept over restarts like
  `treefarm`). Animals are entities with cooldowns and killing; crops are a block grid. They share only the
  box and the pause. Not folded into `wheatfarm`: that job feeds the bots (bread, `forFood`) and a crop switch
  through its loop risks the food chain.
- The box comes from the existing two-corner area mode (or a marked area); up to 16 x 16.

### `cropfarm`, each round
- Crop table: carrots and potatoes ripe at age 7, beetroots at age 3.
- Harvest ripe, pick up drops, replant the same crop in the same cell.
- Till wet soil only if a hoe is held (the existing wheat rule). No water placing.
- Sugar cane: dig only the block one above the base, never the base.
- Digging: `digOnly` natural ground plus the box, like `wheatfarm`.
- Reuse: `wheatfarm.js` `scan`, `chooseWork` and `pickups` take a crop table, wheat stays the default.

### `animalfarm`, each round (pen kinds found by census: cow, sheep, pig, chicken)
- Breed while a kind has at least 2 adults, the pen holds fewer than 16 of that kind, and food is at hand.
  Food: cows and sheep wheat, pigs carrot, chickens wheat_seeds (uses the seed surplus). Withdraw 16 food from
  the hall when short. Remember fed animals for 5 minutes.
- Shear woolly adult sheep if shears are held; otherwise craft shears from 2 iron, or skip.
- Pick up eggs and drops inside the box.
- Cull adults above 8 per kind, at most 4 per round, reusing the `hunt.js` engage code.
- Only the four allow-listed kinds, never named animals (`named()` in `hunt.js`), never babies.
- No digging and no pillar-placing on an `animalfarm` walk (a dug fence or floor hole frees the herd).
- Gates: the pathfinder opens fence gates and never closes them. After every crossing of the pen edge the job
  closes open gates on the box border.
- Lag bound: at most 16 animals per kind, 64 per pen.

### Pause and outputs (G4)
- Per kind, like the tree farm pause of plan 1 (Task 3): hall surplus above 0 means skip that crop, or skip
  breed and cull for that animal. Everything skipped: `job.t.doing = 'enough in the hall, waiting'`, sleep 60 s
  guarded, never throw.
- New hall caps of 864 per output kind (eggs 432, they stack to 16): carrot, potato, beetroot, beetroot_seeds,
  sugar_cane, raw beef/porkchop/mutton/chicken, wool, egg, leather, feather. The `farm_food` category has only 5
  chests, so 1728 each would overflow it.
- Outputs go through the injected `deposit` with `only: <item>` to the supply chest, like `treefarm`. Owner
  bots file into the hall, guest bots into their own chest.

### Never throw for a missing input
- No food, shears, seeds or hoe: skip that chore, say so in `job.t.doing`, retry after 5 minutes. A throw would
  start the order loop's backoff.

### Rights
- Pass the protected areas to every scan and target filter; orders go through the existing ground-rights
  check (`ground()` via `api.submit`).

### Menu (G3)
- First time: bot menu, new slot "Tiere & Felder…" (carrot icon) opens a page `farmm`; "Zwei Ecken zeigen" and
  two staff clicks, or "Markierter Bereich"; one picture starts it: Tiere (wheat icon), Karotten, Kartoffeln,
  Rote Bete, Zuckerrohr.
- Own page, not the existing Bereich page: there "Abbauen (Bereich)" would sit next to "Karotten", and one
  mis-click digs up the pen.
- Repeat: the box is saved as a place (`pen` or `field`); `farmm` shows saved farms as pictures (2 clicks).
- "Wenn frei" (idle) choices "Tiere" and "Feld" with `zone: 'first'`, like the tree farm's.
- Stop and Weiter work as today. Menus are hub-rendered; `BotUi.java` should need no change.

## Builds on

Plan 1 lands first: `storage.surplus`, `hallTotals`, `HALL_CAPS` (Task 2) and the tree farm pause (Task 3).
Base branch: `fix/bots-2026-11-11` (worktree `~/src/bandit-craft-bots11`) once plan 1's tasks are committed.

## Builder's calls (settled after the builder check, 2026-11-11)

- Census: an animal counts when its position is inside the box, edges included.
- Leads: if mineflayer does not expose leashed animals, the owner-facing rule is "Haustiere mit Namensschild
  schützen" (named animals are never touched), written in BOTS.md and the menu lore.
- Gates: at job start the bot notes the fence gates on the box border that are closed; after a crossing it
  closes those of them that are open. A gate the owner left open stays open. A failed close is retried on the
  next round, never fatal.
- Saved farms: `pen` and `field` become new `ZONE_KINDS` in `places.js`; the place stores the job args,
  including the crop, so a repeat is 2 clicks with no crop question. Guest ground rights for the new job types
  follow `wheatfarm`'s rule.
- Hall routing: the existing layout, no new chests. Crops and raw meat file to `farm_food`, wool to `build`,
  egg, feather and leather to `mobs` (`storage-layout.js` `categoryOf`). The 864 caps apply to that layout.
- "Wenn frei" without a saved farm of that kind refuses silently, like the tree farm's.
- Replanting: from the harvest drops (carrots, potatoes, beetroot seeds); none left: withdraw from the hall,
  else skip that cell and retry in 5 minutes.

## Left to the builder

The exact menu icons and slot (slot 9 suggested), how saved farms are named, the gate-closing method, and
how the sheared flag is read for the server version (check before building: mineflayer entity metadata).
Unverified, cheapest checks: whether mineflayer exposes leashed animals (if not, the rule is "name-tag your
pets"), whether `ground()` reads `x1..z2` generically for new job types.

## Parked

Water placing, cane planting, cooking meat, bots building pens and catching animals.
