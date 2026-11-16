'use strict';
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('../lib/mysql');
const { initialize, mappings } = require('../lib/phase5-data');
const { digest } = require('../lib/security');
const sqlFile = path.join(__dirname, '../database/mysql/002_phase5.sql');
const schemaHash = () => digest(fs.readFileSync(sqlFile));
async function apply({ options, approved = false, developmentApproved = false, beforeApply }) {
  if (!approved) throw Error('Aplicacao da Fase 5 exige autorizacao.');
  const test = options.database === 'renolink_test' && options.user === 'renolink_tester';
  const dev = options.database === 'renolink_dev' && options.user === 'renolink_migrator' && developmentApproved;
  if (options.host !== '127.0.0.1' || (!test && !dev)) throw Error('Destino ou conta nao autorizados.');
  if (dev && typeof beforeApply !== 'function') throw Error('Desenvolvimento exige verificacao e backup completo sob o lock da migracao.');
  const pool = mysql.pool(options);
  try {
    return await mysql.withLock(pool, async client => {
      const [[identity]] = await client.execute('SELECT CURRENT_USER() AS account');
      if (identity.account !== options.user + '@127.0.0.1') throw Error('Conta efetiva inesperada.');
      const before = await mysql.load(client);
      if (before.meta.schemaVersion === 5) {
        if (before.meta.phase5MigrationHash !== schemaHash()) throw Error('Versao aplicada diverge do arquivo revisado.');
        return { mode: 'already-applied', database: options.database, schemaSha256: schemaHash() };
      }
      initialize(structuredClone(before)); // Check metadata before executing any DDL.
      if (beforeApply) await beforeApply({ client, before });
      const backupDirectory = path.join(__dirname, '../data/backups/phase5');
      fs.mkdirSync(backupDirectory, { recursive: true });
      const snapshot = Buffer.from(JSON.stringify(before));
      const backupFile = path.join(backupDirectory, `${options.database}-${digest(snapshot)}.json`);
      if (!fs.existsSync(backupFile)) fs.writeFileSync(backupFile, snapshot, { flag: 'wx', mode: 0o600 });
      if (digest(fs.readFileSync(backupFile)) !== digest(snapshot)) throw Error('Backup do banco inconsistente.');
      const names = Object.keys(mappings).map(key => 'renolink_' + key.replace(/[A-Z]/g, c => '_' + c.toLowerCase()));
      const [existing] = await client.execute('SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE()');
      if (existing.some(t => names.includes(t.name))) throw Error('Tabelas Fase 5 preexistentes sem marcador. Inspecao manual necessaria.');
      const statements = fs.readFileSync(sqlFile, 'utf8').replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
      for (const statement of statements) await client.query(statement);
      return mysql.inTransaction(client, async () => {
        const expected = initialize(structuredClone(before));
        expected.meta.phase5MigrationHash = schemaHash(); expected.meta.phase5AppliedAt = new Date().toISOString();
        // Only the metadata document changes. Existing operational rows are untouched.
        await client.execute('UPDATE renolink_meta SET payload = ? WHERE id = 1', [JSON.stringify(expected.meta)]);
        const counts = mysql.verify(expected, await mysql.load(client));
        return { mode: 'applied', database: options.database, newTables: names, counts, schemaSha256: schemaHash(), backupFile };
      });
    });
  } finally { await pool.end(); }
}
if (require.main === module) {
  if (!process.argv.includes('--apply')) console.log(JSON.stringify({ mode: 'plan-only', sqlFile, schemaSha256: schemaHash(), destructive: false, tables: Object.keys(mappings) }, null, 2));
  else {
    const development = process.argv.includes('--development');
    apply({ options: mysql.config(process.env, development ? 'MYSQL_' : 'TEST_MYSQL_'),
      approved: development ? process.env.RENOLINK_PHASE5_DEV_SCHEMA_APPROVED === '1' : process.env.RENOLINK_PHASE5_TEST_APPROVED === '1',
      developmentApproved: process.env.RENOLINK_PHASE5_DEV_SCHEMA_APPROVED === '1' })
      .then(result => console.log(JSON.stringify(result, null, 2)))
      .catch(() => { console.error('Migracao Fase 5 interrompida. Verifique autorizacao, destino, backup e schema. Nenhum segredo registrado.'); process.exitCode = 1; });
  }
}
module.exports = { apply, schemaHash };
