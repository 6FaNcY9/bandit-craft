# Public world, phase 1: whitelisted testers over the tailnet

Prepared, not evaluated, not built, not deployed (written on a machine without Nix). Design:
[`docs/specs/2026-11-10-public-anarchy-world.md`](../../specs/2026-11-10-public-anarchy-world.md).
Phases 2 and 3 (relay, PROXY protocol, backups, store, opening) are not in here.

## What it is

- A NixOS container `mc-public` on bandit-lab (bandit-nix `hosts/bandit-lab/services/mc-public/`): own user
  namespace (base 589824), private veth `ve-mc-public` (10.251.1.1 host, 10.251.1.2 container), own tailnet
  node `tag:mc-public`. Caps on the whole container: 10G RAM, no swap, 3 CPUs, 2048 tasks, IO weight 50.
- Inside (`hosts/bandit-lab/services/minecraft-public/`, flake output `nixosModules.mc-public`): Velocity on
  `0.0.0.0:25565` (the container's firewall admits `tailscale0` and the host's tunnel agent over the veth),
  `online-mode = true`, no plugins;
  Paper on `127.0.0.1:25567` with Chunky and SModeration only, no RCON, the owner (fancy8869) as the only operator, whitelist on.
- The forwarding secret is generated inside the container (`/var/lib/minecraft-public-secret/secret`). The
  private `minecraft-servers.env`, the private RCON and every sops secret except the container's tailnet
  auth key stay outside.
- World: `/srv/mc-public/data` on the lab (`/srv/minecraft` inside). Console: `/run/minecraft/paper.stdin`
  inside the container, root only. A deploy that changes the container restarts it and disconnects players.
- Contract: bandit-nix `ci/lab-mc-public.nix`.

## Bring-up (owner only)

