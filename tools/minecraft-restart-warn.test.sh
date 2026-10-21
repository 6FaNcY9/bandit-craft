#!/usr/bin/env bash
# Test for minecraft-restart-warn.sh: fake rcon-cli, no waiting, no Docker.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/minecraft-restart-warn.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export LOG="$tmp/log"
printf '#!%s\n' "$BASH" >"$tmp/rcon-cli" # absolute bash: the Nix sandbox has no /usr/bin/env
cat >>"$tmp/rcon-cli" <<'EOF'
echo "$*" >>"$LOG"
exit "${FAKE_RC:-0}"
EOF
chmod +x "$tmp/rcon-cli"
export MC_RCON="$tmp/rcon-cli" MC_WARN_MINUTE=0

rc_of() { set +e; "$@" >/dev/null 2>&1; rc=$?; set -e; echo "$rc"; }

# happy path
: >"$LOG"
"$script" "Podman migration"
[ "$(cat "$LOG")" = $'say Server restart in 10 minutes: Podman migration\nsay Server restart in 7 minutes\nsay Server restart in 5 minutes' ]

# missing or blank reason: usage error, nothing broadcast
: >"$LOG"
[ "$(rc_of "$script" "")" = 2 ]
[ "$(rc_of "$script" "   ")" = 2 ]
[ "$(rc_of "$script")" = 2 ]
[ ! -s "$LOG" ]

# rcon down: fails at the first broadcast, nothing after it
: >"$LOG"
[ "$(FAKE_RC=1 rc_of "$script" x)" != 0 ]
[ "$(wc -l <"$LOG")" = 1 ]

# interrupted between broadcasts: non-zero, no further broadcast
: >"$LOG"
set -m # background jobs keep the default SIGINT disposition only with job control
MC_WARN_MINUTE=100 "$script" x >/dev/null 2>&1 &
pid=$!
for _ in $(seq 50); do [ -s "$LOG" ] && break; sleep 0.1; done
kill -INT "$pid"
set +e
wait "$pid"
rc=$?
set -e
[ "$rc" != 0 ]
[ "$(wc -l <"$LOG")" = 1 ]

echo PASS
