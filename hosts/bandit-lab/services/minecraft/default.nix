{
  config,
  lib,
  pkgs,
  repoConfig,
  ...
}: let
  scripts = import ./scripts.nix {inherit pkgs;};
  plugins = import ./plugins.nix {inherit pkgs;};

  # CommandPanels menus: the hand-written ones plus the generated /kit menus (JSON is YAML).
  panels = pkgs.linkFarm "minecraft-panels" (
    map (f: {
      name = f;
      path = ./commandpanels + "/${f}";
    }) (builtins.attrNames (builtins.readDir ./commandpanels))
    ++ lib.mapAttrsToList (name: panel: {
      name = "${name}.yml";
      path = pkgs.writeText "${name}.yml" (builtins.toJSON panel);
    }) (import ./kits.nix {inherit lib;})
  );

  # Map, pinned and owned by Nix (see stage.sh for the ownership split).
  # BlueMap (MIT) is the live map, reachable only through the loopback port
  # published below and the tailnet HTTPS proxy. Administration is the bots
  # dashboard's Server panel (mcbots, over RCON); VoxelDash is retired.
  blueMapVersion = plugins.bluemap.version;
  blueMap = plugins.bluemap.src;

  # ImageFrame (LOOHP, open source): players put linked images (imgur/Discord only) on maps in
  # item frames. Nix-owned like BlueMap; its config is installed once (imageframe-config.yml).
  imageFrameVersion = plugins.imageframe.version;
  imageFrame = plugins.imageframe.src;

  # Plugins seeded once (first activation of the one-time seed) and then owned
  # by the panel: pinned from Hangar / Modrinth / GitHub with exact hashes.
  # ViaVersion lets newer clients join; ViaBackwards (requires ViaVersion)
  # lets older clients join. Modrinth releases explicitly support 26.2.
  seedPlugins = lib.listToAttrs (map (p: lib.nameValuePair p.file p.src) (with plugins; [
    viaversion
    viabackwards
    luckperms
    smoderation
    commandpanels
    placeholderapi
    inventoryrollbackplus
    axgraves
  ]));
  seedExpansions = {
    "PAPI-Expansion-Player_R5xV754.jar" = pkgs.fetchurl {
      url = "https://dl.placeholderapi.com/PAPI-Expansion-Player_R5xV754.jar";
      hash = "sha256-o1V0u76c6IaIIRVDcf11TmZAKjgox0U7jOMrxTborGw=";
    };
  };

  mapPort = "8100";

  # Dedicated /29 for in-lab Mineflayer bots (containers join `mcbots`, connect
  # to velocity:25565). Docker's pools hand out 172.17-31.x.x/16 and then
  # 192.168.x.x; 10.250.77.0/29 collides with none of them nor with the other
  # lab networks. The gateway takes .1, velocity .2 and up to 4 bots remain.
  mcbotsSubnet = "10.250.77.0/29";

  velocityPatch = import ./velocity-patch.nix {inherit pkgs;};
