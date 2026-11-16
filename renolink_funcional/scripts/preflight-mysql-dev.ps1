$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$names = @('MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','NODE_ENV','RENOLINK_MYSQL_MIGRATION_APPROVED')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$streams = @()
Push-Location $projectRoot
try {
    foreach ($file in @('data/db.json','data/runtime/db.json')) {
        $streams += [IO.File]::Open((Join-Path $projectRoot $file), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    }
    $vault = Import-Clixml -LiteralPath (Join-Path $projectRoot '.env.mysql.local.clixml')
    if ($vault.migrator.UserName -ne 'renolink_migrator') { throw 'Unexpected credential. Stop.' }
    $values = @{
        MYSQL_HOST='127.0.0.1'; MYSQL_PORT='3306'; MYSQL_DATABASE='renolink_dev'; MYSQL_USER=$vault.migrator.UserName
        MYSQL_PASSWORD=$vault.migrator.GetNetworkCredential().Password; MYSQL_SSL='0'; MYSQL_SSL_CA=$null
        NODE_ENV='development'; RENOLINK_MYSQL_MIGRATION_APPROVED=$null
    }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process') }
    & node 'scripts/preflight-mysql-dev.js'
    if ($LASTEXITCODE -ne 0) { throw 'Preflight failed. No import executed.' }
} finally {
    foreach ($stream in $streams) { $stream.Dispose() }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    $vault = $null; $values = $null
    Pop-Location
}
