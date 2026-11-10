# The public anarchy world, phase 1 (docs/specs/2026-11-10-public-anarchy-world.md): the INSIDE of the
# `mc-public` container that bandit-nix defines (its hosts/bandit-lab/services/mc-public). One Velocity
# (0.0.0.0:25565; the container's firewall admits its own tailscale0 only) in front of one Paper
# (127.0.0.1:25567). Nothing is shared with the private stack (../minecraft/nix-minecraft.nix): own data
# directory, own forwarding secret (generated below; never the private minecraft-servers.env), no RCON,
# no operators, premium accounts only, no VeloAuth and no BotGate.
# The importer provides nix-minecraft's module and overlay. This module takes no `repoConfig`, no `inputs`
# and declares no sops secret, so nothing of the host can leak in through it.
# Runbook: docs/runbooks/minecraft/PUBLIC.md. Contract check: bandit-nix ci/lab-mc-public.nix.
{
  lib,
  pkgs,
  ...
}: let
  plugins = import ../minecraft/plugins.nix {inherit pkgs;};

  dataDir = "/srv/minecraft"; # inside the container; bandit-nix binds the host's world directory here
  secretEnv = "/run/minecraft-public-secret/forwarding.env";
  paperPort = 25567;

  # Own pins, not the private stack's bindings: the public pair upgrades independently of the private world.
  # Worlds upgrade forward only: verified backup before each change here.
  paperPackage = pkgs.paperServers.paper-26_2-build_130.override {jre = pkgs.jdk25_headless;};
  velocityPackage = pkgs.velocityServers.velocity-3_5_1-build_615;

  # Only what differs from Paper's defaults; nix-minecraft rewrites server.properties from this on every start.
  paperProperties = {
    accepts-transfers = false;
    allow-flight = true; # anarchy: vanilla must not kick flyers; the pre-generated world is the guard
    broadcast-console-to-ops = false;
    difficulty = "hard"; # anarchy: the world is as dangerous as the players (owner's goal, 2026-11-10)
    enable-query = false;
    enable-rcon = false; # the console is the systemd socket (/run/minecraft/paper.stdin), root in the container only
    enable-status = true;
    enforce-secure-profile = true; # Mojang chat reporting works
    enforce-whitelist = true;
    gamemode = "survival";
    level-name = "world";
    max-players = 20;
    # A radius: the world border cannot grow past it in any dimension, whatever `worldborder set` says.
    # The visible border itself is set once from the console (PUBLIC.md).
    max-world-size = 5000;
    motd = "bandit public (testers)";
    online-mode = false; # authentication happens at Velocity, which is online-mode = true
    pause-when-empty-seconds = -1; # an empty server must keep ticking, or Chunky's pre-generation stalls
    prevent-proxy-connections = false;
    server-ip = "127.0.0.1";
    server-port = paperPort;
    simulation-distance = 4;
    spawn-protection = 0;
    view-distance = 6;
    white-list = true; # phase 1 and 2; names are added from the console (PUBLIC.md), no whitelist.json comes from Nix
  };

  # The private proxy's keys, minus its sandbox backend and forced host.
  # The empty [forced-hosts] table is accepted: this file started the pinned Velocity 3.5.1 build 615 on 2026-11-10.
  velocityToml = pkgs.writeText "velocity.toml" ''
    config-version = "2.8"
    bind = "0.0.0.0:25565"
    # Premium accounts only: Mojang authenticates every login and no plugin may flip one offline.
    online-mode = true
    player-info-forwarding-mode = "modern"
    ping-passthrough = "ALL"

    [servers]
    main = "127.0.0.1:${toString paperPort}"
    try = ["main"]

    # Empty on purpose: no virtual host leads anywhere but main.
    [forced-hosts]

    [advanced]
    # Phase 2 turns this on for the relay (PROXY v2). In phase 1 testers reach the tailnet address directly.
    haproxy-protocol = false
  '';

  # Aikar's G1 flags around a fixed heap, as on the private server.
  jvmOpts = heap:
    lib.concatStringsSep " " [
      "-Xms${heap}"
      "-Xmx${heap}"
      "-XX:+UseG1GC"
      "-XX:+ParallelRefProcEnabled"
      "-XX:MaxGCPauseMillis=200"
      "-XX:+UnlockExperimentalVMOptions"
      "-XX:+DisableExplicitGC"
      "-XX:+AlwaysPreTouch"
      "-XX:G1NewSizePercent=30"
      "-XX:G1MaxNewSizePercent=40"
      "-XX:G1HeapRegionSize=8M"
      "-XX:G1ReservePercent=20"
      "-XX:G1HeapWastePercent=5"
      "-XX:G1MixedGCCountTarget=4"
      "-XX:InitiatingHeapOccupancyPercent=15"
      "-XX:G1MixedGCLiveThresholdPercent=90"
      "-XX:G1RSetUpdatingPauseTimePercent=5"
      "-XX:SurvivorRatio=32"
      "-XX:+PerfDisableSharedMem"
      "-XX:MaxTenuringThreshold=1"
      "-Dusing.aikars.flags=https://mcflags.emc.gs"
      "-Daikars.new.flags=true"
    ];

  # Modern forwarding with this container's own secret (read from the environment file at start, never in
  # the store), and the TNT dupers the design keeps (Paper disables them by default). Same keys as the
  # private stack's patch.
  forwardingPatch = ''
    yq -i '.proxies.velocity.enabled = true | .proxies.velocity.online-mode = true | .proxies.velocity.secret = strenv(VELOCITY_FORWARDING_SECRET) | .unsupported-settings.allow-piston-duplication = true' config/paper-global.yml
  '';

  # The design's technical guards. The packet-limiter, book-size and spam-limiter defaults are left alone.
  # UNVERIFIED: the three chunk-loading-basic key names are from docs.papermc.io, not checked against Paper 26.2 build 130.
  globalGuardPatch = ''
    yq -i '.chunk-loading-basic.player-max-chunk-load-rate = 40 | .chunk-loading-basic.player-max-chunk-send-rate = 40 | .chunk-loading-basic.player-max-chunk-generate-rate = 5' config/paper-global.yml
  '';
  # UNVERIFIED: every key name and entity id below is from docs.papermc.io, not checked against Paper 26.2 build 130.
  # A wrong name is not fatal (Paper ignores or drops an unknown key) but then that guard is not in force:
  # compare config/paper-world-defaults.yml after the first start (PUBLIC.md).
  worldGuardPatch = ''
    yq -i '.chunks.entity-per-chunk-save-limit.arrow = 16 | .chunks.entity-per-chunk-save-limit.ender_pearl = 8 | .chunks.entity-per-chunk-save-limit.experience_orb = 16 | .chunks.entity-per-chunk-save-limit.fireball = 8 | .chunks.entity-per-chunk-save-limit.small_fireball = 8 | .chunks.entity-per-chunk-save-limit.snowball = 8 | .chunks.prevent-moving-into-unloaded-chunks = true | .collisions.max-entity-collisions = 2 | .misc.redstone-implementation = "ALTERNATE_CURRENT" | .anticheat.anti-xray.enabled = false' config/paper-world-defaults.yml
  '';
