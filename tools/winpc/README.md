# Windows PC monitor and Andy control (Part 1)

One Windows PowerShell 5.1 SYSTEM agent serves a German dashboard over an exact
Tailscale HTTPS hostname. It monitors Andy, GPU, processes, services, autostart
and cached updates. All three roles (`self`, `operator`, `owner`) can view and
change Andy's pause, gaming share and heat profile. Access is by untagged,
unexpired node StableID, checked with `tailscale whois` before reading a body.

Find StableIDs in `tailscale status --json`: each node's `ID` is its StableID
(confirm it as `Node.StableID` with `tailscale whois --json <tailnet-ip>`).
Use the PC's ID for `self`, the phone's for `operator`, the laptop's for `owner`.
Tailscale must already be installed/joined and HTTPS certificates enabled.
The certificate converter uses Windows CNG and .NET Framework 4.7.2 or newer
(included with current Windows 10/11); no third-party tools are required.

Copy `install-agent.ps1` alone to the PC, then run in **elevated Windows
PowerShell**, substituting actual StableIDs and the watcher's account:

```powershell
& .\install-agent.ps1 -Fqdn slayerpc.tail7facc9.ts.net -Port 8443 -WatcherUser "$env:COMPUTERNAME\yassi" -Access '{"nPC":"self","nPHONE":"operator","nLAPTOP":"owner"}'
# In a PowerShell session, -Access also accepts a hashtable.
```

Open `https://slayerpc.tail7facc9.ts.net:8443/`. The firewall permits only
`100.64.0.0/10` on the Tailscale interface. The installer embeds the agent/page,
protects their ACLs before writing code, imports the certificate, binds HTTP.sys,
and starts `bandit-agent` as SYSTEM. `bandit-agent-renew` renews/rebinds daily.
Rerunning stops both tasks, replaces the protected files, and starts the agent.
It leaves the watcher and writable runtime folder alone. A failed install may
leave the agent stopped; inspect the error and rerun after correcting it.

Files on the PC:

- `C:\bandit-ai\agent`: `agent.ps1`, `ui.html`, installed renewal
  `install-agent.ps1`, `config.json` (`fqdn`, `port`, absolute `tailscale` path),
  `access.json`, `audit.log` and `agent.log` (5 MiB rotation to `.1`).
- `agent\state`: protected certificate/key/PFX and optional `updates.json`.
  No update scan runs in Part 1. Missing cached updates show `no scan yet`.
- `C:\bandit-ai\control`: `pause.flag`, integer `batch-share.txt` (0-100),
  `gpu-profile.json`. Only Administrators/SYSTEM write; watcher SID gets RX.
  Profile numbers: packetMinutes 0-1440, quietFan 0-100, maxTemp 1-100,
  resumeTemp 0-100 and strictly below maxTemp. Zero packetMinutes means unlimited.
  `profile: null` removes the override; the quiet Albert preset is 15/30/75/50.
- `C:\bandit-ai\runtime`: existing watcher log and status-8081/gpu.json,
  read as bounded text with reparse-point refusal. `/slots` is loopback-only.

GET whois answers cache for 60 seconds (expiry is still checked); POST checks
again. Whole status caches for 3 seconds. Each status section runs in a killable
PowerShell worker with a 6.5-second budget; slots have 2 seconds and nvidia-smi
3 seconds. Errors stay in the affected section. Unavailable per-process/Andy GPU
load shows unknown. Probes can make a refresh slower than the 3-second polling
interval; the page avoids overlapping polls. Control changes take effect when
the existing watcher next reads them, normally within 15 seconds.
Scheduled tasks report their enabled state; Run keys and Startup entries report
presence, with enabled state unknown (Task Manager approval flags are not read).

Offline tests, from the repository copy on Windows (no server/install needed):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\test-agent.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\test-install-agent.ps1
```

After editing the agent/page, regenerate their UTF-8 base64 entries in the
installer; the parity test refuses stale payloads. Tests load functions from the
AST and mock external boundaries. Windows certificate import/renewal, HTTP.sys,
ACLs, firewall, tasks and real device access still need a live acceptance check.

Parts 0, 2 and 3 are absent: no key changes, approve/diag keys, admin API/actions,
Windows mutations, update scans/installations, restart/shutdown or Wake-on-LAN.
