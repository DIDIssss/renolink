// Auditoria não destrutiva: executa o servidor original em cópia temporária.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const source = path.resolve(__dirname, '../renolink_funcional');
const dbFile = path.join(source, 'data/db.json');
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
const before = hash();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'renolink-auditoria-'));
fs.cpSync(source, temp, { recursive: true });
const results = [];
let child;
let base;
const record = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
async function request(route, method = 'GET', data, token) {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(5000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}
async function main() {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(temp, 'server.js')], { env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await request('/api/health')).status === 200; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw Error('Servidor isolado não iniciou.');
  record('Saúde da API', ready);
  const files = fs.readdirSync(source).filter(f => f.endsWith('.html'));
  for (const f of [...files, 'assets/css/style.css', 'assets/js/app.js', 'assets/img/logo-renolink.svg']) {
    record(`Entrega HTTP: ${f}`, (await request('/' + f)).status === 200);
  }
  record('Banco bloqueado no caminho normal', (await request('/data/db.json')).status === 403);
  const exposed = await request('/DATA/db.json');
  record('FALHA: banco exposto com maiúsculas no Windows', exposed.status === 200 && Array.isArray(exposed.body.users), `HTTP ${exposed.status}; conteúdo não registrado`);
  record('FALHA: código do servidor exposto', (await request('/server.js')).status === 200);
  record('Rotas privadas recusam anônimo', (await request('/api/messages')).status === 401 && (await request('/api/negotiations')).status === 401);
  const register = (email, role = 'creator') => request('/api/auth/register', 'POST', { name: 'Pessoa Auditoria', email, password: 'Teste-local-2026!', role, company: role === 'company' ? 'Empresa Auditoria' : '' });
  const creator = await register('criador@auditoria.invalid');
  const company = await register('empresa@auditoria.invalid', 'company');
  record('Cadastro criador e empresa', creator.status === 201 && company.status === 201);
  record('Resposta de cadastro omite senha e salt', !('passwordHash' in creator.body.user) && !('salt' in creator.body.user));
  record('Cadastro duplicado recusado', (await register('criador@auditoria.invalid')).status === 409);
  record('Senha incorreta recusada', (await request('/api/auth/login', 'POST', { email: 'criador@auditoria.invalid', password: 'errada' })).status === 401);
  const login = await request('/api/auth/login', 'POST', { email: 'criador@auditoria.invalid', password: 'Teste-local-2026!' });
  const ct = login.body.token;
  const et = company.body.token;
  record('Login e consulta de sessão', login.status === 200 && (await request('/api/me', 'GET', undefined, ct)).status === 200);
  const idea = await request('/api/ideas', 'POST', { title: 'Ideia de auditoria', category: 'Tecnologia', problem: 'Problema de teste', solution: 'Solução de teste' }, ct);
  const id = idea.body.idea.id;
  record('Cadastro de ideia', idea.status === 201 && idea.body.idea.status === 'Em análise');
  record('Ideia aparece no painel do autor', (await request('/api/ideas?mine=1', 'GET', undefined, ct)).body.ideas.some(i => i.id === id));
  record('Ideia em análise fica fora do marketplace', !(await request('/api/ideas?public=1')).body.ideas.some(i => i.id === id));
  record('FALHA: ideia em análise acessível anonimamente', (await request(`/api/ideas/${id}`)).status === 200 && (await request('/api/ideas')).body.ideas.some(i => i.id === id));
  record('Empresa não pode cadastrar ideia', (await request('/api/ideas', 'POST', {}, et)).status === 403);
  const deal = await request(`/api/ideas/${id}/interest`, 'POST', {}, et);
  record('FALHA: interesse publica ideia sem revisão', deal.status === 201 && (await request('/api/ideas?public=1')).body.ideas.some(i => i.id === id));
  record('Interesse repetido reutiliza negociação', (await request(`/api/ideas/${id}/interest`, 'POST', {}, et)).body.negotiation.id === deal.body.negotiation.id);
  record('Negociação visível aos dois participantes', (await request('/api/negotiations', 'GET', undefined, ct)).body.negotiations.some(n => n.id === deal.body.negotiation.id) && (await request('/api/negotiations', 'GET', undefined, et)).body.negotiations.some(n => n.id === deal.body.negotiation.id));
  const sent = await request('/api/messages', 'POST', { toUserId: company.body.user.id, text: 'Mensagem local de auditoria' }, ct);
  record('Envio e leitura de mensagem pela API', sent.status === 201 && (await request('/api/messages', 'GET', undefined, et)).body.messages.some(m => m.id === sent.body.message.id));
  record('Mensagem vazia recusada', (await request('/api/messages', 'POST', { toUserId: company.body.user.id, text: ' ' }, ct)).status === 400);
  record('FALHA: e-mail inválido aceito pela API', (await register('invalido@')).status === 201);
  const outsider = await register('terceiro@auditoria.invalid');
  record('Mensagens e negociações isoladas por usuário', !(await request('/api/messages', 'GET', undefined, outsider.body.token)).body.messages.some(m => m.id === sent.body.message.id) && !(await request('/api/negotiations', 'GET', undefined, outsider.body.token)).body.negotiations.some(n => n.id === deal.body.negotiation.id));
  record('FALHA: mensagem enviada a terceiro sem negociação', (await request('/api/messages', 'POST', { toUserId: creator.body.user.id, text: 'Sem relação prévia' }, outsider.body.token)).status === 201);
  // Retém os corpos abertos para garantir duas leituras antes das gravações.
  const pending = [];
  for (const label of ['a', 'b']) {
    const payload = JSON.stringify({ title: `Concorrência ${label}`, category: 'Tecnologia', problem: 'Teste', solution: 'Teste' });
    let finish;
    const done = new Promise((resolve, reject) => {
      const req = http.request(base + '/api/ideas', { method: 'POST', headers: { Authorization: `Bearer ${ct}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
        let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject);
      req.write(payload.slice(0, -1));
      finish = () => req.end(payload.slice(-1));
    });
    pending.push({ done, finish });
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  pending.forEach(p => p.finish());
  const responses = await Promise.all(pending.map(p => p.done));
  const saved = (await request('/api/ideas?mine=1', 'GET', undefined, ct)).body.ideas.filter(i => i.title.startsWith('Concorrência'));
  record('FALHA: gravações concorrentes perdem dados', responses.every(r => r.status === 201) && saved.length < 2, `2 respostas; ${saved.length} ideia(s) persistida(s); IDs retornados: ${responses.map(r => r.body.idea.id).join(', ')}`);
  const persisted = JSON.parse(fs.readFileSync(path.join(temp, 'data/db.json'), 'utf8'));
  record('Persistência JSON de cadastro, ideia, mensagem e negociação', persisted.users.some(u => u.id === creator.body.user.id) && persisted.ideas.some(i => i.id === id) && persisted.messages.some(m => m.id === sent.body.message.id) && persisted.negotiations.some(n => n.id === deal.body.negotiation.id));
  await request('/api/auth/logout', 'POST', {}, ct);
  record('Logout invalida token', (await request('/api/me', 'GET', undefined, ct)).status === 401);
}
main().catch(error => { record('Erro na execução', false, error.message); process.exitCode = 1; }).finally(async () => {
  if (child && child.exitCode === null) { const closed = once(child, 'exit'); child.kill(); await closed; }
  record('Banco original preservado por SHA-256', before === hash());
  const output = { results, originalDatabaseUnchanged: before === hash(), temporaryCopy: temp, note: 'Resultados com FALHA confirmam defeitos; ok=true significa que o cenário foi reproduzido. Cópia temporária contém dados locais e não deve ser publicada.' };
  fs.writeFileSync(path.join(__dirname, 'resultados.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ results, originalDatabaseUnchanged: output.originalDatabaseUnchanged }, null, 2));
});
