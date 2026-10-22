# Rehearsal stack (phase 5.3): Paper + Velocity from nix-minecraft, running beside the Docker stack # on a copy of the world. Velocity listens on the tailnet :25566, Paper on 127.0.0.1:25567, RCON on # 25575 (the Docker RCON lives on the Docker network, no host clash). The Docker stack in default.nix is # untouched. Paper and RCON ports are in no firewall list (ci/lab-surface.nix, ci/lab-minecraft.nix).
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

  tailnet = repoConfig.lab.tailscaleIp;
  dataDir = "/srv/minecraft";
  # Simple Voice Chat and BlueMap move off the Docker stack's 24454/udp and 8100/tcp.
  voicePort = 24455;
  mapPort = 8101;

  # The plugins the Docker stack runs, as symlinks into the store (D2: all jars come from plugins.nix).
  # Jarvis is left out of the rehearsal so its live AI/API config is not used twice (owner OK 2026-10-23).
  paperPlugins = lib.mapAttrs' (_: p: lib.nameValuePair "plugins/${p.file}" p.src) (lib.filterAttrs (n: _: n != "jarvis") plugins);

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
    bind = "${tailnet}:25566"
    # Mojang authentication for everyone; BotGate flips single logins offline.
    # VeloAuth decides per connection (see velocity-plugins.nix).
    online-mode = false
    player-info-forwarding-mode = "modern"
    ping-passthrough = "ALL"

    [servers]
    main = "127.0.0.1:25567"
    try = ["main"]

    [advanced]
    haproxy-protocol = false
  '';
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
      package = pkgs.paperServers.paper-26_2-build_130.override {jre = pkgs.jdk25_headless;};
      # Same heap flags as the Docker stack's Aikar setting, with the rehearsal's smaller heap.
      jvmOpts = lib.concatStringsSep " " [
        "-Xms6G"
        "-Xmx6G"
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
      # Modern forwarding: only the three keys velocity-patch.nix sets in the Docker stack; the rest of
      # paper-global.yml comes with the copied world. A missing file fails the start (fail closed).
      extraStartPre = ''
        test -f config/paper-global.yml
        yq -i '.proxies.velocity.enabled = true | .proxies.velocity.online-mode = true | .proxies.velocity.secret = strenv(VELOCITY_FORWARDING_SECRET)' config/paper-global.yml
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
      # Bots from the workstation only; the Docker mcbots subnet is not part of the rehearsal.
      environment.BOTGATE_SOURCES = "${repoConfig.lab.workstationTailscaleIp}/32";
    };
  };

  systemd.services = {
    minecraft-server-paper.serviceConfig = {
      MemoryMax = "9G"; # 6G heap plus off-heap; rehearsal only
      CPUQuota = "300%";
    };

    # Starts after Paper (the backend must resolve) and after the tailnet address exists; retries forever.
    minecraft-server-velocity = {
      after = ["tailscaled.service" "minecraft-server-paper.service"];
      wants = ["tailscaled.service" "minecraft-server-paper.service"];
      startLimitIntervalSec = lib.mkForce 0;
      serviceConfig = {
        MemoryMax = "1G";
        RestartSec = "10s";
      };
    };

    # One-time copy of the live world, before Paper's first start. minecraft-snapshot flushes and pauses
    # saves on the Docker server (no stop, no player impact), rsyncs, and resumes. The stamp makes it
    # run once; delete /srv/minecraft/paper/.rehearsal-copied to copy again.
    minecraft-rehearsal-copy = {
      description = "Copy the live Minecraft world for the rehearsal Paper";
      before = ["minecraft-server-paper.service"];
      requiredBy = ["minecraft-server-paper.service"];
      unitConfig.ConditionPathExists = "!${dataDir}/paper/.rehearsal-copied";
      path = [pkgs.coreutils pkgs.findutils pkgs.gnugrep pkgs.gnused pkgs.systemd];
      serviceConfig = {
        Type = "oneshot";
        TimeoutStartSec = "2h";
        Nice = 10;
        IOSchedulingClass = "idle";
      };
      script = ''
        if systemctl is-active --quiet minecraft-server-paper.service; then
          echo "refusing to copy over a running rehearsal Paper" >&2
          exit 1
        fi
        d=${dataDir}/paper
        ${scripts.snapshot}/bin/minecraft-snapshot "$d"
        find "$d" -name session.lock -delete
        rm -f "$d"/plugins/*.jar "$d"/.rcon-cli.*
        # The Docker stack holds 24454/udp and 8100/tcp. Each pattern must match, else the copy fails.
        v="$d/plugins/voicechat/voicechat-server.properties"
        grep -q '^port=24454$' "$v"
        sed -i 's/^port=24454$/port=${toString voicePort}/' "$v"
        w="$d/plugins/BlueMap/webserver.conf"
        grep -q '^port: 8100$' "$w"
        sed -i 's/^port: 8100$/port: ${toString mapPort}\nip: "127.0.0.1"/' "$w"
        chown -R minecraft:minecraft "$d"
        touch "$d/.rehearsal-copied"
        chown minecraft:minecraft "$d/.rehearsal-copied"
      '';
    };
  };

  # Velocity on the tailnet and voice chat only; Paper (25567) and RCON (25575) are in no list.
  networking.firewall.interfaces.tailscale0 = {
    allowedTCPPorts = [25566];
    allowedUDPPorts = [voicePort];
  };

  # Forwarding secret (existing key) and RCON password (new key `minecraft-rcon-password`, added to
  # secrets/lab.yaml by the owner). Rendered into one root-only environment file, read by systemd.
  sops = {
    secrets."minecraft-rcon-password".mode = "0400";
    templates."minecraft-servers.env" = {
      mode = "0400";
      restartUnits = ["minecraft-server-paper.service" "minecraft-server-velocity.service"];
      content = ''
        VELOCITY_FORWARDING_SECRET=${config.sops.placeholder."minecraft-velocity-secret"}
        RCON_PASSWORD=${config.sops.placeholder."minecraft-rcon-password"}
      '';
    };
  };
}
