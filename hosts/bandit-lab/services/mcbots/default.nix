# Mineflayer bots (docs/runbooks/minecraft/BOTS.md): containers on the `mcbots`
# network join Velocity as velocity:25565 (BotGate admits bot1..bot99 from that
# subnet) and are driven from a dashboard served on the tailnet only.
# Switch off: `bandit-lab.mcbots.enable = false;` (or drop the import).
{
  config,
  lib,
  pkgs,
  repoConfig,
  ...
}: let
  cfg = config.bandit-lab.mcbots;
  app = pkgs.callPackage ./package.nix {};
  image = pkgs.dockerTools.buildLayeredImage {
    name = "mcbots";
    contents = [app];
    # Docker seeds the empty mcbots-state volume from this directory, owner included.
    fakeRootCommands = "mkdir -p state && chown 1000:1000 state && chmod 0700 state";
    config = {
      User = "1000:1000";
      Cmd = ["${app}/bin/mcbots"];
    };
  };
  dashboardPort = "8095";
  servePort = "8445";
  # Hub for remote workers (laptop bots): WebSocket on /worker only, bearer
  # token required, published on loopback and exposed by Tailscale Serve.
  workerPort = "8096";
  workerServePort = toString repoConfig.lab.mcbotsWorkerServePort;
  ownerUuids = "623c7ee4-71ca-487a-b92a-a4564e43fbb9"; # fancy8869
  # Few but smart (owner 2026-10-12, docs/specs/2026-10-12-in-game-bot-control.md): only the three
  # agent bots play; bot4, bot10 and bot16-18 are retired. A Node process uses one core, so bot2 and
  # bot3 run in a worker container; the dashboard process keeps bot1. New names must be ones VeloAuth
  # has never seen (see BOT_NAMES below).
  workers = {
    mcbots-worker-2 = {
      bots = "bot2,bot3";
      label = "bandit-lab-worker-2";
    };
    # A fourth helper (owner 2026-10-19): a name VeloAuth has never seen (bot1-18 and bot50-59 are in its database).
    mcbots-worker-3 = {
      bots = "bot19";
      label = "bandit-lab-worker-3";
    };
    # Two more helpers (owner 2026-10-19), two to a process like worker-2; names VeloAuth has never seen.
    mcbots-worker-4 = {
      bots = "bot20,bot21";
      label = "bandit-lab-worker-4";
    };
  };
  # Worker processes: each shares mcbots' network namespace, so it reaches the
  # hub on 127.0.0.1 (plain ws:// is accepted only there) and Velocity from
  # mcbots' address, which BotGate admits.
  workerContainers =
    lib.mapAttrs (_: w: {
      image = "${image.imageName}:${image.imageTag}";
      imageFile = image;
      cmd = ["${app}/bin/mcbots-worker"] ++ lib.splitString "," w.bots;
      environment = {
        HUB_URL = "ws://127.0.0.1:${workerPort}/worker";
        MC_HOST = "10.250.77.2"; # Velocity on the mcbots network (see --add-host above)
        MC_PORT = "25565";
        MC_VHOST = "sandbox.bots"; # owner 2026-10-23: helpers test in the sandbox until the board passes
        OWNER_UUIDS = ownerUuids;
        HOST_LABEL = w.label;
        NODE_OPTIONS = "--max-old-space-size=768";
        # The schematics of the dashboard's projects, from mcbots' own volume: bot2 and bot3 failed every schematic
        # job with "ENOENT ... schematics/ironfarm.litematic" (2026-10-15). Read-write, as the containers
        # filled are recorded there (.filled-*.json) and merged across processes.
        SCHEMATIC_DIR = "/schematics";
      };
      environmentFiles = ["/run/mcbots/worker-${w.label}.env"]; # BOT_PASSWORD_SEED, HUB_TOKEN (this worker's own, R2-6)
      extraOptions = [
        "--network=container:mcbots"
        "--mount=type=volume,source=mcbots-state,target=/schematics,volume-subpath=schematics"
        "--memory=1g"
        "--cpus=2"
        "--pids-limit=256"
        "--cap-drop=ALL"
        "--security-opt=no-new-privileges"
      ];
    })
    workers;
