#!/usr/bin/env bash
# Runs the public world's events datapack on a throwaway Paper server and checks every event kind from
# the console: the schedule (no event below the player minimum, one at a time, the next one after), then
# drop, boss, dungeon, meteor, thunderstorm and blood night each from announcement to end, and that
# nothing stays forced.
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
"$PAPER" -Xms1G -Xmx2G <stdin >"$log" 2>&1 &
server=$!

plain() { sed 's/\x1b\[[0-9;]*m//g' "$log"; }
fail() {
  echo "FAIL: $*" >&2
  plain | grep -v '^\s*at ' | tail -25 >&2
  exit 1
}
# wait_for <seconds> <pattern>: the pattern appears in the log, or the test fails.
wait_for() {
  local i
  for ((i = 0; i < $1 * 5; i++)); do
    plain | grep -q -- "$2" && return 0
    kill -0 "$server" 2>/dev/null || fail "the server exited while waiting for: $2"
    sleep 0.2
  done
  fail "not seen within $1 s: $2"
}
count() { plain | grep -c -- "$1" || true; }
# wait_count <n> <pattern> <what>: the pattern has appeared n times within 5 s, or the test fails.
wait_count() {
  local i
  for ((i = 0; i < 25; i++)); do
    [ "$(count "$2")" -ge "$1" ] && return 0
    sleep 0.2
  done
  fail "$3"
}
cmd() { echo "$*" >stdin; }
score() { cmd "scoreboard players set #$1 bev $2"; }
# say_if <label> <condition...>: the server says "TEST <label>" when the condition holds.
say_if() {
  local label=$1
  shift
  cmd "execute $* run say TEST $label"
  wait_for 5 "TEST $label"
}
# start <kind>: the next event is of that kind and is due now.
start() {
  score force "$1"
  score next 0
}
# blocks_near_mark <block>: how many of them lie within 15 blocks of the event's mark (they are cloned
# onto themselves, so nothing changes; fill with the same block reports nothing).
blocks_near_mark() {
  local before
  before=$(count 'Successfully cloned')
  cmd "execute at @e[type=minecraft:marker,tag=bev_mark,limit=1] run clone ~-15 ~-15 ~-15 ~15 ~15 ~15 ~-15 ~-15 ~-15 filtered $1 force"
  sleep 1
  [ "$(count 'Successfully cloned')" -gt "$before" ] || { echo 0; return; }
  plain | sed -n 's/.*Successfully cloned \([0-9]*\) block.*/\1/p' | tail -1
}

wait_for 180 'Done ('
cmd 'datapack list enabled'
wait_for 5 'file/bev'
! plain | grep -qiE "couldn't parse|failed to load|unknown function" || fail "the datapack loaded with errors"

# Short times for the test; the defaults stay untouched in the pack.
score lead 40
score life 60

# --- The schedule, with the drop.
# Below the player minimum (default 3, nobody is online) the gap does not run down.
score force 1
score next 5
sleep 2
[ "$(count 'Supply drop in')" = 0 ] || fail "an event started on an empty server"

score min_players 0
wait_for 10 'Supply drop in 0 min at X'
wait_for 10 'Supply drop landed at X'
read -r x z < <(plain | sed -n 's/.*Supply drop landed at X \(-\?[0-9]*\) Z \(-\?[0-9]*\).*/\1 \2/p' | head -1)
[ "$x" -ge -4500 ] && [ "$x" -le 4500 ] && [ "$z" -ge -4500 ] && [ "$z" -le 4500 ] || fail "the place $x $z is outside the radius"

# The chest is the top block at that place and carries the loot table.
say_if 'chest on the surface' "in minecraft:overworld positioned $x 0 $z positioned over world_surface if block ~ ~-1 ~ minecraft:chest"
cmd "execute in minecraft:overworld positioned $x 0 $z positioned over world_surface run data get block ~ ~-1 ~ LootTable"
wait_for 5 'has the following block data: .*bev:drop'

# A due gap does not start a second event while one is live.
score lead 400
start 1
wait_for 10 'is no longer marked'
before_end=$(plain | sed -n '1,/is no longer marked/p' | grep -c 'Supply drop in' || true)
[ "$before_end" = 1 ] || fail "$before_end events were announced before the first one ended"

# Nothing stays forced (the next event is still in its lead time), and the due gap started that event.
cmd 'forceload query'
wait_for 5 'No force loaded chunks were found'
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ "$(count 'Supply drop in')" -ge 2 ] && break
  sleep 0.5
