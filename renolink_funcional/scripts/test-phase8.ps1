param([ValidateSet('BaselineLoad','Load','Mobile','Functional','SnapshotBefore','SnapshotAfter')][string]$Mode='Load')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$names=@('TEST_MYSQL_HOST','TEST_MYSQL_PORT','TEST_MYSQL_DATABASE','TEST_MYSQL_USER','TEST_MYSQL_PASSWORD','TEST_MYSQL_SSL','TEST_MYSQL_SSL_CA','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','RENOLINK_PHASE8_TEST_APPROVED','NODE_ENV','COOKIE_SECURE','APP_ORIGIN')
$previous=@{};foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
Push-Location $projectRoot
try{
 $vault=Import-Clixml -LiteralPath '.env.mysql.local.clixml';$values=@{NODE_ENV='development';COOKIE_SECURE='0';APP_ORIGIN=$null}
 if($Mode -in @('SnapshotBefore','SnapshotAfter')){
  if($vault.app.UserName -ne 'renolink_app'){throw 'Unexpected read account'}
  $values.MYSQL_HOST='127.0.0.1';$values.MYSQL_PORT='3306';$values.MYSQL_DATABASE='renolink_dev';$values.MYSQL_USER='renolink_app';$values.MYSQL_PASSWORD=$vault.app.GetNetworkCredential().Password;$values.MYSQL_SSL='0'
 }else{
  if($vault.tester.UserName -ne 'renolink_tester'){throw 'Unexpected test account'}
  $values.TEST_MYSQL_HOST='127.0.0.1';$values.TEST_MYSQL_PORT='3306';$values.TEST_MYSQL_DATABASE='renolink_test';$values.TEST_MYSQL_USER='renolink_tester';$values.TEST_MYSQL_PASSWORD=$vault.tester.GetNetworkCredential().Password;$values.TEST_MYSQL_SSL='0';$values.RENOLINK_PHASE8_TEST_APPROVED='1'
 }
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$values[$name],'Process')}
 switch($Mode){
  'BaselineLoad'{& node 'test/phase8.load.js' --baseline}
  'Load'{& node 'test/phase8.load.js'}
  'Mobile'{& node 'test/phase8.mobile.js'}
  'Functional'{& node --test 'test/phase8.mysql.test.js'}
  'SnapshotBefore'{& node 'scripts/phase7-dev-snapshot.js' before phase8}
  'SnapshotAfter'{& node 'scripts/phase7-dev-snapshot.js' after phase8}
 }
 if($LASTEXITCODE -ne 0){throw 'Phase 8 check failed; inspect results. No dev writes were requested.'}
}finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')};$vault=$null;$values=$null;Pop-Location}
