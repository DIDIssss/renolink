'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const mysql = require('../lib/mysql');
const { validate, safeSessions } = require('../lib/data');
const { digest } = require('../lib/security');
const root = path.resolve(__dirname, '..');
const report = { status: 'running', checks: [], migratedRecordsModified: false };
const reportFile = path.join(root, 'data/runtime/mysql-dev-verification-report.json');
function save() { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); }
async function launch(prefix) {
  const env = { ...process.env, PORT: '0', STORAGE_DRIVER: 'mysql', NODE_ENV: 'development', COOKIE_SECURE: '0' };
  delete env.APP_ORIGIN; delete env.NODE_TEST_CONTEXT; delete env.RENOLINK_MYSQL_MIGRATION_APPROVED;
  for (const key of ['HOST', 'PORT', 'DATABASE', 'USER', 'PASSWORD', 'SSL', 'SSL_CA']) {
    delete env['MYSQL_' + key];
    if (process.env[prefix + key] !== undefined) env['MYSQL_' + key] = process.env[prefix + key];
  }
  const child = fork(path.join(root, 'test/fixtures/mysql-server.js'), [], { env, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('START_TIMEOUT')), 15000);
      child.once('message', message => { clearTimeout(timer); resolve(message.port); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('START_FAILED')); });
      child.once('error', () => { clearTimeout(timer); reject(Error('START_FAILED')); });
    });
    return { base: `http://127.0.0.1:${port}`, close: async () => { child.kill(); await exited; } };
  } catch (error) { child.kill(); await exited; throw error; }
}
async function request(app, route, { data, cookie } = {}) {
  const response = await fetch(app.base + route, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function main() {
  const devOptions = mysql.config(), testOptions = mysql.config(process.env, 'TEST_MYSQL_');
  assert.equal(devOptions.database, 'renolink_dev'); assert.equal(devOptions.user, 'renolink_app'); assert.equal(devOptions.host, '127.0.0.1');
  assert.equal(testOptions.database, 'renolink_test'); assert.equal(testOptions.user, 'renolink_tester'); assert.equal(testOptions.host, '127.0.0.1');
  const migration = JSON.parse(fs.readFileSync(path.join(root, 'data/runtime/mysql-dev-migration-report.json')));
  assert.equal(migration.status, 'passed');
  const source = path.join(root, 'data/runtime/db.json');
  const original = path.join(root, 'data/db.json');
  const expected = safeSessions(validate(JSON.parse(fs.readFileSync(source))));
  const originalHash = digest(fs.readFileSync(original)), sourceHash = digest(fs.readFileSync(source));
  const dev = mysql.mysqlStore(devOptions), testStore = mysql.mysqlStore(testOptions);
  const identityPool = mysql.pool(devOptions);
  try {
    const [[identity]] = await identityPool.execute('SELECT CURRENT_USER() AS account, DATABASE() AS db');
    assert.equal(identity.account, 'renolink_app@127.0.0.1'); report.identity = identity;
  } finally { await identityPool.end(); }
  save();
  try {
    report.countsBefore = await dev.transaction(actual => mysql.verify(expected, actual));
    const runId = crypto.randomBytes(6).toString('hex');
    const password = crypto.randomBytes(24).toString('hex');
    let app = await launch('TEST_MYSQL_');
    let snapshot, creator, company, created;
    try {
      for (const role of ['creator', 'company']) {
        const registration = await request(app, '/api/auth/register', { data: { name: `Teste ${role} ${runId}`, company: role === 'company' ? 'Empresa sintetica' : '', email: `${role}-${runId}@teste.invalid`, password, role } });
        assert.equal(registration.status, 201);
      }
      creator = await request(app, '/api/auth/login', { data: { email: `creator-${runId}@teste.invalid`, password } });
      company = await request(app, '/api/auth/login', { data: { email: `company-${runId}@teste.invalid`, password } });
      assert.equal(creator.status, 200); assert.equal(company.status, 200);
      report.checks.push('cadastro e login HTTP de duas contas sinteticas');
      created = await request(app, '/api/ideas', { cookie: creator.cookie, data: { title: `Teste isolado ${runId}`, category: 'Tecnologia', problem: 'Problema sintetico', solution: 'Solucao sintetica' } });
      assert.equal(created.status, 201);
      assert.equal((await request(app, `/api/ideas/${created.body.idea.id}`, { cookie: company.cookie })).status, 404);
      // Test fixture setup only: the application has no publication workflow yet.
      await testStore.transaction(db => {
        const idea = db.ideas.find(i => i.id === created.body.idea.id);
        assert.equal(idea.userId, creator.body.user.id); idea.status = 'Publicada';
      });
      const message = `Mensagem sintetica ${runId}`;
      assert.equal((await request(app, '/api/messages', { cookie: creator.cookie, data: { toUserId: company.body.user.id, text: message } })).status, 201);
      assert.ok((await request(app, '/api/messages', { cookie: company.cookie })).body.messages.some(m => m.text === message));
      const interest = await request(app, `/api/ideas/${created.body.idea.id}/interest`, { cookie: company.cookie, data: {} });
      assert.equal(interest.status, 201);
      const repeated = await request(app, `/api/ideas/${created.body.idea.id}/interest`, { cookie: company.cookie, data: {} });
      assert.equal(repeated.status, 200); assert.equal(repeated.body.negotiation.id, interest.body.negotiation.id);
      report.checks.push('criacao e privacidade de ideia', 'mensagens privadas', 'negociacao e interesse idempotente');
      snapshot = await testStore.transaction(db => structuredClone(db));
      report.controlledTestIds = { users: [creator.body.user.id, company.body.user.id], idea: created.body.idea.id, negotiation: interest.body.negotiation.id };
    } finally { await app.close(); }
    app = await launch('TEST_MYSQL_');
    try {
      assert.equal((await request(app, '/api/me', { cookie: creator.cookie })).status, 200);
      assert.equal((await request(app, `/api/ideas/${created.body.idea.id}`, { cookie: creator.cookie })).status, 200);
      assert.equal((await request(app, '/api/negotiations', { cookie: company.cookie })).body.negotiations.length, 1);
      await testStore.transaction(actual => mysql.verify(snapshot, actual));
      report.checks.push('estado integral, sessao e negociacao apos reinicio Node no banco isolado');
    } finally { await app.close(); }
    for (let attempt = 0; attempt < 2; attempt++) {
      app = await launch('MYSQL_');
      try {
        const stats = await request(app, '/api/stats'); assert.equal(stats.status, 200);
        assert.equal((await request(app, '/api/ideas')).status, 200);
        await dev.transaction(actual => mysql.verify(expected, actual));
      } finally { await app.close(); }
    }
    report.checks.push('dois processos reais com renolink_app: leitura HTTP e comparacao integral de renolink_dev');
    report.countsAfter = await dev.transaction(actual => mysql.verify(expected, actual));
    assert.equal(digest(fs.readFileSync(original)), originalHash); assert.equal(digest(fs.readFileSync(source)), sourceHash);
    report.status = 'passed'; report.testDatabase = 'renolink_test'; report.devDatabase = 'renolink_dev';
    report.originalsUnchanged = true; report.completedAtUtc = new Date().toISOString(); save();
    console.log(JSON.stringify(report, null, 2));
  } finally { await dev.close(); await testStore.close(); }
}
main().catch(error => { report.status = 'failed'; report.errorCode = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'VERIFICATION_FAILED'; save(); console.error('Verificacao interrompida: ' + report.errorCode + '. Nenhum segredo registrado.'); process.exitCode = 1; });
