# bandit-admin, the public guild's admin bot (docs/specs/2026-11-11-discord-platform.md, phases 1, 2 and 4): keeps the
# guild layout and the INFO texts (teaser with countdown, rules, address, server status), mirrors the lab's ntfy
# alerts into the owner-only #lab-alerts and takes the owner's /bots commands in #bot-kommando (status, stop,
# resume through the bots hub's /api/remote/ door). The bridge bot (phase 3) is a
# separate application inside mc-public; this token never enters that container.
{
  config,
  lib,
  pkgs,
  ...
}: let
  # Bot control needs the bots' hub; without it the bot does everything else.
  hub = config.bandit-lab.mcbots.enable;
in {
  sops.secrets."discord-admin-token".mode = "0400";

  systemd.services.discord-admin = {
    description = "Discord admin bot for the public guild";
    wantedBy = ["multi-user.target"];
    # mcbots-seed writes the hub credential loaded below.
    after = ["network-online.target" "ntfy-sh.service"] ++ lib.optional hub "mcbots-seed.service";
    wants = ["network-online.target" "ntfy-sh.service"] ++ lib.optional hub "mcbots-seed.service";
    environment = {
      GUILD_ID = "1569890251738980352";
      NTFY_URL = "http://127.0.0.1:2586/mcbots";
      # The public world's address (playit tunnel, port from its SRV record). Shown in Discord only from the opening on.
      MC_ADDRESS = "impairment-peterson.tun.ply.gg";
      # The public opening in unix seconds (`date -d '2026-11-28 18:00' +%s`). Empty: the texts say "soon" and show
      # no countdown. From this moment on Discord shows the address, so take the whitelist off by then.
      LAUNCH_AT = "";
      # The hub's dashboard port on the host's loopback. The bot's token opens only /api/remote/ there.
      HUB_URL = lib.mkIf hub "http://127.0.0.1:${config.virtualisation.oci-containers.containers.mcbots.environment.DASHBOARD_PORT}";
    };
    serviceConfig = {
      ExecStart = "${pkgs.nodejs_22}/bin/node ${./app}/main.js";
      # The read-only ntfy user the phone uses (services/ntfy in bandit-nix): no new user, no reseed.
      LoadCredential =
        [
          "token:${config.sops.secrets."discord-admin-token".path}"
          "ntfy:/var/lib/mcbots/ntfy/read-credentials"
        ]
        ++ lib.optional hub "hub:/run/mcbots/remote-token";
      Restart = "on-failure";
      RestartSec = "30s";
      # Exit 2: Discord rewrote a declared channel name; restarting would create it again each time.
      RestartPreventExitStatus = 2;
      DynamicUser = true;
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
      # No IP allow-list: discord.com has no fixed addresses. AF_UNIX for name resolution.
      RestrictAddressFamilies = ["AF_UNIX" "AF_INET" "AF_INET6"];
      SystemCallFilter = "@system-service";
      MemoryMax = "256M";
    };
  };
}
