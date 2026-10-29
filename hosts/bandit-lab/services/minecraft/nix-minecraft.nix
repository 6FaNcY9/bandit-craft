# The live Minecraft stack (phase 5.5): Paper, the bots' sandbox Paper and Velocity from nix-minecraft.
# Velocity listens on 0.0.0.0:25565 (firewall: tailscale0 plus one rule for the mcbots bridge), Paper on
# 127.0.0.1:25567, the sandbox on 127.0.0.1:25568. RCON (25575, sandbox 25576) and the map (8100) are
# loopback and reach the Docker mcbots bridge through socket forwarders on its gateway. The Docker
# definitions (default.nix, sandbox.nix) stay for rollback until 5.6 but do not start. No Paper port is in
# any firewall list (ci/lab-surface.nix, ci/lab-minecraft.nix).
{
  config,
  lib,
  pkgs,
  repoConfig,
  ...
}: let
  scripts = import ./scripts.nix {inherit pkgs;};
  plugins = import ./plugins.nix {inherit pkgs;};
  vplugins = import ./velocity-plugins.nix {inherit pkgs;};

  # The Docker mcbots bridge (minecraft/default.nix mcbotsSubnet); the cutover bots reach the stack on its gateway.
  bridgeSubnet = "10.250.77.0/29";
  bridgeGw = "10.250.77.1";
  bridgePorts = {
    mc-bridge-rcon = 25575;
    mc-bridge-rcon-sandbox = 25576;
    mc-bridge-map = mapPort;
  };
  bridgeRule = op: "iptables ${op} nixos-fw -s ${bridgeSubnet} -d ${bridgeGw} -p tcp -m multiport --dports 25565,25575,25576,${toString mapPort} -j nixos-fw-accept";
  bridgeService = port: {
    serviceConfig = {
      ExecStart = "${pkgs.systemd}/lib/systemd/systemd-socket-proxyd 127.0.0.1:${toString port}";
      DynamicUser = true;
      PrivateTmp = true;
      ProtectSystem = "strict";
    };
  };
  dataDir = "/srv/minecraft";
  # Simple Voice Chat (24454/udp, its own config) and BlueMap (8100, loopback) keep the Docker stack's ports.
  voicePort = 24454;
  mapPort = 8100;

  # The plugins the Docker stack runs, as symlinks into the store (D2: all jars come from plugins.nix).
  # The rehearsal left Jarvis out so its live AI/API config was not used twice; the Docker server is
  # stopped at the cutover, so it comes along now.
  paperPlugins = lib.mapAttrs' (_: p: lib.nameValuePair "plugins/${p.file}" p.src) plugins;

  # Same keys as the live server.properties (dumped 2026-10-22, minus the RCON password and the
  # management-server keys the server regenerates); only the lines after the attrset differ.
  paperProperties =
    {
      accepts-transfers = false;
      allow-flight = true;
      broadcast-console-to-ops = true;
      broadcast-rcon-to-ops = true;
      bug-report-link = "";
      chat-spam-threshold-seconds = 10;
      command-spam-threshold-seconds = 10;
      debug = false;
      difficulty = "easy";
      enable-code-of-conduct = false;
      enable-jmx-monitoring = false;
      enable-status = true;
      enforce-secure-profile = true;
      enforce-whitelist = false;
      entity-broadcast-range-percentage = 100;
      force-gamemode = false;
      function-permission-level = 2;
      gamemode = "survival";
      generate-structures = true;
      generator-settings = "{}";
      hardcore = false;
      hide-online-players = false;
      initial-disabled-packs = "";
      initial-enabled-packs = "vanilla";
      level-name = "world";
      level-seed = "";
      level-type = "minecraft:normal";
      log-ips = true;
      max-chained-neighbor-updates = 1000000;
      max-players = 16;
      max-tick-time = 60000;
      max-world-size = 29999984;
      motd = "bandit-lab";
      network-compression-threshold = 256;
      op-permission-level = 4;
      pause-when-empty-seconds = -1;
      player-idle-timeout = 0;
      prevent-proxy-connections = false;
      rate-limit = 0;
      region-file-compression = "deflate";
      require-resource-pack = false;
      resource-pack = "";
      resource-pack-id = "";
      resource-pack-prompt = "";
      resource-pack-sha1 = "";
      simulation-distance = 10;
      spawn-protection = 0;
      status-heartbeat-interval = 0;
      sync-chunk-writes = true;
      text-filtering-config = "";
      text-filtering-version = 0;
      use-native-transport = true;
      view-distance = 10;
      white-list = false;
    }
    // {
      server-ip = "127.0.0.1";
      server-port = 25567;
      online-mode = false; # authentication happens at Velocity
      enable-query = false;
      enable-rcon = true;
      "rcon.port" = 25575;
      "rcon.password" = "@RCON_PASSWORD@"; # substituted from the environment file at start
    };

  velocityToml = pkgs.writeText "velocity.toml" ''
    config-version = "2.8"
    bind = "0.0.0.0:25565"
    # Mojang authentication for everyone; BotGate flips single logins offline.
    # VeloAuth decides per connection (see velocity-plugins.nix).
    online-mode = false
    player-info-forwarding-mode = "modern"
    ping-passthrough = "ALL"

    [servers]
    main = "127.0.0.1:25567"
    # The bots' sandbox world (sandbox below): players reach it with /server sandbox; the bots connect
    # with the virtual host sandbox.bots and land there directly, never on main.
    sandbox = "127.0.0.1:25568"
    try = ["main"]

    [forced-hosts]
    "sandbox.bots" = ["sandbox"]

    [advanced]
    haproxy-protocol = false
  '';

  # Aikar's G1 flags (the Docker stack's USE_AIKAR_FLAGS) around a fixed heap.
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

  # Paper 26.2 build 130 for both servers (the Docker images' PAPER_BUILD).
  paperPackage = pkgs.paperServers.paper-26_2-build_130.override {jre = pkgs.jdk25_headless;};

  # Modern forwarding: only the three keys velocity-patch.nix sets in the Docker stack (secret from the
  # environment file). The sandbox has no config yet on its first start, so it gets an empty file to patch.
  forwardingPatch = ''
    yq -i '.proxies.velocity.enabled = true | .proxies.velocity.online-mode = true | .proxies.velocity.secret = strenv(VELOCITY_FORWARDING_SECRET)' config/paper-global.yml
  '';

  # The sandbox, as the Docker one was (sandbox.nix): the same Paper, only the ViaVersion pair, offline mode
  # behind Velocity, no chat signing for the offline bots, normal difficulty, own RCON.
  sandboxProperties = {
    difficulty = "normal";
    enforce-secure-profile = false;
    gamemode = "survival";
    level-name = "world";
    online-mode = false; # authentication happens at Velocity
    spawn-protection = 0;
    view-distance = 8;
    server-ip = "127.0.0.1";
    server-port = 25568;
    enable-rcon = true;
    "rcon.port" = 25576;
    "rcon.password" = "@RCON_PASSWORD@"; # the sandbox's own, see the unit's EnvironmentFile order below
  };
