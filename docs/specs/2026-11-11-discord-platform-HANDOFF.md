# Handoff: Discord platform (2026-11-11)

For any session that wants to pick this up, steer it or connect its own work to it.

- **Design:** `docs/specs/2026-11-11-discord-platform.md` (this branch). Read it first; the
  "agent's call" items are open to change, the owner's choices are not.
- **Branch / worktree:** `feat/discord-platform` in `~/src/bandit-craft-discord`, from
  `origin/main` 656e90c. Unsigned commits only; the owner signs and pushes.
- **Live state tracker:** this file (claude-mem was removed on 2026-11-11). Put decisions and
  blockers here so both sessions see them.
- **Laptop client:** Vesktop added in bandit-nix `modules/user/desktop/discord.nix`
  (uncommitted in `~/src/bandit-nix`, built OK, owner runs `git pull --ff-only && nrs`).

## Where it touches other work

- **Public world (`mc-public`, `~/src/bandit-craft-public`, branch `mc-public-followup`):** the
  chat bridge adds a plugin to the public Paper and changes `ci/lab-mc-public.nix`'s exact plugin
  list. The status ping uses the playit address `impairment-peterson.tun.ply.gg`. If the public
  world's address, plugin list or phases change, update the design here.
- **Bots hub / Kommandostand (`~/src/bandit-craft-fleet`, `feat/bot-menus-2a`):** bot control
  from Discord calls the hub's HTTP API with its own token. Do not change the API shape
  without noting it here.
- **Legal drafts (`ad43699`):** privacy policy must name the Discord bridge before opening.

## Next steps

1. Live since 2026-11-11 04:30: phases 1 and 2 (layout, lab alerts, teaser, rules, join and status texts),
   shipped as bandit-craft a6e76d5 and bandit-nix 513820c. Checked live: layout, a real alert in
   `#lab-alerts`, role preview (Moderator sees MODERATION, `@everyone` neither it nor ADMIN).
2. Shipped: everything up to e2be802 is on main and on the lab. Only docs commits wait on this branch
   (no restart, no bump needed). `tools/craft-bump` needs the full 40-character sha (a short one goes
   through GitHub's rate-limited API).
3. Set by hand in the client, not by the bot: rules channel `#regeln-rules`, updates channel `#mod-log`,
   rules screening with four rules, the permanent invite. See the design's phase list.
4. Launch: target and blockers are in the design ("Launch target"). The tunnel (playit.gg) answers since
   2026-11-11: the owner joined through `impairment-peterson.tun.ply.gg:24924` at 14:30. Open blockers:
   tester round with real players, legal pages (item 11), whitelist off.
5. Phase 4 (bot control) is live since 2026-11-11 05:29 (bandit-craft 4438bc9, bandit-nix cb7a165):
   `/bots status | stopp | weiter` in `#bot-kommando` through the hub's `/api/remote/` door. Checked live as
   the owner: `status` lists the eight bots; `stopp` and `weiter` with a name that does not exist are answered
   by the hub ("Diesen Bot gibt es nicht.", "Kein pausiertes Projekt.") and stand in its log under `[remote]`.
   Not checked: stopping and resuming a real bot from Discord, and that a second account with the Moderator
   role does not see the command.
6. Phase 3 (chat bridge) is live since 2026-11-11 07:18: plugin `minecraft-public/chatbridge` here, application
   `bandit-bridge` (id in `discord-admin/default.nix` as `BRIDGE_ID`; Public Bot off, Message Content Intent on),
   token in bandit-nix `secrets/lab.yaml` as `discord-bridge-token`. Checked in Discord: the bot is online in
   `#ingame-chat` and, after the invite and a restart of `discord-admin`, gone from `#chat` (Discord drops the
   denial for a bot that is not a member yet, without an error). Checked with the owner in the game on
   2026-11-11 14:30: join, chat and death lines arrive in `#ingame-chat`; `**test**` from the game stays text;
   `@everyone` from the game is drawn as a mention but the line is not highlighted for the owner (no ping).
   A link typed in the game (`https://example.com`, 14:38) is plain text in Discord, not a link.
   Not confirmed in the owner's words: that a Discord message shows in the game (two were sent at 14:36 while the
   owner was in the game; the owner answered "done"). The plugin's
   log needs root: `sudo journalctl -M mc-public -u minecraft-server-paper | grep -i "chat bridge"`. The privacy
   policy draft names the bridge; its open points 13-15 are the owner's call.
   Live since 2026-11-11 14:12 (bandit-craft e2be802, bandit-nix 7e69748): the bridge deletes its own messages in
   `#ingame-chat` after 30 days (owner's decision 2026-11-11; no new right for any bot). The bot was online in
   Discord again after that restart. Tried in `SelfTest` and `e2e-chat.js`, not against the real Discord:
   deleting messages older than two weeks one by one is slow there (429), the plugin waits as told.
7. Done in the client 2026-11-11 with the owner's yes: all four of Discord's default channels are deleted
   (`rules`, `moderator-only`, both `Allgemein`), the safety notifications channel is `#mod-log` (it was unset),
   and "Public Bot" is off for `bandit-admin` (its install link had to be set to "None" first). The guild has no
   system channel now, so Discord posts no "joined" lines. Left: the empty categories `Textkanäle` and
   `Sprachkanäle`.

8. Privacy points checked by the agent on 2026-11-11 (written into `docs/public/DATENSCHUTZ.md`, points 13 and 15):
   Discord, Inc. is listed as active for the EU-U.S. Data Privacy Framework; the server log keeps only the line
   shown in the game for a Discord message. Decided by the agent on 2026-11-11 after the owner handed over the open points: no exception per
   player for now (point 14). Still the owner's call: joint controllership, and a second look at the list
   on the day of publishing.
9. claude-mem was removed on 2026-11-11: this file is the live tracker now, not a work state list.

10. Advertising: the owner asked for it on 2026-11-11. Posted that day with the owner's yes, from the owner's X
    account: the short English teaser (no date, no address, Discord invite). Not done: server lists (each needs an
    account the owner creates, and the address only makes sense once the whitelist is off), other Discord servers
    (the owner names server and channel). The owner's step list is `~/Downloads/bandit-werbung-plan.md`.
    Agent's calls on 2026-11-11 under the owner's "decide yourself": no posting in other Discord servers and no
    listing bot (Disboard and the like) before the opening; no German X post (the owner chose English).
    Tester round: the owner knows nobody to ask, so with the owner's yes a call "Looking for 5 testers" went
    out on 2026-11-11 15:31 from the owner's accounts, on X and in `#ankündigungen` (no address; testers post
    their Minecraft name in `#hilfe`). Later that day on X: the tester call is pinned, the profile has a short
    bio and the Discord invite as website. The profile then showed only one post (the tester call): the earlier
    English teaser is not on the profile. A German tester call was typed into X but not sent (the agent's click
    was refused by the auto-mode check; the owner may press Post). Checked for other places: Bluesky, Threads,
    Planet Minecraft and Minecraft Forum have no logged-in account in the owner's Chrome; Disboard shows a
    Cloudflare check. Reddit is blocked for the agent's browser. The owner then posted the German tester call on
    X, and signed in to Planet Minecraft with Discord; with the owner's yes (question dialog, exact text) the agent
    renamed that account to VinoBandit and opened one thread in Java Edition > Servers:
    https://www.planetminecraft.com/forums/minecraft/servers/java-26-2-bandit-anarchy-anarchy-that-never-resets-looking-for-testers-711072/
    Section rule: one advertising thread per server. At the opening, reply in that thread with the address
    instead of opening a new one. Recruiting staff belongs in "Teams". The section is quiet (new threads get
    2 to 20 views). Next: watch `#hilfe`; the owner whitelists each name on the lab
    (laptop helper `sh ~/tester.sh <Name>`, not yet run against the lab; it sends the runbook's `whitelist add`
    to the console, PUBLIC.md) and sends the address privately.
