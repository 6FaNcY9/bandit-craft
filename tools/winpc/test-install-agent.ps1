$ErrorActionPreference = 'Stop'
function Assert($ok, $message) { if (-not $ok) { throw $message } }
$root = $PSScriptRoot
$installer = Get-Content (Join-Path $root 'install-agent.ps1') -Raw
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput($installer, [ref]$tokens, [ref]$errors)
Assert (-not $errors.Count) "PowerShell parse failed: $($errors[0])"
foreach ($name in 'agent.ps1','test-agent.ps1','test-install-agent.ps1') {
    [Management.Automation.Language.Parser]::ParseFile((Join-Path $root $name), [ref]$tokens, [ref]$errors) | Out-Null
    Assert (-not $errors.Count) "Parse failed for ${name}: $($errors[0])"
}
Assert ($installer -notmatch '(?i)\b(irm|iwr)\b.*\|\s*iex') 'Installer must not download and execute code'
Assert ($installer -match 'S-1-5-32-544' -and $installer -match 'S-1-5-18') 'ACLs must include Administrators and SYSTEM'
Assert ($installer -match 'S-1-5-11' -and $installer -match 'S-1-5-32-545') 'Parent broad-write cleanup missing'
Assert ($installer -match 'Assert-NoLinks' -and $installer -match 'Invoke-CertificateBinding') 'Reparse and certificate guards missing'
Assert ($installer -match 'function Resolve-Access' -and $installer -match 'Access cannot be empty') 'Access validation missing'
Assert ($installer -match 'Translate\(\[Security\.Principal\.SecurityIdentifier\]\)' -and $installer -match 'writeBits') 'ACL filtering must compare SIDs and preserve read rights'
Assert ($installer -match 'Guid\]::NewGuid' -and $installer -match 'CreateNew') 'Atomic writes must use unpredictable exclusive temp files'
Assert ($installer -match 'function Protect-Tree' -and $installer -notmatch 'Get-ChildItem.*-Recurse') 'Protected trees must check links before descending'
Assert ($installer -match '100\.64\.0\.0/10' -and $installer -match 'InterfaceAlias') 'Firewall is not tailnet scoped'
# The watcher runs non-elevated and writes only runtime: it needs its own grant there before the parent's
# broad Modify goes (on slayer runtime only inherited it from C:\, 2026-10-12).
$runtimeGrant = $installer.IndexOf('Set-ExactAcl "$base\runtime" $watcherSid ''Modify''')
Assert ($runtimeGrant -gt 0 -and $runtimeGrant -lt $installer.IndexOf('Remove-BroadWrite $base')) 'runtime must get the watcher grant before the parent loses broad write'
# The protected folders must never exist while the parent still grants everyone Modify.
Assert ($installer.IndexOf('Remove-BroadWrite $base') -lt $installer.IndexOf('New-Item -ItemType Directory -Force -Path $agent,$state,$control')) 'agent, state and control must be created after the parent is narrowed'
# SYSTEM runs this path for good: never resolve it through a PATH that has user-writable entries.
Assert ($installer -notmatch 'Get-Command tailscale' -and $installer -match '\$env:ProgramFiles\\Tailscale\\tailscale\.exe') 'Tailscale must be the Program Files binary'
Assert ($installer -match 'AtStartup' -and $installer -match 'UserId .SYSTEM.' -and $installer -match 'RestartCount') 'SYSTEM restart task missing'
Assert ($installer -match 'RenewCertificate' -and $installer -match 'bandit-agent-renew') 'Certificate renewal task missing'
Assert ($installer -match 'CngKey.Import' -and $installer -match 'CopyWithPrivateKey' -and $installer -match 'netsh.exe.*add sslcert') 'Built-in certificate conversion/binding missing'
Assert ($installer.IndexOf('$certObject = Import-PfxCertificate') -lt $installer.IndexOf('http add sslcert')) 'Import must precede SSL binding'
Assert ($installer -match 'ReadAllBytes\(\$PSCommandPath\)' -and $installer -match 'Set-ExactAcl "\$agent\\install-agent.ps1"') 'Protected renewal installer copy missing'
foreach ($name in 'agent.ps1','ui.html','diag.ps1') {
    $sourcePath = Join-Path $root $name
    if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Missing payload: $name" }
    $pattern = "'" + [regex]::Escape($name) + "'\s*=\s*'([^']+)'"
    $match = [regex]::Match($installer, $pattern)
    Assert ($match.Success) "Embedded payload missing: $name"
    $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($match.Groups[1].Value))
    $source = Get-Content $sourcePath -Raw
    Assert ($decoded -eq $source) "Embedded $name payload is stale"
}
foreach ($bad in '??','ForEach-Object -Parallel','curl.exe','Invoke-WebRequest') { Assert ($installer -notmatch [regex]::Escape($bad)) "Forbidden installer syntax/tool: $bad" }
'PASS: installer parse, ACL, reparse, certificate, firewall, task and payload checks'
foreach ($name in 'Resolve-Access','Remove-BroadWrite','KeyBlob','Validate-Key','Assert-TailnetAddress','Format-AdminKeys','Resolve-Keys') {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
}
Assert ((Resolve-Access @{ pc='self'; laptop='owner'; phone='operator' }).Count -eq 3) 'Hashtable access rejected'
Assert ((Resolve-Access '{"pc":"self"}')['pc'] -eq 'self') 'JSON access rejected'
foreach ($bad in $null, '{}', '{"pc":"admin"}', '{"pc":"OWNER"}', '{"pc":true}') {
    $refused = $false
    try { Resolve-Access $bad | Out-Null } catch { $refused = $true }
    Assert $refused 'Bad access map accepted'
}
# Real Windows ACL objects, mocked filesystem: preserve user RX and runtime without touching either.
$script:parentAcl = New-Object Security.AccessControl.DirectorySecurity
$inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
foreach ($pair in @(@('S-1-5-11','Modify'), @('S-1-5-32-545','ReadAndExecute'), @('S-1-5-21-1-2-3-1001','ReadAndExecute'), @('S-1-5-18','FullControl'), @('S-1-5-32-544','FullControl'))) {
    $sid = New-Object Security.Principal.SecurityIdentifier($pair[0])
    $script:parentAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, $pair[1], $inherit, 'None', 'Allow')))
}
function Get-Item { param($LiteralPath, [switch]$Force) [pscustomobject]@{ PSIsContainer=$true } }
function Get-Acl { param($LiteralPath) $script:parentAcl }
function Set-Acl { param($LiteralPath, $AclObject) Assert ($LiteralPath -eq 'C:\bandit-ai') 'Must change only the parent ACL'; $script:parentAcl = $AclObject }
Remove-BroadWrite 'C:\bandit-ai'
$rules = $script:parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
$writes = [Security.AccessControl.FileSystemRights]'WriteData,AppendData,WriteAttributes,WriteExtendedAttributes,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
foreach ($sid in 'S-1-5-11','S-1-5-32-545','S-1-5-21-1-2-3-1001') {
    $rule = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid })[0]
    Assert ($null -ne $rule -and -not ($rule.FileSystemRights -band $writes)) 'Non-admin parent retains dangerous rights'
    Assert (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::ReadAndExecute) -eq [Security.AccessControl.FileSystemRights]::ReadAndExecute) 'ReadAndExecute grant lost'
}
Assert ($script:parentAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-32-544') 'Parent owner must be Administrators'
'PASS: access parameter validation and parent ACL preserves RX while removing broad write/delete grants'
# Part 0: administrators_authorized_keys is written whole from the given keys, each line address-bound.
function New-TestKey([byte]$Seed, [string]$Comment) {
    $kind = [Text.Encoding]::ASCII.GetBytes('ssh-ed25519')
    $blob = [byte[]](0, 0, 0, 11) + $kind + [byte[]](0, 0, 0, 32) + [byte[]](@($Seed) * 32)
    "ssh-ed25519 $([Convert]::ToBase64String($blob)) $Comment"
}
$powerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'; $agent = 'C:\bandit-ai\agent'
$keys = @{ tunnel = (New-TestKey 1 'tunnel'); shell = (New-TestKey 2 'shell'); diag = (New-TestKey 3 'diag'); laptop = '100.102.247.30'; lab = '100.125.161.81' }
$lines = @(Format-AdminKeys $keys)
Assert ($lines.Count -eq 3) 'Exactly the tunnel, shell and diag lines expected'
Assert ($lines[0] -ceq ('from="100.125.161.81",restrict,port-forwarding,permitopen="127.0.0.1:8081",command="exit" ' + $keys.tunnel)) "Tunnel line wrong: $($lines[0])"
Assert ($lines[1] -ceq ('from="100.102.247.30" ' + $keys.shell)) "Shell line wrong: $($lines[1])"
Assert ($lines[2] -ceq ('from="100.102.247.30",restrict,command="C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\bandit-ai\agent\diag.ps1" ' + $keys.diag)) "Diag line wrong: $($lines[2])"
$coordinator = New-TestKey 4 'coordinator'
$lines = @(Format-AdminKeys $keys @($coordinator))
Assert ($lines.Count -eq 4 -and $lines[3] -ceq ('from="100.102.247.30" ' + $coordinator)) 'The switch-over coordinator line must be laptop-bound'
foreach ($bad in @(
    @{ tunnel = $keys.tunnel; shell = $keys.tunnel; diag = $keys.diag; laptop = $keys.laptop; lab = $keys.lab },
    @{ tunnel = $keys.tunnel; shell = $keys.shell; diag = $keys.diag; laptop = '192.168.0.10'; lab = $keys.lab },
    @{ tunnel = $keys.tunnel; shell = $keys.shell; diag = $keys.diag; laptop = $keys.laptop; lab = '100.128.0.1' },
    @{ tunnel = $keys.tunnel; shell = $keys.shell; diag = $keys.diag; laptop = '100.102.247'; lab = $keys.lab },
    @{ tunnel = $keys.tunnel; shell = ('command="cmd" ' + $keys.shell); diag = $keys.diag; laptop = $keys.laptop; lab = $keys.lab },
    @{ tunnel = $keys.tunnel; shell = ($keys.shell + "`n" + $keys.diag); diag = $keys.diag; laptop = $keys.laptop; lab = $keys.lab },
    @{ tunnel = $keys.tunnel; shell = ($keys.shell + ' "x'); diag = $keys.diag; laptop = $keys.laptop; lab = $keys.lab })) {
    $refused = $false
    try { Format-AdminKeys $bad | Out-Null } catch { $refused = $true }
    Assert $refused 'Duplicate key, non-tailnet address, key option, newline or quote accepted'
}
$refused = $false
try { Format-AdminKeys $keys @($keys.shell) | Out-Null } catch { $refused = $true }
Assert $refused 'The coordinator key must differ from the new keys'
$bound = @{ ShellPublicKey = 'x' }
$refused = $false
try { Resolve-Keys | Out-Null } catch { $refused = $true }
Assert $refused 'Some key parameters without the others accepted'
$bound = @{}; $CoordinatorPublicKey = @($coordinator)
$refused = $false
try { Resolve-Keys | Out-Null } catch { $refused = $true }
Assert $refused 'A coordinator key without the key parameters accepted'
$CoordinatorPublicKey = @()
Assert ($installer -match '(?s)foreach \(\$name in \$embedded\.Keys\).*Write-AtomicBytes \$authorized') 'Keys must be written after diag.ps1 is in place'
Assert ($installer -match 'keys\.json" \(\[Text\.Encoding\]::ASCII\.GetBytes\(\(\$keys \|') 'keys.json must hold the resolved keys only, never the coordinator'
Assert ($installer -match 'Set-ExactAcl \$authorized') 'administrators_authorized_keys must be Administrators/SYSTEM only'
'PASS: SSH key lines (address-bound, forced diag, switch-over coordinator), refusals, all-or-none parameters'