in {
  services.minecraft-servers = {
    enable = true;
    eula = true;
    openFirewall = false;
    inherit dataDir;
    environmentFile = config.sops.templates."minecraft-servers.env".path;
    managementSystem = {
      tmux.enable = false;
      systemd-socket.enable = true;
    };

    servers.paper = {
      enable = true;
      openFirewall = false;
      package = paperPackage;
      jvmOpts = jvmOpts "12G"; # raised for seven bots beside the players (owner 2026-10-19)
      serverProperties = paperProperties;
      # Live ops.json / whitelist.json (banned-players.json and banned-ips.json are empty there).
      operators = {
        MidariBread = {
          uuid = "06ee5c24-21e7-4c96-8adb-f74ccf20a264";
          level = 3;
        };
        fancy8869 = {
          uuid = "623c7ee4-71ca-487a-b92a-a4564e43fbb9";
          level = 4;
        };
      };
      whitelist = {
        CringeLord21 = "dc503d67-fcc4-4780-9a1e-618d240718d6";
        Kirafunk = "03bb4dae-c33d-420f-b808-2d367852bed8";
      };
      symlinks = paperPlugins;
      path = [pkgs.yq-go];
      # The rest of paper-global.yml comes with the copied world. A missing file fails the start (fail closed).
      extraStartPre = ''
        test -f config/paper-global.yml
        ${forwardingPatch}
      '';
    };

    servers.sandbox = {
      enable = true;
      openFirewall = false;
      package = paperPackage;
      jvmOpts = jvmOpts "4G";
      serverProperties = sandboxProperties;
      operators.fancy8869 = {
        uuid = "623c7ee4-71ca-487a-b92a-a4564e43fbb9";
        level = 4;
      };
      # The bots speak 26.1 (mineflayer); ViaBackwards (on ViaVersion) lets them join 26.2, as on the real server.
      symlinks = {
        "plugins/${plugins.viaversion.file}" = plugins.viaversion.src;
        "plugins/${plugins.viabackwards.file}" = plugins.viabackwards.src;
      };
      path = [pkgs.yq-go];
      extraStartPre = ''
        if [ ! -f config/paper-global.yml ]; then
          mkdir -p config
          echo '{}' > config/paper-global.yml
        fi
        ${forwardingPatch}
      '';
    };

    servers.velocity = {
      enable = true;
      openFirewall = false;
      package = pkgs.velocityServers.velocity-3_5_1-build_615;
      jvmOpts = "-Xms512M -Xmx512M";
      stopCommand = "end";
      # Writable copy: Velocity may rewrite it. Reads VELOCITY_FORWARDING_SECRET from the environment file.
      files."velocity.toml" = velocityToml;
      symlinks = {
        "plugins/botgate.jar" = vplugins.botgate;
        "plugins/veloauth.jar" = vplugins.veloauthJar;
        "plugins/veloauth/config.yml" = vplugins.veloauthConfig;
      };
      # Workstation plus the mcbots bridge without its gateway (.1) and the host: the bots are .2-.7.
      environment.BOTGATE_SOURCES = "${repoConfig.lab.workstationTailscaleIp}/32,10.250.77.2/31,10.250.77.4/30";
    };
  };

  systemd.services = {
    mc-bridge-rcon = bridgeService bridgePorts.mc-bridge-rcon;
    mc-bridge-rcon-sandbox = bridgeService bridgePorts.mc-bridge-rcon-sandbox;
    mc-bridge-map = bridgeService bridgePorts.mc-bridge-map;

    # Same caps as the Docker container had (16 GiB, 6 CPUs) around the 12 GiB heap.
    minecraft-server-paper.serviceConfig = {
      MemoryMax = "16G";
      CPUQuota = "600%";
    };

    minecraft-server-sandbox = {
      after = ["minecraft-cutover.service" "minecraft-sandbox-rcon-seed.service" "minecraft-sandbox-world.service"];
      requires = ["minecraft-cutover.service" "minecraft-sandbox-rcon-seed.service" "minecraft-sandbox-world.service"];
      serviceConfig = {
        MemoryMax = "6G";
        CPUQuota = "300%";
        # Later files override earlier ones: the shared file carries the real server's RCON_PASSWORD, the
        # sandbox's own (minecraft-sandbox-rcon-seed) replaces it. The forwarding secret stays shared.
        EnvironmentFile = lib.mkForce [config.services.minecraft-servers.environmentFile "/run/minecraft-sandbox-rcon/rcon.env"];
      };
    };

    # Starts after both Paper servers (the backends must resolve) and after the tailnet address exists;
    # retries forever. Requires the cutover: the Docker Velocity holds 25565 until it has stopped.
    minecraft-server-velocity = {
      after = ["tailscaled.service" "minecraft-cutover.service" "minecraft-server-paper.service" "minecraft-server-sandbox.service"];
      wants = ["tailscaled.service" "minecraft-server-paper.service" "minecraft-server-sandbox.service"];
      requires = ["minecraft-cutover.service"];
      startLimitIntervalSec = lib.mkForce 0;
      serviceConfig = {
        MemoryMax = "1G";
        RestartSec = "10s";
      };
    };

    # The cutover (docs/runbooks/minecraft/CUTOVER-5.5.md): once, the final cold copy of the Docker world
    # into the nix data directory, before any nix server starts. Conflicts= is what stops the Docker units:
    # NixOS leaves a running container alone when its autoStart goes away, but starting this unit queues a
    # stop job for each of them and After= makes it wait for it (docker stop saves the world, up to 60 s).
    # Conflicts is symmetric: starting a Docker unit by hand (rollback) stops this unit and, through
    # Requires=, the nix servers. minecraft-cutover (minecraft-cutover.sh) refuses unless all are stopped and
    # does nothing once /srv/minecraft/paper/.cutover-done exists.
    minecraft-cutover = {
      description = "Final copy of the Docker Minecraft world into the nix-minecraft data directory (once)";
      before = ["minecraft-server-paper.service" "minecraft-server-sandbox.service" "minecraft-server-velocity.service"];
      requiredBy = ["minecraft-server-paper.service" "minecraft-server-sandbox.service" "minecraft-server-velocity.service"];
      after = ["docker.service" "docker-velocity.service" "docker-minecraft.service" "docker-minecraft-sandbox.service"];
      conflicts = ["docker-velocity.service" "docker-minecraft.service" "docker-minecraft-sandbox.service"];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        TimeoutStartSec = "2h";
        ExecStart = "${scripts.cutover}/bin/minecraft-cutover";
      };
    };

    # The sandbox world is a copy of the real one (once; delete /srv/minecraft/sandbox/world and restart the
    # sandbox to reset it). The real server is flushed and frozen (save-off) during the copy when it runs;
    # save-on runs on every exit path. The real world is only ever read.
    minecraft-sandbox-world = {
      description = "Copy the real Minecraft world into the sandbox (once)";
      after = ["minecraft-cutover.service"];
      before = ["minecraft-server-sandbox.service"];
      requiredBy = ["minecraft-server-sandbox.service"];
      path = [pkgs.coreutils pkgs.gnugrep pkgs.systemd];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        TimeoutStartSec = "30min";
      };
      script = ''
        data=${dataDir}/sandbox
        install -d -o minecraft -g minecraft -m 0770 "$data"
        # Bots reconnect often: no connection throttle. Paper fills in the rest of bukkit.yml.
        if ! grep -qs 'connection-throttle: -1$' "$data/bukkit.yml"; then
          printf 'settings:\n  connection-throttle: -1\n' > "$data/bukkit.yml"
          chown minecraft:minecraft "$data/bukkit.yml"
        fi
        dst=$data/world
        [ -e "$dst" ] && exit 0
        src=${dataDir}/paper/world
        [ -d "$src" ] || exit 0 # no real world yet: the sandbox generates its own
        console() { printf '%s\n' "$1" | timeout 10 tee -a /run/minecraft/paper.stdin >/dev/null; }
        if systemctl is-active --quiet minecraft-server-paper.service; then
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
  };

  # Paper binds loopback, so the bridge reaches RCON (both servers) and the map through forwarders listening on the
  # gateway only (never 0.0.0.0: that would clash with Paper's 127.0.0.1:25575). FreeBind: the bridge may not
  # exist yet. Velocity itself listens on all addresses; only the firewall rule below lets the bridge in.
  systemd.sockets =
    lib.mapAttrs (_: port: {
      wantedBy = ["sockets.target"];
      listenStreams = ["${bridgeGw}:${toString port}"];
      socketConfig.FreeBind = true;
    })
    bridgePorts;

  # One rule for the bridge, like ntfy's: Velocity, both RCONs and the map on the gateway; never a Paper game port.
  networking.firewall.extraCommands = bridgeRule "-A";
  networking.firewall.extraStopCommands = "${bridgeRule "-D"} || true";

  # Velocity on the tailnet and voice chat only; the Paper servers (25567, 25568) and RCON (25575, 25576) are in no list.
  networking.firewall.interfaces.tailscale0 = {
    allowedTCPPorts = [25565];
    allowedUDPPorts = [voicePort];
  };

  # Forwarding secret (existing key) and the real server's RCON password (key `minecraft-rcon-password`, also read
  # by mcbots-seed). Rendered into one root-only environment file, read by systemd. The sandbox's RCON password
  # is generated on the host (sandbox.nix) and read after this file.
  sops = {
    secrets."minecraft-rcon-password".mode = "0400";
    templates."minecraft-servers.env" = {
      mode = "0400";
      restartUnits = ["minecraft-server-paper.service" "minecraft-server-sandbox.service" "minecraft-server-velocity.service"];
      content = ''
        VELOCITY_FORWARDING_SECRET=${config.sops.placeholder."minecraft-velocity-secret"}
        RCON_PASSWORD=${config.sops.placeholder."minecraft-rcon-password"}
      '';
    };
  };
}
