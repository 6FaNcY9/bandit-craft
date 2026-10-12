# pc-admin: admin on a gaming PC with the owner's finger (tools/winpc/pc-admin.nix prepends pc() and $pcs).
usage() {
  echo "usage: pc-admin shell <pc>                           admin PowerShell on the PC" >&2
  echo "       pc-admin run <pc> <folder> <script.ps1> [args]  copy <folder> to the PC and run <script.ps1> in it as admin" >&2
  echo "pcs: $pcs" >&2
  exit 2
}
if [[ $# -lt 2 ]] || ! pc "$2"; then usage; fi
case "$1" in
  shell) [[ $# -eq 2 ]] || usage ;;
  run)
    [[ $# -ge 4 ]] || usage
    [[ $4 =~ ^[A-Za-z0-9._-]+\.ps1$ && -f $3/$4 ]] || { echo "pc-admin: <script.ps1> must be a file directly in <folder>" >&2; exit 2; }
    ;;
  *) usage ;;
esac

# A fresh authentication every call (finger, password as fallback); never an earlier sudo timestamp.
if [[ $EUID -ne 0 ]]; then
  echo "pc-admin: $* -- admin on $2, confirm with your finger" >&2
  /run/wrappers/bin/sudo -k
  exec /run/wrappers/bin/sudo "$0" "$@"
fi

opts=(-i /var/lib/pc-admin/shell -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/ssh/ssh_known_hosts)
if [[ $1 == shell ]]; then
  exec ssh "${opts[@]}" -t "$user@$addr" powershell -NoLogo
fi

# A PowerShell single-quoted literal. Commands go -EncodedCommand, so no quoting has to survive cmd.exe.
q() {
  local s=${1//"'"/"''"}
  printf "'%s'" "$s"
}
remote_ps() {
  # No progress records: under -EncodedCommand PowerShell sends them as CLIXML, which flooded the
  # terminal and stalled the first `pc-admin run` of install-agent.ps1 on slayer (2026-10-13).
  local cmd="\$ProgressPreference = 'SilentlyContinue'; $1"
  # shellcheck disable=SC2029 # the encoded command is built here on purpose
  ssh "${opts[@]}" "$user@$addr" "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $(printf '%s' "$cmd" | iconv -f UTF-8 -t UTF-16LE | base64 -w0)"
}

src=$(realpath "$3")
script=$4
shift 4
name=$(basename "$src")
# agent\run is Administrators/SYSTEM only (install-agent.ps1), so nothing unprivileged on the PC can swap
# the files between the copy and the run; the run folder is removed afterwards.
dir="C:\\bandit-ai\\agent\\run\\$(date +%Y%m%d-%H%M%S)-$$"
remote_ps "New-Item -ItemType Directory -Path $(q "$dir") -ErrorAction Stop | Out-Null"
scp "${opts[@]}" -rq "$src" "$user@$addr:${dir//\\//}/"
cmd="& $(q "$dir\\$name\\$script")"
for arg in "$@"; do cmd+=" $(q "$arg")"; done
remote_ps "\$code = 1; try { $cmd; \$code = [int]\$LASTEXITCODE } finally { Remove-Item -LiteralPath $(q "$dir") -Recurse -Force -ErrorAction SilentlyContinue }; exit \$code"
