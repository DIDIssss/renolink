param([ValidateSet('Run','SnapshotBefore','SnapshotAfter','Functional','Legacy')][string]$Mode='Run',[ValidatePattern('^[a-z0-9-]{1,32}$')][string]$RunId='round1')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$names=@('TEST_MYSQL_HOST','TEST_MYSQL_PORT','TEST_MYSQL_DATABASE','TEST_MYSQL_USER','TEST_MYSQL_PASSWORD','TEST_MYSQL_SSL','TEST_MYSQL_SSL_CA','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','RENOLINK_PHASE83_APPROVED','PHASE83_RUN_ID','NODE_ENV','APP_ORIGIN','COOKIE_SECURE','UV_THREADPOOL_SIZE','RENOLINK_CRYPTO_CONCURRENCY')
$names+=@('RENOLINK_PHASE82_APPROVED')
$previous=@{};foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
Push-Location $root
try{
 $vault=Import-Clixml -LiteralPath '.env.mysql.local.clixml'
 $values=@{NODE_ENV='development';COOKIE_SECURE='0';RENOLINK_PHASE83_APPROVED='1';RENOLINK_PHASE82_APPROVED='1';PHASE83_RUN_ID=$RunId;UV_THREADPOOL_SIZE='4';RENOLINK_CRYPTO_CONCURRENCY='4'}
 if($Mode -like 'Snapshot*'){
  if($vault.app.UserName -ne 'renolink_app'){throw 'Conta inesperada.'}
  $values.MYSQL_HOST='127.0.0.1';$values.MYSQL_PORT='3306';$values.MYSQL_DATABASE='renolink_dev';$values.MYSQL_USER='renolink_app';$values.MYSQL_PASSWORD=$vault.app.GetNetworkCredential().Password;$values.MYSQL_SSL='0'
 }else{
  if($vault.tester.UserName -ne 'renolink_tester'){throw 'Conta inesperada.'}
  $values.TEST_MYSQL_HOST='127.0.0.1';$values.TEST_MYSQL_PORT='3306';$values.TEST_MYSQL_DATABASE='renolink_test';$values.TEST_MYSQL_USER='renolink_tester';$values.TEST_MYSQL_PASSWORD=$vault.tester.GetNetworkCredential().Password;$values.TEST_MYSQL_SSL='0'
 }
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$values[$name],'Process')}
 switch($Mode){
 'SnapshotBefore'{& node scripts/phase7-dev-snapshot.js before ('phase83-'+$RunId)}
 'SnapshotAfter'{& node scripts/phase7-dev-snapshot.js after ('phase83-'+$RunId)}
 'Functional'{& node --test --test-concurrency=1 test/phase82.mysql.test.js test/phase83.mysql.test.js}
 'Run'{& node scripts/phase83-benchmark.js}
 'Legacy'{& node scripts/phase83-legacy.js}
 }
 if($LASTEXITCODE -ne 0){throw 'Fase 8.3 interrompida; verificar evidencias locais.'}
}finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')};$vault=$null;$values=$null;Pop-Location}
