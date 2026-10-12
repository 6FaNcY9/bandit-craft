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
It leaves the watcher alone; `runtime` gets its own Modify grant for the watcher
account before `C:\bandit-ai` loses broad write (on slayer runtime only inherited
it from `C:\`). The agent restarts itself 30 s after a fatal error, since Task
Scheduler's restart count only covers a failed launch. A failed install may
leave the agent stopped; inspect the error and rerun after correcting it.

Files on the PC:

- `C:\bandit-ai\agent`: `agent.ps1`, `ui.html`, installed renewal
  `install-agent.ps1`, `config.json` (`fqdn`, `port`, `tailscale` = the Program Files binary),
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
again. Each status section has its own cache: Andy and GPU 3 s, processes 10 s,
services, autostart and updates 60 s; a failed section is retried after 3 s. Each status section runs in a killable
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

## Part 0: keys behind the finger

`pc-admin` on the laptop (`pc-admin.nix`, imported by bandit-nix; PCs in `pcs.nix`) is the only admin
way onto a PC. Every call re-authenticates through sudo (`sudo -k` first: finger, password as fallback)
and uses `/var/lib/pc-admin/shell`, a key only root can read:

```bash
pc-admin shell slayer                               # admin PowerShell, for repairs
pc-admin run slayer tools/winpc test-agent.ps1      # copy the folder to C:\bandit-ai\agent\run\<stamp>, run, remove
```

`agent\run` is Administrators/SYSTEM only, so nothing unprivileged on the PC can swap the files between
copy and run. Claude's own key is `diag`: its line forces `diag.ps1`, which answers only `andy`, `gpu`,
`processes`, `watch-log`, `agent-log` and `audit-log` (`ssh -i ~/.ssh/pc-diag yassi@<pc> gpu`).

The installer writes `C:\ProgramData\ssh\administrators_authorized_keys` whole from five parameters
(all or none; saved in `agent\keys.json` for reruns): `-TunnelPublicKey` (the lab's tunnel key, bound to
`-LabAddress`, `command="exit"`), `-ShellPublicKey` and `-DiagPublicKey` (bound to `-LaptopAddress`, the
diag line `restrict` with its forced command). Every line carries `from=`. The switch-over:

1. Install with the five key parameters plus `-CoordinatorPublicKey <old laptop key>` (kept bound to the
   laptop for this run only, never saved), from the old key's session.
2. Check `pc-admin shell slayer` (finger) and the diag key.
3. Rerun through `pc-admin run slayer tools/winpc install-agent.ps1`: without the parameter the old key is
   gone. Reruns reuse the saved FQDN, port, watcher account, access map and keys.

`tools/slayer/install.ps1` leaves the keys alone once `agent\keys.json` exists.

Parts 2 and 3 are absent: no approve key, admin API/actions, Windows mutations, update
scans/installations, restart/shutdown or Wake-on-LAN.
