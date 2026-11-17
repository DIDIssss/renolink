'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { once } = require('node:events');
const { createServer } = require('../server');
const { localStore, backup, validate, safeSessions, stable } = require('../lib/data');
const security = require('../lib/security');
test('Autenticacao preparada revalida hash e identidade antes de conceder sessao', async()=>{
 const user={id:1,email:'proof@teste.invalid',...await security.passwordHash('SenhaTeste2026!')};
 const req={authAttempt:'login',data:{email:user.email,password:'SenhaTeste2026!'}};
 let locked=false;
 await security.prepareAuthentication(req,{transaction:async fn=>{locked=true;try{return fn({users:[user]});}finally{locked=false;}}});
 assert.equal(locked,false);
 assert.equal(await security.verifyRequestPassword(req,req.data.password,user),true);
 assert.equal(await security.verifyRequestPassword(req,req.data.password,{...user,id:2}),false);
 assert.equal(await security.verifyRequestPassword(req,req.data.password,{...user,salt:'changed'}),false);
 assert.equal(await security.verifyRequestPassword(req,req.data.password,{...user,passwordHash:'changed'}),false);
 assert.equal(await security.verifyRequestPassword(req,req.data.password,null),false);
});
const { safeRedirect } = require('../assets/js/security');
const pg = require('../lib/postgres');
const { migrate } = require('../scripts/migrate-postgres');
const original = path.resolve(__dirname, 'fixtures/empty.json');
const originalHash = security.digest(fs.readFileSync(original));
function fixture() {
  const now = '2026-08-23T12:00:00.000Z';
  const users = [1, 2, 3].map(id => ({ id, name: `Pessoa ${id}`, email: `pessoa${id}@teste.invalid`, role: id === 2 ? 'company' : 'creator', company: id === 2 ? 'Empresa Teste' : '', salt: `test-${id}`, passwordHash: security.digest(`test-${id}:123456`), createdAt: now }));
  const idea = (id, status) => ({ id, userId: 1, title: `Ideia ${id}`, category: 'Tecnologia', problem: 'Problema', solution: 'Solução', beneficiaries: '', participation: 'Ainda não sei', status, potential: 'Alto', createdAt: now, updatedAt: now });
  return { meta: { nextUserId: 4, nextIdeaId: 3, nextMessageId: 1, nextNegotiationId: 1 }, users, ideas: [idea(1, 'Publicada'), idea(2, 'Em análise')], messages: [], negotiations: [], sessions: [] };
}
async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-fase2-'));
  const source = path.join(dir, 'original.json');
  fs.writeFileSync(source, JSON.stringify(fixture()));
  const file = path.join(dir, 'runtime/db.json');
  const options = { source, file, backupDir: path.join(dir, 'backups') };
  const store = localStore(options);
  const server = createServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); assert.equal(security.digest(fs.readFileSync(original)), originalHash); });
  const request = async (route, { method = 'GET', data, cookie, headers = {}, raw } = {}) => {
    const res = await fetch(base + route, { method, headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: raw === undefined ? (data === undefined ? undefined : JSON.stringify(data)) : raw });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, headers: res.headers, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async id => {
    const response = await request('/api/auth/login', { method: 'POST', data: { email: `pessoa${id}@teste.invalid`, password: '123456' } });
    assert.equal(response.status, 200);
    return response.cookie;
  };
  return { dir, source, file, options, store, server, base, request, login };
}
test('Lista pública bloqueia banco, variantes, travessia, fontes, configurações e backups', async t => {
  const { request } = await setup(t);
  for (const route of ['/data/db.json', '/DATA/db.json', '/Data/db.json', '/%44ATA/db.json', '/data%5cdb.json', '/assets/../server.js', '/assets/%2e%2e/server.js', '/assets/%252e%252e/server.js', '/server.js', '/SERVER.JS', '/package.json', '/package-lock.json', '/.env', '/.env.example', '/lib/security.js', '/database/001_initial.sql', '/scripts/migrate-postgres.js', '/data/backups/db.json', '/data/runtime/db.json', '/README.md', '/reset-db.js', '/assets/js/app.js.bak']) {
    const response = await request(route); assert.equal(response.status, 404, route);
  }
  assert.equal((await request('/%ZZ')).status, 400);
  for (const route of ['/lib/mysql.js', '/database/mysql/001_initial.sql', '/scripts/migrate-mysql.js', '/test/mysql.test.js', '/.npm-cache/']) assert.equal((await request(route)).status, 404, route);
  for (const page of ['/', '/index.html', '/empresa.html', '/explorar.html', '/ideia.html', '/cadastro.html', '/login.html', '/dashboard.html', '/nova-ideia.html', '/mensagens.html', '/negociacoes.html', '/assets/js/app.js', '/assets/js/security.js', '/assets/css/style.css', '/assets/img/logo-renolink.svg']) assert.equal((await request(page)).status, 200, page);
});
test('Ideias privadas só são vistas pelo autor; interesse não aprova nem altera publicação', async t => {
  const { request, login } = await setup(t);
  const creator = await login(1), company = await login(2), outsider = await login(3);
  for (const cookie of [undefined, company, outsider]) {
    assert.equal((await request('/api/ideas/2', { cookie })).status, 404);
    assert.deepEqual((await request('/api/ideas', { cookie })).body.ideas.map(i => i.id), [1]);
  }
  assert.equal((await request('/api/ideas/2', { cookie: creator })).status, 200);
  assert.equal((await request('/api/ideas?mine=1', { cookie: creator })).body.ideas.length, 2);
  assert.equal((await request('/api/ideas?mine=1')).status, 401);
  assert.equal((await request('/api/ideas/2/interest', { method: 'POST', data: {}, cookie: company })).status, 404);
  assert.equal((await request('/api/ideas/1/interest', { method: 'POST', data: {}, cookie: creator })).status, 403);
  const interest = await request('/api/ideas/1/interest', { method: 'POST', data: {}, cookie: company });
  assert.equal(interest.status, 201);
  assert.equal((await request('/api/ideas/1')).body.idea.status, 'Publicada');
  assert.equal((await request('/api/ideas/2', { cookie: creator })).body.idea.status, 'Em análise');
  assert.equal((await request('/api/ideas/1/interest', { method: 'POST', data: {}, cookie: company })).body.negotiation.id, interest.body.negotiation.id);
  assert.equal((await request('/api/negotiations', { cookie: creator })).body.negotiations.length, 1);
  assert.equal((await request('/api/negotiations', { cookie: outsider })).body.negotiations.length, 0);
});
test('Cadastro validado, senha robusta, cookie protegido e nenhuma credencial na resposta', async t => {
  const { request, file } = await setup(t);
  const payload = { name: 'Visitante', email: 'novo@teste.invalid', password: 'SenhaTeste-2026', role: 'creator' };
  for (const changes of [{ email: 'invalido@' }, { password: '123456' }, { role: 'admin' }, { name: {} }]) assert.equal((await request('/api/auth/register', { method: 'POST', data: { ...payload, ...changes } })).status, 400);
  const response = await request('/api/auth/register', { method: 'POST', data: payload });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal(response.body.token, undefined); assert.equal(response.body.user.passwordHash, undefined); assert.equal(response.body.user.salt, undefined);
  const db = JSON.parse(fs.readFileSync(file));
  assert.match(db.users.at(-1).passwordHash, /^scrypt\$32768\$8\$3\$/);
  assert.equal(db.sessions.at(-1).token, undefined);
  assert.notEqual(db.sessions.at(-1).tokenHash, response.cookie.split('=')[1]);
  assert.equal((await request('/api/me', { cookie: response.cookie })).status, 200);
});
test('Login legado atualiza somente hash operacional; sessão expira e pode ser revogada', async t => {
  const { login, request, store, source, file } = await setup(t);
  const first = await login(1), second = await login(1);
  assert.match(JSON.parse(fs.readFileSync(file)).users[0].passwordHash, /^scrypt\$/);
  assert.match(JSON.parse(fs.readFileSync(source)).users[0].passwordHash, /^[a-f0-9]{64}$/);
  assert.equal((await request('/api/me', { cookie: first })).status, 200);
  await request('/api/auth/logout', { method: 'POST', data: {}, cookie: first });
  assert.equal((await request('/api/me', { cookie: first })).status, 401);
  assert.equal((await request('/api/me', { cookie: second })).status, 200);
  await store.transaction(db => { db.sessions.find(s => s.tokenHash === security.digest(second.split('=')[1])).expiresAt = new Date(Date.now() - 1000).toISOString(); });
  assert.equal((await request('/api/me', { cookie: second })).status, 401);
  const third = await login(1), fourth = await login(1);
  await request('/api/auth/logout-all', { method: 'POST', data: {}, cookie: third });
  for (const cookie of [third, fourth]) assert.equal((await request('/api/me', { cookie })).status, 401);
});
test('JSON inválido, excesso de corpo, CSRF e conteúdo indevido são recusados', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/auth/login', { method: 'POST', raw: '{' })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', raw: 'null' })).status, 400);
  assert.equal((await request('/api/messages', { method: 'POST', raw: JSON.stringify({ text: 'a'.repeat(70000) }) })).status, 413);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: {}, headers: { Origin: 'https://atacante.invalid' } })).status, 403);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
});
test('Limites contra abuso de login e cadastro', async t => {
  const { request } = await setup(t);
  for (let n = 0; n < 10; n++) assert.equal((await request('/api/auth/login', { method: 'POST', data: { email: 'erro@teste.invalid', password: 'SenhaErrada-2026' } })).status, 401);
  const blocked = await request('/api/auth/login', { method: 'POST', data: {} });
  assert.equal(blocked.status, 429); assert.ok(blocked.headers.get('retry-after'));
  for (let n = 0; n < 5; n++) await request('/api/auth/register', { method: 'POST', data: {} });
  assert.equal((await request('/api/auth/register', { method: 'POST', data: {} })).status, 429);
});
test('Mensagens persistem e permanecem privadas aos participantes', async t => {
  const { request, login } = await setup(t);
  const creator = await login(1), company = await login(2), outsider = await login(3);
  const sent = await request('/api/messages', { method: 'POST', data: { toUserId: 2, text: 'Mensagem de teste' }, cookie: creator });
  assert.equal(sent.status, 201);
  assert.equal((await request('/api/messages', { cookie: company })).body.messages[0].text, 'Mensagem de teste');
  assert.equal((await request('/api/messages', { cookie: outsider })).body.messages.length, 0);
  assert.equal((await request('/api/messages')).status, 401);
  assert.equal((await request('/api/messages', { method: 'POST', data: { toUserId: 2, text: '' }, cookie: creator })).status, 400);
});
test('Concorrência: corpos intercalados e 20 criações preservam IDs e registros', async t => {
  const { request, login, base, store } = await setup(t);
  const cookie = await login(1);
  const idea = title => ({ title, category: 'Tecnologia', problem: 'Problema', solution: 'Solução' });
  const pending = [];
  for (const title of ['Intercalada A', 'Intercalada B']) {
    const raw = JSON.stringify(idea(title)); let finish;
    const done = new Promise((resolve, reject) => {
      const req = http.request(base + '/api/ideas', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } }, res => {
        let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject); req.write(raw.slice(0, -1)); finish = () => req.end(raw.slice(-1));
    }); pending.push({ done, finish });
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  pending.forEach(p => p.finish());
  const responses = await Promise.all([...pending.map(p => p.done), ...Array.from({ length: 20 }, (_, n) => request('/api/ideas', { method: 'POST', cookie, data: idea(`Paralela ${n}`) }))]);
  assert.ok(responses.every(r => r.status === 201));
  assert.equal(new Set(responses.map(r => r.body.idea.id)).size, 22);
  assert.equal((await request('/api/ideas?mine=1', { cookie })).body.ideas.length, 24);
  await assert.rejects(store.transaction(db => { db.ideas[0].title = 'Não gravar'; throw Error('Rollback intencional'); }));
  assert.equal((await request('/api/ideas/1')).body.idea.title, 'Ideia 1');
});
test('Cópia operacional sobrevive à reabertura, impede dois processos e protege original', async t => {
  const { store, options, source } = await setup(t);
  assert.throws(() => localStore(options), /EEXIST/);
  assert.throws(() => localStore({ ...options, file: source }), /original/);
  await store.transaction(db => { db.ideas[0].title = 'Persistida'; });
  store.close();
  const reopened = localStore(options);
  assert.equal(await reopened.transaction(db => db.ideas[0].title), 'Persistida');
  reopened.close();
});
test('Backup verificável e preflight idempotente não dependem de PostgreSQL', async t => {
  const { source, dir } = await setup(t);
  const backupDir = path.join(dir, 'preflight');
  const first = backup(source, backupDir), second = backup(source, backupDir);
  assert.equal(first.sha256, second.sha256);
  assert.equal(security.digest(fs.readFileSync(first.path)), first.sha256);
  const before = fs.readFileSync(source);
  const result = await migrate({ source, backupDir });
  assert.equal(result.mode, 'preflight'); assert.equal(result.counts.users, 3);
  assert.deepEqual(fs.readFileSync(source), before);
  fs.writeFileSync(first.path, '{}');
  assert.throws(() => backup(source, backupDir), /verificação/);
});
test('Validador e verificador rejeitam IDs, relações e contagens divergentes', () => {
  validate(fixture());
  for (const mutate of [db => db.users.push(db.users[0]), db => db.ideas[0].userId = 999, db => db.meta.nextIdeaId = 1, db => db.users[1].email = db.users[0].email]) {
    const db = fixture(); mutate(db); assert.throws(() => validate(db));
  }
  assert.equal(pg.verify(fixture(), fixture()).ideas, 2);
  const different = fixture(); different.ideas.pop(); assert.throws(() => pg.verify(fixture(), different), /divergentes/);
  const legacy = fixture(); legacy.sessions.push({ token: 'legado', userId: 1, createdAt: '2026-08-23T12:00:00.000Z' });
  const safe = safeSessions(legacy);
  assert.equal(safe.sessions[0].token, undefined); assert.ok(safe.sessions[0].revokedAt);
  assert.equal(stable(safeSessions(structuredClone(safe))), stable(safe));
});
test('Redirecionamento pós-login só permite páginas internas conhecidas', () => {
  for (const value of ['https://atacante.invalid', '//atacante.invalid', '\\atacante.invalid', 'javascript:alert(1)', 'data:text/html,x', '/dashboard.html', '../dashboard.html', '%2f%2fatacante.invalid', 'server.js', 'dashboard.html#x', null]) assert.equal(safeRedirect(value), 'dashboard.html');
  assert.equal(safeRedirect('ideia.html?id=12'), 'ideia.html?id=12');
  assert.equal(safeRedirect('mensagens.html?redirect=https://atacante.invalid'), 'mensagens.html');
  assert.equal(safeRedirect('ideia.html?id=javascript:alert(1)'), 'explorar.html');
});
test('Transação PostgreSQL usa um cliente, commit e rollback em erro', async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); }, release: () => calls.push('release') };
  const pool = { connect: async () => client };
  await pg.transaction(pool, async received => { assert.equal(received, client); calls.push('mutation'); });
  assert.deepEqual(calls, ['BEGIN', "SET LOCAL lock_timeout = '10s'", "SET LOCAL statement_timeout = '30s'", 'SELECT pg_advisory_xact_lock($1)', 'mutation', 'COMMIT', 'release']);
  calls.length = 0;
  await assert.rejects(pg.transaction(pool, async () => { throw Error('Erro simulado'); }));
  assert.ok(calls.includes('ROLLBACK')); assert.ok(!calls.includes('COMMIT'));
});
test('Cadastros concorrentes recusam duplicidade; interesses concorrentes são idempotentes', async t => {
  const { request, login, file } = await setup(t);
  const company = await login(2);
  const registrations = await Promise.all(Array.from({ length: 3 }, () => request('/api/auth/register', { method: 'POST', data: { name: 'Visitante simultâneo', email: 'duplicado@teste.invalid', password: 'SenhaTeste-2026', role: 'creator' } })));
  assert.deepEqual(registrations.map(r => r.status).sort(), [201, 409, 409]);
  const interests = await Promise.all(Array.from({ length: 10 }, () => request('/api/ideas/1/interest', { method: 'POST', data: {}, cookie: company })));
  assert.equal(interests.filter(r => r.status === 201).length, 1);
  assert.equal(new Set(interests.map(r => r.body.negotiation.id)).size, 1);
  const db = JSON.parse(fs.readFileSync(file));
  assert.equal(db.negotiations.length, 1); assert.equal(db.users.length, 4);
});
test('Senha errada não atualiza hash legado; sessão antiga sem expiração não autentica', async t => {
  const { request, store, file } = await setup(t);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: { email: 'pessoa1@teste.invalid', password: 'errada' } })).status, 401);
  assert.match(JSON.parse(fs.readFileSync(file)).users[0].passwordHash, /^[a-f0-9]{64}$/);
  const token = 'a'.repeat(64);
  await store.transaction(db => db.sessions.push({ token, userId: 1, createdAt: '2026-08-23T12:00:00.000Z' }));
  assert.equal((await request('/api/me', { cookie: `renolink_session=${token}` })).status, 401);
});
