'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { config, pool } = require('../lib/mysql');
const { plan } = require('../scripts/render-schema');
const { run } = require('../scripts/enzonic-schema');

const env = {
  MYSQL_PROVIDER: 'enzonic', MYSQL_HOST: 'renolink-prod-m84hr0.db.enzonic.com',
  MYSQL_PORT: '3306', MYSQL_DATABASE: 'main', MYSQL_SSL: '1',
  ENZONIC_MIGRATOR_USER: 'fixture', ENZONIC_MIGRATOR_PASSWORD: 'fixture'
};
const check = '--check-empty';
const apply = '--initialize-empty-main';
const visibility = 'GRANT SELECT, TRIGGER, EVENT, EXECUTE, CREATE, REFERENCES, INSERT ON `main`.* TO fixture';
function mock(overrides = {}) {
  const tables = new Set();
  const calls = [];
  let closed = 0;
  const response = {
    identity: { db: 'main', version: '8.4.7' }, cipher: 'TLS_AES_256_GCM_SHA384',
    grants: [visibility], objects: [], acquired: 1, affectedRows: 1, ...overrides
  };
  async function query(sql) {
    calls.push(sql);
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: response.acquired }]];
    if (sql.startsWith('SELECT DATABASE()')) return [[response.identity]];
    if (sql.startsWith('SHOW SESSION')) return [[{ Variable_name: 'Ssl_cipher', Value: response.cipher }]];
    if (sql === 'SHOW GRANTS') return [response.grants.map(grant => ({ grant }))];
    if (sql.includes('information_schema.tables')) {
      for (const kind of ['routines', 'triggers', 'events']) assert.ok(sql.includes('information_schema.' + kind));
      return [[...response.objects, ...Array.from(tables, name => ({ name, kind: 'BASE TABLE' }))]];
    }
    if (sql.startsWith('CREATE TABLE ')) {
      assert.ok(!sql.includes('IF NOT EXISTS'));
      if (response.ddlFailure === tables.size) throw Error('lost connection');
      tables.add(/^CREATE TABLE (\w+)/.exec(sql)[1]);
      return [{}];
    }
    if (sql.startsWith('INSERT INTO renolink_meta')) return [{ affectedRows: response.affectedRows }];
    if (sql.startsWith('SELECT COUNT(*)')) {
      return [[{ n: sql.endsWith('renolink_meta') ? 1 : response.businessRows ?? 0 }]];
    }
    if (sql.startsWith('SELECT payload')) return [[{ payload: response.payload ?? plan().meta }]];
    assert.fail('Unexpected SQL in mock');
  }
  const connect = async options => {
    assert.equal(options.host, env.MYSQL_HOST);
    assert.equal(options.port, 3306);
    assert.equal(options.database, 'main');
    assert.equal(options.multipleStatements, false);
    assert.deepEqual(options.ssl, { rejectUnauthorized: true, verifyIdentity: true });
    return { execute: query, query, end: async () => { closed++; } };
  };
  return { connect, calls, tables, closed: () => closed };
}

test('Enzonic pool uses verified DNS TLS, bounded connections and idle eviction without opening sockets', async () => {
  const options = config({ ...env, APP_ENV: 'render', MYSQL_USER: 'fixture', MYSQL_PASSWORD: 'fixture' });
  const p = pool(options);
  try {
    const actual = p.pool.config;
    assert.equal(actual.connectionLimit, 5);
    assert.equal(actual.maxIdle, 4);
    assert.equal(actual.idleTimeout, 60000);
    assert.equal(actual.connectionConfig.connectTimeout, 30000);
    assert.equal(actual.connectionConfig.ssl.verifyIdentity, true);
    assert.equal(actual.connectionConfig.ssl.rejectUnauthorized, true);
    assert.equal(p.pool._allConnections.length, 0);
  } finally { await p.end(); }
  const local = config({ MYSQL_HOST: '127.0.0.1', MYSQL_DATABASE: 'mock', MYSQL_USER: 'fixture', MYSQL_PASSWORD: 'fixture' });
  assert.equal(local.connectTimeout, 5000);
  assert.equal(local.maxIdle, undefined);
});

