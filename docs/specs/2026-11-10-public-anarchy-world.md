# Public anarchy world (design, 2026-11-10)

Status: design accepted by the owner on 2026-11-10 (host: lab container plus VPS relay).
Nothing in this document has been evaluated, built or deployed. Paper key names are taken
from docs.papermc.io and are unverified against the pinned Paper build.

## Goal

A public Minecraft world that strangers join for free, with paid supporter extras, run
next to the private world on bandit-lab without widening the attack surface of the private
world, Vaultwarden, the backups or the monitoring stack. Longevity matters more than a
quick launch: the world is never reset.

## Decisions

| Topic | Decision |
| --- | --- |
| Host | bandit-lab, in its own NixOS container (the jerry-box pattern in bandit-nix `hosts/bandit-lab/services/jerry-box/default.nix`) with its own tailnet node |
| Ingress | small VPS as TCP relay (HAProxy, PROXY v2, per-IP connection limits) over the tailnet; ACL `tag:mc-relay -> tag:mc-public tcp:25565` only. The lab is behind CGNAT and the host firewall stays unchanged |
| Proxy | its own Velocity+Paper pair. Never a backend behind the private Velocity |
| Accounts | premium only: Velocity `online-mode = true`, no VeloAuth, no BotGate |
| Privileges | no operators, no RCON, own forwarding secret |
| Plugins | minimal: Chunky (pre-generation), SModeration (mute/ban from the console), LuckPerms once the store exists. No kits, BotUi, Jarvis, CommandPanels |
| World | one shared overworld, nether and end; border radius 5,000 (10,000 x 10,000 = 100,000,000 blocks of surface), fully pre-generated |
| Play | anarchy: griefing and hacked clients allowed, no rollbacks, no `/home`, `/tpa`, `/rtp`; random far spawn on first join and bedless death only |
| Owner builds | stay in the private world. No protected owner area in the public world |
| Slots | 20 until a load test justifies more; view distance 6, simulation distance 4 |

### Why not a backend behind the private Velocity

- All `services.minecraft-servers` instances share one user and one environment file that
  holds the private forwarding secret and the RCON password
  (`hosts/bandit-lab/services/minecraft/nix-minecraft.nix`, the `minecraft-servers.env`
  template). A plugin exploit on a public Paper could forge a login as the operator.
- The private Velocity runs `online-mode = false` with VeloAuth for players without a paid
  account; the usage guidelines require paid accounts on a public server.
- PROXY protocol is a per-proxy setting and BotGate trusts the remote address. Turning it
  on for the shared proxy either breaks the bots or makes the bot allowlist spoofable.

## Resource caps

The container's Minecraft units get `MemoryMax=10G` (6G heap), `CPUQuota=300%`,
`MemorySwapMax=0`, a `TasksMax` and a low `IOWeight`. These caps are what keeps lag
machines away from the private world and Vaultwarden.

## Rules

1. No illegal content, threats or doxxing.
2. No crashing or lagging the server.
3. No advertising and no real-money trading.

Everything else is allowed. Mojang requires servers to be suitable for all ages, so the
anarchy covers gameplay, not chat.

### Chat minimum

- `enforce-secure-profile = true`, so Mojang chat reporting works.
- `/ignore`, a monitored report address, console mute and ban.
- Chat logs kept about 30 days and named in the privacy policy.
- A named adult answers reports within 48 hours and removes illegal content once notified.

### Technical guards (no combat or movement anti-cheat)

The main protection is structural: a fully pre-generated world inside the border means fly
and speed hacks never trigger world generation.

- `paper-global.yml`: keep the `packet-limiter`, `item-validation.book-size` and
  `spam-limiter` defaults; lower `chunk-loading-basic.player-max-chunk-load-rate` and
  `player-max-chunk-send-rate` to about 40; set `player-max-chunk-generate-rate` to a small
  value as a backstop.
- World defaults: `chunks.entity-per-chunk-save-limit` caps for projectiles and orbs;
  `chunks.prevent-moving-into-unloaded-chunks: true`; `collisions.max-entity-collisions: 2`;
  `misc.redstone-implementation: ALTERNATE_CURRENT`; anti-xray off.
