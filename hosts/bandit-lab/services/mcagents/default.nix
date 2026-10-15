# Andy-4.2 lead agent (bot1) over scripted workers (tools/mcagents, H4/H5): the
# LLM decides, the scripted mcbots jobs execute. Talks only to the dashboard
# (127.0.0.1:8095, agent bearer: state, events and jobs for AGENT_BOTS) and to
# Ollama (127.0.0.1:11434). Stopping this service leaves running jobs alone.
# Switch off: `bandit-lab.mcagents.enable = false;`.
{
  config,
  lib,
  pkgs,
  ...
}: let
  cfg = config.bandit-lab.mcagents;
  inferenceHosts = lib.filterAttrs (_: host: host.enable) config.bandit-lab.inferenceHosts;
  inferenceNames = lib.optional (inferenceHosts ? slayer) "slayer" ++ lib.filter (name: name != "slayer") (builtins.attrNames inferenceHosts);
  urlOf = name: "http://127.0.0.1:${toString inferenceHosts.${name}.localPort}";
  # Owner's split (2026-10-11): the lab GPU and slayer serve the live agents and the solver; the offline
  # hosts (albert) only get idle replays, the judge and training, never live traffic.
  offlineNames = lib.filter (name: inferenceHosts ? ${name}) cfg.offlineHosts;
  liveNames = lib.filter (name: !(lib.elem name offlineNames)) inferenceNames;
  liveUrls = map urlOf liveNames;
  # The offline services get the same name/url lists plus ANDY_OFFLINE_NAMES; routing.js keeps each side to its own.
  allUrls = map urlOf inferenceNames;
  offlineEnv = {
    ANDY_URLS = lib.concatStringsSep "," allUrls;
    ANDY_BACKEND_NAMES = lib.concatStringsSep "," inferenceNames;
    ANDY_OFFLINE_NAMES = lib.concatStringsSep "," offlineNames;
  };
  # Three equal Andy-4.2 bots, each with a role and no scripted crew (owner 2026-10-12: few but smart;
  # docs/specs/2026-10-12-in-game-bot-control.md). They talk with !startConversation.
  agents = {
    bot1 = {
      goal = "Your role: gatherer. Keep the base chest stocked with logs, cobblestone, coal and torches: check it with !viewChest, fill what is short with !startShift or !collectBlocks, craft torches from coal and sticks, and fight mobs near the base. Tell bot2 or bot3 with !startConversation when they ask for something you can bring.";
      workers = "";
    };
    bot2 = {
      goal = "Your role: miner. Dig the shaft west of the base with !digShaft(-291, -222, -276, -207) until it reaches the bottom, then mine its iron level with !mineLevel(16). Put raw_iron and coal in the base chest with !putInChest, and ask bot1 with !startConversation when you need torches or food.";
      workers = "";
    };
    bot3 = {
      # The wheat field first: the model copies the first command it reads, and without bread in the base chest no
      # bot heals (food under 18); bot1 and bot3 died about 180 times in 48 h (2026-10-15).
      goal = "Your role: food and wood. Keep the wheat field going with !tendWheatField(-262, -250, -254, -242): its bread in the base chest is what every bot eats, and a bot without food does not heal. When the base chest is short of logs, tend the tree farm with !tendTreeFarm(-262, -238, -248, -224) for a while, then go back to the wheat field. Never dig the shaft.";
      workers = "";
    };
  };
