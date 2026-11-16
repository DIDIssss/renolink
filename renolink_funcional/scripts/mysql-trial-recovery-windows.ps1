# Windows implementation. Definitions only; dot-sourcing performs no host operation.
Set-StrictMode -Version 2

function Assert-RecoveryAclDescriptor {
    param($Security, [string]$OperatorSid, [switch]$Private, [switch]$Ancestor)
    $allowed = @($OperatorSid, 'S-1-5-18', 'S-1-5-32-544')
    # Windows Modules Installer can own installed executables and system ancestors.
    $trustedInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
    $owners = $allowed + @($trustedInstaller)
    $owner = $Security.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if (($Private -and $owner -cne $OperatorSid) -or $owner -notin $owners -or
        ($Private -and -not $Security.AreAccessRulesProtected)) { throw 'UnsafeOwnerOrInheritance' }
    $rules = @($Security.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    if ($rules.Count -eq 0) { throw 'EmptyDacl' }
    $found = @{}
    # Existing ancestors may grant creation of unrelated siblings, but must not
    # permit replacement/deletion of the selected child or changing their ACL.
    $writeMask = if ($Ancestor) { 0x000D0040 } else { 0x000D0156 }
    foreach ($rule in $rules) {
        $sid = $rule.IdentityReference.Value
        if ($Private) {
            if ($sid -notin $allowed -or $rule.IsInherited -or
                $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None -or
                $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
                [int]$rule.FileSystemRights -ne [int][Security.AccessControl.FileSystemRights]::FullControl) {
                throw 'UnsafePrivateDacl'
            }
            $found[$sid] = $true
        } elseif ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
            $sid -notin $owners -and ([int]$rule.FileSystemRights -band $writeMask) -ne 0) {
            throw 'UntrustedWritablePath'
        }
    }
    if ($Private) {
        foreach ($sid in $allowed) { if (-not $found.ContainsKey($sid)) { throw 'MissingPrivatePrincipal' } }
    }
}

function Assert-RecoveryPath {
    param([string]$Path, [string]$OperatorSid, [switch]$Private, [switch]$Directory)
    $canonical = ConvertTo-TrialExactPath $Path
    $item = Get-Item -LiteralPath $canonical -Force -ErrorAction Stop
    if ($item.PSIsContainer -ne [bool]$Directory) { throw 'WrongPathType' }
    $first = $true
    $current = $canonical
    while ($current) {
        $part = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($part.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'ReparsePath' }
        $acl = Get-Acl -LiteralPath $current -ErrorAction Stop
        Assert-RecoveryAclDescriptor $acl $OperatorSid -Private:($first -and $Private) -Ancestor:(-not $first)
        $first = $false
        $parent = [IO.Directory]::GetParent($current)
        $current = if ($null -eq $parent) { $null } else { $parent.FullName }
    }
}

