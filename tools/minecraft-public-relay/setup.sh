#!/usr/bin/env bash
# Turns a fresh Debian or Ubuntu VPS into the public Minecraft relay: Tailscale (tag:mc-relay, shields
# up, no SSH over the tailnet), HAProxy with haproxy.cfg, and a firewall that admits SSH and the game
# port only. Run as root on the VPS, from this directory:
#   ./setup.sh <tailnet address of mc-public>
# It asks for the relay's Tailscale auth key (tagged tag:mc-relay, not reusable); the key is read from
# the terminal and never written to a file or the shell history. Running it again changes nothing.
# Before: the tailnet policy grants tag:mc-relay -> tag:mc-public tcp:25565 and nothing else (PUBLIC.md).
set -euo pipefail

backend=${1:?usage: setup.sh <tailnet address of mc-public>}
[[ $backend =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a tailnet address: $backend" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q haproxy ufw curl

if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale status >/dev/null 2>&1; then
  read -r -s -p "Tailscale auth key for tag:mc-relay: " key
  echo
  tailscale up --auth-key="$key" --advertise-tags=tag:mc-relay --ssh=false --accept-dns=false --accept-routes=false
  unset key
fi
# Nothing in the tailnet may open a connection to the relay; it only dials out to the server.
tailscale set --shields-up=true

sed "s/@BACKEND@/$backend/" "$here/haproxy.cfg" >/etc/haproxy/haproxy.cfg
haproxy -c -q -f /etc/haproxy/haproxy.cfg
systemctl enable -q haproxy
systemctl restart haproxy

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 25565/tcp >/dev/null
ufw --force enable >/dev/null

echo "--- relay"
tailscale ip -4
ss -ltnH | awk '{print $4}' | sort
timeout 5 bash -c "</dev/tcp/$backend/25565" && echo "server reachable on $backend:25565" || echo "CANNOT reach $backend:25565 (tailnet policy? server down?)"
