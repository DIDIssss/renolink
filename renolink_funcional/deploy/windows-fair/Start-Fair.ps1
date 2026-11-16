param(
    [switch]$AuthorizeActivation
)

$ErrorActionPreference = 'Stop'
if (-not $AuthorizeActivation) {
    throw 'Ativacao recusada. Exige autorizacao separada e -AuthorizeActivation.'
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$required = @(
    'NODE_ENV', 'APP_ENV', 'RENOLINK_FAIR_SERVICE_ACCOUNT',
    'RENOLINK_FAIR_DB_ROLE',
    'STORAGE_DRIVER', 'PORT', 'APP_ORIGIN',
    'COOKIE_SECURE', 'TRUST_PROXY', 'APP_LOG_FORMAT', 'MYSQL_HOST',
    'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD',
    'MYSQL_SSL', 'MYSQL_SSL_CA', 'RENOLINK_FAIR_MYSQL_SERVER_UUID', 'RENOLINK_FAIR_LOG_DIR',
    'RENOLINK_FAIR_BACKUP_DIR'
)
foreach ($name in $required) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
        throw "Configuracao obrigatoria ausente: $name"
    }
}

if ($env:NODE_ENV -ne 'production' -or $env:APP_ENV -ne 'fair' -or
    $env:RENOLINK_FAIR_DB_ROLE -ne 'runtime' -or
    $env:STORAGE_DRIVER -ne 'mysql' -or $env:PORT -ne '3100' -or
    $env:COOKIE_SECURE -ne '1' -or $env:TRUST_PROXY -ne 'loopback' -or
    $env:APP_LOG_FORMAT -ne 'json') {
    throw 'Configuracao de aplicacao nao corresponde ao perfil isolado da feira.'
}
if ($env:MYSQL_HOST -ne '127.0.0.1' -or $env:MYSQL_PORT -ne '3307' -or
    $env:MYSQL_DATABASE -ne 'renolink_feira' -or
    $env:MYSQL_USER -ne 'renolink_feira_app' -or $env:MYSQL_SSL -ne '1' -or
    $env:RENOLINK_FAIR_MYSQL_SERVER_UUID -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' -or
    $env:RENOLINK_FAIR_MYSQL_SERVER_UUID -match '^0{8}-0{4}-0{4}-0{4}-0{12}$') {
    throw 'Destino MySQL nao corresponde ao perfil exclusivo da feira.'
}
if ($env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') {
    throw 'Validacao TLS globalmente desativada; inicio recusado.'
}
if ($env:RENOLINK_FAIR_SERVICE_ACCOUNT -ne 'renolink_fair_svc') {
    throw 'Identidade configurada nao corresponde a conta dedicada da feira.'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal -ArgumentList $identity
if (-not $identity.Name.EndsWith('\renolink_fair_svc', [StringComparison]::OrdinalIgnoreCase) -or
    $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Inicio permitido somente pela conta dedicada, sem token administrativo.'
}

$origin = $null
if (-not [Uri]::TryCreate($env:APP_ORIGIN, [UriKind]::Absolute, [ref]$origin) -or
    $origin.Scheme -ne 'https' -or $origin.AbsolutePath -ne '/' -or
    $origin.Query -or $origin.Fragment -or $origin.UserInfo -or
    $origin.GetLeftPart([UriPartial]::Authority) -cne $env:APP_ORIGIN -or
    $origin.Host -match '\.invalid$') {
    throw 'APP_ORIGIN deve ser uma origem HTTPS canonica aprovada.'
}
if (-not (Test-Path -LiteralPath $env:MYSQL_SSL_CA -PathType Leaf)) {
    throw 'O certificado CA MySQL configurado nao foi encontrado.'
}

foreach ($directory in @($env:RENOLINK_FAIR_LOG_DIR, $env:RENOLINK_FAIR_BACKUP_DIR)) {
    $fullPath = [IO.Path]::GetFullPath($directory)
    if ($fullPath.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($projectRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Logs e backups devem ficar fora do diretorio do projeto.'
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
        throw 'Os diretorios protegidos precisam ser provisionados previamente.'
    }
}

$node = Get-Command node -ErrorAction Stop
$nodeVersion = (& $node.Source --version).Trim()
if ($nodeVersion -notmatch '^v(\d+)\.(\d+)\.') {
    throw 'Versao Node nao reconhecida.'
}
$major = [int]$Matches[1]
$minor = [int]$Matches[2]
if ($major -ne 24 -or $minor -lt 19) {
    throw 'A aplicacao exige Node 24.19 ou superior na linha 24.'
}

$listener = Get-NetTCPConnection -State Listen -LocalPort 3100 -ErrorAction SilentlyContinue
if ($listener) {
    throw 'A porta local 3100 ja esta ocupada; nenhum processo sera encerrado.'
}

$logName = 'renolink-fair-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log'
$logPath = Join-Path $env:RENOLINK_FAIR_LOG_DIR $logName
Push-Location $projectRoot
try {
    Write-Output 'Iniciando RenoLink Feira em primeiro plano; Ctrl+C encerra graciosamente.'
    & $node.Source (Join-Path $projectRoot 'server.js') *> $logPath
    if ($LASTEXITCODE -ne 0) {
        throw "Node encerrou com codigo $LASTEXITCODE. Verifique o log protegido."
    }
}
finally {
    Pop-Location
}
