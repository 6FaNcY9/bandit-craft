# Highway bots: design

Status: draft for the owner's approval, 2026-11-03. Source: the owner's chat of 2026-11-03.

## Intent

Four straight roads run from the world origin to the world border, one in each cardinal direction, and four bots
build them on their own. The model is 2b2t's highways: dead straight, no bends, built by whoever keeps going. The owner
replaces 2b2t's plain stone with the fastest travel the game allows. The roads are a permanent project: the owner
accepts that they may never reach the border. What counts is that they keep growing without anyone looking after them,
and that every finished metre is as fast as it can be.

## Goals

1. A road from `0 0 0` along each of `+x`, `-x`, `+z`, `-z`, at `y 0`, in the overworld, ending at the border.
2. The fastest measured surface the bots can obtain, the same on all four roads.
3. Four bots, one per road, that fetch and craft every material, tool and food themselves from the owner's farms,
   and mine what the farms do not hold.
4. The job never ends by itself before the border: it survives deaths, restarts and deploys and resumes at the
   road's real end.
5. The owner sees metres built, metres per hour, stock and the last problem per road, and can stop and start each road.

## Non-goals

- The Nether. It is the likely next step (one block counts for eight), but the bots cannot cross dimensions today.
- Diagonal roads, side branches, surface roads, stations along the way.
- Changing the world border.
- Shulker box logistics in the first version (see "Supply").
- Blue ice logistics, unless blue ice wins the measurement (see "Surface").

## Anti-goals: failure even if the road gets built

- A bot breaks anything a player built. Bots know no player builds today, so this needs an explicit check.
- A bot takes anything from MidariBread's area or from `GUEST_BOTS` chests.
- The road starves the server: low TPS, a full disk, or backups that no longer fit.
- Cheating the material: no `/give`, `/fill` or `/tp` on the main server for building. The existing rescue of stranded
  bots stays as it is.
- A bend or a sideways step to avoid an obstacle. A road that cannot continue straight stops and reports.

## Decided by the owner

- Roads from x 0, y 0, z 0 in all four cardinal directions, straight, up to the world border.
- Like 2b2t, but with the fastest possible travel instead of stone.
- Overworld first.
- The border stays at its current place, and the job keeps growing even if it never arrives.
- Four bots build it alone and obtain all materials. Every farm counts as a source.

The owner also accepted these as proposed in chat on 2026-11-03: `y 0` taken literally (a tunnel under all buildings),
the surface decided by a sandbox measurement, a raised `max_minecart_speed` applying to every minecart in the world, the
bots `bot2`, `bot3`, `bot20`, `bot21`, and nothing taken from MidariBread's area.

## Facts

World (copy of the final cutover state, 2026-10-31, read from `/srv/containers/minecraft/data`):

- Border size 59999968, centre 0 0, so 29,999,984 blocks in each direction, about 120 million blocks in total.
  The live server's value has not been read yet.
- The `minecart_improvements` experiment is on and the game rule `max_minecart_speed` is 8 (range 1 to 1000). A higher
  value affects every minecart in the world, and the wiki warns that the value is a limit, not a speed reached.
- Boat on blue ice: 72.73 m/s, on ice or packed ice 40 m/s (wiki, not measured here).
- `keep_inventory` is off; deaths leave AxGraves graves.

Farms and stock, overworld, from the same copy (7,514 unopened structure chests left out). Rates are not measured.

| Place | x, z | Main contents | Road use |
| --- | --- | --- | --- |
| Base at spawn | 14, 11 | 18,664 sugar cane, 2,624 bread, 204 rails, 203 powered rails | food, rails |
| Stick farm and hall | -36, -97 | 184,300 sticks, 26,906 bamboo blocks | sticks |
| Iron and mixed | -296, -186 | 157,930 iron, 31,132 cobblestone, 14,486 oak logs | iron, lining, tables |
| Second iron farm | 293, 746 | 28,208 iron | iron |
| Gunpowder | 229, 563 | 1,998 gunpowder | none |
| Storage | -329, 35 | 199 of its chests empty | free space |
| Small stores | -102, -1 and -36, -199 | cobblestone, torches, firework rockets | lining, light |
| MidariBread's area | 160, 420 | 18,719 pumpkins, 2,127 iron blocks | off limits |

