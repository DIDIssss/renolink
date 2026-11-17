'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mysql = require('../lib/mysql');
const { migrate, parseArgs, validateSource, main, schemaStatements } = require('../scripts/migrate-mysql');
const { fixture } = require('./fixtures/mysql');
const { createFairFixture } = require('./fixtures/fair-synthetic');
const { writeFixture } = require('../scripts/create-fair-fixture');
const { digest } = require('../lib/security');
const { initializeStorage } = require('../server');
function fakePool({ lock = 1, release = 1, database = 'isolado', schemaVersion = 5, serverPort = 3307, serverUuid = '11111111-1111-4111-8111-111111111111' } = {}) {
  const calls = [];
  const client = {
    execute: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('VERSION()')) return [[{ db: database, version: '8.0.46', serverPort, serverUuid }]];
      if (sql.includes('GET_LOCK')) return [[{ acquired: lock }]];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: release }]];
      if (sql.includes('JSON_EXTRACT')) return [schemaVersion === null ? [] : [{ version: schemaVersion }]];
      return [[]];
    },
    query: async sql => { calls.push({ sql }); },
    beginTransaction: async () => calls.push({ sql: 'BEGIN' }),
    commit: async () => calls.push({ sql: 'COMMIT' }),
    rollback: async () => calls.push({ sql: 'ROLLBACK' }),
    release: () => calls.push({ sql: 'POOL_RELEASE' }),
    destroy: () => calls.push({ sql: 'DESTROY' })
  };
  return { calls, client, getConnection: async () => client };
}
test('Config MySQL exige credenciais explícitas, limita opções e exige TLS em produção', () => {
  assert.throws(() => mysql.config({}), /incompleta/);
  const env = { MYSQL_HOST: '127.0.0.1', MYSQL_DATABASE: 'isolado', MYSQL_USER: 'teste', MYSQL_PASSWORD: 'sintética' };
  const config = mysql.config(env);
  assert.equal(config.port, 3306); assert.equal(config.multipleStatements, false); assert.equal(config.timezone, 'Z');
  assert.throws(() => mysql.config({ ...env, MYSQL_PORT: '3306;DROP' }), /Porta/);
  assert.throws(() => mysql.config({ ...env, NODE_ENV: 'production' }), /TLS/);
  assert.equal(mysql.config({ ...env, NODE_ENV: 'production', MYSQL_SSL: '1' }).ssl.rejectUnauthorized, true);
  assert.throws(() => mysql.config({
    ...env, NODE_ENV: 'production', MYSQL_DATABASE: 'renolink_dev'
  }), /desenvolvimento\/teste/);
});
test('Ambiente feira aceita somente destino loopback, schema, papel e TLS autorizados', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-fair-ca-'));
  const ca = path.join(dir, 'ca.pem');
  fs.writeFileSync(ca, 'synthetic CA fixture');
  const env = {
    APP_ENV: 'fair', NODE_ENV: 'production', MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: '3307', MYSQL_DATABASE: 'renolink_feira',
    MYSQL_USER: 'renolink_feira_app', MYSQL_PASSWORD: 'synthetic-only',
    MYSQL_SSL: '1', MYSQL_SSL_CA: ca,
    RENOLINK_FAIR_MYSQL_SERVER_UUID: '11111111-1111-4111-8111-111111111111'
  };
  assert.equal(mysql.config(env).database, 'renolink_feira');
  assert.equal(mysql.config(env).expectedServerUuid, env.RENOLINK_FAIR_MYSQL_SERVER_UUID);
  for (const patch of [
    { MYSQL_DATABASE: 'renolink_dev' }, { MYSQL_DATABASE: 'renolink_test' },
    { MYSQL_DATABASE: 'renolink_fair' }, { MYSQL_DATABASE: 'another_database' }, { MYSQL_HOST: 'localhost' },
    { MYSQL_HOST: '192.0.2.10' }, { MYSQL_PORT: '3306' },
    { MYSQL_USER: 'root' },
    { RENOLINK_FAIR_MYSQL_SERVER_UUID: '' },
    { RENOLINK_FAIR_MYSQL_SERVER_UUID: '00000000-0000-0000-0000-000000000000' }
  ]) {
    assert.throws(() => mysql.config({ ...env, ...patch }), /Destino MySQL da feira não autorizado|Banco de desenvolvimento\/teste/);
  }
  assert.throws(() => mysql.config({ ...env, MYSQL_SSL: '0' }), /Certificado exige MYSQL_SSL=1/);
  assert.equal(mysql.config({
    ...env, MYSQL_USER: 'renolink_feira_migrator', RENOLINK_FAIR_DB_ROLE: 'migrator'
  }).user, 'renolink_feira_migrator');
  assert.throws(() => mysql.config({
    ...env, MYSQL_USER: 'renolink_feira_app', RENOLINK_FAIR_DB_ROLE: 'migrator'
  }), /Destino MySQL da feira não autorizado/);
});
test('Versões suportadas exigem CHECK; MariaDB e versões diferentes são recusadas', () => {
  for (const v of ['8.0.17', '8.0.46', '8.4.8']) mysql.assertVersion(v);
  for (const v of ['5.7.44', '8.0.15', '8.0.16', '9.0.1', '10.11.0-MariaDB']) assert.throws(() => mysql.assertVersion(v));
});
test('Transação usa a mesma conexão e libera lock após commit', async () => {
  const pool = fakePool();
  assert.equal(await mysql.transaction(pool, async client => { assert.equal(client, pool.client); return 'ok'; }), 'ok');
  const calls = pool.calls.map(c => c.sql);
  assert.ok(calls.findIndex(s => s.includes('GET_LOCK')) < calls.indexOf('BEGIN'));
  assert.ok(calls.indexOf('BEGIN') < calls.indexOf('COMMIT'));
  assert.ok(calls.indexOf('COMMIT') < calls.findIndex(s => s.includes('RELEASE_LOCK')));
  assert.equal(calls.at(-1), 'POOL_RELEASE');
});
test('Inicialização MySQL mantém lock e transação sem carregar snapshot nem dados sensíveis', async () => {
  const pool = fakePool();
  const store = mysql.mysqlStore({}, { connectionPool: pool });
  await store.initialize();
  const calls = pool.calls.map(c => c.sql);
  assert.ok(calls.some(s => s.includes('GET_LOCK')));
  assert.ok(calls.includes('BEGIN'));
  assert.ok(calls.includes('COMMIT'));
  assert.ok(calls.some(s => s.includes('RELEASE_LOCK')));
  assert.ok(calls.some(s => s.includes('JSON_EXTRACT(payload') && s.includes('renolink_meta')));
  assert.ok(!calls.some(s => /SELECT payload|JSON_OBJECT|FROM renolink_(users|sessions)/i.test(s)));
  assert.ok(!calls.some(s => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(s)));
  assert.equal(calls.at(-1), 'POOL_RELEASE');
});
test('Inicialização falha antes do lock se o banco selecionado divergir do destino configurado', async () => {
  const pool = fakePool({ database: 'renolink_dev' });
  const store = mysql.mysqlStore({ database: 'renolink_feira' }, { connectionPool: pool });
  await assert.rejects(store.initialize(), /não corresponde ao destino configurado/);
  const calls = pool.calls.map(c => c.sql);
  assert.ok(!calls.some(s => s.includes('GET_LOCK') || s === 'BEGIN'));
  assert.equal(calls.at(-1), 'POOL_RELEASE');
});
test('Instância da feira valida banco, porta e UUID antes do lock', async () => {
  const expectedUuid = '11111111-1111-4111-8111-111111111111';
  const wrongServer = fakePool({ database: 'renolink_feira', serverUuid: '22222222-2222-4222-8222-222222222222' });
  const store = mysql.mysqlStore({
    database: 'renolink_feira',
    expectedServerUuid: expectedUuid
  }, { connectionPool: wrongServer });
  await assert.rejects(store.initialize(), /Identidade da instância MySQL da feira divergente/);
  assert.ok(!wrongServer.calls.some(call => call.sql.includes('GET_LOCK') || call.sql === 'BEGIN'));

  const wrongPort = fakePool({ database: 'renolink_feira', serverPort: 3306 });
  await assert.rejects(mysql.withLock(wrongPort, () => {}, 'renolink_feira', expectedUuid), /Identidade da instância MySQL da feira divergente/);
  assert.ok(!wrongPort.calls.some(call => call.sql.includes('GET_LOCK')));
});
test('Inicialização recusa schema ausente ou incompatível e faz rollback', async () => {
  const pool = fakePool({ schemaVersion: null });
  const store = mysql.mysqlStore({}, { connectionPool: pool });
  await assert.rejects(store.initialize(), /Schema MySQL RenoLink incompatível/);
  const calls = pool.calls.map(c => c.sql);
  assert.ok(calls.includes('ROLLBACK'));
  assert.ok(!calls.includes('COMMIT'));
  assert.equal(calls.at(-1), 'POOL_RELEASE');
});
test('Startup prefere initialize explícito e mantém compatibilidade com stores antigos', async () => {
  const calls = [];
  await initializeStorage({
    initialize: async () => calls.push('initialize'),
    transaction: async () => calls.push('transaction')
  });
  await initializeStorage({ transaction: async callback => {
    calls.push('legacy-transaction');
    await callback();
  } });
  assert.deepEqual(calls, ['initialize', 'legacy-transaction']);
});
test('Erro após escrita SQL dispara rollback, sem commit, e libera lock', async () => {
  const pool = fakePool();
  await assert.rejects(mysql.transaction(pool, async client => { await client.execute('UPDATE renolink_meta SET payload = ? WHERE id = 1', ['{}']); throw Error('Falha após escrita'); }));
  const sql = pool.calls.map(c => c.sql);
  assert.ok(sql.includes('ROLLBACK')); assert.ok(!sql.includes('COMMIT')); assert.equal(sql.at(-1), 'POOL_RELEASE');
});
test('Lock indisponível impede transação; falha ao liberar descarta conexão', async () => {
  const busy = fakePool({ lock: 0 });
  await assert.rejects(mysql.transaction(busy, () => {}), e => e.status === 503);
  assert.ok(!busy.calls.some(c => c.sql === 'BEGIN'));
  const broken = fakePool({ release: null });
  await mysql.transaction(broken, () => {});
  assert.equal(broken.calls.at(-1).sql, 'DESTROY');
});
test('Prepared statements mantêm payload de SQL injection somente nos parâmetros', async () => {
  const calls = [], client = { execute: async (sql, params) => { calls.push({ sql, params }); return [[]]; } };
  const db = fixture(); db.users[0].name = "'; DROP TABLE renolink_users; --";
  await mysql.save(client, db, true);
  assert.ok(calls.every(c => !c.sql.includes('DROP TABLE')));
  const insert = calls.find(c => c.sql.startsWith('INSERT INTO renolink_users'));
  assert.ok(insert.sql.includes('?')); assert.equal(insert.params[1], db.users[0].name);
  assert.ok(!calls.some(c => c.sql.includes('ON DUPLICATE KEY')));
});
test('Mapeamento preserva dados, IDs, autoria nula, Unicode, JSON extra e datas UTC', async () => {
  const db = fixture(); db.users[0].custom = { valor: 'preservar' };
  const client = { execute: async sql => {
    if (sql.includes('FROM renolink_meta')) return [[{ payload: JSON.stringify(db.meta) }]];
    const key = Object.keys(mysql.mappings).find(k => sql.endsWith('renolink_' + k));
    return [db[key].map(row => {
      const fields = mysql.mappings[key];
      return { extra: JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !fields.includes(k)))), ...Object.fromEntries(fields.map(k => [k.replace(/[A-Z]/g, c => '_' + c.toLowerCase()), /At$/.test(k) && row[k] ? new Date(row[k]) : row[k]])) };
    })];
  } };
  assert.deepEqual(mysql.verify(db, await mysql.load(client)), { users: 3, ideas: 3, negotiations: 1, messages: 1, sessions: 0 });
  const different = structuredClone(db); different.messages[0].toUserId = 3;
  assert.throws(() => mysql.verify(db, different), /divergente/);
});
test('Preflight cria backup verificável sem abrir MySQL; aprovação e lock impedem importação', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-mysql-unit-'));
  const source = path.join(dir, 'source.json'); const bytes = Buffer.from(JSON.stringify(fixture())); fs.writeFileSync(source, bytes);
  const opts = { source, backupDir: path.join(dir, 'backup') };
  assert.equal((await migrate(opts)).mode, 'preflight');
  assert.equal((await migrate(opts)).sha256, digest(bytes));
  await assert.rejects(migrate({ ...opts, apply: true, approved: false }), /aprovação/);
  fs.writeFileSync(source + '.lock', 'sintético');
  await assert.rejects(migrate({ ...opts, apply: true, approved: true }), /lock/);
  assert.deepEqual(fs.readFileSync(source), bytes);
});
test('Migrador exige origem JSON absoluta, existente e regular antes de qualquer escrita', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-mysql-source-'));
  const backupDir = path.join(dir, 'must-not-be-created');
  await assert.rejects(migrate({ backupDir }), /Origem JSON absoluta e explícita/);
  await assert.rejects(migrate({ source: path.join(dir, 'missing.json'), backupDir }), /não encontrada/);
  assert.throws(() => validateSource('relative.json'), /absoluta e explícita/);
  assert.throws(() => parseArgs(['--check']), /--source/);
  assert.equal(fs.existsSync(backupDir), false);
});
test('Argumentos do migrador preservam origem explícita e feira exige diretório de backup explícito', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-mysql-args-'));
  const source = path.join(dir, 'fixture.json');
  fs.writeFileSync(source, JSON.stringify(fixture()));
  const args = parseArgs(['--check', '--source', source, '--backup-dir', path.join(dir, 'backup')]);
  assert.equal(args.source, source);
  assert.equal(args.apply, false);
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = 'fair';
  try {
    assert.throws(() => parseArgs(['--check', '--source', source]), /--backup-dir absoluto e explícito/);
    assert.throws(() => parseArgs(['--check', '--source', source, '--source', source]), /repetido/);
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
});
test('Migrador da feira rejeita banco divergente antes de criar backup ou conectar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-fair-migration-'));
  const source = path.join(dir, 'fixture.json');
  const backupDir = path.join(dir, 'backup');
  fs.writeFileSync(source, JSON.stringify(fixture()));
  const previous = process.env.APP_ENV;
  process.env.APP_ENV = 'fair';
  try {
    await assert.rejects(migrate({
      source, backupDir,
      options: {
        host: '127.0.0.1', port: 3306, database: 'renolink_dev',
        user: 'renolink_app', ssl: { rejectUnauthorized: true, verifyIdentity: true }
      }
    }), /Destino MySQL da feira não autorizado/);
    assert.equal(fs.existsSync(backupDir), false);
    assert.throws(() => parseArgs(['--check', '--source', source, '--backup-dir', 'relative-backups']), /--backup-dir absoluto/);
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
});
test('Fixture feira contém apenas contas e relações sintéticas completas', async () => {
  const db = await createFairFixture();
  require('../lib/data').validate(db);
  assert.equal(db.meta.schemaVersion, 5);
  assert.deepEqual(db.users.map(user => user.email), [
    'criador@feira.invalid',
    'empresa@feira.invalid',
    'atendimento@feira.invalid',
    'admin@feira.invalid'
  ]);
  assert.deepEqual(db.staff.map(member => member.accessRole), ['support', 'admin']);
  assert.equal(db.ideas.length, 1);
  assert.equal(db.messages.length, 1);
  assert.equal(db.negotiations.length, 1);
  assert.equal(db.supportMessages.length, 2);
  assert.equal(db.sessions.length, 0);
  assert.ok(db.users.every(user => user.passwordHash.startsWith('scrypt$32768$8$3$')));
});
test('Gerador de fixture exige caminho externo absoluto e recusa sobrescrita', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-fair-fixture-'));
  const target = path.join(dir, 'synthetic.json');
  try {
    await assert.rejects(writeFixture('relative.json'), /Caminho absoluto/);
    const output = await writeFixture(target);
    assert.equal(output, target);
    require('../lib/data').validate(JSON.parse(fs.readFileSync(target, 'utf8')));
    await assert.rejects(writeFixture(target), /EEXIST/);
    await assert.rejects(writeFixture(path.join(__dirname, '..', 'data', 'fair.json')), /fora do projeto/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('Perfil da feira mantém porta 3100 e túnel apenas para loopback', () => {
  const fair = path.join(__dirname, '..', 'deploy', 'windows-fair');
  const env = fs.readFileSync(path.join(fair, 'fair.env.example'), 'utf8');
  const tunnel = fs.readFileSync(path.join(fair, 'cloudflared.yml.example'), 'utf8');
  const startup = fs.readFileSync(path.join(fair, 'Start-Fair.ps1'), 'utf8');
  const services = [...tunnel.matchAll(/service:\s*(http:\/\/127\.0\.0\.1:\d+|http_status:\d+)/g)].map(match => match[1]);
  assert.deepEqual(require('../lib/hosting').binding({APP_ENV:'fair',PORT:'3100'}),{host:'127.0.0.1',port:3100});
  assert.deepEqual(require('../lib/hosting').binding({}),{host:'127.0.0.1',port:3000});
  assert.match(env, /^PORT=3100$/m);
  assert.match(startup, /\$env:PORT -ne '3100'/);
  assert.deepEqual(services, ['http://127.0.0.1:3100', 'http_status:404']);
  assert.match(env, /^MYSQL_DATABASE=renolink_feira$/m);
  assert.match(env, /^RENOLINK_FAIR_MYSQL_SERVER_UUID=$/m);
});
test('Erro de uso do migrador não registra caminho ou conteúdo sensível', async () => {
  const output = [], original = console.error, oldExitCode = process.exitCode;
  console.error = value => output.push(String(value));
  try {
    await main(['--check']);
  } finally {
    console.error = original;
    process.exitCode = oldExitCode;
  }
  assert.equal(output.length, 1);
  assert.doesNotMatch(output[0], /password|salt|payload|[A-Z]:\\/i);
  assert.match(output[0], /Nenhum segredo foi registrado/);
});
test('Schema completo feira usa doze tabelas InnoDB sem alterar o DDL base', () => {
  const base = schemaStatements(false);
  const ddl = schemaStatements(true);
  assert.equal(base.length, 7);
  assert.equal(ddl.length, 12);
  assert.ok(ddl.every(s => s.startsWith('CREATE TABLE IF NOT EXISTS') && s.includes('ENGINE=InnoDB')));
  assert.ok(!ddl.some(s => /\b(DROP|TRUNCATE|DELETE)\b/.test(s.replaceAll('ON DELETE RESTRICT', ''))));
  assert.deepEqual(ddl.map(s => /^CREATE TABLE IF NOT EXISTS (renolink_\w+)/.exec(s)?.[1]).sort(), [
    'renolink_audit', 'renolink_conversations', 'renolink_ideas', 'renolink_imports',
    'renolink_meta', 'renolink_messages', 'renolink_negotiations', 'renolink_requests',
    'renolink_sessions', 'renolink_staff', 'renolink_support_messages', 'renolink_users'
  ].sort());
});
