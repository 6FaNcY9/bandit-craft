# bandit-admin, the public guild's admin bot (docs/specs/2026-11-11-discord-platform.md, phase 1): keeps the
# guild layout and mirrors the lab's ntfy alerts into the owner-only #lab-alerts. The bridge bot (phase 3) is a
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
