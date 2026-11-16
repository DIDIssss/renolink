# Pure validation library. No client, file creation, service or process operations.
Set-StrictMode -Version 2

function ConvertFrom-TrialRotationResponse {
    param([int]$ExitCode, [AllowEmptyString()][string]$Output)
    if ($ExitCode -ne 0 -or [string]::IsNullOrEmpty($Output)) {
        throw 'RotationUnconfirmed: do not retry or reuse the old credential.'
    }
    # Exactly one record, with at most one terminal newline. Never echo input.
    $record = [regex]::Replace($Output, '\r?\n\z', '')
    if ($record -match '[\r\n]') { throw 'UnexpectedRotationResponse' }
    $columns = $record.Split([char]9)
    try {
        if ($columns.Count -ne 4 -or $columns[0] -cne 'root' -or
            $columns[1] -cne 'localhost' -or $columns[3] -cne '1') {
            throw 'UnexpectedRotationResponse'
        }
        # Exact MySQL 8.0.46 alphabet. Server supports 5..255, but recovery
        # refuses less than its default 20-character strength, without changing policy.
        $alphabet = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,.-;:_+*!%&/(){}[]<>@'
        if ($columns[2].Length -lt 20 -or $columns[2].Length -gt 255) {
            throw 'InvalidGeneratedCredential'
        }
        foreach ($character in $columns[2].ToCharArray()) {
            if ($alphabet.IndexOf($character) -lt 0) { throw 'InvalidGeneratedCredential' }
        }
        # Suppress automatic output: caller must provide a local assignment.
        return ,([char[]]$columns[2].ToCharArray())
    } finally {
        $columns = $null
        $record = $null
        $Output = $null
    }
}

