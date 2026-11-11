# Discord admin bot, phase 1 (guild layout + lab alerts): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `bandit-admin` bot applies the declared guild layout on start and mirrors the lab's ntfy alerts into `#lab-alerts`.

**Architecture:** One small Node 22 program with no npm dependencies: Discord REST through the built-in `fetch`
(phase 1 needs no gateway: the Create Message docs no longer require an identify, checked 2026-11-11), the ntfy
JSON stream through `fetch` as well. It runs as a hardened `DynamicUser` systemd service on the lab. discord.js
arrives with phase 4, when slash commands need the gateway.

**Tech Stack:** Node 22 (`pkgs.nodejs_22`), `node:test`, NixOS module, sops-nix.

**Spec:** `docs/specs/2026-11-11-discord-platform.md`

## Global Constraints

- Guild `1569890251738980352`, application `1569888618808348732`. Not secret (the repo is public; the token is).
- Bot permissions are only `268520496` (Manage Channels, Manage Guild, View, Send, Embed, History, Manage Roles):
  overwrites may only allow or deny bits from that set, and new roles get `permissions: "0"`.
- "It never deletes anything it did not create": the bot never sends DELETE. It creates missing items and PATCHes
  the parent and permission overwrites of the channels it declares, and only when they differ.
- Every message the bot posts carries `allowed_mentions: {parse: []}`; content is cut to 2000 characters.
- Token only from `$CREDENTIALS_DIRECTORY/token` (sops `discord-admin-token`, owner-set). ntfy reads with the
  existing read-only user (`/var/lib/mcbots/ntfy/read-credentials`, `Username: …` / `Password: …`, access
  `phone:mcbots:ro`), so no new ntfy user and no change to ntfy's one-time seed.
- ntfy topic `mcbots` at `http://127.0.0.1:2586` is the only alert source (Grafana alerts, unit failures,
  Jerry-box reports and bot events all publish there today). ntfy stays the primary path.

## Deviations from the design (agent's calls, recorded in the spec in Task 3)

- Role `Spieler` dropped: Discord's rules screening gates `@everyone` before they can write, with no bot needed for
  onboarding. Roles are `Owner` and `Moderator`.
- Discord's own `#rules` and `#moderator-only` stay; the bot points the guild's rules channel at `#regeln-rules` and
  its updates channel at `#mod-log`. The owner may delete the two old ones.
- Onboarding and rules screening are switched on in the client (no stable API), as part of the runtime check.

## Review Focus

1. A second start against a fully built guild sends no write: same names, same overwrites → zero POST/PATCH.
2. Discord returns 429: the call waits `retry_after` seconds and retries instead of failing the start.
3. The ntfy stream drops (ntfy restart): the bot reconnects with `since=<last id>` and loses no alert.
4. Alert text with `@everyone` or `<@&role>` pings nobody (allowed_mentions empty), and a 5000-character alert posts cut to 2000.
5. A channel someone renamed back by hand, or one that sits in the wrong category, is moved back, not duplicated.

---

### Task 1: Layout planner (pure) and its tests

**Files:**
- Create: `hosts/bandit-lab/services/discord-admin/app/layout.js`
- Test: `hosts/bandit-lab/services/discord-admin/app/layout.test.js`

**Interfaces:**
- Produces:
  - `LAYOUT`: `{roles: ["Owner","Moderator"], categories: [{name, access, channels: [names]}]}` with access
    `"readonly" | "open" | "mods" | "owner"`. INFO (readonly): `regeln-rules`, `ankündigungen`, `server-status`,
    `adresse-join`; COMMUNITY (open): `chat`, `screenshots`, `bauprojekte`, `hilfe`; INGAME (open): `ingame-chat`;
    MODERATION (mods): `meldungen`, `mod-log`; ADMIN (owner): `lab-alerts`, `bot-kommando`.
  - `overwrites(access, ids) -> [{id, type, allow, deny}]`, `ids = {guild, owner, moderator, bot}`, sorted by id,
    allow/deny as decimal strings. Bits: VIEW 1024, SEND 2048, EMBED 16384, HISTORY 65536; BOT = 84992.
    readonly: `@everyone` deny SEND, bot (type 1) allow BOT. open: `[]`. mods: `@everyone` deny VIEW, Owner and
    Moderator allow VIEW, bot allow BOT. owner: as mods without Moderator.
  - `diffChannel(want: {name, type, parent_id, permission_overwrites}, have: channel|undefined) -> null | {create: body} | {patch: body}`;
    the patch contains only the fields that differ (overwrites compared after sorting, as strings).

- [ ] **Step 1: Write the failing tests** (`node:test`, `assert/strict`): `overwrites("readonly", ids)` equals the exact
  two entries above; `overwrites("open", ids)` is `[]`; `diffChannel(want, undefined)` gives `{create: want}`;
  `diffChannel(want, identicalHave)` is `null` even when `have` lists overwrites in another order and carries extra
  fields (`id`, `position`, `topic`); a `have` with another `parent_id` gives `{patch: {parent_id}}` only;
  every overwrite allow/deny bit is a subset of `268520496`.
