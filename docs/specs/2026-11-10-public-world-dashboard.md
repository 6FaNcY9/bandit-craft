# Public world: player dashboard (design, 2026-11-10)

Status: written with the owner on 2026-11-10, not yet approved. Nothing here is built.
Belongs to the public anarchy world (`2026-11-10-public-anarchy-world.md`).

## Intent

The owner, and perhaps Misa, want to open one page and see what is happening on the public world:
who plays, how much, what they do and how they die. The same numbers should serve the bots: real
human figures to measure the Mineflayer bots and the Andy agents against ("a new player has iron
after N minutes", "this is what kills players in their first hour").

The owner had no fixed picture ("interesting things, useful data"); the contents below are the
agent's proposal, which the owner accepted in conversation.

## Goals

- Server pulse: players online now, joins per day, new against returning players, busy hours, tick
  time, memory, size of the world on disk.
- Player tables: play time, deaths, player kills, distance travelled, blocks mined, items crafted.
- Event feed: joins, leaves, deaths with their cause, advancements, and the world events of
  `2026-11-10-public-world-events.md` once they exist.
- A bot baseline: per-player figures exported in a form the bot tooling can read (time to first
  iron, to first diamond, to the nether; causes of death in the first hour of play time).
- Visible to the owner and to Misa over the tailnet, in the existing Grafana.

## Non-goals

- A public statistics page for players. It may come later as marketing; it is a separate decision.
- Alerts. The existing alerting covers the host; alerts for the public world come with phase 2.

## Anti-goals

- No live positions, no map, no coordinates of players, deaths or bases anywhere in the dashboard
  or the exported data. On an anarchy server that is an operator advantage, and the launch texts
  promise there is none. Death causes are shown; death places are dropped before storage.
- No chat on the dashboard. Chat stays in the server log for reports (about 30 days, as in the
  anarchy design) and is not copied into the metrics.
- No new plugin on the public Paper and no new listening port in the container. The exact plugin
  list and the container's closed firewall are contract checks (bandit-nix `ci/lab-mc-public.nix`).

## Constraints

- The container must stay as isolated as it is: nothing in it may reach the host, and the host
  opens nothing for it. Data therefore flows one way, read from outside.
- The world directory is a bind mount: `/srv/mc-public/data` on the host. Vanilla keeps one
  statistics file per player under the world's `stats/` directory, the name cache in
  `usercache.json` and the log in `logs/latest.log`. All are readable by root on the host without
  entering the container. The exact paths on Paper 26.2 are unverified until the first start.
- Monitoring belongs to bandit-nix (`hosts/bandit-lab/services/monitoring`): Prometheus with a
  node exporter on `localhost:9100`, Grafana with dashboards generated in `dashboards.nix`,
  published as the Tailscale Service `grafana`. There is no log store (no Loki).
- Personal data: player names, UUIDs, play times and behaviour are personal data under the GDPR.
  Everything collected here, its purpose (operation, and measuring the operator's bots) and its
  retention must be named in the privacy policy before the whitelist comes off. Until then only
  invited testers are affected and they are told.

## How (decided by the agent, the owner left it open)

- A small host-side reader on the lab, run by a timer as root with a read-only view of
  `/srv/mc-public/data`, turns the statistics files and the log into Prometheus metrics. It runs
  outside the container and writes nothing into the world directory.
- Delivery: the reader is a module in bandit-craft, exported from `flake.nix` and imported into
  the host by bandit-nix; the scrape and the dashboard are a bandit-nix change
  (`monitoring/prometheus.nix`, `dashboards.nix`). The node exporter has no textfile directory
  today; whichever way the builder chooses adds its own piece there.
- Sources: the log is the only source for joins, leaves and deaths with their cause; the
  advancement files give times; the statistics files give totals. The reader follows the log
  across rotation and restarts (it remembers how far it read) and never keeps the coordinates a
  log line carries. Lines announcing a world event are the exception: an event's place is a
  public announcement, not a player's position, and may be shown.
- Erasure: a player who asks to be deleted goes onto the reader's exclusion list and their
  series are deleted from Prometheus through its admin API. The runbook gets that procedure;
  Prometheus' normal retention applies otherwise.
- The same exclusion list keeps the bots' accounts and the owner's test accounts out of the bot
  baseline.
- Load from outside, as a stand-in for tick time: the container's CPU and memory from the host's
  cgroup figures.
- Metrics carry the player name as a label. The number of players is small (20 slots, a few
  hundred accounts over time); if it grows past a few thousand, keep per-player series for the
  top N only.
- The event feed without a log store: the reader keeps the last N events and exposes them as
  labelled series with the event time as the value, shown as a Grafana table.
- Tick time: read from what the server already writes or reports. If Paper 26.2 offers nothing
  readable from outside, this panel is left out rather than adding a plugin.
- The bot baseline is a file the reader writes next to its metrics (one JSON document, per
  player and aggregated), not a second pipeline.

## Left to the builder

- The reader's language and where it lives (bandit-craft as an exported module that bandit-nix
  imports into the host, like `nixosModules.lab`, is the expected shape; the dashboard itself
  belongs in bandit-nix `dashboards.nix`).
- Textfile collector on the existing node exporter, or a loopback exporter of its own.
- The exact panels and their layout, following the existing dashboards' style.
- How "time to first iron" is derived: the statistics files hold totals, not times, so it needs
  either snapshots over play time or the advancement files (`advancements/<uuid>.json` carry the
  time each advancement was earned, which is the simpler source).
- Retention of the per-player series (Prometheus' current retention applies unless the privacy
  policy asks for less).

## Checks when built

- `lab-mc-public`, `lab-surface` and `lab-minecraft` pass unchanged.
- The reader has tests against sample statistics, advancement and log files, including a death
  line with coordinates in it, which must not survive into any output.
- On the lab: host `ss -ltn` shows no new non-loopback listener; the dashboard shows a test
  player's join, play time and a death with its cause.
