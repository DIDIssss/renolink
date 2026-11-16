param([ValidateSet('Preview','Grant')][string]$Mode='Preview')
$ErrorActionPreference='Stop'
function Format-IdentityText([string]$Value){return ($Value -replace '[\x00-\x1F\x7F-\x9F\u202A-\u202E\u2066-\u2069]','?')}
if([Console]::IsInputRedirected -or [Console]::IsOutputRedirected){throw 'Execute este assistente em um terminal local interativo, sem redirecionamento.'}
$projectRoot=Split-Path -Parent $PSScriptRoot
$names=@('MYSQL_HOST','MYSQL_PORT','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD','MYSQL_SSL','MYSQL_SSL_CA','NODE_ENV','RENOLINK_FIRST_ADMIN_OPERATOR','RENOLINK_STAFF_PROVISION_APPROVED')
$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
Push-Location $projectRoot
try{
 $vault=Import-Clixml -LiteralPath '.env.mysql.local.clixml'
 if($vault.migrator.UserName -ne 'renolink_migrator'){throw 'Conta operadora inesperada.'}
 $values=@{MYSQL_HOST='127.0.0.1';MYSQL_PORT='3306';MYSQL_DATABASE='renolink_dev';MYSQL_USER='renolink_migrator';MYSQL_PASSWORD=$vault.migrator.GetNetworkCredential().Password;MYSQL_SSL='0';MYSQL_SSL_CA=$null;NODE_ENV='development';RENOLINK_FIRST_ADMIN_OPERATOR='1';RENOLINK_STAFF_PROVISION_APPROVED=$null}
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$values[$name],'Process')}
 $raw=& node 'scripts/first-admin.js' --list
 if($LASTEXITCODE -ne 0){throw 'Nao foi possivel consultar as contas; nenhuma concessao executada.'}
 $candidates=$raw | ConvertFrom-Json
 Write-Host 'RenoLink - operador local - renolink_dev - concessao ADMIN'
 Write-Host ('Administradores ativos: '+$candidates.activeAdministrators)
 Write-Host 'Escolha uma pessoa responsavel com senha pessoal forte. O assistente nao cria nem redefine senhas.'
 $candidates.users | Select-Object id,@{Name='name';Expression={Format-IdentityText $_.name}},@{Name='email';Expression={Format-IdentityText $_.email}},role | Format-Table -AutoSize | Out-Host
 if($Mode -eq 'Preview'){Write-Host 'PREVIA SOMENTE: nenhuma concessao. Apos autorizacao, use -Mode Grant.';return}
 $chosen=Read-Host 'Digite o ID da pessoa que sera administradora (Enter cancela)'
 if([string]::IsNullOrWhiteSpace($chosen)){Write-Host 'Cancelado sem alterar dados.';return}
 if($chosen -notmatch '^[1-9][0-9]*$'){throw 'ID invalido. Nenhuma concessao.'}
 $selected=@($candidates.users | Where-Object {$_.id -eq [long]$chosen})
 if($selected.Count -ne 1){throw 'Conta nao elegivel. Nenhuma concessao.'}
 $person=$selected[0]
 Write-Host ('CONFIRA A IDENTIDADE: ID '+$person.id+' | '+(Format-IdentityText $person.name)+' | '+(Format-IdentityText $person.email)+' | perfil '+$person.role)
 Write-Host 'Esta acao concede acesso a propostas privadas, contatos, moderacao e auditoria.'
 $email=Read-Host 'Digite exatamente o e-mail dessa pessoa para confirmar a identidade'
 $expected='CONCEDER ADMIN '+$person.id+' EM renolink_dev'
 $phrase=Read-Host ('Para confirmar os privilegios, digite: '+$expected)
 if($email -cne $person.email -or $phrase -cne $expected){throw 'Confirmacao divergente. Nenhuma concessao.'}
 $payload=@{userId=[long]$person.id;name=$person.name;email=$email;fingerprint=$person.fingerprint;phrase=$phrase} | ConvertTo-Json -Compress
 [Environment]::SetEnvironmentVariable('RENOLINK_STAFF_PROVISION_APPROVED','1','Process')
 $result=$payload | & node 'scripts/first-admin.js' --grant
 if($LASTEXITCODE -ne 0){throw 'Concessao interrompida. Nenhuma repeticao automatica.'}
 $receipt=$result | ConvertFrom-Json
 Write-Host ('Concessao confirmada: usuario ID '+$receipt.userId+'; papel admin; auditoria ID '+$receipt.auditId+'.')
 Write-Host 'A pessoa deve usar sua propria senha em http://127.0.0.1:3000/admin-login.html.'
}finally{
 foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
 $vault=$null;$values=$null;$raw=$null;$candidates=$null;$payload=$null
 Pop-Location
}