- [ ] **Step 2: Run** `node --test` in `hosts/bandit-lab/services/discord-admin/app/` → FAIL (module missing).
- [ ] **Step 3: Implement** `LAYOUT`, `overwrites`, `diffChannel` in `layout.js` (CommonJS, like mcbots).
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat(discord): layout planner for the admin bot`.

### Task 2: REST client, layout apply, alert relay, entry point

**Files:**
- Create: `hosts/bandit-lab/services/discord-admin/app/main.js`, `app/alerts.js`
- Test: `hosts/bandit-lab/services/discord-admin/app/alerts.test.js`

**Interfaces:**
- Consumes: Task 1's `LAYOUT`, `overwrites`, `diffChannel`.
- Produces:
  - `alerts.js`: `toDiscord(event) -> {content, allowed_mentions: {parse: []}} | null` (null unless
    `event.event === "message"`; content `**<title>** ` (title only if present), `⚠️ ` for priority ≥ 4, then the
    message, cut to 2000); `readCredentials(text) -> {user, password}`;
    `subscribe({url, auth, onMessage, log})`: endless loop over `GET <url>/json[?since=<lastId>]` with basic auth,
    one JSON object per line, reconnect after 5 s, `since` set from the last event id seen.
  - `main.js`: `api(method, path, body)` against `https://discord.com/api/v10` with `Authorization: Bot <token>`,
    `User-Agent: DiscordBot (https://github.com/6FaNcY9/bandit-craft, 1)`; on 429 sleep `retry_after` s and retry;
    other non-2xx throws with status and body. `applyLayout()`: GET `/users/@me`, `/guilds/{g}/roles`,
    `/guilds/{g}/channels`; POST missing roles; categories (type 4) then text channels (type 0) through
    `diffChannel`; PATCH `/guilds/{g}` with `verification_level: 3`, `explicit_content_filter: 2`,
    `rules_channel_id`, `public_updates_channel_id` only when different; AutoMod rules created by name if missing
    (`Bandit: Wortlisten` keyword preset with presets 1,2,3; `Bandit: Spam` trigger 3; `Bandit: Mentions` trigger 5
    with `mention_total_limit: 5`), each with a block action and an alert action to `#mod-log`. Returns the
    `lab-alerts` channel id. Then `subscribe` posts each `toDiscord` result to it; a failed post is logged, not fatal.
    A failed `applyLayout` exits 1 (systemd restarts it).
  - Environment: `GUILD_ID`, `NTFY_URL` (`http://127.0.0.1:2586/mcbots`), `CREDENTIALS_DIRECTORY` with `token`, `ntfy`.

- [ ] **Step 1: Write the failing tests** in `alerts.test.js`: `toDiscord({event:"keepalive"})` is null; a message with
  title `Unit failed: x`, priority 4, body `@everyone hi` gives content `**Unit failed: x** ⚠️ @everyone hi` and
  `allowed_mentions` `{parse: []}`; a 5000-character body gives content length 2000;
  `readCredentials("Username: phone\nPassword: abc\n")` is `{user: "phone", password: "abc"}`;
  `subscribe` against a local `http.createServer` that sends one message line and closes, then on the second request
  must see `?since=<that id>` (assert, then stop the loop through an `AbortSignal` option).
- [ ] **Step 2: Run** `node --test` in `hosts/bandit-lab/services/discord-admin/app/` → FAIL.
- [ ] **Step 3: Implement** `alerts.js` and `main.js` (`subscribe` takes `signal` for the test; `main.js` runs only
  under `require.main === module`).
- [ ] **Step 4: Run** → PASS. Also `node -e 'require("./hosts/bandit-lab/services/discord-admin/app/main.js")'` loads without side effects.
- [ ] **Step 5: Commit** `feat(discord): admin bot applies the guild layout and relays ntfy alerts`.

### Task 3: NixOS module, flake check, docs

**Files:**
- Create: `hosts/bandit-lab/services/discord-admin/default.nix`
- Modify: `flake.nix` (`nixosModules.lab.imports`, `checks.discord-admin`), `docs/specs/2026-11-11-discord-platform.md`
  (deviations above, phase 1 "built"), `docs/specs/2026-11-11-discord-platform-HANDOFF.md` (next steps)

- [ ] **Step 1: Module.** `sops.secrets."discord-admin-token".mode = "0400"`; `systemd.services.discord-admin`:
  `wantedBy multi-user`, `after/wants network-online.target ntfy-sh.service`, `ExecStart = node ${./app}/main.js`
  (`pkgs.nodejs_22`), `LoadCredential = ["token:<sops path>" "ntfy:/var/lib/mcbots/ntfy/read-credentials"]`,
  `Environment` GUILD_ID/NTFY_URL, `Restart = on-failure`, `RestartSec = 30s`, and the mcagents hardening set
  (DynamicUser, NoNewPrivileges, empty CapabilityBoundingSet, ProtectSystem strict, ProtectHome, PrivateTmp,
  PrivateDevices, ProtectKernel*, ProtectControlGroups, LockPersonality, RestrictNamespaces,
  SystemCallFilter `@system-service`, MemoryMax 256M) with `RestrictAddressFamilies = AF_UNIX AF_INET AF_INET6`
  and no IP allow-list (discord.com has no fixed addresses).
- [ ] **Step 2: Flake.** Import the module in `nixosModules.lab`; add `checks.discord-admin`: a `runCommand` that
  copies `app/` and runs `node --test` in it.
- [ ] **Step 3: Verify** `nix fmt -- <nix files>`, `nix flake check`, then in a bandit-nix worktree from origin/main
  (with the owner's encrypted `secrets/lab.yaml` copied in): `nix flake update bandit-craft --override-input …` build
  of `.#nixosConfigurations.bandit-lab.config.system.build.toplevel` and the `sops-isolation`, `lab-surface`,
  `local-privilege` checks → all pass.
- [ ] **Step 4: Docs + commit** `feat(discord): admin bot service on the lab`.

### Runtime check (after the owner deploys)

`ssh bandit-lab systemctl status discord-admin` active; the guild shows the five categories and the roles; a second
restart logs zero writes; `curl` publish of a test message to ntfy `mcbots` (as the publisher on the lab) shows up in
`#lab-alerts`; in the browser: rules screening on, and a non-owner view (role preview "View server as role") sees
neither MODERATION nor ADMIN.
