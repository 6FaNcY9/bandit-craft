param(
    [switch]$Once,
    [Nullable[int]]$GpuPercent = $null,
    [int]$TestPort = 0
)
$ErrorActionPreference = 'Stop'
$base = 'C:\bandit-ai'
$runtime = "$base\runtime"
if (-not (Test-Path $runtime)) { $null = New-Item -ItemType Directory $runtime }
$model = "$base\models\andy.gguf"
$modelSha256 = '3cfccaa17be8d2ded998fab8bd4b7032f91f2a916ac2aa03a412908342228eb1'
$script:modelFailureLogged = $false
# Since when the PC is free; a watcher that starts on a free PC may use the GPU at once.
$script:freeSince = (Get-Date).AddMinutes(-5)
$port = 8081
$layers = 99
# A CPU-only second server lets checks leave the replay's GPU server alone.
if ($TestPort) {
    if ($TestPort -le 1024 -or $TestPort -gt 65535 -or $TestPort -eq 8081) { throw 'Invalid test port' }
    $port = $TestPort
    $layers = 0
}
$mutex = New-Object Threading.Mutex($false, "Local\bandit-ai-watch-$port")
if (-not $mutex.WaitOne(0)) { exit }
# Busy probe shared with train\run-guarded.ps1 (C:\bandit-ai\busy.ps1).
. "$base\busy.ps1"
function Write-Log($message) {
    $log = "$runtime\watch.log"
    if ((Test-Path $log) -and (Get-Item $log).Length -ge 5MB) { Move-Item $log "$log.1" -Force }
    Add-Content $log "$(Get-Date -Format o) port=$port $message"
}
$pidFile = "$runtime\watch-$port.pid"
# What this PC gives the lab's batch work (replay, judge) is published every cycle as gpu.json in this
# folder, which llama-server serves (--path) through the tunnel; the lab paces itself by its share.
$status = "$runtime\status-$port"
if (-not (Test-Path $status)) { $null = New-Item -ItemType Directory $status }
# While someone uses the PC (input in the last 5 min) batch work gets at most this many percent of the GPU,
# so a game keeps its frames even when it needs little GPU (owner 2026-10-12). The dashboard sets it.
$shareFile = "$runtime\batch-share.txt"
# Heat profile (owner 2026-10-12). Default (slayer): batch work may run on and on with the fans as loud as
# they need; only at maxTemp 90 C it rests until resumeTemp 80 C. runtime\gpu-profile.json overrides it per
# PC; albert, where people watch films next to it, gets short packets with quiet fans:
# {"packetMinutes": 15, "quietFan": 30, "maxTemp": 75, "resumeTemp": 50}. packetMinutes 0 = no limit; while
# the fans are above quietFan % the share shrinks, so the GPU runs warmer but quiet. With a profile file a
# missing temperature reading means no work; without one the default guard is skipped.
$profileFile = "$runtime\gpu-profile.json"
$script:packet = $null; $script:resting = $false; $script:quiet = 1.0
$session = (Get-Process -Id $PID).SessionId
function Listeners {
    # Enumerate first: querying an unused LocalPort reports an error, not an empty list.
    @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $port })
}
function Servers($listeners) {
    $record = $null
    if (Test-Path $pidFile) { $record = Get-Content $pidFile -Raw | ConvertFrom-Json }
    @(Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object {
        $_.ExecutablePath -eq "$base\llama\llama-server.exe" -and
        ((($_.SessionId -eq $session) -and $_.CommandLine -match "--port\s+$port(?:\s|$)") -or
         ($listeners.OwningProcess -contains $_.ProcessId) -or
         ($record -and $_.ProcessId -eq $record.ProcessId -and
          $_.CreationDate.ToString('o') -eq $record.CreationDate))
    })
}
# Games leave the GPU to the game: 'shared' runs Andy on the CPU at low priority, 'full' is the normal
# all-layers server. $null stops the server (training, another console session, probe failures). Back
# to full only after 5 min of a free PC, so alt-tabbing does not restart the server; that holds for a
# server started anew in those minutes too (Codex R8-5: a shared server that died went straight to full).
function PickMode($reason) {
    if ($reason -and $reason -notmatch '^(fullscreen window|game |non-llama GPU)') { return $null }
    if (-not $reason -and $script:freeSince -and ((Get-Date) - $script:freeSince).TotalMinutes -lt 5) { return 'shared' }
    if ($reason) { return 'shared' }
    return 'full'
}
# A server without --path (started by an older watcher) is restarted once so it serves gpu.json.
function ServerMode($server) {
    if ($server.CommandLine -and $server.CommandLine -notmatch '--path\s') { 'old' }
    elseif ($server.CommandLine -match '--prio\s+-1(?:\s|$)') { 'shared' }
    else { 'full' }
}
function BatchCap {
    $text = Get-Content $shareFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ("$text".Trim() -match '^\d{1,3}$' -and [int]$text -le 100) { return [int]$text }
    return 50
}
function HeatProfile {
    $cfg = @{ packetMinutes = 0; quietFan = 100; maxTemp = 90; resumeTemp = 80; strict = $false }
    if (Test-Path $profileFile) {
        $c = Get-Content $profileFile -Raw | ConvertFrom-Json
        foreach ($k in 'packetMinutes', 'quietFan', 'maxTemp', 'resumeTemp') { if ($c.$k -is [ValueType]) { $cfg[$k] = [double]$c.$k } }
        $cfg.strict = $true
    }
    return $cfg
}
function GpuSensors {
    $t, $f = "$(& nvidia-smi --query-gpu=temperature.gpu,fan.speed --format=csv,noheader,nounits 2>$null | Select-Object -First 1)" -split '\s*,\s*'
    @{ Temp = $(if ($t -match '^\d+$') { [int]$t }); Fan = $(if ($f -match '^\d+$') { [int]$f }) }
}
# The heat rule on one reading; without a temperature: nothing under a profile file, unchanged otherwise.
function Packets([double]$share, $temp, $fan, [datetime]$now, $cfg) {
    if ($null -eq $temp) { if ($cfg.strict) { return 0 } else { return $share } }
    if ($script:resting) {
        if ($temp -gt $cfg.resumeTemp) { return 0 }
        $script:resting = $false; $script:packet = $null
    }
    if (-not $script:packet) { $script:packet = $now }
    if (($cfg.packetMinutes -gt 0 -and ($now - $script:packet).TotalMinutes -ge $cfg.packetMinutes) -or $temp -ge $cfg.maxTemp) { $script:resting = $true; return 0 }
    if ($null -ne $fan -and $fan -gt $cfg.quietFan) { $script:quiet = [Math]::Max(0.1, $script:quiet * 0.7) }
    elseif ($null -eq $fan -or $fan -lt $cfg.quietFan - 10) { $script:quiet = [Math]::Min(1.0, $script:quiet * 1.1) }
    return $share * $script:quiet
}
# share (0..1): the GPU the PC's own programs leave free, capped by BatchCap while someone uses the PC
# and by the heat profile.
function Publish {
    try {
        $others = if ($null -ne $GpuPercent) { $GpuPercent } else { GpuUse @(LlamaPids) }
        $idle = if ($TestPort) { 0 } else { [BanditWindow]::IdleSeconds() }
        $share = [Math]::Max(0, 100 - $others) / 100
        if ($idle -lt 300) { $share = [Math]::Min($share, (BatchCap) / 100) }
        $info = @{ others = $others; idle = $idle }
        $sensors = if ($TestPort) { @{ Temp = $null; Fan = $null } } else { GpuSensors }
        $share = Packets $share $sensors.Temp $sensors.Fan (Get-Date) (HeatProfile)
        $info += @{ temp = $sensors.Temp; fan = $sensors.Fan; resting = $script:resting }
        $info += @{ share = [Math]::Round($share, 3); at = (Get-Date).ToUniversalTime().ToString('o') }
        $info | ConvertTo-Json -Compress | Set-Content "$status\gpu.json.tmp" -Encoding ascii
        Move-Item "$status\gpu.json.tmp" "$status\gpu.json" -Force
    } catch { } # the old file goes stale (90 s) and the lab waits; a missing one would read as "no status, free"
}
# train\run-guarded.ps1 holds C:\bandit-ai\training.lock while it trains: the GPU is its, so the
# server is stopped and not started. A lock older than 24 h is a crash leftover and ignored.
function Training {
    $lock = Get-Item "$base\training.lock" -ErrorAction SilentlyContinue
    if ($lock -and ((Get-Date) - $lock.LastWriteTime).TotalHours -lt 24) { return 'training' }
    return $null
}
$script:modelChecks = @{}
function ModelVerified([string]$path = $model, [string]$sha256 = $modelSha256) {
    $item = Get-Item $path -ErrorAction SilentlyContinue
    if (-not $item -or $item.PSIsContainer) { return $false }
    $stamp = "$($item.Length):$($item.LastWriteTimeUtc.Ticks)"
    $check = $script:modelChecks[$path]
    if ($check -and $check.Stamp -eq $stamp) { return $check.Verified }
    $verified = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $sha256.ToLowerInvariant()
    $script:modelChecks[$path] = @{ Stamp = $stamp; Verified = $verified }
    return $verified
}
# Optional candidate model (C:\bandit-ai\candidate.json {file, sha256, alias}): served instead of
# andy.gguf only while its file in models\ exists and matches the hash. Delete the json to go back.
function Serving {
    try {
        if (Test-Path "$base\candidate.json") {
            $c = Get-Content "$base\candidate.json" -Raw | ConvertFrom-Json
            if ($c.file -match '^[A-Za-z0-9_.-]+\.gguf$' -and $c.sha256 -match '^[0-9a-fA-F]{64}$' -and $c.alias -match '^[A-Za-z0-9_.-]+$' -and (ModelVerified "$base\models\$($c.file)" $c.sha256)) {
                return @{ Path = "$base\models\$($c.file)"; Alias = $c.alias }
            }
        }
    } catch { }
    if (ModelVerified) { return @{ Path = $model; Alias = 'andy-4.2-baseline' } }
    return $null
}

