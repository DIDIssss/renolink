param([ValidateSet('CheckFiles','Migrate','Verify','Inspect','Start','Background')][string]$Mode = 'Start')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$names = @('MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','TEST_MYSQL_HOST','TEST_MYSQL_PORT','TEST_MYSQL_DATABASE','TEST_MYSQL_USER','TEST_MYSQL_PASSWORD','TEST_MYSQL_SSL','TEST_MYSQL_SSL_CA','NODE_ENV','STORAGE_DRIVER','COOKIE_SECURE','APP_ORIGIN','PORT','RENOLINK_MYSQL_MIGRATION_APPROVED')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$streams = @()
Push-Location $projectRoot
try {
    if ($Mode -in @('CheckFiles','Migrate')) {
        . (Join-Path $PSScriptRoot 'diagnose-json-lock.ps1') -LoadOnly
        foreach ($sample in 1..2) {
            if (Test-Path -LiteralPath 'data/runtime/db.json.lock') { throw 'JSON lock exists. Stop.' }
            if (@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'nodejs.exe' OR Name = 'bun.exe' OR Name = 'deno.exe'" -ErrorAction Stop).Count -gt 0) { throw 'Runtime active. Stop.' }
            $files = [string[]]@((Join-Path $projectRoot 'data/db.json'), (Join-Path $projectRoot 'data/runtime/db.json'))
            $users = @([RenoLinkLockResourceQuery]::Query($files))
            if ($users.Count -gt 0) { throw 'JSON resource in use. Stop.' }
            if ($sample -eq 1) { Start-Sleep -Seconds 10 }
        }
        if ($Mode -eq 'CheckFiles') {
            Write-Output 'Verificacao isolada aprovada: nenhum handle proprio aberto, nenhum runtime ativo, nenhum usuario dos JSONs, lock ausente; nenhuma alteracao de dados.'
            return
        }
        # Query external users BEFORE opening our own read guards: Restart Manager
        # otherwise reports DetectedSelf (16). Preserve its rejection behavior.
        foreach ($file in @('data/db.json','data/runtime/db.json')) {
            $streams += [IO.File]::Open((Join-Path $projectRoot $file), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        }
        if (Test-Path -LiteralPath 'data/runtime/db.json.lock') { throw 'JSON lock appeared. Stop.' }
    }
    $vault = Import-Clixml -LiteralPath (Join-Path $projectRoot '.env.mysql.local.clixml')
    $credential = if ($Mode -eq 'Migrate') { $vault.migrator } else { $vault.app }
    $expectedUser = if ($Mode -eq 'Migrate') { 'renolink_migrator' } else { 'renolink_app' }
    if ($credential.UserName -ne $expectedUser) { throw 'Unexpected credential. Stop.' }
    $values = @{
        MYSQL_HOST='127.0.0.1'; MYSQL_PORT='3306'; MYSQL_DATABASE='renolink_dev'; MYSQL_USER=$credential.UserName
        MYSQL_PASSWORD=$credential.GetNetworkCredential().Password; MYSQL_SSL='0'; MYSQL_SSL_CA=$null
        NODE_ENV='development'; STORAGE_DRIVER='mysql'; COOKIE_SECURE='0'; APP_ORIGIN=$null; PORT='3000'; RENOLINK_MYSQL_MIGRATION_APPROVED=$null
    }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process') }
    if ($Mode -eq 'Verify') {
        if ($vault.tester.UserName -ne 'renolink_tester') { throw 'Unexpected test credential. Stop.' }
        $testValues = @{ TEST_MYSQL_HOST='127.0.0.1'; TEST_MYSQL_PORT='3306'; TEST_MYSQL_DATABASE='renolink_test'; TEST_MYSQL_USER=$vault.tester.UserName; TEST_MYSQL_PASSWORD=$vault.tester.GetNetworkCredential().Password; TEST_MYSQL_SSL='0'; TEST_MYSQL_SSL_CA=$null }
        foreach ($name in $testValues.Keys) { [Environment]::SetEnvironmentVariable($name, $testValues[$name], 'Process') }
    }
    if ($Mode -eq 'Migrate') {
        & node 'scripts/preflight-mysql-dev.js'
        if ($LASTEXITCODE -ne 0) { throw 'Preflight failed. Stop.' }
        [Environment]::SetEnvironmentVariable('RENOLINK_MYSQL_MIGRATION_APPROVED', '1', 'Process')
        & node 'scripts/migrate-mysql-dev.js'
        if ($LASTEXITCODE -ne 0) { throw 'Migration failed. Stop.' }
    } elseif ($Mode -eq 'Verify') {
        & node 'scripts/verify-mysql-dev.js'
        if ($LASTEXITCODE -ne 0) { throw 'Functional verification failed. Stop.' }
    } elseif ($Mode -eq 'Inspect') {
        & node 'scripts/inspect-mysql-dev.js'
        if ($LASTEXITCODE -ne 0) { throw 'Live verification failed. Stop.' }
    } elseif ($Mode -eq 'Background') {
        $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
        if ($listener) { throw 'Port 3000 is already in use. Stop.' }
        $nodePath = (Get-Command node -ErrorAction Stop).Source
        $app = Start-Process -FilePath $nodePath -ArgumentList @('server.js') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $projectRoot 'data/runtime/mysql-app.stdout.log') -RedirectStandardError (Join-Path $projectRoot 'data/runtime/mysql-app.stderr.log')
        $app.Id | Set-Content -LiteralPath 'data/runtime/mysql-app.pid'
        $ready = $false
        foreach ($attempt in 1..20) {
            if ($app.HasExited) { throw 'Application exited during startup. Stop.' }
            try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/stats' -TimeoutSec 2; if ($response.StatusCode -eq 200) { $ready = $true; break } } catch { Start-Sleep -Milliseconds 250 }
        }
        if (-not $ready) { throw 'Local application health check failed. Stop.' }
        Write-Output ('RenoLink MySQL local: http://127.0.0.1:3000 (PID ' + $app.Id + ')')
    } else {
        Write-Output 'RenoLink MySQL local: http://127.0.0.1:3000 - Ctrl+C para encerrar.'
        & node 'server.js'
        if ($LASTEXITCODE -ne 0) { throw 'Application startup failed.' }
    }
} finally {
    foreach ($stream in $streams) { $stream.Dispose() }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    $vault = $null; $credential = $null; $values = $null; $testValues = $null
    Pop-Location
}
