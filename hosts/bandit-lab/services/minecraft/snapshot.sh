# minecraft-snapshot DEST
#
# Copy the Minecraft data directory into DEST without stopping the server.
# Saves are flushed and switched off while rsync reads the files, then switched
# back on, so the world files do not change under the copy (a plain copy of a
# live, auto-saving world is NOT consistent). With the server stopped the
# copy is simply cold and consistent.
#
# Backend: MC_UNIT set = a nix-minecraft server (systemd unit, console FIFO
# MC_CONSOLE); unset = the Docker container MC_CONTAINER.
#
# Not captured: the panel's own backups, caches, logs, BlueMap's rendered tiles
# and downloaded client jar (regenerated). LuckPerms' H2 file is copied as a crash-consistent
# image; a full cold backup at maintenance time is the authoritative copy.
set -euo pipefail

dest=${1:?usage: minecraft-snapshot DEST}
data=${MC_DATA:-/srv/containers/minecraft/data}
unit=${MC_UNIT-}
container=${MC_CONTAINER:-minecraft}
fifo=${MC_CONSOLE:-/run/minecraft/paper.stdin}

if [ -n "$unit" ]; then
  console() { printf "%s\n" "$1" | timeout 10 tee -a "$fifo" >/dev/null; }
  saved_since() { journalctl -u "$unit" --since "@$1" -o cat 2>&1 | grep -q "Saved the game"; }
else
  console() { docker exec --user 1000 "$container" mc-send-to-console "$1" >/dev/null; }
  saved_since() { docker logs --since "$1" "$container" 2>&1 | grep -q "Saved the game"; }
fi

# One snapshot at a time: a second run's save-on would re-enable autosave
# while the first is still copying.
exec 9>"${MC_LOCK:-/run/minecraft-snapshot.lock}"
flock 9

saves_off=false
resume() {
  local attempt
  if [ "$saves_off" = true ]; then
    for attempt in 1 2 3; do
      if console save-on; then
        saves_off=false
        return 0
      fi
      sleep "$attempt"
    done
    echo "ERROR: save-on failed, autosave is OFF: run mc-send-to-console save-on" >&2
    return 1
  fi
}
trap resume EXIT

# Fail closed: only "no such container" (or an inactive/failed unit) means
# cold; anything else must not be mistaken for a stopped server (that would
# copy a live world).
if [ -n "$unit" ]; then
  state=$(systemctl is-active "$unit" 2>&1) || true
  case $state in
    active) running=true ;;
    inactive | failed) running=false ;;
    *)
      echo "cannot tell whether $unit runs: $state" >&2
      exit 1
      ;;
  esac
elif state=$(docker inspect --format '{{.State.Running}}' "$container" 2>&1); then
  running=$state
elif grep -q 'No such object' <<<"$state"; then
  running=false
else
  echo "cannot query docker for $container: $state" >&2
  exit 1
fi
if [ "$running" = true ]; then
  since=$(date +%s)
  console save-off
  saves_off=true
  console 'save-all flush'
  for _ in $(seq 1 90); do
    if saved_since "$since"; then
      flushed=true
      break
    fi
    sleep 2
  done
  if [ "${flushed:-false}" != true ]; then
    echo "save-all flush did not finish within 180 s; refusing to copy" >&2
    exit 1
  fi
fi

mkdir -p "$dest"
rsync -a --delete \
  --exclude=/backups --exclude=/cache --exclude=/logs --exclude=/bluemap \
  "$data"/ "$dest"/
resume || exit 1
echo "snapshot complete: $dest"
