param(
    [ValidateSet('Plan','ApplySchema','GrantStaff')][string]$Mode = 'Plan',
    [switch]$Approved,
    [int]$UserId = 0,
    [ValidateSet('admin','support')][string]$AccessRole = 'admin'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
$names = @('MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','NODE_ENV','RENOLINK_PHASE5_DEV_SCHEMA_APPROVED','RENOLINK_STAFF_PROVISION_APPROVED')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
try {
    if ($Mode -eq 'Plan') {
        & node 'scripts/migrate-phase5.js'
        if ($LASTEXITCODE -ne 0) { throw 'Cannot read migration plan.' }
        return
    }
    if ($Mode -eq 'GrantStaff') {
        if (-not $Approved -or $AccessRole -ne 'admin') { throw 'Use o assistente de primeiro administrador apos autorizacao explicita.' }
        & (Join-Path $PSScriptRoot 'first-admin.ps1') -Mode Grant
        return
    }
    if (-not $Approved) { throw 'Explicit approval is required. No operation executed.' }
    if ($Mode -eq 'GrantStaff' -and $UserId -lt 1) { throw 'Choose an existing user explicitly.' }
    $vault = Import-Clixml -LiteralPath '.env.mysql.local.clixml'
    if ($vault.migrator.UserName -ne 'renolink_migrator') { throw 'Unexpected operator account.' }
    $values = @{ MYSQL_HOST='127.0.0.1'; MYSQL_PORT='3306'; MYSQL_DATABASE='renolink_dev'; MYSQL_USER='renolink_migrator'; MYSQL_PASSWORD=$vault.migrator.GetNetworkCredential().Password; MYSQL_SSL='0'; MYSQL_SSL_CA=$null; NODE_ENV='development'; RENOLINK_PHASE5_DEV_SCHEMA_APPROVED=$null; RENOLINK_STAFF_PROVISION_APPROVED=$null }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$values[$name],'Process') }
    if ($Mode -eq 'ApplySchema') {
        [Environment]::SetEnvironmentVariable('RENOLINK_PHASE5_DEV_SCHEMA_APPROVED','1','Process')
        & (Join-Path $PSScriptRoot 'activate-phase5.ps1')
    }
    if ($LASTEXITCODE -ne 0) { throw 'Operator action stopped. No automatic retry or cleanup.' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
    $vault=$null; $values=$null
    Pop-Location
}
