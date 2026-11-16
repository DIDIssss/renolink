'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { fork } = require('node:child_process');
const mysql = require('../lib/mysql');
const { migrate } = require('../scripts/migrate-mysql');
const { createServer } = require('../server');
const { fixture } = require('./fixtures/mysql');
const { digest } = require('../lib/security');
const { safeSessions, stable } = require('../lib/data');
const enabled = process.env.RENOLINK_TEST_MYSQL_APPROVED === '1';
test('MySQL real: importação completa, idempotência, autenticação, concorrência, persistência e rollback SQL', { skip: !enabled }, async t => {
  const resume = process.env.RENOLINK_TEST_MYSQL_RESUME === '1';
  const options = mysql.config(process.env, 'TEST_MYSQL_');
  assert.match(options.database, /^renolink_test(?:_[a-z0-9]+)?$/);
  assert.notEqual(options.database, process.env.MYSQL_DATABASE, 'Banco de teste deve ser separado do operacional.');
  const originalFile = path.resolve(__dirname, '../data/db.json');
  const originalHash = digest(fs.readFileSync(originalFile));
  const runtimeFile = path.resolve(__dirname, '../data/runtime/db.json');
  const runtimeHash = fs.existsSync(runtimeFile) ? digest(fs.readFileSync(runtimeFile)) : null;
  const reportFile = path.resolve(__dirname, '../data/runtime/mysql-integration-report.json');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const checkpoints = [];
  const checkpoint = name => {
    checkpoints.push(name); t.diagnostic(name);
    fs.writeFileSync(reportFile, JSON.stringify({ status: 'running', database: options.database, resume, checkpoints }, null, 2));
  };
  if (resume && fs.existsSync(reportFile)) {
    const previousReport = reportFile.replace('.json', '.initial.json');
    if (!fs.existsSync(previousReport)) fs.copyFileSync(reportFile, previousReport, fs.constants.COPYFILE_EXCL);
  }
  const probe = mysql.pool(options);
  try {
    const [tables] = await probe.execute('SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()');
    assert.equal(tables.length, resume ? 7 : 0, 'Forneça banco de teste dedicado e vazio, ou retome apenas a fixture reconhecida. Nenhuma limpeza automática é executada.');
    if (resume) {
      const state = await mysql.transaction(probe, mysql.load);
      assert.deepEqual(state.users.map(u => u.email).sort(), ['pessoa1@teste.invalid', 'pessoa2@teste.invalid', 'pessoa3@teste.invalid', 'novo@teste.invalid', 'empresa-nova@teste.invalid'].sort());
      assert.equal(state.ideas.length, 15); assert.equal(state.messages.length, 2); assert.equal(state.negotiations.length, 2);
      assert.equal(state.users.find(u => u.id === 1).custom.manter, 'campo adicional');
      assert.equal(state.ideas.filter(i => /^Paralela \d+$/.test(i.title)).length, 12);
    }
  } finally { await probe.end(); }
  checkpoint('inicio: destino validado');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-mysql-integration-'));
  const source = path.join(dir, 'source.json');
  const db = fixture();
  db.users[0].custom = { manter: 'campo adicional' };
  db.sessions.push({ token: 'sessao-legada-sintetica', userId: 1, createdAt: db.users[0].createdAt });
  const bytes = Buffer.from(JSON.stringify(db)); fs.writeFileSync(source, bytes);
  const migration = { source, backupDir: path.join(dir, 'backup'), apply: true, approved: true, options };
  if (!resume) {
    assert.equal((await migrate(migration)).mode, 'imported');
    assert.equal((await migrate(migration)).mode, 'already-imported');
  } else {
    const imported = mysql.pool(options);
    try {
      const [rows] = await imported.execute('SELECT source_sha256 FROM renolink_imports');
      assert.equal(rows.length, 1); assert.equal(rows[0].source_sha256, digest(bytes), 'Retomada exige importacao da fixture sintetica exata.');
    } finally { await imported.end(); }
  }
  checkpoint(resume ? 'fixture existente reconhecida sem reimportacao' : 'schema e importacao idempotente aprovados');
  const stores = [mysql.mysqlStore(options), mysql.mysqlStore(options)];
  const servers = stores.map(createServer);
  let resourcesClosed = false;
  t.after(async () => {
    if (!resourcesClosed) {
      for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      for (const store of stores) await store.close();
    }
    assert.equal(digest(fs.readFileSync(originalFile)), originalHash);
    assert.equal(fs.existsSync(runtimeFile) ? digest(fs.readFileSync(runtimeFile)) : null, runtimeHash);
    assert.deepEqual(fs.readFileSync(source), bytes);
  });
  if (!resume) assert.equal(await stores[0].transaction(actual => mysql.verify(safeSessions(structuredClone(db)), actual).messages), 1);
  for (const server of servers) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  const bases = servers.map(s => `http://127.0.0.1:${s.address().port}`);
  async function request(route, { data, cookie, base = 0 } = {}) {
    const response = await fetch(bases[base] + route, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  assert.equal((await request('/api/auth/login', { data: { email: 'pessoa1@teste.invalid', password: 'errada' } })).status, 401);
  const creator = await request('/api/auth/login', { data: { email: 'pessoa1@teste.invalid', password: '123456' } });
  const company = await request('/api/auth/login', { data: { email: 'pessoa2@teste.invalid', password: '123456' } });
  assert.equal(creator.status, 200); assert.equal(company.status, 200); assert.equal(creator.body.token, undefined);
  assert.match(await stores[0].transaction(actual => actual.users[0].passwordHash), /^scrypt\$/);
  assert.equal((await request('/api/ideas/2', { cookie: company.cookie })).status, 404);
  checkpoint('login e autorizacao aprovados');
  let newCompany;
  if (!resume) {
  const created = await Promise.all(Array.from({ length: 12 }, (_, n) => request('/api/ideas', { base: n % 2, cookie: creator.cookie, data: { title: `Paralela ${n}`, category: 'Tecnologia', problem: 'Problema', solution: 'Solução' } })));
  assert.ok(created.every(r => r.status === 201)); assert.equal(new Set(created.map(r => r.body.idea.id)).size, 12);
  assert.equal(await stores[0].transaction(actual => actual.ideas.length), 15);
  const registration = await request('/api/auth/register', { data: { name: 'Novo visitante', email: 'novo@teste.invalid', password: 'SenhaTeste-2026', role: 'creator' } });
  assert.equal(registration.status, 201);
  const injection = "'); DROP TABLE renolink_users; --";
  assert.equal((await request('/api/messages', { cookie: creator.cookie, data: { toUserId: 2, text: injection } })).status, 201);
  assert.ok((await request('/api/messages', { cookie: company.cookie })).body.messages.some(m => m.text === injection));
  const interests = await Promise.all(Array.from({ length: 6 }, (_, n) => request('/api/ideas/1/interest', { base: n % 2, cookie: company.cookie, data: {} })));
  assert.ok(interests.every(r => r.status === 200));
  // A new company must create one negotiation, even with simultaneous requests.
  newCompany = await request('/api/auth/register', { data: { name: 'Empresa sintetica', company: 'Empresa sintetica', email: 'empresa-nova@teste.invalid', password: 'SenhaTeste-2026', role: 'company' } });
  assert.equal(newCompany.status, 201);
  const newInterests = await Promise.all(Array.from({ length: 6 }, (_, n) => request('/api/ideas/1/interest', { base: n % 2, cookie: newCompany.cookie, data: {} })));
  assert.equal(newInterests.filter(r => r.status === 201).length, 1);
  assert.equal(newInterests.filter(r => r.status === 200).length, 5);
  assert.equal(new Set(newInterests.map(r => r.body.negotiation.id)).size, 1);
  } else {
    newCompany = await request('/api/auth/login', { data: { email: 'empresa-nova@teste.invalid', password: 'SenhaTeste-2026' } });
    assert.equal(newCompany.status, 200);
  }
  assert.equal((await request('/api/negotiations', { cookie: newCompany.cookie })).body.negotiations.length, 1);
  assert.equal((await request('/api/negotiations', { cookie: creator.cookie })).body.negotiations.length, 2);
  checkpoint('ideias, mensagens e negociacoes verificadas');
  const check = mysql.pool(options);
  try {
    const before = await mysql.transaction(check, mysql.load);
    // Escrita real executada antes da falha FK: todo o lote deve ser revertido.
    await assert.rejects(mysql.transaction(check, async client => {
      const [updated] = await client.execute('UPDATE renolink_ideas SET title = ? WHERE id = ?', ['Não persistir', 1]);
      assert.equal(updated.affectedRows, 1);
      const [[changed]] = await client.execute('SELECT title FROM renolink_ideas WHERE id = ?', [1]);
      assert.equal(changed.title, 'Não persistir');
      await client.execute('INSERT INTO renolink_messages(id,from_user_id,to_user_id,text,created_at,extra) VALUES (?,?,?,?,?,?)', [9999, 1, 9999, 'Falha FK', new Date(), '{}']);
    }), e => {
      t.diagnostic(`Falha FK: code=${e.code}, errno=${e.errno}, sqlState=${e.sqlState}`);
      return e.sqlState === '23000' && (
        (e.errno === 1216 && e.code === 'ER_NO_REFERENCED_ROW') ||
        (e.errno === 1452 && e.code === 'ER_NO_REFERENCED_ROW_2')
      );
    });
    mysql.verify(before, await mysql.transaction(check, mysql.load));
    checkpoint('rollback apos UPDATE e falha FK aprovado');
    await assert.rejects(mysql.transaction(check, client => client.execute('UPDATE renolink_users SET email = ? WHERE id = ?', ['PESSOA1@teste.invalid', 2])), e => e.code === 'ER_DUP_ENTRY');
    checkpoint('unicidade aprovada');
    await assert.rejects(mysql.transaction(check, client => client.execute('UPDATE renolink_users SET role = ? WHERE id = ?', ['admin', 1])));
    mysql.verify(before, await mysql.transaction(check, mysql.load));
    checkpoint('CHECK e estado integral aprovados');
  } finally { await check.end(); }
  const reopened = mysql.mysqlStore(options);
  try { assert.equal(await reopened.transaction(actual => actual.ideas.length), 15); } finally { await reopened.close(); }
  await request('/api/auth/logout', { cookie: creator.cookie, data: {} });
  assert.equal((await request('/api/me', { cookie: creator.cookie })).status, 401);
  await assert.rejects(migrate(migration), /divergente/); // Não reaplicar snapshot sobre dados novos.
  checkpoint('logout e recusa de sobrescrita aprovados');
  // Stop every HTTP server and pool before starting fresh application processes.
  for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  const expectedState = await stores[0].transaction(actual => structuredClone(actual));
  for (const store of stores) await store.close();
  resourcesClosed = true;
  async function restartAndRead() {
    const env = { ...process.env, STORAGE_DRIVER: 'mysql', NODE_ENV: 'development', COOKIE_SECURE: '0', PORT: '0' };
    for (const key of ['HOST', 'PORT', 'DATABASE', 'USER', 'PASSWORD', 'SSL', 'SSL_CA']) {
      delete env['MYSQL_' + key];
      if (process.env['TEST_MYSQL_' + key] !== undefined) env['MYSQL_' + key] = process.env['TEST_MYSQL_' + key];
    }
    delete env.APP_ORIGIN;
    delete env.RENOLINK_MYSQL_MIGRATION_APPROVED;
    delete env.NODE_TEST_CONTEXT;
    const child = fork(path.join(__dirname, 'fixtures/mysql-server.js'), [], { env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { reject(Error('Timeout ao iniciar processo RenoLink.')); }, 15000);
        child.once('message', message => { clearTimeout(timer); resolve(message.port); });
        child.once('exit', () => { clearTimeout(timer); reject(Error('Processo RenoLink encerrou antes de iniciar.')); });
        child.once('error', () => { clearTimeout(timer); reject(Error('Falha ao iniciar processo RenoLink.')); });
      });
      const response = await fetch(`http://127.0.0.1:${port}/api/negotiations`, { headers: { Cookie: newCompany.cookie }, signal: AbortSignal.timeout(10000) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).negotiations.length, 1);
      const fresh = mysql.mysqlStore(options);
      try { await fresh.transaction(actual => mysql.verify(expectedState, actual)); } finally { await fresh.close(); }
    } finally { child.kill(); await exited; }
  }
  await restartAndRead();
  checkpoint('primeiro reinicio do processo aprovado');
  await restartAndRead();
  checkpoint('segundo reinicio do processo aprovado');
  assert.equal(digest(fs.readFileSync(originalFile)), originalHash);
  assert.equal(fs.existsSync(runtimeFile) ? digest(fs.readFileSync(runtimeFile)) : null, runtimeHash);
  const result = { status: 'passed', database: options.database, resume, checkpoints,
    initialExecution: resume ? 'Importacao, cadastro, mensagens, criacoes concorrentes e negociacao nova executados antes da falha inicial na assercao FK; retomada sem repetir essas escritas.' : 'Execucao completa em banco inicialmente vazio.',
    counts: mysql.verify(expectedState, expectedState), stateSha256: digest(stable(expectedState)), originalSha256: originalHash, runtimeSha256: runtimeHash,
    checks: ['schema e dados sinteticos', 'importacao idempotente', 'cadastro e login', 'ideias e mensagens', 'nova negociacao e interesses idempotentes', '12 ideias concorrentes em dois pools', 'rollback SQL e FKs', 'unicidade e CHECK', 'estado integral apos dois reinicios do processo', 'sessoes apos reinicio', 'originais preservados'] };
  fs.writeFileSync(reportFile, JSON.stringify(result, null, 2));
});