- `server.properties`: `allow-flight = true` so vanilla does not kick flyers.
- TNT dupers stay on, as on the private world. Item dupes are patched, not punished.
- No exploit-fix plugin in phases 1 and 2. AnarchyExploitFixes is the candidate if exploits
  appear; its support for the pinned version is unverified.

## Monetization (phase 3 only)

Source: minecraft.net/en-us/usage-guidelines, read 2026-11-10.

- Sold: supporter rank (prefix and name colour, the real name stays visible), founder tag,
  Discord role, server-wide community goals such as "border +1,000 for everyone".
- Doubtful under competition: particles and trails (small and off in combat, or dropped).
- Never sold: operator or admin rights, priority queue or reserved slots, nicknames,
  `/home`, `/tpa`, `/back`, kits, crates and keys, currency, keep-inventory, extra storage,
  vanish, fly.
- Payment: Tebex as merchant of record (Starter: no monthly fee, 5% per transaction).
  Packages run LuckPerms group commands only.
- Required on the site and listings: the "not an official Minecraft product, not associated
  with Mojang or Microsoft" disclaimer.

Estimates: fixed cost about EUR 8 to 9 per month (relay, domain) plus EUR 3 to 5
electricity; a EUR 4 rank nets about EUR 3.20; break-even at 3 to 4 supporters.

## Longevity

- No reset. Disk growth comes from contents, not area: estimated under 10 GB at radius
  5,000 (measure after pre-generation).
- Backups: peer and off-host restic copy at the existing retention; a restore drill must
  pass before opening. The lab has a single NVMe.
- The public pair gets its own package pin so it upgrades independently of the private
  world. Worlds upgrade forward only: verified backup before each upgrade.
- Expand the border at each major version so new terrain exists.
- Address: an owner-held domain with an SRV record, so relay or host can move.

## Phases

### Phase 1: whitelisted testers over the tailnet

- bandit-craft: `hosts/bandit-lab/services/minecraft-public/default.nix` (the inside of the
  container: Velocity and Paper), exported from `flake.nix`; Chunky pinned in `plugins.nix`;
  `docs/runbooks/minecraft/PUBLIC.md`.
- bandit-nix: `hosts/bandit-lab/services/mc-public/default.nix` (the container, its veth
  rules and caps), imported in `hosts/bandit-lab/default.nix`; `ci/lab-mc-public.nix`
  registered in `flake.nix`.
- The check asserts: exact plugin list, no operators, no RCON, Velocity premium-only, own
  secret (never the private environment file), the caps, the veth rules, and that the game
  port is reachable on the container's `tailscale0` only.
- `lab-surface` and `lab-minecraft` pass unchanged.
- Runtime, before any tester: host `ss -ltn` shows nothing new; the container cannot reach
  the private RCON port, host loopback or the LAN; an offline-mode client is refused;
  private players and bots are unaffected; pre-generation size is measured.

### Phase 2: relay, still whitelisted

Velocity `haproxy-protocol = true`; relay configuration and runbook; backup job for the
public world. Runtime: real client addresses in the log; the relay reaches nothing but
tcp:25565; `tailscale ping` is direct; restore drill; spark profile with testers.

### Phase 3: open and store

Whitelist off, chat guards, Tebex plugin and secret, legal pages. A test purchase grants
and expires the group.

## Owner-only steps

Tailnet tag, ACL and auth key for the container; SOPS values; VPS and domain; an adult
Tebex and payout account; business and tax registration; imprint, privacy policy and terms
including parental consent for minors; signing and deploying.

## Risks

- Java or plugin remote code execution on the host that holds Vaultwarden and the SOPS
  secrets. The container reduces this; it does not remove kernel-escape risk. Fallback: the
  whole public server on a VPS.
- Legal exposure from chat, minors and unregistered commercial activity.
- Mojang enforcement over the all-ages requirement or pay-to-win.
- Home uplink and CPU headroom are unmeasured.
