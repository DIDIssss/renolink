param([switch]$LoadOnly)
# Diagnostic only: never deletes locks, stops processes or starts migration.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$databasePath = Join-Path $projectRoot 'data/runtime/db.json'
$lockPath = $databasePath + '.lock'
if (-not ('RenoLinkLockResourceQuery' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class RenoLinkLockResourceQuery {
    [StructLayout(LayoutKind.Sequential)]
    public struct UniqueProcess {
        public int Pid;
        public System.Runtime.InteropServices.ComTypes.FILETIME StartTime;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct ProcessInfo {
        public UniqueProcess Process;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string AppName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string ServiceName;
        public int AppType;
        public uint AppStatus;
        public uint SessionId;
        [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
    }
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
    private static extern int RmStartSession(out uint session, uint flags, StringBuilder key);
    [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
    private static extern int RmRegisterResources(uint session, uint count, string[] files, uint apps, IntPtr processes, uint services, IntPtr names);
    [DllImport("rstrtmgr.dll")]
    private static extern int RmGetList(uint session, out uint needed, ref uint count, [In, Out] ProcessInfo[] entries, ref uint reasons);
    [DllImport("rstrtmgr.dll")]
    private static extern int RmEndSession(uint session);
    public static ProcessInfo[] Query(string[] files) {
        uint session;
        int result = RmStartSession(out session, 0, new StringBuilder(33));
        if (result != 0) throw new Win32Exception(result);
        try {
            result = RmRegisterResources(session, (uint)files.Length, files, 0, IntPtr.Zero, 0, IntPtr.Zero);
            if (result != 0) throw new Win32Exception(result);
            uint count = 0, needed = 0, reasons = 0;
            ProcessInfo[] entries = new ProcessInfo[0];
            for (int attempt = 0; attempt < 4; attempt++) {
                result = RmGetList(session, out needed, ref count, entries, ref reasons);
                if (result == 0) {
                    if (reasons != 0) throw new InvalidOperationException("Resource query incomplete: " + reasons);
                    Array.Resize(ref entries, (int)count);
                    return entries;
                }
                if (result != 234) throw new Win32Exception(result);
                count = needed;
                entries = new ProcessInfo[count];
            }
            throw new InvalidOperationException("Resource list changed during query.");
        } finally { RmEndSession(session); }
    }
}
'@
}
function Get-LockSnapshot {
    $ownerText = [IO.File]::ReadAllText($lockPath)
    if ($ownerText -notmatch '^\d+$') { throw 'Lock contains an invalid PID. No changes made.' }
    $ownerId = [int]$ownerText
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction Stop
    $runtimes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'nodejs.exe' OR Name = 'bun.exe' OR Name = 'deno.exe'" -ErrorAction Stop)
    $resourceUsers = @([RenoLinkLockResourceQuery]::Query([string[]]@($databasePath, $lockPath)))
    $metadata = Get-Item -LiteralPath $databasePath, $lockPath
    [PSCustomObject]@{
        CheckedAt = [DateTimeOffset]::UtcNow.ToString('o')
        RecordedPid = $ownerId
        OwnerExists = ($null -ne $owner)
        OwnerName = $owner.Name
        RuntimeProcesses = @($runtimes | Select-Object ProcessId, Name, CreationDate)
        FileUsers = @($resourceUsers | ForEach-Object { [PSCustomObject]@{ ProcessId = $_.Process.Pid; AppName = $_.AppName; ServiceName = $_.ServiceName } })
        Files = @($metadata | ForEach-Object { [PSCustomObject]@{ Name = $_.Name; Length = $_.Length; LastWriteTimeUtc = $_.LastWriteTimeUtc.ToString('o'); Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
        TemporaryWrites = @(Get-ChildItem -LiteralPath (Split-Path -Parent $databasePath) -Filter 'db.json.*.tmp' | Select-Object Name,Length)
    }
}
if ($LoadOnly) { return }
$first = Get-LockSnapshot
Start-Sleep -Seconds 10
$second = Get-LockSnapshot
$stable = ($first.Files | ConvertTo-Json -Compress) -eq ($second.Files | ConvertTo-Json -Compress)
$orphan = -not $first.OwnerExists -and -not $second.OwnerExists -and
    $first.RuntimeProcesses.Count -eq 0 -and $second.RuntimeProcesses.Count -eq 0 -and
    $first.FileUsers.Count -eq 0 -and $second.FileUsers.Count -eq 0 -and
    $first.TemporaryWrites.Count -eq 0 -and $second.TemporaryWrites.Count -eq 0 -and $stable
[PSCustomObject]@{ First = $first; Second = $second; FilesStable = $stable; OrphanEvidenceConfirmed = $orphan; LockRemoved = $false; MigrationExecuted = $false } | ConvertTo-Json -Depth 8