in {
  options.bandit-lab.mcbots.enable = lib.mkEnableOption "Mineflayer bots and their tailnet dashboard" // {default = true;};

  config = lib.mkIf cfg.enable {
    virtualisation.oci-containers.containers =
      workerContainers
      // {
        mcbots = {
          image = "${image.imageName}:${image.imageTag}";
          imageFile = image;
          environment = {
            BOT_NAMES = "bot1"; # bot1 an agent bot; bot2 and bot3 run in the mcbots-worker-2 container, bot19 in mcbots-worker-3, bot20 and bot21 in mcbots-worker-4; bot5 is the local test bot. A new name must never have been registered in VeloAuth (local stages used bot5-9, bot11-15, bot50-59)
            # Owner 2026-10-23: helpers test in the sandbox until the board passes (spec 2026-10-23-bots-redesign);
            # the virtual host sandbox.bots routes them there (../minecraft/sandbox.nix).
            MC_VHOST = "sandbox.bots";
            MC_HOST = "velocity";
            MC_PORT = "25565";
            # Only the owner's in-game orders count (owner.js): the sender UUID of a player chat line.
            OWNER_UUIDS = ownerUuids;
            DASHBOARD_HOST = "0.0.0.0"; # inside the container; published on loopback only
            DASHBOARD_PORT = dashboardPort;
            WORKER_HOST = "0.0.0.0"; # inside the container; published on loopback only
            WORKER_PORT = workerPort;
            # Each worker container's hub credential is good for its own bot names only (R2-6).
            HUB_WORKERS = lib.concatStringsSep ";" (lib.mapAttrsToList (_: w: "${w.label}=${w.bots}") workers);
            HOST_LABEL = "bandit-lab";
            # tailscale serve identifies the tailnet user; everything else gets 403.
            ALLOWED_TS_LOGINS = "6FaNcY9@github";
            # ... but only from where Tailscale Serve's requests arrive: the Docker
            # gateway of the published port (mcbots network, pinned; the minecraft
            # network's current gateway as a fallback). The worker shares this network
            # namespace and could send the header itself (Codex R2-1). A refused
            # identity is logged with its source address.
            TRUSTED_PROXIES = "10.250.77.1,172.22.0.1";
            # Global player positions (read-only JSON) from BlueMap in the minecraft
            # container, reachable over the `minecraft` network.
            BLUEMAP_URL = "http://minecraft:8100";
            # Chest next to the bots' respawn point (spawnpoint -36 64 -197); after a
            # death a bot re-equips armour, sword and food from it.
            SUPPLY_CHEST = "-37,65,-200";
            # Standing orders (dashboard switch, off after every restart): what the
            # keeper keeps in the supply chest, item:amount. Optional KEEPER_SITE
            # "x,y,z" makes the bots walk there before they chop or mine.
            KEEPER_QUOTAS = "logs:64,cobblestone:128,coal:32,torch:64,stone_bricks:128,raw_iron:16,iron_pickaxe:2,iron_sword:1";
            # Resource site in the forest west of spawn (chest -260 65 -213), so
            # standing orders never dig around the spawn base.
            KEEPER_SITE = "-258,65,-210";
            # The plan (app/plan.js, R7): one ordered list of base objectives the hub works through
            # without an LLM. Off while PLAN_ENABLE is empty. With "1" the dashboard gets a Plan panel
            # (still switched off after every restart); PLAN_ROSTER lists the bots it may task and must
            # not contain any AGENT_BOTS. Its geometry (base chest, shaft, rooms) is app/plan-config.js,
            # not SUPPLY_CHEST or KEEPER_SITE.
            # Off since the scripted crew is retired (2026-10-12); plan.js and keeper.js stay for later.
            PLAN_ENABLE = "";
            # Bots never dig or place inside these x1,z1,x2,z2 boxes: the main base
            # around spawn and MidariBread's base (from BlueMap light data, +16).
            PROTECTED_AREAS = "-80,-144,80,80;112,368,272,592";
            NODE_OPTIONS = "--max-old-space-size=1536";
            # Per-bot settings from the dashboard (settings.json) survive restarts.
            STATE_DIR = "/state";
            # The lab's agent service (../mcagents) may drive only these bots; its
            # bearer (AGENT_TOKEN, generated by mcbots-seed) never reaches other jobs.
            # The agent service is off (owner 2026-10-23); bot1 stays its bot, the helpers belong to the board.
            AGENT_BOTS = "bot1";
            # The job board (app/board.js) hands its slices to these bots only; the keeper leaves them alone.
            BOARD_BOTS = "bot2,bot3,bot19,bot20,bot21";
            # Server panel (admin.js): RCON to Paper over the minecraft network; the password
            # (RCON_PASSWORD) arrives in seed.env, and only the human dashboard path can use it.
            RCON_HOST = "minecraft";
            # Stranded bots on the main server are teleported here (app/rescue.js, owner 2026-10-19): grass west of
            # the supply chest with room to stand; the rescue checks the ground before each tp.
            RESCUE_SPOT = "-273,66,-211";
            # Rescue of stranded bots (app/rescue.js) over the sandbox's own console; password in seed.env.
            SANDBOX_RCON_HOST = "minecraft-sandbox";
            # What the bots changed in the world, as a BlueMap overlay (app/blocklog.js).
            BLOCKLOG_EXPORT_DIR = "/bluemap-overlay";
          };
          # Named state volume, plus BlueMap's mcbots/ web directory (owner 1000, made by minecraft-plugins,
          # readable by the minecraft container) for the block-log overlay.
          volumes = [
            "mcbots-state:/state"
            "/srv/containers/minecraft/data/bluemap/web/mcbots:/bluemap-overlay"
          ];
          ports = [
            "127.0.0.1:${dashboardPort}:${dashboardPort}"
            "127.0.0.1:${workerPort}:${workerPort}"
          ];
          # BOT_PASSWORD_SEED for the VeloAuth /register + /login of each bot,
          # derived one-way from the Velocity secret by mcbots-seed below; the
          # container never sees the secret itself. The same file carries
          # WORKER_TOKEN (sops secret mcbots-worker-token), which must not sit in
          # the world-readable environment attribute.
          environmentFiles = ["/run/mcbots/seed.env"];
          extraOptions = [
            "--network=mcbots"
            # Second network only to read BlueMap at minecraft:8100. Paper there
            # accepts logins only with Velocity's forwarding secret. With two
            # networks the name `velocity` could resolve to its minecraft-network
            # address (BotGate refuses that source), so pin it to Velocity's
            # mcbots-network address (gateway .1, velocity .2 of 10.250.77.0/29).
            "--network=minecraft"
            "--add-host=velocity:10.250.77.2"
            "--memory=2g"
            "--cpus=2"
            "--pids-limit=256"
            "--cap-drop=ALL"
            "--security-opt=no-new-privileges"
          ];
        };
      };

    # Shared secret of the hub: remote workers send it as a bearer token. The
    # same key lives in secrets/bandit.yaml for the laptop (nixos/secrets-workstation.nix).
    sops.secrets."mcbots-worker-token".mode = "0400";

    # Workers live in mcbots' network namespace: they restart with it.
    systemd.services =
      lib.mapAttrs' (name: _:
        lib.nameValuePair "docker-${name}" {
          after = ["docker-mcbots.service"];
          requires = ["docker-mcbots.service"];
          partOf = ["docker-mcbots.service"];
          unitConfig.StartLimitIntervalSec = 0;
          serviceConfig = {
            Restart = lib.mkForce "always";
            RestartSec = "15s";
          };
        })
      workers
      // {
        mcbots-seed = {
          description = "Derive the bots' login password seed and hand over the hub, agent and RCON credentials";
          after = ["minecraft-rcon-seed.service" "minecraft-sandbox-rcon-seed.service"];
          requires = ["minecraft-rcon-seed.service" "minecraft-sandbox-rcon-seed.service"];
          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = true;
            UMask = "0077";
          };
          path = [pkgs.coreutils];
          script = ''
            install -d -m 0700 /run/mcbots
            seed=$(printf 'mcbots-login:%s' "$(cat ${config.sops.secrets."minecraft-velocity-secret".path})" | sha256sum | cut -c1-64)
            # Agent service bearer: random, made once on this host, root-only; mcagents
            # reads it as a systemd credential. Delete the file and restart both to rotate.
            install -d -m 0700 /var/lib/mcbots
            [ -s /var/lib/mcbots/agent-token ] || head -c 32 /dev/urandom | sha256sum | cut -c1-64 > /var/lib/mcbots/agent-token
            printf 'BOT_PASSWORD_SEED=%s\nWORKER_TOKEN=%s\nAGENT_TOKEN=%s\nRCON_PASSWORD=%s\nSANDBOX_RCON_PASSWORD=%s\n' "$seed" "$(tr -d '\n' < ${config.sops.secrets."mcbots-worker-token".path})" "$(cat /var/lib/mcbots/agent-token)" "$(cat /var/lib/minecraft-rcon/password)" "$(cat /var/lib/minecraft-sandbox-rcon/password)" > /run/mcbots/seed.env
            # One hub credential per worker container, derived from the shared token and the container's label
            # (the hub derives the same, hub.js workerToken), so a compromised worker cannot act as another.
            shared=$(tr -d '\n' < ${config.sops.secrets."mcbots-worker-token".path})
            ${lib.concatMapStringsSep "\n" (w: ''printf 'BOT_PASSWORD_SEED=%s\nHUB_TOKEN=%s\n' "$seed" "$(printf 'mcbots-worker:%s:%s' '${w.label}' "$shared" | sha256sum | cut -c1-64)" > /run/mcbots/worker-${w.label}.env'') (lib.attrValues workers)}
          '';
        };
        docker-mcbots = {
          after = ["docker-network-mcbots.service" "docker-network-minecraft.service" "docker-velocity.service" "mcbots-seed.service" "minecraft-plugins.service" "docker-minecraft-sandbox.service"]; # minecraft-plugins makes the overlay directory; the sandbox is where the bots play
          requires = ["docker-network-mcbots.service" "docker-network-minecraft.service" "mcbots-seed.service"];
          unitConfig.StartLimitIntervalSec = 0;
          serviceConfig = {
            Restart = lib.mkForce "always";
            RestartSec = "10s";
          };
        };

        # Tailnet-only HTTPS for the dashboard (${servePort}) and the worker hub
        # (${workerServePort}), same time-boxed pattern as
        # minecraft-panel-https (Serve must be enabled once in the Tailscale
        # admin console; never Funnel). After enabling: sudo systemctl restart mcbots-https
        mcbots-https = {
          description = "Tailnet-only HTTPS for the Minecraft bot dashboard";
          after = ["tailscaled.service" "docker-mcbots.service"];
          wants = ["tailscaled.service"];
          wantedBy = ["multi-user.target"];
          path = [config.services.tailscale.package pkgs.coreutils];
          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = true;
            TimeoutStartSec = "90s";
          };
          script = ''
            if ! timeout 30 tailscale serve --bg --https=${servePort} http://127.0.0.1:${dashboardPort}; then
              echo "WARNING: could not publish 127.0.0.1:${dashboardPort} on tailnet HTTPS port ${servePort}; enable Serve and HTTPS Certificates in the Tailscale admin console, then restart this unit" >&2
            fi
            if ! timeout 30 tailscale serve --bg --https=${workerServePort} http://127.0.0.1:${workerPort}; then
              echo "WARNING: could not publish the worker hub 127.0.0.1:${workerPort} on tailnet HTTPS port ${workerServePort}" >&2
            fi
          '';
          preStop = ''
            timeout 30 tailscale serve --https=${servePort} off || true
            timeout 30 tailscale serve --https=${workerServePort} off || true
          '';
        };
      };
  };
}
