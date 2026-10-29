#!/usr/bin/env bash
# In-game restart warning: 10 minutes (with reason), 7 and 5 minutes, then return after the full
# 10 minutes. The caller restarts the server; this script never announces "restarting now".
#   tools/minecraft-restart-warn.sh REASON
# Env: MC_RCON (default: docker exec minecraft rcon-cli), MC_WARN_MINUTE (seconds per minute, default 60),
# MC_CONSOLE (a nix-minecraft console FIFO, e.g. /run/minecraft/paper.stdin; set = used instead of MC_RCON).
set -euo pipefail

reason=${1-}
if [[ -z ${reason//[[:space:]]/} ]]; then
  echo "usage: minecraft-restart-warn.sh REASON" >&2
  exit 2
fi
rcon=${MC_RCON:-docker exec minecraft rcon-cli}
console=${MC_CONSOLE-}
m=${MC_WARN_MINUTE:-60}

# sleep in the background so the INT trap runs at once instead of after the foreground sleep
sleeper=
nap() { sleep "$1" & sleeper=$!; wait "$sleeper"; }
trap 'kill "$sleeper" 2>/dev/null || true; exit 130' INT

say() {
  if [[ -n $console ]]; then
    printf "say %s\n" "$1" | timeout 10 tee -a "$console" >/dev/null
  else
    # shellcheck disable=SC2086 # $rcon is a command line on purpose
    $rcon say "$1"
  fi
}

say "Server restart in 10 minutes: $reason"
nap $((3 * m))
say "Server restart in 7 minutes"
nap $((2 * m))
say "Server restart in 5 minutes"
nap $((5 * m))
