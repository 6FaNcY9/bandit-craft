# Public world: world events (design, 2026-11-10)

Status: written with the owner on 2026-11-10 and approved with the agent's defaults ("do what you
recommend"). The pack is built and tested locally (see "Built so far"); it is not on the server.
Belongs to the public anarchy world (`2026-11-10-public-anarchy-world.md`).

## Intent

The owner wants the public world to stay alive: things that happen by themselves, renew
themselves and give players a reason to meet and fight, "like the Hunger Games, but 2b2t style".
In the owner's words: bosses, dungeons, world and weather events, without anyone having to
install mods.

"2b2t style" was spelled out by the agent and accepted by the owner: no arena, no rules, no
protection, no teleport, no referee. An event is something that happens in the open world; what
the players do with it is their business.

## Goals

- Events start by themselves, at random times and random places inside the border, and are
  announced to everyone with the coordinates and a lead time.
- Four kinds:
  1. **Drop**: a marked chest with valuable loot appears. Whoever leaves with it alive has it.
  2. **Boss**: a strengthened vanilla mob with a name and a boss bar appears with companions and
     drops special loot on the ground.
  3. **Dungeon**: a vanilla structure (a trial chamber, a piece of an ancient city) is placed at
     the spot. The world is fully pre-generated, so structures never appear by themselves any
     more; this is how new ones arrive.
  4. **World and weather**: a thunderstorm with extra lightning near players, a "blood night"
     with more and stronger mobs around every player, a meteor that leaves a crater with rare
     ore (a variant of the drop).
- Dungeons and bosses of our own, not only vanilla's: the agent designs new dungeons as structure
  templates (generated from code, shipped in the datapack) and new bosses as summon definitions.
  The owner sees a picture of each new dungeon and approves it before it joins the rotation.
- What an event leaves behind stays: the dungeon, the crater, the burnt forest. Over the years
  the map fills with the ruins of past events. Nothing is cleaned up.
