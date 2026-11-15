# Thralls' Armoury: gear station in the castle (design)

Date 2026-11-15. Layout by the architect (Fable), decisions by the owner in chat (phone session ee4950e1).
Part of the wizard castle (`2026-11-15-wizard-castle-design.md`, element A3b).

## Intent

Owner: "die haben nie Rüstung und keine guten Waffen". Every bot should **always wear a full iron set**, make it
itself and take it from chests, "aber halt auch nicht verschwenden". Iron is plentiful (the keeper counted 600 ingots
in the base chest, 2026-11-15 22:23). The owner wants a proper place for it in the castle: the wizard's servants hand
in what they carry twice and leave in full iron.

State on 2026-11-15 22:23 (`/api/state`): bot1, bot2, bot3, bot19, bot20, bot21 wear full iron + shield; bot21 has no
sword; every axe is wooden or stone; bot1 carries 3 iron swords and 3 iron pickaxes. MisaBot and EM_Trader wear
nothing: their worker (worker-5) is a guest worker and gets no supply chest, so `ensureGear` and `rearm` never run for
them. MisaBot died at 08:34 and lost everything. Every gear and food trip goes to the base chest -271 66 -214, about
200 blocks from the castle.

## Goals

- A full iron set on every castle bot, kept without anyone clicking: helmet, chestplate, leggings, boots, iron sword,
  iron pickaxe, **iron axe**, shield.
- One place for gear and food, on the crew's daily route: the armoury. After a death, at night, when hungry and in
  `ensureGear`, bots go there.
- No waste: a ready piece is taken before a new one is crafted; duplicates go back and are reissued.
- MisaBot is equipped the same way, automatically.

## Non-goals

- Anything above iron: diamond, netherite, enchanting (owner: "mal immer vollen Eisen-Set").
- EM_Trader: it stands at -24 66 -94, about 300 blocks away, and would walk across the map.
- Moving the base chest. It stays the material store: Home, keeper quotas, deposits of farms, graves and tidy,
  material withdraws and the storage-hall lookup (`planConfig.BASE.chest`) keep using it.
- The rest of the bot quarter (phase 7): low wall, gatehouse, field.

## Anti-goals (failure even if it "works")

- A bot walks to the base chest for gear or food while the armoury has it (only exception: right after a respawn at
  the base, until the beds have moved).
- Iron is crafted into a piece that already lies in an armoury chest, or bots hoard duplicates.
- A bot loses a working piece: nothing worn is replaced by a worse one, melted or dropped.
- A bot that worked before stops getting gear (for example an empty armoury stalls `ensureGear`).
- EM_Trader or another guest bot starts walking to the castle.

## Constraints

- Everything in the castle design doc applies: palette, bot limits (`clear` ≤ 32 x 32 x 24, `schematic` fails after
  300 s without progress), owner items, phase-0 rule (an owner build inside the rectangle stops the module).
- `supplyChest` is set **per worker connection**, not per bot (`hub.js` `chestFor`, `hubclient.js` `applyPolicy`).
  MisaBot and EM_Trader share worker-5, so the guest rule must go by bot name.
- `rearm` opens every chest within 6 blocks of the point it is given; all armoury chests must be inside that radius.
- Deploys are the owner's.

## Decisions

Owner (2026-11-15):
- Full iron set for all bots; no waste.
- A station in the castle where bots drop off and pick up gear, designed into the base plan by Fable.
- **Option C for Misa's bots**: MisaBot takes everything from the armoury automatically, like the owner's bots.
  It costs up to one set of the owner's iron per MisaBot death. EM_Trader stays out.
- The armoury **replaces Barracks 2 (A3b)** and is **built now** as phase 1b, not in phase 7.
- **All gear and food trips go to the armoury**; the base chest is only the material store.
- **The beds move into Barracks 1 (A3a)**, next to the armoury, built right after it (phase 1c). Until then the rearm
  right after a respawn uses the base chest beside the beds; every other trip already goes to the armoury.
- Owner on the open details: "was halt am besten ist", so the calls below are Claude's.

Claude's calls (correctable):
- The iron axe belongs to the set (3 ingots; the set then costs 33 ingots, 8 bots 264).
- Stock target: **2 ready sets** in the Sets and Arms chests; the rest stays ingots in the Iron chest.
- An open 2-high doorway, no door (mobs can walk in; the lit room stops spawns inside). Whether bots open doors was not
  checked.
- A separate gear point (`armoury` place kind) instead of moving the `supply` place (architect, see Non-goals).
- When the armoury lacks something, a bot falls back to the base chest as today, so nothing gets worse than now.
- **MisaBot uses the armoury only near the castle**: within 250 blocks of the gear point (castle work). At Misa's base
  (MidariBread, about 720 blocks away) it behaves as today, so it never walks across the map for gear, the same reason
  EM_Trader is out. Guest bots **skip the hand-back**: Misa's items never go into the owner's chests.

## Layout

| id | name | x1 | z1 | x2 | z2 | floorY | h | note |
|---|---|---|---|---|---|---|---|---|
| A3a | Barracks 1 (bot dormitory) | -333 | -30 | -325 | -20 | 104 | 7 | 9 x 11; the owner's bots' beds (at least 14, `homebed.js` `SLOTS`), phase 1c |
| A3b | Thralls' Armoury (was Barracks 2) | -323 | -30 | -315 | -20 | 104 | 7 | 9 x 11, room 7 x 9; doorway x -315, y 105..106, z -25, facing the main axis A7 (x -313..-311) |

