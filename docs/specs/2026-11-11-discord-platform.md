# Discord platform for the public world (design, 2026-11-11)

Status: written by the agent on 2026-11-11. The owner chose the four parts and a public audience,
then said "continue" without further questions, so every other decision below is the agent's
call and is marked as such. Nothing here is built or deployed.

## Goal

A public Discord server that belongs to the public anarchy world
(`docs/specs/2026-11-10-public-anarchy-world.md`, address `impairment-peterson.tun.ply.gg`
through the playit tunnel). Strangers find the rules, the address and the events there. They
also talk to in-game players. The owner gets status and lab alerts in a private channel and can
steer the private world's bots from Discord.

Owner's choices: community server, chat bridge, status and alerts, bot control; public audience.

## Non-goals and anti-goals

- No Discord feature may widen the attack surface of the private world, the bots' hub,
  Vaultwarden or the lab host. A public Discord member must never reach a bot command.
- No paid perks in Discord before phase 3 of the public world (store, legal pages).
- No new moderation promises beyond what the public world's rules already make (a named adult
  answers reports within 48 hours).
- No linking of Discord accounts to Minecraft accounts in this design (later, if wanted).

## Decisions (agent's calls unless noted)

| Topic | Decision |
| --- | --- |
| Guild creation | The owner creates the guild in the client (bots may not create guilds) and enables the Community feature |
| Two Discord applications | **Bridge bot** (chat only) runs inside `mc-public`. **Admin bot** (layout, status, alerts, bot control) runs on the lab host. A remote code execution in the public Paper then leaks only a token that can post chat |
| Layout as code | The admin bot applies a declared layout (roles, categories, channels, permission overwrites) on start, idempotently: it creates missing items and fixes the permissions of those it manages. It never deletes anything it did not create |
| Bot control access | Slash commands registered for the guild only, `default_member_permissions = 0` (hidden from everyone), and the handler also checks the caller's Discord user ID against a fixed allow-list (owner, later Misa). Commands are accepted only in `#bot-kommando`, visible to the Owner role only |
| Bot control scope, first cut | Read: fleet status and what each bot does. Write: stop all, stop one, resume. Everything else stays in BotUi/Kommandostand until it is asked for |
| Status | The admin bot pings the public world with the server-list protocol through the playit address (no RCON exists there) and keeps one message in `#server-status` up to date: online, player count, version |
| Alerts | Lab alerts that go to ntfy today also go to `#lab-alerts` (owner only): the admin bot subscribes to the ntfy topics and posts them, so no webhook secret is needed. ntfy stays the primary path |
| Chat bridge | DiscordSRV (or an equivalent; the pinned Paper version decides) in the public Paper, bound to `#ingame-chat` only. Join, leave and death messages go there too. Discord to game: plain text only, no mentions, no attachments, and the bridge refuses messages from accounts younger than 7 days |
| Language | German and English. Rules and welcome text in both; channel names in English |
| Runtime and code | The admin bot is Node like `mcbots`, with discord.js packaged through Nix (`buildNpmPackage`). It runs as a hardened systemd service on the lab, the same way as the other bot services |
| Secrets | Both tokens are SOPS values in bandit-nix, set by the owner. The bridge token is the only Discord secret that enters `mc-public` |

## Guild layout (agent's call)

Roles: `Owner`, `Moderator`, `@everyone` (read-only on the info channels). A `Spieler` role was
dropped in phase 1: Discord's rules screening already keeps `@everyone` from writing before the
rules are accepted, with no bot needed. Discord's own `#rules` and `#moderator-only` stay; the bot
points the guild's rules and updates channels at `#regeln-rules` and `#mod-log`.

- **INFO**: `#regeln-rules` (read-only, the public world's rules), `#ankündigungen` (read-only,
  events from `docs/specs/2026-11-10-public-world-events.md`), `#server-status` (read-only, bot
  message), `#adresse-join` (address, version, how to join)
- **COMMUNITY**: `#chat`, `#screenshots`, `#bauprojekte`, `#hilfe`
- **INGAME**: `#ingame-chat` (bridge)
- **MODERATION** (Owner, Moderator): `#meldungen` (the report address of the public world's
  rules, as a channel), `#mod-log` (AutoMod and bridge actions)
- **ADMIN** (Owner only): `#lab-alerts`, `#bot-kommando`

Server settings: verification level High, explicit-content filter for all members, AutoMod
with Discord's preset lists plus spam and mention-spam rules, Community onboarding with the
rules screen. Discord's own minimum age for the member's country applies; this is not verified
here.

## Phases

