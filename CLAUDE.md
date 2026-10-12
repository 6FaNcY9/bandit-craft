@AGENTS.md

## Claude Code

- `AGENTS.md` is the single source of truth for this repository; keep shared guidance there.
- The roles `scout`, `worker`, `architect` are the user-level subagents in `~/.claude/agents/`
  (`~/.claude/CLAUDE.md`). Subagents start cold: do small and medium work inline, run at most one
  writing subagent at a time, and tell the owner (one line, with why) before launching one.
- Codex (`codex exec`) may implement bounded chunks in a separate worktree and does read-only review
  rounds (`codex exec -s read-only -C <worktree> -o <out.md> "<prompt>" < /dev/null`); review its
  output line by line before committing.
- The owner sets goals, not implementation: decide details yourself, test, commit, and report in plain
  German. Ask only for sudo, GPG unlock, SOPS values, in-game actions and fingerprint approvals.
- Shipping: commit here (unsigned, in a worktree); the owner pushes this repo; then bump the
  `bandit-craft` input in bandit-nix (worktree from origin/main, `nix flake update bandit-craft`,
  build the lab), and the owner ships that with `tools/ship-claude` and deploys with `lab-apply`.
