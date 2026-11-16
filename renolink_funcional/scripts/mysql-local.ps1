param(
    [ValidateSet('Setup', 'Test', 'Resume', 'Inspect')]
    [string]$Mode = 'Setup'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$secretPath = Join-Path $projectRoot '.env.mysql.local.clixml'
$variableNames = @(
    'RENOLINK_SETUP_ADMIN_USER', 'RENOLINK_SETUP_ADMIN_PASSWORD',
    'RENOLINK_SETUP_APP_PASSWORD', 'RENOLINK_SETUP_MIGRATOR_PASSWORD', 'RENOLINK_SETUP_TESTER_PASSWORD',
    'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_SSL', 'MYSQL_SSL_CA',
    'TEST_MYSQL_HOST', 'TEST_MYSQL_PORT', 'TEST_MYSQL_DATABASE', 'TEST_MYSQL_USER', 'TEST_MYSQL_PASSWORD', 'TEST_MYSQL_SSL', 'TEST_MYSQL_SSL_CA',
    'RENOLINK_TEST_MYSQL_APPROVED', 'RENOLINK_TEST_MYSQL_RESUME', 'RENOLINK_MYSQL_MIGRATION_APPROVED', 'NODE_ENV', 'COOKIE_SECURE', 'APP_ORIGIN', 'STORAGE_DRIVER'
)
$previous = @{}
foreach ($name in $variableNames) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Set-ProcessValue([string]$Name, [string]$Value) { [Environment]::SetEnvironmentVariable($Name, $Value, 'Process') }
function Invoke-NodeChecked([string[]]$Arguments) {
    & node @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Operacao interrompida. Os recursos existentes foram preservados; consulte o relatorio sem segredos.' }
}
function New-LocalCredential([string]$UserName) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $password = 'Aa1!' + ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
    $secure = ConvertTo-SecureString -String $password -AsPlainText -Force
    $password = $null
    return [PSCredential]::new($UserName, $secure)
}
Push-Location $projectRoot
try {
    if ($Mode -eq 'Setup') {
        if (Test-Path -LiteralPath $secretPath) { throw 'Cofre local ja existe. Nao sera sobrescrito. Use -Mode Inspect para verificar o estado.' }
        $adminUser = Read-Host 'Usuario administrativo MySQL autorizado (somente local)'
        $adminSecure = Read-Host 'Senha administrativa MySQL (entrada oculta)' -AsSecureString
        $admin = [PSCredential]::new($adminUser, $adminSecure)
        Set-ProcessValue 'RENOLINK_SETUP_ADMIN_USER' $admin.UserName
        Set-ProcessValue 'RENOLINK_SETUP_ADMIN_PASSWORD' $admin.GetNetworkCredential().Password
        Invoke-NodeChecked -Arguments @('scripts/provision-mysql.js', '--check')
        $credentials = @{
            app = (New-LocalCredential 'renolink_app')
            migrator = (New-LocalCredential 'renolink_migrator')
            tester = (New-LocalCredential 'renolink_tester')
        }
        # Windows DPAPI: passwords decrypt only with this Windows user on this computer.
        # Save BEFORE CREATE USER so partial failures never lose the new credentials.
        $credentials | Export-Clixml -LiteralPath $secretPath -NoClobber
        Set-ProcessValue 'RENOLINK_SETUP_APP_PASSWORD' $credentials.app.GetNetworkCredential().Password
        Set-ProcessValue 'RENOLINK_SETUP_MIGRATOR_PASSWORD' $credentials.migrator.GetNetworkCredential().Password
        Set-ProcessValue 'RENOLINK_SETUP_TESTER_PASSWORD' $credentials.tester.GetNetworkCredential().Password
        Invoke-NodeChecked -Arguments @('scripts/provision-mysql.js', '--apply')
        foreach ($name in $variableNames | Where-Object { $_ -like 'RENOLINK_SETUP_*' }) { Set-ProcessValue $name $null }
        $admin = $null; $adminSecure = $null
    } else {
        $credentials = Import-Clixml -LiteralPath $secretPath
    }
    Set-ProcessValue 'NODE_ENV' 'development'
    Set-ProcessValue 'STORAGE_DRIVER' 'mysql'
    Set-ProcessValue 'COOKIE_SECURE' '0'
    Set-ProcessValue 'APP_ORIGIN' $null
    Set-ProcessValue 'MYSQL_HOST' '127.0.0.1'
    Set-ProcessValue 'MYSQL_PORT' '3306'
    Set-ProcessValue 'MYSQL_DATABASE' 'renolink_dev'
    Set-ProcessValue 'MYSQL_USER' $credentials.app.UserName
    Set-ProcessValue 'MYSQL_PASSWORD' $credentials.app.GetNetworkCredential().Password
    Set-ProcessValue 'MYSQL_SSL' '0'
    Set-ProcessValue 'MYSQL_SSL_CA' $null
    Set-ProcessValue 'TEST_MYSQL_HOST' '127.0.0.1'
    Set-ProcessValue 'TEST_MYSQL_PORT' '3306'
    Set-ProcessValue 'TEST_MYSQL_DATABASE' 'renolink_test'
    Set-ProcessValue 'TEST_MYSQL_USER' $credentials.tester.UserName
    Set-ProcessValue 'TEST_MYSQL_PASSWORD' $credentials.tester.GetNetworkCredential().Password
    Set-ProcessValue 'TEST_MYSQL_SSL' '0'
    Set-ProcessValue 'TEST_MYSQL_SSL_CA' $null
    Set-ProcessValue 'RENOLINK_MYSQL_MIGRATION_APPROVED' $null
    if ($Mode -ne 'Inspect') {
        Set-ProcessValue 'RENOLINK_TEST_MYSQL_APPROVED' '1'
        Set-ProcessValue 'RENOLINK_TEST_MYSQL_RESUME' $(if ($Mode -eq 'Resume') { '1' } else { $null })
        Invoke-NodeChecked -Arguments @('--test', 'test/mysql.integration.test.js')
    }
    Invoke-NodeChecked -Arguments @('scripts/inspect-mysql.js')
} finally {
    foreach ($name in $variableNames) { Set-ProcessValue $name $previous[$name] }
    $credentials = $null; $admin = $null; $adminSecure = $null
    Pop-Location
}
