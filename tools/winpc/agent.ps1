$ErrorActionPreference = 'Stop'

function Assert-NoReparse([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse point refused' }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
function Read-BoundedText([string]$Path, [int]$Limit = 65536, [switch]$Tail) {
    Assert-NoReparse $Path
    if (-not ('BanditSafeFile' -as [type])) {
        Add-Type @'
using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public sealed class BanditSafeFile : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct FileInfo {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
    readonly List<SafeFileHandle> parents = new List<SafeFileHandle>();
    public FileStream Stream;
    static SafeFileHandle Open(string path, bool directory) {
        // OPEN_REPARSE_POINT checks the object itself; no DELETE sharing pins its path.
        var h = CreateFile(path, directory ? 0u : 0x80000000u, 3, IntPtr.Zero, 3,
            0x00200000u | (directory ? 0x02000000u : 0u), IntPtr.Zero);
        if (h.IsInvalid) { h.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        FileInfo info;
        if (!GetFileInformationByHandle(h, out info)) { h.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        if ((info.Attributes & 0x400) != 0 || (directory && (info.Attributes & 0x10) == 0)) {
            h.Dispose(); throw new IOException("Reparse point or non-directory refused");
        }
        return h;
    }
    public static BanditSafeFile Read(string path) {
        var file = new BanditSafeFile();
        try {
            path = Path.GetFullPath(path);
            var dirs = new Stack<string>();
            string parent = Path.GetDirectoryName(path);
            while (!String.IsNullOrEmpty(parent)) { dirs.Push(parent); parent = Path.GetDirectoryName(parent); }
            // Hold every ancestor before opening the next, closing the check/open junction race.
            while (dirs.Count != 0) file.parents.Add(Open(dirs.Pop(), true));
            var handle = Open(path, false);
            try { file.Stream = new FileStream(handle, FileAccess.Read); }
            catch { handle.Dispose(); throw; }
            return file;
        } catch { file.Dispose(); throw; }
    }
    public void Dispose() {
        if (Stream != null) Stream.Dispose();
        foreach (var h in parents) h.Dispose();
        parents.Clear();
    }
}
'@
    }
    $safe = [BanditSafeFile]::Read($Path)
    $f = $safe.Stream
    try {
        if (-not $Tail -and $f.Length -gt $Limit) { throw 'File too large' }
        $offset = [Math]::Max(0, $f.Length - $Limit)
        if ($Tail) { $null = $f.Seek($offset, 'Begin') }
        $bytes = New-Object byte[] ([int][Math]::Min($Limit, $f.Length))
        $count = 0
        while ($count -lt $bytes.Length) {
            $n = $f.Read($bytes, $count, $bytes.Length - $count)
            if (-not $n) { break }
            $count += $n
        }
        $text = [Text.Encoding]::UTF8.GetString($bytes, 0, $count)
        if ($Tail -and $offset -gt 0) {
            $newline = $text.IndexOf("`n")
            if ($newline -lt 0) { return '' }
            $text = $text.Substring($newline + 1)
        }
        return $text
    } finally { $safe.Dispose() }
}
function Invoke-Program([string]$Exe, [string]$Arguments, [int]$TimeoutMs = 3000) {
    if (-not [IO.Path]::IsPathRooted($Exe)) { throw 'Executable must be absolute' }
    $p = New-Object Diagnostics.Process
    $p.StartInfo = New-Object Diagnostics.ProcessStartInfo
    $p.StartInfo.FileName = $Exe
    $p.StartInfo.Arguments = $Arguments
    $p.StartInfo.UseShellExecute = $false
    $p.StartInfo.CreateNoWindow = $true
    $p.StartInfo.RedirectStandardOutput = $true
    $p.StartInfo.RedirectStandardError = $true
    $started = $false
    try {
        if (-not $p.Start()) { throw 'Process failed to start' }
        $started = $true
        $stdout = $p.StandardOutput.ReadToEndAsync()
        $stderr = $p.StandardError.ReadToEndAsync()
        if (-not $p.WaitForExit($TimeoutMs)) { throw 'Process timeout' }
        if ($p.ExitCode -ne 0) { throw "Process exit $($p.ExitCode)" }
        if (-not $stdout.Wait(500) -or -not $stderr.Wait(500)) { throw 'Output timeout' }
        if ($stdout.Result.Length -gt 4MB) { throw 'Output too large' }
        return $stdout.Result
    } finally {
        if ($started -and -not $p.HasExited) { $p.Kill() }
        $p.Dispose()
    }
}
function Test-TailnetPeer([string]$Ip) {
    $address = $null
    if (-not [Net.IPAddress]::TryParse($Ip, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $b = $address.GetAddressBytes()
    return $b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127
}
function Get-WhoisIdentity([string]$Json, $Access) {
    $answer = $Json | ConvertFrom-Json
    $node = $answer.Node
    if (-not $node -or $node.StableID -isnot [string] -or -not $node.StableID) { throw 'Invalid whois node' }
    $script:peerIdentity = @{ StableID = $node.StableID; role = $Access[$node.StableID] }
    if (@($node.Tags).Count -gt 0 -and $null -ne $node.Tags) { throw 'Tagged node refused' }
    if ($null -ne $node.Expired -and $node.Expired -isnot [bool]) { throw 'Invalid expiry flag' }
    if ($node.Expired -eq $true) { throw 'Expired node refused' }
    if ($node.KeyExpiry) {
        $expiry = [datetimeoffset]::Parse($node.KeyExpiry, [Globalization.CultureInfo]::InvariantCulture)
        if ($expiry.Year -ne 1 -and $expiry -le [datetimeoffset]::UtcNow) { throw 'Expired key refused' }
    }
    $role = $Access[$node.StableID]
    if ($role -cnotin @('self', 'operator', 'owner')) { throw 'Unknown node or role' }
    return @{ StableID = $node.StableID; role = $role }
}
function Get-PeerIdentity([string]$Ip, [string]$Method) {
    if (-not (Test-TailnetPeer $Ip)) { throw 'Non-tailnet peer' }
    $cached = $script:whoisCache[$Ip]
    if ($Method -ceq 'GET' -and $cached -and $cached.until -gt [datetime]::UtcNow) { return Get-WhoisIdentity $cached.json $script:access }
    $json = Invoke-Program $script:config.tailscale "whois --json $Ip" 3000
    $identity = Get-WhoisIdentity $json $script:access
    if ($Method -ceq 'GET') { $script:whoisCache[$Ip] = @{ until = [datetime]::UtcNow.AddSeconds(60); json = $json } }
    return $identity
}
function Test-Authority([string]$Authority, [string]$Fqdn, [int]$Port) {
    # Parse the authority, but reject URI normalization of paths, credentials and whitespace.
    if ($Authority -notmatch '^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$') { return $false }
    $uri = $null
    if (-not [uri]::TryCreate("https://$Authority/", [UriKind]::Absolute, [ref]$uri)) { return $false }
    if ($uri.DnsSafeHost -ine $Fqdn -or $uri.Port -ne $Port) { return $false }
    if ($Port -ne 443 -and $Authority -notmatch ':') { return $false }
    return $true
}
function Assert-PostRules($Request, [string]$Origin) {
    if ($Request.HttpMethod -cne 'POST') { throw 'POST required' }
    if ($Request.ContentType -cne 'application/json') { throw 'application/json required' }
    if ($Request.Headers['X-Bandit'] -cne '1') { throw 'X-Bandit required' }
    if ($Request.Headers['Origin'] -cne $Origin) { throw 'Origin refused' }
    if ($Request.ContentLength64 -gt 16384) { throw 'Body too large' }
}
function Read-RequestBody($Request, [int]$DeadlineMs = 10000) {
    if ($Request.ContentLength64 -gt 16384) { throw 'Body too large' }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $output = New-Object IO.MemoryStream
    $buffer = New-Object byte[] 4096
    try {
        while ($true) {
            $remaining = $DeadlineMs - [int]$clock.ElapsedMilliseconds
            if ($remaining -le 0) { throw 'Body read timeout' }
            $read = $Request.InputStream.BeginRead($buffer, 0, $buffer.Length, $null, $null)
            try {
                if (-not $read.AsyncWaitHandle.WaitOne($remaining)) { $Request.InputStream.Close(); throw 'Body read timeout' }
                $n = $Request.InputStream.EndRead($read)
            } finally { if ($read.IsCompleted) { $read.AsyncWaitHandle.Close() } }
            if (-not $n) { break }
            if ($output.Length + $n -gt 16384) { throw 'Body too large' }
            $output.Write($buffer, 0, $n)
        }
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        return $utf8.GetString($output.ToArray())
    } finally { $output.Dispose() }
}
function Test-Number($Value, [double]$Min, [double]$Max, [switch]$Integer) {
    if ($Value -isnot [byte] -and $Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) { return $false }
    $n = [double]$Value
    return -not [double]::IsNaN($n) -and -not [double]::IsInfinity($n) -and $n -ge $Min -and $n -le $Max -and (-not $Integer -or $n -eq [Math]::Truncate($n))
}
function Get-AndyAction($Body, [string]$Role) {
    if ($Role -cnotin @('self', 'operator', 'owner')) { throw 'Role refused' }
    if ($Body -isnot [pscustomobject]) { throw 'Object required' }
    $keys = @($Body.PSObject.Properties.Name)
    if ($keys.Count -ne 1) { throw 'One action required' }
    switch -CaseSensitive ($keys[0]) {
        'pause' {
            if ($Body.pause -isnot [bool]) { throw 'Boolean pause required' }
            return @{ action = 'pause'; target = 'pause.flag'; delete = -not $Body.pause; text = '' }
        }
        'share' {
            if (-not (Test-Number $Body.share 0 100 -Integer)) { throw 'Integer share 0..100 required' }
            return @{ action = 'share'; target = 'batch-share.txt'; delete = $false; text = ([int]$Body.share).ToString([Globalization.CultureInfo]::InvariantCulture) }
        }
        'profile' {
            if ($null -eq $Body.profile) { return @{ action = 'profile'; target = 'gpu-profile.json'; delete = $true; text = '' } }
            $p = $Body.profile
            if ($p -isnot [pscustomobject] -or @($p.PSObject.Properties).Count -ne 4) { throw 'Four profile fields required' }
            if (-not (Test-Number $p.packetMinutes 0 1440) -or -not (Test-Number $p.quietFan 0 100) -or -not (Test-Number $p.maxTemp 1 100) -or -not (Test-Number $p.resumeTemp 0 100) -or $p.resumeTemp -ge $p.maxTemp) { throw 'Invalid heat profile' }
            return @{ action = 'profile'; target = 'gpu-profile.json'; delete = $false; text = ($p | ConvertTo-Json -Compress) }
        }
        default { throw 'Unknown Andy action' }
    }
}
function Write-Control($Action, [string]$Control = 'C:\bandit-ai\control') {
    if ($Action.target -cnotin @('pause.flag', 'batch-share.txt', 'gpu-profile.json')) { throw 'Unknown control target' }
    $target = Join-Path $Control $Action.target
    Assert-NoReparse $Control
    Assert-NoReparse $target
    if (-not (Test-Path -LiteralPath $Control -PathType Container)) { throw 'Control folder missing' }
    if ($Action.delete) { if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }; return }
    $temp = Join-Path $Control ([guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $f = [IO.File]::Open($temp, 'CreateNew', 'Write', 'None')
        try { $bytes = [Text.Encoding]::UTF8.GetBytes($Action.text); $f.Write($bytes, 0, $bytes.Length) } finally { $f.Dispose() }
        Assert-NoReparse $target
        # [NullString]: PowerShell would pass $null as "", which Replace refuses as a path.
        if (Test-Path -LiteralPath $target) { [IO.File]::Replace($temp, $target, [NullString]::Value) }
        else { Move-Item -LiteralPath $temp -Destination $target -Force }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
}
function Write-RotatedLine([string]$Path, [string]$Line) {
    Assert-NoReparse $Path
    Assert-NoReparse "$Path.1"
    if ((Test-Path -LiteralPath $Path) -and (Get-Item -LiteralPath $Path).Length -ge 5MB) { Move-Item -LiteralPath $Path -Destination "$Path.1" -Force }
    [IO.File]::AppendAllText($Path, $Line + "`r`n", (New-Object Text.UTF8Encoding($false)))
}
function Write-Audit([string]$Peer, $Identity, [string]$Action, [string]$Result, [string]$Path = 'C:\bandit-ai\agent\audit.log') {
    $line = [ordered]@{ time = [datetime]::UtcNow.ToString('o'); peer = $Peer; StableID = $Identity.StableID; role = $Identity.role; action = $Action; result = $Result } | ConvertTo-Json -Compress
    Write-RotatedLine $Path $line
}
function Assert-AuditWritable {
    Assert-NoReparse 'C:\bandit-ai\agent\audit.log'
    Assert-NoReparse 'C:\bandit-ai\agent\audit.log.1'
    $audit = [IO.File]::Open('C:\bandit-ai\agent\audit.log', 'OpenOrCreate', 'Write', 'Read')
    $audit.Dispose()
}
function Get-AndyStatus {
    $servers = @(Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" -OperationTimeoutSec 2 | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('C:\bandit-ai\llama\', [StringComparison]::OrdinalIgnoreCase) })
    $mode = 'stopped'
    if ($servers.Count) { $mode = 'full'; if ($servers.CommandLine -match '--prio\s+-1(?:\s|$)') { $mode = 'shared' } }
    Assert-NoReparse 'C:\bandit-ai\control\pause.flag'
    Assert-NoReparse 'C:\bandit-ai\training.lock'
    $paused = Test-Path -LiteralPath 'C:\bandit-ai\control\pause.flag'
    $lock = Get-Item -LiteralPath 'C:\bandit-ai\training.lock' -ErrorAction SilentlyContinue
    $training = $null -ne $lock -and ([datetime]::Now - $lock.LastWriteTime).TotalHours -lt 24
    if ($paused) { $mode = 'paused' }
    if ($training) { $mode = 'training' }
    $logs = try { @((Read-BoundedText 'C:\bandit-ai\runtime\watch.log' -Tail) -split '\r?\n' | Where-Object { $_ } | Select-Object -Last 20) } catch { @{ error = $_.Exception.Message } }
    # ForEach-Object unwraps the array IRM emits as one object, which PS 5.1 would write as {"value":[...]};
    # the comma keeps a single slot an array through the try.
    $slots = try { , @(Invoke-RestMethod -Uri 'http://127.0.0.1:8081/slots' -TimeoutSec 2 -MaximumRedirection 0 -UseBasicParsing | ForEach-Object { $_ }) } catch { @{ error = $_.Exception.Message } }
    @{ mode = $mode; paused = $paused; training = $training; logs = $logs; slots = $slots; model = @($servers | ForEach-Object { if ($_.CommandLine -match '--alias\s+(\S+)') { $Matches[1] } }) }
}
function Get-GpuStatus {
    $published = try { Read-BoundedText 'C:\bandit-ai\runtime\status-8081\gpu.json' | ConvertFrom-Json } catch { @{ error = $_.Exception.Message } }
    $sensors = try {
        $exe = "$env:WINDIR\System32\nvidia-smi.exe"
        if (-not (Test-Path -LiteralPath $exe)) { $exe = 'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe' }
        $csv = Invoke-Program $exe '--query-gpu=temperature.gpu,fan.speed,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits' 3000
        @($csv.Trim() -split '\r?\n' | ForEach-Object {
            $v = $_ -split '\s*,\s*'
            @{ temperature = $v[0]; fan = $v[1]; utilization = $v[2]; memoryUsedMB = $v[3]; memoryTotalMB = $v[4] }
        })
    } catch { @{ error = $_.Exception.Message } }
    @{ published = $published; sensors = $sensors; andyLoad = $null }
}
function Get-ProcessStatus {
    @(Get-Process | Sort-Object CPU -Descending | Select-Object -First 40 | ForEach-Object {
        $start = try { $_.StartTime.ToUniversalTime().ToString('o') } catch { $null }
        @{ name = $_.ProcessName; id = $_.Id; startTime = $start; cpuSeconds = $_.CPU; workingSetMB = [Math]::Round($_.WorkingSet64 / 1MB, 1); gpu = $null }
    })
}
function Get-ServiceStatus {
    @(Get-CimInstance Win32_Service -OperationTimeoutSec 3 | ForEach-Object { @{ name = $_.Name; displayName = $_.DisplayName; status = $_.State; startType = $_.StartMode; pathName = $_.PathName } })
}
function Get-AutostartStatus {
    $rows = @()
    # Win32_ComputerSystem.UserName is the console user, never SYSTEM's HKCU.
    $user = (Get-CimInstance Win32_ComputerSystem -OperationTimeoutSec 2).UserName
    $sid = $null; $profile = $null
    if ($user) {
        $sid = ([Security.Principal.NTAccount]$user).Translate([Security.Principal.SecurityIdentifier]).Value
        $profile = (Get-CimInstance Win32_UserProfile -OperationTimeoutSec 2 | Where-Object SID -eq $sid).LocalPath
    }
    $keys = @('Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Run', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', 'Registry::HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\RunOnce')
    if ($sid -and (Test-Path "Registry::HKEY_USERS\$sid")) {
        $keys += "Registry::HKEY_USERS\$sid\Software\Microsoft\Windows\CurrentVersion\Run", "Registry::HKEY_USERS\$sid\Software\Microsoft\Windows\CurrentVersion\RunOnce"
    } else { $rows += @{ kind = 'user'; name = $user; error = 'Console owner hive not loaded' } }
    foreach ($key in $keys) {
        if (Test-Path -LiteralPath $key) {
            $registry = Get-Item -LiteralPath $key
            foreach ($name in $registry.GetValueNames()) { $rows += @{ kind = 'registry'; name = $name; path = $key; command = $registry.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); enabled = $null } }
        }
    }
    $folders = @('C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup')
    if ($profile) { $folders += "$profile\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup" }
    foreach ($folder in $folders) {
        Assert-NoReparse $folder
        if (Test-Path -LiteralPath $folder) { foreach ($item in Get-ChildItem -LiteralPath $folder -Force) { $rows += @{ kind = 'startup'; name = $item.Name; path = $item.FullName; enabled = $null } } }
    }
    foreach ($task in Get-ScheduledTask) {
        if (@($task.Triggers | Where-Object { $_.CimClass.CimClassName -in @('MSFT_TaskBootTrigger', 'MSFT_TaskLogonTrigger') }).Count) {
            $rows += @{ kind = 'task'; name = $task.TaskName; path = $task.TaskPath + $task.TaskName; command = @($task.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join '; '; enabled = $task.Settings.Enabled }
        }
    }
    return $rows
}
function Get-UpdateStatus {
    $path = 'C:\bandit-ai\agent\state\updates.json'
    if (-not (Test-Path -LiteralPath $path)) { return @{ error = 'no scan yet' } }
    Read-BoundedText $path 1MB | ConvertFrom-Json
}
function Get-Status {
    # Each part is a PowerShell process (about 0.3-0.6 s CPU on slayer): only Andy and the GPU are
    # refreshed with the page's 3 s poll; slow-changing parts are kept longer, failures are retried.
    $ttl = @{ andy = 3; gpu = 3; processes = 10; services = 60; autostart = 60; updates = 60 }
    $result = [ordered]@{}
    foreach ($part in 'Andy', 'Gpu', 'Process', 'Service', 'Autostart', 'Update') {
        $key = @{ Andy = 'andy'; Gpu = 'gpu'; Process = 'processes'; Service = 'services'; Autostart = 'autostart'; Update = 'updates' }[$part]
        $cached = $script:statusCache[$key]
        if ($cached -and $cached.until -gt [datetime]::UtcNow) { $result[$key] = $cached.value; continue }
        try {
            # A separate, killable PS5.1 process bounds even a stalled CIM/provider call.
            $functions = $script:probeFunctions[$part]
            $expression = "Get-${part}Status"
            if ($part -in @('Process', 'Service', 'Autostart')) { $expression = "@(Get-${part}Status)" }
            $code = "$functions`n`$ErrorActionPreference = 'Stop'; try { ConvertTo-Json -InputObject ($expression) -Depth 12 -Compress } catch { @{error = `$_.Exception.Message} | ConvertTo-Json -Compress }"
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
            $value = Invoke-Program "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" "-NoProfile -NonInteractive -EncodedCommand $encoded" 6500
            $parsed = $value | ConvertFrom-Json
            # ConvertFrom-Json hands a JSON array over as one wrapped object, which PS 5.1 writes back as
            # {"value":[...]}: rebuild it as a plain array (kept an array with one row).
            if ($parsed -is [array]) { $parsed = @($parsed | ForEach-Object { $_ }) }
            $result[$key] = $parsed
            $seconds = $ttl[$key]
        } catch { $result[$key] = @{ error = $_.Exception.Message }; $seconds = 3 }
        $script:statusCache[$key] = @{ value = $result[$key]; until = [datetime]::UtcNow.AddSeconds($seconds) }
    }
    return $result
}
function Send-Response($Response, [int]$Code, $Value, [switch]$Html) {
    $Response.StatusCode = $Code
    $Response.Headers['Content-Security-Policy'] = $script:csp
    $Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Response.Headers['X-Frame-Options'] = 'DENY'
    $Response.Headers['Cache-Control'] = 'no-store'
    $Response.ContentType = 'application/json; charset=utf-8'
    $text = $Value | ConvertTo-Json -Depth 16 -Compress
    if ($Html) { $Response.ContentType = 'text/html; charset=utf-8'; $text = $Value }
    $bytes = [Text.Encoding]::UTF8.GetBytes($text)
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}
function Invoke-AgentRequest($Context) {
    $request = $Context.Request
    $identity = $null; $peer = ''; $action = $request.RawUrl; $result = 'refused'; $code = 403
    $script:peerIdentity = $null
    $value = $null; $html = $false
    try {
        $peer = $request.RemoteEndPoint.Address.ToString()
        $identity = Get-PeerIdentity $peer $request.HttpMethod
        if (-not (Test-Authority $request.Headers['Host'] $script:config.fqdn $script:config.port)) { throw 'Host refused' }
        $path = $request.Url.AbsolutePath
        if ($request.HttpMethod -ceq 'OPTIONS') { $code = 405; $value = @{ error = 'Method refused' } }
        elseif ($request.HttpMethod -ceq 'POST') {
            Assert-PostRules $request $script:origin
            if ($path -cne '/api/andy') { $code = 404; throw 'Route not found' }
            $body = (Read-RequestBody $request) | ConvertFrom-Json
            $change = Get-AndyAction $body $identity.role
            $action = $change.action
            # Check audit writability before mutating; record the outcome before responding.
            Assert-AuditWritable
            Write-Control $change
            $script:statusCache.Remove('andy')
            $result = 'allowed'; $code = 200
            $value = @{ ok = $true }
        } elseif ($request.HttpMethod -ceq 'GET' -and $path -ceq '/') {
            $code = 200; $value = $script:page; $html = $true
        } elseif ($request.HttpMethod -ceq 'GET' -and $path -ceq '/api/status') {
            $code = 200; $value = Get-Status
        } else { $code = 404; $value = @{ error = 'Route not found' } }
    } catch {
        if (-not $identity) { $identity = $script:peerIdentity }
        $result = 'refused: ' + $_.Exception.Message
        try { Write-RotatedLine 'C:\bandit-ai\agent\agent.log' ([datetime]::UtcNow.ToString('o') + ' ' + $result) } catch { }
        $value = @{ error = $result }
    } finally {
        if ($request.HttpMethod -ceq 'POST') {
            try { Write-Audit $peer $identity $action $result } catch {
                $code = 503; $value = @{ error = 'Audit unavailable' }
                try { Write-RotatedLine 'C:\bandit-ai\agent\agent.log' ('Audit failure: ' + $_.Exception.Message) } catch { }
            }
        }
        try { Send-Response $Context.Response $code $value -Html:$html } catch {
            try { Write-RotatedLine 'C:\bandit-ai\agent\agent.log' ('Response failure: ' + $_.Exception.Message) } catch { }
        }
        try { $Context.Response.Close() } catch { }
    }
}
function Start-Agent {
    if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18') { throw 'Agent must run as SYSTEM' }
    $script:config = Read-BoundedText 'C:\bandit-ai\agent\config.json' | ConvertFrom-Json
    if ($script:config.fqdn -notmatch '^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$' -or $script:config.fqdn -notmatch '\.' -or -not (Test-Number $script:config.port 1 65535 -Integer) -or -not [IO.Path]::IsPathRooted($script:config.tailscale)) { throw 'Invalid config' }
    $script:access = @{}
    $acl = Read-BoundedText 'C:\bandit-ai\agent\access.json' | ConvertFrom-Json
    foreach ($property in $acl.PSObject.Properties) { $script:access[$property.Name] = $property.Value }
    $script:whoisCache = @{}; $script:statusCache = @{}
    $authority = "$($script:config.fqdn):$($script:config.port)"
    $script:origin = "https://$authority"
    if ($script:config.port -eq 443) { $script:origin = "https://$($script:config.fqdn)" }
    $script:page = Read-BoundedText 'C:\bandit-ai\agent\ui.html' 1MB
    $scripts = [regex]::Matches($script:page, '(?s)<script>(.*?)</script>')
    if ($scripts.Count -ne 1) { throw 'Exactly one page script required' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($scripts[0].Groups[1].Value))) } finally { $sha.Dispose() }
    $script:csp = "default-src 'none'; script-src 'sha256-$hash'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    $tokens = $null; $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($PSCommandPath, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw 'Agent parse failed' }
    $script:probeFunctions = @{}
    foreach ($part in 'Andy', 'Gpu', 'Process', 'Service', 'Autostart', 'Update') {
        $names = @('Assert-NoReparse', 'Read-BoundedText', 'Invoke-Program', "Get-${part}Status")
        $script:probeFunctions[$part] = ($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names }, $true) | ForEach-Object { $_.Extent.Text }) -join "`n"
    }
    $listener = New-Object Net.HttpListener
    $listener.Prefixes.Add("https://$authority/")
    $listener.TimeoutManager.HeaderWait = [TimeSpan]::FromSeconds(10)
    $listener.TimeoutManager.EntityBody = [TimeSpan]::FromSeconds(10)
    $listener.TimeoutManager.DrainEntityBody = [TimeSpan]::FromSeconds(1)
    $listener.TimeoutManager.RequestQueue = [TimeSpan]::FromSeconds(5)
    try {
        $listener.Start()
        while ($listener.IsListening) { Invoke-AgentRequest ($listener.GetContext()) }
    } finally { $listener.Close() }
}
# Parts 0, 2 and 3 (keys, admin actions and Wake-on-LAN) are deliberately absent.
# Task Scheduler's RestartCount covers only a failed launch, not a script that ends with an error, so
# the agent restarts itself (config and access are read again each time).
while ($true) {
    try { Start-Agent } catch {
        try { Write-RotatedLine 'C:\bandit-ai\agent\agent.log' ([datetime]::UtcNow.ToString('o') + ' Fatal, restart in 30 s: ' + $_.Exception.Message) } catch { }
    }
    Start-Sleep -Seconds 30
}
