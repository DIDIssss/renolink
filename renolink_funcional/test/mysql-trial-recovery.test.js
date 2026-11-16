'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

test('recovery pure validators and orchestrator: synthetic adapters only', () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'mysql-trial-recovery.mocks.ps1')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Recovery mock assertions passed: \d+/);
});

test('readiness entry point has no recovery operations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/inspect-mysql-trial-readiness.ps1'), 'utf8');
  assert.doesNotMatch(source, /\b(?:mysqladmin|Start-Process|Stop-Process|Remove-Item|Set-Acl|New-Service|Set-Service|FileStream|Invoke-TrialRecoveryStateMachine)\b/i);
  assert.match(source, /RecoveryAuthorized = \$false/);
});

test('Windows adapter boundary tests use only in-memory process and file doubles', () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'mysql-trial-recovery-windows.mocks.ps1')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Windows recovery mock assertions passed: \d+/);
});

test('operational script is gated and Windows adapter contains no force/cleanup/service mutation', () => {
  const scripts = path.join(__dirname, '../scripts');
  const entry = fs.readFileSync(path.join(scripts, 'recover-mysql-bootstrap-trial.ps1'), 'utf8');
  const adapter = fs.readFileSync(path.join(scripts, 'mysql-trial-recovery-windows.ps1'), 'utf8');
  assert.ok(entry.indexOf("if (-not $AuthorizeRecovery") < entry.indexOf('. (Join-Path'));
  assert.match(entry, /Read-Host/);
  assert.match(entry, /RECOVER-33307-\$digest/);
  assert.doesNotMatch(entry + adapter, /\b(?:Stop-Process|taskkill|Set-Acl|Remove-Item|Start-Service|Stop-Service|New-Service|Set-Service)\b|\.Kill\(/i);
  assert.match(adapter, /\[IO.FileMode\]::CreateNew,[\s\S]*?\[IO.FileShare\]::None,4096,\[IO.FileOptions\]::None,\$Security/);
  assert.match(adapter, /WaitForExit\(45000\)/);
  assert.match(adapter, /OriginalPidReused/);
  assert.match(adapter, /Elapsed.TotalSeconds -lt 30/);
});
