# Wizard castle around the sorter (design)

Date 2026-11-15. Layout by the architect (Fable), option A picked by the owner in the visual companion.
Map overlay of all options: `options.py` (session scratchpad) over BlueMap tiles; coordinates below are the
source of truth.

## Intent

The owner is an **evil wizard** and the bots are his servants. Around the finished item sorter on the hilltop
(-308..-295 / 11..50) a compact castle should grow: a thick, beautiful living tower for the owner, a warehouse
on the other side, the sorter fully clad, room for one or two more redstone machines, farms and a trading
hall, a bot quarter behind a smaller wall, and one outer castle wall around everything. "Not too big, but big
enough for everything." Everything as modular as possible. (Owner, 2026-11-05 and 2026-11-15.)

The bots build it themselves from schematics; Claude designs the modules, orders and supervises the jobs.

## Goals

- The look from outside: one dark castle on the hill, the purple-black wizard tower as the eye-catcher.
- Every part is one module the bots can build as a `schematic` job without help.
- The owner's items are never lost: the 71 owner chests, 6 shulkers, the ender chest and the protected
  chest hall survive every step.

## Non-goals

- Interiors beyond what a module needs to work (warehouse chests, tower floors and stairs, doors).
- The redstone machines, farms and trading hall themselves: this design only reserves their plots.
- New bot features, except where a phase below says a tool is missing.

## Anti-goals (failure even if it "works")

- Any owner item destroyed or dropped, any block of the sorter changed.
- Huge terrain scars: deep cuts, floating fills, cleared forest beyond the castle box.
- Owner-only materials (quartz, glowstone, slime, prismarine, nether/end blocks) required for a module.
- A castle so big that the bots work on it for weeks without anything finished: each phase must end in
  something visibly done.

## Constraints

- **Sorter**: x -308..-295, z 11..50, y 111..129 stays untouched. No `clear` box may overlap it. The shell keeps
  one block of air to it and leaves every input/output/chest face open.
- **Sorter cart**: the hopper minecart tagged `sortcart` needs the `sortcart` data pack
  (`hosts/bandit-lab/services/minecraft/datapacks/`), since `minecart_improvements` stops its two drop-throughs.
  Its chunks must be loaded while it runs. Farm lines end in the 5 input chests or the hoppers -303 124 20/21, never on
  the cart loop. After a rebuild the cart is summoned and tagged by RCON (schematics drop entities).
- **Sorter access** (read from `sorter.litematic`, origin -308 111 11):
  - Output: 137 double chests at x -308/-307, y 116..120, z 11..50, opened from the west (x -309). The shell's west
    side is therefore a covered **chest gallery**: floor y 115, 3 wide (x -311..-309); the shell's west wall moves
    to x -313..-312 and A8 becomes this gallery.
  - Input (corrected 2026-11-15, `2026-11-15-sorter-flow-design.md`): the inbox double chest -308/-307 117 12 (loose
    items) and -308/-307 117 11 (shulker boxes), both on the west gallery face. The 5 double chests x -306/-305,
    y 121, z 14..18 are hand-out chests of box loaders, not inputs; they and the box unloader x -304..-303,
    y 124..125, z 20..22 are reached from the sorter's top. The shell roof covers a walkable top deck with stairs
    from the forecourt.
  - South: a stone button at -302 121 50, pressed from z 51: a platform at y 120 there.
  - North: hoppers, dropper and dispenser at z 11: keep the air gap, no door. East: nothing to reach (x -296/-295
    hold 2 blocks each); the tower door at x -291 z 21 is fine.
  - The ender chest at -295 118 22 is in free space, not a sorter block.
- **Depot** (17 double chests, x -303..-299, y 110..113, z 6..7) stays where it is, just outside the shell's north face.
- **Protected chest hall** x -351..-316, y 105..116, z 32..40 and the 71 owner chests (x -349..-284, z 22..38,
  y 112..120): untouched until every item has moved into the new warehouse.
- **Order is fixed**: warehouse → move chests + shulkers → birch demolition → anything else in x -351..-282, z 22..38.
- **Birch demolition** (owner OK, remains x -312..-282, z 16..29, y 116..120) as two clear boxes that avoid the
  sorter: west x -312..-310, east x -293..-282, both z 16..29. Owner's ender chest at -295 118 22 is moved
  (RCON `clone … move`) into the tower once its top floor exists; until then it stays.
- **Bot limits**: one `clear` order ≤ 32 x 32 x 24; a `schematic` job fails after 300 s without progress;
  builders without `clearAll` leave foreign blocks and report them; scaffold dirt next to redstone conducts power.
- **Deploys** are the owner's; new schematics reach the lab by the dashboard upload (≤ 2 MB per file).

## Approaches

Three layouts were drawn on the real height map (architect, 2026-11-15). Common to all: warehouse north-west,
sorter shell, core wall. They differ in where the tower stands.

