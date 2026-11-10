#!/usr/bin/env bash
# Plays one supply drop with Mineflayer bots on a throwaway Paper server and prints what they measured
# (distance, time to arrive, what was in the chest, who got it) plus the server's tick time. The bots speak
# 26.1, so this server gets ViaVersion and ViaBackwards; the public server has neither and needs neither.
#   PAPER=<minecraft-server> VIAVERSION=<jar> VIABACKWARDS=<jar> NODE_PATH=<mcbots node_modules> \
#     tools/minecraft-public-events/bot-run.sh [bots=2] [radius=48]
# The server binds 127.0.0.1 only and is removed afterwards. Not a pass/fail test of the pack (test.sh is):
# it exits 0 when at least one bot took loot. The world is flat, so the walk says little about real terrain.
set -euo pipefail

: "${PAPER:?}" "${VIAVERSION:?}" "${VIABACKWARDS:?}" "${NODE_PATH:?}"
here="$(cd "$(dirname "$0")" && pwd)"
pack="$(cd "$here/../../hosts/bandit-lab/services/minecraft-public/events" && pwd)"
bots="${1:-2}"
radius="${2:-48}"
port="${PORT:-25573}"
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
enforce-secure-profile=false
enable-rcon=false
difficulty=hard
view-distance=6
simulation-distance=4
level-type=minecraft\\:flat
generate-structures=false
pause-when-empty-seconds=-1
EOF
mkdir -p world/datapacks plugins
cp -r "$pack" world/datapacks/bev
cp "$VIAVERSION" "$VIABACKWARDS" plugins/
chmod u+w plugins/*.jar
mkfifo stdin
sleep infinity >stdin &
holder=$!
"$PAPER" -Xms1G -Xmx2G <stdin >"$log" 2>&1 &
server=$!
cmd() { echo "$*" >stdin; }
wait_for() {
  local i
  for ((i = 0; i < $1 * 5; i++)); do
    grep -q -- "$2" "$log" && return 0
    kill -0 "$server" 2>/dev/null || { echo "the server exited" >&2; tail -20 "$log" >&2; exit 1; }
    sleep 0.2
  done
  echo "not seen within $1 s: $2" >&2
  sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -v '^\s*at ' | tail -20 >&2
  exit 1
}

wait_for 180 'Done ('
cmd 'time set day'
cmd 'gamerule advance_time false'
cmd "data modify storage bev:cfg radius set value $radius"
cmd 'scoreboard players set #lead bev 200'   # 10 seconds from the announcement to the landing
cmd 'scoreboard players set #life bev 2400'  # marked for two minutes
cmd "scoreboard players set #min_players bev $bots"
cmd 'scoreboard players set #next bev 200'   # the gap runs down once every bot is in

node "$here/bot.js" "$port" "$bots" 150 >"$dir/bots.json" &
node=$!
# Everyone onto the surface near 0 0, apart from each other, as soon as they are in.
for ((i = 0; i < 150; i++)); do
  [ "$(grep -c 'joined the game' "$log" || true)" -ge "$bots" ] && break
  sleep 0.2
done
# The chunks around 0 0 must be there before anyone can be put on their surface.
cmd 'forceload add -32 -32 32 32'
sleep 3
cmd 'spreadplayers 0 0 6 24 false @a'
sleep 1
cmd 'forceload remove all'
rc=0
wait "$node" || rc=$?
cmd 'tick query'
sleep 1

cat "$dir/bots.json"
echo "--- server"
sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -E 'Supply drop|Spread|spread|Average time per tick|Percentiles|joined the game|was slain|drowned|fell|died' | cut -c1-160
exit "$rc"
