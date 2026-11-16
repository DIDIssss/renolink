'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mysql = require('../lib/mysql');
const { migrate } = require('./migrate-mysql');
const { validate, safeSessions } = require('../lib/data');
const { digest } = require('../lib/security');
const root = path.resolve(__dirname, '..');
const report = { status: 'pending', phase: 'guards' };
const reportFile = path.join(root, 'data/runtime/mysql-dev-migration-report.json');
function save() { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); }
async function main() {
  assert.equal(process.env.RENOLINK_MYSQL_MIGRATION_APPROVED, '1');
  const options = mysql.config();
  assert.equal(options.host, '127.0.0.1'); assert.equal(options.port, 3306);
  assert.equal(options.database, 'renolink_dev'); assert.equal(options.user, 'renolink_migrator');
  const preflight = JSON.parse(fs.readFileSync(path.join(root, 'data/runtime/mysql-dev-preflight-report.json')));
  assert.equal(preflight.status, 'preflight-passed-awaiting-authorization');
  assert.equal(preflight.database.empty, true);
  const source = path.join(root, 'data/runtime/db.json');
  assert.equal(fs.existsSync(source + '.lock'), false);
  for (const entry of preflight.sources) {
    assert.equal(digest(fs.readFileSync(entry.file)), entry.sha256);
    assert.equal(digest(fs.readFileSync(entry.backup)), entry.sha256);
    const manifest = JSON.parse(fs.readFileSync(entry.backupManifest));
    assert.equal(manifest.sha256, entry.sha256);
    assert.deepEqual(manifest.counts, entry.counts);
  }
  const expected = safeSessions(validate(JSON.parse(fs.readFileSync(source))));
  const expectedCounts = { users: 4, ideas: 9, negotiations: 1, messages: 7, sessions: 0 };
  assert.deepEqual(mysql.verify(expected, expected), expectedCounts);
  const probe = mysql.pool(options);
  try {
    const [[identity]] = await probe.execute('SELECT CURRENT_USER() AS account, DATABASE() AS db');
    assert.equal(identity.account, 'renolink_migrator@127.0.0.1'); assert.equal(identity.db, 'renolink_dev');
    const [tables] = await probe.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()');
    assert.equal(tables.length, 0, 'Destino precisa continuar vazio.');
    report.identity = identity;
  } finally { await probe.end(); }
  report.phase = 'import'; save();
  const args = { source, backupDir: path.join(root, 'data/backups/mysql-phase4/operational'), apply: true, approved: true, options };
  report.first = await migrate(args);
  assert.equal(report.first.mode, 'imported'); assert.deepEqual(report.first.counts, expectedCounts);
  report.phase = 'idempotence'; save();
  report.second = await migrate(args);
  assert.equal(report.second.mode, 'already-imported'); assert.deepEqual(report.second.counts, expectedCounts);
  const pool = mysql.pool(options);
  try {
    report.counts = await mysql.transaction(pool, async client => {
      const actual = await mysql.load(client);
      const counts = mysql.verify(expected, actual);
      const [[imports]] = await client.execute('SELECT COUNT(*) AS count FROM renolink_imports');
      assert.equal(Number(imports.count), 1);
      return counts;
    });
  } finally { await pool.end(); }
  for (const entry of preflight.sources) {
    assert.equal(digest(fs.readFileSync(entry.file)), entry.sha256);
    assert.equal(digest(fs.readFileSync(entry.backup)), entry.sha256);
  }
  report.status = 'passed'; report.phase = 'complete';
  report.sourceSha256 = digest(fs.readFileSync(source));
  report.originalsAndBackupsUnchanged = true;
  report.fullComparisonPassed = true; report.completedAtUtc = new Date().toISOString();
  save(); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {
  report.status = 'failed'; report.errorCode = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'VALIDATION_FAILED'; save();
  console.error(`Migracao interrompida na fase ${report.phase}: ${report.errorCode}. Nenhum segredo foi registrado.`); process.exitCode = 1;
});
