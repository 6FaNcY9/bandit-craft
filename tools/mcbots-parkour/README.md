# mcbots-parkour: movement check

bot50 walks one lane per obstacle in the SANDBOX (never live bots, never the main server) with the project's
`safeMovements` (sprint + parkour on, diagonals off, digging off): gap course, closed oak door, fence gate, 6-high
ladder, 6-high vines, 6-high scaffolding, 3-wide water. Courses sit at X 3600, Z 3400+ (y 119) and are removed at the
end, also on error. Prints a table (success, seconds, forcedMove corrections, failure reason) and writes `results.json`
(git-ignored; `OUT=path` overrides).

    tools/mcbots-parkour/run.sh [course-regex]    # e.g. run.sh 'ladder|vines'
    CLEAN=1 tools/mcbots-parkour/run.sh           # only remove the courses

Needs the mcbots seed (`~/.local/state/mcbots/seed`), a reachable sandbox and the hub console on the tailnet.
Results and phase 4 items: `docs/runbooks/minecraft/movement-check.md`.
