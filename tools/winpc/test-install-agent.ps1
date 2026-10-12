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
Assert ($installer -match 'AtStartup' -and $installer -match 'UserId .SYSTEM.' -and $installer -match 'RestartCount') 'SYSTEM restart task missing'
Assert ($installer -match 'RenewCertificate' -and $installer -match 'bandit-agent-renew') 'Certificate renewal task missing'
Assert ($installer -match 'CngKey.Import' -and $installer -match 'CopyWithPrivateKey' -and $installer -match 'netsh.exe.*add sslcert') 'Built-in certificate conversion/binding missing'
Assert ($installer.IndexOf('$certObject = Import-PfxCertificate') -lt $installer.IndexOf('http add sslcert')) 'Import must precede SSL binding'
Assert ($installer -match 'ReadAllBytes\(\$PSCommandPath\)' -and $installer -match 'Set-ExactAcl "\$agent\\install-agent.ps1"') 'Protected renewal installer copy missing'
foreach ($name in 'agent.ps1','ui.html') {
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
foreach ($name in 'Resolve-Access','Remove-BroadWrite') {
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
