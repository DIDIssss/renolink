param([switch]$InspectDev)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$names=@('TEST_MYSQL_HOST','TEST_MYSQL_PORT','TEST_MYSQL_DATABASE','TEST_MYSQL_USER','TEST_MYSQL_PASSWORD','TEST_MYSQL_SSL','TEST_MYSQL_SSL_CA','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','RENOLINK_PHASE6_TEST_APPROVED','NODE_ENV','COOKIE_SECURE','APP_ORIGIN')
$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
Push-Location $projectRoot
try{
 $vault=Import-Clixml -LiteralPath '.env.mysql.local.clixml'
 if($InspectDev){
  if($vault.app.UserName -ne 'renolink_app'){throw 'Conta de leitura inesperada.'}
  $values=@{MYSQL_HOST='127.0.0.1';MYSQL_PORT='3306';MYSQL_DATABASE='renolink_dev';MYSQL_USER='renolink_app';MYSQL_PASSWORD=$vault.app.GetNetworkCredential().Password;MYSQL_SSL='0';MYSQL_SSL_CA=$null;NODE_ENV='development';COOKIE_SECURE='0';APP_ORIGIN=$null}
 }else{
  if($vault.tester.UserName -ne 'renolink_tester'){throw 'Conta de teste inesperada.'}
  $values=@{TEST_MYSQL_HOST='127.0.0.1';TEST_MYSQL_PORT='3306';TEST_MYSQL_DATABASE='renolink_test';TEST_MYSQL_USER='renolink_tester';TEST_MYSQL_PASSWORD=$vault.tester.GetNetworkCredential().Password;TEST_MYSQL_SSL='0';TEST_MYSQL_SSL_CA=$null;RENOLINK_PHASE6_TEST_APPROVED='1';NODE_ENV='development';COOKIE_SECURE='0';APP_ORIGIN=$null}
 }
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$values[$name],'Process')}
 if($InspectDev){& node 'scripts/check-phase6-dev.js'}else{& node --test 'test/phase6.mysql.test.js'}
 if($LASTEXITCODE -ne 0){throw 'Teste isolado da Fase 6 falhou. Nenhuma concessao real foi executada.'}
}finally{
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
 $vault=$null;$values=$null
 Pop-Location
}
