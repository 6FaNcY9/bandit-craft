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

1. Owner: create the guild + `bandit-admin` application, add SOPS `discord-admin-token`,
   send the guild ID.
2. Agent: writing-plans for phase 1 (admin bot: layout + alerts), then build and test.
3. Phases 2 to 4 as in the design.

## How to reach this session

Other local Claude sessions can message it with `SendMessage` (see `ListAgents`). If it is gone,
the work state list and this file are the source of truth.
