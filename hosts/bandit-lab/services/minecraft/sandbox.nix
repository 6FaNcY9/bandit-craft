# The sandbox Paper for the bots now runs as `servers.sandbox` in nix-minecraft.nix (phase 5.5): a copy of
# the real world, only the ViaVersion pair as plugins, behind Velocity (virtual host sandbox.bots, or
# /server sandbox). Reset: `systemctl stop minecraft-server-sandbox`, remove /srv/minecraft/sandbox/world,
# start it (re-copies the real world).
# What is left here is the rollback: the Docker sandbox container (not autostarted), its world seed, and the
# sandbox RCON password generator, which both sandboxes read. Removal is phase 5.6.
{
  config,
  lib,
  pkgs,
  ...
}: let
  plugins = import ./plugins.nix {inherit pkgs;};
  real = config.virtualisation.oci-containers.containers.minecraft;
  docker = "${pkgs.docker}/bin/docker";
  data = "/srv/containers/minecraft-sandbox/data";
  # The bots speak 26.1 (mineflayer); ViaBackwards (on ViaVersion) lets them join 26.2, as on the real
  # server (same pinned jars as its seedPlugins). Mounted read-only into /plugins, which itzg copies.
  via = {
    "ViaVersion.jar" = plugins.viaversion.src;
    "ViaBackwards.jar" = plugins.viabackwards.src;
  };
in {
  systemd = {
    tmpfiles.rules = ["d ${data} 0750 1000 1000 -"];

    services = {
      # Own RCON password (root-only), same pattern as minecraft-rcon-seed. The nix sandbox reads the
      # environment file after the shared one (nix-minecraft.nix), mcbots-seed reads the password file.
      minecraft-sandbox-rcon-seed = {
        description = "Generate the sandbox Minecraft RCON password and its environment file";
        before = ["docker-minecraft-sandbox.service" "minecraft-server-sandbox.service"];
        requiredBy = ["docker-minecraft-sandbox.service" "minecraft-server-sandbox.service"];
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

      # First start only: copy the real world. The real server is flushed and
      # frozen (save-off) during the copy; save-on runs on every exit path.
      # The real world is only ever read.
      minecraft-sandbox-seed = {
        description = "Copy the real Minecraft world into the sandbox (once)";
        before = ["docker-minecraft-sandbox.service"];
        requiredBy = ["docker-minecraft-sandbox.service"];
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
          console() { ${docker} exec --user 1000 minecraft mc-send-to-console "$1"; }
          running=$(${docker} inspect -f '{{.State.Running}}' minecraft 2>/dev/null || true)
          if [ "$running" = true ]; then
            trap 'console save-on || true' EXIT
            console save-off
            console "save-all flush"
            sleep 10
          fi
          rm -rf "$dst.partial"
          cp -a "$src" "$dst.partial"
          rm -f "$dst.partial/session.lock"
          mv "$dst.partial" "$dst" # visible only once complete
        '';
      };

      docker-minecraft-sandbox = {
        after = ["docker-network-minecraft.service"];
        requires = ["docker-network-minecraft.service"];
        preStart = "${config.systemd.services.docker-network-minecraft.serviceConfig.ExecStart}"; # see docker-minecraft (default.nix)
        unitConfig.StartLimitIntervalSec = 0;
        serviceConfig = {
          Restart = lib.mkForce "always";
          RestartSec = "10s";
        };
      };
    };
  };

  virtualisation.oci-containers.containers.minecraft-sandbox = {
    autoStart = false; # rollback only: `systemctl start docker-minecraft-sandbox` (see CUTOVER-5.5.md)
    inherit (real) image; # same pinned image as the real server
    environment = {
      EULA = "TRUE";
      TYPE = "PAPER";
      VERSION = "26.2";
      PAPER_BUILD = "130";
      TZ = config.time.timeZone;
      MEMORY = "4G";
      USE_AIKAR_FLAGS = "true";
      # Authentication happens at the proxy; the forwarding secret keeps everyone else out.
      ONLINE_MODE = "FALSE";
      SPAWN_PROTECTION = "0";
      DIFFICULTY = "normal";
      MODE = "survival";
      VIEW_DISTANCE = "8";
      ENABLE_RCON = "true";
      PATCH_DEFINITIONS = "/nix-patches";
      # Offline bots have no chat signing key: with the default (true) their chat is dropped ("Chat disabled
      # due to missing profile public key", self-test 2026-10-11), so the say job did nothing.
      ENFORCE_SECURE_PROFILE = "FALSE";
      # The owner watches the bots in spectator mode (/gamemode spectator); Velocity's modern forwarding
      # makes this the real, Mojang-checked account.
      OPS = "fancy8869";
    };
    environmentFiles = [
      config.sops.templates."minecraft-velocity.env".path # CFG_VELOCITY_SECRET for the patch below
      "/run/minecraft-sandbox-rcon/rcon.env"
    ];
    volumes =
      ["${data}:/data" "${import ./velocity-patch.nix {inherit pkgs;}}:/nix-patches/velocity.json:ro"]
      ++ lib.mapAttrsToList (name: jar: "${jar}:/plugins/${name}:ro") via;
    extraOptions = [
      "--network=minecraft"
      "--memory=6g"
      "--cpus=3"
      "--stop-timeout=60"
    ];
  };
}