function Get-RecoveryMainSnapshot {
    $service = Get-CimInstance Win32_Service -Filter "Name='MYSQL80'" -ErrorAction Stop
    if ($null -eq $service -or $service.State -cne 'Running' -or $service.StartMode -cne 'Auto' -or
        [uint32]$service.ProcessId -eq 0) { throw 'MYSQL80NotConfirmed' }
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -in @(3306,33060) } |
        Sort-Object LocalPort,LocalAddress,OwningProcess |
        Select-Object LocalAddress,LocalPort,OwningProcess)
    foreach ($port in @(3306,33060)) {
        if (@($listeners | Where-Object LocalPort -eq $port).Count -eq 0) { throw 'MissingMainListener' }
    }
    $ids = @(@([uint32]$service.ProcessId) + @($listeners | ForEach-Object { [uint32]$_.OwningProcess }) | Sort-Object -Unique)
    $processes = @()
    foreach ($id in $ids) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction Stop
        if ($null -eq $process) { throw 'MainProcessUnverified' }
        $image=[string]$process.ExecutablePath
        $created=ConvertTo-TrialCreationDate $process.CreationDate
        # Win32_Process.ExecutablePath can be withheld without SeDebugPrivilege.
        # Query-limited-information is a native read-only alternative, not elevation.
        if ([string]::IsNullOrWhiteSpace($image)) {
            $limited=Get-RecoveryLimitedProcessIdentity $id
            $image=$limited.Image
            $created=$limited.CreationUtc
        }
        if ((ConvertTo-TrialExactPath $image) -ine 'D:\MySQL\bin\mysqld.exe') { throw 'MainImageUnverified' }
        if (-not $created) { throw 'MainCreationUnverified' }
        if ($id -ne [uint32]$service.ProcessId -and [uint32]$process.ParentProcessId -ne [uint32]$service.ProcessId) {
            throw 'MainParentUnverified'
        }
        $processes += [pscustomobject]@{ Id=$id; Parent=[uint32]$process.ParentProcessId; Creation=$created; Image=$image }
    }
    # Retain configured PathName in memory for equality; never print it.
    return ([ordered]@{
        Service=$service | Select-Object Name,State,StartMode,StartName,PathName,ProcessId
        Processes=$processes; Listeners=$listeners
    } | ConvertTo-Json -Depth 6 -Compress)
}

function Get-RecoveryLimitedProcessIdentity([uint32]$Id) {
    if (-not ('RenoLink.TrialLimitedProcessReader' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace RenoLink {
    public sealed class TrialProcessReadResult {
        public string Image { get; set; }
        public string CreationUtc { get; set; }
    }
    public static class TrialLimitedProcessReader {
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern IntPtr OpenProcess(uint rights, bool inherit, uint pid);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern bool QueryFullProcessImageName(IntPtr handle, uint flags, StringBuilder image, ref uint size);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool GetProcessTimes(IntPtr handle, out long created, out long exited, out long kernel, out long user);
        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr handle);
        public static TrialProcessReadResult Read(uint pid) {
            IntPtr handle=OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION only
            if(handle==IntPtr.Zero) throw new InvalidOperationException("LimitedProcessReadDenied");
            try {
                var image=new StringBuilder(32768); uint size=32768;
                long created, exited, kernel, user;
                if(!QueryFullProcessImageName(handle,0,image,ref size) ||
                   !GetProcessTimes(handle,out created,out exited,out kernel,out user))
                    throw new InvalidOperationException("LimitedProcessReadIncomplete");
                return new TrialProcessReadResult {
                    Image=image.ToString(),
                    CreationUtc=DateTime.FromFileTimeUtc(created).ToString("o",System.Globalization.CultureInfo.InvariantCulture)
                };
            } finally { CloseHandle(handle); }
        }
    }
}
'@ -ErrorAction Stop
    }
    return [RenoLink.TrialLimitedProcessReader]::Read($Id)
}

function Get-RecoveryTrialIdentity {
    param($Context)
    # No child shell or native output forwarding. Diagnostic is read-only.
    $json = & $Context.Diagnostic -TrialRoot $Context.Root
    $value = ($json -join [Environment]::NewLine) | ConvertFrom-Json -ErrorAction Stop
    $null = Get-TrialRecoveryFingerprint $value
    # Reject extra/duplicated argv beyond the exact bootstrap invocation.
    foreach ($verified in $value.VerifiedProcesses) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($verified.ProcessId)" -ErrorAction Stop
        $expected = '"D:\MySQL\bin\mysqld.exe" --defaults-file="' + $Context.Root + '\config\my.ini" --datadir="' + $Context.Root + '\data" --port=33307 --bind-address=127.0.0.1 --mysqlx=OFF'
        $actual = [string]$process.CommandLine
        # Windows may omit quotes around the executable because it has no spaces.
        $alternative = $expected.Replace('"D:\MySQL\bin\mysqld.exe"','D:\MySQL\bin\mysqld.exe')
        if (($actual.Trim() -ine $expected -and $actual.Trim() -ine $alternative) -or
            (ConvertTo-TrialCreationDate $process.CreationDate) -cne $verified.CreationDate) { throw 'TrialArgumentsChanged' }
    }
    return $value
}

