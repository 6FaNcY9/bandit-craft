# bandit-craft

The owner's Minecraft server and the bots that play on it: Paper behind Velocity with menus and kits,
Mineflayer bots with Andy-4.2 agents, model serving on the lab and on gaming PCs, and the Windows
tooling for those PCs. Deployed to the `bandit-lab` server through
[bandit-nix](https://github.com/6FaNcY9/bandit-nix), which imports `nixosModules.lab` from this flake.

Start with [AGENTS.md](AGENTS.md) and [docs/HANDOFF-2026-10-12.md](docs/HANDOFF-2026-10-12.md); runbooks are in [docs/runbooks/minecraft](docs/runbooks/minecraft),
designs in [docs/specs](docs/specs). History before 2026-10-12 comes from bandit-nix
(`git filter-repo`), so older commit messages mention paths of that repository.
