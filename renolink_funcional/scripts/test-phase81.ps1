param([ValidateSet('Init','Before','After','Candidate','Balanced','Explain','Verify','Functional','Pages','Hash','SnapshotBefore','SnapshotAfter')][string]$Mode='Init',[ValidatePattern('^[a-z0-9-]{1,40}$')][string]$RunId='default')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$names=@('TEST_MYSQL_HOST','TEST_MYSQL_PORT','TEST_MYSQL_DATABASE','TEST_MYSQL_USER','TEST_MYSQL_PASSWORD','TEST_MYSQL_SSL','TEST_MYSQL_SSL_CA','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','RENOLINK_PHASE81_APPROVED','PHASE81_RUN_ID','NODE_ENV','COOKIE_SECURE','APP_ORIGIN')
$previous=@{};foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
Push-Location $root
try{
 $vault=Import-Clixml -LiteralPath '.env.mysql.local.clixml'
 $values=@{NODE_ENV='development';COOKIE_SECURE='0';APP_ORIGIN=$null;RENOLINK_PHASE81_APPROVED='1';PHASE81_RUN_ID=$RunId}
 if($Mode -in @('SnapshotBefore','SnapshotAfter')){
  if($vault.app.UserName -ne 'renolink_app'){throw 'Conta de leitura inesperada.'}
  $values.MYSQL_HOST='127.0.0.1';$values.MYSQL_PORT='3306';$values.MYSQL_DATABASE='renolink_dev';$values.MYSQL_USER='renolink_app';$values.MYSQL_PASSWORD=$vault.app.GetNetworkCredential().Password;$values.MYSQL_SSL='0'
 }else{
  if($vault.tester.UserName -ne 'renolink_tester'){throw 'Conta de teste inesperada.'}
  $values.TEST_MYSQL_HOST='127.0.0.1';$values.TEST_MYSQL_PORT='3306';$values.TEST_MYSQL_DATABASE='renolink_test';$values.TEST_MYSQL_USER='renolink_tester';$values.TEST_MYSQL_PASSWORD=$vault.tester.GetNetworkCredential().Password;$values.TEST_MYSQL_SSL='0'
 }
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$values[$name],'Process')}
 switch($Mode){
  'SnapshotBefore'{$prefix=if($RunId -eq 'default'){'phase81'}else{'phase81-'+$RunId};& node scripts/phase7-dev-snapshot.js before $prefix}
  'SnapshotAfter'{$prefix=if($RunId -eq 'default'){'phase81'}else{'phase81-'+$RunId};& node scripts/phase7-dev-snapshot.js after $prefix}
  'Functional'{& node --test test/phase81.mysql.test.js}
  'Pages'{& node test/phase81.pages.js}
  default{& node scripts/phase81-benchmark.js $Mode.ToLowerInvariant()}
 }
 if($LASTEXITCODE -ne 0){throw 'Verificacao Fase 8.1 interrompida; conferir resultados locais.'}
}finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')};$vault=$null;$values=$null;Pop-Location}
