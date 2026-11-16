$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'mysql-trial-recovery.mocks.ps1')
. (Join-Path $PSScriptRoot '..\scripts\diagnose-mysql-bootstrap-trial.ps1') -TrialRoot 'C:\mock' -LibraryOnly
. (Join-Path $PSScriptRoot '..\scripts\mysql-trial-recovery-windows.ps1')
$script:realPathValidator=${function:Assert-RecoveryPath}
$script:realTrialIdentity=${function:Get-RecoveryTrialIdentity}
$script:realEnvironment=${function:Assert-RecoveryEnvironment}
$script:cases=0
$script:operatorSid='S-1-5-21-100-200-300-1001'
function New-MockAcl([string]$Owner=$script:operatorSid,[switch]$Inherited,[switch]$Broad) {
    $acl=[Security.AccessControl.FileSecurity]::new()
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new($Owner))
    $acl.SetAccessRuleProtection((-not $Inherited),$false)
    foreach ($sid in @($script:operatorSid,'S-1-5-18','S-1-5-32-544')) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid),[Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow))
    }
    if ($Broad) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::Write,
            [Security.AccessControl.AccessControlType]::Allow))
    }
    return $acl
}
$null=Assert-RecoveryAclDescriptor (New-MockAcl) $script:operatorSid -Private
Check $true 'private DACL allowed'
Reject { Assert-RecoveryAclDescriptor (New-MockAcl -Broad) $script:operatorSid -Private } 'broad private DACL rejected'
Reject { Assert-RecoveryAclDescriptor (New-MockAcl -Inherited) $script:operatorSid -Private } 'inherited private DACL rejected'
Reject { Assert-RecoveryAclDescriptor (New-MockAcl -Owner 'S-1-5-18') $script:operatorSid -Private } 'wrong private owner rejected'
Reject { Assert-RecoveryAclDescriptor (New-MockAcl -Broad) $script:operatorSid } 'writable public file rejected'
$unsafeAncestor=New-MockAcl
$unsafeAncestor.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles,
    [Security.AccessControl.AccessControlType]::Allow))
Reject { Assert-RecoveryAclDescriptor $unsafeAncestor $script:operatorSid -Ancestor } 'replaceable ancestor rejected'

$context=@{Initial='C:\mock\initial.cnf';Rotated='C:\mock\rotated.cnf';Ca='C:\mock\ca.pem';Sid=$script:operatorSid;
    Calls=@{Rotate=0;Prove=0;Shutdown=0};PrivateStream=$null;Prepared=$false;Locks=[Collections.ArrayList]::new();RotatedHash=$null}
$options="[client]`r`nuser=root`r`npassword=`"SyntheticOnly!`"`r`nhost=127.0.0.1`r`nport=33307`r`nprotocol=TCP`r`nssl-mode=VERIFY_IDENTITY`r`nssl-ca=`"C:\\mock\\ca.pem`"`r`n"
$null=Assert-RecoveryClientOptions $options $context
Check $true 'options valid'
foreach ($bad in @($options.Replace('33307','3306'),$options.Replace('VERIFY_IDENTITY','REQUIRED'),
    $options.Replace('127.0.0.1','localhost'),$options.Replace('C:\\mock\\ca.pem','C:\\wrong\\ca.pem'),
    ($options+"port=33307`n"),($options+"init-command=SHUTDOWN`n"),($options+"!include x`n"),
    $options.Replace('[client]', '[mysql]'))) {
    Reject { Assert-RecoveryClientOptions $bad $context } 'unsafe options rejected'
}
foreach ($operation in @('Rotate','Prove','Shutdown')) {
    $invocation=Get-RecoveryClientInvocation $context $operation
    Check ($invocation.Arguments[0] -like '--defaults-file=*') "defaults file first $operation"
    Check ($invocation.Arguments -contains '--host=127.0.0.1' -and $invocation.Arguments -contains '--port=33307' -and
        $invocation.Arguments -contains '--ssl-mode=VERIFY_IDENTITY' -and $invocation.Arguments -contains '--ssl-ca=C:\mock\ca.pem') "TLS pin $operation"
    Check (($invocation.Arguments -join ' ') -notmatch 'Synthetic|--password|--wait|3306') "no secret/retry $operation"
}
$approved=New-Snapshot
Check (Test-RecoveryTerminationSnapshot $approved @() @()) 'termination confirmed'
$alive=@([pscustomobject]@{ProcessId=2720;CreationDate=[datetime]'2026-11-02T00:18:32.4608704Z'})
Check (-not (Test-RecoveryTerminationSnapshot $approved $alive @())) 'original still alive'
$reused=@($alive + @([pscustomobject]@{ProcessId=12016;CreationDate=[datetime]'2026-11-02T00:18:33.4091828Z'}))
Reject { Test-RecoveryTerminationSnapshot $approved $reused @() } 'second PID reused even while first alive'
Reject { Test-RecoveryTerminationSnapshot $approved @() @([pscustomobject]@{LocalPort=33307;LocalAddress='127.0.0.1';OwningProcess=888}) } 'foreign listener'
Reject { Test-RecoveryTerminationSnapshot $approved @() @([pscustomobject]@{LocalPort=33307;LocalAddress='::';OwningProcess=2720}) } 'nonloopback listener'

