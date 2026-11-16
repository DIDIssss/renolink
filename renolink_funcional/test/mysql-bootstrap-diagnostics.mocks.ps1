$ErrorActionPreference = 'Stop'
$diagnosticScript = Join-Path $PSScriptRoot '..\scripts\diagnose-mysql-bootstrap-trial.ps1'
$trialParent = 'C:\Users\mock-user'
$trialRoot = Join-Path $trialParent 'RenoLinkBootstrapTrial-0123456789abcdef0123456789abcdef'

. $diagnosticScript -TrialRoot $trialRoot -LibraryOnly
$script:diagnosticAssertions = 0

function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -cne $Expected) {
        throw "$Message (expected '$Expected', got '$Actual')"
    }
    $script:diagnosticAssertions++
}

$configPath = Join-Path $trialRoot 'config\my.ini'
$datadir = Join-Path $trialRoot 'data'
$matchingProcess = [pscustomobject]@{
    ProcessId = [uint32]24680
    ParentProcessId = [uint32]18000
    ExecutablePath = 'D:\MySQL\bin\mysqld.exe'
    CommandLine = "`"D:\MySQL\bin\mysqld.exe`" --defaults-file=`"$configPath`" --datadir=`"$datadir`" --port=33307 --bind-address=127.0.0.1 --mysqlx=OFF"
    CreationDate = '20261101200000.000000-180'
}
$ownedListener = [pscustomobject]@{
    LocalAddress = '127.0.0.1'
    LocalPort = 33307
    OwningProcess = [uint32]24680
}

# Regression: CIM returns DateTime, not localized text or a DMTF string.
$typedProcess = $matchingProcess.PSObject.Copy()
$typedProcess.CreationDate = [datetime]::new(2026, 11, 1, 23, 0, 0, [DateTimeKind]::Utc)
$typedResult = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($typedProcess) -Listeners @($ownedListener)
Assert-Equal $typedResult.Status 'IdentifiedListening' 'Native CIM DateTime must not be parsed through localized text'

$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($matchingProcess) -Listeners @($ownedListener)
Assert-Equal $result.Status 'IdentifiedListening' 'Exact process and listener should be identified'
Assert-Equal $result.ProcessId 24680 'PID should only be reported after command-line identity matches'
Assert-Equal $result.ExecutablePath 'D:\MySQL\bin\mysqld.exe' 'Executable path should be confirmed'
Assert-Equal $result.ListenerAddress '127.0.0.1' 'Listener must be loopback'

$childProcess = [pscustomobject]@{
    ProcessId = [uint32]24681
    ParentProcessId = [uint32]24680
    ExecutablePath = 'D:\MySQL\bin\mysqld.exe'
    CommandLine = "`"D:\MySQL\bin\mysqld.exe`" --defaults-file=`"$configPath`" --datadir=`"$datadir`" --port=33307 --bind-address=127.0.0.1 --mysqlx=OFF"
    CreationDate = '20261101200001.000000-180'
}
$childListener = [pscustomobject]@{
    LocalAddress = '127.0.0.1'
    LocalPort = 33307
    OwningProcess = [uint32]24681
}
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true `
    -Processes @($matchingProcess, $childProcess) -Listeners @($childListener)
Assert-Equal $result.Status 'IdentifiedListening' 'A verified parent-child pair with an exact listener owner should be identified'
Assert-Equal $result.ProcessId 24681 'Listener owner, not merely the tree root, should be selected'
Assert-Equal $result.ProcessStatus 'IdentityMatchedParentChildSet' 'Every member of the pair must independently match identity'
Assert-Equal $result.VerifiedProcessIds.Count 2 'Both individually verified process IDs should be reported'

$unknownChild = [pscustomobject]@{
    ProcessId = [uint32]24682
    ParentProcessId = [uint32]24680
    ExecutablePath = 'C:\Tools\unexpected-mysqld.exe'
    CommandLine = 'unexpected-mysqld.exe'
    CreationDate = '20261101200002.000000-180'
}
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true `
    -Processes @($matchingProcess, $unknownChild) -Listeners @($ownedListener)
Assert-Equal $result.Status 'RelatedUnverifiedProcess' 'An unknown related process must block recovery'

