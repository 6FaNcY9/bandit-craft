#!/usr/bin/env bash
# Runs the public world's events datapack on a throwaway Paper server and checks one whole supply drop
# from the console: no event below the player minimum, announcement, landing on the surface with the
# loot table, no second event while one runs, the forced chunk released at the end, the next event after.
#   PAPER=/nix/store/...-paper-26.2-build.130/bin/minecraft-server tools/minecraft-public-events/test.sh
# The server binds 127.0.0.1 only. Needs the pinned Paper (bandit-nix builds it for the lab).
set -euo pipefail

: "${PAPER:?set PAPER to the pinned Paper minecraft-server binary}"
pack="$(cd "$(dirname "$0")/../../hosts/bandit-lab/services/minecraft-public/events" && pwd)"
port="${PORT:-25572}"
dir=$(mktemp -d)
log="$dir/server.log"

cleanup() {
  [ -p "$dir/stdin" ] && echo stop >"$dir/stdin" 2>/dev/null || true
  [ -n "${server:-}" ] && wait "$server" 2>/dev/null || true
  [ -n "${holder:-}" ] && kill "$holder" 2>/dev/null || true
  rm -rf "$dir"
}
trap cleanup EXIT

cd "$dir"
echo 'eula=true' >eula.txt
cat >server.properties <<EOF
server-ip=127.0.0.1
server-port=$port
online-mode=false
enable-rcon=false
view-distance=2
simulation-distance=2
level-seed=bandit-events-test
pause-when-empty-seconds=-1
white-list=true
EOF
mkdir -p world/datapacks
cp -r "$pack" world/datapacks/bev
mkfifo stdin
sleep infinity >stdin &
holder=$!
"$PAPER" -Xms1G -Xmx1G <stdin >"$log" 2>&1 &
server=$!

fail() {
  echo "FAIL: $*" >&2
  sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -v '^\s*at ' | tail -25 >&2
  exit 1
}
# wait_for <seconds> <pattern>: the pattern appears in the log, or the test fails.
wait_for() {
  local i
  for ((i = 0; i < $1 * 5; i++)); do
    grep -q -- "$2" "$log" && return 0
    kill -0 "$server" 2>/dev/null || fail "the server exited while waiting for: $2"
    sleep 0.2
  done
  fail "not seen within $1 s: $2"
}
count() { grep -c -- "$1" "$log" || true; }
cmd() { echo "$*" >stdin; }

wait_for 180 'Done ('
grep -q 'file/bev' <(cmd 'datapack list enabled'; sleep 1; cat "$log") || fail "the datapack is not enabled"
! grep -qiE "couldn't parse|failed to load function|unknown function|error.*bev" "$log" || fail "the datapack loaded with errors"

# Short times for the test; the defaults stay untouched in the pack.
cmd 'scoreboard players set #lead bev 40'
cmd 'scoreboard players set #life bev 60'

# Below the player minimum (default 3, nobody is online) the gap does not run down.
cmd 'scoreboard players set #next bev 5'
sleep 2
[ "$(count 'Supply drop in')" = 0 ] || fail "an event started on an empty server"

cmd 'scoreboard players set #min_players bev 0'
wait_for 10 'Supply drop in 0 min at X'
wait_for 10 'Supply drop landed at X'
read -r x z < <(sed -n 's/.*Supply drop landed at X \(-\?[0-9]*\) Z \(-\?[0-9]*\).*/\1 \2/p' "$log" | head -1)
[ "$x" -ge -4500 ] && [ "$x" -le 4500 ] && [ "$z" -ge -4500 ] && [ "$z" -le 4500 ] || fail "the place $x $z is outside the radius"

# The chest is the top block at that place and carries the loot table.
cmd "execute in minecraft:overworld positioned $x 0 $z positioned over world_surface if block ~ ~-1 ~ minecraft:chest run say TEST chest on the surface"
cmd "execute in minecraft:overworld positioned $x 0 $z positioned over world_surface run data get block ~ ~-1 ~ LootTable"
wait_for 5 'TEST chest on the surface'
wait_for 5 'has the following block data: .*bev:drop'

# The table's gear comes out enchanted (12 draws of 4 to 6 rolls: gear is all but certain to be among them).
cmd "forceload add 0 0"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do cmd 'loot spawn 0 200 0 loot bev:drop'; done
cmd 'execute if entity @e[type=minecraft:item,nbt={Item:{components:{"minecraft:enchantments":{}}}}] run say TEST enchanted gear in the loot'
cmd 'kill @e[type=minecraft:item]'
cmd "forceload remove 0 0"
wait_for 5 'TEST enchanted gear in the loot'

# A due gap does not start a second event while one is live. The next one gets a long lead, so the
# forced-chunk query below falls into its announced phase, when nothing is forced.
cmd 'scoreboard players set #lead bev 400'
cmd 'scoreboard players set #next bev 0'
wait_for 10 'is no longer marked'
before_end=$(sed -n '1,/is no longer marked/p' "$log" | grep -c 'Supply drop in' || true)
[ "$before_end" = 1 ] || fail "$before_end events were announced before the first one ended"

# Nothing stays forced, and the due gap now starts the next event.
cmd 'forceload query'
wait_for 5 'No force loaded chunks were found'
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(count 'Supply drop in')" -ge 2 ] && break
  sleep 0.5
done
[ "$(count 'Supply drop in')" -ge 2 ] || fail "no further event after the first one ended"

echo "ok: drop at $x $z announced, landed with its loot table, ended, and the next one followed"