# All boundary functions below are in-memory fakes. No operational file opens.
$script:failure=''
function Open-RecoveryPrivateStream($Path,$Security) {
    Assert-RecoveryAclDescriptor $Security $script:operatorSid -Private
    if ($script:failure -eq 'create') { throw 'mock create failure' }
    $script:security=$Security
    $handle=[pscustomobject]@{CanWrite=$true}
    $handle | Add-Member ScriptMethod GetAccessControl { $script:security }
    $handle | Add-Member ScriptMethod Write {
        param($Bytes,$Offset,$Count)
        $script:writtenBuffer=$Bytes
        if ($script:failure -eq 'write') { throw 'mock sensitive write failure' }
        $script:persisted=[Text.Encoding]::UTF8.GetString($Bytes,$Offset,$Count)
    }
    $handle | Add-Member ScriptMethod Flush { param($Durable); if ($script:failure -eq 'flush') { throw 'mock flush failure' } }
    $handle | Add-Member ScriptMethod Dispose { $this.CanWrite=$false }
    return $handle
}
function Assert-RecoveryPath { param($Path,$OperatorSid,[switch]$Private,[switch]$Directory) }
function Open-RecoveryReadStream($Path) { return [IO.MemoryStream]::new() }
function Read-RecoveryText($Path) { if ($script:failure -eq 'verify') { return 'mismatch' }; return $script:persisted }
function Get-FileHash { param($LiteralPath,$Algorithm); return @{Hash='synthetic-hash'} }
Reject { $script:failure='create'; New-RecoveryPrivateFile $context } 'private creation failure'
foreach ($failure in @('','write','flush','verify')) {
    $script:failure=$failure; $script:writtenBuffer=$null
    $handle=New-RecoveryPrivateFile $context
    Check ($context.Prepared -and $null -ne $context.PrivateStream) 'handle tracked before rotation'
    $synthetic=[char[]]'SyntheticCredential123!'
    if ($failure) { Reject { Write-RecoveryCredential $context $handle $synthetic } "persist stops $failure" }
    else { Check (Write-RecoveryCredential $context $handle $synthetic) 'durable credential readback' }
    Check (@($script:writtenBuffer | Where-Object { [int]$_ -ne 0 }).Count -eq 0) "byte buffer cleared $failure"
    [Array]::Clear($synthetic,0,$synthetic.Length)
    $handle.Dispose()
}
foreach ($stream in $context.Locks) { $stream.Dispose() }