in {
  services.minecraft-servers = {
    enable = true;
    eula = true;
    openFirewall = false;
    inherit dataDir;
    # One variable, VELOCITY_FORWARDING_SECRET, written by minecraft-public-secret below.
    environmentFile = secretEnv;
    managementSystem = {
      tmux.enable = false;
      systemd-socket.enable = true;
    };

    servers.paper = {
      enable = true;
      openFirewall = false;
      package = paperPackage;
      jvmOpts = jvmOpts "6G"; # the container is capped at 10G (bandit-nix)
      serverProperties = paperProperties;
      operators = {}; # none, ever: nothing is sold or granted through operator rights
      # nix-minecraft writes no ops.json for an empty `operators`, so a console `op` would survive restarts.
      # This copy is put back on every start.
      files."ops.json" = pkgs.writeText "ops.json" "[]\n";
      # The world events (docs/specs/2026-11-10-public-world-events.md). A copy, renewed on every start:
      # Minecraft refuses to start a world that has a symlink in it.
      files."world/datapacks/bev" = ./events;
      # The exact list (bandit-nix ci/lab-mc-public.nix). LuckPerms comes with the store, phase 3.
      symlinks = {
        "plugins/${plugins.chunky.file}" = plugins.chunky.src; # pre-generation inside the border
        "plugins/${plugins.smoderation.file}" = plugins.smoderation.src; # mute and ban from the console
      };
      path = [pkgs.yq-go];
      # A new world has neither file on its first start: empty ones are patched and Paper fills in the rest
      # (the private sandbox starts the same way).
      extraStartPre = ''
        if [ ! -f config/paper-global.yml ]; then
          mkdir -p config
          echo '{}' > config/paper-global.yml
        fi
        if [ ! -f config/paper-world-defaults.yml ]; then
          mkdir -p config
          echo '{}' > config/paper-world-defaults.yml
        fi
        ${forwardingPatch}
        ${globalGuardPatch}
        ${worldGuardPatch}
      '';
    };

    servers.velocity = {
      enable = true;
      openFirewall = false;
      package = velocityPackage;
      jvmOpts = "-Xms512M -Xmx512M";
      stopCommand = "end";
      # Writable copy: Velocity may rewrite it. Reads VELOCITY_FORWARDING_SECRET from the environment file.
      files."velocity.toml" = velocityToml;
      # No plugins: nothing on the proxy may decide who is authenticated.
    };
  };

  systemd.services = {
    # The pair's own forwarding secret, made once inside the container (root-only), like the sandbox's RCON
    # password on the host. No sops key and no path of the private stack is involved. To rotate: remove
    # /var/lib/minecraft-public-secret/secret and restart this unit, then both servers.
    minecraft-public-secret = {
      description = "Generate the public Minecraft forwarding secret and its environment file";
      before = ["minecraft-server-paper.service" "minecraft-server-velocity.service"];
      requiredBy = ["minecraft-server-paper.service" "minecraft-server-velocity.service"];
      path = [pkgs.coreutils];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        UMask = "0077";
      };
      script = ''
        install -d -m 0700 /var/lib/minecraft-public-secret /run/minecraft-public-secret
        [ -s /var/lib/minecraft-public-secret/secret ] || head -c 32 /dev/urandom | sha256sum | cut -c1-64 > /var/lib/minecraft-public-secret/secret
        printf 'VELOCITY_FORWARDING_SECRET=%s\n' "$(cat /var/lib/minecraft-public-secret/secret)" > ${secretEnv}
      '';
    };

    # After Paper for tidy logs only; Velocity retries a backend that is not up yet.
    minecraft-server-velocity = {
      after = ["minecraft-server-paper.service"];
      wants = ["minecraft-server-paper.service"];
      startLimitIntervalSec = lib.mkForce 0;
      serviceConfig.RestartSec = "10s";
    };
  };
}
