# bandit-admin, the public guild's admin bot (docs/specs/2026-11-11-discord-platform.md, phases 1 and 2): keeps the
# guild layout and the INFO texts (teaser with countdown, rules, address, server status) and mirrors the lab's ntfy
# alerts into the owner-only #lab-alerts. The bridge bot (phase 3) is a
# separate application inside mc-public; this token never enters that container.
{
  config,
  pkgs,
  ...
}: {
  sops.secrets."discord-admin-token".mode = "0400";

  systemd.services.discord-admin = {
    description = "Discord admin bot for the public guild";
    wantedBy = ["multi-user.target"];
    after = ["network-online.target" "ntfy-sh.service"];
    wants = ["network-online.target" "ntfy-sh.service"];
    environment = {
      GUILD_ID = "1569890251738980352";
      NTFY_URL = "http://127.0.0.1:2586/mcbots";
      # The public world's address (playit tunnel, port from its SRV record). Shown in Discord only from the opening on.
      MC_ADDRESS = "impairment-peterson.tun.ply.gg";
      # The public opening in unix seconds (`date -d '2026-11-28 18:00' +%s`). Empty: the texts say "soon" and show
      # no countdown. From this moment on Discord shows the address, so take the whitelist off by then.
      LAUNCH_AT = "";
    };
    serviceConfig = {
      ExecStart = "${pkgs.nodejs_22}/bin/node ${./app}/main.js";
      # The read-only ntfy user the phone uses (services/ntfy in bandit-nix): no new user, no reseed.
      LoadCredential = [
        "token:${config.sops.secrets."discord-admin-token".path}"
        "ntfy:/var/lib/mcbots/ntfy/read-credentials"
      ];
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
