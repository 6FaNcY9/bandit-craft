# Windows PC manager: see and steer the gaming PCs, locally and over Tailscale

Status: design approved in chat on 2026-10-12, revised after the Codex security review the same day
(23 findings; the owner chose a fingerprint per admin action and the coordinator key behind the
fingerprint). Four parts.

## Goal

On any of the owner's devices (laptop, phone, the PC itself) a dashboard per Windows PC that serves
Andy (slayer now, albert later): what Andy is doing, how hot and loud the GPU is, switches for Andy;
and managing Windows itself with full admin rights (services, processes, autostart, updates, restart,
power on), each admin action confirmed with the owner's fingerprint on the laptop.

Done when, on slayer:

- `https://slayerpc.tail7facc9.ts.net:8443` opens the dashboard on the laptop, the phone and slayer
  itself and on no other device; it shows Andy's mode and current request, the GPU share, load,
  temperature and fan, and lists processes, services, autostart entries and pending updates.
- Andy can be paused/resumed and the gaming share and heat profile set from those devices.
- An admin click in the laptop's dashboard waits for a fingerprint prompt on the laptop that names the
  exact action ("stop service Spooler on slayer"); only after the finger does it run, exactly once.
- `pc-admin wake slayer` powers slayer on.
- No other tailnet device, the lab, a program on slayer, or a program on the laptop without the finger
  reaches an admin action; the old coordinator key no longer gives admin without the finger.

## Parts

0. **Lockdown** (before any admin action is enabled): the coordinator key behind the finger, a
   read-only diagnostics key for Claude, the tunnel key already fixed (`command="exit"`, cb1433e).
1. **Monitor and Andy control** (slayer): the agent, the page, read-only Windows views, Andy switches.
2. **Admin with a finger per action** (slayer).
3. **Wake-on-LAN** (slayer, after a tested wake from the exact shutdown state).

Later: albert (own install, its quiet heat profile), admin from the phone (passkeys).

## Part 0: keys

- `tools/winpc/pc-admin.nix` (bandit-craft, imported into the laptop by bandit-nix; implemented
  2026-10-12 with `shell` only, `approve` comes with part 2) makes root-only keys in `/var/lib/pc-admin`
  (as bandit-nix `nixos/lab-apply.nix` does): `shell` (full admin login, for deploys and repairs) and `approve` (one
  forced command, below). `pc-admin` re-runs itself through sudo with a fresh authentication every time
  (`sudo -k` first: no reuse of an earlier sudo timestamp; finger, password as fallback).
- On slayer the `shell` key replaces the coordinator key in `administrators_authorized_keys`
  (`from="100.102.247.30"`), added and tested before the old line is removed. Deploys to slayer then
  run as `pc-admin shell slayer -- <script>` with the owner's finger.
- Claude gets `diag`: a user-level key on the laptop whose slayer line forces
  `C:\bandit-ai\agent\diag.ps1`, which accepts only fixed read-only requests (watcher log tail,
  gpu.json, llama/watcher processes, nvidia-smi readings, test results under a fixed temp folder).
- `administrators_authorized_keys` is shared by all administrator accounts: every line carries
  `from=`, the forced-command lines also `restrict`; the installer pins the Win32-OpenSSH version and
  the tests prove that `diag` and `approve` get no shell, PTY, SFTP or forwarding.

## The agent

`C:\bandit-ai\agent\agent.ps1`, Windows PowerShell 5.1 (built in; nothing to install), started at boot
by a SYSTEM scheduled task that restarts it on exit. Files written by SYSTEM live only in protected
folders: `C:\bandit-ai\agent` (code, `access.json`, `state\`, `audit.log`) and `C:\bandit-ai\control`
(Andy's switches: `pause.flag`, `batch-share.txt`, `gpu-profile.json`; the watcher reads them from
there instead of `runtime`). Both: owner Administrators, write for Administrators and SYSTEM only, the
watcher user may read `control`. `C:\bandit-ai` keeps the installer's ACL (user ReadAndExecute outside
`runtime`); the "Authenticated Users: Modify" grant found on slayer is removed. User-written data
(`runtime`: logs, gpu.json) is read as bounded text, never executed or followed.

**Transport.** HTTPS on `https://slayerpc.tail7facc9.ts.net:8443` with the Tailscale certificate for
that name (`tailscale cert`, renewed by the agent), bound by `HttpListener` to that exact host prefix
(no `+` or `*` wildcard, no URL ACL for other users). Windows Firewall: TCP 8443 inbound only from
`100.64.0.0/10` on the Tailscale interface. The short name and plain HTTP are not served.

**Who is asking.** Per request, before reading the body: the peer is `Request.RemoteEndPoint`; it must
be in `100.64.0.0/10`, and `tailscale whois --json <ip>` (absolute path, 3 s timeout, fail closed on a
non-zero exit, timeout or malformed JSON) must name a node whose `StableID` is in `access.json`, untagged
and not expired. Views may use an answer cached for 60 s; mutations and approvals ask again. Roles:

| Role | Who | May |
| --- | --- | --- |
| `self` | the PC itself | view, Andy switches |
| `operator` | the owner's phone | view, Andy switches |
| `owner` | the laptop `bandit` | view, Andy switches, request admin actions |

The lab is not listed (it keeps reading `/gpu.json` through its tunnel).

**Browser rules.** Mutations are `POST` only, `Content-Type: application/json` only, with `X-Bandit: 1`
and an `Origin` equal to `https://slayerpc.tail7facc9.ts.net:8443` (missing or `null` refused); `Host`
compared as a parsed authority, never as a substring; `OPTIONS` answered 405 without CORS headers.
Bodies: counted bytes, 16 KB at most, also when chunked; 10 s read deadline; one request at a time with
a short accept queue. The page renders every dynamic value with `textContent` (process, service, task
and update names, log lines are untrusted); responses carry
`Content-Security-Policy: default-src 'none'; script-src 'sha256-<page script>'; style-src 'self';
connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
form-action 'none'` and `X-Content-Type-Options: nosniff`.

## The page

| Area | View (all roles) | Actions |
| --- | --- | --- |
| Andy | mode (full/shared/stopped/paused/training) from the watcher log and processes, model, current request from llama-server `/slots` when it runs (prompt size, tokens, tok/s), last watcher log lines; numbers that cannot be known are shown as unknown | `self`/`operator`/`owner`: pause/resume, gaming share, heat profile (files in `control`) |
| GPU | share given, other programs' load, Andy's load, temperature, fan, resting | none |
| Processes | name, PID, start time, CPU, RAM, GPU | admin: end |
| Services | name, display name, state, start type, binary path | admin: start, stop, restart, start type |
| Autostart | the owner's Run keys and Startup folder (by the owner's SID, loaded hive), scheduled tasks by full path | admin: enable/disable |
| Updates | pending updates (ID, revision, title, size, needs reboot), from a scan the owner starts | admin: install selected; restart (forced, labelled so) or cancel this agent's own pending restart |

