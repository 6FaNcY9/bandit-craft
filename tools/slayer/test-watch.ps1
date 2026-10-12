$ErrorActionPreference = 'Stop'
$base = 'C:\bandit-ai'
$port = 28083
$session = 1
$pidFile = Join-Path $env:TEMP "bandit-watch-test-$PID.pid"
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'watch.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
foreach ($name in @('Listeners', 'Servers', 'PickMode', 'ServerMode', 'Packets')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Get-NetTCPConnection { param($State, $ErrorAction) $script:sockets }
function Get-CimInstance { param($ClassName, $Filter) $script:processes }
# PowerShell 7 parses JSON dates automatically; emulate Windows PowerShell 5.1.
function ConvertFrom-Json {
    param([Parameter(ValueFromPipeline)]$InputObject)
    process {
        $record = Microsoft.PowerShell.Utility\ConvertFrom-Json $InputObject
        $record.CreationDate = ([datetime]$record.CreationDate).ToString('o')
        $record
    }
}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
$created = [datetime]'2026-10-10T13:00:00'
$script:processes = @(
    [pscustomobject]@{ ProcessId = 10; SessionId = 0; ExecutablePath = "$base\llama\llama-server.exe"; CommandLine = $null; CreationDate = $created },
    [pscustomobject]@{ ProcessId = 11; SessionId = 1; ExecutablePath = "$base\llama\llama-server.exe"; CommandLine = "llama-server.exe --port $port"; CreationDate = $created },
    [pscustomobject]@{ ProcessId = 12; SessionId = 1; ExecutablePath = 'C:\other\llama-server.exe'; CommandLine = "llama-server.exe --port $port"; CreationDate = $created }
)
try {
    $script:sockets = @([pscustomobject]@{ LocalPort = $port; OwningProcess = 10 })
    $listeners = @(Listeners)
    Assert ($listeners.Count -eq 1) 'Hidden command line must not hide a listener'
    Assert ((@(Servers $listeners).ProcessId -join ',') -eq '10,11') 'Stop only identified executable/session or socket owners'
    $script:sockets = @([pscustomobject]@{ LocalPort = $port; OwningProcess = 12 })
    Assert ((@(Servers (Listeners)).ProcessId -join ',') -eq '11') 'Other executable must never be stopped'
    $script:sockets = @()
    Assert (@(Listeners).Count -eq 0) 'Unused port must be empty'
    Assert ((@(Servers @()).ProcessId -join ',') -eq '11') 'Unowned cross-session process must be left alone'
    @{ ProcessId = 10; CreationDate = $created.ToString('o') } | ConvertTo-Json | Set-Content $pidFile
    Assert ((@(Servers @()).ProcessId -join ',') -eq '10,11') 'Recorded child must be recognized before it listens'
    $script:processes[0].CreationDate = $created.AddMinutes(1)
    Assert ((@(Servers @()).ProcessId -join ',') -eq '11') 'Stale record must not authorize a reused PID'
    'PASS: listener detection, session/path ownership, loading child, stale PID'
    foreach ($r in 'fullscreen window', 'game cs2.exe', 'non-llama GPU 99%') {
        Assert ((PickMode $r) -eq 'shared') "Busy reason '$r' must run shared"
    }
    foreach ($r in 'training', 'another console session (or no console)', 'probe failed: x') {
        Assert ($null -eq (PickMode $r)) "Reason '$r' must stop the server"
    }
    $script:freeSince = (Get-Date).AddMinutes(-1)
    # Codex R8-5: also when the shared server died meanwhile, a restart within the 5 minutes stays shared
    Assert ((PickMode $null) -eq 'shared') 'Free < 5 min after a game stays shared'
    $script:freeSince = (Get-Date).AddMinutes(-6)
    Assert ((PickMode $null) -eq 'full') 'Free >= 5 min must return to full'
    Assert ((ServerMode ([pscustomobject]@{ CommandLine = 'llama-server.exe --port 8081 --path C:\bandit-ai\runtime\status-8081 --n-gpu-layers 0 --prio -1' })) -eq 'shared') '--prio -1 is shared'
    Assert ((ServerMode ([pscustomobject]@{ CommandLine = 'llama-server.exe --port 8081 --path C:\bandit-ai\runtime\status-8081 --n-gpu-layers 99' })) -eq 'full') '--n-gpu-layers is full'
    Assert ((ServerMode ([pscustomobject]@{ CommandLine = 'llama-server.exe --port 8081 --n-gpu-layers 99' })) -eq 'old') 'A server without --path (no gpu.json) is restarted'
    Assert ((ServerMode ([pscustomobject]@{ CommandLine = $null })) -eq 'full') 'Unreadable command line counts as full'
    'PASS: mode decision (busy to shared, stop reasons, 5 min hysteresis, command-line mode)'
    $cfg = @{ packetMinutes = 30; quietFan = 45; maxTemp = 80; resumeTemp = 55 }
    $script:packet = $null; $script:resting = $false; $script:quiet = 1.0
    $t0 = [datetime]'2026-10-12T22:00:00'
    Assert ((Packets 0.8 60 30 $t0 $cfg) -eq 0.8) 'Quiet fans: the free share is used'
    Assert ((Packets 0.8 70 60 $t0.AddMinutes(1) $cfg) -lt 0.8) 'Loud fans shrink the share'
    Assert ((Packets 0.8 60 30 $t0.AddMinutes(30) $cfg) -eq 0) 'A packet ends after 30 min'
    Assert ((Packets 0.8 60 20 $t0.AddMinutes(40) $cfg) -eq 0) 'Rest until the GPU is back at resumeTemp'
    Assert ((Packets 0.8 50 20 $t0.AddMinutes(45) $cfg) -gt 0) 'Cool again: a new packet'
    Assert ((Packets 0.8 85 20 $t0.AddMinutes(46) $cfg) -eq 0 -and $script:resting) 'maxTemp ends a packet early'
    Assert ((Packets 0.8 $null 20 $t0.AddMinutes(90) $cfg) -eq 0) 'No temperature sensor, no work'
    'PASS: packets (30 min, quiet fans, rest until cool, maxTemp, no sensor)'
} finally {
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}