function ConvertTo-TrialExactPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path) -or
        $Path -notmatch '^[A-Za-z]:[\\/]' -or $Path -match '[\x00-\x1f*?]' -or
        $Path.Substring(2).Contains(':') -or $Path -match '(?:^|[\\/])\.{1,2}(?:[\\/]|$)' -or
        $Path -match '[. ](?:[\\/]|$)') { throw 'AmbiguousPath' }
    return [IO.Path]::GetFullPath($Path.Replace('/', '\')).TrimEnd('\')
}

function Assert-TrialAuthenticatedProof {
    param([int]$ExitCode, [string]$Output, [string]$ExpectedDatadir)
    if ($ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($Output)) { throw 'ProofFailed' }
    $record = [regex]::Replace($Output, '\r?\n\z', '')
    $rows = [regex]::Split($record, '\r?\n')
    if ($rows.Count -ne 2) { throw 'UnexpectedProofResponse' }
    $identity = $rows[0].Split([char]9)
    $tls = $rows[1].Split([char]9)
    if ($identity.Count -ne 5 -or $tls.Count -ne 2 -or
        $identity[1] -cne '33307' -or $identity[3] -cne '8.0.46' -or
        $identity[4] -cne 'root@localhost' -or
        $identity[2] -notmatch '^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' -or
        $identity[2] -eq '00000000-0000-0000-0000-000000000000' -or
        $tls[0] -cne 'Ssl_cipher' -or $tls[1] -cnotmatch '^[A-Z0-9][A-Za-z0-9_-]{1,127}$' -or
        (ConvertTo-TrialExactPath $identity[0]) -ine (ConvertTo-TrialExactPath $ExpectedDatadir)) {
        throw 'InstanceProofMismatch'
    }
    return $true
}

function Get-TrialRecoveryFingerprint($Snapshot) {
    if ($Snapshot.Status -cne 'IdentifiedListening' -or
        $Snapshot.ConfigStatus -cne 'ExactTrialConfiguration' -or
        $Snapshot.ProcessStatus -cne 'IdentityMatchedParentChildSet' -or
        $Snapshot.ListenerStatus -cne 'OwnedLoopbackListener' -or
        $Snapshot.ListenerAddress -cne '127.0.0.1' -or
        @($Snapshot.VerifiedProcesses).Count -ne 2) { throw 'UnverifiedIdentity' }
    $root = 'C:\Users\diego\RenoLinkBootstrapTrial-e5536b82f7274ceca2c200503c1339b9'
    if ((ConvertTo-TrialExactPath $Snapshot.ConfigPath) -ine "$root\config\my.ini" -or
        (ConvertTo-TrialExactPath $Snapshot.Datadir) -ine "$root\data") { throw 'WrongTrial' }
    $processes = @($Snapshot.VerifiedProcesses | Sort-Object { [uint32]$_.ProcessId })
    $seen = @{}
    foreach ($process in $processes) {
        $date = [datetimeoffset]::MinValue
        if ([uint32]$process.ProcessId -eq 0 -or $seen.ContainsKey([uint32]$process.ProcessId) -or
            $process.CreationDate -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$' -or
            -not [datetimeoffset]::TryParseExact($process.CreationDate, "yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'",
                [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$date) -or
            (ConvertTo-TrialExactPath $process.ExecutablePath) -ine 'D:\MySQL\bin\mysqld.exe') {
            throw 'InvalidProcessIdentity'
        }
        $seen[[uint32]$process.ProcessId] = $true
    }
    $owner = @($processes | Where-Object { $_.ProcessId -eq $Snapshot.ProcessId })
    if ($owner.Count -ne 1 -or
        @($Snapshot.VerifiedProcessIds).Count -ne 2 -or
        (@($Snapshot.VerifiedProcessIds | Sort-Object { [uint32]$_ }) -join ',') -cne
            (@($processes | ForEach-Object { $_.ProcessId }) -join ',') -or
        @($processes | Where-Object { $seen.ContainsKey([uint32]$_.ParentProcessId) }).Count -ne 1) {
        throw 'InvalidProcessSet'
    }
    return ([ordered]@{
        Owner = [uint32]$Snapshot.ProcessId
        Config = ConvertTo-TrialExactPath $Snapshot.ConfigPath
        Datadir = ConvertTo-TrialExactPath $Snapshot.Datadir
        Processes = @($processes | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate)
    } | ConvertTo-Json -Depth 5 -Compress)
}

function Invoke-TrialRecoveryStateMachine {
    # Internal orchestration for adapters. Not an operational entry point.
    # Windows adapter is supplied only by the explicitly gated entry point.
    param([Parameter(Mandatory=$true)]$ApprovedSnapshot,
          [Parameter(Mandatory=$true)][hashtable]$Adapter)
    $state = 'NotStarted'
    $rotationMayHaveOccurred = $false
    $shutdownSent = $false
    $privateHandle = $null
    $password = $null
    $approvedFingerprint = Get-TrialRecoveryFingerprint $ApprovedSnapshot
    function Assert-Gates {
        $current = & $Adapter.Identity
        if ((Get-TrialRecoveryFingerprint $current) -cne $approvedFingerprint) { throw 'IdentityChanged' }
        if ((& $Adapter.MainUnchanged) -ne $true) { throw 'MYSQL80Changed' }
    }
    try {
        Assert-Gates
        $state = 'IdentityValidated'
        if ((& $Adapter.ValidateFiles) -ne $true) { throw 'FilesNotValidated' }
        $state = 'DestinationFilesValidated'
        Assert-Gates
        $privateHandle = & $Adapter.PreparePrivateFile
        if ($null -eq $privateHandle) { throw 'PrivateFileNotPrepared' }
        $state = 'PrivateFilePrepared'
        Assert-Gates
        $rotationMayHaveOccurred = $true
        $response = & $Adapter.Rotate
        $password = ConvertFrom-TrialRotationResponse $response.ExitCode $response.Output
        $response = $null
        $state = 'RotationCompleted'
        Assert-Gates
        if ((& $Adapter.Persist $privateHandle $password) -ne $true) { throw 'CredentialNotPersisted' }
        $state = 'CredentialPersisted'
        [Array]::Clear($password, 0, $password.Length)
        $password = $null
        Assert-Gates
        $proof = & $Adapter.Prove
        $null = Assert-TrialAuthenticatedProof $proof.ExitCode $proof.Output $ApprovedSnapshot.Datadir
        $proof = $null
        $state = 'AuthenticatedProofApproved'
        Assert-Gates
        $state = 'IdentityRevalidated'
        $shutdownSent = $true
        $state = 'ShutdownRequested'
        if ((& $Adapter.Shutdown) -ne 0) { throw 'ShutdownUnconfirmed' }
        # Adapter must implement bounded Windows-only exit/listener/PID-reuse checks.
        if ((& $Adapter.ConfirmTermination $ApprovedSnapshot) -ne $true) { throw 'TerminationUnconfirmed' }
        if ((& $Adapter.MainUnchanged) -ne $true) { throw 'MYSQL80Changed' }
        $state = 'TerminationConfirmed'
        return [pscustomobject]@{ State=$state; ShutdownRequests=1 }
    } catch {
        # Never propagate native output or an exception potentially containing a secret.
        throw "RecoveryStopped: State=$state; RotationMayHaveOccurred=$rotationMayHaveOccurred; ShutdownSent=$shutdownSent. No automatic retry."
    } finally {
        if ($null -ne $password) { [Array]::Clear($password, 0, $password.Length) }
        $response = $null
        $proof = $null
        if ($null -ne $privateHandle) {
            try { $privateHandle.Dispose() } catch { throw 'RecoveryStopped: private handle disposal failed. No automatic retry.' }
        }
    }
}
