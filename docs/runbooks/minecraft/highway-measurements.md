# Highway surface: measurements and physics

Stage 1 of `docs/specs/2026-11-03-highway-bots-design.md`, measured on the sandbox on 2026-11-04, Paper 26.2 build 130,
with `tools/mcbots-railspeed` (`rig.js`, `run.js`, `ride.js`). A cart with an armour stand on it rode in forced chunks,
so these numbers say what the server's physics can do, **not** what a real client can follow. The owner's ride decides.

## Where the speed comes from

Read from Mojang's 26.2 server code, `NewMinecartBehavior` and `AbstractBoat`, which is no longer obfuscated:

| Effect | Code | Result |
| --- | --- | --- |
| Drag | speed × 0.997 per tick with a rider, × 0.975 empty | an empty cart stops far sooner |
| Rule | speed clamped to `max_minecart_speed / 20`, **before** the boost | top speed is setting + 1.2 m/s |
| Powered rail | +0.06 blocks per tick, at most once per tick | on flat rail 0.06 / 0.003 = 20 blocks per tick, so **400 m/s is the flat limit** at any setting above 400 |
| Slope rail | ±2 % of the speed, at least 0.0078, only the **first** slope rail in a tick counts | a short dip gains going down and is not braked going up |
| Standing start | a rider's input adds 0.001 per tick up to 0.1; a powered rail with a block behind it adds 0.2 | a bot can start itself |
| Boat | thrust 0.04, friction averaged over the blocks under the hull, air not counted | 0.04 / (1 − 0.989) = 72.73 m/s on blue ice, 40 m/s on ice |

Each block of flat rail costs 0.003 blocks per tick, so a booster pays for itself only up to 20 blocks apart. Beyond that,
flat rail settles at a lower speed, as the table shows.

## Flat rail, 2 km lane

Sustained is the median over the last third of the lane, top the highest over a second or more. TPS 19 to 20 in every
row, no derail and no lost cart in any. A cart bounces off a wall at the lane's end and rolls back at full speed.

| Setting | every 2 | every 4 | every 8 | every 16 | every 20 | every 25 | every 38 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 8.8 | 8.3 | | | | | 6.8 |
| 20 | 21.2 | 20.6 | | | | | 19.0 |
| 40 | 41.2 | 40.7 | 40.1 | 40.0 | | | |
| 72 | 73.2 | | | | | | |
| 100 | 101.2 | 101.2 | 100.8 | 68.2 | | | |
| 150 | 151.2 | | | | | | |
| 200 | 201.2 | 201.2 | 176.6 | | | | |
| 400 | 207.3 | 201.7 | | | | | |
| 1000 | 207.6 (top 230) | 202 (top 225) | 174.9 (top 213) | 68.3 (top 81) | 67.6 (top 75) | 40.3 (top 43) | 21.6 (top 23) |

Above 200 the 2 km lane is simply too short for the cart to get any faster. Not every setting was run at every spacing,
because a simulator of the code predicts the rest. Where the setting decides the speed it is at most 0.7 m/s off. Where
the lane's length decides, the measured top is 1 to 5 % under the simulated speed at the lane's end, because a sample every
half second misses the last metres.

The simulator gives the speed at each distance from a 20 m/s start, setting 1000. Nothing here is measured beyond 2 km:

| Booster every | Gold per km | 1 km | 2 km | 5 km | 10 km | 20 km | 50 km |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 250 | 180 | 235 | 313 | 364 | 393 | 400 |
| 8 | 125 | 153 | 221 | 308 | 362 | 392 | 400 |
| 16 | 63 | 55 | 82 | 165 | 276 | 378 | 400 |
| 20 | 50 | 60 | 75 | 109 | 148 | 205 | 343 |
| 25 | 40 | 37 | 42 | 65 | 72 | 73 | 72 |
| 38 | 26 | 20 | 21 | 22 | 22 | 22 | 21 |

## Rail with dips

A dip is two rails one block lower on a floor one lower, down then up, in the flat road. It costs no gold, only one more
dug cell under each of the two rails. The cart stays on the rail through them at every speed measured.

| Setting | Boosters at the start | Dip every | Lane | Result |
| --- | --- | --- | --- | --- |
| 1000 | every 2, 300 blocks | 16 | 2 km | top 298 m/s |
| 1000 | every 4, 300 blocks (75 gold) | 16 | 2 km | top 363 m/s |
| 1000 | every 2, 300 blocks | 16 | 5 km | **top 963 m/s**, 534 at 2.7 km |
| 1000 | every 2, 300 blocks | 32 | 5 km | top 285 m/s, still rising |
| 200 | every 2, 300 blocks | 32 | 5 km | holds 199.9 m/s from 4 km on |
| 400 | every 4, 200 blocks (50 gold) | 8 | 2 km | reaches 400 m/s at about 1.9 km, then the lane ends |