done
[ "$(count 'Supply drop in')" -ge 2 ] || fail "no further event after the first one ended"
score timer 0
wait_for 5 'Supply drop landed at X.*' # the second one goes live
sleep 0.5
score timer 0
sleep 1
[ "$(count 'is no longer marked')" = 2 ] || fail "the second drop did not end"

# The loot tables' gear comes out enchanted (12 draws each: gear is all but certain to be among them).
cmd 'forceload add 0 0'
for table in drop boss dungeon; do
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do cmd "loot spawn 0 200 0 loot bev:$table"; done
  kept=enchantments
  [ "$table" != dungeon ] || kept=stored_enchantments # its enchanted thing is a book
  say_if "enchanted loot in $table" "if entity @e[type=minecraft:item,nbt={Item:{components:{\"minecraft:$kept\":{}}}}]"
  cmd 'kill @e[type=minecraft:item]'
  sleep 0.5
done
cmd 'forceload remove 0 0'

score lead 20
score life 600

# --- Boss: alive with its guards and its bar, and killing it ends the event and drops its loot.
start 2
wait_for 10 'Something is waking at X'
wait_for 10 'A boss has awoken at X'
say_if 'boss and guards' 'if entity @e[tag=bev_boss] if entity @e[tag=bev_guard]'
cmd 'bossbar get bev:boss max'
wait_for 5 'has a maximum of [34]00'
cmd 'kill @e[tag=bev_boss]'
wait_for 5 'The boss has been slain'
wait_for 5 'The event at X .* is over'
cmd 'bossbar list'
wait_for 5 'There are no custom bossbars active'
cmd 'kill @e[tag=bev_guard]'

# --- Dungeon: the template stands at the place with both of its spawners.
start 3
wait_for 10 'A ruin surfaces in'
wait_for 10 'A ruin has surfaced at X'
spawners=$(blocks_near_mark minecraft:spawner)
[ "$spawners" = 2 ] || fail "the dungeon has $spawners spawners near its mark, not 2"
chests=$(blocks_near_mark minecraft:chest)
[ "$chests" = 1 ] || fail "the dungeon has $chests chests near its mark, not 1"
score timer 0
wait_count 2 'The event at X' "the dungeon event did not end"

# --- Meteor: a crater, and the core with its ancient debris in it a second later.
start 4
wait_for 10 'A meteor will hit X'
wait_for 10 'A meteor has hit X'
sleep 2.5
debris=$(blocks_near_mark minecraft:ancient_debris)
[ "$debris" -ge 5 ] || fail "the meteor left $debris ancient debris near its mark"
score timer 0
wait_count 3 'The event at X' "the meteor event did not end"

# --- Thunderstorm: begins, a bolt's helper leaves nothing behind, passes.
start 5
wait_for 10 'A thunderstorm arrives in'
wait_for 10 'The thunderstorm is here'
cmd 'forceload add 0 0'
sleep 0.5
cmd 'execute in minecraft:overworld positioned 0 0 0 positioned over world_surface run function bev:storm/bolt'
say_if 'no bolt marker left' 'unless entity @e[type=minecraft:marker,tag=bev_bolt]'
score timer 0
wait_for 5 'The thunderstorm has passed'

# --- Blood night: begins, a wave brings its two mobs, ends.
start 6
wait_for 10 'A blood night falls in'
wait_for 10 'The blood night has fallen'
cmd 'execute in minecraft:overworld positioned 0 0 0 positioned over world_surface run function bev:blood/wave'
say_if 'blood wave' 'if entity @e[type=minecraft:zombie,tag=bev_blood] if entity @e[type=minecraft:skeleton,tag=bev_blood]'
cmd 'kill @e[tag=bev_blood]'
score timer 0
wait_for 5 'The blood night is over'
cmd 'forceload remove 0 0'

# --- Nothing is left forced or half done.
score next 999999
sleep 0.5
cmd 'forceload query'
sleep 1
[ "$(count 'No force loaded chunks were found')" -ge 2 ] || fail "chunks are still forced after all events"
! plain | grep -qiE 'unknown or incomplete command|failed to execute|macro' || fail "a function reported an error"

echo "ok: schedule, drop at $x $z, boss, dungeon ($spawners spawners), meteor ($debris debris), thunderstorm and blood night"