| | Tower | Trade-off | |
|---|---|---|---|
| **A "Bergfried Ost"** | on the east knoll where the birch house stood | matches the owner's words (house where the wood house was, warehouse opposite, bots in front behind a smaller wall); highest ground, cliff behind it, no pit work; smallest (≈ 64 x 89) | **picked** |
| B "Torturm Nord" | in front of the sorter | quickest, tower needs no demolition, but it blocks the forecourt and the bot yard is tiny | rejected |
| C "Grubenturm West" | rising out of pit 1 | most dramatic, but largest (≈ 86 x 89), ~30 hidden levels in a pit known only from the surface map, next to the protected chests | rejected |

## Layout (option A)

Rectangles are inclusive world coordinates. `floorY` is the floor block (you stand on floorY+1); `h` is blocks
above the floor including the roof. Heights come from BlueMap surface data (trees and ruins included), so floors
on the east knoll may be off by a few blocks until probed.

### Core (identical in every option)

| id | name | x1 | z1 | x2 | z2 | floorY | h | note |
|---|---|---|---|---|---|---|---|---|
| K1 | Sorter shell | -313 | 8 | -292 | 53 | 109 | 26 | 2-thick wall + 1 air (west: chest gallery, see Sorter access); ridge roof to y 135; south face needs buttress footing from y 94; panels z 16..29 only after birch demolition |
| K2 | Warehouse (Lager) | -333 | -11 | -315 | 6 | 109 | 20 | 19 x 18, 3 storeys, ≈ 200 double chests; ground 109-110, no levelling; **built first** |
| K3 | Forecourt (keep free) | -310 | -11 | -292 | 7 | 109 | 0 | depot stays |
| K4 | Trading hall | -291 | -11 | -285 | 7 | 108 | 7 | 7 x 19 corridor; level 105-110 |
| K5a | Core wall N | -337 | -15 | -282 | -13 | 109 | 10 | ground 97-109; NE footing ≈ 10 |
| K5b | Core wall W | -337 | -15 | -335 | 10 | 109 | 10 | |
| K5c | Pit rim N | -337 | 8 | -316 | 10 | 109 | 10 | |
| K5d | Pit rim W | -318 | 10 | -316 | 31 | 109 | 10 | late (after chest move) |
| K5e | Wall SW | -318 | 41 | -316 | 50 | 109 | 10 | late; the hall closes z 32..40 meanwhile |
| K5f | Wall SW2 | -318 | 48 | -312 | 50 | 109 | 10 | joins the shell |
| K5g | Wall E-north | -284 | -15 | -282 | 10 | 109 | 10 | |
| K5h | Wall E-bend | -282 | 8 | -274 | 10 | 111 | 10 | |
| K5i | Wall E-south | -276 | 10 | -274 | 48 | 111 | 10 | the tower replaces z 13..29 |
| K5j | Wall S-east | -291 | 46 | -274 | 48 | 109 | 10 | joins the shell |
| K6 | Pit 1 | -339 | 12 | -319 | 30 | – | – | dry moat (see decisions) |
| K7 | Chest hall | -351 | 32 | -316 | 40 | 105 | 11 | protected, keep |

Core wall: 3 thick, wall-walk at +8. Turrets 7 x 7 x 16 centred on (-336,-14), (-283,-14), (-336,9), (-317,9),
(-275,9), (-275,47).

### Option A elements

| id | name | x1 | z1 | x2 | z2 | floorY | h | note |
|---|---|---|---|---|---|---|---|---|
| A1 | Wizard tower | -290 | 13 | -274 | 29 | 113 | 54 | 17 x 17, walls to y 152, spire to 167; sits on the curtain; rock plinth ≤ 10 on the east edge; door to the shell at x -291 z 21; needs birch demolition |
| A2 | Machine plot M1 | -290 | 31 | -277 | 44 | 110 | 0 | 14 x 14; cut the knoll 1-6, fill one hole |
| A3 | Bot forecourt (Vorburg) | -334 | -32 | -295 | -16 | 104 | 0 | 40 x 17; level by 3, NE corner fill 6-10 |
| A3a | Barracks 1 | -333 | -30 | -325 | -20 | 104 | 7 | 9 x 11 |
| A3b | Barracks 2 | -323 | -30 | -315 | -20 | 104 | 7 | 9 x 11 |
| A3c | Field / farm | -309 | -31 | -296 | -18 | 104 | 0 | 14 x 14 |
| A4a | Outer low wall W | -337 | -35 | -336 | -16 | 104 | 6 | 2 thick |
| A4b | Outer low wall N | -337 | -35 | -292 | -34 | 104 | 6 | ground 94-104 |
| A4c | Outer low wall E | -293 | -35 | -292 | -16 | 104 | 6 | |
| A5 | Gatehouse | -317 | -37 | -307 | -32 | 104 | 12 | opening x -313..-311 |
| A6 | Inner gate | -313 | -15 | -311 | -13 | 109 | 10 | stairs 104 → 109 at z -20..-16 |
| A7 | Main axis path | -313 | -32 | -311 | 7 | – | – | 3 wide |
| A8 | Sorter path | -314 | 8 | -312 | 31 | 109 | – | |
| A9 | Tower path | -291 | 8 | -286 | 12 | 111 | – | |
| T1 | Spruce tree farm | -332 | -55 | -319 | -42 | 95 | – | outside the walls, bot1 `treefarm` with its own depot chest (`2026-11-15-castle-tree-farms-design.md`) |
| T2 | Birch tree farm | -351 | -55 | -338 | -42 | 95 | – | bot19, chest -299 112 6 |
| T3 | Jungle tree farm | -305 | -55 | -292 | -42 | 95 | – | bot20, chest -303 112 6; low spots y 85-87 near z -54..-51 are not planted (13 of 16 cells) |
| T4 | Acacia tree farm | -362 | -37 | -343 | -18 | 92-106 | – | bot21, chest -302 112 6; trunks x -358/-352/-346 × z -33/-27/-21, other grid cells are stone_bricks |
| T5 | Cherry tree farm | -371 | -12 | -348 | 11 | 103-112 | – | bot2, chest -301 112 6; trunks x -364/-355 × z -5/4, other grid cells are stone_bricks |

