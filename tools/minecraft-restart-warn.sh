#!/usr/bin/env bash
# In-game restart warning: 5 minutes (with reason) and 1 minute, then return after the full
# 5 minutes. The terminal shows a countdown; Enter skips the rest of the wait (returns 0, the
# deploy goes on), Ctrl-C aborts (130). The caller restarts the server; this script never
# announces "restarting now".
#   tools/minecraft-restart-warn.sh REASON
# Env: MC_RCON (default: mcrcon; needs MCRCON_PASS), MC_WARN_MINUTE (seconds per minute, default 60),
# MC_CONSOLE (console FIFO; default /run/minecraft/paper.stdin when it exists, else MC_RCON is used).
set -euo pipefail

reason=${1-}
if [[ -z ${reason//[[:space:]]/} ]]; then
  echo "usage: minecraft-restart-warn.sh REASON" >&2
  exit 2
fi
rcon=${MC_RCON:-mcrcon}
console=${MC_CONSOLE-$([ -w /run/minecraft/paper.stdin ] && echo /run/minecraft/paper.stdin || true)}
m=${MC_WARN_MINUTE:-60}

# sleep in the background so the INT trap runs at once instead of after the foreground sleep
sleeper=
nap() { sleep "$1" & sleeper=$!; wait "$sleeper"; }
trap 'kill "$sleeper" 2>/dev/null || true; echo >&2; exit 130' INT

say() {
  if [[ -n $console ]]; then
    printf "say %s\n" "$1" | timeout 10 tee -a "$console" >/dev/null
  else
    # shellcheck disable=SC2086 # $rcon is a command line on purpose
    $rcon say "$1"
  fi
}

# countdown SECONDS EXTRA: one tick per second, shows SECONDS+EXTRA left; returns 1 when Enter skips
eof=
countdown() {
  local left=$1 t rc
  while ((left > 0)); do
    t=$((left + $2))
    if [[ -t 0 && -z $eof ]]; then
      printf '\r  Neustart in %d:%02d   Enter = jetzt   Ctrl-C = abbrechen ' $((t / 60)) $((t % 60)) >&2
      rc=0
      read -r -t 1 _ || rc=$?
      ((rc == 0)) && return 1
      # rc > 128 is the 1 s timeout; anything else is EOF (hung-up tty): stop reading, keep counting
      ((rc > 128)) || { eof=1; nap 1; }
    else
      nap 1
    fi
    left=$((left - 1))
  done
}

skip() {
  echo >&2
  say "Server restart in a few seconds"
  exit 0
}

# drop Enter presses typed during the earlier deploy steps, so only a fresh Enter skips
if [[ -t 0 ]]; then while read -r -t 0 _; do read -r _ || break; done; fi
say "Server restart in 5 minutes: $reason"
countdown $((4 * m)) "$m" || skip
say "Server restart in 1 minute"
countdown "$m" 0 || skip
[[ -t 0 ]] && echo >&2
exit 0
