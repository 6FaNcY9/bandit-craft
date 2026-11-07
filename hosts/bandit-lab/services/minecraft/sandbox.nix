# The sandbox Paper for the bots runs as `servers.sandbox` in nix-minecraft.nix: a copy of the real world, only
# the ViaVersion pair as plugins, behind Velocity (virtual host sandbox.bots, or /server sandbox). Reset:
# `systemctl stop minecraft-server-sandbox`, remove /srv/minecraft/sandbox/world, start it (re-copies the real
# world). What is left here is the sandbox RCON password generator, which the nix sandbox and mcbots-seed read,
# and the dormant world seed of the removed Docker sandbox.
{pkgs, ...}: let
  data = "/srv/containers/minecraft-sandbox/data";
in {
  systemd = {
    tmpfiles.rules = ["d ${data} 0750 1000 1000 -"];

    services = {
      # Own RCON password (root-only). The nix sandbox reads the environment file after the shared one
      # (nix-minecraft.nix), mcbots-seed reads the password file.
      minecraft-sandbox-rcon-seed = {
        description = "Generate the sandbox Minecraft RCON password and its environment file";
        before = ["minecraft-server-sandbox.service"];
        requiredBy = ["minecraft-server-sandbox.service"];
        path = [pkgs.coreutils];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          UMask = "0077";
        };
        script = ''
          install -d -m 0700 /var/lib/minecraft-sandbox-rcon /run/minecraft-sandbox-rcon
          [ -s /var/lib/minecraft-sandbox-rcon/password ] || head -c 32 /dev/urandom | sha256sum | cut -c1-64 > /var/lib/minecraft-sandbox-rcon/password
          printf 'RCON_PASSWORD=%s\n' "$(cat /var/lib/minecraft-sandbox-rcon/password)" > /run/minecraft-sandbox-rcon/rcon.env
        '';
      };

      # Dormant: the Docker sandbox it fed is gone and nothing starts it; it stays so the running unit
      # keeps its state on the deploy that removed the Docker stack (the nix sandbox is seeded by
      # minecraft-sandbox-world in nix-minecraft.nix).
      # shortcut: it still reads the cold Docker copy /srv/containers/minecraft/data/world, so that path
      # stays until this unit is deleted or re-pointed to /srv/minecraft/paper/world (owner's decision).
      minecraft-sandbox-seed = {
        description = "Copy the real Minecraft world into the sandbox (once)";
        restartIfChanged = false; # a deploy must not re-run the copy
        path = [pkgs.coreutils pkgs.gnugrep];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          TimeoutStartSec = "30min";
        };
        script = ''
          # Bots reconnect often: no connection throttle. Paper fills in the rest of bukkit.yml.
          if ! grep -qs 'connection-throttle: -1$' ${data}/bukkit.yml; then
            printf 'settings:\n  connection-throttle: -1\n' > ${data}/bukkit.yml
            chown 1000:1000 ${data}/bukkit.yml
          fi
          dst=${data}/world
          [ -e "$dst" ] && exit 0
          src=/srv/containers/minecraft/data/world
          [ -d "$src" ] || exit 0 # no real world yet: the sandbox generates its own
          rm -rf "$dst.partial"
          cp -a "$src" "$dst.partial"
          rm -f "$dst.partial/session.lock"
          mv "$dst.partial" "$dst" # visible only once complete
        '';
      };
    };
  };
}
