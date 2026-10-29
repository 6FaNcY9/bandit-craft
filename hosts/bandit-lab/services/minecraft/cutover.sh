# minecraft-cutover (phase 5.5): the final cold copy of the Docker world into the nix-minecraft data
# directory. Runs once, ordered before the nix servers, after systemd stopped the Docker units
# (Conflicts= in nix-minecraft.nix).
#
# - already stamped: nothing to do.
# - a Docker unit or the container is not provably stopped, or Paper runs: refuse (fail closed, the
#   copy would be of a live world or over a live server).
# - otherwise: rsync --delete from the Docker data to the nix data (backups, cache and logs stay out
#   like in minecraft-snapshot; the BlueMap tiles come along so the map need not re-render), fix the
#   files the host layout needs, stamp both sides.
#
# Env (defaults are the lab): MC_SRC, MC_DEST, MC_OLD_STAMP, MC_OWNER (empty = no chown, for tests),
# MC_OVERLAY_OWNER (the mcbots container uid), MC_DOCKER_UNITS, MC_DOCKER_CONTAINER, MC_PAPER_UNIT.
set -euo pipefail

src=${MC_SRC:-/srv/containers/minecraft/data}
dest=${MC_DEST:-/srv/minecraft/paper}
old_stamp=${MC_OLD_STAMP:-/srv/containers/minecraft/CUTOVER-5.5-DONE}
owner=${MC_OWNER-minecraft:minecraft}
overlay_owner=${MC_OVERLAY_OWNER:-1000:1000}
docker_units=${MC_DOCKER_UNITS:-docker-minecraft.service docker-velocity.service docker-minecraft-sandbox.service}
container=${MC_DOCKER_CONTAINER:-minecraft}
paper_unit=${MC_PAPER_UNIT:-minecraft-server-paper.service}
stamp=$dest/.cutover-done

if [ -e "$stamp" ]; then
  echo "cutover already done ($(cat "$stamp")); nothing to copy"
  exit 0
fi

# Only inactive/failed counts as stopped; anything else (including an unreadable state) refuses.
# shellcheck disable=SC2086 # the unit list is words on purpose
for unit in $docker_units $paper_unit; do
  state=$(systemctl is-active "$unit" 2>&1) || true
  case $state in
    inactive | failed) ;;
    *)
      echo "refusing to copy: $unit is '$state'" >&2
      exit 1
      ;;
  esac
done
if state=$(docker inspect --format '{{.State.Running}}' "$container" 2>&1); then
  running=$state
elif grep -q 'No such object' <<<"$state"; then
  running=false
else
  echo "refusing to copy: cannot query docker for $container: $state" >&2
  exit 1
fi
if [ "$running" != false ]; then
  echo "refusing to copy: container $container is running" >&2
  exit 1
fi
if [ ! -d "$src/world" ]; then
  echo "refusing to copy: $src/world is missing" >&2
  exit 1
fi

mkdir -p "$dest"
rsync -a --delete --exclude=/backups --exclude=/cache --exclude=/logs "$src"/ "$dest"/
count=$(find "$dest" -type f | wc -l)

find "$dest" -name session.lock -delete
# The jars come from plugins.nix as store symlinks; a copied real jar would be moved aside at start.
rm -f "$dest"/plugins/*.jar "$dest"/.rcon-cli.*

# Simple Voice Chat keeps its real port 24454/udp (host firewall: tailscale0 only). BlueMap keeps 8100
# but must listen on loopback now (it was the container's published port). Each pattern must match.
grep -q '^port=24454$' "$dest/plugins/voicechat/voicechat-server.properties"
w=$dest/plugins/BlueMap/webserver.conf
grep -q '^port: 8100$' "$w"
sed -i -e '/^ip:/d' -e 's/^port: 8100$/port: 8100\nip: "127.0.0.1"/' "$w"

install -d -m 0755 "$dest/bluemap/web/mcbots"
if [ -n "$owner" ]; then
  chown -R "$owner" "$dest"
  chown -R "$overlay_owner" "$dest/bluemap/web/mcbots" # the bots container writes the block-log overlay here
fi

now=$(date -Is)
echo "$now" >"$stamp"
[ -z "$owner" ] || chown "$owner" "$stamp"
# A rollback to the pre-cutover generation must not re-run its rehearsal copy over this world.
touch "$dest/.rehearsal-copied"
printf '%s\nThe world was copied to %s and runs there; this directory is cold since this time.\n' "$now" "$dest" >"$old_stamp"
echo "cutover copy finished: $count files, $now"
