[CmdletBinding()]
param(
    [switch]$AuthorizeRecovery,
    [string]$Confirmation
)
$ErrorActionPreference='Stop'
# Nothing, including library imports, happens before this explicit gate.
if (-not $AuthorizeRecovery -or $Confirmation -cne 'RECOVER-DISPOSABLE-33307') {
    throw 'Inactive: explicit recovery authorization and confirmation required.'
}
$script:RecoveryContext=$null
$operator=$null
$stage='OperatorValidation'
try {
    if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) {
        throw 'WindowsPowerShell51Required'
    }
    $operator=[Security.Principal.WindowsIdentity]::GetCurrent()
    $principal=[Security.Principal.WindowsPrincipal]::new($operator)
    if ($Host.Name -cne 'ConsoleHost' -or (Get-Variable PSSenderInfo -ValueOnly -ErrorAction SilentlyContinue) -or
        $operator.Name.Split('\')[-1] -ine 'diego' -or $operator.IsSystem -or
        $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'NormalDiegoSessionRequired' }
    # Refuse machine/user mandatory transcription and script-block invocation logging.
    # Do not change any policy. Interactive/screen recording remains an operator duty.
    foreach ($hive in @('HKLM:','HKCU:')) {
        foreach ($policy in @(@('Transcription','EnableTranscripting'),@('ScriptBlockLogging','EnableScriptBlockInvocationLogging'),
            @('ModuleLogging','EnableModuleLogging'))) {
            $key="$hive\Software\Policies\Microsoft\Windows\PowerShell\$($policy[0])"
            if (Test-Path -LiteralPath $key) {
                $value=Get-ItemProperty -LiteralPath $key -ErrorAction Stop
                if ($value.PSObject.Properties[$policy[1]] -and $value.($policy[1]) -eq 1) { throw 'RecordingPolicyEnabled' }
            }
        }
    }
    $root='C:\Users\diego\RenoLinkBootstrapTrial-e5536b82f7274ceca2c200503c1339b9'
    . (Join-Path $PSScriptRoot 'mysql-trial-recovery-validation.ps1')
    . (Join-Path $PSScriptRoot 'mysql-trial-recovery-windows.ps1')
    . (Join-Path $PSScriptRoot 'diagnose-mysql-bootstrap-trial.ps1') -TrialRoot $root -LibraryOnly
    $script:RecoveryContext=@{
        Root=$root; Sid=$operator.User.Value
        Initial="$root\secrets\client.cnf"; Rotated="$root\secrets\client-rotated.cnf"; Ca="$root\certs\ca.pem"
        Diagnostic=Join-Path $PSScriptRoot 'diagnose-mysql-bootstrap-trial.ps1'
        Fixture=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\test\fixtures\mysql-tls'))
        Prepared=$false; FilesValidated=$false; PrivateStream=$null; RotatedHash=$null
        Locks=[Collections.ArrayList]::new(); Calls=@{Rotate=0;Prove=0;Shutdown=0}
        MainBaseline=$null; Files=@()
    }
    foreach ($path in @("$root\config\my.ini","$root\secrets\client.cnf","$root\certs\ca.pem",
        "$root\certs\valid.cert.pem","$root\certs\valid.key.pem")) {
        $script:RecoveryContext.Files+=@{Path=$path;Private=$true;Hash=$null}
    }
    foreach ($path in @('D:\MySQL\bin\mysqld.exe','D:\MySQL\bin\mysql.exe','D:\MySQL\bin\mysqladmin.exe',
        $script:RecoveryContext.Diagnostic,(Join-Path $PSScriptRoot 'mysql-trial-recovery-validation.ps1'),
        (Join-Path $PSScriptRoot 'mysql-trial-recovery-windows.ps1'),$PSCommandPath,
        (Join-Path $script:RecoveryContext.Fixture 'ca.pem'),(Join-Path $script:RecoveryContext.Fixture 'valid.cert.pem'))) {
        $script:RecoveryContext.Files+=@{Path=$path;Private=$false;Hash=$null}
    }
    $stage='ReadOnlyIdentityApproval'
    Assert-RecoveryEnvironment
    $approved=Get-RecoveryTrialIdentity $script:RecoveryContext
    # Freeze the initial identity. Nothing later assigns a replacement snapshot.
    $approved=$approved | ConvertTo-Json -Depth 7 | ConvertFrom-Json
    $fingerprint=Get-TrialRecoveryFingerprint $approved
    $script:RecoveryContext.MainBaseline=Get-RecoveryMainSnapshot
    $second=Get-RecoveryMainSnapshot
    if ($second -cne $script:RecoveryContext.MainBaseline) { throw 'UnstableMainBaseline' }
    $sha=[Security.Cryptography.SHA256]::Create()
    try { $digest=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprint)))).Replace('-','') }
    finally { $sha.Dispose() }
    # All fields displayed here are explicitly selected and contain no credential.
    Write-Host ($approved | Select-Object ProcessId,ConfigPath,Datadir,VerifiedProcesses | ConvertTo-Json -Depth 5)
    $mainSummary=$script:RecoveryContext.MainBaseline | ConvertFrom-Json
    Write-Host ($mainSummary.Service | Select-Object Name,State,StartMode,ProcessId | ConvertTo-Json -Compress)
    Write-Host ($mainSummary.Processes | Select-Object Id,Parent,Creation,Image | ConvertTo-Json -Compress)
    Write-Host ($mainSummary.Listeners | ConvertTo-Json -Compress)
    Write-Host 'Confirm this CURRENT identity and the risks: password rotation may succeed even if persistence fails; no retry/forced shutdown will follow.'
    Write-Host 'Do not continue in a recorded, debugged, transcribed or shared session.'
    $answer=Read-Host "To authorize this immutable snapshot, type RECOVER-33307-$digest"
    if ($answer -cne "RECOVER-33307-$digest") { throw 'SnapshotNotApproved' }
    $stage='StateMachine'
    $result=Invoke-TrialRecoveryStateMachine $approved (New-RecoveryWindowsAdapter)
    # Result has only state/counter, never client output or exception details.
    Write-Output ($result | ConvertTo-Json -Compress)
} catch {
    # Do not emit the original ErrorRecord, invocation line, native stderr or values.
    $state = if ($stage -ceq 'StateMachine' -and $_.Exception.Message.StartsWith('RecoveryStopped:')) {
        $_.Exception.Message
    } else { "RecoveryStopped: Stage=$stage; no automatic retry." }
    Write-Output $state
    exit 1
} finally {
    if ($null -ne $script:RecoveryContext) {
        if ($null -ne $script:RecoveryContext.PrivateStream) {
            try { $script:RecoveryContext.PrivateStream.Dispose() } catch { Write-Output 'PrivateHandleCleanupUnconfirmed' }
        }
        foreach ($stream in $script:RecoveryContext.Locks) {
            try { $stream.Dispose() } catch { Write-Output 'ReadHandleCleanupUnconfirmed' }
        }
    }
    if ($null -ne $operator) { $operator.Dispose() }
}
