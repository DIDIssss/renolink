[CmdletBinding()]
param(
    [switch]$AuthorizeTrial,
    [string]$Confirmation
)

$ErrorActionPreference = 'Stop'
$requiredConfirmation = 'RUN-DISPOSABLE-MYSQL-BOOTSTRAP-TRIAL'
if (-not $AuthorizeTrial -or $Confirmation -cne $requiredConfirmation) {
    throw 'Script inativo. Exige autorizacao futura explicita, -AuthorizeTrial e a frase de confirmacao.'
}

$mysqld = 'D:\MySQL\bin\mysqld.exe'
$mysql = 'D:\MySQL\bin\mysql.exe'
$mysqladmin = 'D:\MySQL\bin\mysqladmin.exe'
$fixtureRoot = Join-Path $PSScriptRoot '..\test\fixtures\mysql-tls'
$port = 33307
$mysql80ServiceName = 'MYSQL80'
$fairServiceName = 'MYSQL_RENLINK_FEIRA'
$operatorIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$operatorSid = $operatorIdentity.User
$operatorPrincipal = New-Object Security.Principal.WindowsPrincipal -ArgumentList $operatorIdentity
$systemSid = New-Object -TypeName Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-18'
$administratorsSid = New-Object -TypeName Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-32-544'
$allowedSids = @($operatorSid.Value, $systemSid.Value, $administratorsSid.Value)
$trialParent = [IO.Path]::GetFullPath($env:USERPROFILE)
$trialVolumeRoot = [IO.Path]::GetPathRoot($trialParent)
$trialRoot = Join-Path $trialParent ('RenoLinkBootstrapTrial-' + [guid]::NewGuid().ToString('N'))
$createdRoot = $false
$serverProcess = $null
$serverStarted = $false
$clientOptions = $null
$tempPassword = $null
$newPassword = $null
$rotationOutput = $null
$mysqlHistoryFile = [Environment]::GetEnvironmentVariable('MYSQL_HISTFILE', 'Process')
$mysqlHistoryFileChanged = $false
$mysqlPasswordEnvironment = [Environment]::GetEnvironmentVariable('MYSQL_PWD', 'Process')
$mysqlPasswordEnvironmentChanged = $false

function Get-ServiceSnapshot {
    $service = Get-CimInstance Win32_Service -Filter "Name='$mysql80ServiceName'" -ErrorAction Stop
    if (-not $service) {
        throw 'MYSQL80 ausente; estado inicial nao pode ser comparado.'
    }
    return [pscustomobject]@{
        Name = $service.Name
        State = $service.State
        StartMode = $service.StartMode
        StartName = $service.StartName
        PathName = $service.PathName
        ProcessId = [uint32]$service.ProcessId
    }
}

function Get-TrialPortListeners {
    return @(
        Get-NetTCPConnection -State Listen -ErrorAction Stop |
            Where-Object { $_.LocalPort -eq $port }
    )
}

function Assert-ServiceUnchanged($before) {
    $after = Get-ServiceSnapshot
    foreach ($property in @('Name', 'State', 'StartMode', 'StartName', 'PathName', 'ProcessId')) {
        if ($before.$property -cne $after.$property) {
            throw 'O estado do MYSQL80 mudou durante o ensaio; interromper e investigar.'
        }
    }
    if ($after.State -ne 'Running' -or $after.StartMode -ne 'Auto') {
        throw 'MYSQL80 nao esta no estado aprovado.'
    }
}

function New-TrialDirectorySecurity {
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($operatorSid)
    foreach ($sidText in $allowedSids) {
        $sid = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList $sidText
        $inheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
            [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $security.AddAccessRule($rule)
    }
    return $security
}

function New-TrialFileSecurity {
    $security = New-Object System.Security.AccessControl.FileSecurity
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner($operatorSid)
    foreach ($sidText in $allowedSids) {
        $sid = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList $sidText
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.InheritanceFlags]::None,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $security.AddAccessRule($rule)
    }
    return $security
}

function Assert-NoReparseAncestors([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Reparse point detectado no caminho do ensaio.'
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($parent) {
            $current = $parent.FullName
        } else {
            $current = $null
        }
    }
}

