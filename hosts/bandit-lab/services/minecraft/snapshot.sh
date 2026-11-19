# minecraft-snapshot DEST
#
# Copy the Minecraft data directory into DEST without stopping the server.
# Saves are flushed and switched off while rsync reads the files, then switched
# back on, so the world files do not change under the copy (a plain copy of a
# live, auto-saving world is NOT consistent). With the server stopped the
# copy is simply cold and consistent.
#
# Backend: the nix-minecraft server MC_UNIT (systemd unit, console FIFO MC_CONSOLE).
# MC_MACHINE set = that server runs inside the nspawn container of
# this name: the unit and its journal are asked through -M, and the console is written
# from inside the box (nixos-container run, as its minecraft user). The box owns its
# paths, so host root never opens them: the data dir must not be a symlink, and the
# copy runs as the box uid that owns the data dir, into DEST (created for that uid;
# its parents must be searchable by it).
#
# Not captured: the panel's own backups, caches, logs, BlueMap's rendered tiles
# and downloaded client jar (regenerated). LuckPerms' H2 file is copied as a crash-consistent
# image; a full cold backup at maintenance time is the authoritative copy.
set -euo pipefail

dest=${1:?usage: minecraft-snapshot DEST}
data=${MC_DATA:-/srv/minecraft/paper}
unit=${MC_UNIT:-minecraft-server-paper}
machine=${MC_MACHINE-}
fifo=${MC_CONSOLE:-/run/minecraft/paper.stdin}
in_machine=()
[ -n "$machine" ] && in_machine=(-M "$machine")

console() {
  if [ -n "$machine" ]; then
    # Inside the box as minecraft: a FIFO the box swapped for a symlink reaches only what minecraft may write.
    # The host-side timeout holds even if the box stops the inner one; 9>&-: the box must not get the host lock.
    # shellcheck disable=SC2016 # $1/$2 expand in the inner sh
    timeout 30 nixos-container run "$machine" -- setpriv --reuid=minecraft --regid=minecraft --clear-groups \
      timeout 10 sh -c 'printf "%s\n" "$1" >>"$2"' _ "$1" "$fifo" >/dev/null 9>&-
  else
    printf "%s\n" "$1" | timeout 10 tee -a "$fifo" >/dev/null
  fi
}
saved_since() { journalctl "${in_machine[@]}" -u "$unit" --since "@$1" -o cat 2>&1 | grep -q "Saved the game"; }

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

# Fail closed: only an inactive/failed unit means cold; anything else must
# not be mistaken for a stopped server (that would copy a live world).
state=$(systemctl "${in_machine[@]}" is-active "$unit" 2>&1) || true
# A container that does not exist as a machine is as cold as a stopped unit; any other
# answer than "running" must not be mistaken for that.
if [ -n "$machine" ]; then
  if mstate=$(machinectl show "$machine" -p State --value 2>&1); then
    [ "$mstate" = running ] || state="machine $machine is $mstate"
  elif grep -q 'No machine' <<<"$mstate"; then
    state=inactive
  else
    state="machinectl: $mstate"
  fi
fi
case $state in
  active) running=true ;;
  inactive | failed) running=false ;;
  *)
    echo "cannot tell whether $unit runs: $state" >&2
    exit 1
    ;;
esac
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

excludes=(--exclude=/backups --exclude=/cache --exclude=/logs --exclude=/bluemap)
if [ -z "$machine" ]; then
  mkdir -p "$dest"
  rsync -a --delete "${excludes[@]}" "$data"/ "$dest"/
else
  if [ -L "$data" ]; then
    echo "refusing: $data is a symlink" >&2
    exit 1
  fi
  # The box's data dir (parent of $data, host-owned above it) belongs to its mapped minecraft uid.
  read -r uid gid < <(stat -c '%u %g' "${data%/*}")
  for id in "$uid" "$gid"; do
    if [ "$id" -lt 589824 ] || [ "$id" -gt 655359 ]; then
      echo "refusing: ${data%/*} is owned by $uid:$gid, not by a box uid (589824-655359)" >&2
      exit 1
    fi
  done
  # cd as root, then check: a symlink swapped in after the test above is caught here, a later swap no longer matters.
  cd "$data"
  if [ "$(pwd -P)" != "$data" ]; then
    echo "refusing: $data resolves to $(pwd -P)" >&2
    exit 1
  fi
  # DEST's parents must be searchable by that uid (the backup's staging dir is 0711).
  install -d -m 0700 -o "$uid" -g "$gid" "$dest"
  setpriv --reuid="$uid" --regid="$gid" --clear-groups \
    rsync -a --delete "${excludes[@]}" ./ "$dest"/
fi
resume || exit 1
echo "snapshot complete: $dest"