11. Legal drafts (`docs/public/`), 2026-11-11: server name and address are filled in. Found while filling
    them: the privacy text said "relay in the EU, processor under Art. 28", but the server runs through the
    free playit.gg tunnel of Developed Methods LLC, USA, which is not on the Data Privacy Framework list and
    names no processing agreement. The owner decided the same day: stay with playit.gg, no VPS relay. The
    text now names the provider, says there is no processing agreement and no adequacy decision, and bases
    the transfer on Art. 49(1)(b) GDPR (the agent's wording, not legally reviewed; the risk is in open
    point 4). Left open in the privacy text: how long operating statistics are kept (open point 1; no
    collector for the public world exists in this branch). Name, town (owner's choice: town only, no
    street, because of doxxing) and date are filled in. Still placeholders: `<KONTAKT-MAIL>` and `<MELDE-MAIL>`;
    the owner makes one new mailbox for both (not the private one; agents may not create accounts).
    Decided 2026-11-11 evening: the owner's existing Cloudflare domain `atmosphaere.at` (no website with personal
    data, per the owner). The legal texts now say `admin@atmosphaere.at` (contact) and `help@atmosphaere.at`
    (reports). They work only after the owner runs `~/bandit-domain.sh` (laptop, asks for a Cloudflare API token;
    tested only against a fake API) and confirms Cloudflare's verification mail. The script deletes the domain's
    old MX and SPF records of a former host (TheHost; owner: nobody uses them), enables Email Routing, forwards
    both addresses to the owner's inbox and adds the SRV record `_minecraft._tcp.bandit.atmosphaere.at` -> the
    playit address. Done the same evening: the owner ran the script (with a token already in the laptop shell),
    confirmed the destination address; MX now points to Cloudflare, both rules exist, and a status ping
    through `bandit.atmosphaere.at` (SRV, node-minecraft-protocol) answered "Paper 26.2, 0/20". The legal texts
    and the ad plan now use `bandit.atmosphaere.at`. Not yet: a real join through the name, a test mail to
    admin@, and the admin bot's `#adresse-join` text (still the playit address, code in discord-admin).

## How to reach this session

Other local Claude sessions can message it with `SendMessage` (see `ListAgents`). If it is gone,
this file is the source of truth.