function Assert-RestrictedAcl([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Reparse point detectado em caminho do ensaio.'
    }
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (-not $acl.AreAccessRulesProtected) {
        throw 'DACL do caminho nao esta protegida contra heranca.'
    }
    $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($ownerSid -notin $allowedSids) {
        throw 'Proprietario do caminho nao esta na allowlist.'
    }

    $rules = $acl.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    )
    $found = @{}
    foreach ($rule in $rules) {
        $sidText = $rule.IdentityReference.Value
        if ($sidText -notin $allowedSids -or
            $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
            throw 'DACL contem identidade ou regra nao autorizada.'
        }
        $fullControl = [int][System.Security.AccessControl.FileSystemRights]::FullControl
        if (([int]$rule.FileSystemRights -band $fullControl) -ne $fullControl) {
            throw 'DACL nao concede os direitos exigidos a uma identidade autorizada.'
        }
        $found[$sidText] = $true
    }
    foreach ($sidText in $allowedSids) {
        if (-not $found.ContainsKey($sidText)) {
            throw 'DACL nao contem todas as identidades autorizadas.'
        }
    }
}

function New-RestrictedFile([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        throw 'Arquivo temporario ja existe; nenhuma sobrescrita sera feita.'
    }
    $stream = [IO.File]::Open(
        $Path,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )
    $stream.Dispose()
    Set-Acl -LiteralPath $Path -AclObject (New-TrialFileSecurity) -ErrorAction Stop
    Assert-RestrictedAcl $Path
}

function Write-RestrictedTextFile([string]$Path, [string]$Contents) {
    New-RestrictedFile $Path
    Assert-RestrictedAcl $Path
    [IO.File]::WriteAllText($Path, $Contents, [Text.Encoding]::ASCII)
    Assert-RestrictedAcl $Path
}

function Format-MySqlOptionValue([string]$Value) {
    if ($Value -match '[\x00-\x1f"]') {
        throw 'Valor de configuracao MySQL contem caracteres nao permitidos.'
    }
    return '"' + $Value.Replace('\', '\\') + '"'
}

function Write-ClientOptions([string]$Path, [string]$Password, [string]$HostName, [int]$PortNumber, [string]$CaPath) {
    if ([string]::IsNullOrEmpty($Password) -or $Password -match '[\r\n]') {
        throw 'Credencial temporaria ausente ou em formato inesperado.'
    }
    $escaped = $Password.Replace('\', '\\').Replace('"', '\"')
    if (Test-Path -LiteralPath $Path) {
        Assert-RestrictedAcl $Path
    } else {
        New-RestrictedFile $Path
    }
    $contents = "[client]`r`nuser=root`r`npassword=`"$escaped`"`r`nhost=$HostName`r`nport=$PortNumber`r`nprotocol=TCP`r`nssl-mode=VERIFY_IDENTITY`r`nssl-ca=$(Format-MySqlOptionValue $CaPath)`r`n"
    [IO.File]::WriteAllText($Path, $contents, [Text.Encoding]::ASCII)
    Assert-RestrictedAcl $Path
}

function Invoke-Client([string]$Sql) {
    $output = & $mysql "--defaults-file=$clientOptions" `
        --host=127.0.0.1 "--port=$port" --protocol=TCP --user=root `
        --ssl-mode=VERIFY_IDENTITY "--ssl-ca=$caPath" `
        --connect-expired-password --batch --skip-column-names "--execute=$Sql" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'Cliente MySQL falhou; nenhum detalhe ou credencial sera exibido.'
    }
    return ,$output
}

function Stop-TrialServer {
    if (-not $script:serverStarted -or -not $script:serverProcess) {
        return
    }
    if ($script:serverProcess.HasExited) {
        $script:serverStarted = $false
        return
    }
    if ($script:clientOptions -and (Test-Path -LiteralPath $script:clientOptions)) {
        $shutdownOutput = & $mysqladmin "--defaults-file=$script:clientOptions" `
            --host=127.0.0.1 "--port=$port" --protocol=TCP --user=root `
            --ssl-mode=VERIFY_IDENTITY "--ssl-ca=$caPath" shutdown 2>$null
        if ($LASTEXITCODE -eq 0) {
            $script:serverProcess.WaitForExit(30000)
            if ($script:serverProcess.HasExited) {
                $script:serverStarted = $false
                return
            }
        }
    }
    throw "Servidor descartavel ainda esta ativo (PID $($script:serverProcess.Id)); preservar os arquivos protegidos em '$script:trialRoot' e solicitar intervencao."
}

if ($operatorPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Execute o ensaio com a conta proprietaria sem token administrativo.'
}
if ($operatorIdentity.IsSystem -or $operatorIdentity.Name -match '\\(MYSQL80|MYSQL_RENLINK_FEIRA)$') {
    throw 'Identidade de servico nao pode executar o ensaio.'
}
if ($trialParent.StartsWith('\\') -or -not $trialVolumeRoot) {
    throw 'O diretorio do ensaio precisa estar em volume local.'
}
$trialVolume = New-Object -TypeName IO.DriveInfo -ArgumentList $trialVolumeRoot
if ($trialVolume.DriveType -ne [IO.DriveType]::Fixed -or $trialVolume.DriveFormat -ne 'NTFS') {
    throw 'O ensaio exige volume local NTFS para validar ACLs.'
}
if (-not (Test-Path -LiteralPath $mysqld -PathType Leaf) -or
    -not (Test-Path -LiteralPath $mysql -PathType Leaf) -or
    -not (Test-Path -LiteralPath $mysqladmin -PathType Leaf)) {
    throw 'Executaveis MySQL esperados nao encontrados.'
}
if (-not (Test-Path -LiteralPath $fixtureRoot -PathType Container)) {
    throw 'Fixtures sinteticas nao encontradas.'
}
if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw 'APPDATA indisponivel; nao e possivel isolar o arquivo MySQL login paths.'
}
$loginPathFile = Join-Path $env:APPDATA 'MySQL\.mylogin.cnf'
if (Test-Path -LiteralPath $loginPathFile) {
    throw 'Arquivo de login paths do MySQL presente ou caminho APPDATA indisponivel; ensaio bloqueado.'
}
$versionOutput = & $mysqld --no-defaults --version 2>$null
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch 'Ver 8\.0\.46') {
    throw 'mysqld nao corresponde a versao MySQL 8.0.46 aprovada.'
}
foreach ($clientBinary in @($mysql, $mysqladmin)) {
    $clientVersion = & $clientBinary --no-defaults --version 2>$null
    if ($LASTEXITCODE -ne 0 -or $clientVersion -notmatch 'Ver 8\.0\.46') {
        throw 'Cliente MySQL nao corresponde a versao 8.0.46 aprovada.'
    }
}
$fairService = Get-CimInstance Win32_Service -Filter "Name='$fairServiceName'" -ErrorAction Stop
if ($fairService) {
    throw 'Servico Feira ja existe; nenhum recurso sera reutilizado.'
}
if ((Get-TrialPortListeners).Count -gt 0) {
    throw 'Porta exclusiva do ensaio ocupada.'
}

