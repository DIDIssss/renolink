'use strict';
const fs = require('node:fs');
const { validate, stable } = require('../../lib/data');
const { digest, fail } = require('../../lib/security');
const mappings = {
  users: ['id', 'name', 'email', 'role', 'company', 'salt', 'passwordHash', 'createdAt'],
  ideas: ['id', 'userId', 'title', 'category', 'problem', 'solution', 'beneficiaries', 'participation', 'status', 'potential', 'createdAt', 'updatedAt'],
  negotiations: ['id', 'ideaId', 'creatorUserId', 'companyUserId', 'status', 'createdAt', 'updatedAt'],
  messages: ['id', 'fromUserId', 'toUserId', 'text', 'createdAt'],
  sessions: ['tokenHash', 'userId', 'createdAt', 'expiresAt', 'revokedAt']
};
const activeMappings = db => db.meta.schemaVersion === 5 ? { ...mappings, ...require('../../lib/phase5-data').mappings } : mappings;
const column = key => key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const quoted = key => '`' + column(key) + '`';
function config(env = process.env, prefix = 'MYSQL_') {
  const get = key => env[prefix + key];
  if (!get('HOST') || !get('DATABASE') || !get('USER') || !get('PASSWORD')) throw Error('Configuração MySQL incompleta.');
  const port = Number(get('PORT') || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Porta MySQL inválida.');
  if (get('SSL') && !['0', '1'].includes(get('SSL'))) throw Error('MYSQL_SSL deve ser 0 ou 1.');
  if (get('SSL_CA') && get('SSL') !== '1') throw Error('Certificado exige MYSQL_SSL=1.');
  if (env.NODE_ENV === 'production' && get('SSL') !== '1') throw Error('Produção exige TLS no MySQL.');
  return {
    host: get('HOST'), port, database: get('DATABASE'), user: get('USER'), password: get('PASSWORD'),
    charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false, namedPlaceholders: false, enableKeepAlive: true,
    connectionLimit: 5, queueLimit: 100, waitForConnections: true, connectTimeout: 5000,
    ssl: get('SSL') === '1' ? { rejectUnauthorized: true, verifyIdentity: true, ...(get('SSL_CA') ? { ca: fs.readFileSync(get('SSL_CA')) } : {}) } : undefined
  };
}
function pool(options = config()) { return require('mysql2/promise').createPool(options); }
function assertVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match || /mariadb/i.test(version) || Number(match[1]) !== 8 || ![0, 4].includes(Number(match[2])) || (Number(match[2]) === 0 && Number(match[3]) < 17)) throw Error('Use MySQL 8.0.17+ ou 8.4 LTS; CHECK e utf8mb4_0900_bin são necessários.');
}
async function withLock(connectionPool, fn) {
  const client = await connectionPool.getConnection();
  let locked = false, usable = true, lockName;
  try {
    const [[info]] = await client.execute('SELECT DATABASE() AS db, VERSION() AS version');
    assertVersion(info.version);
    if (!info.db) throw Error('Banco MySQL não selecionado.');
    lockName = 'renolink:' + digest(info.db).slice(0, 40);
    usable = false; // Se a resposta ao GET_LOCK falhar, não devolver conexão possivelmente bloqueada ao pool.
    const [[lock]] = await client.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    usable = true;
    if (Number(lock.acquired) !== 1) throw fail(503, 'Armazenamento ocupado. Tente novamente.');
    locked = true;
    await client.query("SET SESSION time_zone = '+00:00'");
    await client.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    await client.query('SET SESSION innodb_lock_wait_timeout = 10');
    return await fn(client);
  } finally {
    if (locked) {
      try {
        const [[released]] = await client.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
        usable = Number(released.released) === 1;
      } catch { usable = false; }
    }
    if (usable) client.release(); else client.destroy();
  }
}
async function inTransaction(client, fn) {
  await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await client.beginTransaction();
  try {
    const result = await fn(client);
    await client.commit();
    return result;
  } catch (error) {
    try { await client.rollback(); } catch { client.destroy(); }
    throw error;
  }
}
const transaction = (connectionPool, fn) => withLock(connectionPool, client => inTransaction(client, fn));
function jsonValue(value) { return typeof value === 'string' ? JSON.parse(value) : value; }
async function load(client) {
  const [meta] = await client.execute('SELECT payload FROM renolink_meta WHERE id = 1');
  if (meta.length !== 1) throw Error('Destino não inicializado; migração autorizada necessária.');
  const db = { meta: jsonValue(meta[0].payload) };
  for (const [key, fields] of Object.entries(activeMappings(db))) {
    const [rows] = await client.execute(`SELECT * FROM renolink_${column(key)}`);
    db[key] = rows.map(row => ({ ...jsonValue(row.extra), ...Object.fromEntries(fields.map(field => {
      let value = row[column(field)];
      if (value instanceof Date) value = value.toISOString();
      if (field === 'id' || field.endsWith('Id')) value = value === null ? null : Number(value);
      return [field, value];
    })) }));
  }
  return validate(db);
}
function values(row, fields) {
  const extra = Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
  return [...fields.map(key => {
    const value = row[key] === undefined ? null : row[key];
    return value && /At$/.test(key) ? new Date(value) : value;
  }), JSON.stringify(extra)];
}
async function save(client, db, insertOnly = false, previous = null) {
  validate(db);
  for (const [key, fields] of Object.entries(activeMappings(db))) {
    const table = 'renolink_' + column(key);
    const columns = [...fields.map(quoted), '`extra`'];
    const primary = key === 'sessions' ? 'tokenHash' : key === 'staff' ? 'userId' : 'id';
    const prior = previous ? new Map(previous[key].map(row=>[row[primary],row])) : null;
    for (const row of db[key]) {
      if(prior?.has(row[primary])&&stable(prior.get(row[primary]))===stable(row))continue;
      let exists = false;
      if(prior)exists=prior.has(row[primary]);
      else if (!insertOnly) {
        const [rows] = await client.execute(`SELECT ${quoted(primary)} FROM ${table} WHERE ${quoted(primary)} = ?`, [row[primary]]);
        exists = rows.length > 0;
      }
      // Evitar ON DUPLICATE KEY UPDATE: conflito de e-mail não pode sobrescrever outro ID.
      const packed = values(row, fields);
      if (exists) {
        await client.execute(`UPDATE ${table} SET ${columns.map(c => c + ' = ?').join(', ')} WHERE ${quoted(primary)} = ?`, [...packed, row[primary]]);
      } else {
        await client.execute(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, packed);
      }
    }
  }
  const payload = JSON.stringify(db.meta);
  if (insertOnly) await client.execute('INSERT INTO renolink_meta(id, payload) VALUES (1, ?)', [payload]);
  else if(!previous||stable(previous.meta)!==stable(db.meta))await client.execute('UPDATE renolink_meta SET payload = ? WHERE id = 1', [payload]);
}
function verify(expected, actual) {
  validate(expected); validate(actual);
  const sorted = db => ({ meta: db.meta, ...Object.fromEntries(Object.keys(activeMappings(db)).map(k => [k, [...db[k]].sort((a, b) => String(a.id || a.tokenHash || a.userId).localeCompare(String(b.id || b.tokenHash || b.userId)))])) });
  if (stable(sorted(expected)) !== stable(sorted(actual))) throw Error('Validação pós-importação falhou: IDs, contagens ou conteúdo divergente.');
  return Object.fromEntries(Object.keys(activeMappings(expected)).map(k => [k, actual[k].length]));
}
function mysqlStore(options, {connectionPool=pool(options), observe=()=>{}}={}) {
  return {
    transaction: fn => transaction(connectionPool, async client => {
      const time=()=>performance.now();let start=time();
      const db = await load(client);observe('load',time()-start);start=time();
      const previous = structuredClone(db), before = stable(db);observe('cloneFingerprint',time()-start);start=time();
      const result = await fn(db);
      observe('handler',time()-start);start=time();
      validate(db);
      if (stable(db) !== before) await save(client, db, false, previous);
      observe('validateDiffSave',time()-start);
      return result;
    }),
    close: () => connectionPool.end()
  };
}
module.exports = { config, pool, assertVersion, withLock, inTransaction, transaction, load, save, verify, mysqlStore, mappings };
