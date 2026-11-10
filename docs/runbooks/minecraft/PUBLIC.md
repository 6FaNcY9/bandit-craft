# Public world, phase 1: whitelisted testers over the tailnet

Prepared, not evaluated, not built, not deployed (written on a machine without Nix). Design:
[`docs/specs/2026-11-10-public-anarchy-world.md`](../../specs/2026-11-10-public-anarchy-world.md).
Phases 2 and 3 (relay, PROXY protocol, backups, store, opening) are not in here.

## What it is

- A NixOS container `mc-public` on bandit-lab (bandit-nix `hosts/bandit-lab/services/mc-public/`): own user
  namespace (base 589824), private veth `ve-mc-public` (10.251.1.1 host, 10.251.1.2 container), own tailnet
  node `tag:mc-public`. Caps on the whole container: 10G RAM, no swap, 3 CPUs, 2048 tasks, IO weight 50.
- Inside (`hosts/bandit-lab/services/minecraft-public/`, flake output `nixosModules.mc-public`): Velocity on
  `0.0.0.0:25565` (the container's firewall admits `tailscale0` only), `online-mode = true`, no plugins;
  Paper on `127.0.0.1:25567` with Chunky and SModeration only, no RCON, no operators, whitelist on.
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
5. The game port is on the container's `tailscale0` only.
   Lab: `timeout 3 bash -c '</dev/tcp/10.251.1.2/25565' && echo OPEN || echo closed` -> `closed`.
   Lab: `sudo nixos-container run mc-public -- ss -ltnH` -> 25565 on `*`, 25567 on `127.0.0.1`, no 25575.
   Laptop (granted in step 3): `nc -vz <mc-public tailnet address> 25565` succeeds; from a tailnet device
   without the grant it does not.
6. Lab, what Paper loaded (UNVERIFIED parts: SModeration without LuckPerms, and the Paper key names):
   `sudo journalctl -M mc-public -u minecraft-server-paper | grep -E 'Chunky|SModeration|Done \('`
   `sudo cat /srv/mc-public/data/paper/ops.json` -> `[]`
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

## Console, whitelist, mute and ban (no RCON, no operators)

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
`mcp ban <Name> <reason>` and `mcp pardon <Name>`. Never `op`: `ops.json` is emptied on every start and
the contract check forbids declared operators.

## World border and pre-generation

`max-world-size=5000` already stops the border at radius 5,000 in every dimension. Set the visible border
once (10000 is the diameter; UNVERIFIED whether 26.2 keeps one border per dimension, the three lines are
harmless either way):

```bash
mcp worldborder center 0 0
mcp worldborder set 10000
mcp execute in minecraft:the_nether run worldborder set 10000
mcp execute in minecraft:the_end run worldborder set 10000
```

Chunky, one world after the other (command names from Chunky's documentation, UNVERIFIED on 1.5.66; world
names as `sudo ls /srv/mc-public/data/paper` shows them). Radius 5120 is the border plus the view distance
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
sudo du -sh /srv/mc-public/data/paper/world*
sudo du -sh /srv/mc-public/data
```

## Random far spawn

The design wants a random far spawn on first join and on a bedless death, and nothing else (no `/rtp`).
Vanilla does this with one game rule (renamed from `spawnRadius` in 1.21.11), set once from the console
after the border; it is stored in the world:

```bash
mcp setworldspawn 0 ~ 0
mcp gamerule respawn_radius 4500
mcp gamerule respawn_radius
```

4500 keeps new players 500 blocks inside the border. UNVERIFIED on Paper 26.2: that the rule takes a value
this large, and that the spread is even. MC-302446 (open, reported for 1.21.9) puts players at the northern
edge of the radius for high values. Check before testers judge it: let one account die without a bed ten
times and note the coordinates. If they cluster, the rule stays at its default and a spawn plugin becomes a
design change (the exact plugin list is part of the contract check).

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
