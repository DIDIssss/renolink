'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'scripts', 'mysql-bootstrap-trial.ps1');
const script = fs.readFileSync(scriptPath, 'utf8');

test('requires explicit authorization before any side-effecting operation', () => {
  const gate = script.indexOf('if (-not $AuthorizeTrial -or $Confirmation -cne $requiredConfirmation)');
  assert.notEqual(gate, -1);
  for (const operation of [
    '[IO.Directory]::CreateDirectory',
    '[IO.File]::WriteAllText',
    '& $mysqld',
    'Start-Process -FilePath $mysqld'
  ]) {
    const operationIndex = script.indexOf(operation);
    assert.notEqual(operationIndex, -1, `expected operation: ${operation}`);
    assert.ok(gate < operationIndex, `${operation} must follow the authorization gate`);
  }
});

test('pins the disposable server to its own profile datadir and loopback port', () => {
  assert.match(script, /\$port = 33307/);
  assert.match(script, /\$trialRoot = Join-Path \$trialParent \('RenoLinkBootstrapTrial-' \+ \[guid\]::NewGuid\(\)\.ToString\('N'\)\)/);
  assert.match(script, /datadir=\$\(Format-MySqlOptionValue \$dataDirectory\.Replace\('\\', '\/'\)\)/);
  assert.match(script, /port=\$port\r?\nbind-address=127\.0\.0\.1\r?\nmysqlx=OFF/);
  assert.match(script, /Write-ClientOptions \$clientOptions \$tempPassword '127\.0\.0\.1' \$port \$caPath/);
  assert.match(script, /"--datadir=\$dataDirectory"[\s\S]*"--port=\$port" --bind-address=127\.0\.0\.1 --mysqlx=OFF --initialize/);
  assert.match(script, /"--datadir=`"\$dataDirectory`""[\s\S]*'--bind-address=127\.0\.0\.1'[\s\S]*'--mysqlx=OFF'/);
});

test('protects files before writing credentials or allowing MySQL to fill logs', () => {
  const createFile = script.indexOf('function New-RestrictedFile');
  const setAcl = script.indexOf('Set-Acl -LiteralPath $Path -AclObject (New-TrialFileSecurity)', createFile);
  const assertAcl = script.indexOf('Assert-RestrictedAcl $Path', setAcl);
  const writeSecret = script.indexOf('[IO.File]::WriteAllText($Path, $contents', assertAcl);
  assert.ok(createFile < setAcl && setAcl < assertAcl && assertAcl < writeSecret);

  const createErrorLog = script.indexOf('New-RestrictedFile $errorLog');
  const initialize = script.indexOf('& $mysqld "--defaults-file=$configPath" "--datadir=$dataDirectory"');
  assert.ok(createErrorLog < initialize);
  assert.match(script, /if \(-not \$acl\.AreAccessRulesProtected\)/);
});

test('marks the child process active before post-start checks and attempts graceful shutdown', () => {
  const start = script.indexOf('$serverProcess = Start-Process -FilePath $mysqld');
  const started = script.indexOf('$serverStarted = $true', start);
  const aclCheck = script.indexOf('Assert-RestrictedAcl $stdoutPath', start);
  assert.ok(start < started && started < aclCheck);
  assert.match(script, /& \$mysqladmin[\s\S]*shutdown 2>\$null/);
  assert.doesNotMatch(script, /\bStop-Process\b/);
});

test('does not pass credentials in arguments and clears inherited password variables', () => {
  assert.match(script, /SetEnvironmentVariable\('MYSQL_PWD', \$null, 'Process'\)/);
  assert.match(script, /SetEnvironmentVariable\('MYSQL_PWD', \$mysqlPasswordEnvironment, 'Process'\)/);
  assert.doesNotMatch(script, /--password(?:=|\s)|MYSQL_PWD=/i);
  assert.match(script, /--defaults-file=\$clientOptions/);
  assert.doesNotMatch(script, /--no-login-paths/i);
  assert.match(script, /--connect-expired-password/);
  assert.match(script, /--ssl-mode=VERIFY_IDENTITY/);
  assert.match(script, /"--ssl-ca=\$caPath"/);
  assert.match(script, /if \(\[string\]::IsNullOrWhiteSpace\(\$env:APPDATA\)\)/);
  assert.match(script, /if \(Test-Path -LiteralPath \$loginPathFile\)/);
  assert.match(script, /IDENTIFIED BY RANDOM PASSWORD/);
});

test('limits cleanup to the generated trial directory and verifies process ownership', () => {
  assert.match(script, /'\^RenoLinkBootstrapTrial-\[0-9a-f\]\{32\}\$'/);
  assert.match(script, /Remove-Item -LiteralPath \$trialRoot -Recurse -Force/);
  assert.match(script, /\$listeners\[0\]\.OwningProcess -eq \$serverProcess\.Id/);
  assert.match(script, /\$listeners\[0\]\.LocalAddress -eq '127\.0\.0\.1'/);
  assert.match(script, /SELECT \@\@datadir, \@\@port/);
  assert.match(script, /-not \$actualDataPath\.Equals\(\$expectedDataPath/);
});

test('does not register services or edit global Windows configuration', () => {
  assert.doesNotMatch(script, /\b(?:New-Service|Set-Service|Register-Service|netsh|sc\.exe)\b/i);
  assert.match(script, /Get-ServiceSnapshot/);
  assert.match(script, /Get-NetTCPConnection/);
  assert.match(script, /Get-CimInstance Win32_Service -Filter "Name='\$fairServiceName'" -ErrorAction Stop/);
  assert.doesNotMatch(script, /Get-NetTCPConnection[^\r\n]*SilentlyContinue/);
  assert.match(script, /function Get-TrialPortListeners[\s\S]*Get-NetTCPConnection -State Listen -ErrorAction Stop[\s\S]*Where-Object \{ \$_.LocalPort -eq \$port \}/);
  assert.doesNotMatch(script, /Get-NetTCPConnection -State Listen -LocalPort \$port -ErrorAction Stop/);
});
