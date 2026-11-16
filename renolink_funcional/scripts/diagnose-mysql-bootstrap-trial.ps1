[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TrialRoot,
    [switch]$LibraryOnly
)

$ErrorActionPreference = 'Stop'
$expectedExecutable = 'D:\MySQL\bin\mysqld.exe'
$expectedPort = 33307

function Test-NormalizedCommandLineContains([string]$CommandLine, [string]$Expected) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }
    $separator = $Expected.IndexOf('=')
    if ($separator -lt 0) {
        return $false
    }
    $option = [regex]::Escape($Expected.Substring(0, $separator))
    $expectedValue = $Expected.Substring($separator + 1).Replace('/', '\')
    if ($expectedValue.Length -ge 2 -and $expectedValue.StartsWith('"') -and $expectedValue.EndsWith('"')) {
        $expectedValue = $expectedValue.Substring(1, $expectedValue.Length - 2)
    }
    $value = [regex]::Escape($expectedValue)
    $pattern = "(?i)(?:^|\s)$option=(?:`"$value`"|$value)(?=\s|$)"
    return [regex]::IsMatch($CommandLine.Replace('/', '\'), $pattern)
}

function ConvertTo-TrialCreationDate([object]$CreationDate) {
    try {
        if ($CreationDate -is [datetime]) {
            $date = $CreationDate
        } elseif ($CreationDate -is [datetimeoffset]) {
            $date = $CreationDate.UtcDateTime
        } elseif ($CreationDate -is [string] -and
            $CreationDate -cmatch '^\d{14}\.\d{6}[+-]\d{3}$') {
            $date = [Management.ManagementDateTimeConverter]::ToDateTime($CreationDate)
        } else {
            return $null
        }
        if ($date -eq [datetime]::MinValue -or $date -eq [datetime]::MaxValue) {
            return $null
        }
        # CIM DateTime is local or UTC. Never round-trip through regional text.
        return $date.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    } catch {
        return $null
    }
}

function Test-ValidCreationDate([object]$CreationDate) {
    return $null -ne (ConvertTo-TrialCreationDate $CreationDate)
}

function Test-StableTrialProcessSnapshot {
    param([AllowEmptyCollection()][object[]]$Before, [AllowEmptyCollection()][object[]]$After)
    if ($Before.Count -ne $After.Count) { return $false }
    if (@($Before | ForEach-Object { [uint32]$_.ProcessId } | Sort-Object -Unique).Count -ne $Before.Count -or
        @($After | ForEach-Object { [uint32]$_.ProcessId } | Sort-Object -Unique).Count -ne $After.Count) { return $false }
    foreach ($process in $Before) {
        $created = ConvertTo-TrialCreationDate $process.CreationDate
        if ($null -eq $created) { return $false }
        $same = @($After | Where-Object {
            [uint32]$_.ProcessId -eq [uint32]$process.ProcessId -and
            [uint32]$_.ParentProcessId -eq [uint32]$process.ParentProcessId -and
            (ConvertTo-TrialCreationDate $_.CreationDate) -ceq $created -and
            [string]$_.ExecutablePath -ceq [string]$process.ExecutablePath -and
            [string]$_.CommandLine -ceq [string]$process.CommandLine
        })
        if ($same.Count -ne 1) { return $false }
    }
    return $true
}

function Test-TrialConfiguration([string]$ConfigPath, [string]$Datadir) {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        return $false
    }
    $trialRoot = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($ConfigPath))
    foreach ($path in @($ConfigPath, (Split-Path -Parent $ConfigPath), $trialRoot, $Datadir)) {
        if (-not (Test-Path -LiteralPath $path)) {
            return $false
        }
        $item = Get-Item -LiteralPath $path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            return $false
        }
    }
    if (-not (Get-Item -LiteralPath $Datadir -Force).PSIsContainer) {
        return $false
    }
    $expectedEntries = @{
        'basedir' = 'D:/MySQL'
        'datadir' = $Datadir.Replace('\', '/')
        'port' = '33307'
        'bind-address' = '127.0.0.1'
        'mysqlx' = 'OFF'
        'require_secure_transport' = 'ON'
        'ssl-cert' = (Join-Path $trialRoot 'certs\valid.cert.pem').Replace('\', '/')
        'ssl-key' = (Join-Path $trialRoot 'certs\valid.key.pem').Replace('\', '/')
        'log-error' = (Join-Path $trialRoot 'secrets\initialize.err').Replace('\', '/')
        'general-log' = 'OFF'
    }
    $actualEntries = @{}
    $sectionSeen = $false
    foreach ($line in [IO.File]::ReadAllLines($ConfigPath)) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or $trimmed.StartsWith(';')) {
            continue
        }
        if ($trimmed -match '^\[([^\]]+)\]$') {
            if ($sectionSeen -or $Matches[1] -ine 'mysqld') {
                return $false
            }
            $sectionSeen = $true
            continue
        }
        if (-not $sectionSeen -or $trimmed -match '^!include(?:dir)?\b' -or
            $trimmed -notmatch '^([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$') {
            return $false
        }
        $key = $Matches[1].ToLowerInvariant()
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
            $value = $value.Substring(1, $value.Length - 2)
        } elseif ($value.Contains('"')) {
            return $false
        }
        if ($actualEntries.ContainsKey($key)) {
            return $false
        }
        $actualEntries[$key] = $value
    }
    if (-not $sectionSeen -or $actualEntries.Count -ne $expectedEntries.Count) {
        return $false
    }
    foreach ($key in $expectedEntries.Keys) {
        if (-not $actualEntries.ContainsKey($key) -or
            -not [string]::Equals([string]$actualEntries[$key], [string]$expectedEntries[$key], [StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
    }
    return $true
}

function Get-TrialAssessment {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedParent,
        [Parameter(Mandatory = $true)]
        [bool]$DirectoryExists,
        [Parameter(Mandatory = $true)]
        [bool]$ConfigValid,
        [Parameter(Mandatory = $true)]
        [bool]$ProcessSnapshotStable,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Processes,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [object[]]$Listeners
    )

    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $parentPath = [IO.Path]::GetFullPath($ExpectedParent).TrimEnd('\')
    $actualParent = [IO.Path]::GetDirectoryName($rootPath)
    $leaf = [IO.Path]::GetFileName($rootPath)
    if (-not $actualParent.Equals($parentPath, [StringComparison]::OrdinalIgnoreCase) -or
        $leaf -notmatch '^RenoLinkBootstrapTrial-[0-9a-f]{32}$') {
        return [pscustomobject]@{
            Status = 'InvalidTrialPath'
            DirectoryExists = $DirectoryExists
            ConfigStatus = 'NotChecked'
            ProcessStatus = 'NotChecked'
            ListenerStatus = 'NotChecked'
            ProcessId = $null
            ListenerOwnerProcessIds = @()
            ExecutablePath = $null
            CreationDate = $null
            ConfigPath = $null
            Datadir = $null
            ListenerAddress = $null
            VerifiedProcessIds = @()
        }
    }

    $configPath = Join-Path $rootPath 'config\my.ini'
    $datadir = Join-Path $rootPath 'data'
    if (-not $DirectoryExists -and $Processes.Count -eq 0 -and
        @($Listeners | Where-Object { [int]$_.LocalPort -eq $expectedPort }).Count -eq 0) {
        return [pscustomobject]@{
            Status = 'TrialDirectoryMissing'
            DirectoryExists = $false
            ConfigStatus = 'Missing'
            ProcessStatus = 'NoMatchingTrialProcess'
            ListenerStatus = 'NotListening'
            ProcessId = $null
            ListenerOwnerProcessIds = @()
            ExecutablePath = $null
            CreationDate = $null
            ConfigPath = $configPath
            Datadir = $datadir
            ListenerAddress = $null
            VerifiedProcessIds = @()
        }
    }
    if (-not $ConfigValid) {
        return [pscustomobject]@{
            Status = 'TrialConfigUnverified'
            DirectoryExists = $DirectoryExists
            ConfigStatus = 'MissingOrUnexpected'
            ProcessStatus = 'NotChecked'
            ListenerStatus = 'NotTrusted'
            ProcessId = $null
            ListenerOwnerProcessIds = @(
                $Listeners | Where-Object { [int]$_.LocalPort -eq $expectedPort } |
                    ForEach-Object { [uint32]$_.OwningProcess } | Sort-Object -Unique
            )
            ExecutablePath = $null
            CreationDate = $null
            ConfigPath = $configPath
            Datadir = $datadir
            ListenerAddress = $null
            VerifiedProcessIds = @()
        }
    }
    if (-not $ProcessSnapshotStable) {
        return [pscustomobject]@{
            Status = 'UnstableProcessSnapshot'
            DirectoryExists = $DirectoryExists
            ConfigStatus = 'ExactTrialConfiguration'
            ProcessStatus = 'ChangedDuringDiagnostic'
            ListenerStatus = 'NotTrusted'
            ProcessId = $null
            ListenerOwnerProcessIds = @(
                $Listeners | Where-Object { [int]$_.LocalPort -eq $expectedPort } |
                    ForEach-Object { [uint32]$_.OwningProcess } | Sort-Object -Unique
            )
            ExecutablePath = $null
            CreationDate = $null
            ConfigPath = $configPath
            Datadir = $datadir
            ListenerAddress = $null
            VerifiedProcessIds = @()
        }
    }

    $qualifiedProcesses = @(
        $Processes | Where-Object {
            $executable = [string]$_.ExecutablePath
            $commandLine = [string]$_.CommandLine
            $sameExecutable = $false
            $validCreationDate = Test-ValidCreationDate $_.CreationDate
            if (-not [string]::IsNullOrWhiteSpace($executable)) {
                try {
                    $sameExecutable = [IO.Path]::GetFullPath($executable).Equals(
                        [IO.Path]::GetFullPath($expectedExecutable),
                        [StringComparison]::OrdinalIgnoreCase
                    )
                } catch {
                    $sameExecutable = $false
                }
            }
            $validCreationDate -and $sameExecutable -and
                (Test-NormalizedCommandLineContains $commandLine "--defaults-file=`"$configPath`"") -and
                (Test-NormalizedCommandLineContains $commandLine "--datadir=`"$datadir`"") -and
                (Test-NormalizedCommandLineContains $commandLine "--port=$expectedPort") -and
                (Test-NormalizedCommandLineContains $commandLine '--bind-address=127.0.0.1') -and
                (Test-NormalizedCommandLineContains $commandLine '--mysqlx=OFF')
        }
    )
    $trialListeners = @(
        $Listeners | Where-Object { [int]$_.LocalPort -eq $expectedPort }
    )
    $listenerOwnerIds = @(
        $trialListeners | ForEach-Object { [uint32]$_.OwningProcess } | Sort-Object -Unique
    )

    $qualifiedById = @{}
    foreach ($process in $qualifiedProcesses) {
        $qualifiedById[[uint32]$process.ProcessId] = $process
    }
    $invalidParentChildOrder = $false
    foreach ($process in $qualifiedProcesses) {
        $parent = $qualifiedById[[uint32]$process.ParentProcessId]
        if ($parent -and [string]::CompareOrdinal(
                (ConvertTo-TrialCreationDate $parent.CreationDate),
                (ConvertTo-TrialCreationDate $process.CreationDate)) -gt 0) {
            $invalidParentChildOrder = $true
        }
    }
    $relatedProcesses = @()
    if ($qualifiedProcesses.Count -gt 0) {
        $relatedIds = @{}
        foreach ($process in $qualifiedProcesses) {
            $relatedIds[[uint32]$process.ProcessId] = $true
        }
        $changed = $true
        while ($changed) {
            $changed = $false
            foreach ($process in $Processes) {
                $processId = [uint32]$process.ProcessId
                $parentId = [uint32]$process.ParentProcessId
                if (-not $relatedIds.ContainsKey($processId) -and $relatedIds.ContainsKey($parentId)) {
                    $relatedIds[$processId] = $true
                    $changed = $true
                }
                if (-not $relatedIds.ContainsKey($parentId) -and $relatedIds.ContainsKey($processId)) {
                    $relatedIds[$parentId] = $true
                    $changed = $true
                }
            }
        }
        $relatedProcesses = @(
            $Processes | Where-Object {
                $relatedIds.ContainsKey([uint32]$_.ProcessId) -and
                    -not $qualifiedById.ContainsKey([uint32]$_.ProcessId)
            }
        )
    }
    if ($relatedProcesses.Count -gt 0 -or $invalidParentChildOrder) {
        return [pscustomobject]@{
            Status = 'RelatedUnverifiedProcess'
            DirectoryExists = $DirectoryExists
            ConfigStatus = 'ExactTrialConfiguration'
            ProcessStatus = if ($invalidParentChildOrder) { 'InvalidParentChildCreationOrder' } else { 'UnverifiedRelatedProcess' }
            ListenerStatus = if ($trialListeners.Count) { 'PortOccupied' } else { 'NotListening' }
            ProcessId = $null
            ListenerOwnerProcessIds = $listenerOwnerIds
            ExecutablePath = $null
            CreationDate = $null
            ConfigPath = $configPath
            Datadir = $datadir
            ListenerAddress = $null
            VerifiedProcessIds = @()
        }
    }

    if ($qualifiedProcesses.Count -gt 0 -and $trialListeners.Count -gt 0) {
        $ownerIds = @($trialListeners | ForEach-Object { [uint32]$_.OwningProcess } | Sort-Object -Unique)
        $owner = $null
        if ($trialListeners.Count -eq 1 -and $ownerIds.Count -eq 1) {
            $owner = $qualifiedById[[uint32]$ownerIds[0]]
        }
        $connectedIds = @{}
        if ($owner) {
            $connectedIds[[uint32]$owner.ProcessId] = $true
            $connected = $true
            while ($connected) {
                $connected = $false
                foreach ($process in $qualifiedProcesses) {
                    $processId = [uint32]$process.ProcessId
                    $parentId = [uint32]$process.ParentProcessId
                    if ($connectedIds.ContainsKey($parentId) -and -not $connectedIds.ContainsKey($processId)) {
                        $connectedIds[$processId] = $true
                        $connected = $true
                    }
                    if ($connectedIds.ContainsKey($processId) -and
                        $qualifiedById.ContainsKey($parentId) -and
                        -not $connectedIds.ContainsKey($parentId)) {
                        $connectedIds[$parentId] = $true
                        $connected = $true
                    }
                }
            }
        }
        $allQualifiedConnected = $owner -and $qualifiedProcesses.Count -eq $connectedIds.Count
        if ($owner -and
            $allQualifiedConnected -and
            [string]$trialListeners[0].LocalAddress -eq '127.0.0.1' -and
            (Test-ValidCreationDate $owner.CreationDate)) {
            $orderedProcesses = @($qualifiedProcesses | Sort-Object { [uint32]$_.ProcessId })
            $verifiedIds = @($orderedProcesses | ForEach-Object { [uint32]$_.ProcessId })
            return [pscustomobject]@{
                Status = if ($DirectoryExists) { 'IdentifiedListening' } else { 'IdentifiedButDirectoryMissing' }
                DirectoryExists = $DirectoryExists
                ConfigStatus = 'ExactTrialConfiguration'
                ProcessStatus = if ($orderedProcesses.Count -gt 1) { 'IdentityMatchedParentChildSet' } else { 'IdentityMatched' }
                ListenerStatus = 'OwnedLoopbackListener'
                ProcessId = [uint32]$owner.ProcessId
                ListenerOwnerProcessIds = $listenerOwnerIds
                ExecutablePath = [IO.Path]::GetFullPath([string]$owner.ExecutablePath)
                CreationDate = ConvertTo-TrialCreationDate $owner.CreationDate
                ConfigPath = $configPath
                Datadir = $datadir
                ListenerAddress = [string]$trialListeners[0].LocalAddress
                VerifiedProcessIds = $verifiedIds
                VerifiedProcesses = @(
                    $orderedProcesses | ForEach-Object {
                        [pscustomobject]@{
                            ProcessId = [uint32]$_.ProcessId
                            ParentProcessId = [uint32]$_.ParentProcessId
                            ExecutablePath = [IO.Path]::GetFullPath([string]$_.ExecutablePath)
                            CreationDate = ConvertTo-TrialCreationDate $_.CreationDate
                        }
                    }
                )
            }
        }
    }

    if ($qualifiedProcesses.Count -gt 1) {
        return [pscustomobject]@{
            Status = 'MultipleMatchingProcesses'
            DirectoryExists = $DirectoryExists
            ConfigStatus = 'ExactTrialConfiguration'
            ProcessStatus = 'Ambiguous'
            ListenerStatus = if ($trialListeners.Count) { 'PortOccupied' } else { 'NotListening' }
            ProcessId = $null
            ListenerOwnerProcessIds = $listenerOwnerIds
            ExecutablePath = $expectedExecutable
            CreationDate = $null
            ConfigPath = $configPath
            Datadir = $datadir
            ListenerAddress = $null
            VerifiedProcessIds = @()
        }
    }

    if ($qualifiedProcesses.Count -eq 1) {
        $process = $qualifiedProcesses[0]
        $processListeners = @(
            $trialListeners | Where-Object { [uint32]$_.OwningProcess -eq [uint32]$process.ProcessId }
        )
        $otherListeners = @(
            $trialListeners | Where-Object { [uint32]$_.OwningProcess -ne [uint32]$process.ProcessId }
        )
        if ($processListeners.Count -eq 0 -and $otherListeners.Count -gt 0) {
            $status = 'IdentifiedProcessButPortOwnedByOther'
            $listenerStatus = 'OccupiedByOtherProcess'
            $listenerAddress = $null
        } elseif ($processListeners.Count -eq 0) {
            $status = if ($DirectoryExists) { 'IdentifiedNotListening' } else { 'IdentifiedButDirectoryMissing' }
            $listenerStatus = 'NotListening'
            $listenerAddress = $null
        } else {
            $status = 'IdentifiedProcessButUnexpectedListener'
            $listenerStatus = 'UnexpectedAddressOrMultipleListeners'
            $listenerAddress = [string]$processListeners[0].LocalAddress
        }
        return [pscustomobject]@{
            Status = $status
            DirectoryExists = $DirectoryExists
            ConfigStatus = 'ExactTrialConfiguration'
            ProcessStatus = 'IdentityMatched'
            ListenerStatus = $listenerStatus
            ProcessId = [uint32]$process.ProcessId
            ListenerOwnerProcessIds = $listenerOwnerIds
            ExecutablePath = [IO.Path]::GetFullPath([string]$process.ExecutablePath)
            CreationDate = ConvertTo-TrialCreationDate $process.CreationDate
            ConfigPath = $configPath
            Datadir = $datadir
            ListenerAddress = $listenerAddress
            VerifiedProcessIds = @([uint32]$process.ProcessId)
        }
    }

    if ($trialListeners.Count -gt 0) {
        return [pscustomobject]@{
            Status = 'PortOccupiedByUnverifiedProcess'
            DirectoryExists = $DirectoryExists
            ConfigStatus = 'ExactTrialConfiguration'
            ProcessStatus = 'NoTrialProcessIdentityMatch'
            ListenerStatus = 'OccupiedByUnverifiedProcess'
            ProcessId = $null
            ListenerOwnerProcessIds = $listenerOwnerIds
            ExecutablePath = $null
            CreationDate = $null
            ConfigPath = $configPath
            Datadir = $datadir
            ListenerAddress = $null
            VerifiedProcessIds = @()
        }
    }

    $status = if ($DirectoryExists) { 'NoMatchingTrialProcess' } else { 'TrialDirectoryMissing' }
    return [pscustomobject]@{
        Status = $status
        DirectoryExists = $DirectoryExists
        ConfigStatus = 'ExactTrialConfiguration'
        ProcessStatus = 'NoMatchingTrialProcess'
        ListenerStatus = 'NotListening'
        ProcessId = $null
        ListenerOwnerProcessIds = @()
        ExecutablePath = $null
        CreationDate = $null
        ConfigPath = $configPath
        Datadir = $datadir
        ListenerAddress = $null
        VerifiedProcessIds = @()
    }
}

if ($LibraryOnly) {
    return
}

$profilePath = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
$trialPath = [IO.Path]::GetFullPath($TrialRoot).TrimEnd('\')
$trialParentPath = [IO.Path]::GetDirectoryName($trialPath)
$trialLeaf = [IO.Path]::GetFileName($trialPath)
if (-not $trialParentPath.Equals($profilePath, [StringComparison]::OrdinalIgnoreCase) -or
    $trialLeaf -notmatch '^RenoLinkBootstrapTrial-[0-9a-f]{32}$') {
    throw 'Caminho invalido: informe somente a pasta GUID do ensaio no perfil atual.'
}

$directoryExists = $false
$trialItem = $null
try {
    $trialItem = Get-Item -LiteralPath $trialPath -Force -ErrorAction Stop
    if (-not $trialItem.PSIsContainer) {
        throw 'O caminho informado existe, mas nao e um diretorio de ensaio.'
    }
    $directoryExists = $true
} catch {
    if ($_.CategoryInfo.Category -ne [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
        throw
    }
}
if ($directoryExists) {
    if (($trialItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'A pasta informada e um reparse point; diagnostico bloqueado.'
    }
}

function Get-MySqlProcessSnapshot {
    return @(
    Get-CimInstance Win32_Process -Filter "Name='mysqld.exe'" -ErrorAction Stop |
        ForEach-Object {
            [pscustomobject]@{
                ProcessId = [uint32]$_.ProcessId
                ParentProcessId = [uint32]$_.ParentProcessId
                ExecutablePath = [string]$_.ExecutablePath
                CommandLine = [string]$_.CommandLine
                CreationDate = $_.CreationDate
            }
        }
    )
}

function Get-TrialListenerSnapshot {
    return @(
    Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -eq $expectedPort } |
        ForEach-Object {
            [pscustomobject]@{
                LocalAddress = [string]$_.LocalAddress
                LocalPort = [int]$_.LocalPort
                OwningProcess = [uint32]$_.OwningProcess
            }
        }
)
}

$configPath = Join-Path $trialPath 'config\my.ini'
$datadir = Join-Path $trialPath 'data'
$configValid = if ($directoryExists) {
Test-TrialConfiguration $configPath $datadir
} else {
$false
}
$processesBefore = Get-MySqlProcessSnapshot
$listenersBefore = Get-TrialListenerSnapshot
$processesAfter = Get-MySqlProcessSnapshot
$listenersAfter = Get-TrialListenerSnapshot
$stableProcessSnapshot = Test-StableTrialProcessSnapshot -Before $processesBefore -After $processesAfter
$stableListenerSnapshot = $listenersBefore.Count -eq $listenersAfter.Count
if ($stableListenerSnapshot) {
    foreach ($listener in $listenersBefore) {
        $sameListener = @(
            $listenersAfter | Where-Object {
                [int]$_.LocalPort -eq [int]$listener.LocalPort -and
                    [string]$_.LocalAddress -ceq [string]$listener.LocalAddress -and
                    [uint32]$_.OwningProcess -eq [uint32]$listener.OwningProcess
            }
        )
        if ($sameListener.Count -ne 1) {
            $stableListenerSnapshot = $false
            break
        }
    }
}

$assessment = Get-TrialAssessment `
        -Root $trialPath `
        -ExpectedParent $profilePath `
        -DirectoryExists $directoryExists `
        -ConfigValid $configValid `
        -ProcessSnapshotStable ($stableProcessSnapshot -and $stableListenerSnapshot) `
        -Processes $processesAfter `
    -Listeners $listenersAfter
$assessment | ConvertTo-Json -Depth 3
