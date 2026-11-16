'use strict';
// Only called by mysql-local.ps1. Never print driver errors: they may contain SQL.
const fs = require('node:fs');
const path = require('node:path');
const driver = require('mysql2/promise');
const { assertVersion } = require('../lib/mysql');
const databases = ['renolink_dev', 'renolink_test'];
const accounts = [
  { user: 'renolink_app', database: 'renolink_dev', privileges: ['SELECT', 'INSERT', 'UPDATE'], secret: 'RENOLINK_SETUP_APP_PASSWORD' },
  { user: 'renolink_migrator', database: 'renolink_dev', privileges: ['SELECT', 'INSERT', 'UPDATE', 'CREATE', 'INDEX', 'REFERENCES'], secret: 'RENOLINK_SETUP_MIGRATOR_PASSWORD' },
  { user: 'renolink_tester', database: 'renolink_test', privileges: ['SELECT', 'INSERT', 'UPDATE', 'CREATE', 'INDEX', 'REFERENCES'], secret: 'RENOLINK_SETUP_TESTER_PASSWORD' }
];
const reportPath = path.join(__dirname, '../data/runtime/mysql-provision-report.json');
const report = { createdDatabases: [], createdAccounts: [], grants: [], status: 'pending' };
function saveReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
async function preflight(client) {
  const [[info]] = await client.query('SELECT VERSION() AS version, @@GLOBAL.log_raw AS logRaw, @@GLOBAL.partial_revokes AS partialRevokes');
  assertVersion(info.version);
  report.version = info.version;
  if (Number(info.logRaw) !== 0) throw Object.assign(Error(), { code: 'RAW_PASSWORD_LOGGING_ENABLED' });
  const [dbs] = await client.execute('SELECT SCHEMA_NAME AS name FROM information_schema.schemata WHERE SCHEMA_NAME IN (?, ?)', databases);
  const [users] = await client.execute('SELECT User AS user, Host AS host FROM mysql.user WHERE User IN (?, ?, ?)', accounts.map(a => a.user));
  report.existingDatabases = dbs;
  report.existingAccounts = users;
  if (dbs.length || users.length) throw Object.assign(Error(), { code: 'EXISTING_RESOURCE_REQUIRES_APPROVAL' });
  return info;
}
async function main() {
  const mode = process.argv[2];
  if (!['--check', '--apply'].includes(mode) || process.argv.length !== 3) throw Object.assign(Error(), { code: 'INVALID_ARGUMENTS' });
  if (!process.env.RENOLINK_SETUP_ADMIN_USER || !process.env.RENOLINK_SETUP_ADMIN_PASSWORD) throw Object.assign(Error(), { code: 'ADMIN_CREDENTIALS_REQUIRED' });
  const client = await driver.createConnection({ host: '127.0.0.1', port: 3306,
    user: process.env.RENOLINK_SETUP_ADMIN_USER, password: process.env.RENOLINK_SETUP_ADMIN_PASSWORD,
    multipleStatements: false, connectTimeout: 5000, debug: false });
  try {
    const info = await preflight(client);
    report.status = 'preflight-passed';
    if (mode === '--check') { saveReport(); console.log('Preflight aprovado: nenhum banco ou usuario autorizado ja existe.'); return; }
    if (accounts.some(a => !/^Aa1![0-9a-f]{64}$/.test(process.env[a.secret] || ''))) throw Object.assign(Error(), { code: 'GENERATED_CREDENTIALS_REQUIRED' });
    for (const name of databases) {
      // No IF NOT EXISTS: a concurrent creation must fail rather than be reused.
      await client.query('CREATE DATABASE `' + name + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin');
      report.createdDatabases.push(name); saveReport();
    }
    for (const account of accounts) {
      // Password-bearing statements are sent using text protocol for MySQL log rewriting.
      // Refuse log_raw above; do not expose the statement, warnings or driver errors.
      await client.query('CREATE USER ' + client.escape(account.user) + "@'127.0.0.1' IDENTIFIED WITH caching_sha2_password BY " + client.escape(process.env[account.secret]));
      report.createdAccounts.push(account.user + '@127.0.0.1'); saveReport();
      // '_' is a wildcard in schema grants unless partial_revokes is enabled.
      const scope = Number(info.partialRevokes) ? account.database : account.database.replace(/_/g, '\\_');
      await client.query('GRANT ' + account.privileges.join(', ') + ' ON `' + scope + '`.* TO ' + client.escape(account.user) + "@'127.0.0.1'");
      report.grants.push({ user: account.user, host: '127.0.0.1', database: account.database, privileges: account.privileges }); saveReport();
      const connection = await driver.createConnection({ host: '127.0.0.1', port: 3306, user: account.user,
        password: process.env[account.secret], database: account.database, connectTimeout: 5000 });
      try {
        const [[identity]] = await connection.query('SELECT CURRENT_USER() AS account');
        if (identity.account !== account.user + '@127.0.0.1') throw Object.assign(Error(), { code: 'UNEXPECTED_ACCOUNT' });
        const [grants] = await connection.query('SHOW GRANTS');
        // Only the new account's grants, never credentials/authentication strings.
        account.verifiedGrants = grants.map(row => Object.values(row)[0]);
        const parsed = account.verifiedGrants.map(text => /^GRANT (.+) ON (.+) TO /.exec(text));
        const usage = parsed.filter(row => row && row[1] === 'USAGE' && row[2] === '*.*');
        const scoped = parsed.filter(row => row && row[2] === '`' + scope + '`.*');
        if (parsed.length !== 2 || usage.length !== 1 || scoped.length !== 1 ||
          scoped[0][1].split(', ').sort().join(',') !== [...account.privileges].sort().join(',') ||
          account.verifiedGrants.some(text => /WITH GRANT OPTION/.test(text))) throw Object.assign(Error(), { code: 'UNEXPECTED_GRANTS' });
        report.grants[report.grants.length - 1].verified = account.verifiedGrants;
      } finally { await connection.end(); }
    }
    const [[dev]] = await client.execute('SELECT COUNT(*) AS count FROM information_schema.tables WHERE TABLE_SCHEMA = ?', ['renolink_dev']);
    if (Number(dev.count) !== 0) throw Object.assign(Error(), { code: 'DEV_DATABASE_NOT_EMPTY' });
    report.devEmpty = true;
    report.status = 'provisioned'; saveReport();
    console.log('Provisionamento concluido. Tres contas locais verificadas; renolink_dev permanece vazio.');
  } finally { await client.end(); }
}
if (require.main === module) main().catch(error => {
  report.status = 'stopped';
  report.errorCode = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'PROVISIONING_FAILED';
  saveReport();
  console.error('Provisionamento interrompido: ' + report.errorCode + '. Consulte data/runtime/mysql-provision-report.json. Nenhum recurso foi removido.');
  process.exitCode = 1;
});
module.exports = { main };
