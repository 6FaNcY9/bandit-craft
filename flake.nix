{
  description = "bandit-craft: the Minecraft server, its bots, their AI (Andy) and the gaming PCs that think for them";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
  in {
    # The lab's game and AI services. bandit-nix (github:6FaNcY9/bandit-nix) imports them into the
    # bandit-lab host, in this order, and passes `repoConfig` (its lib/repository.nix) and `inputs` as
    # module arguments; secrets are declared by name and come from bandit-nix's SOPS files.
    nixosModules.lab.imports = [
      ./hosts/bandit-lab/services/minecraft
      ./hosts/bandit-lab/services/minecraft/sandbox.nix
      ./hosts/bandit-lab/services/minecraft/nix-minecraft.nix
      ./hosts/bandit-lab/services/mcbots
      ./hosts/bandit-lab/services/ollama
      ./hosts/bandit-lab/services/llamacpp
      ./hosts/bandit-lab/services/mcagents
    ];

    # The laptop side of the PC manager: `pc-admin`, admin on the gaming PCs with the owner's finger
    # (tools/winpc/README.md). bandit-nix imports it into the laptop host.
    nixosModules.pc-admin = ./tools/winpc/pc-admin.nix;

    # The bot runner and dashboard; its build runs app/test.js. mcbots-worker needs bandit-nix's
    # repoConfig (lab address, hub port), so bandit-nix builds that one (mcbots/worker.nix).
    packages.${system} = {
      mcbots = pkgs.callPackage ./hosts/bandit-lab/services/mcbots/package.nix {};
      pc-admin = pkgs.callPackage ./tools/winpc/pc-admin-package.nix {};
    };

    checks.${system} = {
      mcagents-tests = import ./ci/mcagents-tests.nix {inherit pkgs;};
      restart-warn-test = import ./ci/restart-warn-test.nix {inherit pkgs;};
      inherit (self.packages.${system}) mcbots pc-admin;
    };

    formatter.${system} = pkgs.alejandra;
  };
}