1. bandit-craft: review, sign and merge `mc-public-phase1`. On its own this changes nothing on the lab: the
   module is not part of `nixosModules.lab`, and the private Paper leaves Chunky out by name.
   Check the Chunky pin first (the hash comes from Modrinth's API, nobody has fetched against it):
   `nix store prefetch-file --hash-type sha512 https://cdn.modrinth.com/data/fALzjamp/versions/RBuKjN4k/Chunky-Paper-1.5.66.jar`
   must print the hash in `plugins.nix`.
2. bandit-nix: `tools/craft-bump`, ship it. The lab builds the same private stack as before.
3. Tailscale admin console, policy file (`<tester>` is a tailnet login or group):

   ```json
   "tagOwners": {"tag:mc-public": ["autogroup:admin"]},
   "grants": [
     {"src": ["<tester>"], "dst": ["tag:mc-public"], "ip": ["tcp:25565"]}
   ]
   ```

   No grant may have `tag:mc-public` as `src`: the box reaches nothing on the tailnet.
4. Auth key: Settings, Keys, Generate auth key: reusable off, ephemeral off, pre-authorized on, tag
   `tag:mc-public`.
5. bandit-nix, branch `mc-public-phase1` rebased on `main`: `sops secrets/lab.yaml`, add
   `mc-public-tailscale-authkey` (the key from step 4). The key and the module must land together:
   `sops-isolation` fails on a declared key that is missing and on a key no module declares.
6. Optional, on the lab before the first deploy: a quota for the world, so it cannot fill the disk. Without
   it `mc-public-prepare` creates a plain directory.

   ```bash
   sudo mkdir -p /srv/mc-public
   sudo btrfs subvolume create /srv/mc-public/data
   sudo btrfs qgroup limit 40G /srv/mc-public/data
   sudo chown 589824:589824 /srv/mc-public/data
   ```
7. Laptop, before the deploy: `ssh -o BatchMode=yes bandit-lab "ss -ltnuH | awk '{print \$1,\$5}' | sort -u" > /tmp/ss-before`
8. bandit-nix: format, checks, build the committed revision, sign. First deploy with `lab-apply`, not the
   timer, so a failing `container@mc-public` is seen at once. Push to `main` only after the checks below.

## Checks before any tester

Each line names its host. `sudo` on the lab asks for the password.

1. Lab, units:
   `systemctl is-active mc-public-prepare container@mc-public`
   `sudo nixos-container run mc-public -- systemctl is-active minecraft-public-secret minecraft-server-paper minecraft-server-velocity tailscaled`
   `sudo nixos-container run mc-public -- tailscale ip -4` (the address testers use; `tailscale status` shows the tag)
2. Laptop, the host listens on nothing new (no output expected):
   `ssh -o BatchMode=yes bandit-lab "ss -ltnuH | awk '{print \$1,\$5}' | sort -u" | diff /tmp/ss-before -`
3. Lab, the box reaches nothing but the internet. Define the probe, then run the lines:

   ```bash
   p() { sudo nixos-container run mc-public -- timeout 3 bash -c "</dev/tcp/$1/$2" && echo "OPEN $1:$2" || echo "closed $1:$2"; }
   p 1.1.1.1 443          # control: must be OPEN, or every "closed" below proves nothing
   p 127.0.0.1 1          # control: must be closed
   p 10.250.77.1 25575    # private RCON (mcbots gateway forwarder): closed
   p 10.250.77.1 25576    # sandbox RCON: closed
   p 10.250.77.1 25565    # private Velocity on the bridge: closed
   p 10.250.77.2 25565    # mcbots bridge: closed
   p 10.251.1.1 22        # host side of the veth: closed
   p 100.125.161.81 25565 # host tailnet address, private Velocity: closed
   p 100.125.161.81 22    # host sshd: closed
   p 127.0.0.1 25575      # the box's own loopback has no RCON: closed
   p 10.251.0.2 22        # jerry's box: closed
   p <LAN gateway> 80     # the LAN (`ip route` on the lab shows the gateway): closed
   ```
4. Lab, the rules and the caps:
   `sudo iptables -S nixos-fw | sed -n 2p` (the first rule refuses `ve-mc-public`)
   `sudo iptables -S DOCKER-USER | grep ve-mc-public` (four DROP rules)
   `systemctl show container@mc-public -p MemoryMax -p MemorySwapMax -p CPUQuotaPerSecUSec -p TasksMax -p IOWeight`
   `sudo machinectl status mc-public | grep -i uid` (user namespace base 589824)
5. The game port is on the container's `tailscale0` (testers) and, over the veth, from the host only (the
   tunnel agent). Nothing else reaches it: the host forwards nothing new from the veth into the container.
   Lab host: `timeout 3 bash -c '</dev/tcp/10.251.1.2/25565' && echo OPEN || echo closed` -> `OPEN`
   (the host's own tunnel path; from the LAN or another tailnet device without a grant it is closed).
   Lab: `sudo nixos-container run mc-public -- ss -ltnH` -> 25565 on `*`, 25567 on `127.0.0.1`, no 25575.
   Laptop (granted in step 3): `nc -vz <mc-public tailnet address> 25565` succeeds; from a tailnet device
   without the grant it does not.
6. Lab, what Paper loaded (the key names match what the pinned build writes, and Chunky and SModeration
   2.0.0 load on it without LuckPerms; both checked locally on 2026-11-10):
   `sudo journalctl -M mc-public -u minecraft-server-paper | grep -E 'Chunky|SModeration|Done \('`
   `sudo cat /srv/mc-public/data/paper/ops.json` -> only fancy8869
   `sudo grep -A4 chunk-loading-basic /srv/mc-public/data/paper/config/paper-global.yml` -> 40, 40, 5
   `sudo grep -E 'redstone-implementation|max-entity-collisions|prevent-moving-into|arrow|experience_orb' /srv/mc-public/data/paper/config/paper-world-defaults.yml`
   A key that Paper dropped or renamed is missing here: fix its name in `minecraft-public/default.nix`.
7. Accounts. A whitelisted paid account joins and keeps its real UUID. A paid account that is not
   whitelisted is refused by Paper. An offline-mode client (a Mineflayer bot with `auth: 'offline'`, or a
   cracked launcher) is refused at login by Velocity. Lab:
   `sudo journalctl -M mc-public -u minecraft-server-velocity -n 30`
8. Lab, the private world did not notice: `systemctl is-active minecraft-server-paper minecraft-server-sandbox minecraft-server-velocity`,
   `systemctl show -p ActiveEnterTimestamp minecraft-server-paper` (older than the deploy), `bandit-lab-health`,
   the bots on the dashboard.
9. Pre-generation size, see below.

## Console, whitelist, mute and ban (no RCON, the owner the only operator)

On the lab; the console is a FIFO that only root inside the container can write:

```bash
mcp() { sudo nixos-container run mc-public -- bash -c "echo '$*' > /run/minecraft/paper.stdin"; }
mcp whitelist add <Name>
mcp whitelist list
mcp whitelist remove <Name>
sudo journalctl -M mc-public -u minecraft-server-paper -n 5
```

The whitelist lives in `/srv/mc-public/data/paper/whitelist.json`; Nix writes none. Mute and ban are
SModeration's console commands (`docs/runbooks/minecraft/ADMIN.md` links its reference), or vanilla
`mcp ban <Name> <reason>` and `mcp pardon <Name>`. Never `op` anyone else: `ops.json` is rewritten from Nix on every start (the owner only) and
the contract check allows no other operator. The owner's kit: `/function bev:kit` in the game.

## World border and pre-generation

`max-world-size=5000` already stops the border at radius 5,000 in every dimension. Set the visible border
once (10000 is the diameter; 26.2 keeps one border per dimension, so all three lines are needed):

```bash
mcp worldborder center 0 0
mcp worldborder set 10000
mcp execute in minecraft:the_nether run worldborder set 10000
mcp execute in minecraft:the_end run worldborder set 10000
```

Chunky, one world after the other (these commands ran on Chunky 1.5.66 with the pinned Paper on
2026-11-10). Radius 5120 is the border plus the view distance
(6 chunks), so a player at the border generates nothing: 640 x 640 = 409,600 chunks per dimension.

```bash
mcp chunky world world
mcp chunky center 0 0
mcp chunky radius 5120
mcp chunky shape square
mcp chunky start
sudo journalctl -M mc-public -u minecraft-server-paper -f | grep -i chunky
```

Repeat with `world_nether` and `world_the_end`. `mcp chunky pause` and `mcp chunky continue` stop and
resume; it runs inside the 3-CPU cap, so expect hours. Measure when all three are done and write the
numbers into the design's "Longevity" section (estimate there: under 10 GB):

```bash
sudo du -sh /srv/mc-public/data/paper/world/dimensions/minecraft/*
sudo du -sh /srv/mc-public/data
```

## Random far spawn

The design wants a random far spawn on first join and on a bedless death, and nothing else (no `/rtp`).
Vanilla does this with one game rule (renamed from `spawnRadius` in 1.21.11), set once from the console
after the border; it is stored in the world:

```bash
mcp setworldspawn 0 '~' 0   # quoted: the shell would turn a bare ~ into the home directory
mcp gamerule respawn_radius 4500
mcp gamerule respawn_radius
```

4500 keeps new players 500 blocks inside the border. Paper 26.2 accepts the value; UNVERIFIED is that the
spread is even. MC-302446 (open, reported for 1.21.9) puts players at the northern
edge of the radius for high values. Check before testers judge it: let one account die without a bed ten
times and note the coordinates. If they cluster, the rule stays at its default and a spawn plugin becomes a
design change (the exact plugin list is part of the contract check).

## Phase 2: the public address

The lab is behind a router the owner cannot port-forward (CGNAT, or a locked ISP router). A tunnel agent
on the host dials out and makes the server public without touching the router or exposing the home
address. From this phase on Velocity drops every connection without a PROXY header: nobody joins over the
tailnet address directly any more, the owner included.

Before: every line of `mc-probe.sh` on the lab says `ok` (the checks above as one script; the agent
copies it to the lab's home directory).

The default is the playit.gg tunnel (free, no VPS). The VPS relay below is the alternative when the free
tunnel is too slow or unreliable.

### Default: the playit.gg tunnel

The agent (`playit` package, pinned in bandit-nix `mc-public/default.nix`) runs as its own user **on the
host**, not in the container: an IPv4-only container is handed an IPv6 relay it cannot reach and the agent
does not fall back to IPv4 (GH#194); the host has working IPv6. It forwards to the container's Velocity
over the veth (`10.251.1.2:25565`, PROXY v2 set in the playit account). Its secret lives in the host's own
state (`/var/lib/playit/playit.toml`, the `playit` user), no sops key.

1. Owner: a free account at playit.gg (email only, no payment).
2. Ship the Velocity change (`haproxy-protocol = true`) with the matching line in bandit-nix
   `ci/lab-mc-public.nix` and the tunnel package, then `lab-apply`. This restarts the public pair only.
3. Owner, claim the agent, on the lab host (the `playit` service must be up, so it after the deploy):

   ```bash
   sudo -u playit playit-cli --socket-path /run/playit/playit.sock setup
   ```

   It prints a `https://playit.gg/claim/<code>` line. Open it, signed in, and confirm.
4. Owner, in the playit account: a `Minecraft Java` tunnel to `10.251.1.2:25565`, and set **Proxy
   Protocol** to **Version 2**. Without it the server sees the host's veth address (`10.251.1.1`) for
   everyone and IP bans hit the agent, not the player. The agent's page has **Allow IPv6**; it is set to
   **Only IPv4** (then `sudo systemctl restart playit`). That was the state when the tunnel first
   answered (2026-11-11); whether it is required was not isolated.
5. Checks:
   - Laptop: `nix shell nixpkgs#mcstatus -c mcstatus <playit address> status` answers with Paper's
     version and message; the same against the tailnet address times out. Ping the **name**, never the
     edge's IP: playit routes by the hostname in the Minecraft handshake and resets a connection that
     carries the bare IP (`BrokenPipe`/`ECONNRESET`), also when the tunnel is healthy.
     Give players `<name>:<port>`: the bare name needs the SRV lookup, which fails on some resolvers
     ("Unknown host"), and a pasted trailing space fails the same way.
   - One `control session expired; reconnecting reason=SessionNotSetup` line right after `playit
     connected; tunnels loaded` is harmless when nothing follows it.
   - Join through the playit address with a whitelisted account. Lab:
     `sudo journalctl -M mc-public -u minecraft-server-velocity -n 20` shows the player's own public
     address, not the veth address.
6. Owner, the domain: a `CNAME` `mc.<domain>` to the playit address (or an `SRV _minecraft._tcp.<domain>`
   -> `0 5 <port> <playit host>` so players type the bare domain). DNS records can be set on a domain
   that lives on shared hosting.

### Alternative: a VPS relay

A small VPS runs HAProxy (`tools/minecraft-public-relay`: TCP only, PROXY v2, per-address connection
limits) and reaches the server over the tailnet. Better latency and fully under the owner's control, but
it costs a few euro a month.

1. Owner, the VPS: Debian or Ubuntu, one public IPv4, 1 GB of memory is enough, a location near Vienna.
   Log in with an SSH key, not a password. Nothing else runs on it: an attack on the game address must
   not take anything else down.
2. Owner, Tailscale admin console:
   - Access controls, tags: add `tag:mc-relay`, owned by the admins.
   - Access controls, one more rule: source `tag:mc-relay`, destination `tag:mc-public`, port `tcp:25565`.
     No rule may give `tag:mc-relay` anything else, and none may let anything reach `tag:mc-relay`.
   - Settings, Keys: an auth key that is not reusable, pre-approved, tagged `tag:mc-relay`. It is typed
     into the script's prompt once and stored nowhere.
3. Laptop, copy the files and run the script on the VPS (it asks for the key):

   ```bash
   scp -r tools/minecraft-public-relay root@<VPS address>:
   ssh -t root@<VPS address> './minecraft-public-relay/setup.sh <tailnet address of mc-public>'
   ```

   Its last lines show the relay's sockets (22 and 25565) and `server reachable`. If it says
   `CANNOT reach`, the rule in step 2 is missing or the container is down.
4. Ship as in the tunnel's step 2, then `lab-apply`.
5. Checks as for the tunnel, against `<VPS address>:25565`, plus from the VPS:
   `timeout 3 bash -c '</dev/tcp/<lab tailnet address>/22' && echo OPEN || echo closed` -> `closed`.
6. Owner, the domain: an `A` record `mc.<domain>` to the VPS address, or the `SRV` record as above.

### Backup and restore drill

The public world has its own restic job, `restic-backups-mc-public` (bandit-nix
`hosts/bandit-lab/services/backup/mc-public.nix`, 06:30 daily, into the lab's peer repository on the
laptop). It is apart from the job that carries Vaultwarden and the private world on purpose: a public
world that will not flush fails its own run only. The host takes the copy with `minecraft-snapshot`
(`MC_MACHINE=mc-public`): saves are flushed and frozen through the container's console while rsync
reads Paper's directory (worlds, whitelist, bans, plugin data; no logs or caches). A failed or stale
run alerts like the other backups. Not copied off-site yet: the S3 job is off for the whole lab.

1. Owner, first run by hand (the laptop must be awake and on the tailnet):
   `ssh -t bandit-lab 'sudo systemctl start restic-backups-mc-public; sudo journalctl -u restic-backups-mc-public -n 15 --no-pager'`
   -> `snapshot complete` and restic's `snapshot <id> saved`. In the game, saving must be on again:
   the server log shows `Automatic saving is now enabled`.
2. Owner, the restore drill (the design wants it passed before the whitelist comes off):
   `scp tools/mc-public-restore-test.sh bandit-lab:` from a bandit-nix checkout, then
   `ssh -t bandit-lab 'sudo bash mc-public-restore-test.sh'` -> `PASS`. It restores into a scratch
   directory, never over the world, and removes it. Record date and snapshot id here:

   - 2026-11-11 06:51Z: PASS, snapshot `a18c9549` (8.14 GiB, 2866 region files, 1,360,134 chunks in
     place). The first run that day failed on the test, not the backup: it required every region file
     to be whole 4 KiB sectors, but a running server pads a file only when it closes it (4 files near
     the one online player ended short; whole again after the next restart). The test now checks each
     chunk against its file instead.

Real recovery: stop the container (`sudo systemctl stop container@mc-public`), restore the snapshot's
`paper` directory over `/srv/mc-public/data/paper` keeping the owner (the container's root, uid
589824), start the container.

## Discord chat bridge (ChatBridge)

The public Paper loads one plugin of our own, `minecraft-public/chatbridge` (one Java class, built by Nix against
the pinned Paper jar; its build runs `SelfTest`). Game chat, joins, leaves and deaths go to `#ingame-chat` of the
guild; what members write there is shown in the game as `[Discord] name: text`. Nothing else: no commands, no
console, no account linking.

- Discord to game: plain text, one line, at most 256 characters; mention ids, colour codes and invisible
  characters are removed; attachments, bots, webhooks and accounts younger than 7 days are not shown; at most 8
  lines in 10 s.
- Game to Discord: markdown from a player stays text, `@everyone` and other mentions do not ping
  (`allowed_mentions` empty), no link previews and no clickable link (`:` is escaped); lines are sent in batches
  every 2 s, a flood is cut at 200 lines.
- Old copies: the plugin deletes its own messages in `#ingame-chat` once they are 30 days old (`KEEP_MS`; the
  privacy policy names this time). It needs no extra right for that, a bot may always delete what it sent itself.
  It searches every six hours and after each start, one request every 5 s; what members wrote themselves stays.
  While the public server is down nothing is deleted.
- Token: the sops value `discord-bridge-token` (application `bandit-bridge`, Message Content Intent on). bandit-nix
  places it at `/var/lib/discord-bridge/token` in the box; `minecraft-public-secret` puts it into the generated
  environment file as `CHATBRIDGE_TOKEN`. The channel id is `CHATBRIDGE_CHANNEL` in the Paper unit. Without a
  token the plugin logs `chat bridge off` and does nothing.
- What a stolen token can do: the token sits in the public game server. `BRIDGE_ID` in
  `discord-admin/default.nix` is the application's id: the admin bot denies that bot every open channel but
  `#ingame-chat`. After a new invite restart `discord-admin`: Discord drops the denial for a bot that is not a
  member, without an error. It can still write direct messages to members it sees and change its own name and picture.
  If the public server was broken into, reset the token in the developer portal.
- New token: change the sops value, deploy, then in the box
  `systemctl restart minecraft-public-secret minecraft-server-paper` (players are disconnected).
- Look: `journalctl -M mc-public -u minecraft-server-paper | grep -i "chat bridge"`. `gateway closed (4004)` means
  a wrong token, `closed (4014)` that the Message Content Intent is off in the developer portal.
- Test without Discord: `NODE_PATH=<mcbots node_modules> node tools/botui-stand/e2e-chat.js` starts the local
  stand with the plugin against a made-up Discord and stops it again.

## Opening (phase 3, without the store)

The whitelist is a server property that Nix rewrites on every start, so `mcp whitelist off` lasts until
the next restart only. Opening for good is a change to `white-list` and `enforce-whitelist` in
`minecraft-public/default.nix`, shipped like any other. Before it: the launch texts' conditions
(`PUBLIC-LAUNCH.md`, "When to post what") hold, the legal pages are reachable from the listing, and the
report address is read.

## Turn it off

- Pause, lab: `sudo systemctl stop container@mc-public`. It returns at the next boot or the next deploy
  that changes the container.
- Remove: in bandit-nix drop the `./services/mc-public` import, the `lab-mc-public` check, the
  `ve-mc-public` entry in `ci/lab-jerry.nix` and the `mc-public-tailscale-authkey` key, in one commit;
  deploy; delete the grant and the node in the Tailscale console. The world stays in
  `/srv/mc-public/data` (it is never reset); `/var/lib/nixos-containers/mc-public` may be deleted.
- New forwarding secret: `sudo nixos-container run mc-public -- rm /var/lib/minecraft-public-secret/secret`,
  then `sudo systemctl restart container@mc-public`.

## Not decided or not in phase 1

Relay and PROXY protocol, backups and the restore drill, the store, chat guards, an exploit-fix plugin.
`difficulty` is `hard`. The random far spawn is a console step above and unproven until its check passes.
