#!/usr/bin/env bash
# Test for snapshot.sh with fake systemctl/machinectl/journalctl/nixos-container/setpriv: no root, no server.
# Checks that the container path never writes a host path for the console, copies through setpriv
# as the box uid, and refuses a symlinked data dir or a non-box owner; the private path is unchanged.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/snapshot.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
real_stat=$(command -v stat)
real_install=$(command -v install)
mkdir "$tmp/bin"
stub() { printf '#!%s\n%s\n' "$BASH" "$2" >"$tmp/bin/$1" && chmod +x "$tmp/bin/$1"; }
export LOG="$tmp/log" REAL_STAT="$real_stat" REAL_INSTALL="$real_install"
stub systemctl 'echo active'
stub machinectl 'echo running'
stub journalctl 'echo "Saved the game"'
stub nixos-container 'echo "nixos-container $*" >>"$LOG"'
# setpriv: log, drop the options, run the rest (unprivileged here).
stub setpriv 'echo "setpriv $*" >>"$LOG"; while [[ $1 == --* ]]; do shift; done; exec "$@"'
stub stat 'if [ "$2" = "%u %g" ]; then echo "${FAKE_OWNER:-590823 590823}"; else exec "$REAL_STAT" "$@"; fi'
# install: drop -o/-g (needs root), keep the rest.
stub install 'a=(); while [ $# -gt 0 ]; do case $1 in -o|-g) shift 2 ;; *) a+=("$1"); shift ;; esac; done; exec "$REAL_INSTALL" "${a[@]}"'
export PATH="$tmp/bin:$PATH" MC_LOCK="$tmp/lock" MC_CONSOLE="$tmp/fifo"

data="$tmp/srv/data/paper"
mkdir -p "$data/world" "$data/logs"
echo region >"$data/world/r.0.0.mca"
echo log >"$data/logs/latest.log"
rc_of() { set +e; "$@" >/dev/null 2>&1; rc=$?; set -e; echo "$rc"; }

# container: console inside the box, copy as the box uid, host console path untouched
: >"$LOG"
: >"$tmp/fifo"
MC_MACHINE=mc-public MC_DATA="$data" bash "$script" "$tmp/dest" >/dev/null
[ "$(cat "$tmp/dest/world/r.0.0.mca")" = region ]
[ ! -e "$tmp/dest/logs" ]
[ ! -s "$tmp/fifo" ]
[ "$(grep -c '^nixos-container run mc-public -- setpriv --reuid=minecraft' "$LOG")" = 3 ]
grep -q 'save-off' "$LOG" && grep -q 'save-all flush' "$LOG" && grep -q 'save-on' "$LOG"
grep -q '^setpriv --reuid=590823 --regid=590823 --clear-groups rsync' "$LOG"

# container: a symlinked data dir is refused, nothing copied
ln -s "$data" "$tmp/srv/data/link"
[ "$(MC_MACHINE=mc-public MC_DATA="$tmp/srv/data/link" rc_of bash "$script" "$tmp/dest2")" != 0 ]
[ ! -e "$tmp/dest2" ]

# container: a data dir owned outside the box's uid range is refused
[ "$(FAKE_OWNER='0 0' MC_MACHINE=mc-public MC_DATA="$data" rc_of bash "$script" "$tmp/dest3")" != 0 ]
[ ! -e "$tmp/dest3" ]

# private world: console through the FIFO path, plain copy, no setpriv, no nixos-container
: >"$LOG"
: >"$tmp/fifo"
MC_DATA="$data" bash "$script" "$tmp/dest4" >/dev/null
[ "$(cat "$tmp/dest4/world/r.0.0.mca")" = region ]
[ "$(cat "$tmp/fifo")" = $'save-off\nsave-all flush\nsave-on' ]
[ ! -s "$LOG" ]

echo "snapshot tests passed"
