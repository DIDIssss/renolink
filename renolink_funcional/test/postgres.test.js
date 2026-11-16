'use strict';
// Executar apenas em PostgreSQL de TESTE autorizado. Não usa DATABASE_URL implícita.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { migrate } = require('../scripts/migrate-postgres');
const { postgresStore, transaction, load } = require('../lib/postgres');
const { createServer } = require('../server');
const { once } = require('node:events');
const { digest } = require('../lib/security');
const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.RENOLINK_TEST_POSTGRES_APPROVED === '1');
test('PostgreSQL real: migração repetida, restrições, concorrência entre pools e rollback', { skip: !enabled }, async t => {
  const { Pool } = require('pg');
  const schema = 'renolink_test_' + crypto.randomBytes(8).toString('hex');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  // O schema é novo e fica preservado; nenhum DROP ou DELETE é executado.
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  process.env.RENOLINK_MIGRATION_APPROVED = '1';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-pg-test-'));
  const source = path.join(dir, 'source.json');
  const createdAt = '2026-08-23T12:00:00.000Z';
  const data = { meta: { nextUserId: 2, nextIdeaId: 1, nextMessageId: 1, nextNegotiationId: 1 }, users: [{ id: 1, name: 'Teste PostgreSQL', email: 'teste@pg.invalid', role: 'creator', company: '', salt: 'teste', passwordHash: digest('teste:123456'), createdAt }], ideas: [], messages: [], negotiations: [], sessions: [] };
  fs.writeFileSync(source, JSON.stringify(data));
  const options = { source, backupDir: path.join(dir, 'backup'), apply: true };
  assert.equal((await migrate(options)).mode, 'imported');
  assert.equal((await migrate(options)).mode, 'already-imported');
  const stores = [postgresStore(), postgresStore()];
  const servers = stores.map(createServer);
  t.after(async () => {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    for (const store of stores) await store.close();
  });
  for (const server of servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  const bases = servers.map(s => `http://127.0.0.1:${s.address().port}`);
  const response = await fetch(bases[0] + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'teste@pg.invalid', password: '123456' }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const results = await Promise.all(Array.from({ length: 12 }, async (_, n) => {
    const r = await fetch(bases[n % 2] + '/api/ideas', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Paralela ${n}`, category: 'Tecnologia', problem: 'Problema', solution: 'Solução' }) });
    assert.equal(r.status, 201); return (await r.json()).idea.id;
  }));
  assert.equal(new Set(results).size, 12);
  assert.equal(await stores[0].transaction(db => db.ideas.length), 12);
  await assert.rejects(stores[0].transaction(db => { db.ideas[0].title = 'Rollback'; throw Error('Teste'); }));
  assert.notEqual(await stores[1].transaction(db => db.ideas[0].title), 'Rollback');
  const check = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Duplicação e referência ausente devem ser rejeitadas pelo banco real.
    await assert.rejects(transaction(check, client => client.query("INSERT INTO renolink_users SELECT id+10, name, email, role, company, salt, password_hash, created_at, extra FROM renolink_users LIMIT 1")), error => error.code === '23505');
    await assert.rejects(transaction(check, client => client.query("INSERT INTO renolink_messages(id, from_user_id, to_user_id, text, created_at) VALUES(999,1,999,'Teste',now())")), error => error.code === '23503');
    assert.equal((await transaction(check, load)).messages.length, 0);
  } finally { await check.end(); }
  assert.equal(digest(fs.readFileSync(source)), digest(Buffer.from(JSON.stringify(data))));
});