World totals: 186,665 iron ingots and 2,248 iron blocks (of which 2,127 blocks are off limits), 185,295 sticks,
759 gold ingots, 846 powered rails, 1,060 rails, 1,620 redstone, 387 redstone torches, 10 diamond and 8 netherite
pickaxes. No blue ice and 637 packed ice in containers. In generated terrain, needing Silk Touch: 115,074 blue ice and
4,953,500 packed ice, the nearest large deposits about 1.1 km out at 640, 912. Farther containers are almost all natural
structures.

The road's level, block by block, within 3 blocks of each axis at `y -3..4`, as far as the world is generated (east 5,000,
west 1,920, south 1,567, north 2,720):

- The column at 0, 0 is untouched: deepslate up to y 3, stone, grass at y 60, air above.
- West, x -53..-47: a player's cobblestone stair crosses the road, two wide (z -1 and 0), with wall torches, leading down to
  a room with beds, chests, an ender chest and signs at y -16 around -50, -18. Road cells hit: one stair block at
  `-49 1 0`. Its neighbour `-50 2 0` is at roof height and can stay.
- North, z -1200..-1400: a trial chamber across the road, about 1,500 blocks of tuff and copper, with barrels and hoppers at
  z -1303. Old mineshafts: north 1400, 1500, 2100; east 400, 1500, 1600, 3800 (planks, fences, rails, cobwebs).
- South: nothing but natural rock, caves and water. The trial chamber at z 192..288 lies below the road, at y < 0.
- Caves and water are common: in the first 400 blocks the west road crosses 277 open cells, the others up to 103.

Bots today (`hosts/bandit-lab/services/mcbots/`, `docs/runbooks/minecraft/BOTS.md`):

- mineflayer 4.39, pathfinder 2.4.5, Paper 26.2. No code for riding minecarts or boats. Walking only, about 4.3 m/s.
- The chosen bots run on the sandbox server: their workers have no `mainServer`, so they get `MC_VHOST = "sandbox.bots"`
  (owner, 2026-10-23: helpers stay there until the board passes). The owner's request now moves these four, once the
  sandbox stages below pass. A worker moves as a whole: `mcbots-worker-2` holds `bot2,bot3`, `mcbots-worker-4` holds
  `bot20,bot21`. They are `BOARD_BOTS`, which keeps the keeper off them; `bot19` stays for the board.
- The sandbox is a copy of the real world, has a console the hub can use (`sandboxConsole`), and has a scenario harness
  (`app/scenario.js`, `scenario-run.js`). A road tested there runs through the same terrain.
- Reusable: `app/highway.js` (`tunnel()` generates a walled tunnel, but one litematic for a whole route, far too large
  here), `schematic` job with `tight` and `anySolid`, `seal` (walls over cave openings), `get` (`app/acquire.js`, sees
  chests only within 256 blocks), `withdraw`, `craft`, `ensureTool`, `upkeep`, `grave`, `homebed`, job resume after a
  restart. A new job type is one entry in `JOBS` and one in `VALIDATE` in `app/bots.js`.
- `PROTECTED_AREAS` are x/z boxes without height. `-80,-144,80,80` covers the origin, so the first stretch of every road
  and the way down lie inside one.
- An open bug makes bots flip between "fight" and "keep away" every 0.5 s (`EM_Trader`, `bot1`, 2026-11-03). It is
  being fixed separately and must be fixed before these bots go to the main server.

Estimates, not measured:

- At `y 0` the rock is mostly deepslate, twice as hard as stone. By formula a block takes 0.75 s with an iron pickaxe,
  0.56 s diamond, 0.5 s netherite. With placing and walking a bot might do 0.3 to 0.6 m/s, so 26 to 52 km a day.