function Assert-RecoveryClientOptions {
    param([string]$Text, $Context)
    $entries = @{}
    $section = $false
    foreach ($line in [regex]::Split($Text,'\r?\n')) {
        if ($line.Length -eq 0) { continue }
        if ($line -ceq '[client]' -and -not $section) { $section=$true; continue }
        if (-not $section -or $line -notmatch '^([a-z-]+)=(.*)$') { throw 'InvalidClientOptions' }
        $key=$Matches[1]; $value=$Matches[2]
        if ($entries.ContainsKey($key)) { throw 'DuplicateClientOption' }
        $entries[$key]=$value
    }
    $expected=@{user='root';host='127.0.0.1';port='33307';protocol='TCP';'ssl-mode'='VERIFY_IDENTITY'}
    if ($entries.Count -ne 7) { throw 'UnexpectedClientOption' }
    foreach ($key in $expected.Keys) { if ($entries[$key] -cne $expected[$key]) { throw 'UnsafeClientOption' } }
    $expectedCa = '"' + $Context.Ca.Replace('\','\\') + '"'
    if ($entries['ssl-ca'] -cne $expectedCa -or $entries['password'] -cnotmatch '^"(?:[^"\\\x00-\x1f]|\\[\\"])+"$') {
        throw 'UnsafeCredentialFormat'
    }
}

function Assert-RecoveryEnvironment {
    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) { throw 'MissingAppData' }
    foreach ($name in @('MYSQL_PWD','MYSQL_TEST_LOGIN_FILE','MYSQL_DEBUG','LIBMYSQL_PLUGIN_DIR','LIBMYSQL_PLUGINS',
        'LIBMYSQL_ENABLE_CLEARTEXT_PLUGIN','SSLKEYLOGFILE','OPENSSL_CONF','OPENSSL_MODULES','OPENSSL_ENGINES')) {
        if (Test-Path "Env:$name") { throw 'UnsafeClientEnvironment' }
    }
    if (Test-Path -LiteralPath (Join-Path $env:APPDATA 'MySQL\.mylogin.cnf') -ErrorAction Stop) { throw 'ExistingLoginPath' }
}

function Assert-RecoveryFiles {
    param($Context)
    Assert-RecoveryEnvironment
    foreach ($dir in @($Context.Root, "$($Context.Root)\config", "$($Context.Root)\certs", "$($Context.Root)\secrets", "$($Context.Root)\data")) {
        Assert-RecoveryPath $dir $Context.Sid -Directory -Private
    }
    foreach ($file in $Context.Files) {
        Assert-RecoveryPath $file.Path $Context.Sid -Private:($file.Private)
        if ($file.Hash -and (Get-FileHash -LiteralPath $file.Path -Algorithm SHA256 -ErrorAction Stop).Hash -cne $file.Hash) { throw 'ValidatedFileChanged' }
    }
    if ($Context.Prepared) {
        # With FileShare.None, validate ACL through the open handle until closed.
        if ($null -ne $Context.PrivateStream -and $Context.PrivateStream.CanWrite) {
            Assert-RecoveryAclDescriptor ($Context.PrivateStream.GetAccessControl()) $Context.Sid -Private
        } else { Assert-RecoveryPath $Context.Rotated $Context.Sid -Private }
    } elseif (Test-Path -LiteralPath $Context.Rotated -ErrorAction Stop) { throw 'CredentialDestinationExists' }
    return $true
}

