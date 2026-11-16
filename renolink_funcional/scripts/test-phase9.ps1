param([ValidateSet('Test','Regression','SnapshotBefore','SnapshotAfter')][string]$Mode='Test')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$names=@('TEST_MYSQL_HOST','TEST_MYSQL_PORT','TEST_MYSQL_DATABASE','TEST_MYSQL_USER','TEST_MYSQL_PASSWORD','TEST_MYSQL_SSL','TEST_MYSQL_SSL_CA','MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','RENOLINK_PHASE9_APPROVED','NODE_ENV','APP_ORIGIN','COOKIE_SECURE','TRUST_PROXY','APP_LOG_FORMAT','PHASE9_TLS_PFX','PHASE9_TLS_PASSWORD','NODE_EXTRA_CA_CERTS')
$names+=@('RENOLINK_PHASE82_APPROVED')
$previous=@{};foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
Push-Location $root
$rsa=$null;$cert=$null
try{
 $vault=Import-Clixml -LiteralPath '.env.mysql.local.clixml'
 $values=@{NODE_ENV='development';COOKIE_SECURE='1';APP_ORIGIN=$null;TRUST_PROXY='off';RENOLINK_PHASE9_APPROVED='1';RENOLINK_PHASE82_APPROVED='1'}
 if($Mode -like 'Snapshot*'){
  if($vault.app.UserName -ne 'renolink_app'){throw 'Conta inesperada.'}
  $values.MYSQL_HOST='127.0.0.1';$values.MYSQL_PORT='3306';$values.MYSQL_DATABASE='renolink_dev';$values.MYSQL_USER='renolink_app';$values.MYSQL_PASSWORD=$vault.app.GetNetworkCredential().Password;$values.MYSQL_SSL='0'
 }else{
  if($vault.tester.UserName -ne 'renolink_tester'){throw 'Conta inesperada.'}
  $values.TEST_MYSQL_HOST='127.0.0.1';$values.TEST_MYSQL_PORT='3306';$values.TEST_MYSQL_DATABASE='renolink_test';$values.TEST_MYSQL_USER='renolink_tester';$values.TEST_MYSQL_PASSWORD=$vault.tester.GetNetworkCredential().Password;$values.TEST_MYSQL_SSL='0'
  # Certificado efemero de teste: sem instalar CA ou chave no Windows.
  $rsa=[System.Security.Cryptography.RSA]::Create(2048)
  $req=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
  $san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new();$san.AddDnsName('localhost');$san.AddIpAddress([System.Net.IPAddress]::Loopback);$req.CertificateExtensions.Add($san.Build())
  $req.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
  $cert=$req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddHours(2))
  $random=New-Object byte[] 32;$rng=[System.Security.Cryptography.RandomNumberGenerator]::Create();try{$rng.GetBytes($random)}finally{$rng.Dispose()}
  $pfxPassword=[Convert]::ToBase64String($random)
  $values.PHASE9_TLS_PFX=[Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$pfxPassword));$values.PHASE9_TLS_PASSWORD=$pfxPassword
  $caPath=Join-Path $root ('data/runtime/phase9-ca-'+[Guid]::NewGuid().ToString('N')+'.pem')
  $publicPem="-----BEGIN CERTIFICATE-----`n"+[Convert]::ToBase64String($cert.RawData,[Base64FormattingOptions]::InsertLineBreaks)+"`n-----END CERTIFICATE-----`n"
  [System.IO.File]::WriteAllText($caPath,$publicPem,[System.Text.Encoding]::ASCII);$values.NODE_EXTRA_CA_CERTS=$caPath
 }
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$values[$name],'Process')}
 if($Mode -eq 'SnapshotBefore'){& node scripts/phase7-dev-snapshot.js before phase9}
 elseif($Mode -eq 'SnapshotAfter'){& node scripts/phase7-dev-snapshot.js after phase9}
 elseif($Mode -eq 'Regression'){& node --test test/phase82.mysql.test.js}
 else{& node --test test/phase9.https.test.js}
 if($LASTEXITCODE -ne 0){throw 'Verificacao Fase 9 falhou. Nenhum segredo exibido.'}
}finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')};if($cert){$cert.Dispose()};if($rsa){$rsa.Dispose()};$vault=$null;$values=$null;$pfxPassword=$null;Pop-Location}