- One direction would then take 2 to 3 years at the very best, supply trips left out.
- All iron outside MidariBread's area gives about 520,000 rails, or 130 km per road, at about 60,000 iron a day for four
  bots: three to four days of stock. After that the farms' real rate sets the pace.
- About 6 MB per km with a bot view distance of 4 (10.8 KB per chunk today, 9 chunks wide), about 1 GB a day. A player
  riding with view distance 10 generates more.

## Design

### Surface: measured, then fixed

Stage 1 measures in the sandbox and decides:

- Rail at `max_minecart_speed` 8, 20, 40, 72, 100, 150, 200, 400 and 1000, each with several powered-rail spacings, on a
  straight run of at least 2 km.
- Boat on blue ice in a walled lane of 2, and a lane with one blue-ice column if a boat holds on it.

Record for each: top sustained speed, material per km, and whether a rider gets kicked, derails, or stops at chunk
borders. The owner rides the two best in the sandbox at the end (an in-game action), because a bot's numbers say
nothing about what a real client can follow.

Rule: the highest speed a real client rides 5 km on generated chunks without a kick, derail or stop wins, even if
materials make the road grow more slowly. The only exception is a surface whose material the bots have no way to obtain
at all. A tie goes to the cheaper material. The owner gets the table and the choice before the job is built.

The rest of this design assumes rail, which I expect to win on materials and possibly on speed. **If blue ice wins, the
job stays the same, but it needs a Silk Touch source and iceberg mining: this design then goes back to the owner.**

### Cross-section

Rail: one wide, two high. Rail at `y 0`, solid floor at `y -1`, solid roof at `y 2`, solid walls at both sides. Natural
rock counts as solid (`anySolid`); anything else solid is left alone only if natural (see "Stops"). Where a side, floor or
roof is air, a fluid or a falling block, the bot lines it with deepslate from its own digging. Mobs cannot spawn in a rail
cell, so the road needs no light and no second lane. Powered rails are spaced as measured, each powered by a redstone
torch in a one-block wall niche, or whatever stage 1 shows to be cheaper.

### Origin

A small chamber at `0 0 0` where the four tunnels start, and a walkable stair up to the surface (three air cells per
step: the pathfinder needs them). The stair's top is the first free column near the origin with no player blocks. The
chamber holds a chest of minecarts and a crafting table. It is the only thing the bots build inside the protected box,
and the protected-area exception for this job applies only at `y <= 6` plus that stair column.

### The job

One new job type, `highway`, with argument `dir` (`east`, `west`, `south`, `north`). `bot2` east, `bot3` west,
`bot20` south, `bot21` north. It works in short segments (a few dozen blocks), each planned from the road's real end:

1. Find the road's end by reading blocks from the saved frontier, not by trusting the file.
2. Inspect the next segment: fluids, caves, falling blocks, anything not natural.
3. Dig, line, lay rail, place powered rails.
4. Save the frontier (`STATE_DIR`), update progress, and repeat until the border or a stop.

Where this can reuse `schematic`, `tunnel()` and `seal` per segment it should. Whether a segment is a generated
schematic or a direct loop is the builder's call, by what the sandbox shows to be fast.

### Supply

No depot in the first version: each bot fetches for itself.

- A load is about 1,920 rails: 720 iron, 120 sticks, some powered rails and torches, spare pickaxes, food. It covers
  about an hour's work.
- Sources are a fixed list of the owner's farms and stores (table above, as Nix config like `TRADE_HALLS`), counted by
  the existing `stock` job. Bots take only what the road needs. Everything else stays where it is.
- With a farm empty, the bot goes to the next one, and with all empty, it waits and reports, or mines (`get`) what can be
  mined. Gold has no farm: only 759 ingots and 846 powered rails exist, so gold may set the pace. Stage 1's numbers decide
  how much this matters; mining gold ore through `get` is the fallback.
- Bots ride their own road back and out. Walking stops working after about 10 km (an hour each way). Riding is new
  code and must be proven in stage 1. Shulker boxes (74 in stock) become worth adding beyond about 100 km one way.
