'use strict';
// Operator tool, deliberately separate from build, start and health checks.
const { isDeepStrictEqual } = require('node:util');
const { config } = require('../lib/mysql');
const { digest } = require('../lib/security');
const { plan } = require('./render-schema');

function connectionOptions(env) {
  if (env.MYSQL_PORT !== '3306' || env.MYSQL_PROVIDER !== 'enzonic') throw Error('target');
  const options = config({
    APP_ENV: 'render', NODE_ENV: 'production', MYSQL_PROVIDER: 'enzonic',
    MYSQL_HOST: env.MYSQL_HOST, MYSQL_PORT: env.MYSQL_PORT, MYSQL_DATABASE: env.MYSQL_DATABASE,
    MYSQL_SSL: env.MYSQL_SSL, MYSQL_SSL_CA: env.MYSQL_SSL_CA,
    MYSQL_USER: env.ENZONIC_MIGRATOR_USER, MYSQL_PASSWORD: env.ENZONIC_MIGRATOR_PASSWORD
  });
  const { host, port, database, user, password, ssl, connectTimeout } = options;
  return { host, port, database, user, password, ssl, connectTimeout, charset: options.charset, multipleStatements: false };
}

// INFORMATION_SCHEMA filters by privilege. Accept only provable, direct grants
// covering the whole database; never infer visibility from an empty result.
function sufficientGrants(rows, initialize) {
  const covered = new Set();
  let routines = false;
  for (const row of rows) {
    const line = Object.values(row)[0];
    if (typeof line !== 'string' || /^REVOKE /i.test(line)) return false;
    const grant = /^GRANT ([A-Z_, ]+) ON (\*|\x60main\x60|main)\.\* TO /.exec(line);
    if (!grant) continue;
    const names = grant[1].toUpperCase().split(', ');
    if (names.includes('ALL PRIVILEGES')) {
      for (const name of ['SELECT','EVENT','TRIGGER','EXECUTE','CREATE','REFERENCES','INSERT']) covered.add(name);
    }
    for (const name of names) covered.add(name);
    if (grant[2] === '*' && (names.includes('SELECT') || names.includes('SHOW_ROUTINE'))) routines = true;
  }
  const required = ['SELECT','EVENT','TRIGGER'];
  if (initialize) required.push('CREATE','REFERENCES','INSERT');
  return required.every(name => covered.has(name)) &&
    (routines || ['EXECUTE','CREATE ROUTINE','ALTER ROUTINE'].some(name => covered.has(name)));
}

const catalogSql = `SELECT TABLE_NAME AS name, TABLE_TYPE AS kind FROM information_schema.tables WHERE table_schema = DATABASE()
  UNION ALL SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = DATABASE()
  UNION ALL SELECT trigger_name, 'TRIGGER' FROM information_schema.triggers WHERE trigger_schema = DATABASE()
  UNION ALL SELECT event_name, 'EVENT' FROM information_schema.events WHERE event_schema = DATABASE()`;

async function inspect(client, initialize = false) {
  const [[identity]] = await client.query('SELECT DATABASE() AS db, VERSION() AS version');
  if (identity?.db !== 'main' || !/^8\.4\.\d+(?:[-+.]|$)/.test(identity.version) || /mariadb/i.test(identity.version)) throw Error('identity');
  const [[tls]] = await client.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (tls?.Variable_name !== 'Ssl_cipher' || typeof tls.Value !== 'string' || !tls.Value.trim()) throw Error('tls');
  const [grants] = await client.query('SHOW GRANTS');
  if (!sufficientGrants(grants, initialize)) throw Error('grants');
  const [objects] = await client.query(catalogSql);
  if (objects.length) throw Error('occupied');
}

async function run(mode, env, connect) {
  if (!['--check-empty','--initialize-empty-main'].includes(mode)) throw Error('mode');
  const options = connectionOptions(env);
  const schema = plan();
  const client = await connect(options);
  try {
    if (mode === '--check-empty') {
      await inspect(client);
      return 'EMPTY_VERIFIED';
    }
    // Same database-scoped advisory lock used by RenoLink transactions.
    const lock = 'renolink:' + digest(options.database).slice(0, 40);
    const [[result]] = await client.execute('SELECT GET_LOCK(?, 0) AS acquired', [lock]);
    if (Number(result?.acquired) !== 1) throw Error('busy');
    await inspect(client, true);
    for (const ddl of schema.statements.slice(0, -1)) {
      // An object created between inspection and DDL must cause an error.
      await client.query(ddl.replace(/^CREATE TABLE IF NOT EXISTS /, 'CREATE TABLE '));
    }
    const [insert] = await client.query(schema.statements.at(-1));
    if (insert.affectedRows !== 1) throw Error('metadata');
    const [objects] = await client.query(catalogSql);
    if (!objects.every(row => row.kind === 'BASE TABLE') ||
        !isDeepStrictEqual(objects.map(row => row.name).sort(), [...schema.tables].sort())) throw Error('inventory');
    for (const table of schema.tables) {
      const [[row]] = await client.query('SELECT COUNT(*) AS n FROM ' + table);
      if (String(row?.n) !== (table === 'renolink_meta' ? '1' : '0')) throw Error('counts');
    }
    const [[row]] = await client.query('SELECT payload FROM renolink_meta WHERE id = 1');
    const metadata = typeof row?.payload === 'string' ? JSON.parse(row.payload) : row?.payload;
    if (!isDeepStrictEqual(metadata, schema.meta)) throw Error('metadata');
    return 'EMPTY_SCHEMA_V5_VERIFIED';
  } finally {
    // No pool, reconnect or retry. Closing the session also releases GET_LOCK.
    await client.end();
  }
}

if (require.main === module) {
  const mode = process.argv.length === 3 ? process.argv[2] : '';
  run(mode, process.env, options => require('mysql2/promise').createConnection(options))
    .then(result => console.log(result))
    .catch(error => {
      const known = ['mode','target','busy','identity','tls','grants','occupied','inventory','metadata','counts'];
      const reason = known.includes(error?.message) ? error.message : 'connection-or-statement';
      console.error('Operacao interrompida (' + reason + '). Inspecione antes de qualquer nova tentativa.');
      process.exitCode = 1;
    });
}
module.exports = { run };
