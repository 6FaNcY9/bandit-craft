# Castle tree farms (short design)

Owner request 2026-11-15: a farm for every wood type, maybe a TNT farm straight into the sorter, the iron farm too,
then automate whatever can be automated. Why (owner): "just have it, so the bots always have everything to build our
projects; we don't know yet what we'll plan". Belongs to the wizard castle (`2026-11-15-wizard-castle-design.md`).
Placement and code path: architect (Fable) 2026-11-15.

## Goals

- Builders never wait for wood again. Spruce is the wood that is short today: the castle palette uses it, and there is none
  free within 192 blocks of the base.
- The setup grows one wood at a time: a farm is a box plus a chest.

## Non-goals (for now)

- Oak and birch farms. The stock holds 13k oak logs and 5k birch logs, and the birch demolition adds more.
- 2x2 woods (dark oak, pale oak) and mangrove. treefarm does not support them, and there are no saplings.
- Sorter plumbing. The input deck and the west gallery are not built yet.
- The iron link. Later this will be an occasional bot haul of about 2,300 ingots per trip into a depot chest.

## Anti-goals

- No farm inside the walls or on plots A3c (food field) or M1 (TNT plot).
- Trees must not grow into roads or walls.
- No change to how existing tree farms behave: the supply chest, the hall pause and the in-game menu all stay as they are.

## Approaches (owner picked C)

- **A, bot farms only:** cheap, and the code exists. But one bot is tied up per farm, and there is no dark oak.
- **B, TNT machines only:** fully automatic. But each is a redstone build bigger than the sorter, needs owner-only slime
  and quartz, and needs a bone meal machine.
- **C, both:** bot farms now, spruce first. One TNT machine later, for the wood the bots use most.

## Design

- **T1 spruce farm (now):** box x -332..-319, z -55..-42, on the flat terrace north of the gatehouse, outside every wall.
  - 16 trunks on the 3-grid.
  - bot1 runs it as one endless treefarm job. The other bots keep building.
- **Reserved for later woods:**
  - T2: x -351..-338, z -55..-42.
  - T3: x -305..-292, z -55..-42. It has low spots near z -54..-51.
  - A wood gets a box once its saplings exist.
- **Spacing rule:** trunks at least 6 blocks from any planned wall or roof, and 5 clear blocks beside paths.
- **Delivery:** one dedicated depot double chest, not the sorter.
  - Builders and producers already fetch from depot chests.
  - The farm pauses while that chest holds at least 1728 logs (`CHEST_QUOTA`), so the chest is a self-regulating buffer.
  - Later, a haul job moves surplus to the sorter input, and the sorter's log output chests join the jobs' `chests` lists.
- **Code (about 10 lines):** treefarm takes an optional `chest {x,y,z}`, used for:
  - depositing logs,
  - fetching saplings and dirt,
  - the ground height (y0),
  - the pause (`storage.chestAbove` on that chest instead of the hall total).

  Without `chest`, everything behaves as today. The hall pause cannot work for spruce: the hall index counts every
  `*_log` as one kind and already holds 18k.
- **TNT machine (later, its own design):** plot M1 x -290..-277, z 31..44, floor y 110, with the air above it to y 140
  kept free.
  - Bots never path into it.
  - Start only when all of these hold:
    - the sorter roof deck and input are built;
    - an automatic bone meal source exists;
    - 2-3 weeks of depot use show which wood to farm;
    - the owner has a tested litematic and gives slime and quartz.

## Left to the builder

- Which empty depot double chest becomes the farm chest. Pick it from the chest index and use the indexed half.
- Before planting, check what stands in the T1 box today. The map shows a small grey patch around x -330..-326,
  z -49..-45. The phase-0 rule applies: stop at owner builds.
- Watch the first cycle:
  - spruce on the 3-grid,
  - the walk to the depot across the forecourt,
  - shelter holes dug at night.