- Pickaxes: best available first, iron made as needed. Deepslate costs about one iron pickaxe per 125 m.
- Waste rock is used for lining, and the rest is thrown away; dropped items vanish after five minutes.

### Stops

The bot inspects each segment before it digs. Three lists decide, all kept with the job:

- Natural: rock, ores, plants, fluids and open air. Dig, line or bridge without a word. A cave is no stop and pages nobody.
- Generated structures: mineshaft wood, rails and cobwebs, trial chamber tuff and copper. Dig what is in the road's cells.
  Chests, barrels, hoppers, spawners, trial spawners and vaults are never dug: the road stops there. The builder checks in
  the sandbox whether the road's cells at z -1303 hit one, and proposes a rule if so.
- Everything else counts as player-built. Any such block within 3 blocks of the segment, or a torch, stops the road.

Known limit: a bare mine with no torch or placed block looks like a cave, and the bot would line it and run rail through
it. Known player mines near a road go into a list of exceptions, as the stair below does.

The road stops, the bot goes home if it can, and the owner gets a phone notification (`ntfy`, as today) when:

- A segment holds a player-built block, or a generated container or spawner in the road's cells.
- It cannot continue straight, three tries in a row at the same place.
- A warden, or sculk shriekers near the road: never fight, retreat through the road and retry after 5 minutes, then stop.

The one exception decided up front is the west stair, see "Open".

Deaths are ordinary: respawn, fetch the grave (`grave`), resume.

### Guards

- TPS below 15 for a minute pauses all roads until it recovers. Chunk generation at four fronts is the expected load. The
  number comes from the bots themselves (world age from the server's time packets against the wall clock), so the hub
  needs no main-server console and no new dependency. It is an estimate, and good enough to pause on.
- Less than 300 GB free stops all roads, from `fs.statfs` on the hub's state volume, which is on the same disk as the world.
- Bot client view distance is reduced to limit generated chunks (the code sets none today).
- The nightly backup and restic are watched, and the owner hears when the world has grown by 50 GB. No backup change now.

### Visibility and control

`GET /api/highway` and a dashboard card per road: metres, metres per hour, stock of each material, current step, last
problem. Start and stop per road. `/bots` shows the job like any other. The owner keeps control with the existing stop
words.

## Stages

Each stage ends with a check, and the next starts only when it passes.

1. **Measure** in the sandbox: the table above, plus a bot boarding and riding a cart. The test runs are built with the
   sandbox console (`fill`), so they use no stock, in a corner away from the board's work; no sandbox reset is needed.
   Stages 2 and 3 use real stock: 8 km costs about 3,000 of the copy's 187,000 iron. Check: the owner has the numbers
   and has ridden the best two.
2. **One road, sandbox.** `bot2` builds east from the chamber for 2 km on the copied world. Check: straight, right
   cross-section, restock from farms, a death, a hub restart and a deploy all survived; no non-natural block touched.
3. **Four roads, sandbox.** All four for 2 km. Check: TPS and disk use within guards, the z -1303 rule works.
4. **Main server, one worker.** Prerequisites: the combat bug fixed, the live border read, the game rule set. Move
   `mcbots-worker-2` with `mainServer = true`. Check: the owner rides the first road. Velocity restarts only if BotGate
   changes; ship when nobody plays.
5. **Main server, all four.** Move `mcbots-worker-4`. Then it runs by itself.

## Open

The west road, on the owner's answer: my proposal is to replace the one stair block at `-49 1 0` and line the road there.
The stair is two wide, so its other half (z -1) stays walkable. The road stays straight and at `y 0`.

## Left to the builder

Segment length and job internals; schematic reuse or a direct loop; how a bot steers a cart (`mount`, `moveVehicle`);
exact stop thresholds; the list of natural blocks; the farm chests within each farm (from `world.chests` and `stock`);
the dashboard card's layout; tests, following `app/test/<topic>.js`, with a fake world first.
