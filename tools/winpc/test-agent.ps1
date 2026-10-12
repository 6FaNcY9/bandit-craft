$ErrorActionPreference = 'Stop'
function Assert($Ok, [string]$Message) { if (-not $Ok) { throw $Message } }
function Reject([scriptblock]$Call, [string]$Message) {
    $refused = $false
    try { & $Call | Out-Null } catch { $refused = $true }
    Assert $refused $Message
}
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'agent.ps1'), [ref]$tokens, [ref]$errors)
Assert (-not $errors.Count) "Agent parse failed: $($errors[0])"
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ne 'Start-Agent' }, $true)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
foreach ($ip in '100.64.0.0','100.76.40.98','100.127.255.255') { Assert (Test-TailnetPeer $ip) "Tailnet peer rejected: $ip" }
foreach ($ip in '100.63.255.255','100.128.0.0','127.0.0.1','192.168.0.1','::1','::ffff:100.64.0.1','bad') { Assert (-not (Test-TailnetPeer $ip)) "Peer accepted: $ip" }
'PASS: peer range and IPv4-only policy'
$script:access = @{ pc = 'self'; phone = 'operator'; laptop = 'owner' }
foreach ($id in 'pc','phone','laptop') {
    $json = @{ Node = @{ StableID = $id; Tags = @(); Expired = $false; KeyExpiry = '0001-01-01T00:00:00Z' } } | ConvertTo-Json -Depth 4
    $identity = Get-WhoisIdentity $json $script:access
    Assert ($identity.StableID -eq $id -and $identity.role -eq $script:access[$id]) 'Whois role mismatch'
}
foreach ($json in '{bad', '{}', '{"Node":{"StableID":"unknown"}}', '{"Node":{"StableID":"pc","Tags":["tag:server"]}}', '{"Node":{"StableID":"pc","Expired":true}}', '{"Node":{"StableID":"pc","Expired":"false"}}', '{"Node":{"StableID":"pc","KeyExpiry":"2000-01-01T00:00:00Z"}}', '{"Node":{"StableID":"pc","KeyExpiry":"bad"}}') {
    Reject { Get-WhoisIdentity $json $script:access } 'Unsafe whois accepted'
}
$script:config = @{ tailscale = 'C:\Program Files\Tailscale\tailscale.exe'; fqdn = 'pc.example.ts.net'; port = 8443 }
$script:whoisCache = @{}; $script:programCalls = 0; $script:programFailure = ''
function Invoke-Program {
    param($Exe, $Arguments, $TimeoutMs)
    Assert ($Exe -eq $script:config.tailscale -and $TimeoutMs -eq 3000) 'Whois command or timeout changed'
    $script:programCalls++
    if ($script:programFailure) { throw $script:programFailure }
    '{"Node":{"StableID":"pc","Tags":[],"Expired":false}}'
}
$null = Get-PeerIdentity '100.64.1.1' 'GET'
$null = Get-PeerIdentity '100.64.1.1' 'GET'
Assert ($script:programCalls -eq 1) 'GET cache not used'
$null = Get-PeerIdentity '100.64.1.1' 'POST'
Assert ($script:programCalls -eq 2) 'POST used cached identity'
$script:whoisCache['100.64.1.1'].until = [datetime]::UtcNow.AddSeconds(-1)
$null = Get-PeerIdentity '100.64.1.1' 'GET'
Assert ($script:programCalls -eq 3) 'Expired GET cache used'
foreach ($failure in 'Process timeout','Process exit 1','bad JSON') {
    $script:programFailure = $failure
    Reject { Get-PeerIdentity '100.64.1.1' 'POST' } 'Whois command failure accepted'
}
$script:programFailure = ''
'PASS: whois roles, tags, expiry, malformed JSON, command failures and GET-only cache'
foreach ($hostValue in 'pc.example.ts.net:8443','PC.EXAMPLE.TS.NET:8443') { Assert (Test-Authority $hostValue 'pc.example.ts.net' 8443) 'Valid authority rejected' }
Assert (Test-Authority 'pc.example.ts.net' 'pc.example.ts.net' 443) 'Default HTTPS authority rejected'
Assert (Test-Authority 'pc.example.ts.net:443' 'pc.example.ts.net' 443) 'Explicit HTTPS authority rejected'
foreach ($hostValue in 'pc.example.ts.net','pc.example.ts.net:443','pc.example.ts.net.evil:8443','evil@pc.example.ts.net:8443','pc.example.ts.net:8443/path','pc.example.ts.net:8443#x',' pc.example.ts.net:8443','pc.example.ts.net.:8443') { Assert (-not (Test-Authority $hostValue 'pc.example.ts.net' 8443)) "Unsafe authority: $hostValue" }
'PASS: parsed host authority, exact hostname and port'
function New-Request([string]$Text = '{"pause":true}', [long]$Length = -1) {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    $stream = New-Object IO.MemoryStream(,$bytes)
    [pscustomobject]@{ HttpMethod = 'POST'; ContentType = 'application/json'; Headers = @{ 'X-Bandit' = '1'; Origin = 'https://pc.example.ts.net:8443'; Host = 'pc.example.ts.net:8443' }; ContentLength64 = $Length; InputStream = $stream }
}
$origin = 'https://pc.example.ts.net:8443'
$request = New-Request
Assert-PostRules $request $origin
foreach ($method in 'GET','PUT','PATCH','DELETE','OPTIONS') {
    $request = New-Request; $request.HttpMethod = $method
    Reject { Assert-PostRules $request $origin } 'Non-POST accepted'
}
foreach ($type in '', 'text/plain', 'application/json; charset=utf-8', 'Application/JSON') {
    $request = New-Request; $request.ContentType = $type
    Reject { Assert-PostRules $request $origin } 'Invalid content type accepted'
}
foreach ($header in '', '0', '1, 1') {
    $request = New-Request; $request.Headers['X-Bandit'] = $header
    Reject { Assert-PostRules $request $origin } 'Invalid X-Bandit accepted'
}
foreach ($other in $null, '', 'null', 'https://other.ts.net:8443', 'http://pc.example.ts.net:8443', 'https://pc.example.ts.net:8443/') {
    $request = New-Request; $request.Headers['Origin'] = $other
    Reject { Assert-PostRules $request $origin } 'Invalid Origin accepted'
}
$request = New-Request 'x' 16385
Reject { Assert-PostRules $request $origin } 'Oversized known length accepted'
Reject { Read-RequestBody $request } 'Oversized known body read'
$request = New-Request ('x' * 16385) -1
Reject { Read-RequestBody $request } 'Oversized chunked body accepted'
$request = New-Request ('x' * 16384) -1
Assert ((Read-RequestBody $request).Length -eq 16384) 'Exact body limit refused'
$request = New-Request
Assert ((Read-RequestBody $request) -eq '{"pause":true}') 'Request body changed'
if (-not ('BanditStalledStream' -as [type])) {
    Add-Type @'
using System;
using System.IO;
using System.Threading.Tasks;
public class BanditStalledStream : MemoryStream {
    public override IAsyncResult BeginRead(byte[] buffer, int offset, int count, AsyncCallback callback, object state) {
        return new TaskCompletionSource<int>().Task;
    }
}
'@
}
$request.InputStream = New-Object BanditStalledStream
Reject { Read-RequestBody $request 20 } 'Body deadline did not fire'
'PASS: POST headers, method, Origin, 16 KB including chunked input, read deadline'
foreach ($role in 'self','operator','owner') {
    Assert ((Get-AndyAction ('{"pause":true}' | ConvertFrom-Json) $role).target -eq 'pause.flag') 'Andy role rejected'
}
Reject { Get-AndyAction ('{"pause":true}' | ConvertFrom-Json) 'admin' } 'Unknown role accepted'
foreach ($body in 'null','[]','{}','{"pause":1}','{"pause":true,"share":10}','{"share":-1}','{"share":101}','{"share":1.5}','{"share":"50"}','{"profile":{}}','{"profile":{"packetMinutes":15,"quietFan":101,"maxTemp":75,"resumeTemp":50}}','{"profile":{"packetMinutes":-1,"quietFan":30,"maxTemp":75,"resumeTemp":50}}','{"profile":{"packetMinutes":15,"quietFan":30,"maxTemp":75,"resumeTemp":75}}','{"profile":{"packetMinutes":15,"quietFan":30,"maxTemp":"75","resumeTemp":50}}','{"profile":{"packetMinutes":15,"quietFan":30,"maxTemp":75,"extra":50}}') {
    Reject { Get-AndyAction ($body | ConvertFrom-Json) 'owner' } "Invalid action accepted: $body"
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('bandit-agent-test-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temp
try {
    Write-Control (Get-AndyAction ('{"pause":true}' | ConvertFrom-Json) 'self') $temp
    Assert (Test-Path (Join-Path $temp 'pause.flag')) 'Pause not written'
    Write-Control (Get-AndyAction ('{"pause":false}' | ConvertFrom-Json) 'operator') $temp
    Assert (-not (Test-Path (Join-Path $temp 'pause.flag'))) 'Pause not removed'
    foreach ($shareValue in 0,50,100) {
        Write-Control (Get-AndyAction ((@{share=$shareValue} | ConvertTo-Json) | ConvertFrom-Json) 'owner') $temp
        Assert ((Read-BoundedText (Join-Path $temp 'batch-share.txt')) -eq [string]$shareValue) 'Share write or replacement failed'
    }
    $profile = '{"profile":{"packetMinutes":15,"quietFan":30,"maxTemp":75,"resumeTemp":50}}'
    Write-Control (Get-AndyAction ($profile | ConvertFrom-Json) 'owner') $temp
    Assert (((Read-BoundedText (Join-Path $temp 'gpu-profile.json')) | ConvertFrom-Json).maxTemp -eq 75) 'Profile write failed'
    Write-Control (Get-AndyAction ('{"profile":null}' | ConvertFrom-Json) 'owner') $temp
    Assert (-not (Test-Path (Join-Path $temp 'gpu-profile.json'))) 'Default profile did not delete override'
    Assert (@(Get-ChildItem $temp -Filter '*.tmp').Count -eq 0) 'Temporary control files leaked'
    $bounded = Join-Path $temp 'watch.log'
    [IO.File]::WriteAllText($bounded, ('x' * 70000) + "`nlast line`n")
    Reject { Read-BoundedText $bounded } 'Oversized non-tail text accepted'
    Assert ((Read-BoundedText $bounded -Tail).Trim() -eq 'last line') 'Tail must discard its partial first line'
    $script:linkPath = ''
    function Get-Item {
        param([string]$LiteralPath, [switch]$Force, $ErrorAction)
        if ($LiteralPath -eq $script:linkPath) { return [pscustomobject]@{ Attributes = [IO.FileAttributes]::ReparsePoint } }
        Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force:$Force -ErrorAction SilentlyContinue
    }
    $script:linkPath = $temp
    Reject { Write-Control (Get-AndyAction ('{"share":25}' | ConvertFrom-Json) 'owner') $temp } 'Reparse control directory accepted'
    $script:linkPath = Join-Path $temp 'batch-share.txt'
    Reject { Write-Control (Get-AndyAction ('{"share":25}' | ConvertFrom-Json) 'owner') $temp } 'Reparse control target accepted'
    $script:linkPath = ''
    $auditPath = Join-Path $temp 'audit.log'
    Write-Audit '100.64.1.1' @{ StableID = 'pc'; role = 'self' } 'pause' 'allowed' $auditPath
    Write-Audit '127.0.0.1' $null '/api/andy' 'refused' $auditPath
    $lines = @(Get-Content $auditPath)
    Assert ($lines.Count -eq 2) 'Audit must have one JSON line per call'
    $record = $lines[0] | ConvertFrom-Json
    Assert ($record.peer -eq '100.64.1.1' -and $record.StableID -eq 'pc' -and $record.role -eq 'self' -and $record.action -eq 'pause' -and $record.result -eq 'allowed') 'Audit fields changed'
    Assert ([datetimeoffset]::Parse($record.time).Offset -eq [timespan]::Zero) 'Audit timestamp must be UTC'
    $record = $lines[1] | ConvertFrom-Json
    Assert ($null -eq $record.StableID -and $null -eq $record.role) 'Unknown identity must be null'
    [IO.File]::WriteAllText($auditPath, ('x' * 5MB))
    Write-Audit '100.64.1.1' @{ StableID = 'pc'; role = 'self' } 'share' 'allowed' $auditPath
    Assert ((Get-Item -LiteralPath "$auditPath.1").Length -eq 5MB -and @(Get-Content $auditPath).Count -eq 1) 'Audit rotation failed'
    'PASS: Andy roles, validation, atomic controls, reparse refusal, audit JSON and rotation'
} finally {
    Remove-Item Function:\Get-Item -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $temp -Recurse -Force
}
# Exercise the real dispatcher with external boundaries mocked, without touching C:\bandit-ai.
$script:audits = @(); $script:responses = @(); $script:denyPeer = $false; $script:readCalls = 0; $script:statusCache = @{}
function Get-PeerIdentity { param($Ip, $Method) if ($script:denyPeer) { throw 'Peer denied' }; @{ StableID = 'pc'; role = 'self' } }
function Read-RequestBody { param($Request) $script:readCalls++; throw 'Do not read refused bodies' }
function Write-Audit { param($Peer, $Identity, $Action, $Result) $script:audits += @{ peer=$Peer; action=$Action; result=$Result } }
function Write-RotatedLine { param($Path, $Line) }
function Send-Response { param($Response, $Code, $Value, [switch]$Html) $script:responses += $Code }
$script:origin = $origin
function Dispatch([string]$Method, [string]$Path, [bool]$Denied = $false) {
    $script:denyPeer = $Denied
    $r = New-Request; $r.HttpMethod = $Method
    $r | Add-Member RemoteEndPoint ([Net.IPEndPoint]::new([Net.IPAddress]::Parse('100.64.1.1'), 1234))
    $r | Add-Member RawUrl $Path
    $r | Add-Member Url ([uri]($origin + $Path))
    $response = [pscustomobject]@{}
    $response | Add-Member -MemberType ScriptMethod -Name Close -Value { }
    Invoke-AgentRequest ([pscustomobject]@{ Request=$r; Response=$response })
}
Dispatch 'POST' '/api/andy' $true
Dispatch 'OPTIONS' '/api/andy'
Dispatch 'POST' '/api/admin'
Dispatch 'DELETE' '/api/andy'
Assert (($script:responses -join ',') -eq '403,405,404,404') 'Dispatcher refusal codes changed'
Assert ($script:readCalls -eq 0 -and $script:audits.Count -eq 2) 'Refused requests read bodies or POST audit missing'
'PASS: dispatcher authenticates before body, OPTIONS 405, unknown routes 404, every refused POST audited'
$script:role = 'self'; $script:writes = 0
function Get-PeerIdentity { param($Ip, $Method) @{ StableID = 'fixture'; role = $script:role } }
function Read-RequestBody { param($Request) $script:readCalls++; '{"pause":true}' }
function Assert-AuditWritable { }
function Write-Control { param($Action) Assert ($Action.target -eq 'pause.flag') 'Dispatcher changed action'; $script:writes++ }
foreach ($role in 'self','operator','owner') { $script:role = $role; Dispatch 'POST' '/api/andy' }
Assert ($script:writes -eq 3 -and $script:audits.Count -eq 5) 'Andy roles must write and audit each allowed POST'
Assert (($script:responses[-3..-1] -join ',') -eq '200,200,200') 'Allowed Andy requests failed'
'PASS: all three roles reach only the Andy control route and every allowed POST is audited'
$script:probeFunctions = @{ Andy=''; Gpu=''; Process=''; Service=''; Autostart=''; Update='' }
$script:statusCache = @{}; $script:probeCalls = 0
function Invoke-Program {
    param($Exe, $Arguments, $TimeoutMs)
    Assert ($TimeoutMs -eq 6500) 'Status worker deadline changed'
    $script:probeCalls++
    if ($script:probeCalls -eq 4) { throw 'service provider timeout' }
    '{"fixture":true}'
}
$status = Get-Status
Assert ($status.services.error -eq 'service provider timeout' -and $status.andy.fixture -and $status.updates.fixture) 'Status failures must remain independent'
$null = Get-Status
Assert ($script:probeCalls -eq 6) 'Status cache not used'
# Andy and GPU age out after 3 s, a failed part too; services, autostart and updates are kept for 60 s.
foreach ($key in @($script:statusCache.Keys)) { $script:statusCache[$key].until = $script:statusCache[$key].until.AddSeconds(-5) }
$status = Get-Status
Assert ($script:probeCalls -eq 9 -and $status.services.fixture) 'Only Andy, GPU and the failed part may be probed again'
'PASS: independent time-boxed status failures, per-part cache (fast parts 3 s, failures retried)'
# Invoke-RestMethod emits llama-server's /slots array as one object; PS 5.1 then writes it as
# {"value":[...],"Count":n} and the page's slot table stays empty (seen on slayer).
function Invoke-RestMethod { '[{"id":0,"is_processing":true}]' | ConvertFrom-Json }
$andyJson = ConvertTo-Json -InputObject (Get-AndyStatus) -Depth 12 -Compress
Remove-Item Function:\Invoke-RestMethod
Assert ($andyJson -match '"slots":\[\{"id":0') "Slots must be a JSON array: $andyJson"
'PASS: llama-server slots reach the page as a JSON array'
$ui =[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'ui.html'))
Assert ([regex]::Matches($ui, '(?i)<script\b').Count -eq 1 -and [regex]::Matches($ui, '(?s)<script>(.*?)</script>').Count -eq 1) 'Exactly one inline script required'
Assert ($ui -notmatch '(?i)innerHTML|outerHTML|insertAdjacentHTML|document\.write|<script[^>]+src=') 'Unsafe DOM or external script'
Assert ($ui -match 'textContent' -and $ui -match 'createElement') 'Safe DOM construction missing'
Assert ($ui -notmatch '(?i)https?://') 'UI must not make external requests'
'PASS: single inline script, textContent rendering, no external requests'
$agentText = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'agent.ps1'))
Assert ($agentText -match 'OPEN_REPARSE_POINT' -and $agentText -match 'file.parents.Add') 'Runtime reads must pin ancestors and open without following links'
Assert ($agentText -notmatch 'Access-Control-Allow' -and $agentText -notmatch 'https://[+*]') 'CORS or wildcard listener forbidden'
Assert ($agentText -match 'ComputeHash' -and $agentText -match 'X-Frame-Options' -and $agentText -match 'Cache-Control') 'CSP hash and security headers missing'
Assert ($agentText -match '\$p.Kill\(\)' -and $agentText -match 'WaitForExit\(\$TimeoutMs\)') 'Process deadlines must kill timed-out children'
Assert ($agentText -match "/slots' -TimeoutSec 2 -MaximumRedirection 0") 'SYSTEM must not follow a redirect from whatever listens on the slots port'
Assert ($agentText -match '(?s)while \(\$true\) \{\s*try \{ Start-Agent \}' -and $agentText -notmatch '(?m)^\s*exit 1') 'The agent must restart itself; Task Scheduler does not after an error exit'
'PASS: runtime no-follow reads, fail-closed process deadlines, exact listener and response headers'
