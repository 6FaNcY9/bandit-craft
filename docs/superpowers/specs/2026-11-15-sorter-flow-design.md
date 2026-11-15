# Sorter flow: farms to sorter to builders (design)

Approved by the owner 2026-11-15 ("passt", visual companion screen `sorter-fluss.html`). Design by the architect (Fable)
from the schematic and live tests; builds on `2026-11-15-wizard-castle-design.md` and
`2026-11-15-castle-tree-farms-design.md`.

## Intent

The owner's goal: farms feed the sorter, the bots always have what they build with, the rest gets automated. The sorter
(origin -308 111 11) now runs under `minecart_improvements` with the `sortcart` data pack (22 + 4 laps tested) and sorts
by slice: a slice's types are single sample items in its east chest (one oak_log in -297 122 25 sent 63 of 63 logs to
-308 116 25).

## Goals, non-goals, anti-goals

- Goal: new surplus and by-products land sorted, one kind per slice; builders draw from the slices.
- Non-goal: moving the existing stock into the sorter (iron 77 809 would fill 4.5 slices, cobblestone 2.6, seeds 1.5,
  poppy 1.1). The depot (17 double chests x -303..-299 y110..113 z6..7) stays the builders' store.
- Anti-goal: a full slice. It keeps its intake open, sends its own kind to overflow and can take wrong items once it
  drains; that blocks the chain.

## Facts the design rests on (architect's schematic reading, live where marked)

- Loose-item input ("inbox"): west double chest -308/-307 117 12 → hopper -307 116 12 → -306 116 12 → dropper lift
  -306 z13 → hopper line -303 128 → column -302 z19 → lift -301 z20 → buffer -304/-303 124 22. Untested.
- Shulker-box input: -308/-307 117 11 (boxes are unpacked). Untested.
- The chests -306/-305 121 z14..18 are not inputs (hopper -306 120 z drains them into output column z); the castle
  spec's "Input" line was wrong and is corrected.
- Slices: 20 at z 24..32, 34..36, 38..40, 42..44, 46, 47; each fills 5 double chests x -308/-307 y116..120 (270 stacks),
  bottom chest first, so the top chest y120 is the 80 % mark. z 49/50 are overflow. z 24 is the catch-all for
  unstackables and single items and stays all shears.
- A slice type = one sample (count exactly 1) in one slot of its east chest -298/-297 122 z instead of one shears
  (`item replace`, no comparator there); the shears go to the depot. Never snowball, shears, fern, black banner, egg.
- The launch comparator -305 124 22 reads the buffer's west half: test input must arrive by a hopper or a bot, never by
  an NBT write into -303 124 22 (live).
- Cart throughput ~90 stacks/h; the inbox buffers 54 stacks.

## Slice list

| z | types (one sample each) | flow | must never fill |
|---|---|---|---|
| 47 | spruce_log, stripped_spruce_log, spruce_planks and other spruce parts | T1 surplus | yes |
| 46 | cobbled_deepslate, deepslate, deepslate_bricks, deepslate_tiles, polished_deepslate | mining, crafting | – |
| 44 | birch_log, birch_planks | T2 surplus | yes |
| 43 | stone, stone_bricks, smooth_stone | builders | – |
| 42 | torch, ladder, scaffolding, glass | builders | – |
| 40 | cobblestone | mining by-product | yes |
| 39 | andesite, diorite, granite, tuff, gravel | mining by-product | yes |
| 38 | dirt, sand, sandstone | digging | – |
| 36 | iron_ingot, iron_block, raw_iron | haul on demand only | – |
| 35 | poppy, wheat_seeds, all saplings | farm by-product | yes |
| 34 | raw_copper, coal, charcoal, redstone, lapis, gold, diamond | mining | – |
| 25 | oak_log (set), oak_planks | – | – |
| 26 | wheat, carrot, potato, beetroot, sugar_cane, bread | crop farms | – |
| 27 | meat, leather, feather | animal farm | – |
| 28 | wool (16 colours) | animal farm | – |
| 29 | rotten_flesh, bone, string, gunpowder, arrow, ender_pearl | mob drops | – |
| 30..32 | reserve | – | – |

The build palette sits in the south slices z 42..47: natural ground at x -309 is y115..116 there, so bots may reach
those chests before the K1 gallery exists (old scan; step 1 proves it).

## Approaches

- **Picked: depot stays the store, only surplus into the sorter through the inbox, with a per-slice brake.** Keeps the
  builders' stock where the jobs already look, never fills a slice.
- Rejected: the farm's `chest` argument pointing at the inbox (no brake; it breaks the farm's own withdraws of saplings
  and dirt).
- Rejected: a hopper line from the depot into the sorter (it would empty the builders' stock).
- Rejected: draining sorter outputs into the warehouse (needs hoppers under sorter chests; the castle spec forbids
  changing sorter blocks).

## In-flow and brake

- Bots put items into the inbox -307 117 12 with the existing `deposit {x,y,z,only}`; full stacks only.
- Farms keep handing in at their depot chest (quota 1728 logs); only the surplus above it goes to the inbox.
- Brake: a kind is fed only while the top chest of its slice (-308/-307 120 z) reads empty and fresh.
- Code change (after step 1): `storage.js` gets `SORTER` (inbox position, kind → slice z) and
  `sorterRoom(name, stocks, now)`: true only for a fresh, empty reading of the slice's top chest; unknown or stale
  means no room. The tree farm wiring (`bots.js` makeTreeFarm, `enoughWood`/`deposit`) sends the surplus to
  `SORTER.inbox` while `sorterRoom` holds; the reading is refreshed with the existing `stock` job. Test in
  `app/test/` (stale reading = no room).
- T2 gets its own depot chest (job argument only), so birch no longer shares the spruce farm's `logs` quota.

## Out-flow

- Builders draw from slice chests as ordinary chests named in the castle jobs' `chests` argument, or a bot hauls
  `withdraw` → `deposit only` into the depot. The base supply chest is over 200 blocks away, so castle jobs must name
  the chests.
- Today only z 42..47 are candidates; after the K1 gallery (floor y115) all slices are reachable.

## First step (live, no code)

1. `stock` jobs on -308 116 47 and -308 120 47: proves reach and indexes the chests.
2. Samples: spruce_log in a slot of -297 122 47, birch_log in -297 122 44 (as for z 25).
3. Inbox proof: 64 spruce_log into the inbox; expect them in -308 116 47.
4. Bots build the gallery piece x -311..-309, y115, z 10..13 with steps (the inbox is 6 blocks above ground; bee nest
   at -309 114 12 stays).
5. Haul: `withdraw {item:'spruce_log', count:640, x:-299, y:111, z:6}` then `deposit {x:-307, y:117, z:12,
   only:'spruce_log'}`, only while -308/-307 120 47 are empty.

Pass: 640 spruce_log in the z 47 chests, overflow -308 116 49 unchanged, depot logs at or below 1728, a bot
`withdraw {item:'spruce_log', count:64, x:-308, y:116, z:47}` succeeds, `audit2.js` differs only in the sample slots.

## Risks

- The inbox path and the lift are untested; step 3 settles it.
- Reach at z 42..47 comes from an old scan.
- Crop, animal and mining deposits are not wired to the sorter in this step.
