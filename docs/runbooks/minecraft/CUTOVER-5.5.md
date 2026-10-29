# Cutover 5.5: Docker to nix-minecraft

The real world, the bots' sandbox and Velocity move from Docker to `minecraft-server-{paper,sandbox,velocity}`
(Velocity on tailnet `:25565`, as before). Players are offline from the stop of Docker Minecraft to `Done (`:
expect 3-8 minutes; over 15 minutes means rollback. The Docker containers stay defined but do not start
(removal is 5.6). Plan: bandit-nix `docs/superpowers/plans/2026-10-22-phase-5-minecraft.md`, "PR 5.5".

How it works: starting `minecraft-cutover` (required by all three nix servers) stops `docker-velocity`,
`docker-minecraft` and `docker-minecraft-sandbox` through `Conflicts=` (NixOS does NOT stop a running container whose
autoStart was removed; `docker stop` saves the world, up to 60 s), then copies the Docker data to
`/srv/minecraft/paper` once and stamps it. The script refuses if any Docker unit, the container or Paper is not
provably stopped.

## Before (any day, quiet evening, 10 players or fewer)

1. laptop, merged and signed `bandit-craft` + `bandit-nix` lock bump ready to `lab-apply`.
2. laptop: stop the auto-deploy so the restart happens once, after the warning:
   `ssh -t bandit-lab 'sudo systemctl stop lab-update-apply.timer; systemctl list-timers | grep lab-update'` (nothing listed).
3. laptop: backup, verified, off-host copy (Docker is still live, so the Docker backend is used):
   `ssh -t bandit-lab 'sudo systemctl start minecraft-backup && cd /srv/containers/minecraft/backups/auto && sudo sha256sum --check "$(ls -t *.sha256 | head -1)" && sudo systemctl start restic-backups-peer && sudo restic-peer snapshots --latest 1'`
   (`restic-peer` is the module's wrapper, docs/runbooks/backup-peer.md in bandit-nix).
4. laptop, T-10 min: `scp tools/minecraft-restart-warn.sh bandit-lab: && ssh -t bandit-lab 'sudo bash minecraft-restart-warn.sh "move to nix-minecraft"'`
   (default `MC_RCON` = Docker; returns after the 10 minutes).

## T-0

5. laptop: `lab-apply` (GPG unlock, fingerprint). Watch, optional:
   `ssh bandit-lab 'journalctl -f -u minecraft-cutover -u minecraft-server-paper -u minecraft-server-velocity'`
   (`cutover copy finished: N files`, then `Done (`).

## Verify (bandit-lab unless noted)

6. `ssh bandit-lab 'systemctl is-active minecraft-cutover minecraft-server-paper minecraft-server-sandbox minecraft-server-velocity; systemctl is-active docker-minecraft docker-velocity docker-minecraft-sandbox'`
   -> `active` x4, then `inactive` x3. `cat /srv/minecraft/paper/.cutover-done /srv/containers/minecraft/CUTOVER-5.5-DONE`.
7. `ss -ltnup | grep -E ':(25565|25567|25568|25575|25576|8100|24454) '`: 25565 on `*` (the firewall admits only
   tailscale0 and the bridge rule), 25567/25568 only `127.0.0.1`, 25575/25576/8100 on `127.0.0.1` and `10.250.77.1`
   (forwarders), 24454/udp on `*`. `bandit-lab-health` green; Prometheus probe for 25565 green.
8. Bots: `ssh bandit-lab 'docker logs --since 5m mcbots 2>&1 | tail'` shows bots joined via `10.250.77.1`
   (sandbox, virtual host `sandbox.bots`); the dashboard Server panel (RCON) answers; one scenario completes;
   the map loads at the tailnet HTTPS URL (`:8443`) with the bots' overlay.
9. In game (owner): join at the usual address, spawn and inventory, `/lp`, a kit, voice chat, `/server sandbox`.
10. Only now: `ssh -t bandit-lab 'sudo systemctl start lab-update-apply.timer'`.

## Rollback

`/srv/containers/minecraft/data` is untouched since T-0 (cold copy). Progress made on the new server is lost.

- Quick, Docker game only (bots stay down: mcbots now point at the host): on bandit-lab
  `sudo systemctl start docker-minecraft docker-velocity docker-minecraft-sandbox`. Starting them stops
  `minecraft-cutover` and, through its `Requires=`, the three nix servers. Check `ss -ltn | grep 25565`.
- Full (also puts mcbots and the old units back): on bandit-lab first
  `sudo touch /srv/minecraft/paper/.rehearsal-copied` (else the old generation's rehearsal copy overwrites the
  new world), then either `sudo nixos-rebuild switch --rollback` or, from the laptop, revert the lock bump and `lab-apply`.
  Restart the timer afterwards.
- To redo the copy after a rollback: `sudo rm /srv/minecraft/paper/.cutover-done` before the next try.

## Later

- Restart warning for the nix server: `ssh -t bandit-lab 'sudo env MC_CONSOLE=/run/minecraft/paper.stdin bash minecraft-restart-warn.sh "<reason>"'`.
- Bot scripts that call `docker exec minecraft-sandbox rcon-cli` (`tools/mcbots-selftest`, `mcbots-placetest`,
  `mcbots-scenarios/run.js`) and `tools/minecraft-kit-check` need the nix console/RCON before they work again.
