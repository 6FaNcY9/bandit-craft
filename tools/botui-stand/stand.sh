#!/usr/bin/env bash
# Local Paper stand for the BotUi plugin: offline-mode server on 127.0.0.1:25599 with Via, token "stand-token".
# Usage: stand.sh up | down
set -euo pipefail
cd "$(dirname "$0")/../.."
M=hosts/bandit-lab/services/minecraft
D="${XDG_RUNTIME_DIR:?}/botui-stand"
PAPER_URL=https://fill-data.papermc.io/v1/objects/715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba/paper-26.2-130.jar
PAPER_SHA=715cd6633db27b2c05ce6efd2d477330ebae8a4f668cf0459fcaf434c4720fba

fetch() { # url sha256-hex dest
  [ -f "$3" ] && echo "$2  $3" | sha256sum -c --status && return 0
  curl -fsSL -o "$3" "$1"
  echo "$2  $3" | sha256sum -c --status || { echo "hash mismatch: $1" >&2; exit 1; }
}
# Via jar url and hash are read from plugins.nix (SRI hash -> hex).
via() { # name
  local url sri
  url=$(grep -A4 "^    $1 = {" $M/plugins.nix | sed -n 's/^ *url = "\(.*\)";/\1/p')
  sri=$(grep -A5 "^    $1 = {" $M/plugins.nix | sed -n 's/^ *hash = "sha256-\(.*\)";/\1/p')
  fetch "$url" "$(echo "$sri" | base64 -d | od -An -vtx1 | tr -d ' \n')" "$D/plugins/$(basename "$url")"
}

case "${1:-}" in
up)
  [ ! -p "$D/in" ] || ! kill -0 "$(cat "$D/pid" 2>/dev/null)" 2>/dev/null || { echo "stand already running" >&2; exit 1; }
  jar=$(nix build .#checks.x86_64-linux.botui --no-link --print-out-paths)
  mkdir -p "$D/plugins"
  fetch "$PAPER_URL" "$PAPER_SHA" "$D/paper.jar"
  via viaversion; via viabackwards
  cp -f "$jar" "$D/plugins/BotUi.jar"; chmod u+w "$D/plugins/BotUi.jar"
  echo 'eula=true' >"$D/eula.txt"
  cat >"$D/server.properties" <<P
online-mode=false
server-port=25599
server-ip=127.0.0.1
level-type=minecraft\:flat
generate-structures=false
enforce-secure-profile=false
rcon.password=stand-token
gamemode=creative
view-distance=4
simulation-distance=4
P
  export BOTUI_BLUEMAP="${BOTUI_BLUEMAP:-http://127.0.0.1:18100}" # e2e-map.js serves a fake BlueMap here
  rm -rf "$D/logs" "$D/world"; rm -f "$D/in"; mkfifo "$D/in"
  (sleep infinity >"$D/in" 2>/dev/null) & echo $! >"$D/holder"
  (cd "$D" && exec nix shell nixpkgs#jdk25_headless -c java -Xmx1500M -jar paper.jar --nogui) <"$D/in" >"$D/console.log" 2>&1 &
  echo $! >"$D/pid"
  for _ in $(seq 240); do
    grep -q 'Done (' "$D/console.log" 2>/dev/null && { echo "stand up (port 25599, token stand-token)"; exit 0; }
    sleep 1
  done
  echo "stand did not start in 240 s, see $D/console.log" >&2
  "$0" down || true
  exit 1
  ;;
down)
  [ -p "$D/in" ] && echo stop >"$D/in" 2>/dev/null &
  pid=$(cat "$D/pid" 2>/dev/null || true)
  for _ in $(seq 60); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill "$pid" 2>/dev/null || true
  kill "$(cat "$D/holder" 2>/dev/null)" 2>/dev/null || true
  rm -f "$D/in" "$D/pid" "$D/holder"
  ;;
*) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