function Initialize-RecoveryFiles {
    param($Context)
    $null = Assert-RecoveryFiles $Context
    foreach ($exe in @('mysqld.exe','mysql.exe','mysqladmin.exe')) {
        $version = (Get-Item -LiteralPath "D:\MySQL\bin\$exe" -ErrorAction Stop).VersionInfo.FileVersion
        if ($version -cnotmatch '^8\.0\.46(?:\.0)?$') { throw 'UnexpectedClientVersion' }
    }
    # Lock all immutable files against writing/deletion while clients may read.
    foreach ($file in $Context.Files) {
        $stream=Open-RecoveryReadStream $file.Path
        $null=$Context.Locks.Add($stream)
        $file.Hash=(Get-FileHash -LiteralPath $file.Path -Algorithm SHA256 -ErrorAction Stop).Hash
    }
    foreach ($pair in @(@($Context.Ca,'ca.pem'), @("$($Context.Root)\certs\valid.cert.pem",'valid.cert.pem'))) {
        if ((Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash -cne
            (Get-FileHash -LiteralPath (Join-Path $Context.Fixture $pair[1]) -Algorithm SHA256).Hash) { throw 'UnexpectedPublicCertificate' }
        $certificate=Get-RecoveryPublicCertificate $pair[0]
        try {
            if ([datetime]::UtcNow -lt $certificate.NotBefore.ToUniversalTime() -or
                [datetime]::UtcNow -ge $certificate.NotAfter.ToUniversalTime()) { throw 'CertificateOutsideValidity' }
        } finally { $certificate.Dispose() }
    }
    $text=Read-RecoveryText $Context.Initial
    try { Assert-RecoveryClientOptions $text $Context } finally { $text=$null }
    return $true
}

function New-RecoveryPrivateFile {
    param($Context)
    $security=[Security.AccessControl.FileSecurity]::new()
    $operator=[Security.Principal.SecurityIdentifier]::new($Context.Sid)
    $security.SetOwner($operator)
    $security.SetAccessRuleProtection($true,$false)
    foreach ($sid in @($Context.Sid,'S-1-5-18','S-1-5-32-544')) {
        $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow))
    }
    $stream=Open-RecoveryPrivateStream $Context.Rotated $security
    # Register immediately, including failure while validating the new handle.
    $Context.PrivateStream=$stream
    $Context.Prepared=$true
    Assert-RecoveryAclDescriptor ($stream.GetAccessControl()) $Context.Sid -Private
    return $stream
}

