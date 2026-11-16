'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { postgresStore } = require('../lib/postgres');

test('Inicialização PostgreSQL mantém controles sem carregar snapshot', async t => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql.includes("payload->>'schemaVersion'")) return { rows: [{ version: '5' }] };
      return { rows: [] };
    },
    release() {}
  };
  const connect = t.mock.method(Pool.prototype, 'connect', async () => client);
  const end = t.mock.method(Pool.prototype, 'end', async () => {});
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://localhost/renolink-mock';
  try {
    const store = postgresStore();
    await store.initialize();
    await store.close();
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }

  assert.equal(connect.mock.callCount(), 1);
  assert.equal(end.mock.callCount(), 1);
  assert.ok(queries.includes('SELECT pg_advisory_xact_lock($1)'));
  assert.ok(queries.some(sql => sql.includes("payload->>'schemaVersion'")));
  assert.ok(!queries.some(sql => /SELECT \* FROM renolink_/.test(sql)));
  assert.ok(queries.includes('COMMIT'));
});
