# `pc-admin` (docs/specs/2026-10-12-windows-pc-manager.md, part 0): admin on the gaming PCs only with the
# owner's finger. bandit-nix imports this into the laptop. Every call re-authenticates through sudo
# (pam_fprintd: finger, password as fallback; `sudo -k` first), which gates a key only root can read;
# the PCs accept that key only from the laptop's tailnet address (install-agent.ps1 -ShellPublicKey).
# Claude's own key on the PCs is the read-only diag key (diag.ps1).
{
  lib,
  pkgs,
  ...
}: let
  pcs = import ./pcs.nix;
  dir = "/var/lib/pc-admin";
  pcAdmin = pkgs.callPackage ./pc-admin-package.nix {};
in {
  environment.systemPackages = [pcAdmin];

  programs.ssh.knownHosts = lib.mapAttrs' (name: pc:
    lib.nameValuePair "pc-${name}" {
      hostNames = [pc.address];
      publicKey = pc.hostKey;
    })
  pcs;

  # Made here once and never copied anywhere; the PCs list the public half (shell.pub, world-readable).
  systemd.services.pc-admin-key = {
    description = "Create the root-only key for pc-admin";
    wantedBy = ["multi-user.target"];
    unitConfig.ConditionPathExists = "!${dir}/shell";
    serviceConfig = {
      Type = "oneshot";
      StateDirectory = "pc-admin";
      StateDirectoryMode = "0711";
      UMask = "0077";
    };
    script = ''
      ${pkgs.openssh}/bin/ssh-keygen -q -t ed25519 -N "" -C pc-admin@bandit -f ${dir}/shell
      chmod 0644 ${dir}/shell.pub
    '';
  };
}
