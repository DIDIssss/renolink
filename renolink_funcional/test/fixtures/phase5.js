'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { digest } = require('../../lib/security');
function seed(db) {
  const batch = crypto.randomBytes(6).toString('hex');
  const ids = {};
  for (const name of ['visitor', 'outsider', 'admin', 'support']) {
    const id = db.meta.nextUserId++; ids[name] = id;
    db.users.push({ id, name: `Teste ${name}`, email: `${name}-${batch}@teste.invalid`, role: name === 'outsider' ? 'company' : 'creator', company: name === 'outsider' ? 'Empresa Teste' : '', salt: 'phase5-synthetic', passwordHash: digest('phase5-synthetic:SenhaTeste2026!'), createdAt: new Date().toISOString() });
    ids[name + 'Email'] = `${name}-${batch}@teste.invalid`;
  }
  for (const name of ['admin','support']) db.staff.push({ userId: ids[name], accessRole: name, active: 1, createdAt: new Date().toISOString() });
  return ids;
}
async function scenarios(base, ids, { disableSupport } = {}) {
  const request = async (route, data, cookie) => {
    const response = await fetch(base + route, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'manual' });
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const cookies = {};
  for (const role of ['visitor','outsider','admin','support']) {
    const login = await request(role === 'admin' || role === 'support' ? '/api/admin/auth/login' : '/api/auth/login', { email: ids[role + 'Email'], password: 'SenhaTeste2026!' });
    assert.equal(login.status, 200); cookies[role] = login.cookie;
    assert.equal(login.body.token, undefined);
  }
  const visitor = cookies.visitor, admin = cookies.admin, outsider = cookies.outsider, support = cookies.support;
  for (const payload of [{ role: 'admin' }, { role: 'creator', teamRole: 'admin' }, { role: 'creator', isAdmin: true }]) {
    assert.equal((await request('/api/auth/register', { name: 'Tentativa indevida', email: 'indevido@teste.invalid', password: 'SenhaTeste2026!', ...payload })).status, 400);
  }
  assert.equal((await request('/api/admin/auth/login', { email: ids.visitorEmail, password: 'SenhaTeste2026!' })).status, 401);
  for (const route of ['/api/admin/me','/api/admin/dashboard','/api/admin/users','/api/admin/ideas','/api/admin/ideas/1','/api/admin/audit','/api/admin/negotiations','/api/admin/conversations']) {
    assert.equal((await request(route)).status, 401, route);
    assert.equal((await request(route, undefined, visitor)).status, 403, route);
  }
  assert.equal((await request('/admin.html')).status, 303);
  assert.equal((await request('/admin.html', undefined, visitor)).status, 303);
  assert.equal((await request('/admin.html', undefined, admin)).status, 200);
  assert.equal((await request('/api/admin/users', undefined, support)).status, 403);
  for (const route of ['/scripts/grant-staff.js','/database/mysql/002_phase5.sql','/lib/phase5.js','/.env.mysql.local.clixml']) assert.equal((await request(route)).status, 404);
  const users = await request('/api/admin/users', undefined, admin);
  assert.equal(users.status, 200); assert.ok(users.body.users.every(u => !('passwordHash' in u) && !('salt' in u)));
  const payload = { title: 'Proposta controlada <script>alert(1)</script>', category: 'Tecnologia', problem: 'Problema real', solution: 'Solução validada' };
  let idea = (await request('/api/ideas', payload, visitor)).body.idea;
  assert.equal(idea.status, 'Em análise');
  assert.equal((await request(`/api/ideas/${idea.id}`, undefined, outsider)).status, 404);
  assert.equal((await request(`/api/ideas/${idea.id}/interest`, {}, outsider)).status, 404);
  for (const cookie of [visitor, outsider, support]) assert.equal((await request(`/api/admin/ideas/${idea.id}/review`, { decision: 'approve', updatedAt: idea.updatedAt }, cookie)).status, 403);
  assert.equal((await request(`/api/ideas/${idea.id}/edit`, { ...payload, updatedAt: idea.updatedAt }, outsider)).status, 404);
  assert.equal((await request(`/api/ideas/${idea.id}/edit`, { ...payload, updatedAt: idea.updatedAt, status: 'Publicada' }, visitor)).status, 400);
  const reviews = await Promise.all([1,2].map(() => request(`/api/admin/ideas/${idea.id}/review`, { decision: 'approve', updatedAt: idea.updatedAt }, admin)));
  assert.deepEqual(reviews.map(r => r.status).sort(), [200,409]);
  idea = (await request(`/api/ideas/${idea.id}`, undefined, visitor)).body.idea;
  assert.equal(idea.status, 'Publicada');
  assert.equal((await request(`/api/ideas/${idea.id}/interest`, {}, outsider)).status, 201);
  assert.equal((await request(`/api/ideas/${idea.id}`)).body.idea.status, 'Publicada');
  idea = (await request(`/api/ideas/${idea.id}/edit`, { ...payload, title: 'Proposta revisada', updatedAt: idea.updatedAt }, visitor)).body.idea;
  assert.equal(idea.status, 'Em análise');
  assert.equal((await request(`/api/admin/ideas/${idea.id}/review`, { decision: 'reject', reason: 'curto', updatedAt: idea.updatedAt }, admin)).status, 400);
  idea = (await request(`/api/admin/ideas/${idea.id}/review`, { decision: 'reject', reason: 'Precisamos de mais detalhes.', updatedAt: idea.updatedAt }, admin)).body.idea;
  assert.equal(idea.status, 'Rejeitada');
  assert.equal((await request(`/api/ideas/${idea.id}`, undefined, outsider)).status, 404);
  idea = (await request(`/api/ideas/${idea.id}/edit`, { ...payload, updatedAt: idea.updatedAt }, visitor)).body.idea;
  idea = (await request(`/api/admin/ideas/${idea.id}/review`, { decision: 'approve', updatedAt: idea.updatedAt }, admin)).body.idea;
  const opened = await request('/api/team/conversations', { text: 'Tenho uma dúvida sobre minha proposta.' }, visitor);
  assert.equal(opened.status, 201); const conversationId = opened.body.conversation.id;
  assert.equal((await request(`/api/team/conversations/${conversationId}/messages`, undefined, outsider)).status, 404);
  assert.equal((await request(`/api/team/conversations/${conversationId}/messages`, { text: 'Invasão' }, outsider)).status, 404);
  assert.equal((await request(`/api/admin/conversations/${conversationId}/messages`, { text: 'Vamos ajudar você!' }, support)).status, 201);
  assert.equal((await request(`/api/team/conversations/${conversationId}/messages`, undefined, visitor)).body.messages.length, 2);
  assert.equal((await request(`/api/team/conversations/${conversationId}/status`, { status: 'Encerrada' }, visitor)).status, 403);
  assert.equal((await request(`/api/admin/conversations/${conversationId}/status`, { status: 'Encerrada' }, support)).status, 200);
  assert.equal((await request(`/api/team/conversations/${conversationId}/messages`, { text: 'Nova mensagem' }, visitor)).status, 409);
  assert.equal((await request(`/api/admin/conversations/${conversationId}/status`, { status: 'Aberta' }, support)).status, 200);
  let negotiation = await request('/api/requests', { ideaId: idea.id }, visitor);
  assert.equal(negotiation.status, 201); negotiation = negotiation.body.request;
  assert.equal((await request('/api/requests', { ideaId: idea.id }, visitor)).body.request.id, negotiation.id);
  assert.equal((await request('/api/requests', undefined, outsider)).body.requests.length, 0);
  assert.equal((await request(`/api/admin/requests/${negotiation.id}/status`, { status: 'Concluída', updatedAt: negotiation.updatedAt }, admin)).status, 400);
  assert.equal((await request(`/api/admin/requests/${negotiation.id}/status`, { status: 'Em contato', updatedAt: negotiation.updatedAt }, visitor)).status, 403);
  assert.equal((await request(`/api/admin/requests/${negotiation.id}/status`, { status: 'Em contato', updatedAt: negotiation.updatedAt }, admin)).status, 200);
  const history = (await request('/api/admin/audit', undefined, admin)).body.events;
  for (const action of ['idea.approve','idea.reject','conversation.reply','conversation.status','negotiation.status']) assert.ok(history.some(e => e.action === action), action);
  const dashboard = (await request('/api/admin/dashboard', undefined, admin)).body;
  assert.ok(dashboard.ideas >= 1); assert.ok(dashboard.auditEvents >= 5);
  if (disableSupport) {
    await disableSupport();
    assert.equal((await request('/api/admin/me',undefined,support)).status,403,'Revogacao vale para uma sessao ja emitida.');
    assert.equal((await request(`/api/team/conversations/${conversationId}/messages`,undefined,support)).status,404);
  }
  return { visitorCookie: visitor, adminCookie: admin, ideaId: idea.id, conversationId };
}
module.exports = { seed, scenarios };
