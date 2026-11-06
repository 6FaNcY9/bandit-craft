# Movement check (sandbox)

Measures how the mcbots servants handle doors, gates, ladders, vines, scaffolding and water. bot50 only, SANDBOX only
(RCON through the hub's `/api/sandbox/console`), courses at X 3600 / Z 3400-3448 / y 119, removed afterwards.

## Run

    tools/mcbots-parkour/run.sh [course-regex]
    CLEAN=1 tools/mcbots-parkour/run.sh      # remove the courses only

Movement flags are the project default from `safeMovements` (sprint + parkour on, diagonals off); digging is switched
off so only walk, jump, climb and open count. See `tools/mcbots-parkour/README.md`.

## Result, 2026-11-06 (bot50, sandbox)

| Course | OK | Seconds | Corrections | Failure |
| --- | --- | --- | --- | --- |
| gap course (1-3 gaps, +1 step, 3 stairs) | y | 5.8 | 0 | |
| closed oak door | y | 5.9 | 0 | |
| fence gate | y | 5.7 | 0 | |
| 6-high ladder | y | 4.6 | 0 | |
| vines, 6 high | n | 0 | 0 | "No path to the goal!" |
| scaffolding tower, 6 high | n | 0.2 | 0 | "No path to the goal!" |
| 3-wide water crossing | y | 1.8 | 0 | |

One run per course, so timings are indicative only.

## Phase 4 items

- Vines are not climbable for the pathfinder: mineflayer-pathfinder keeps `vine` out of `movements.climbables` (the line
  is commented out upstream), so the vine column is solid-less air with no route. Idea: add the vine id to
  `mv.climbables` in `safeMovements` and re-run `run.sh vines`.
- Scaffolding tower: `scaffolding` is not in `climbables` either (only `ladder` is). Idea: add it to `mv.climbables`
  (the bot enters it by jumping, so also check the step-in move), re-run `run.sh scaffolding`.