The simulator is too hopeful here: it gives 464 m/s where 298 to 363 were measured at 2 km, and 1,020 for 963 at 5 km.

Limits of this result:

- It relies on an implementation detail of an experimental feature. A later Minecraft version may change it, and a road
  built this way would then be slow until it is rebuilt or given boosters.
- Below a certain speed the dips lose more than they give, about 68 m/s with a dip every 16 blocks by calculation. A cart
  that stops on a dip stretch cannot start again without boosters, so riders need booster stations along the road.
- The game rule then sets the speed, which keeps it at what a client can follow.

## A bot rides the lanes with chunks not forced

The sweep forced its chunks, so it could not show what a player's chunk loading does. A bot is a real player to the server,
so `bot50` rode the 5 km ride lanes on generated chunks, sandbox view distance 8. Each ride includes about 10 s of the bot
starting the cart by input.

| Lane | Setting | Top m/s | Ride | Lowest TPS | Spots under half the top speed |
| --- | --- | --- | --- | --- | --- |
| Boosters every 4 | 200 | 201 | 44 s | 17.9 | none |
| Dips every 16 | 200 | 203 | 44 s | 18.1 | none |
| Dips every 16 | 400 | 270 | 42 s | 18.2 | one, 134 m/s |
| Dips every 16 | 1000 | 340 | 41 s | 17.8 | nine, 117 to 170 m/s |

No kick, no derail. **Setting 1000 saves 3 s over setting 200 on 5 km**: above about 200 m/s the cart keeps catching up with
the chunks, even though it reached 963 m/s with them forced. A rider's real limit here is chunk loading, not the rail. The
main server's view distance of 10 asks for more chunks than this, and new terrain is slower than generated terrain.

Samples were a few ticks apart, so a single speed reading can be 15 % off. The ride times are the firm numbers.

## Against other ways of travelling

From `minecraft.wiki/w/Transportation` unless marked as measured. The 26.2 changelog names no change to these.

| Method | m/s | Why it is or is not a road |
| --- | --- | --- |
| Rail with dips | 963 measured, 200 for a rider | the fastest found, and the rule can cap it |
| Flat rail | 230 measured, 400 calculated, 200 for a rider | needs gold along the whole road |
| Riptide III trident | about 375 at the launch | only in rain or water, in single bursts |
| Water, soul soil, Dolphin's Grace, Speed II, full enchantments | 147 | needs dolphins and potions the whole way |
| Boat on blue ice | 72.73, code matches the wiki, not yet ridden | 1,000 to 2,000 blue ice per km |
| Elytra with rockets | 33.5 | needs no road |

## What can limit a real rider

- **Chunks.** The server's defaults are `player-max-chunk-load-rate` 100 and `player-max-chunk-send-rate` 75 chunks per
  second, read from the 2026-10-31 copy of `paper-global.yml`, and the repo does not override them. The main server has
  view distance 10. Crossing one chunk then needs up to 21 new ones, so past about 57 m/s the client cannot be sent all of
  them and past about 76 m/s the server cannot load them all, closest first. A cart reaching a chunk that is not ticking
  waits for it. Nothing here measured this: the sweep's chunks were forced. The ride lanes free theirs on purpose.
- **Boats** are simulated by the client. 26.2's `handleMoveVehicle` sends a boat back when it moves more than 10 blocks
  beyond its speed in one packet, far above a boat's 3.6 per tick, and that is no kick. A bot cannot drive a boat, because
  mineflayer has no boat physics (read from its code, not tried).
- **Minecarts** are simulated by the server, and `handleMovePlayer` skips its movement checks for a passenger.

## A bot on a cart

Measured with `ride.js` at setting 200 with a booster every 4 blocks, 2 km, chunks not forced:

- `bot.mount(cart)` works, and `bot.moveVehicle(0, 1)` starts a standing cart on plain rail.
- Top 199.5 m/s, TPS 20, no kick, no derail.
- During the ride neither `bot.entity.position` nor `bot.vehicle.position` moves, off by 1,997 blocks at the end. Mineflayer
  ignores the packet that moves carts. The job must ask the server or wait for arrival.
- `bot.dismount()` does nothing: it sends jump. `player_input` with `shift: true` does get the bot off, by the server's
  account, but `bot.vehicle` stays set, so the job must clear it. The position is right again afterwards.

## Material

Stock in the copy of 2026-10-31: 759 gold ingots and 846 powered rails, so 1,605 boosters; 1,620 redstone and 387 redstone
torches. Flat rail with a booster every 20 blocks reaches 32 km on that stock over all four roads. With dips, 75 boosters
per start leave enough for about 21 starts and stations, and the road needs rails only: 375 iron per km.