A2/M1 also keeps the air above it free up to y 140 (later TNT tree machine: no roof, bridge or wall-walk across it,
and a free corridor from its west edge to the shell at x -292).

The architect's "outer castle wall" of the owner's words is A4 (low wall around the bot quarter) plus the core
wall K5; the bot quarter sits between them.

## Material palette

| Part | Blocks | Source |
|---|---|---|
| Main wall | cobbled deepslate mixed with deepslate bricks; lowest 2-3 rows and footings cobblestone | bots |
| Trim | polished deepslate bands; stone bricks at corners and merlons; a few cracked bricks | bots |
| Roof | deepslate tile stairs and slabs (spire, shell ridge); spruce beams underneath | bots |
| Timber | stripped spruce logs, spruce trapdoors and fences; oak only for floors inside | bots |
| Windows | narrow slits with glass panes and iron bars | bots (iron farm) |
| Light | lanterns on chains, torches, campfires on the battlements | bots |
| Optional 1 | soul lanterns and soul campfires (blue fire) | owner only |
| Optional 2 | beacon with purple glass in the tower top, or a blackstone crown | owner only |

## Phases (each ends with something finished)

0. **Checks** (no building): walk the four sorter faces (air gap, openings); confirm the warehouse plot
   x -333..-315, z -11..6 holds no owner blocks; identify the tall structure at x -327..-316, z 24..28 (y up to 140);
   probe the ground under the birch remains after demolition.
1. **Warehouse K2.**
2. **Chest move**: all 71 owner chests + 6 shulkers + the ender chest into K2 **as they are** (same contents,
   same order; owner 2026-11-15), item counts compared before/after.
3. **Birch demolition** (two boxes, above), then probe the ground.
4. **Sorter shell K1.**
5. **Wizard tower A1** (stacked jobs) + tower path A9; move the ender chest in.
6. **Core wall K5 + turrets.**
7. **Bot quarter**: A3 levelling, A4 low wall, A5 gatehouse, A6 inner gate, barracks, field, paths.
8. **Later, by owner decision**: pit 1, the chest hall, M1, trading hall K4.

## Decisions

Owner:
- Option A (2026-11-15, companion click + "ja das was du empfiehlst").
- The owner chests move 1:1 into the warehouse, not through the sorter (2026-11-15).
- MisaBot works on the castle too (2026-11-15).
- Evil-wizard theme, bots as servants; birch house may be demolished; modular; not too big (2026-11-05).

Claude's calls (correctable):
- **Pit 1 stays a dry moat** until the owner wants a machine cellar there; nothing in phases 1-7 depends on it.
- **Chest hall**: kept until phase 2 is verified; demolish vs. keep as an undercroft is asked then (phase 8).
- **Core first, bot quarter last** (phase 7), so the castle looks finished from the sorter side early.
- **Wall kit**: one 16 x 3 x 10 segment, one 7 x 7 x 16 turret, one 11 x 6 x 12 gatehouse; segment lengths snap
  to 8 or 16; footings are a variable fill below. Larger modules (shell, tower) split into ≤ 32 x 32 x 24 jobs.
- Schematics are generated by a script with `app/litematic-write.js` and uploaded via the dashboard.
- **Owner items move by RCON** `clone … move` (lossless, keeps contents and order); bots never carry them. The
  ender chest moves with them in phase 2 into the warehouse (its contents belong to the player, not the block).
- **Phase-0 rule**: an owner build inside a planned rectangle stops that module; the owner gets a picture and
  decides. Nothing owner-built is dug.
- **Crew**: the sorter crew (bot2, bot3, bot19, bot20, bot21) plus MisaBot (owner, 2026-11-15); food and
  production keep priority; no deadline.
- **Palette**: plain spruce logs instead of stripped ones (the bots cannot strip logs); deepslate stays on every
  visible face, no grey fallback without asking.

## Left to the builder

- Exact module geometry (merlons, windows, stairs, roof shapes) inside the rectangles and palette above.
- Block counts per module and the material run before each phase.
- How the chest move is done with today's jobs (`filechests`, `storage-layout.js`) or what minimal tool is missing.
- Job order inside a phase, crew size, scaffold handling near redstone.
