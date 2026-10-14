# Schematic builds: the bots gather, craft and build the owner's Litematica schematics

Status: owner's goal of 2026-10-13, in progress on branch `bots-schematic`.

## Goal

The owner places a Litematica schematic in the main world. The bots gather every material they can
reach, craft it, store it in a project chest next to the site, and build the schematic there exactly,
redstone included, without the owner's help apart from what bots cannot reach.

First project: `SL_V01` "Multi Item Sorter System" (author ingrid), 14 x 19 x 40, 1775 blocks, almost
all redstone. Placed unrotated at the owner's logout spot in the overworld (the coordinates stay out of
this public repository). The file is a third-party download: it lives in the mcbots state volume
(`schematics/`), never in this public repository.

Owner's decisions (2026-10-13): the bots gather everything they can, the long way (filler items too);
the Nether and End parts come from the owner.

## Bill of materials (sorter)

Blocks: 347 hoppers, 334 chests, 322 stone, 104 comparators, 96 redstone, 90 droppers, 80 powered
rails, 69 observers, 57 activator rails, 43 targets, 42 barrels, 32 composters, 25 repeaters, 23 sticky
pistons, 23 redstone lamps, ... Container contents (filters and fillers): 1160 shears, 5693 snowballs,
147 eggs, 25 iron nuggets, 5 black banners, 2 ferns, 1 powder snow bucket; 1 hopper minecart.

