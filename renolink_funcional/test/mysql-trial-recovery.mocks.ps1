$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\mysql-trial-recovery-validation.ps1')
$script:cases = 0
function Check($Condition, $Name) {
    if (-not $Condition) { throw "Mock assertion failed: $Name" }
    $script:cases++
}
function Reject([scriptblock]$Action, [string]$Name) {
    $failed = $false
    try { $null = & $Action } catch { $failed = $true }
    Check $failed $Name
}
function New-Snapshot {
    $root = 'C:\Users\diego\RenoLinkBootstrapTrial-e5536b82f7274ceca2c200503c1339b9'
    [pscustomobject]@{
        Status='IdentifiedListening'; ConfigStatus='ExactTrialConfiguration'
        ProcessStatus='IdentityMatchedParentChildSet'; ListenerStatus='OwnedLoopbackListener'
        ListenerAddress='127.0.0.1'; ProcessId=2720; VerifiedProcessIds=@(2720,12016)
        ConfigPath="$root\config\my.ini"; Datadir="$root\data"
        VerifiedProcesses=@(
            [pscustomobject]@{ ProcessId=2720; ParentProcessId=12016; ExecutablePath='D:\MySQL\bin\mysqld.exe'; CreationDate='2026-11-02T00:18:32.4608704Z' },
            [pscustomobject]@{ ProcessId=12016; ParentProcessId=999; ExecutablePath='D:\MySQL\bin\mysqld.exe'; CreationDate='2026-11-02T00:18:32.4091828Z' })
    }
}
# Synthetic response only. No genuine credential or operational private file.
$script:rotation = "root`tlocalhost`tSyntheticCredential123!`t1`n"
$script:proof = "$( (New-Snapshot).Datadir )\`t33307`t12345678-1234-1234-1234-123456789abc`t8.0.46`troot@localhost`nSsl_cipher`tTLS_AES_256_GCM_SHA384`n"
$chars = ConvertFrom-TrialRotationResponse 0 $script:rotation
Check ($chars -is [char[]] -and $chars.Length -eq 23) 'four columns'
[Array]::Clear($chars,0,$chars.Length)
foreach ($bad in @('', "root`tlocalhost`t12345", "root`tlocalhost`t12345`t2", "root`tother`t12345`t1",
    "root`tlocalhost`t    `t1", "root`tlocalhost`t1234`t1", "root`tlocalhost`tbad password`t1",
    "root`tlocalhost`twrong'character`t1", "root`tlocalhost`tunicodeé`t1",
    "root`tlocalhost`t$('a' * 256)`t1", "$script:rotation$script:rotation")) {
    Reject { ConvertFrom-TrialRotationResponse 0 $bad } 'reject malformed rotation'
}
Reject { ConvertFrom-TrialRotationResponse 1 $script:rotation } 'nonzero rotation exit'
Check (Assert-TrialAuthenticatedProof 0 $script:proof (New-Snapshot).Datadir) 'proof success'
foreach ($bad in @($script:proof.Replace('33307','3306'), $script:proof.Replace('8.0.46','8.0.45'),
    $script:proof.Replace('root@localhost','app@localhost'), $script:proof.Replace('Ssl_cipher','wrong'),
    $script:proof.Replace('TLS_AES_256_GCM_SHA384',''), $script:proof.Replace('12345678-1234-1234-1234-123456789abc','not-a-uuid'),
    $script:proof.Replace('\data\', '\other\'), ($script:proof + "extra`n"))) {
    Reject { Assert-TrialAuthenticatedProof 0 $bad (New-Snapshot).Datadir } 'reject invalid proof'
}
Reject { Assert-TrialAuthenticatedProof 1 $script:proof (New-Snapshot).Datadir } 'TLS/auth failure'
foreach ($badPath in @('relative', '\\server\share', 'C:\path\..\other', 'C:\path:stream', 'C:\path.\other')) {
    Reject { ConvertTo-TrialExactPath $badPath } 'ambiguous path'
}
function New-Adapter([string]$Failure) {
    $script:scenario = $Failure
    $script:shutdowns = 0; $script:rotations = 0; $script:disposed = 0; $script:gate = 0
    $script:observedBuffer = $null
    $script:handle = [pscustomobject]@{}
    $script:handle | Add-Member ScriptMethod Dispose { $script:disposed++ }
    return @{
        Identity={
            $script:gate++
            $value = New-Snapshot
            if ($script:scenario -eq 'ambiguous') { $value.Status='Ambiguous' }
            if ($script:scenario -eq 'pid') { $value.VerifiedProcesses[0].ProcessId=888 }
            if ($script:scenario -eq 'birth') { $value.VerifiedProcesses[0].CreationDate='2026-11-02T00:18:32.4608705Z' }
            if ($script:scenario -eq 'beforeShutdown' -and $script:gate -eq 6) { $value.Status='Ambiguous' }
            $value
        }
        MainUnchanged={ $script:scenario -ne 'main' }
        ValidateFiles={ $script:scenario -ne 'files' }
        PreparePrivateFile={ if ($script:scenario -eq 'create') { throw 'mock create failure' }; $script:handle }
        Rotate={
            $script:rotations++
            if ($script:scenario -in @('tls','auth')) { return @{ExitCode=1; Output=''} }
            if ($script:scenario -eq 'invalidPassword') { return @{ExitCode=0; Output="root`tlocalhost`t `t1"} }
            @{ExitCode=0; Output=$script:rotation}
        }
        Persist={
            param($Handle,$Password)
            $script:observedBuffer = $Password
            if ($script:scenario -eq 'write') { throw 'mock write exception with sensitive text' }
            $script:scenario -ne 'persist'
        }
        Prove={
            if ($script:scenario -eq 'proof') { return @{ExitCode=0; Output='incomplete'} }
            @{ExitCode=0; Output=$script:proof}
        }
        Shutdown={ $script:shutdowns++; if ($script:scenario -eq 'shutdown') { return 1 }; 0 }
        ConfirmTermination={
            if ($script:scenario -eq 'reuse') { throw 'mock PID reused' }
            $script:scenario -ne 'timeout'
        }
    }
}
$adapter = New-Adapter 'success'
$result = Invoke-TrialRecoveryStateMachine (New-Snapshot) $adapter
Check ($result.State -ceq 'TerminationConfirmed' -and $script:shutdowns -eq 1 -and $script:rotations -eq 1 -and $script:disposed -eq 1) 'complete mocked flow'
foreach ($failure in @('ambiguous','pid','birth','main','files','create','tls','auth','invalidPassword','persist','write','proof','beforeShutdown','shutdown','timeout','reuse')) {
    $adapter = New-Adapter $failure
    $message = ''
    try { $null = Invoke-TrialRecoveryStateMachine (New-Snapshot) $adapter } catch { $message = $_.Exception.Message }
    Check (-not [string]::IsNullOrEmpty($message)) "stop $failure"
    Check ($script:rotations -le 1 -and $script:shutdowns -le 1) "no retry $failure"
    if ($failure -notin @('shutdown','timeout','reuse')) { Check ($script:shutdowns -eq 0) "shutdown blocked $failure" }
    if ($script:rotations -eq 1) { Check ($script:disposed -eq 1) "handle closed $failure" }
    if ($null -ne $script:observedBuffer) {
        Check (@($script:observedBuffer | Where-Object { [int]$_ -ne 0 }).Count -eq 0) "buffer cleared $failure"
    }
    Check ($message -notmatch 'SyntheticCredential|sensitive text') "sanitized failure $failure"
}
Write-Output "Recovery mock assertions passed: $script:cases"
