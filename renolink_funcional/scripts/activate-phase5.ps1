$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$names=@('MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','NODE_ENV','RENOLINK_PHASE5_DEV_SCHEMA_APPROVED','RENOLINK_STAFF_PROVISION_APPROVED')
$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
Push-Location $projectRoot
try{
 $sqlHash=(Get-FileHash -LiteralPath 'database/mysql/002_phase5.sql' -Algorithm SHA256).Hash.ToLowerInvariant()
 if($sqlHash -ne '48ed1afad24d682df513bcf671a4e3533f9ef487d62b47d2b49f247b5fcab0fd'){throw 'Reviewed SQL hash differs. Stop.'}
 $appPidText=[IO.File]::ReadAllText((Join-Path $projectRoot 'data/runtime/mysql-app.pid')).Trim()
 if($appPidText -notmatch '^\d+$'){throw 'Invalid recorded application PID.'}
 $appProcess=Get-CimInstance Win32_Process -Filter "ProcessId = $appPidText" -ErrorAction Stop
 if($null -eq $appProcess -or $appProcess.Name -ne 'node.exe' -or $appProcess.CommandLine -notmatch 'server\.js\s*$'){throw 'Application process identity not confirmed. Stop.'}
 $listeners=@(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction Stop)
 if($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne [int]$appPidText -or $listeners[0].LocalAddress -ne '127.0.0.1'){throw 'Unexpected listener. Stop.'}
 $runtimeProcesses=@(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'nodejs.exe' OR Name = 'bun.exe' OR Name = 'deno.exe'" -ErrorAction Stop)
 if($runtimeProcesses.Count -ne 1 -or $runtimeProcesses[0].ProcessId -ne [int]$appPidText){throw 'Another runtime exists. Stop.'}
 # Only the previously identified local application is stopped for this maintenance window.
 Stop-Process -Id ([int]$appPidText) -ErrorAction Stop
 Wait-Process -Id ([int]$appPidText) -ErrorAction SilentlyContinue
 $vault=Import-Clixml -LiteralPath '.env.mysql.local.clixml'
 if($vault.app.UserName -ne 'renolink_app' -or $vault.migrator.UserName -ne 'renolink_migrator'){throw 'Unexpected credentials. Stop.'}
 $values=@{MYSQL_HOST='127.0.0.1';MYSQL_PORT='3306';MYSQL_DATABASE='renolink_dev';MYSQL_USER='renolink_app';MYSQL_PASSWORD=$vault.app.GetNetworkCredential().Password;MYSQL_SSL='0';MYSQL_SSL_CA=$null;NODE_ENV='development';RENOLINK_PHASE5_DEV_SCHEMA_APPROVED=$null;RENOLINK_STAFF_PROVISION_APPROVED=$null}
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$values[$name],'Process')}
 & node 'scripts/phase5-app-connections.js'
 if($LASTEXITCODE -ne 0){throw 'Application concurrency verification failed. Stop.'}
 [Environment]::SetEnvironmentVariable('MYSQL_USER','renolink_migrator','Process')
 [Environment]::SetEnvironmentVariable('MYSQL_PASSWORD',$vault.migrator.GetNetworkCredential().Password,'Process')
 [Environment]::SetEnvironmentVariable('RENOLINK_PHASE5_DEV_SCHEMA_APPROVED','1','Process')
 & node 'scripts/activate-phase5.js'
 if($LASTEXITCODE -ne 0){throw 'Activation stopped. No automatic retry or schema cleanup.'}
}finally{
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
 $vault=$null;$values=$null
 Pop-Location
}