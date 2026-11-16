'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scriptPath = path.join(__dirname, '..', 'scripts', 'diagnose-mysql-bootstrap-trial.ps1');
const mockTestPath = path.join(__dirname, 'mysql-bootstrap-diagnostics.mocks.ps1');
const script = fs.readFileSync(scriptPath, 'utf8');

test('diagnostic is read-only and never acts on a PID or MySQL service', () => {
  assert.match(script, /Get-CimInstance Win32_Process/);
  assert.match(script, /Get-NetTCPConnection -State Listen -ErrorAction Stop[\s\S]*Where-Object \{ \$_.LocalPort -eq \$expectedPort \}/);
  assert.doesNotMatch(script, /Get-NetTCPConnection -State Listen -LocalPort \$expectedPort -ErrorAction Stop/);
  assert.match(script, /\$processesBefore = Get-MySqlProcessSnapshot/);
  assert.match(script, /\$processesAfter = Get-MySqlProcessSnapshot/);
  assert.match(script, /\$listenersBefore = Get-TrialListenerSnapshot/);
  assert.match(script, /\$listenersAfter = Get-TrialListenerSnapshot/);
  assert.match(script, /Status = 'UnstableProcessSnapshot'/);
  assert.match(script, /Get-TrialAssessment/);
  assert.match(script, /ConvertTo-Json/);
  assert.doesNotMatch(script, /\b(?:Start-Process|Stop-Process|mysqladmin|Set-Service|New-Service|Remove-Item|Set-Acl|CreateDirectory)\b/i);
});

test('correlates a process using image and the exact trial config, datadir, port, and bind', () => {
  assert.match(script, /Test-TrialConfiguration/);
  assert.match(script, /'require_secure_transport' = 'ON'/);
  assert.match(script, /'ssl-cert' =/);
  assert.match(script, /'general-log' = 'OFF'/);
  assert.match(script, /ParentProcessId = \[uint32\]\$_.ParentProcessId/);
  assert.match(script, /Test-NormalizedCommandLineContains \$commandLine "--defaults-file=`"\$configPath`""/);
  assert.match(script, /Test-NormalizedCommandLineContains \$commandLine "--datadir=`"\$datadir`""/);
  assert.match(script, /Test-NormalizedCommandLineContains \$commandLine "--port=\$expectedPort"/);
  assert.match(script, /Test-NormalizedCommandLineContains \$commandLine '--bind-address=127\.0\.0\.1'/);
  assert.match(script, /ProcessId = \[uint32\]\$process\.ProcessId/);
  assert.match(script, /CreationDate = ConvertTo-TrialCreationDate \$process\.CreationDate/);
  assert.match(script, /CreationDate = \$_.CreationDate/);
  assert.doesNotMatch(script, /\[string\]\$(?:_|process|owner)\.CreationDate/);
  assert.match(script, /Test-ValidCreationDate/);
  assert.match(script, /RelatedUnverifiedProcess/);
  assert.match(script, /\$allQualifiedConnected/);
  assert.match(script, /VerifiedProcessIds = \$verifiedIds/);
  assert.match(script, /\$assessment \| ConvertTo-Json -Depth 3/);
  assert.doesNotMatch(script, /CommandLine\s*=\s*\$assessment/);
});

test('mocked edge cases cover PID reuse, unknown owners, occupied port, and missing trial directory', () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', mockTestPath], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  });
  assert.equal(result.error, undefined, result.error && result.error.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Diagnostic mock cases passed/);
});