## Part 2: an admin action, step by step

1. The owner clicks in the laptop's dashboard. The agent re-checks the peer (`owner`), re-inspects the
   target and records a pending action: kind, target identity (service name and binary path with its
   hash and ACL verdict; PID and start time; task full path and action; update ID and revision),
   parameters, a random nonce, 2 min expiry, bound to this agent instance (state cleared at start).
2. `pc-approve` on the laptop (a user service polling the PCs' pending list while the dashboard is
   open, or `pc-admin approve slayer` by hand) shows a polkit/sudo prompt with the action's text;
   the finger runs `pc-admin approve slayer <id> <sha256 of the pending action>` as root, which sends
   exactly that over the `approve` key. On slayer the forced command `approve.ps1` accepts only
   `approve <id> <hash>` (no other text, absolute paths) and hands it to the agent's state.
3. The agent executes only if the pending action still exists, is not expired, its hash matches and
   the target still has the inspected identity (re-checked right before the change); then deletes it.
   Every step goes to `audit.log` (JSON lines, rotated at 5 MB, shown on the page).

Rules for targets:

- Services and scheduled tasks: allowed only when their executable, arguments and working directory
  are not writable by non-administrators (checked right before the action); otherwise refused with the
  reason. Never touched: the agent, Tailscale, sshd and every service they depend on (dependency
  closure), RPC, the event log, the task scheduler, networking (Dhcp, Dnscache, NlaSvc, nsi, the
  network stack), Windows Defender, `lsass`, `csrss`, `wininit`, `services`, `smss`, and any
  `svchost.exe` that hosts one of them; start types of these are fixed too.
- Processes: by PID plus start time, through a process handle; never the protected ones above.
- Updates: install only the approved ID and revision after re-checking applicability, one at a time,
  in a separate SYSTEM worker task (so an agent restart does not kill it) that records per update the
  result, HRESULT and reboot need; never an automatic reboot; updates needing user input are listed,
  not installed.
- Restart/shutdown: `shutdown /r` or `/s` with a delay is forced (it closes programs, unsaved work is
  lost) and the page says so; remote shutdown is enabled only after Wake-on-LAN was tested from that
  shutdown state. Cancel only cancels this agent's own pending shutdown.

## Part 3: Wake-on-LAN

Before enabling: confirm from the lab that slayer's wired MAC is reachable by broadcast on the lab's
LAN interface (the direct Tailscale path to 192.168.0.218 alone does not prove it), enable WoL in the
BIOS and "Wake on Magic Packet" on the wired adapter, disable Fast Startup, and test a wake from a
shutdown. Then `pc-admin wake slayer` runs `ssh bandit-lab pc-wake slayer` as the normal user and
`pc-wake` sends the magic packet for the MAC in `repoConfig` on that interface. Waking needs no
finger.

## Install

`tools/winpc/install-agent.ps1`, run once in an elevated Windows PowerShell (paste-the-file like the
watcher installer, payloads embedded, a test checks parity): the folders and ACLs (ownership and parent
deletion rights set before any executable is written), the firewall rule, the certificate, the SYSTEM
tasks (agent, update worker), `access.json` from parameters, the `approve` and `diag` key lines.
Upgrades refuse while an update installs, replace files atomically and restart the task.

## Tests

- Unit (`tools/winpc/test-agent.ps1`, functions loaded from the AST like `test-watch.ps1`): roles from
  whois answers (unknown, tagged, expired, self, owner; timeout and bad JSON fail closed), peer range,
  host/origin/content-type/method rules, OPTIONS, body limit with chunked input, `textContent`-only
  rendering (no `innerHTML` in `ui.html`), pending action hash, expiry, single use, agent-instance
  binding, target re-identification, the never-touch list including dependencies and shared svchost,
  writable-binary refusal, audit lines.
- On slayer: page and status from the laptop and the phone; from another tailnet device and from a
  program on slayer every mutation gets 403; an approval with a wrong hash, an expired one and a second
  use are refused; stop and start Print Spooler with the finger; `diag` and `approve` keys get no
  shell, PTY, SFTP or forwarding.
- WoL: wake from shutdown, as above.

## Not in this design

Admin from the phone (passkeys), albert, Linux or macOS machines, remote desktop, file transfer,
installing software.
