'use strict';
// Read-only database preflight. Intentionally has no import/schema/apply path.
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('../lib/mysql');
const { backup, validate } = require('../lib/data');
const { digest } = require('../lib/security');
const root = path.resolve(__dirname, '..');
async function main() {
  const options = mysql.config();
  if (options.host !== '127.0.0.1' || options.port !== 3306 || options.database !== 'renolink_dev' || options.user !== 'renolink_migrator') throw Error();
  const provisioning = JSON.parse(fs.readFileSync(path.join(root, 'data/runtime/mysql-provision-report.json'), 'utf8'));
  if (provisioning.status !== 'provisioned' || provisioning.existingDatabases.length || !provisioning.createdDatabases.includes('renolink_dev')) throw Error();
  const source = path.join(root, 'data/runtime/db.json');
  const original = path.join(root, 'data/db.json');
  if (fs.existsSync(source + '.lock') || fs.existsSync(original + '.lock')) throw Error();
  const files = [original, source].map(file => {
    const bytes = fs.readFileSync(file);
    const data = validate(JSON.parse(bytes));
    return { file, sha256: digest(bytes), counts: Object.fromEntries(['users', 'ideas', 'messages', 'negotiations', 'sessions'].map(k => [k, data[k].length])) };
  });
  const pool = mysql.pool(options);
  const report = { status: 'pending', importExecuted: false, schemaExecuted: false };
  try {
    const [[identity]] = await pool.execute('SELECT DATABASE() AS db, CURRENT_USER() AS account, VERSION() AS version');
    mysql.assertVersion(identity.version);
    if (identity.db !== 'renolink_dev' || identity.account !== 'renolink_migrator@127.0.0.1') throw Error();
    const [tables] = await pool.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()');
    const [routines] = await pool.execute('SELECT ROUTINE_NAME FROM information_schema.routines WHERE ROUTINE_SCHEMA = DATABASE()');
    const [triggers] = await pool.execute('SELECT TRIGGER_NAME FROM information_schema.triggers WHERE TRIGGER_SCHEMA = DATABASE()');
    if (tables.length || routines.length || triggers.length) throw Error();
    const [[schema]] = await pool.execute('SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.schemata WHERE SCHEMA_NAME = DATABASE()');
    if (schema.charset !== 'utf8mb4' || schema.collation !== 'utf8mb4_0900_bin') throw Error();
    const [grantRows] = await pool.query('SHOW GRANTS');
    const grants = grantRows.map(row => Object.values(row)[0]);
    const expected = provisioning.grants.find(grant => grant.user === 'renolink_migrator' && grant.host === '127.0.0.1' && grant.database === 'renolink_dev');
    if (!expected || JSON.stringify([...grants].sort()) !== JSON.stringify([...expected.verified].sort())) throw Error();
    report.database = { ...identity, ...schema, empty: true, dedicatedProvisioningVerified: true, grants };
  } finally { await pool.end(); }
  const directory = path.join(root, 'data/backups/mysql-phase4');
  report.sources = files.map((file, index) => {
    if (fs.existsSync(source + '.lock')) throw Error();
    const verified = backup(file.file, path.join(directory, index === 0 ? 'original' : 'operational'));
    if (verified.sha256 !== file.sha256 || digest(fs.readFileSync(file.file)) !== file.sha256) throw Error();
    return { ...file, backup: verified.path, backupManifest: verified.path + '.manifest.json', backupVerified: true };
  });
  if (fs.existsSync(source + '.lock')) throw Error();
  report.status = 'preflight-passed-awaiting-authorization';
  report.checkedAtUtc = new Date().toISOString();
  fs.writeFileSync(path.join(root, 'data/runtime/mysql-dev-preflight-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Preflight interrompido. Verifique destino vazio, conta migradora, grants, integridade, backups e ausencia de lock. Nenhum SQL de escrita/importacao foi executado.'); process.exitCode = 1; });