in {
  options.bandit-lab.mcagents = {
    enable = lib.mkEnableOption "the Andy-4.2 lead agent and its workers" // {default = true;};
    offlineHosts = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      # slayer replays and grades too (owner 2026-10-15, overnight): the lab GPU alone carried the live agents
      # (85 decisions in 40 min), slayer sat idle as overflow, and albert is often off. albert never gets live
      # traffic (it must stay quiet). ["albert"] puts slayer back on live overflow.
      default = ["albert" "slayer"];
      description = "Inference hosts kept for idle replays, the judge and training; they never get live agent or solver traffic.";
    };
    # On (owner 2026-10-15): only 50 training rows came out of a week, and slayer's grades went unused. The rows keep
    # their own source "judged", so a training run can still leave them out.
    exportJudged = lib.mkEnableOption "judge-graded decisions (source judged) in the daily SFT export" // {default = true;};
  };

  config = lib.mkIf cfg.enable {
    systemd = {
      services = {
        mcagents = {
          description = "Andy-4.2 agents for the Minecraft bots";
          after = ["docker-mcbots.service" "ollama-andy.service"];
          wants = ["docker-mcbots.service" "ollama-andy.service"];
          wantedBy = ["multi-user.target"];
          environment =
            lib.mapAttrs' (bot: a: lib.nameValuePair "WORKERS_${bot}" a.workers) agents
            // {
              API = "http://127.0.0.1:8095";
              OLLAMA_URL = "http://127.0.0.1:11434";
              BLUEPRINTS = "${../mcbots/blueprints}";
              # agent.js splits AGENTS at ";": a goal holding one became a fourth "agent" and cut bot3's goal (2026-10-11).
              AGENTS = lib.concatStringsSep ";" (lib.mapAttrsToList (bot: a: assert lib.assertMsg (!lib.hasInfix ";" a.goal) "mcagents: the goal of ${bot} must not contain ';'"; "${bot}=${a.goal}") agents);
              # Every model call (prompt + reply) for a later LoRA fine-tune; agent.js
              # rotates it at 50 MB and keeps every older file. The journal gets one line per reply.
              LOG = "/var/lib/mcagents/decisions.jsonl";
              # Fix memory (tools/mcagents/lessons.js): which fix followed which kind of failure and whether it
              # worked, from job results; the solver and the agents see it when the problem comes back.
              LESSONS = "/var/lib/mcagents/lessons.json";
              # Problem solver for the plan's roster bots (tools/mcagents/solver.js): a failed job,
              # an idle bot with an error, repeated deaths or a parked objective gets one fix from a
              # safe menu; 30 model calls/hour of its own. Set to 0 for no change in behaviour.
              SOLVER_ENABLE = "1";
              # The agents think far more often (owner, 2026-10-11): a check-in every minute, an immediate prompt
              # when a bot goes idle or a job fails, and a cap of 30 model calls a minute for the lab GPU and
              # slayer together. Orders still stick for 60 s (agent.js assignJob), so they do not flip-flop.
              CHECKIN_MS = "60000";
              MAX_DECISIONS_PER_MIN = "30";
              # Jobs of the scripted crew that finish become training rows (tools/mcagents/demos.js); DEMOS=0 switches it off.
              DEMOS = "1";
              ANDY_OFFLINE_NAMES = lib.concatStringsSep "," offlineNames;
            }
            // lib.optionalAttrs (liveNames != []) {
              ANDY_URLS = lib.concatStringsSep "," liveUrls;
              ANDY_BACKEND_NAMES = lib.concatStringsSep "," liveNames;
              # The lab's RTX 4090 thinks first; the gaming PCs only take the overflow and
              # are otherwise free for replays and training (owner, 2026-10-10).
              ANDY_PREFER = "lab";
            }
            // lib.optionalAttrs (inferenceHosts ? slayer && !(lib.elem "slayer" offlineNames)) {
              ANDY_URL_2 = "http://127.0.0.1:${toString inferenceHosts.slayer.localPort}";
            };
          serviceConfig = {
            ExecStart = "${pkgs.nodejs}/bin/node ${../../../../tools/mcagents}/agent.js";
            LoadCredential = "dashboard-token:/var/lib/mcbots/agent-token";
            Restart = "always";
            RestartSec = "30s";
            DynamicUser = true;
            StateDirectory = "mcagents";
            NoNewPrivileges = true;
            CapabilityBoundingSet = "";
            ProtectSystem = "strict";
            ProtectHome = true;
            PrivateTmp = true;
            PrivateDevices = true;
            ProtectKernelTunables = true;
            ProtectKernelModules = true;
            ProtectControlGroups = true;
            LockPersonality = true;
            RestrictNamespaces = true;
            RestrictAddressFamilies = ["AF_INET" "AF_INET6"];
            # Docker publishes the loopback ports by DNAT (no userland proxy), so the
            # packets leave with the container addresses: mcbots on 10.250.77.0/29
            # or the minecraft network, Ollama on the default bridge (172.16/12).
            # Internet, LAN and tailnet stay closed.
            IPAddressAllow = ["localhost" "10.250.77.0/29" "172.16.0.0/12"];
            IPAddressDeny = "any";
            SystemCallFilter = "@system-service";
            MemoryMax = "512M";
          };
        };
        # Idle replay and judge (owner, 2026-10-10/11): while an offline gaming PC's llama-server (albert)
        # answers /health (nobody is gaming), replay logged decisions against it and record the scores in
        # /var/lib/mcagents/replays, then let it grade decisions with an unknown outcome (judge.js, appended
        # to judgments.jsonl). Never touches Ollama or the live backends; loopback and ntfy only.
        mcagents-idle-replay = lib.mkIf (offlineNames != []) {
          description = "Replay and judge logged Minecraft agent decisions on idle gaming PCs";
          # A deploy must not stop a running pass and then wait up to its 1 h start timeout for the new
          # one (lab-update apply sat 30 min on it, 2026-10-12); the next timer run picks up new code.
          restartIfChanged = false;
          environment =
            offlineEnv
            // {
              JUDGE_BATCH = "200";
              # The offline PCs replay, then grade; a live slayer grades meanwhile in mcagents-judge-slayer (below).
              JUDGE_NAMES = lib.concatStringsSep "," offlineNames;
              # grade batch after batch for up to 20 min per pass (replay first, all inside the 1 h start timeout)
              JUDGE_PASS_MS = "1200000"; # owner: use the idle PCs as much as possible (2026-10-11)
              LOG = "/var/lib/mcagents/decisions.jsonl";
              REPLAYS = "/var/lib/mcagents/replays";
              VARIANTS = "${../../../../tools/mcagents/variants.json}";
              NTFY_URL = "http://127.0.0.1:2586/mcbots";
            };
          serviceConfig = {
            Type = "oneshot";
            # Both steps run even when the first fails (a PC that went back to gaming ends it early, not badly).
            ExecStart = [
              "-${pkgs.nodejs}/bin/node ${../../../../tools/mcagents}/idle-replay.js"
              "-${pkgs.nodejs}/bin/node ${../../../../tools/mcagents}/judge.js"
            ];
            LoadCredential = "ntfy:/var/lib/mcbots/ntfy/publisher.env";
            # Same dynamic user as mcagents.service, so the state directory is shared.
            DynamicUser = true;
            User = "mcagents";
            StateDirectory = "mcagents";
            Nice = 19;
            IOSchedulingClass = "idle";
            CPUSchedulingPolicy = "idle";
            TimeoutStartSec = "1h";
            NoNewPrivileges = true;
            CapabilityBoundingSet = "";
            ProtectSystem = "strict";
            ProtectHome = true;
            PrivateTmp = true;
            PrivateDevices = true;
            ProtectKernelTunables = true;
            ProtectKernelModules = true;
            ProtectControlGroups = true;
            LockPersonality = true;
            RestrictNamespaces = true;
            RestrictAddressFamilies = ["AF_INET" "AF_INET6"];
            IPAddressAllow = ["localhost"];
            IPAddressDeny = "any";
            SystemCallFilter = "@system-service";
            MemoryMax = "512M";
          };
        };
        # Replay and judge take only the GPU a PC's own programs leave free and wait while they leave none
        # (tools/mcagents/routing.js gpuPacer, /gpu.json from tools/slayer/watch.ps1; owner 2026-10-12).
        # slayer grades from the oldest end while albert replays (it sat at 0 % through every replay, owner
        # 2026-10-11); the two judges never pick the same decisions. Same sandbox as the idle replay.
        mcagents-judge-slayer = lib.mkIf (offlineNames != [] && inferenceHosts ? slayer && !(lib.elem "slayer" offlineNames)) {
          description = "Grade logged Minecraft agent decisions on slayer";
          restartIfChanged = false;
          environment =
            config.systemd.services.mcagents-idle-replay.environment
            // {
              JUDGE_NAMES = "slayer";
              JUDGE_FROM = "oldest";
            };
          serviceConfig =
            config.systemd.services.mcagents-idle-replay.serviceConfig
            // {
              ExecStart = ["-${pkgs.nodejs}/bin/node ${../../../../tools/mcagents}/judge.js"];
            };
        };
        # Daily training export (owner, 2026-10-11): good decisions, solver calls and crew demonstrations from the log as
        # sft.jsonl + stats.json for the LoRA run on the gaming PC (tools/slayer/train). The data is bot
        # prompts and state only (dataset.js drops secret-shaped and human-chat rows). The dynamic user's
        # state directory is private, so a root ExecStartPost publishes the result world-readable under
        # /var/lib/mcagents-export for the admin user. Empty or missing log: empty export, exit 0.
        mcagents-dataset = {
          description = "Export logged Minecraft agent decisions as an SFT dataset";
          environment = {
            LOG = "/var/lib/mcagents/decisions.jsonl";
            DEMO_RATIO = "3"; # demonstrations of the scripted crew: at most 3 x the agent rows
            JUDGED =
              if cfg.exportJudged
              then "1"
              else "0";
          };
          serviceConfig = {
            Type = "oneshot";
            # The frozen eval set first (built once, then kept), so the export can leave its situations out.
            ExecStart = [
              "${pkgs.nodejs}/bin/node ${../../../../tools/mcagents}/eval-set.js /var/lib/mcagents/decisions.jsonl /var/lib/mcagents/eval"
              "${pkgs.nodejs}/bin/node ${../../../../tools/mcagents}/export-sft.js /var/lib/mcagents/decisions.jsonl /var/lib/mcagents/export"
            ];
            ExecStartPost = "+${pkgs.coreutils}/bin/install -m 0644 /var/lib/mcagents/export/sft.jsonl /var/lib/mcagents/export/stats.json /var/lib/mcagents-export/";
            # Same dynamic user as mcagents.service, so the log is readable.
            DynamicUser = true;
            User = "mcagents";
            StateDirectory = "mcagents";
            Nice = 19;
            IOSchedulingClass = "idle";
            CPUSchedulingPolicy = "idle";
            TimeoutStartSec = "10min";
            NoNewPrivileges = true;
            CapabilityBoundingSet = "";
            ProtectSystem = "strict";
            ProtectHome = true;
            PrivateTmp = true;
            PrivateDevices = true;
            PrivateNetwork = true;
            ProtectKernelTunables = true;
            ProtectKernelModules = true;
            ProtectControlGroups = true;
            LockPersonality = true;
            RestrictNamespaces = true;
            RestrictAddressFamilies = "none";
            SystemCallFilter = "@system-service";
            MemoryMax = "512M";
          };
        };
      };
      timers = {
        mcagents-judge-slayer = lib.mkIf (offlineNames != [] && inferenceHosts ? slayer && !(lib.elem "slayer" offlineNames)) {
          wantedBy = ["timers.target"];
          timerConfig = config.systemd.timers.mcagents-idle-replay.timerConfig;
        };
        mcagents-idle-replay = lib.mkIf (offlineNames != []) {
          wantedBy = ["timers.target"];
          timerConfig = {
            # A calendar time, not OnBootSec: a timer whose boot delay has long passed fires the
            # moment a deploy starts it, and a failed run then rolls the whole deploy back (2026-10-10).
            OnCalendar = "*-*-* *:15,45:00"; # every 30 min; a run still going simply skips the next start
            RandomizedDelaySec = "10min";
          };
        };
        mcagents-dataset = {
          wantedBy = ["timers.target"];
          # A calendar time, not OnBootSec (see the idle-replay timer).
          timerConfig = {
            OnCalendar = "*-*-* 04:20:00";
            RandomizedDelaySec = "10min";
          };
        };
      };
      # The export directory mcagents-dataset publishes to (see above).
      tmpfiles.rules = ["d /var/lib/mcagents-export 0755 root root -"];
    };
  };
}
