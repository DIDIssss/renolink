# Explicitly authorized removal of this one RenoLink lock. No migration.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$databasePath = Join-Path $projectRoot 'data/runtime/db.json'
$originalPath = Join-Path $projectRoot 'data/db.json'
$lockPath = $databasePath + '.lock'
$expectedJsonHash = '7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676'
$expectedLockHash = '751965f4d8a6e3fe5fa61c1df1cf71bfb2699dc391ae5dd9e94df1b93a35bf12'
$evidence = (. (Join-Path $PSScriptRoot 'diagnose-json-lock.ps1')) | ConvertFrom-Json
if (-not $evidence.OrphanEvidenceConfirmed -or $evidence.First.RecordedPid -ne 10500 -or $evidence.Second.RecordedPid -ne 10500) {
    throw 'Safety condition failed: the lock is not confirmed orphaned. Nothing removed.'
}
foreach ($sample in @($evidence.First, $evidence.Second)) {
    $json = @($sample.Files | Where-Object Name -eq 'db.json')
    $marker = @($sample.Files | Where-Object Name -eq 'db.json.lock')
    if ($json.Count -ne 1 -or $marker.Count -ne 1 -or
        $json[0].Sha256 -ne $expectedJsonHash -or $json[0].Length -ne 7690 -or
        ([DateTimeOffset]::Parse($json[0].LastWriteTimeUtc)).UtcDateTime -ne ([DateTimeOffset]::Parse('2026-10-24T02:55:16.8555133Z')).UtcDateTime -or
        $marker[0].Sha256 -ne $expectedLockHash -or $marker[0].Length -ne 5 -or
        ([DateTimeOffset]::Parse($marker[0].LastWriteTimeUtc)).UtcDateTime -ne ([DateTimeOffset]::Parse('2026-10-24T02:55:31.8446792Z')).UtcDateTime) {
        throw 'Files differ from the previously approved evidence. Nothing removed.'
    }
}
$resolvedLock = (Resolve-Path -LiteralPath $lockPath).ProviderPath
$expectedPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'data/runtime/db.json.lock'))
if ($resolvedLock -ne $expectedPath -or
    @((Get-Item -LiteralPath $lockPath,$databasePath,$originalPath) | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -gt 0) {
    throw 'Unexpected target path or reparse point. Nothing removed.'
}
$streams = @()
$removed = $false
$hashAlgorithm = [Security.Cryptography.SHA256]::Create()
try {
    # Read handles deny writes/rename to both JSONs during the final check/removal.
    foreach ($file in @($originalPath, $databasePath)) {
        $stream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $streams += $stream
        $actual = [BitConverter]::ToString($hashAlgorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        if ($actual -ne $expectedJsonHash) { throw 'JSON changed. Nothing removed.' }
    }
    # Keep the exact lock open against read/write replacement; allow only deletion.
    $markerStream = [IO.File]::Open($lockPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Delete)
    $streams += $markerStream
    $actualLockHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($markerStream)).Replace('-', '').ToLowerInvariant()
    if ($actualLockHash -ne $expectedLockHash) { throw 'Lock changed. Nothing removed.' }
    if ($null -ne (Get-CimInstance Win32_Process -Filter 'ProcessId = 10500' -ErrorAction Stop)) { throw 'PID exists. Nothing removed.' }
    if (@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'nodejs.exe' OR Name = 'bun.exe' OR Name = 'deno.exe'" -ErrorAction Stop).Count -gt 0) { throw 'Runtime active. Nothing removed.' }
    Remove-Item -LiteralPath $resolvedLock -ErrorAction Stop
    $removed = $true
} finally {
    foreach ($stream in $streams) { $stream.Dispose() }
    $hashAlgorithm.Dispose()
}
if (-not $removed -or (Test-Path -LiteralPath $lockPath)) { throw 'Lock removal not confirmed. Stop.' }
foreach ($file in @($originalPath,$databasePath)) {
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedJsonHash) { throw 'Post-removal integrity check failed. Stop.' }
}
$report = [PSCustomObject]@{ Evidence = $evidence; RemovedPath = $resolvedLock; LockRemoved = $true; OriginalAndOperationalUnchanged = $true; MigrationExecuted = $false; CompletedAtUtc = [DateTimeOffset]::UtcNow.ToString('o') }
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $projectRoot 'data/runtime/json-lock-removal-report.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 10