$disconnectedProcess = [pscustomobject]@{
    ProcessId = [uint32]24683
    ParentProcessId = [uint32]17000
    ExecutablePath = 'D:\MySQL\bin\mysqld.exe'
    CommandLine = "`"D:\MySQL\bin\mysqld.exe`" --defaults-file=`"$configPath`" --datadir=`"$datadir`" --port=33307 --bind-address=127.0.0.1 --mysqlx=OFF"
    CreationDate = '20261101200003.000000-180'
}
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true `
    -Processes @($matchingProcess, $disconnectedProcess) -Listeners @($ownedListener)
Assert-Equal $result.Status 'MultipleMatchingProcesses' 'Disconnected processes with matching arguments must not be merged into a trusted tree'

$reusedPidProcess = [pscustomobject]@{
    ProcessId = [uint32]24680
    ParentProcessId = [uint32]18000
    ExecutablePath = 'D:\MySQL\bin\mysqld.exe'
    CommandLine = '"D:\MySQL\bin\mysqld.exe" --defaults-file="D:\MySQL\my.ini" --datadir="D:\MySQL\data" --port=3306'
    CreationDate = '20261101200100.000000-180'
}
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($reusedPidProcess) -Listeners @($ownedListener)
Assert-Equal $result.Status 'PortOccupiedByUnverifiedProcess' 'Reused PID must not be trusted'
Assert-Equal $result.ProcessId $null 'Unverified PID must not be claimed as the trial process'
Assert-Equal $result.ListenerOwnerProcessIds[0] 24680 'Unverified listener owner is reported separately'

$unknownProcess = [pscustomobject]@{
    ProcessId = [uint32]35791
    ParentProcessId = [uint32]1000
    ExecutablePath = 'C:\Tools\other-service.exe'
    CommandLine = 'other-service.exe'
    CreationDate = '20261101200200.000000-180'
}
$otherListener = [pscustomobject]@{
    LocalAddress = '0.0.0.0'
    LocalPort = 33307
    OwningProcess = [uint32]35791
}
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($unknownProcess) -Listeners @($otherListener)
Assert-Equal $result.Status 'PortOccupiedByUnverifiedProcess' 'Unknown listener process must not be claimed'
Assert-Equal $result.ListenerOwnerProcessIds[0] 35791 'Unknown listener PID should be reported as unverified'

$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @() -Listeners @($otherListener)
Assert-Equal $result.Status 'PortOccupiedByUnverifiedProcess' 'Occupied port must be reported without process identity'

$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $false -ConfigValid $false -ProcessSnapshotStable $true -Processes @() -Listeners @()
Assert-Equal $result.Status 'TrialDirectoryMissing' 'Missing directory must be reported'
Assert-Equal $result.ProcessStatus 'NoMatchingTrialProcess' 'No process must be reported for a missing directory'

$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $false -Processes @($matchingProcess) -Listeners @($ownedListener)
Assert-Equal $result.Status 'UnstableProcessSnapshot' 'Process changes during inspection must fail closed'

$invalidStartTime = $matchingProcess.PSObject.Copy()
$invalidStartTime.CreationDate = 'not-a-dmtf-date'
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($invalidStartTime) -Listeners @($ownedListener)
Assert-Equal $result.Status 'PortOccupiedByUnverifiedProcess' 'Invalid process creation time must fail closed'

$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $false -ProcessSnapshotStable $true -Processes @($matchingProcess) -Listeners @($ownedListener)
Assert-Equal $result.Status 'TrialConfigUnverified' 'Unexpected configuration must block process identification'

$result = Get-TrialAssessment -Root 'C:\Users\mock-user\MySQL80' -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($matchingProcess) -Listeners @($ownedListener)
Assert-Equal $result.Status 'InvalidTrialPath' 'Non-trial path must be rejected'

$cultureBefore = [Threading.Thread]::CurrentThread.CurrentCulture
$uiCultureBefore = [Threading.Thread]::CurrentThread.CurrentUICulture
try {
    foreach ($cultureName in @('pt-BR', 'en-US', 'tr-TR')) {
        [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($cultureName)
        [Threading.Thread]::CurrentThread.CurrentUICulture = [Globalization.CultureInfo]::GetCultureInfo($cultureName)
        Assert-Equal (ConvertTo-TrialCreationDate $typedProcess.CreationDate) '2026-11-01T23:00:00.0000000Z' 'DateTime UTC must be invariant'
        Assert-Equal (ConvertTo-TrialCreationDate $matchingProcess.CreationDate) '2026-11-01T23:00:00.0000000Z' 'DMTF offset must preserve its instant'
        $localDate = $typedProcess.CreationDate.ToLocalTime()
        Assert-Equal (ConvertTo-TrialCreationDate $localDate) '2026-11-01T23:00:00.0000000Z' 'Local DateTime must preserve its instant'
        $unspecifiedDate = [datetime]::SpecifyKind($localDate, [DateTimeKind]::Unspecified)
        Assert-Equal (ConvertTo-TrialCreationDate $unspecifiedDate) '2026-11-01T23:00:00.0000000Z' 'Unspecified CIM date is local, never localized text'
        Assert-Equal (ConvertTo-TrialCreationDate ([datetimeoffset]::new($typedProcess.CreationDate))) '2026-11-01T23:00:00.0000000Z' 'DateTimeOffset is an explicit instant'
        $result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
            -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($typedProcess) -Listeners @($ownedListener)
        Assert-Equal $result.Status 'IdentifiedListening' 'Native DateTime process must qualify in every tested culture'
        Assert-Equal $result.CreationDate '2026-11-01T23:00:00.0000000Z' 'Evidence must be UTC ISO 8601'
        $nativeChild = $childProcess.PSObject.Copy()
        $nativeChild.CreationDate = $typedProcess.CreationDate.AddSeconds(1)
        $pair = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
            -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($typedProcess, $nativeChild) -Listeners @($childListener)
        Assert-Equal $pair.Status 'IdentifiedListening' 'Both native CIM dates must qualify independently'
        Assert-Equal $pair.ProcessId 24681 'Native dates must select the listener child, not its parent'
        Assert-Equal $pair.VerifiedProcesses[0].CreationDate '2026-11-01T23:00:00.0000000Z' 'Parent evidence must be invariant'
        Assert-Equal $pair.VerifiedProcesses[1].CreationDate '2026-11-01T23:00:01.0000000Z' 'Child evidence must be invariant'
    }
} finally {
    [Threading.Thread]::CurrentThread.CurrentCulture = $cultureBefore
    [Threading.Thread]::CurrentThread.CurrentUICulture = $uiCultureBefore
}

foreach ($invalidDate in @($null, '', '11/01/2026 21:18:32', '01/11/2026 21:18:32', '2026-11-01T23:00:00Z', '20261101200000.******-180', '20261301200000.000000-180', [datetime]::MinValue, 123)) {
    Assert-Equal (Test-ValidCreationDate $invalidDate) $false 'Ambiguous, absent or invalid creation evidence must fail closed'
}
Assert-Equal (Test-StableTrialProcessSnapshot @($matchingProcess) @($typedProcess)) $true 'Equivalent DMTF and DateTime instants must compare equal'
$changed = $typedProcess.PSObject.Copy(); $changed.CreationDate = $typedProcess.CreationDate.AddTicks(1)
Assert-Equal (Test-StableTrialProcessSnapshot @($typedProcess) @($changed)) $false 'Same PID with changed subsecond creation must be rejected'
$changed = $typedProcess.PSObject.Copy(); $changed.ParentProcessId++
Assert-Equal (Test-StableTrialProcessSnapshot @($typedProcess) @($changed)) $false 'Parent identity must be stable'
$changed = $typedProcess.PSObject.Copy(); $changed.CommandLine = 'different'
Assert-Equal (Test-StableTrialProcessSnapshot @($typedProcess) @($changed)) $false 'Changed arguments must invalidate snapshot'
Assert-Equal (Test-StableTrialProcessSnapshot @($typedProcess, $typedProcess) @($typedProcess, $changed)) $false 'Duplicate PID evidence is ambiguous'

$earlyChild = $childProcess.PSObject.Copy(); $earlyChild.CreationDate = $typedProcess.CreationDate.AddSeconds(-1)
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($typedProcess, $earlyChild) -Listeners @($childListener)
Assert-Equal $result.Status 'RelatedUnverifiedProcess' 'A parent newer than its child cannot establish process identity'
Assert-Equal $result.VerifiedProcessIds.Count 0 'Temporal mismatch must never produce verified PIDs'
$unknownTimeChild = $childProcess.PSObject.Copy(); $unknownTimeChild.CreationDate = $null
$result = Get-TrialAssessment -Root $trialRoot -ExpectedParent $trialParent `
    -DirectoryExists $true -ConfigValid $true -ProcessSnapshotStable $true -Processes @($matchingProcess, $unknownTimeChild) -Listeners @($childListener)
Assert-Equal $result.Status 'RelatedUnverifiedProcess' 'A related child without creation evidence cannot be accepted'

Write-Output "Diagnostic mock cases passed; assertions: $script:diagnosticAssertions. No host processes, listeners or databases queried."
