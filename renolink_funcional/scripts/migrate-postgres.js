'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { backup, validate, safeSessions } = require('../lib/data');
const pg = require('../lib/postgres');
async function migrate({ source, backupDir, apply = false }) {
  // Backup verificado inclusive no preflight; nunca escreve no arquivo de origem.
  const verified = backup(source, backupDir);
  const db = safeSessions(validate(JSON.parse(fs.readFileSync(verified.path, 'utf8'))));
  if (!apply) return { mode: 'preflight', sha256: verified.sha256, counts: verified.counts, databaseConfigured: Boolean(process.env.DATABASE_URL) };
  if (process.env.RENOLINK_MIGRATION_APPROVED !== '1') throw Error('Migração exige aprovação prévia do operador e RENOLINK_MIGRATION_APPROVED=1.');
  if (fs.existsSync(source + '.lock')) throw Error('Pare a aplicação antes de migrar o banco operacional.');
  const connectionPool = pg.pool();
  try {
    return await pg.transaction(connectionPool, async client => {
      await client.query(fs.readFileSync(path.join(__dirname, '../database/001_initial.sql'), 'utf8'));
      const existing = await client.query('SELECT source_sha256 FROM renolink_imports WHERE source_sha256 = $1', [verified.sha256]);
      if (existing.rows.length) {
        // Não sobrescrever um banco que evoluiu desde a importação.
        return { mode: 'already-imported', counts: pg.verify(db, await pg.load(client)) };
      }
      for (const table of ['users', 'ideas', 'messages', 'negotiations', 'sessions', 'meta', 'imports']) {
        const result = await client.query(`SELECT count(*) AS count FROM renolink_${table}`);
        if (Number(result.rows[0].count) !== 0) throw Error('Destino não vazio: importação recusada para evitar sobrescrita.');
      }
      await pg.save(client, db, true);
      const counts = pg.verify(db, await pg.load(client));
      await client.query('INSERT INTO renolink_imports(source_sha256, counts) VALUES ($1, $2)', [verified.sha256, counts]);
      return { mode: 'imported', counts };
    });
  } finally { await connectionPool.end(); }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const value = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const runtime = path.join(__dirname, '../data/runtime/db.json');
  migrate({ source: path.resolve(value('--source') || (fs.existsSync(runtime) ? runtime : path.join(__dirname, '../data/db.json'))), backupDir: path.resolve(value('--backup-dir') || path.join(__dirname, '../data/backups')), apply: args.includes('--apply') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(() => { console.error('Migração/preflight recusado. Verifique aprovação, origem, backup, destino vazio e configuração. Nenhum segredo foi registrado.'); process.exitCode = 1; });
}
module.exports = { migrate };
