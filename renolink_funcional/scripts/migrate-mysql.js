'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { backup, validate, safeSessions } = require('../lib/data');
const mysql = require('../lib/mysql');
const phase5Mappings = require('../lib/phase5-data').mappings;
const tableName = key => 'renolink_' + key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const BASE_TABLES = [
  ...Object.keys(mysql.mappings).map(tableName),
  'renolink_meta',
  'renolink_imports'
];
const FAIR_TABLES = [
  ...Object.keys(mysql.mappings).map(tableName),
  ...Object.keys(phase5Mappings).map(tableName),
  'renolink_meta', 'renolink_imports'
];
function validateSource(source) {
  if (typeof source !== 'string' || !source.trim() || !path.isAbsolute(source)) {
    throw Error('Origem JSON absoluta e explícita é obrigatória.');
  }
  const resolved = path.resolve(source);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw Error('Origem JSON não encontrada.');
  }
  if (stat.isSymbolicLink() || !stat.isFile() || path.extname(resolved).toLowerCase() !== '.json') {
    throw Error('Origem deve ser arquivo JSON regular, não link simbólico.');
  }
  return resolved;
}
function schemaStatements(includePhase5 = process.env.APP_ENV === 'fair') {
  const files = includePhase5 ? ['001_initial.sql', '002_phase5.sql'] : ['001_initial.sql'];
  return files.flatMap(file =>
    fs.readFileSync(path.join(__dirname, '../database/mysql', file), 'utf8')
      .replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)
  );
}
async function migrate({ source, backupDir, apply = false, options, approved = process.env.RENOLINK_MYSQL_MIGRATION_APPROVED === '1' }) {
  const validatedSource = validateSource(source);
  let migrationOptions = options;
  const migrationTables = process.env.APP_ENV === 'fair' ? FAIR_TABLES : BASE_TABLES;
  if (process.env.APP_ENV === 'fair') {
    if (typeof backupDir !== 'string' || !backupDir.trim() || !path.isAbsolute(backupDir)) {
      throw Error('Ambiente feira exige --backup-dir absoluto e explícito.');
    }
    const targetOptions = options || mysql.config();
    migrationOptions = mysql.assertFairTarget(
      targetOptions,
      'migrator',
      targetOptions.expectedServerUuid || process.env.RENOLINK_FAIR_MYSQL_SERVER_UUID
    );
  }
  const verified = backup(validatedSource, backupDir);
  const db = safeSessions(validate(JSON.parse(fs.readFileSync(verified.path, 'utf8'))));
  if (!apply) return { mode: 'preflight', sha256: verified.sha256, counts: verified.counts };
  if (!approved) throw Error('Importação MySQL exige aprovação explícita.');
  if (fs.existsSync(validatedSource + '.lock')) throw Error('Origem com lock: pare a aplicação antes de importar.');
  const connectionPool = mysql.pool(migrationOptions);
  try {
    return await mysql.withLock(connectionPool, async client => {
      // DDL no MySQL causa commits implícitos. Nunca misturar com a importação DML.
      const [existing] = await client.execute('SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.tables WHERE table_schema = DATABASE()');
      const expected = migrationTables;
      if (existing.some(row => !expected.includes(row.name) || row.engine !== 'InnoDB')) throw Error('Destino deve ser dedicado à RenoLink e usar InnoDB.');
      for (const statement of schemaStatements(process.env.APP_ENV === 'fair')) await client.query(statement);
      return mysql.inTransaction(client, async () => {
        const [imports] = await client.execute('SELECT source_sha256 FROM renolink_imports WHERE source_sha256 = ?', [verified.sha256]);
        if (imports.length) return { mode: 'already-imported', counts: mysql.verify(db, await mysql.load(client)) };
        for (const table of migrationTables) {
          const [[row]] = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
          if (Number(row.count) !== 0) throw Error('Destino não vazio: importação recusada.');
        }
        await mysql.save(client, db, true);
        const counts = mysql.verify(db, await mysql.load(client));
        await client.execute('INSERT INTO renolink_imports(source_sha256, counts) VALUES (?, ?)', [verified.sha256, JSON.stringify(counts)]);
        return { mode: 'imported', counts };
      }, migrationOptions?.database);
    }, migrationOptions?.database, migrationOptions?.expectedServerUuid);
  } finally { await connectionPool.end(); }
}
function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!['--check', '--apply', '--source', '--backup-dir'].includes(flag)) {
      throw Error('Argumentos inválidos.');
    }
    if (flag === '--check' || flag === '--apply') {
      if (values.mode) throw Error('Escolha somente --check ou --apply.');
      values.mode = flag.slice(2);
      continue;
    }
    if (values[flag]) throw Error('Argumento repetido.');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw Error('Valor de argumento ausente.');
    values[flag] = value;
  }
  if (!values.mode || !values['--source']) {
    throw Error('Use --check ou --apply e informe --source com caminho absoluto JSON.');
  }
  const source = validateSource(values['--source']);
  if (process.env.APP_ENV === 'fair' &&
      (!values['--backup-dir'] || !path.isAbsolute(values['--backup-dir']))) {
    throw Error('Ambiente feira exige --backup-dir absoluto e explícito.');
  }
  const backupDir = values['--backup-dir']
    ? path.resolve(values['--backup-dir'])
    : path.join(__dirname, '../data/backups');
  return { source, backupDir, apply: values.mode === 'apply' };
}
async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    const result = await migrate(options);
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error('Preflight/importação MySQL recusado. Informe origem JSON absoluta e destino dedicado válido. Nenhum segredo foi registrado.');
    process.exitCode = 1;
  }
}
if (require.main === module) {
  main();
}
module.exports = { migrate, parseArgs, validateSource, main, schemaStatements };