# Actual client invocation routine tested with an in-memory process stand-in.
function New-RecoveryClientProcess($Info) {
    $script:clientInfo=$Info
    $process=[pscustomobject]@{ExitCode=0}
    if ($script:failure -eq 'exit') { $process.ExitCode=1 }
    $out=[pscustomobject]@{}
    $out | Add-Member ScriptMethod ReadToEndAsync {
        $text=if ($script:clientInfo.FileName -like '*mysqladmin.exe') { '' }
        elseif ($script:clientInfo.Arguments -like '*rotated.cnf*') { $script:proof }
        else { "root`tlocalhost`tSyntheticCredential123!`t1`n" }
        [Threading.Tasks.Task]::FromResult([string]$text)
    }
    $out | Add-Member ScriptMethod Dispose { }
    $err=[pscustomobject]@{}
    $err | Add-Member ScriptMethod ReadToEndAsync {
        $message=if ($script:failure -eq 'stderr') { 'mock sensitive client error' } else { '' }
        [Threading.Tasks.Task]::FromResult([string]$message)
    }
    $err | Add-Member ScriptMethod Dispose { }
    $inputStream=[pscustomobject]@{}
    $inputStream | Add-Member ScriptMethod WriteLine { param($Sql); $script:sentSql=$Sql }
    $inputStream | Add-Member ScriptMethod Close { }
    $inputStream | Add-Member ScriptMethod Dispose { }
    $process | Add-Member NoteProperty StandardOutput $out
    $process | Add-Member NoteProperty StandardError $err
    $process | Add-Member NoteProperty StandardInput $inputStream
    $process | Add-Member ScriptMethod Start { $true }
    $process | Add-Member ScriptMethod WaitForExit { param($Timeout); $script:failure -ne 'timeout' }
    $process | Add-Member ScriptMethod Dispose { $script:clientDisposed=$true }
    return $process
}
foreach ($failure in @('','exit','stderr','timeout')) {
    $script:failure=$failure; $script:clientDisposed=$false; $context.Calls.Rotate=0
    if ($failure) { Reject { Invoke-RecoveryNativeClient $context 'Rotate' } "native stop $failure" }
    else {
        $response=Invoke-RecoveryNativeClient $context 'Rotate'
        Check ($response.ExitCode -eq 0) 'captured native output'
    }
    Check $script:clientDisposed "process wrapper disposed $failure"
    Check ($context.Calls.Rotate -eq 1) "single native attempt $failure"
    Check ($script:clientInfo.Arguments -notmatch 'Synthetic|ALTER|password=') "no credential or SQL argv $failure"
    Check ($script:sentSql -cmatch '^ALTER USER') "expired account ALTER first $failure"
    Reject { Invoke-RecoveryNativeClient $context 'Rotate' } "retry blocked $failure"
}
# Real main-service, process and listener correlation; all OS calls mocked.
$script:failure=''
function Get-CimInstance {
    param($ClassName,$Filter)
    if ($script:failure -eq 'denied') { throw 'mock denied' }
    if ($ClassName -ceq 'Win32_Service') {
        $value=[pscustomobject]@{Name='MYSQL80';State='Running';StartMode='Auto';StartName='mock';PathName='mock configured image';ProcessId=4884}
        if ($script:failure -eq 'service') { $value.State='Stopped' }
        return $value
    }
    $number=[int]($Filter -replace 'ProcessId=','')
    if ($number -in @(2720,12016)) {
        if ($script:trialInspection) {
            $root='C:\Users\diego\RenoLinkBootstrapTrial-e5536b82f7274ceca2c200503c1339b9'
            $value=@((New-Snapshot).VerifiedProcesses | Where-Object ProcessId -eq $number)[0]
            $line='"D:\MySQL\bin\mysqld.exe" --defaults-file="' + $root + '\config\my.ini" --datadir="' + $root + '\data" --port=33307 --bind-address=127.0.0.1 --mysqlx=OFF'
            if ($script:failure -eq 'arguments') { $line+=' --port=3306' }
            $date=[datetime]$value.CreationDate
            if ($script:failure -eq 'birthTick') { $date=$date.AddTicks(1) }
            return [pscustomobject]@{ProcessId=$number;CreationDate=$date;CommandLine=$line}
        }
        if ($script:failure -in @('waitAlive','waitTimeout')) {
            return [pscustomobject]@{ProcessId=$number;CreationDate=[datetime](@((New-Snapshot).VerifiedProcesses | Where-Object ProcessId -eq $number)[0].CreationDate)}
        }
        if ($script:failure -eq 'waitReuse') { return [pscustomobject]@{ProcessId=$number;CreationDate=[datetime]'2026-11-03T00:00:00.0000000Z'} }
        return
    }
    $value=[pscustomobject]@{ProcessId=$number;ParentProcessId=4884;ExecutablePath='D:\MySQL\bin\mysqld.exe';CreationDate=[datetime]'2026-11-02T00:00:00.0000000Z'}
    if ($number -eq 4884) { $value.ParentProcessId=700 }
    if ($script:failure -eq 'parent') { $value.ParentProcessId=999 }
    if ($script:failure -eq 'image') { $value.ExecutablePath='D:\other.exe' }
    if ($script:failure -in @('limited','limitedDenied')) { $value.ExecutablePath=$null }
    if ($script:failure -eq 'creation') { $value.CreationDate=$null }
    return $value
}
$script:trialInspection=$true
$identityContext=@{Root='C:\Users\diego\RenoLinkBootstrapTrial-e5536b82f7274ceca2c200503c1339b9';Diagnostic={ New-Snapshot | ConvertTo-Json -Depth 6 }}
$script:failure=''
$identity=Get-RecoveryTrialIdentity $identityContext
Check ((Get-TrialRecoveryFingerprint $identity) -ceq (Get-TrialRecoveryFingerprint (New-Snapshot))) 'real identity adapter compares exact arguments and creation'
foreach ($failure in @('arguments','birthTick')) {
    $script:failure=$failure
    Reject { Get-RecoveryTrialIdentity $identityContext } "real identity blocks $failure"
}
$script:trialInspection=$false;$script:failure=''
function Get-NetTCPConnection {
    param($State)
    if ($script:failure -eq 'listeners') { return }
    foreach ($port in @(3306,33060)) { [pscustomobject]@{LocalPort=$port;LocalAddress='127.0.0.1';OwningProcess=5520} }
}
function Get-RecoveryLimitedProcessIdentity {
    param($Id)
    if ($script:failure -eq 'limitedDenied') { throw 'mock limited read denied' }
    return @{Image='D:\MySQL\bin\mysqld.exe';CreationUtc='2026-11-02T00:00:00.0000000Z'}
}
$baseline=Get-RecoveryMainSnapshot
Check ($baseline -ceq (Get-RecoveryMainSnapshot)) 'main stable snapshot'
$script:failure='limited'
Check ((Get-RecoveryMainSnapshot) -ceq $baseline) 'limited-information read fallback without privilege escalation'
foreach ($failure in @('denied','service','parent','image','creation','listeners','limitedDenied')) {
    $script:failure=$failure
    Reject { Get-RecoveryMainSnapshot } "main verification fails $failure"
}
$script:failure=''
$waitContext=@{MainBaseline=Get-RecoveryMainSnapshot}
Check (Wait-RecoveryTermination $waitContext (New-Snapshot)) 'real wait routine success with mocked Windows reads'
function New-RecoveryTimer { $script:timer=[pscustomobject]@{Elapsed=[pscustomobject]@{TotalSeconds=0}}; return $script:timer }
function Start-Sleep { param($Milliseconds); $script:timer.Elapsed.TotalSeconds=31 }
$script:failure='waitTimeout'
Reject { Wait-RecoveryTermination $waitContext (New-Snapshot) } 'real wait routine timeout'
$script:failure='waitReuse'
Reject { Wait-RecoveryTermination $waitContext (New-Snapshot) } 'real wait routine PID reuse'
$script:failure=''
$waitContext.MainBaseline='divergent'
Reject { Wait-RecoveryTermination $waitContext (New-Snapshot) } 'real wait blocks MYSQL80 divergence'

