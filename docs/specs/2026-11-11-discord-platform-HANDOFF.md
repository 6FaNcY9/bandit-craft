# Handoff: Discord platform (2026-11-11)

For any session that wants to pick this up, steer it or connect its own work to it.

- **Design:** `docs/specs/2026-11-11-discord-platform.md` (this branch). Read it first; the
  "agent's call" items are open to change, the owner's choices are not.
- **Branch / worktree:** `feat/discord-platform` in `~/src/bandit-craft-discord`, from
  `origin/main` 656e90c. Unsigned commits only; the owner signs and pushes.
- **Live state tracker:** claude-mem work state list `discord-platform` (read it with
  `work_state_read`, write with `work_state_write`). Put decisions and blockers there so both
  sessions see them.
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
2. Not shipped yet, on this branch on top of main: a660558 (refused server settings no longer stop the
   bot; invite link in the launch material) and 8d1e6ac (launch target). Ship them with the next change;
   `tools/craft-bump` needs the full 40-character sha (a short one goes through GitHub's rate-limited API).
3. Set by hand in the client, not by the bot: rules channel `#regeln-rules`, updates channel `#mod-log`,
   rules screening with four rules, the permanent invite. See the design's phase list.
4. Launch: target and blockers are in the design ("Launch target"). The tunnel is the mc-public session's
   work; the status ping still got no answer on 2026-11-11 04:55.
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
   shown in the game for a Discord message. Still the owner's call: an exception per player, joint controllership,
   and a second look at the list on the day of publishing.
9. claude-mem was removed on 2026-11-11: this file is the live tracker now, not a work state list.

10. Advertising: the owner asked for it on 2026-11-11. Posted that day with the owner's yes, from the owner's X
    account: the short English teaser (no date, no address, Discord invite). Not done: server lists (each needs an
    account the owner creates, and the address only makes sense once the whitelist is off), other Discord servers
    (the owner names server and channel). The owner's step list is `~/Downloads/bandit-werbung-plan.md`.

## How to reach this session

Other local Claude sessions can message it with `SendMessage` (see `ListAgents`). If it is gone,
the work state list and this file are the source of truth.