Raw: about 4140 raw iron, 1490 oak logs, 1040 cobblestone, 450 redstone, 84 raw gold, 580 coal, 5 sand.
From the owner: 173 nether quartz, 92 glowstone dust, 23 slime balls, 2 shulker shells.
Needs own work: snowballs (snow), eggs (chickens), wool and black dye (banners), string (dispensers'
bows), wheat (targets' hay bales), fern, powder snow.

## Parts

| Part | State |
| --- | --- |
| `schematic.js`: read .litematic, bill of materials, placement (rotation, mirror), build order | done |
| `recipes.js`: gather/smelt/craft plan from a bill of materials | done |
| `placing.js`: how to click for each block state; checked live by `tools/mcbots-placetest` (347/347) | done |
| `build.js` `schematic` job: clear the site, place in order from material chests, repair, final check | sandbox test running |
| Container contents: chests right after placing, hoppers and droppers at the end | sandbox test running |
| In-game owner orders (`owner.js`, spec 2026-10-12 part 1, first half) | done, not yet live-tested |
| Material production (`produce` job): mining, chopping, smelting and crafting into the project chest | sandbox test passed (small schematic, from an empty chest) |
| Bots on the main server: bot1-3 leave the sandbox, only the owner's in-game orders count, agent orders cannot replace a project job (spec 2026-10-12 step 3, ahead of step 2 for this build) | configured, not shipped |
| Mining and chopping in the main world (owner 2026-10-13): natural blocks anywhere outside the two protected areas; forests are felled and replanted | decided |

## The build job

`schematic {file, origin, rotation, mirror, chests}`: several bots may run it on one site (block claims).
Each loop: (1) the site top down: natural ground, trees and wrong blocks the build placed come out of
cells that are air in the schematic or hold another block; anything else is the owner's and is only
reported; (2) the next cell in build order (bottom up, carrying blocks before attachments, power
sources, observers and pistons last) that has a neighbour to click and whose item is at hand or in a
chest; (3) walk within reach (never into the cell), sneak, turn, click, set delay/mode/note by
right-clicks; (4) a cell of the right block in a wrong state is dug and placed again (3 tries); (5) once
all cells match, a final check of rail shapes and double chests, repairs, done. Material is taken from
the chests in the given order, as much as the next open cells need; missing items are looked for again
every 5 minutes. A bot that only waits for material keeps its job (the producers or the owner fill the
chests; it gave up after 5 minutes before), and an item it carries is never missing.

## What the first sandbox run taught (2026-10-13, three bots, local code)

- The sorter floats: 1522 of 1770 cells had no neighbour to click. Supports: one dirt block against a solid
  neighbour or a pillar from below, only in air cells; one temporary block inside a closed hopper loop
  (30 hoppers); a deferred cell (an observer) is placed early when a comparator must stand on it, never dirt
  under a comparator, rail, wire or torch (they pop off when it goes). Offline simulation: all 1770 cells
  with 44 dirt blocks and 64 deferred cells placed early.
- Layer by layer (lowest open layer and two above), or the crew builds a tower first and then searches
  minutes for a way up. Climbing on dirt in the site's air cells is allowed.
- Clearing: nearest cell with a free side first, drops left lying (50 blocks/min instead of 2-3).
- Chests: a bot reads every chest it opens and shares that with the crew; at most two stacks of a kind.
- A chest with contents is filled before anything goes on top (a solid block keeps it shut), over several
  trips (27 shears are 27 slots).
- Traps: a bot standing on a comparator gets no path (it takes the block out); a walled-in bot may dig
  through plain build blocks; a refused activation used to end the whole process (fixed in guardDigs).
- Full inventories: shears do not stack and count as a tool, so the crew's "make room" deposit kept them;
  three bots each carried 32 for six chests 11 blocks up that they could not reach, had no slot for blocks
  or dirt, and the build stood still at 1098/1770. Making room now stows container contents the trip does
  not need; a fill trip takes dirt first (to climb) and only what fits beside the reserve; a chest out of
  reach three times waits until the end.
- A bot back up its own stair shaft beside the project chest found no free spot for a crafting table: it
  now digs a niche in natural rock beside its feet.
- Night: a creeper killed a bot, it lost its inventory and respawned 3200 blocks away. On the main server
  the crew needs a bed next to the site and light, and the material lost on death has to be gathered again.

## What the second run taught (2026-10-13, the first complete sorter)

- All 1770 cells stood, but dirt from removed supports and rails dug out for repair fell into hoppers and
  went round the machine (dirt in 19 containers, rails in 11): in a sorter that jams the filters. A drop's
  fall path is followed before every dig (through rails, wire, torches); nothing is dug whose drop would come
  to rest in a hopper. Supports over a hopper's fall path are glass (it drops nothing); the pathfinder may
  not put dirt there and climbs and bridges with dirt only (its cobblestone stayed in air cells).
- Rails: a rail takes its shape from the rails beside it when placed and keeps it afterwards; one placed
  later beside it bends it if it has a free end (vanilla RailState, checked with setblock). A wrong rail is
  reshaped (its other-side rails out, temporary rails on its wanted sides, the rail, the others back, the
  temporaries out). The sorter's curves over hoppers (rows of curves pointing into each other) cannot be
  made without power at placement; no cart runs there, so they keep their shape and are reported.
- Containers filled are kept in the state directory (`.filled-*.json`), and a bot looks into a container it
  did not place before fetching its contents: a restart, or bot1 beside bot2-3 in another process, no
  longer sends the crew to every chest with 27 shears.
- Performance: the job read block states some 200 000 times a loop; three bots in one process starved the
  connection and were dropped (keepAliveError). States are cached (block updates keep the cache true) and
  each loop yields once.
- The inventory shows what came out of a chest only once its window is closed: the two-stack cap read 0 and
  one bot took 327 hoppers while the others waited. take() counts what it withdrew.
- Unstick only takes out a low block (a comparator), never a chest the bot merely stands on (it spilled the
  contents). A double slab's second click re-equips; an empty hand skips the cell instead of ending the job.

## What the third run taught (2026-10-14, the end phase)

- A double chest the schematic's region cut in half (a right half at the sorter's z edge, its partner one
  block outside) cannot stand: Minecraft makes it single, the crew dug and placed it three times and the
  final check failed. A half without its partner in the schematic is planned single.
- Hoppers and droppers were filled only after the supports came out: the finished sorter floats, so they had
  no way in, and bots on top of the machine had no way down (nothing of the build may be dug, the drop is too
  high). The crew now fills them as soon as every cell stands, while the supports still give a way; then the
  supports come out, then the final check. A container no bot reaches three times is reported, not waited
  for; missing fill material is waited for like any material.
- Still open: a bot standing on the finished floating build has no way down; the last supports should leave a
  way to the ground or the crew should leave the site before they go. The sandbox filler chests ran out of
  snowballs (the sorter needs 5693).
