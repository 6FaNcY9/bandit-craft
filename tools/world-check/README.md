# world-check

Live checks of the hub's block model (mcbots `worldmodel`) against the real world. Run them from the laptop
after the model is deployed; they prove three things: the model equals the world, it costs no measurable load,
and the architect can see an area no bot has been near.

Plain Node 22, no dependencies. All scripts take `--hub URL` (default `https://bandit-lab.tail7facc9.ts.net:8445`);
the hub's `tailscale serve` supplies the login, nothing else is sent.

Exit codes: `0` pass, `1` differences or limits broken, `2` cannot run (hub unreachable, model off or still
importing, bad arguments), `3` passed but steps were skipped.

## equality.js

```
node tools/world-check/equality.js                       # static only, exit 3 (scripted and bot skipped)
node tools/world-check/equality.js --spot X,Y,Z --bot bot10 --bot-spot X,Y,Z
```

1. Needs `plugin.importLeft === 0` (the first import is done), else exit 2.
2. Static: 500 random cells of the whole area (0 cells compared is exit 2), compared section by section; on a difference it waits 5 s, reads both
   again with the same seed, and prints the first 20 that are left (exit 1).
3. Scripted, only with `--spot`: **writes blocks and summons TNT in the REAL world** (console commands through
   `/api/admin/action`). **Owner OK first; pick a spot far from builds, high in the air (around y 280).** The TNT
   blast can reach about 9 blocks from the spot. Before anything is written the spot +-10 must be inside the model's
   area, all known and all air in the model, and a real-world sample of it (2000 cells) must hold only air, else
   exit 2 (the model alone is not trusted to guard a write; the sample is random, so it is a check, not a proof).
   The spot's chunks must be loaded (a player or bot nearby), else `fill` answers "not loaded" and the run exits 2;
   so does any other refusal of fill, setblock or summon.
   Steps: basin, sticky piston, water, water away, TNT, clean-up; after each one it waits 5 s and compares 2000
   random cells of the spot +-6 (the plugin's maximum: 500 would miss a 4-cell change most of the time), then reads one
   cell from the model that the step must have changed (basin stone, the glass the piston pushed, water, air again; not for
   TNT), exit 1 when it holds anything else: a compare alone also passes when a step changed nothing. The
   clean-up (`fill ... air` over the +-6 box, kill dropped items) also runs when a step fails and on Ctrl-C or
   SIGTERM; if even that fails the command is printed to run by hand. The commands are printed before the first
   write, for a kill -9.
4. Bot, only with `--bot` and `--bot-spot` (a free air cell): the bot places one cobblestone, then removes it
   (`POST /api/job`, type `build`, the second with `remove: true`). The model cell is polled every second for up to
   120 s, then compared with the real cell. The jobs are remembered as that bot's standing order: send it a stop
   afterwards if it keeps them.

Skipped steps print `SKIP scripted` / `SKIP bot`.

## load.js

Does the model cost load? Measure once with it off (before the deploy) and once on, same
time of day and similar player count.

```
node tools/world-check/load.js run --minutes 30 --out before.json
node tools/world-check/load.js run --minutes 30 --out after.json
node tools/world-check/load.js compare before.json after.json
```

Every 60 s it reads `/api/admin/status` (Paper's 1 minute mspt), `/api/debug` (`loopDelayMs.p99`, null on an old
hub) and `/api/world/stats` (`plugin.mainMsLastMinute` and `plugin.encodeMsLastMinute`, null when the model is off) and
writes the means. A failed reading after the first costs that row only (`failedSamples` in the file).
`compare` prints the deltas and exits 1 unless mspt rose by at most 0.5 and the loop p99 by at most 2 ms (both
deltas rounded to 0.1). A null loop p99 leaves that limit unjudged; a missing mspt fails.

## nobot.js

```
node tools/world-check/nobot.js
```

Picks a 32 x 32 rect of the area (x -590..50, z -340..300) at least 300 blocks from every bot and player
(`/api/state`), exit 2 when there is none. It reads that rect's height map and the 32 x 32 x 32 box around the
median height from the model: exit 1 unless both have no unknown chunks, then 500 random cells of the box must equal the world.
It prints the ground height at the centre of the rect: the number the architect has to name in phase 3.

## Tests

```
node --test tools/world-check/lib.test.js
```

(`node --test tools/world-check/` with a bare directory does not work on Node 22 or later: it is run as a file.
`cd tools/world-check && node --test` does.) No Nix check runs these.
