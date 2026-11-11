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
6. Phase 3 (chat bridge) is built and tried on the local stand, not deployed: plugin `minecraft-public/chatbridge`
   here, bandit-nix branch `feat/discord-bridge` (one commit, worktree `~/src/bandit-nix-bridge`). It cannot build
   on the lab before the owner has made the application `bandit-bridge` (Message Content Intent on, Public Bot
   off), invited it and put its token into `secrets/lab.yaml` as `discord-bridge-token`. Shipping restarts the
   public Paper. Once the bot is in the guild, set `BRIDGE_ID` in `discord-admin/default.nix` to its application id
   (shuts it out of the other open channels; a security review's finding, see PUBLIC.md). The privacy policy draft
   names the bridge. Runtime check after the deploy: chat both ways in
   `#ingame-chat`, `@everyone` typed in the game does not ping, the private world is untouched.
7. Owner's open calls: delete Discord's default channels (`rules`, `moderator-only`, both `Allgemein`);
   switch "Public Bot" off for `bandit-admin` in the developer portal.

## How to reach this session

Other local Claude sessions can message it with `SendMessage` (see `ListAgents`). If it is gone,
the work state list and this file are the source of truth.