in {
  systemd = {
    tmpfiles.rules = [
      # The Docker-era backups; minecraft-backup still writes its archives here.
      "d /srv/containers/minecraft/backups 0750 root root -"
    ];

    services = {
      docker-network-minecraft = repoConfig.mkDockerNetwork pkgs "minecraft";
      # Same inspect-then-create pattern as mkDockerNetwork, with a pinned subnet.
      docker-network-mcbots = let
        docker = "${pkgs.docker}/bin/docker";
      in {
        description = "Create mcbots Docker network (${mcbotsSubnet})";
        after = ["docker.service"];
        requires = ["docker.service"];
        wantedBy = ["multi-user.target"];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = pkgs.writeShellScript "ensure-mcbots-network" ''
            set -euo pipefail
            if ! ${docker} network inspect mcbots >/dev/null 2>&1; then
              ${docker} network create --subnet ${mcbotsSubnet} mcbots
            fi
          '';
        };
      };

      # Stage the pinned panel/map and seed the panel-owned plugins into the cold Docker data directory.
      # Ownership rules and the one-time seed are documented in stage.sh.
      # shortcut: nothing starts this unit any more (the Docker container that required it is gone) and
      # the nix-minecraft servers do not use it; it stays so the running unit keeps its state on the
      # deploy that removed the Docker stack. Delete it with stage.sh once the cold copy is gone.
      minecraft-plugins = {
        description = "Stage Minecraft panel, map and one-time plugin seed";
        restartIfChanged = false; # dormant: a deploy must not re-run the staging
        environment = {
          STAGE_BLUEMAP = blueMap;
          STAGE_BLUEMAP_VERSION = blueMapVersion;
          STAGE_BLUEMAP_CORE = ./bluemap-core.conf;
          STAGE_IMAGEFRAME = imageFrame;
          STAGE_IMAGEFRAME_VERSION = imageFrameVersion;
          STAGE_IMAGEFRAME_CONFIG = ./imageframe-config.yml;
          STAGE_OVERLAY = ./overlay.js;
          STAGE_PATCHES = velocityPatch;
          STAGE_SEED = pkgs.linkFarm "minecraft-seed-plugins" seedPlugins;
          STAGE_EXPANSIONS = pkgs.linkFarm "minecraft-seed-expansions" seedExpansions;
        };
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          ExecStart = "${scripts.stage}/bin/minecraft-stage";
        };
      };

      # The menus go in while the server runs and are reloaded in place (/pa reload over RCON, which only
      # answers once the server is up: through the console pipe the reload hit a server still starting
      # and failed, 2026-10-12), so a menu change never restarts Minecraft.
      minecraft-panels = {
        description = "Install the CommandPanels menus and reload them";
        after = ["minecraft-server-paper.service"];
        wantedBy = ["minecraft-server-paper.service"];
        partOf = ["minecraft-server-paper.service"];
        path = [pkgs.coreutils pkgs.mcrcon];
        environment = {
          PANELS = panels;
          MCRCON_HOST = "127.0.0.1";
          MCRCON_PORT = "25575"; # servers.paper rcon.port, loopback
        };
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          TimeoutStartSec = "10min";
        };
        script = ''
          d=/srv/minecraft/paper/plugins/CommandPanels
          install -d -o minecraft -g minecraft -m 0770 "$d" "$d/panels"
          # Retired v1 chest menus (the Kommandostand owns /bots now): installing never deletes, so drop them. The Paper start
          # does the same before CommandPanels loads (nix-minecraft.nix extraStartPre); remove both together.
          rm -f "$d/panels/bots.yml" "$d/panels/botmenu.yml"
          for panel in "$PANELS"/*.yml; do
            install -o minecraft -g minecraft -m 0644 "$panel" "$d/panels/$(basename "$panel")"
          done
          MCRCON_PASS=$(cat ${config.sops.secrets."minecraft-rcon-password".path})
          export MCRCON_PASS
          for _ in $(seq 50); do
            timeout 20 mcrcon "pa reload" >/dev/null 2>&1 && exit 0
            sleep 10
          done
          echo "Minecraft is not running; it reads the menus when it starts" >&2
        '';
      };

      # RCON password for the Docker container, made once on this host (root-only). The nix-minecraft
      # server and mcbots-seed read the sops secret minecraft-rcon-password instead.
      # shortcut: dormant like minecraft-plugins (no consumer left); delete it with /var/lib/minecraft-rcon.
      minecraft-rcon-seed = {
        description = "Generate the Minecraft RCON password and its environment file";
        restartIfChanged = false;
        path = [pkgs.coreutils];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          UMask = "0077";
        };
        script = ''
          install -d -m 0700 /var/lib/minecraft-rcon /run/minecraft-rcon
          [ -s /var/lib/minecraft-rcon/password ] || head -c 32 /dev/urandom | sha256sum | cut -c1-64 > /var/lib/minecraft-rcon/password
          printf 'RCON_PASSWORD=%s\n' "$(cat /var/lib/minecraft-rcon/password)" > /run/minecraft-rcon/rcon.env
        '';
      };

      # Private HTTPS for the map (8443): Tailscale Serve,
      # tailnet only (never Funnel). Serve and "HTTPS Certificates" must be enabled
      # once in the Tailscale admin console. Until then `tailscale serve --bg`
      # blocks waiting for that, so each call is time-boxed, and the unit logs a
      # warning and still succeeds: a missing console setting must not hang or
      # fail a deployment. After enabling it, run
      #   sudo systemctl restart minecraft-panel-https
      # Meanwhile the map is reachable through an SSH tunnel (docs/runbooks/minecraft/PANEL.md).
      # (The unit keeps its old name; VoxelDash's route on 443 is retired.)
      minecraft-panel-https = {
        description = "Tailnet-only HTTPS for the Minecraft map";
        after = ["tailscaled.service" "minecraft-server-paper.service"];
        wants = ["tailscaled.service"];
        wantedBy = ["multi-user.target"];
        path = [config.services.tailscale.package pkgs.coreutils];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          TimeoutStartSec = "90s";
        };
        script = ''
          serve() {
            if ! timeout 30 tailscale serve --bg --https="$1" "http://127.0.0.1:$2"; then
              echo "WARNING: could not publish 127.0.0.1:$2 on tailnet HTTPS port $1; enable Serve and HTTPS Certificates in the Tailscale admin console, then restart this unit" >&2
            fi
          }
          serve 8443 ${mapPort}
        '';
        preStop = ''
          timeout 30 tailscale serve --https=443 off || true # VoxelDash's old route; also clears it on the deploy that retires it
          timeout 30 tailscale serve --https=8443 off || true
        '';
      };

      # Consistent daily backup with checksum, listing test and retention. The
      # off-host copy is the restic job (services/backup), which runs the same
      # snapshot at 04:30.
      minecraft-backup = {
        description = "Consistent Minecraft backup (flush, snapshot, verify, prune)";
        serviceConfig = {
          Type = "oneshot";
          ExecStart = "${scripts.backup}/bin/minecraft-backup";
          TimeoutStartSec = "2h";
          Nice = 10;
          IOSchedulingClass = "idle";
        };
      };
    };

    timers.minecraft-backup = {
      wantedBy = ["timers.target"];
      timerConfig = {
        OnCalendar = "03:40";
        Persistent = true;
        RandomizedDelaySec = "10m";
      };
    };
  };

  # Velocity forwarding secret, shared by the proxy (VELOCITY_FORWARDING_SECRET)
  # and Paper (patched into paper-global.yml). Declared here so only bandit-lab
  # decrypts it. The key `minecraft-velocity-secret` must exist in
  # secrets/lab.yaml (docs/runbooks/minecraft/PROXY.md) before this is deployed.
  sops.secrets."minecraft-velocity-secret".mode = "0400";
}