test('wrong endpoint, TLS, account, mode or missing private input abort before connecting', async () => {
  for (const change of [
    { MYSQL_HOST: '127.0.0.1' }, { MYSQL_HOST: 'other.db.enzonic.com' }, { MYSQL_DATABASE: 'renolink_dev' },
    { MYSQL_PORT: '3307' }, { MYSQL_SSL: '0' }, { MYSQL_PROVIDER: '' }, { ENZONIC_MIGRATOR_USER: 'root' },
    { ENZONIC_MIGRATOR_PASSWORD: '', MYSQL_PASSWORD: 'runtime-only' }
  ]) {
    let attempted = false;
    await assert.rejects(run(apply, { ...env, ...change }, async () => { attempted = true; }));
    assert.equal(attempted, false);
  }
  await assert.rejects(run('', env, null), /mode/);
});

test('read-only inventory accepts a visible empty catalog and closes session', async () => {
  const db = mock();
  assert.equal(await run(check, env, db.connect), 'EMPTY_VERIFIED');
  assert.ok(db.calls.every(sql => /^(SELECT|SHOW)/.test(sql) && !sql.includes('GET_LOCK')));
  assert.equal(db.closed(), 1);
});

test('wrong identity, missing TLS, insufficient visibility, partial revokes and lock contention stop all DDL', async () => {
  for (const override of [
    { identity: { db: 'other', version: '8.4.7' } }, { identity: { db: 'main', version: '8.0.46' } },
    { cipher: '' }, { grants: [] }, { grants: [visibility.replace('main', 'other')] },
    { grants: [visibility.replace('main', 'MAIN')] },
    { grants: [visibility.replace(', EXECUTE', '')] }, { grants: [visibility, 'REVOKE SELECT ON main.* FROM fixture'] },
    { grants: [visibility.replace(', REFERENCES', '')] }, { acquired: 0 }
  ]) {
    const db = mock(override);
    await assert.rejects(run(apply, env, db.connect));
    assert.equal(db.tables.size, 0);
    assert.equal(db.closed(), 1);
  }
});

test('any preexisting table, view, routine, trigger or event blocks initialization', async () => {
  for (const kind of ['BASE TABLE','VIEW','PROCEDURE','FUNCTION','TRIGGER','EVENT']) {
    const db = mock({ objects: [{ name: 'unrelated', kind }] });
    await assert.rejects(run(apply, env, db.connect), /occupied/);
    assert.equal(db.tables.size, 0);
  }
});

test('initialization verifies twelve tables, exact metadata and zero business records; rerun refuses', async () => {
  const db = mock();
  assert.equal(await run(apply, env, db.connect), 'EMPTY_SCHEMA_V5_VERIFIED');
  assert.deepEqual([...db.tables], plan().tables);
  assert.equal(db.calls.filter(sql => sql.startsWith('SELECT COUNT(*)')).length, 12);
  await assert.rejects(run(apply, env, db.connect), /occupied/);
  assert.equal(db.calls.filter(sql => sql.startsWith('INSERT')).length, 1);
});

test('DDL interruption stops at the failed statement without replay or destructive cleanup', async () => {
  const db = mock({ ddlFailure: 3 });
  await assert.rejects(run(apply, env, db.connect), /lost connection/);
  assert.equal(db.tables.size, 3);
  assert.equal(db.calls.filter(sql => sql.startsWith('CREATE TABLE')).length, 4);
  assert.ok(!db.calls.some(sql => /^(INSERT|DELETE|DROP|TRUNCATE|ALTER)/.test(sql)));
  assert.equal(db.closed(), 1);
});

test('metadata insertion, final counts and entire metadata payload must match', async () => {
  for (const override of [{ affectedRows: 0 }, { businessRows: 1 }, { payload: { schemaVersion: 5 } }]) {
    const db = mock(override);
    await assert.rejects(run(apply, env, db.connect), /metadata|counts/);
    assert.equal(db.closed(), 1);
  }
});