try {
    do {
        $cycle = [Diagnostics.Stopwatch]::StartNew()
        try {
            $reason = Training
            if (-not $reason) { $reason = Busy }
        } catch { $reason = "probe failed: $($_.Exception.Message)" }
        if ($reason) { $script:freeSince = $null } elseif (-not $script:freeSince) { $script:freeSince = Get-Date }
        Publish
        try {
            $listeners = @(Listeners)
            $servers = @(Servers $listeners)
            $mode = PickMode $reason
            if (-not $mode) {
                foreach ($server in $servers) {
                    Stop-Process -Id $server.ProcessId -ErrorAction Stop
                    Write-Log "stopped PID $($server.ProcessId): $reason"
                }
                foreach ($listener in $listeners) {
                    if ($servers.ProcessId -notcontains $listener.OwningProcess) {
                        Write-Log "left listener PID $($listener.OwningProcess): not ours to stop ($reason)"
                    }
                }
            } elseif ($servers | Where-Object { (ServerMode $_) -ne $mode }) {
                foreach ($server in $servers) {
                    Stop-Process -Id $server.ProcessId -ErrorAction Stop
                    Write-Log "switching to ${mode}: $(if ($reason) { $reason } else { 'PC free for 5 min' })"
                }
            } elseif (-not $listeners.Count -and -not $servers.Count -and ($serving = Serving)) {
                # Verification can take seconds; a game may have started during hashing.
                if (Training) { throw 'Training started during model verification; launch deferred' }
                if ($mode -eq 'full' -and ($again = Busy)) {
                    $mode = PickMode $again
                    if (-not $mode) { throw "$again during model verification; launch deferred" }
                }
                $gpu = "--n-gpu-layers $layers"
                # Shared: CPU only (no layers, no op offload), 4 of 8 cores, low priority. --fit sized the offload
                # once at the start and still left the game 99 MiB and the GPU at 100 % (2026-10-12).
                if ($mode -eq 'shared') { $gpu = '--n-gpu-layers 0 --no-op-offload --threads 4 --prio -1' }
                $env:LLAMA_ARG_CHAT_TEMPLATE_KWARGS = '{"enable_thinking":false}'
                $arguments = "--model $($serving.Path) --alias $($serving.Alias) --host 127.0.0.1 --port $port --path $status --jinja --ctx-size 8192 --parallel 1 $gpu --temp 0.6 --top-k 20 --top-p 0.95 --min-p 0 --repeat-penalty 1.0"
                $server = Start-Process "$base\llama\llama-server.exe" -ArgumentList $arguments -WorkingDirectory "$base\llama" -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime\watch-$port.out.log" -RedirectStandardError "$runtime\watch-$port.err.log"
                # Creation time prevents a stale PID file from authorizing a reused PID.
                $started = Get-CimInstance Win32_Process -Filter "ProcessId=$($server.Id)"
                @{ ProcessId = $server.Id; CreationDate = $started.CreationDate.ToString('o') } | ConvertTo-Json | Set-Content $pidFile
                Write-Log "started PID $($server.Id) ($mode)"
            } elseif (-not $listeners.Count -and -not $servers.Count) {
                if (-not $script:modelFailureLogged) { Write-Log "model missing or checksum mismatch; inference disabled"; $script:modelFailureLogged = $true }
            }
        } catch { Write-Log "error: $($_.Exception.Message)" }
        if (-not $Once) { Start-Sleep -Milliseconds ([Math]::Max(0, 15000 - [int]$cycle.ElapsedMilliseconds)) }
    } while (-not $Once)
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
