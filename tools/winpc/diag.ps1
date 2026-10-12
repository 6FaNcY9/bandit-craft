# Forced command of the read-only diagnostics key (install-agent.ps1 -DiagPublicKey; Claude's key on the
# PC). Answers only the fixed requests below, given as the SSH command ("ssh <pc> gpu"). It runs elevated
# (administrators_authorized_keys), so it reads user-writable files only through the agent's no-follow,
# bounded reader and never runs or interprets what it reads.
$ErrorActionPreference = 'Stop'

function Invoke-Diag([string]$Request) {
    switch -CaseSensitive ($Request.Trim()) {
        'andy' { return Get-AndyStatus | ConvertTo-Json -Depth 8 }
        'gpu' { return Get-GpuStatus | ConvertTo-Json -Depth 6 }
        'processes' {
            return @(Get-CimInstance Win32_Process -OperationTimeoutSec 5 | Where-Object { $_.Name -eq 'llama-server.exe' -or $_.CommandLine -match 'bandit-ai' } |
                ForEach-Object { [ordered]@{ name = $_.Name; pid = $_.ProcessId; started = $_.CreationDate; commandLine = $_.CommandLine } }) | ConvertTo-Json -Depth 3
        }
        'watch-log' { return Read-BoundedText 'C:\bandit-ai\runtime\watch.log' -Tail }
        'agent-log' { return Read-BoundedText 'C:\bandit-ai\agent\agent.log' -Tail }
        'audit-log' { return Read-BoundedText 'C:\bandit-ai\agent\audit.log' -Tail }
        default { throw 'requests: andy gpu processes watch-log agent-log audit-log' }
    }
}

# The agent's own readers (agent.ps1 beside this file, same protected folder).
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'agent.ps1'), [ref]$null, [ref]$null)
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Assert-NoReparse', 'Read-BoundedText', 'Invoke-Program', 'Get-AndyStatus', 'Get-GpuStatus') }, $true)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
try { Invoke-Diag "$env:SSH_ORIGINAL_COMMAND" } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 2 }