$mysql80Before = Get-ServiceSnapshot
if ($mysql80Before.State -ne 'Running' -or $mysql80Before.StartMode -ne 'Auto') {
    throw 'MYSQL80 nao esta no estado esperado; ensaio bloqueado.'
}
if ($mysql80Before.StartName -ne 'NT AUTHORITY\NetworkService' -or
    $mysql80Before.PathName -notmatch [regex]::Escape($mysqld)) {
    throw 'Identidade ou executavel do MYSQL80 diverge do snapshot aprovado.'
}
$mysqlListenersBefore = @(
    Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -in @(3306, 33060) } |
        Sort-Object LocalAddress, LocalPort, OwningProcess |
        ForEach-Object { "$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }
)

try {
    [Environment]::SetEnvironmentVariable('MYSQL_PWD', $null, 'Process')
    $mysqlPasswordEnvironmentChanged = $true
    [Environment]::SetEnvironmentVariable('MYSQL_HISTFILE', 'NUL', 'Process')
    $mysqlHistoryFileChanged = $true

Assert-NoReparseAncestors $trialParent
Assert-RestrictedAcl $trialParent
$rootSecurity = New-TrialDirectorySecurity
if (Test-Path -LiteralPath $trialRoot) {
    throw 'Caminho GUID do ensaio ja existe.'
}
[void][IO.Directory]::CreateDirectory($trialRoot, $rootSecurity)
$createdRoot = $true
Assert-RestrictedAcl $trialRoot

$directories = @('config', 'data', 'logs', 'certs', 'secrets')
foreach ($name in $directories) {
    $directory = Join-Path $trialRoot $name
    [void][IO.Directory]::CreateDirectory($directory, $rootSecurity)
    Assert-RestrictedAcl $directory
}

$configDirectory = Join-Path $trialRoot 'config'
$dataDirectory = Join-Path $trialRoot 'data'
$logsDirectory = Join-Path $trialRoot 'logs'
$certDirectory = Join-Path $trialRoot 'certs'
$secretDirectory = Join-Path $trialRoot 'secrets'
$configPath = Join-Path $configDirectory 'my.ini'
$errorLog = Join-Path $secretDirectory 'initialize.err'
$clientOptions = Join-Path $secretDirectory 'client.cnf'
$caPath = Join-Path $certDirectory 'ca.pem'
$serverCert = Join-Path $certDirectory 'valid.cert.pem'
$serverKey = Join-Path $certDirectory 'valid.key.pem'
$stdoutPath = Join-Path $logsDirectory 'server.stdout'
$stderrPath = Join-Path $logsDirectory 'server.stderr'
$fixturePaths = @{
    'ca.pem' = $caPath
    'valid.cert.pem' = $serverCert
    'valid.key.pem' = $serverKey
}
foreach ($fixture in $fixturePaths.GetEnumerator()) {
    New-RestrictedFile $fixture.Value
    Copy-Item -LiteralPath (Join-Path $fixtureRoot $fixture.Key) -Destination $fixture.Value -Force
    Assert-RestrictedAcl $fixture.Value
}

$ini = @"
[mysqld]
basedir=D:/MySQL
datadir=$(Format-MySqlOptionValue $dataDirectory.Replace('\', '/'))
port=$port
bind-address=127.0.0.1
mysqlx=OFF
require_secure_transport=ON
ssl-cert=$(Format-MySqlOptionValue $serverCert.Replace('\', '/'))
ssl-key=$(Format-MySqlOptionValue $serverKey.Replace('\', '/'))
log-error=$(Format-MySqlOptionValue $errorLog.Replace('\', '/'))
general-log=OFF
"@
Write-RestrictedTextFile $configPath $ini
New-RestrictedFile $errorLog
New-RestrictedFile $stdoutPath
New-RestrictedFile $stderrPath
if (@(Get-ChildItem -LiteralPath $dataDirectory -Force).Count -ne 0) {
    throw 'Datadir descartavel nao esta vazio; inicializacao recusada.'
}

    & $mysqld "--defaults-file=$configPath" "--datadir=$dataDirectory" `
        "--port=$port" --bind-address=127.0.0.1 --mysqlx=OFF --initialize *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'mysqld --initialize falhou; saida e log nao serao impressos.'
    }
    Assert-RestrictedAcl $errorLog

    $errorText = [IO.File]::ReadAllText($errorLog)
    $passwordMatches = [regex]::Matches(
        $errorText,
        'A temporary password is generated for root@localhost: (\S+)'
    )
    $errorText = $null
    if ($passwordMatches.Count -ne 1) {
        throw 'Senha temporaria nao pode ser identificada de forma unica; interromper.'
    }
    $tempPassword = $passwordMatches[0].Groups[1].Value
    $passwordMatches = $null
    Write-ClientOptions $clientOptions $tempPassword '127.0.0.1' $port $caPath
    $tempPassword = $null

    $serverProcess = Start-Process -FilePath $mysqld `
        -ArgumentList @(
            "--defaults-file=`"$configPath`"",
            "--datadir=`"$dataDirectory`"",
            "--port=$port",
            '--bind-address=127.0.0.1',
            '--mysqlx=OFF'
        ) `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -NoNewWindow -PassThru
    $serverStarted = $true
    Assert-RestrictedAcl $stdoutPath
    Assert-RestrictedAcl $stderrPath

    $listenerFound = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($serverProcess.HasExited) {
            throw 'Servidor descartavel encerrou antes de abrir o listener esperado.'
        }
        $listeners = Get-TrialPortListeners
        if ($listeners.Count -eq 1 -and
            $listeners[0].OwningProcess -eq $serverProcess.Id -and
            $listeners[0].LocalAddress -eq '127.0.0.1') {
            $listenerFound = $true
            break
        }
        if ($listeners.Count -gt 0 -and
            ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $serverProcess.Id -or
             $listeners[0].LocalAddress -ne '127.0.0.1')) {
            throw 'Listener inesperado na porta descartavel; nenhum cliente sera conectado.'
        }
        Start-Sleep -Seconds 1
    }
    if (-not $listenerFound) {
        throw 'Listener loopback do processo descartavel nao foi confirmado.'
    }

    $rotationOutput = Invoke-Client "ALTER USER 'root'@'localhost' IDENTIFIED BY RANDOM PASSWORD"
    $rows = @($rotationOutput | Where-Object { $_ -is [string] -and $_.Contains("`t") })
    if ($rows.Count -ne 1) {
        throw 'Formato da resposta de rotacao inesperado; nao exibir nem persistir a resposta.'
    }
    $columns = $rows[0] -split "`t"
    if ($columns.Count -ne 2 -or $columns[0] -cne 'root@localhost' -or
        [string]::IsNullOrEmpty($columns[1]) -or $columns[1] -match '[\r\n]') {
        throw 'Senha gerada nao pode ser isolada com seguranca; interromper.'
    }
    $newPassword = $columns[1]
    $rotationOutput = $null
    $rows = $null
    $columns = $null
    Write-ClientOptions $clientOptions $newPassword '127.0.0.1' $port $caPath
    $newPassword = $null

    $proof = Invoke-Client 'SELECT @@datadir, @@port'
    if (@($proof).Count -ne 1) {
        throw 'Resposta de identidade do destino descartavel inesperada.'
    }
    $proofFields = ([string]$proof[0]) -split "`t"
    if ($proofFields.Count -ne 2) {
        throw 'Campos de identidade do destino descartavel inesperados.'
    }
    $expectedDataPath = [IO.Path]::GetFullPath($dataDirectory).TrimEnd('\') + '\'
    $actualDataPath = [IO.Path]::GetFullPath($proofFields[0]).TrimEnd('\') + '\'
    if (-not $actualDataPath.Equals($expectedDataPath, [StringComparison]::OrdinalIgnoreCase) -or
        $proofFields[1] -ne [string]$port) {
        throw 'Autenticacao ou identidade do datadir/porta descartavel nao comprovada.'
    }
    $proof = $null
    $proofFields = $null

    $result = Invoke-Client 'SELECT 1'
    if (@($result).Count -ne 1 -or [string]$result[0] -ne '1') {
        throw 'Consulta de prova apos rotacao falhou.'
    }
    $result = $null

    Stop-TrialServer
    Assert-ServiceUnchanged $mysql80Before
    $mysqlListenersAfter = @(
        Get-NetTCPConnection -State Listen -ErrorAction Stop |
            Where-Object { $_.LocalPort -in @(3306, 33060) } |
            Sort-Object LocalAddress, LocalPort, OwningProcess |
            ForEach-Object { "$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }
    )
    if (Compare-Object $mysqlListenersBefore $mysqlListenersAfter) {
        throw 'Listeners do MYSQL80 mudaram durante o ensaio.'
    }
    if ((Get-TrialPortListeners).Count -gt 0) {
        throw 'Porta do ensaio continua em listen apos shutdown.'
    }
}
finally {
    if ($mysqlHistoryFileChanged) {
        [Environment]::SetEnvironmentVariable('MYSQL_HISTFILE', $mysqlHistoryFile, 'Process')
    }
    if ($mysqlPasswordEnvironmentChanged) {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $mysqlPasswordEnvironment, 'Process')
    }
    $tempPassword = $null
    $newPassword = $null
    $rotationOutput = $null
    if ($serverStarted -and $serverProcess -and -not $serverProcess.HasExited) {
        try {
            Stop-TrialServer
        } catch {
            Write-Warning $_.Exception.Message
        }
    }
    if ($createdRoot -and (-not $serverProcess -or $serverProcess.HasExited)) {
        if ((Split-Path -Parent $trialRoot) -ne $trialParent -or
            (Split-Path -Leaf $trialRoot) -notmatch '^RenoLinkBootstrapTrial-[0-9a-f]{32}$') {
            throw 'Caminho de limpeza nao corresponde ao GUID temporario; arquivos preservados.'
        }
        Remove-Item -LiteralPath $trialRoot -Recurse -Force
    } elseif ($createdRoot) {
        Write-Warning "Processo ainda ativo; arquivos protegidos preservados em '$trialRoot'."
    }
    if ($serverProcess) {
        $serverProcess.Dispose()
    }
}

Write-Output 'Ensaio MySQL descartavel concluido; instancia parada e arquivos temporarios removidos.'