Why here (straight-line estimates from the castle tables, not measured paths): about 8 blocks from the gatehouse
opening A5, 25-30 from tree farms T1/T3, about 40 from T2, about 35 from the depot via the A6 stairs, against
190-240 to the base chest today. The main axis is the only way from the farms to the depot and sorter, so the door is
on the daily route. The rectangle lies outside x -351..-282, z 22..38, so the castle's fixed order does not block it.

One `schematic` job, origin world **-323 104 -30**, size 9 x 8 x 11, generated like `castle/warehouse.js` (new
`castle/armoury.js`, one entry in `castle/make.js` `MODULES`).

| Part | relative cells | Blocks |
|---|---|---|
| Floor | y 0, all | cobblestone |
| Walls | rim, y 1..5 | deepslate bricks mixed with cobbled deepslate; corners polished deepslate |
| Doorway | x 8, y 1..2, z 5 | air |
| Slits | y 3, three per long side, one on the north side | glass (as in the warehouse) |
| Roof | y 6, all | deepslate tiles |
| Merlons | y 7, every second rim cell | stone bricks |
| Light | y 5, hanging at (2,3), (6,3), (2,7), (6,7) | lantern |

Rough count (architect's estimate): 99 cobblestone, about 150 deepslate bricks / cobbled deepslate, 20 polished
deepslate, 99 deepslate tiles, 18 stone bricks, 7 glass, 4 lanterns, 10 chests, 1 crafting table, 1 furnace.

Furniture (world coordinates; double chests are separated by a non-chest cell so they cannot pair wrongly):

| name | world blocks | holds |
|---|---|---|
| **Iron** (the gear point) | -322 105 -26 and -25 | iron ingots, raw iron, coal |
| **Sets** | -322 105 -29 and -28 | ready helmets, chestplates, leggings, boots |
| **Arms** | -322 105 -23 and -22 | swords, axes, pickaxes, shields |
| **Larder** | -320 and -319 105 -29 | food, torches, a few logs |
| **Hand-back** | -321 and -320 105 -21 | duplicates and spares the bots put back |
| Crafting table, furnace | -317 105 -21, -316 105 -21 | for `ensureGear` |

All chests are within 6 blocks of the gear point -322 105 -26 (the farthest, Hand-back, at 5.4), so one `rearm` there
sees all of them, and handed-back gear is reissued without a sorting step.

Phase 0 for this module: no owner blocks in the rectangle; probe the ground (the castle doc says A3 needs "level by
3"); anything above y 104 is cleared first (one `clear`, 9 x 11 x 8), lower ground gets a cobblestone footing.

## Bot behaviour

Works today, once built and stocked: an ordered `rearm -322 105 -26` takes the best armour per slot, sword, axe,
pickaxe, shield, food to 32, 16 torches, a spare pickaxe and 2 logs.

Needed for the automatic behaviour (architect's list, smallest changes):
1. `places.js` `KINDS`: a point kind `armoury`.
2. `server.js` `applyPlaces`: `gearChest = places.first('armoury') || supplyChest`, passed to the runners and the hub.
3. `hub.js` welcome and policy frames, `hubclient.js` `applyPolicy`: carry `gearChest` to the workers; guest workers
   get it only for named castle bots (MisaBot), per bot name, never the supply chest; a guest uses it only within
   250 blocks of the gear point.
4. `bots.js`: `r.gearChest || r.supplyChest` in the respawn rearm, `nightShelter`, `ensureGear` and the food rearm in
   `care`.
5. `bots.js` `ensureGear`: with a gear point and something missing, `rearm` there first, recount, then craft.
6. `bots.js` `rearm`: at the end, put back what is over the keep list into the chest it stands at (rules below);
   not for guest bots.
7. `gear.js` `COST` / `OWNED`: add `iron_axe`, done at iron or better.
8. Restock: the armoury's Iron and Larder chests are refilled from the base chest without the owner, and the Sets and
   Arms chests are kept at 2 ready sets. The keeper today keeps only the supply chest (`keeper.js`); the smallest way
   is left to the builder.
9. `homebed.js` `ROOM` and slot layout: the bed room moves from the storage room under the base chest
   (x -272..-266, y 58, z -213) into A3a; respawn rearm goes to the armoury once a bot's bed is there. Only the
   owner's bots; MisaBot keeps its own spawn.

## Anti-waste rules

| Rule | Status |
|---|---|
| A slot counts as done with any piece; nothing worn is replaced or melted | exists (`gearPlan`) |
| Craft only what is missing, one try per 5 min | exists (`ensureGear`) |
| Take only a better tier than what is held | exists (`rearm`) |
| Gear from the grave comes back and is worn again | exists (`grave` job; AxGraves keeps a grave 24 h) |
| Take a ready piece before crafting a new one | new (change 5) |
| Hand back at each armoury visit: keep 1 sword, 1 axe, 2 pickaxes, 1 shield and the worn armour; drop wooden and stone tools once an iron one of that kind is held | new (change 6) |
| Iron axe in the plan | new (change 7) |
| 2 ready sets in stock, the rest as ingots | new (change 8) |

## Left to the builder

- Exact block placement inside the layout above (slits, merlons, lantern chains) and glass vs. iron bars.
- Whether the `schematic` job places chests in the right pairs, a crafting table and a furnace (test in the sandbox
  first); and whether `crafting.ensureItem` uses the table and furnace standing there.
- How restocking (change 8) is done: a second keeper instance, a transfer plan, or another minimal tool.
- Whether a grave trip should end with a `rearm` at the armoury so the doubled set goes back promptly.
- Bed layout inside A3a, and what happens to the old beds in the storage room.
- Tests for the new rules in `app/test.js`, job order and crew for the build.