# Actual path-walk logic, synthetic metadata and DACLs only.
function Get-Item {
    param($LiteralPath,[switch]$Force)
    $attributes=if ($LiteralPath -eq $script:reparsePath) { [IO.FileAttributes]::ReparsePoint } else { [IO.FileAttributes]::Normal }
    [pscustomobject]@{PSIsContainer=($LiteralPath -notlike '*.cnf');Attributes=$attributes;VersionInfo=@{FileVersion='8.0.46.0'}}
}
function Get-Acl { param($LiteralPath); if ($script:failure -eq 'acl') { return New-MockAcl -Broad }; New-MockAcl }
$script:reparsePath='';$script:failure=''
$null=& $script:realPathValidator 'C:\mock\file.cnf' $script:operatorSid -Private
Check $true 'real path walk passes safe mocked ancestors'
$script:reparsePath='C:\mock'
Reject { & $script:realPathValidator 'C:\mock\file.cnf' $script:operatorSid -Private } 'ancestor reparse rejected'
$script:reparsePath='';$script:failure='acl'
Reject { & $script:realPathValidator 'C:\mock\file.cnf' $script:operatorSid -Private } 'unsafe path ACL rejected'

# Real initialization gate: immutable file locks, version, certificate pin, options.
$env:APPDATA='C:\mock\AppData'
$script:blockedEnvironment=''
function Test-Path {
    param($LiteralPath)
    return ($LiteralPath -ceq $script:blockedEnvironment)
}
foreach ($blocked in @('Env:MYSQL_PWD','Env:MYSQL_TEST_LOGIN_FILE','Env:MYSQL_DEBUG','Env:SSLKEYLOGFILE',
    'Env:OPENSSL_CONF','C:\mock\AppData\MySQL\.mylogin.cnf')) {
    $script:blockedEnvironment=$blocked
    Reject { & $script:realEnvironment } "unsafe environment blocks $blocked"
}
$script:blockedEnvironment=''
$null=& $script:realEnvironment
Check $true 'clean client environment'
function Assert-RecoveryEnvironment { }
function Get-RecoveryPublicCertificate($Path) {
    $value=[pscustomobject]@{NotBefore=[datetime]'2020-01-01';NotAfter=[datetime]'2099-01-01'}
    if ($script:failure -eq 'expired') { $value.NotAfter=[datetime]'2001-01-01' }
    $value | Add-Member ScriptMethod Dispose { }
    return $value
}
function Read-RecoveryText($Path) { return $script:validOptions }
function Get-FileHash { param($LiteralPath,$Algorithm); if ($script:failure -eq 'certificate' -and $LiteralPath -like '*fixture*') { return @{Hash='different'} }; @{Hash='synthetic-hash'} }
$script:validOptions=$options
$context.Root='C:\mock';$context.Fixture='C:\mock\fixture';$context.Files=@(@{Path='C:\mock\initial.cnf';Private=$true;Hash=$null})
$context.Prepared=$false;$context.PrivateStream=$null
# Same real gate, but synthetic ACL/path boundary, no host reads.
$script:failure=''
Check (Initialize-RecoveryFiles $context) 'real initialization verifies pinned certificate and options'
foreach ($failure in @('expired','certificate')) {
    $script:failure=$failure
    Reject { Initialize-RecoveryFiles $context } "certificate preflight blocks $failure"
}
foreach ($stream in $context.Locks) { $stream.Dispose() }

# Wire the production adapter to the real state machine, replacing OS/process
# boundaries only. This catches script-scope and callback integration errors.
function Test-Path { param($LiteralPath); return $false }
function Get-RecoveryTrialIdentity { param($Context); New-Snapshot }
function Read-RecoveryText($Path) {
    if ($Path -ceq $script:RecoveryContext.Rotated) { return $script:persisted }
    return $script:validOptions
}
$script:failure=''
$script:RecoveryContext=$context
$context.Calls=@{Rotate=0;Prove=0;Shutdown=0}
$context.FilesValidated=$false;$context.Prepared=$false;$context.PrivateStream=$null;$context.RotatedHash=$null
$context.MainBaseline=Get-RecoveryMainSnapshot
$result=Invoke-TrialRecoveryStateMachine (New-Snapshot) (New-RecoveryWindowsAdapter)
Check ($result.State -ceq 'TerminationConfirmed') 'production adapter and state machine integrated'
Check ($context.Calls.Rotate -eq 1 -and $context.Calls.Prove -eq 1 -and $context.Calls.Shutdown -eq 1) 'one of each client operation'
foreach ($stream in $context.Locks) { $stream.Dispose() }
Write-Output "Windows recovery mock assertions passed: $script:cases"