1. **Guild and alerts.** Owner steps: create the guild, the admin-bot application, the SOPS
   values. Agent: admin bot with the layout and `#lab-alerts`. Runtime check: the layout exists,
   a test alert arrives, a non-owner account sees neither ADMIN nor any slash command.
   Built 2026-11-11 (`hosts/bandit-lab/services/discord-admin`, plan
   `2026-11-11-discord-phase1-plan.md`): Discord REST through Node's `fetch`, no npm dependencies
   (discord.js arrives with the gateway in phase 4); alerts are read from ntfy topic `mcbots`
   with the existing read-only user. The rules screening ("Serverregeln", four rules) and the guild's rules and updates channels are set in the client
   (the bot's PATCH for the two channels got 403 on the first deploy); the permanent invite is https://discord.gg/gztQRPwkvj.
2. **Status.** `#server-status` updates within one minute of the public world going down or up.
   Built 2026-11-11 together with the launch teaser the owner asked for: the bot keeps one message
   each in `#ankündigungen` (pitch), `#regeln-rules`, `#adresse-join` and `#server-status`
   (`app/texts.js`, German and English). Until the opening they tease and hide the address; the
   opening is the one value `LAUNCH_AT` in the module (unix seconds; empty means "soon", a date
   gives Discord's own live countdown `<t:…:R>`). From that moment the address and the live status
   show, so the whitelist must be off by then. Two lost pings in a row mean offline (30 s apart).
   Launch texts for server lists and the teaser page: `docs/marketing/`.

   **Launch target (owner, 2026-11-11): Saturday 2026-12-05, 18:00 Europe/Vienna.** Internal until the
   blockers are done; the texts keep saying "soon" meanwhile, because a moved date costs more trust than
   a late announcement. Blockers: the public address answers a status ping (it did not on 2026-11-11), a
   tester round with real players, the restore drill, the legal pages, the whitelist off at the opening.
   To announce: `LAUNCH_AT = "1796493600"` in `hosts/bandit-lab/services/discord-admin/default.nix`,
   `LAUNCH = Date.UTC(2026, 11, 5, 17, 0)` in `docs/marketing/teaser/index.html` (republish it), the
   date into `docs/marketing/2026-11-11-launch-texts.md`, then deploy. Posts: teaser one to two weeks
   before, a reminder about 24 hours before, server-list entries with the address only at the opening.
3. **Chat bridge.** Bridge application and SOPS value; plugin pinned in `plugins.nix`. This
   changes the public world's "exact plugin list", so bandit-nix `ci/lab-mc-public.nix` gains the
   plugin in the same change. Runtime check: chat both ways, mentions are stripped, the private
   world is unaffected.
4. **Bot control.** Admin-bot commands against the hub's existing HTTP API with its own token.
   Runtime check: each command from the owner works; the same command from a test account with
   the Moderator role is refused and logged.
   Built 2026-11-11 (`app/control.js`, `app/gateway.js`; hub side `mcbots/app/remote.js`, see BOTS.md
   "Discord: `/api/remote/`"): `/bots status`, `/bots stopp [bot]`, `/bots weiter [bot]`, without a name
   for all. Agent's calls, different from the table above:
   - The hub had no token access at all (only the Tailscale login, which is full admin with the console),
     so it got a door of its own that offers status, stop and resume and nothing else. The token is derived
     from the worker token on the lab; no new SOPS value.
   - The allow-list is the guild's owner, read from Discord at start, not a list in the code. Misa is added
     when she is to use it.
   - No discord.js: the gateway is read with Node's own WebSocket, without intents, so the bot still has no
     npm dependency. It does not resume a session; a command typed during a reconnect is typed again.
   - A refused command is answered only to the caller, written to the journal and posted in `#lab-alerts`.
   - `weiter` resumes paused projects only (what the dashboard's Resume does); jobs that were not a
     project are given again in the game or on the dashboard.

The privacy policy and terms drafts (`ad43699`) must name the Discord bridge (game chat is
copied to Discord and back) before phase 3 goes live.

## Owner-only steps

- Create the guild; enable Community; hand the agent the guild ID.
- Discord developer portal: two applications (`bandit-admin`, `bandit-bridge`), bot tokens,
  invite both with the scopes and permissions the runbook will list.
- Add the SOPS values in bandit-nix: `discord-admin-token`, `discord-bridge-token`.
- Name the moderators; sign and deploy.

## Left to the builder

The hub endpoints for status and stop/resume (see `docs/runbooks/minecraft/BOTS.md` and
`docs/specs/2026-11-04-kommandostand.md`); which bridge plugin supports the pinned Paper; the exact
Discord permission bits; which ntfy topics the admin bot subscribes to and with which credentials.
