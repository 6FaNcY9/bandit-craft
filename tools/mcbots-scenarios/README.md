# mcbots sandbox scenarios

Repeatable pass/fail checks for the bot's walking, digging, mining and chest work. Each scenario is built
in a sky lab (x 3500..3560, z 3000..3060, y 200..230) on the SANDBOX server, so terrain never matters.

    node tools/mcbots-scenarios/run.js [name-filter]   # TRACE=1 prints the bot position every second, KEEP=1 leaves the lab standing
    node tools/mcbots-scenarios/run.test.js            # unit test of the pure parts, no server needed

Needs: a local mcbots instance with bot50 on the sandbox (`~/.cache/bandit-bot-test/run-failmem.sh`,
dashboard 127.0.0.1:8099; it sets `SUPPLY_CHEST=3516,201,3031`, the sky lab, which wheatfarm and the rescue need) and `ssh bandit-lab` (RCON through `docker exec minecraft-sandbox`).

- `scenarios.js`: the table. A scenario is `{name, setup: [rcon], job: {type, args}, timeoutS, success: [conditions]}`
  (optional `stopAfterS`, `teardown`, `pre` = jobs run first, e.g. a stock job, `zones` = places set in the bot's state for the run, removed after). Conditions: near, notNear, inv, alive, finished, noError, error, chest, cells (counts blocks in a box by `execute if block` probes, `min`/`max`).
- `run.js`: builds the lab, orders the job, polls `/api/state`, scores the final state, prints a table, exits 1 on any FAIL.
  Metrics from `/api/events`: could not reach, No path, no progress for 30 s, skipped a, no free, deaths, seconds.
- Every run appends one JSON line to `~/.cache/bandit-bot-test/scenario-results.jsonl` (outside the repo).
- Every RCON command is checked against a whitelist of shapes and the box before it is sent.

Gotchas: the bot remembers a walk with no path for 10 min per target, so each scenario needs its own
target. The platform is smooth_stone so a `stone` job does not dig the floor. Run one runner at a time.
