[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# Read-only operator command. No options to rotate, create files or shut down.
$root = 'C:\Users\diego\RenoLinkBootstrapTrial-e5536b82f7274ceca2c200503c1339b9'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.Name.Split('\')[-1] -ine 'diego') {
    throw 'Execute como diego em PowerShell normal. A conta desta sessao nao e diego.'
}
$json = @(& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'diagnose-mysql-bootstrap-trial.ps1') -TrialRoot $root)
if ($LASTEXITCODE -ne 0) { throw 'Diagnostico incompleto. Nenhuma recuperacao permitida.' }
$snapshot = ($json -join [Environment]::NewLine) | ConvertFrom-Json
. (Join-Path $PSScriptRoot 'mysql-trial-recovery-validation.ps1')
$null = Get-TrialRecoveryFingerprint $snapshot
$service = Get-CimInstance Win32_Service -Filter "Name='MYSQL80'" -ErrorAction Stop
if ($null -eq $service -or $service.State -cne 'Running') { throw 'MYSQL80 nao confirmado.' }
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $_.LocalPort -in @(3306,33060) } |
    Sort-Object LocalPort,LocalAddress,OwningProcess |
    Select-Object LocalAddress,LocalPort,OwningProcess)
# Deliberate allowlist: no command lines, login paths, credentials or file contents.
[pscustomobject]@{
    ReadOnly = $true
    CapturedUtc = [datetime]::UtcNow.ToString('o')
    Trial = $snapshot | Select-Object Status,ConfigStatus,ProcessStatus,ListenerStatus,ListenerAddress,
        ProcessId,VerifiedProcessIds,VerifiedProcesses,ConfigPath,Datadir
    MYSQL80 = $service | Select-Object Name,State,StartMode,StartName,ProcessId
    MainListeners = $listeners
    RecoveryAuthorized = $false
} | ConvertTo-Json -Depth 7
