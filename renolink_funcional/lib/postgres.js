'use strict';
const { validate, stable } = require('./data');
const LOCK_ID = 73192026;
// Mapeamento fechado: identificadores SQL nunca vêm de requisições.
const mappings = {
  users: ['id', 'name', 'email', 'role', 'company', 'salt', 'passwordHash', 'createdAt'],
  ideas: ['id', 'userId', 'title', 'category', 'problem', 'solution', 'beneficiaries', 'participation', 'status', 'potential', 'createdAt', 'updatedAt'],
  negotiations: ['id', 'ideaId', 'creatorUserId', 'companyUserId', 'status', 'createdAt', 'updatedAt'],
  messages: ['id', 'fromUserId', 'toUserId', 'text', 'createdAt'],
  sessions: ['tokenHash', 'userId', 'createdAt', 'expiresAt', 'revokedAt']
};
const column = key => key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
function pool() {
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL não configurada.');
  // A URL vem exclusivamente do operador; nenhum segredo é inventado ou impresso.
  const { Pool } = require('pg');
  const connectionPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000, application_name: 'renolink' });
  connectionPool.on('error', () => console.error('Conexão PostgreSQL indisponível.'));
  return connectionPool;
}
async function transaction(connectionPool, fn) {
  const client = await connectionPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function load(client) {
  const meta = await client.query('SELECT payload FROM renolink_meta WHERE id = 1');
  if (meta.rows.length !== 1) throw Error('Destino não inicializado; execute a migração autorizada.');
  const db = { meta: meta.rows[0].payload };
  for (const [key, fields] of Object.entries(mappings)) {
    const { rows } = await client.query(`SELECT * FROM renolink_${key}`);
    db[key] = rows.map(row => ({ ...row.extra, ...Object.fromEntries(fields.map(field => {
      let value = row[column(field)];
      if (value instanceof Date) value = value.toISOString();
      if (field === 'id' || field.endsWith('Id')) value = value === null ? null : Number(value);
      return [field, value];
    })) }));
  }
  return validate(db);
}
async function save(client, db, insertOnly = false) {
  validate(db);
  for (const [key, fields] of Object.entries(mappings)) {
    const columns = [...fields.map(column), 'extra'];
    const primary = key === 'sessions' ? 'token_hash' : 'id';
    const placeholders = columns.map((_, i) => '$' + (i + 1));
    const conflict = insertOnly ? '' : ` ON CONFLICT (${primary}) DO UPDATE SET ${columns.filter(c => c !== primary).map(c => `${c} = EXCLUDED.${c}`).join(', ')}`;
    for (const row of db[key]) {
      const extra = Object.fromEntries(Object.entries(row).filter(([k]) => !fields.includes(k)));
      await client.query(`INSERT INTO renolink_${key} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})${conflict}`, [...fields.map(f => row[f] === undefined ? null : row[f]), extra]);
    }
  }
  await client.query(`INSERT INTO renolink_meta(id, payload) VALUES (1, $1)${insertOnly ? '' : ' ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload'}`, [db.meta]);
}
function comparable(db) {
  return { meta: db.meta, ...Object.fromEntries(Object.keys(mappings).map(k => [k, [...db[k]].sort((a, b) => String(a.id || a.tokenHash).localeCompare(String(b.id || b.tokenHash)))])) };
}
function verify(expected, actual) {
  validate(expected); validate(actual);
  if (stable(comparable(expected)) !== stable(comparable(actual))) throw Error('Validação pós-migração falhou: contagens, IDs ou conteúdo divergentes.');
  return Object.fromEntries(Object.keys(mappings).map(k => [k, actual[k].length]));
}
function postgresStore() {
  const connectionPool = pool();
  return {
    initialize: () => transaction(connectionPool, async client => {
      const { rows } = await client.query("SELECT payload->>'schemaVersion' AS version FROM renolink_meta WHERE id = 1");
      if (rows.length !== 1 || Number(rows[0].version) !== 5) throw Error('Schema PostgreSQL RenoLink incompatível.');
    }),
    transaction: fn => transaction(connectionPool, async client => {
      const db = await load(client);
      const before = stable(db);
      const result = await fn(db);
      if (stable(db) !== before) await save(client, db);
      return result;
    }),
    close: () => connectionPool.end()
  };
}
module.exports = { pool, transaction, load, save, verify, postgresStore };