function Open-RecoveryPrivateStream($Path,$Security) {
    return [IO.FileStream]::new($Path,[IO.FileMode]::CreateNew,
        [Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::None,$Security)
}

function Open-RecoveryReadStream($Path) {
    return [IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
}

function Read-RecoveryText($Path) { return [IO.File]::ReadAllText($Path) }

function Get-RecoveryPublicCertificate($Path) {
    return [Security.Cryptography.X509Certificates.X509Certificate2]::new($Path)
}

function New-RecoveryClientProcess($Info) {
    $process=[Diagnostics.Process]::new()
    $process.StartInfo=$Info
    return $process
}

function Write-RecoveryCredential {
    param($Context, $Handle, [char[]]$Password)
    $bytes=$null; $contents=$null; $secret=$null
    try {
        $secret = -join $Password
        $contents='[client]' + "`r`nuser=root`r`npassword=`"" + $secret + "`"`r`nhost=127.0.0.1`r`nport=33307`r`nprotocol=TCP`r`nssl-mode=VERIFY_IDENTITY`r`nssl-ca=`"" + $Context.Ca.Replace('\','\\') + "`"`r`n"
        Assert-RecoveryClientOptions $contents $Context
        $bytes=[Text.UTF8Encoding]::new($false).GetBytes($contents)
        $Handle.Write($bytes,0,$bytes.Length)
        $Handle.Flush($true)
        Assert-RecoveryAclDescriptor ($Handle.GetAccessControl()) $Context.Sid -Private
        $Handle.Dispose()
        Assert-RecoveryPath $Context.Rotated $Context.Sid -Private
        $stream=Open-RecoveryReadStream $Context.Rotated
        $null=$Context.Locks.Add($stream)
        if ((Read-RecoveryText $Context.Rotated) -cne $contents) { throw 'PersistedCredentialMismatch' }
        $Context.RotatedHash=(Get-FileHash -LiteralPath $Context.Rotated -Algorithm SHA256).Hash
        return $true
    } finally {
        if ($null -ne $bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
        $secret=$null; $contents=$null
    }
}

function Get-RecoveryClientInvocation {
    param($Context, [ValidateSet('Rotate','Prove','Shutdown')][string]$Operation)
    $options=if ($Operation -ceq 'Rotate') { $Context.Initial } else { $Context.Rotated }
    $arguments=@("--defaults-file=$options",'--host=127.0.0.1','--port=33307','--protocol=TCP',
        '--user=root','--ssl-mode=VERIFY_IDENTITY',"--ssl-ca=$($Context.Ca)",'--connect-timeout=5')
    $sql=$null
    if ($Operation -ceq 'Shutdown') {
        $exe='D:\MySQL\bin\mysqladmin.exe'; $arguments+=@('--shutdown-timeout=30','shutdown')
    } else {
        $exe='D:\MySQL\bin\mysql.exe'
        $arguments+=@('--batch','--raw','--skip-column-names','--skip-reconnect')
        if ($Operation -ceq 'Rotate') {
            $arguments+='--connect-expired-password'
            $sql="ALTER USER 'root'@'localhost' IDENTIFIED BY RANDOM PASSWORD;"
        } else {
            $sql="SELECT @@datadir, @@port, @@server_uuid, VERSION(), CURRENT_USER(); SHOW SESSION STATUS LIKE 'Ssl_cipher';"
        }
    }
    return @{Exe=$exe; Arguments=$arguments; Sql=$sql}
}

function Invoke-RecoveryNativeClient {
    param($Context, [ValidateSet('Rotate','Prove','Shutdown')][string]$Operation)
    # Counters are set before any possible launch: never retry an uncertain call.
    if ($Context.Calls[$Operation] -ne 0) { throw 'RepeatedClientOperationBlocked' }
    $Context.Calls[$Operation]=1
    $invocation=Get-RecoveryClientInvocation $Context $Operation
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$invocation.Exe
    # Fixed arguments have no trailing slash/quotes. Password never enters argv.
    foreach ($argument in $invocation.Arguments) { if ($argument.Contains('"') -or $argument.EndsWith('\')) { throw 'UnsafeArgument' } }
    $info.Arguments=(@($invocation.Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $info.WorkingDirectory='D:\MySQL\bin'
    $info.EnvironmentVariables['MYSQL_HISTFILE']='NUL'
    $process=New-RecoveryClientProcess $info
    $stdout=$null; $stderr=$null
    try {
        if (-not $process.Start()) { throw 'ClientNotStarted' }
        $stdout=$process.StandardOutput.ReadToEndAsync()
        $stderr=$process.StandardError.ReadToEndAsync()
        if ($invocation.Sql) { $process.StandardInput.WriteLine($invocation.Sql) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(45000)) { throw 'ClientTimeoutPossiblyActive' }
        if (-not $stdout.Wait(1000) -or -not $stderr.Wait(1000)) { throw 'ClientOutputIncomplete' }
        # Any diagnostic output blocks the flow. Never return stderr contents.
        if ($process.ExitCode -ne 0 -or $stderr.Result.Length -ne 0 -or $stdout.Result.Length -gt 8192 -or
            ($Operation -ceq 'Shutdown' -and $stdout.Result.Length -ne 0)) { throw 'ClientFailed' }
        return @{ExitCode=$process.ExitCode; Output=$stdout.Result}
    } catch { throw 'ClientOperationUnconfirmed: no retry; client may remain active.' }
    finally {
        $cleanupFailed=$false
        foreach ($stream in @($process.StandardInput,$process.StandardOutput,$process.StandardError)) {
            try { $stream.Dispose() } catch { $cleanupFailed=$true }
        }
        try { $process.Dispose() } catch { $cleanupFailed=$true }
        $stdout=$null; $stderr=$null
        if ($cleanupFailed) { throw 'ClientHandleCleanupUnconfirmed: no retry.' }
    }
}

function Test-RecoveryTerminationSnapshot {
    param($Approved, [object[]]$Processes, [object[]]$Listeners)
    $remaining=$false
    foreach ($original in $Approved.VerifiedProcesses) {
        foreach ($current in @($Processes | Where-Object { [uint32]$_.ProcessId -eq [uint32]$original.ProcessId })) {
            if ((ConvertTo-TrialCreationDate $current.CreationDate) -cne $original.CreationDate) { throw 'OriginalPidReused' }
            $remaining=$true
        }
    }
    $trialListeners=@($Listeners | Where-Object { [int]$_.LocalPort -eq 33307 })
    foreach ($listener in $trialListeners) {
        if ($listener.LocalAddress -cne '127.0.0.1' -or
            [uint32]$listener.OwningProcess -notin @($Approved.VerifiedProcessIds)) { throw 'TrialListenerReplaced' }
    }
    return (-not $remaining -and $trialListeners.Count -eq 0)
}

function Wait-RecoveryTermination {
    param($Context, $Approved)
    $watch=New-RecoveryTimer
    do {
        if ((Get-RecoveryMainSnapshot) -cne $Context.MainBaseline) { throw 'MYSQL80Changed' }
        $processes=@()
        foreach ($original in $Approved.VerifiedProcesses) {
            $processes+=@(Get-CimInstance Win32_Process -Filter "ProcessId=$($original.ProcessId)" -ErrorAction Stop)
        }
        $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 33307)
        if (Test-RecoveryTerminationSnapshot $Approved $processes $listeners) { return $true }
        Start-Sleep -Milliseconds 500
    } while ($watch.Elapsed.TotalSeconds -lt 30)
    throw 'TerminationTimeout: do not repeat shutdown.'
}

function New-RecoveryTimer { return [Diagnostics.Stopwatch]::StartNew() }

function New-RecoveryWindowsAdapter {
    # The operational entry point owns this script-scoped context and its cleanup.
    return @{
        Identity={
            if ($script:RecoveryContext.FilesValidated) { $null=Assert-RecoveryFiles $script:RecoveryContext }
            if ($script:RecoveryContext.RotatedHash -and
                (Get-FileHash -LiteralPath $script:RecoveryContext.Rotated -Algorithm SHA256).Hash -cne $script:RecoveryContext.RotatedHash) { throw 'CredentialChanged' }
            Get-RecoveryTrialIdentity $script:RecoveryContext
        }
        MainUnchanged={ (Get-RecoveryMainSnapshot) -ceq $script:RecoveryContext.MainBaseline }
        ValidateFiles={
            $null=Initialize-RecoveryFiles $script:RecoveryContext
            $script:RecoveryContext.FilesValidated=$true
            $true
        }
        PreparePrivateFile={ New-RecoveryPrivateFile $script:RecoveryContext }
        Rotate={ Invoke-RecoveryNativeClient $script:RecoveryContext 'Rotate' }
        Persist={ param($Handle,$Password) Write-RecoveryCredential $script:RecoveryContext $Handle $Password }
        Prove={ Invoke-RecoveryNativeClient $script:RecoveryContext 'Prove' }
        Shutdown={ (Invoke-RecoveryNativeClient $script:RecoveryContext 'Shutdown').ExitCode }
        ConfirmTermination={ param($Approved) Wait-RecoveryTermination $script:RecoveryContext $Approved }
    }
}
