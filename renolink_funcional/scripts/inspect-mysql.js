'use strict';
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('../lib/mysql');
const { digest } = require('../lib/security');
async function main() {
  const options = mysql.config(process.env, 'TEST_MYSQL_');
  if (options.database !== 'renolink_test' || options.host !== '127.0.0.1' || process.env.MYSQL_DATABASE !== 'renolink_dev') throw Error();
  const pool = mysql.pool(options);
  const report = { testDatabase: options.database };
  try {
    report.counts = await mysql.transaction(pool, async client => {
      const db = await mysql.load(client); // validates all IDs, counters and relationships.
      report.stateSha256 = digest(require('../lib/data').stable(db));
      return mysql.verify(db, db);
    });
    const [tables] = await pool.execute('SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()');
    if (tables.length !== 7 || tables.some(t => t.engine !== 'InnoDB')) throw Error();
    report.tables = tables;
    const [grants] = await pool.query('SHOW GRANTS');
    report.testGrants = grants.map(row => Object.values(row)[0]);
    report.relationshipsAndCountersValid = true;
  } finally { await pool.end(); }
  const dev = mysql.pool(mysql.config());
  try {
    const [[identity]] = await dev.execute('SELECT DATABASE() AS db, CURRENT_USER() AS account');
    if (identity.db !== 'renolink_dev' || identity.account !== 'renolink_app@127.0.0.1') throw Error();
    const [tables] = await dev.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()');
    if (tables.length !== 0) throw Error();
    report.devDatabase = { name: identity.db, account: identity.account, empty: true };
  } finally { await dev.end(); }
  report.originalSha256 = digest(fs.readFileSync(path.join(__dirname, '../data/db.json')));
  const output = path.join(__dirname, '../data/runtime/mysql-inspection-report.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Inspecao MySQL recusada ou inconsistente. Nenhum segredo foi registrado.'); process.exitCode = 1; });
