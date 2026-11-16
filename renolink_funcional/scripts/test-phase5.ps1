param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$names = @('TEST_MYSQL_HOST','TEST_MYSQL_PORT','TEST_MYSQL_DATABASE','TEST_MYSQL_USER','TEST_MYSQL_PASSWORD','TEST_MYSQL_SSL','TEST_MYSQL_SSL_CA','RENOLINK_PHASE5_TEST_APPROVED','NODE_ENV','COOKIE_SECURE','APP_ORIGIN')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
Push-Location $projectRoot
try {
    $vault = Import-Clixml -LiteralPath '.env.mysql.local.clixml'
    if ($vault.tester.UserName -ne 'renolink_tester') { throw 'Unexpected test account.' }
    $values = @{ TEST_MYSQL_HOST='127.0.0.1'; TEST_MYSQL_PORT='3306'; TEST_MYSQL_DATABASE='renolink_test'; TEST_MYSQL_USER='renolink_tester'; TEST_MYSQL_PASSWORD=$vault.tester.GetNetworkCredential().Password; TEST_MYSQL_SSL='0'; TEST_MYSQL_SSL_CA=$null; RENOLINK_PHASE5_TEST_APPROVED='1'; NODE_ENV='development'; COOKIE_SECURE='0'; APP_ORIGIN=$null }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$values[$name],'Process') }
    if ($Browser) { & node 'test/phase5.browser.js' } else { & node --test 'test/phase5.mysql.test.js' }
    if ($LASTEXITCODE -ne 0) { throw 'Phase 5 isolated test failed. Inspect the result; no dev schema change was executed.' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') }
    $vault=$null; $values=$null
    Pop-Location
}
