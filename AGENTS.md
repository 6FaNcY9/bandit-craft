# bandit-craft — Agent Guide

The owner's Minecraft world and everything that plays in it or thinks for it: the Paper server behind
Velocity, its menus and kits; the Mineflayer bots (mcbots) and their Andy-4.2 brains (mcagents); the
model serving (lab Ollama, the gaming PCs' llama-server through SSH tunnels); the Windows tooling on
those PCs (slayer watcher, PC manager). Split out of `bandit-nix` on 2026-10-12 with its history.

## How it is deployed

- `bandit-nix` (github:6FaNcY9/bandit-nix, public) owns the hosts, secrets and deployment. It takes
  this repo as the flake input `bandit-craft` and imports the modules below into the `bandit-lab`
  host. A change here reaches the lab only when `bandit-nix` bumps the input in its signed
  `flake.lock` and the owner deploys (`lab-apply` on the laptop, fingerprint).
- Modules expect two module arguments from bandit-nix: `repoConfig` (its `lib/repository.nix`: lab
  and laptop tailnet addresses, `mkDockerNetwork`, ports) and `inputs`. Secrets are declared by name
  (`sops.secrets."mcbots-worker-token"`, `sops.templates."minecraft-velocity.env"`, `<pc>-tunnel-key`)
  and live encrypted in bandit-nix's `secrets/`. Contract checks over the composed lab
  (`lab-minecraft`, `lab-mcbots`, `lab-surface`, `local-privilege`) stay in bandit-nix.
- The paths kept their bandit-nix layout (`hosts/bandit-lab/services/...`, `tools/...`) so the split
  changed no behaviour; reorganising is allowed, but keep `nixosModules.lab` and bandit-nix in step.
- Windows tooling (`tools/slayer`, `tools/winpc`) is not built by Nix; it is installed on the PCs by
  its own scripts (payloads embedded, parity tested).

## Entry points

| Concern | Start here |
| --- | --- |
| Flake outputs | `flake.nix` (`nixosModules.lab`, `checks`) |
| Minecraft server, proxy, sandbox, menus, kits | `hosts/bandit-lab/services/minecraft/` (`kits.nix`, `commandpanels/`, `stage.sh`), `docs/runbooks/minecraft/{ADMIN,PROXY,PANEL,MIGRATION}.md` |
| Bots (hub, dashboard, jobs, plan) | `hosts/bandit-lab/services/mcbots/` (`app/`, tests `app/test.js` runs `app/test/<topic>.js`), `docs/runbooks/minecraft/BOTS.md` |
| Agents (Andy-4.2), replay, judge, training data | `hosts/bandit-lab/services/mcagents/`, `tools/mcagents/` (`*.test.js`), `docs/runbooks/minecraft/AGENT-TRAINING.md` |
| Model serving | `hosts/bandit-lab/services/ollama/`, `hosts/bandit-lab/services/llamacpp/` (PC tunnels) |
| Gaming PCs (Windows) | `tools/slayer/` (watcher, installer, tests, README), `tools/winpc/` (PC manager) |
| Plans and designs | `docs/specs/` |

## Rules

- Never commit secrets, private keys, tokens or per-device data (Tailscale node IDs, MAC addresses,
  account passwords). Installers take device data as parameters; secrets stay in bandit-nix SOPS.
  This repo is public: security must come from keys, Tailscale identity and the owner's fingerprint,
  never from the code being unknown.
- Security must not get weaker for convenience: no passwordless privilege, admin actions on the PCs
  only with the owner's fingerprint (`docs/specs/2026-10-12-windows-pc-manager.md`).
- The owner signs and pushes. Agents commit unsigned in a worktree; the owner ships. Ask the owner
  only for sudo, GPG unlock, SOPS values, in-game actions and fingerprint approvals.
- Changes that restart `docker-minecraft` disconnect players; prefer shipping them when nobody plays.
  Menu (`commandpanels`, `kits.nix`) changes reload live and need no restart.
- Keep slayer and albert apart: slayer may run hot and loud (guard 90 °C); albert must stay quiet
  (short packets, fans held low).

## Verification

- Nix: `nix fmt -- <files>`, `nix flake check` here, and in bandit-nix with this checkout:
  `nix build --override-input bandit-craft git+file://$PWD .#nixosConfigurations.bandit-lab.config.system.build.toplevel`
  plus its checks. Evaluation alone is not enough: build the lab before handing over.
- Node: `node tools/mcagents/<x>.test.js` (all of them), mcbots `app/test.js` (see BOTS.md for the
  NODE_PATH line); one topic alone: `node app/test/<topic>.js`.
- Windows: copy the scripts to a temp folder on the PC and run `test-watch.ps1`, `test-install.ps1`
  (and the winpc tests); regenerate installer payloads after editing an embedded script.
- Kits: `tools/minecraft-kit-check` tries every give command on the server.