- Players install nothing by hand. What the server sends by itself is fine (the owner,
  2026-11-10): a server resource pack may give bosses, loot and events their own look and sound.
  It is offered, not required (the agent's call: a forced pack locks out players with unusual
  clients, and those are this server's audience); without it everything still works and looks
  vanilla. The pack needs a public download address, so it arrives with the relay or the site
  and is not part of the first build.

## Non-goals

- A separate arena world or minigame server.
- A shrinking border as in the Hunger Games: the world has one border per dimension and it stays.
- Events that players or supporters can buy, trigger or schedule. Community goals from the
  anarchy design ("border +1,000 for everyone") are a different mechanism.

## Anti-goals

- No event the owner triggers by hand. Events run from the schedule only, the same for
  everyone; a hand-placed boss next to someone's base is operator interference. A console
  command to start one exists for testing and is used on the whitelisted server only.
- No login rewards, streaks that expire, or loot for money. They keep people at the screen in
  the way the anarchy design ruled out (no pressure timers, nothing aimed at children).
- No item that vanilla survival cannot produce. Loot is rare, not impossible: the launch texts
  say "no admin items", and event loot must not make that false.
- No teleport to an event and no protection at it.

## Constraints

- No plugin: the public Paper loads exactly Chunky and SModeration, and that list is a contract
  check. Events are a datapack, which is vanilla. No RCON and no operators: nothing may depend on
  an in-game operator.
- Events must not lag the server (rule 2 applies to the operator too): bounded numbers of mobs,
  lightning bolts and blocks changed per event, and one event at a time.
- An event needs players: none starts on an empty or nearly empty server.
- The rules and the launch texts must name events before the whitelist comes off: that the
  server runs automatic events, that their loot is vanilla, and, if the End is renewed (below),
  that "never reset" does not cover the End's dragon and cities.

## How (decided by the agent, the owner left it open)

- One datapack in the public world, delivered by Nix like the server's other files, with the
  schedule, the random choice of kind and place, the announcement and one function tree per kind.
- Build order: the drop first. It carries the whole mechanism (schedule, random place, forced
  chunk, announcement, marker, clean-up of the marker only) that the other kinds reuse. Then
  boss, weather, dungeon.
- A throwaway spike on a local server is step 0 and a gate: the plan for everything after it is
  written only once it has passed. The design rests on commands nobody has run here: random
  numbers in a datapack, finding a surface position at random coordinates, placing a vanilla
  structure and a template of our own by command into generated terrain, a boss bar bound to a
  summoned mob, loot from a custom loot table, and a way to get a picture of a placed structure
  without a person in the game (a bot with a viewer, or a rendered template). Whatever the spike
  disproves comes back to the owner as a change to this design.
- The datapack runs as the server: its functions have the permission level `/place` and
  `/summon` need. "No operators" means no player holds operator rights; it does not limit the
  datapack.
- Delivery: a nix-minecraft symlink into the world's `datapacks/` directory, renewed on every
  start. The contract check pins the exact list of `symlinks` (the two plugins), so bandit-nix
  `ci/lab-mc-public.nix` is extended on purpose in the same change, naming the datapack.
- Time is game time: the schedule counts ticks while enough players are online, so "two to four
  hours" stretches under lag and does not advance on a quiet server. A datapack cannot read the
  wall clock.
- Places come from a fixed radius in the datapack (inside the 5,000 border, default 4,500), not
  from reading the border.
- Every event has a hard time limit. When it ends, by its own course or by the limit, the
  datapack releases the chunks it forced; on every load it releases whatever a crash left
  forced, from its own record.
- Each event writes one recognisable line to the server log when it starts and when it ends
  (kind, place, outcome), for the dashboard. Event places are public announcements, not player
  positions.
- The console command that starts an event for testing is a rule of procedure, not a technical
  barrier: the console is root in the container, which only the owner is.

## Spike results (2026-11-10, pinned Paper 26.2 build 130, local throwaway server)

Run from the console and from a datapack (`min_format`/`max_format` 107, the server's
`data_major`). All of these work:

- `random value` into a score or storage, and a macro function (`function ... with storage`)
  that takes the coordinates.
- `forceload add` followed in the same function by `positioned over world_surface`: the chest
  landed on the surface block at a random place 2,000 blocks away.
- A chest with a `LootTable` from the datapack, and the same table as a mob's `DeathLootTable`.
- `schedule function ... 60t` for the end of the event; `forceload remove` there released the
  chunk.
- A summoned wither skeleton with `max_health` 300, `attack_damage` and `scale` attributes, a
  custom name, and a custom boss bar whose value follows its `Health`.
- `place template` of a room generated from code (a Python script writing the structure NBT with
  `DataVersion` 4903): its chest and light were where the generator put them.
- `place structure minecraft:trial_chambers`: works once the surrounding chunks are loaded. With
  one forced chunk it answers "That position is not loaded"; with a 12 x 13 chunk area forced it
  generated in about four seconds. Tick time afterwards: 1.1 ms average. The builder forces the
  structure's area, not one chunk, and releases it afterwards.
- `weather thunder`, `time set midnight`, a summoned lightning bolt.
- `say` from a function writes a line to the server log (`[Server] ...`), which is the hook for
  the dashboard. `tick query` from the console prints average and percentile tick times.

Not done in the spike: a picture of a placed structure. The generator prints the room layer by
layer as text, which is enough to review a layout; a rendered image still needs its own attempt
(a bot with a viewer, or a template renderer).

Also learned, for the runbook and the dashboard: the world border is kept per dimension; the
world is one folder with `dimensions/minecraft/<name>` and `players/` inside (no `world_nether`
folder); Chunky takes `world_nether` and `minecraft:the_nether` alike; `respawn_radius 4500` is
accepted (the evenness of the spread is still unproven).

## Built so far (2026-11-10)

The whole pack, `hosts/bandit-lab/services/minecraft-public/events` (namespace `bev`), with six
kinds chosen by weight: supply drop 30, boss 20, dungeon 15, meteor 15, thunderstorm 10, blood
night 10. One event at a time; the gap between events runs down only while the player minimum
is online.

- **Drop**: a chest with the `bev:drop` table on the surface.
- **Boss**: the Ash King (wither skeleton) or the Colossus (ravager), with guards, a boss bar and
  the `bev:boss` table on death. A boss nobody killed stays in the world without its bar.
- **Dungeon**: a tower above ground or a crypt below it, each with two spawners and a chest
  (`bev:dungeon`); the crypt's chest is trapped. Both are templates generated from code by
  `tools/minecraft-public-events/gen.py`, which also prints them layer by layer for review.
- **Meteor**: a crater and a core of obsidian and magma around ancient debris and raw gold.
- **Thunderstorm** and **blood night**: bounded lightning and mob waves near players for the
  event's time.

Changed against the goals above: vanilla structures (trial chambers, ancient city pieces) are
not in the rotation. Placing one needs a 12 x 13 chunk area forced and about four seconds; our
own templates need nine chunks and no measurable time. They can join later as their own kind.

Checks: `tools/minecraft-public-events/test.sh` runs the schedule and every kind from
announcement to end on a throwaway Paper and asserts its trace; it passes. `bot-run.sh` with
`bot.js` plays one supply drop with Mineflayer bots (two bots, flat world: the nearer one empties
the chest about ten seconds after it lands; tick time under 5 ms average).

Not done: the pack is not linked into the server (the nix-minecraft symlink and the matching
change to bandit-nix `ci/lab-mc-public.nix`), no picture of the dungeons beyond the text
layout, no resource pack, and no run on real terrain with real players, so the weights, the
loot and the mob numbers are untested guesses.

## Open, the owner's call

- Renewing the End (the dragon and the end cities' loot) on a schedule, so the End stays worth
  fighting over. It contradicts "the world is never reset" unless the rules say so. Default until
  decided: not built.
- How often events run and how strong the loot is. Defaults until testers have played: one
  event every two to four hours while at least three players are online; drop loot on the level
  of a good end-city chest.

## Left to the builder

- The datapack's layout, the scoreboard objectives, the exact mobs, attributes and loot tables.
- How far from the border and from the world spawn an event may land.
- How the dashboard learns of events (`2026-11-10-public-world-dashboard.md`): a recognisable
  line in the server log is enough.

## Checks when built

- A test that runs each event kind on a local server from the console and asserts its trace
  (the chest and its loot table, the boss and its bar, the placed structure, the weather state),
  and that a second event does not start while one runs.
- `lab-mc-public` passes with the datapack in place, the plugin list unchanged.
- On the whitelisted server: tick time during each kind stays inside the budget the spike set.
