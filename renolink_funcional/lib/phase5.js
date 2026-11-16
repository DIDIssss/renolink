'use strict';
const security = require('./security');
const { requestStatuses } = require('./phase5-data');
const categories = new Set(['Varejo', 'Tecnologia', 'Agronegócio', 'Logística', 'Saúde', 'Indústria', 'Serviços', 'Sustentabilidade']);
const participation = new Set(['Vender a ideia', 'Licenciar a solução', 'Participar do desenvolvimento', 'Ainda não sei']);
const published = idea => ['Publicada', 'Empresa interessada'].includes(idea.status);
const member = (db, id) => db.staff?.find(s => s.userId === id && s.active === 1);
const now = () => new Date().toISOString();
const touch = row => new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
function ready(db) { if (db.meta.schemaVersion !== 5) throw security.fail(503, 'A Fase 5 aguarda ativação pela equipe RenoLink.'); }
function auth(req, db, team = false, admin = false) {
  const current = security.auth(req, db);
  if (!current) throw security.fail(401, 'Faça login para continuar.');
  const staff = member(db, current.user.id);
  if (team && (!staff || (admin && staff.accessRole !== 'admin'))) throw security.fail(403, 'Acesso exclusivo à equipe autorizada.');
  ready(db);
  return { ...current, staff };
}
function audit(db, actorId, action, targetType, targetId, detail = '') {
  db.audit.push({ id: db.meta.nextAuditId++, actorId, action, targetType, targetId, detail, createdAt: now() });
}
function ideaPayload(data) {
  if (['status', 'userId', 'moderation', 'potential'].some(key => key in data)) throw security.fail(400, 'Campos de moderação não podem ser enviados.');
  if (!categories.has(data.category) || !participation.has(data.participation || 'Ainda não sei')) throw security.fail(400, 'Categoria ou participação inválida.');
  return { title: security.text(data.title, 1, 200, 'Título'), category: data.category,
    problem: security.text(data.problem, 1, 10000, 'Problema'), solution: security.text(data.solution, 1, 10000, 'Solução'),
    beneficiaries: security.text(data.beneficiaries || '', 0, 2000, 'Beneficiários'), participation: data.participation || 'Ainda não sei' };
}
async function handle(req, res, url, db, json) {
  const route = url.pathname, data = req.data || {};
  const send = (status, payload) => { json(res, status, payload); return true; };
  if (route === '/api/features' && req.method === 'GET') return send(200, { phase5: db.meta.schemaVersion === 5, realtime:'sse' });
  if (route === '/api/admin/auth/login' && req.method === 'POST') {
    ready(db);
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const password = typeof data.password === 'string' ? data.password : '';
    if (!security.validEmail(email) || !password || password.length > 128) throw security.fail(400, 'Credenciais inválidas.');
    const user = db.users.find(u => u.email === email);
    const valid = await security.verifyRequestPassword(req,password,user);
    if (!valid || !member(db, user.id)) throw security.fail(401, 'Credenciais administrativas inválidas.');
    if (!user.passwordHash.startsWith('scrypt$')) Object.assign(user, req.preparedPasswordUpgrade || await security.passwordHash(password));
    res.cookie = security.issueSession({ userId: user.id }, db).cookie;
    audit(db, user.id, 'staff.login', 'staff', user.id);
    return send(200, { user: { ...security.publicUser(user), teamRole: member(db, user.id).accessRole } });
  }
  const edit = /^\/api\/ideas\/(\d+)\/edit$/.exec(route);
  if (edit && req.method === 'POST') {
    const current = auth(req, db);
    const idea = db.ideas.find(i => i.id === Number(edit[1]));
    if (!idea || idea.userId !== current.user.id) throw security.fail(404, 'Ideia não encontrada.');
    if (typeof data.updatedAt !== 'string' || data.updatedAt !== idea.updatedAt) throw security.fail(409, 'A ideia mudou. Atualize a página antes de editar.');
    Object.assign(idea, ideaPayload(data), { status: 'Em análise', updatedAt: touch(idea), moderation: null });
    return send(200, { idea });
  }
  if (route.startsWith('/api/admin/')) {
    const supportRoute = route === '/api/admin/me' || route.startsWith('/api/admin/conversations');
    const current = auth(req, db, true, !supportRoute);
    if (route === '/api/admin/me' && req.method === 'GET') return send(200, { user: security.publicUser(current.user), accessRole: current.staff.accessRole });
    if (route === '/api/admin/dashboard' && req.method === 'GET') return send(200, { users: db.users.length, ideas: db.ideas.length,
      pending: db.ideas.filter(i => i.status === 'Em análise').length, published: db.ideas.filter(published).length,
      rejected: db.ideas.filter(i => i.status === 'Rejeitada').length, openConversations: db.conversations.filter(c => c.status === 'Aberta').length,
      requests: db.requests.length, negotiations: db.negotiations.length, auditEvents: db.audit.length });
    if (route === '/api/admin/users' && req.method === 'GET') return send(200, { users: db.users.map(u => ({ ...security.publicUser(u), teamRole: member(db, u.id)?.accessRole || null })) });
    if (route === '/api/admin/ideas' && req.method === 'GET') return send(200, { ideas: db.ideas.map(i => ({ ...i, author: db.users.find(u => u.id === i.userId)?.name || 'Comunidade RenoLink' })) });
    const detail = /^\/api\/admin\/ideas\/(\d+)$/.exec(route);
    if (detail && req.method === 'GET') {
      const idea = db.ideas.find(i => i.id === Number(detail[1]));
      if (!idea) throw security.fail(404, 'Ideia não encontrada.');
      const author = db.users.find(u => u.id === idea.userId);
      return send(200, { idea, author: author ? security.publicUser(author) : null });
    }
    const review = /^\/api\/admin\/ideas\/(\d+)\/review$/.exec(route);
    if (review && req.method === 'POST') {
      const idea = db.ideas.find(i => i.id === Number(review[1]));
      if (!idea) throw security.fail(404, 'Ideia não encontrada.');
      if (!['approve', 'reject'].includes(data.decision)) throw security.fail(400, 'Decisão inválida.');
      if (idea.status !== 'Em análise' || data.updatedAt !== idea.updatedAt) throw security.fail(409, 'A proposta mudou ou já foi analisada. Atualize a lista.');
      const reason = security.text(data.reason || '', data.decision === 'reject' ? 10 : 0, 2000, 'Parecer');
      idea.status = data.decision === 'approve' ? 'Publicada' : 'Rejeitada';
      idea.updatedAt = touch(idea); idea.moderation = { reviewerId: current.user.id, reason, reviewedAt: idea.updatedAt };
      audit(db, current.user.id, 'idea.' + data.decision, 'idea', idea.id, reason);
      return send(200, { idea });
    }
    if (route === '/api/admin/audit' && req.method === 'GET') {
      const cursor = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(cursor) || cursor < 1) throw security.fail(400, 'Cursor inválido.');
      const events = db.audit.filter(a => a.id < cursor).sort((a,b) => b.id-a.id).slice(0, 100);
      return send(200, { events: events.map(e => ({ ...e, actorName: db.users.find(u => u.id === e.actorId)?.name || 'Equipe' })), nextBefore: events.length === 100 ? events.at(-1).id : null });
    }
    if (route === '/api/admin/negotiations' && req.method === 'GET') return send(200, { requests: db.requests.map(r => ({ ...r, ideaTitle: db.ideas.find(i => i.id === r.ideaId)?.title, visitorName: db.users.find(u => u.id === r.visitorId)?.name })), negotiations: db.negotiations.map(n => ({ ...n, ideaTitle: db.ideas.find(i => i.id === n.ideaId)?.title })) });
    const update = /^\/api\/admin\/(requests|negotiations)\/(\d+)\/status$/.exec(route);
    if (update && req.method === 'POST') {
      const row = db[update[1]].find(r => r.id === Number(update[2]));
      if (!row) throw security.fail(404, 'Solicitação não encontrada.');
      if (data.updatedAt !== row.updatedAt) throw security.fail(409, 'Registro alterado. Atualize a página.');
      const transitions = { Solicitada: ['Em contato','Encerrada'], 'Interesse demonstrado': ['Em contato','Em negociação','Encerrada'], 'Em contato': ['Em negociação','Encerrada'], 'Em negociação': ['Concluída','Encerrada'] };
      if (!requestStatuses.includes(data.status) || !transitions[row.status]?.includes(data.status)) throw security.fail(400, 'Transição de status inválida.');
      const previous = row.status; row.status = data.status; row.updatedAt = touch(row);
      audit(db, current.user.id, 'negotiation.status', update[1] === 'requests' ? 'request' : 'negotiation', row.id, `${previous} → ${row.status}`);
      return send(200, { item: row });
    }
    // Conversation routes below share authorization with the visitor portal.
    if (!route.startsWith('/api/admin/conversations')) throw security.fail(404, 'Rota administrativa não encontrada.');
  }
  if (route === '/api/requests') {
    const current = auth(req, db);
    if (req.method === 'GET') return send(200, { requests: db.requests.filter(r => r.visitorId === current.user.id).map(r => ({ ...r, ideaTitle: db.ideas.find(i => i.id === r.ideaId)?.title })) });
    if (req.method === 'POST') {
      const idea = db.ideas.find(i => i.id === Number(data.ideaId));
      if (!idea || !published(idea)) throw security.fail(404, 'A solicitação exige uma ideia aprovada.');
      const existing = db.requests.find(r => r.ideaId === idea.id && r.visitorId === current.user.id);
      if (existing) return send(200, { request: existing });
      const stamp = now();
      const request = { id: db.meta.nextRequestId++, visitorId: current.user.id, ideaId: idea.id, status: 'Solicitada', createdAt: stamp, updatedAt: stamp };
      db.requests.push(request); return send(201, { request });
    }
  }
  const adminConversation = route.startsWith('/api/admin/conversations');
  if (adminConversation || route.startsWith('/api/team/conversations')) {
    const current = auth(req, db, adminConversation);
    const prefix = adminConversation ? '/api/admin/conversations' : '/api/team/conversations';
    const view = c => ({ ...c, ...(current.staff ? { visitorName: db.users.find(u => u.id === c.visitorId)?.name } : {}) });
    if (route === prefix && req.method === 'GET') return send(200, { conversations: db.conversations.filter(c => adminConversation || c.visitorId === current.user.id).map(view) });
    if (route === prefix && req.method === 'POST' && !adminConversation) {
      const text = security.text(data.text, 1, 5000, 'Mensagem');
      let conversation = db.conversations.find(c => c.visitorId === current.user.id);
      if (conversation?.status === 'Encerrada') throw security.fail(409, 'Atendimento encerrado. Aguarde a reabertura pela equipe.');
      const stamp = now();
      if (!conversation) { conversation = { id: db.meta.nextConversationId++, visitorId: current.user.id, status: 'Aberta', createdAt: stamp, updatedAt: stamp }; db.conversations.push(conversation); }
      db.supportMessages.push({ id: db.meta.nextSupportMessageId++, conversationId: conversation.id, senderId: current.user.id, text, createdAt: stamp });
      conversation.updatedAt = stamp; return send(201, { conversation: view(conversation) });
    }
    const match = new RegExp('^' + prefix + '/(\\d+)/(messages|status)$').exec(route);
    if (!match) throw security.fail(404, 'Atendimento não encontrado.');
    const conversation = db.conversations.find(c => c.id === Number(match[1]));
    if (!conversation || (!current.staff && conversation.visitorId !== current.user.id)) throw security.fail(404, 'Atendimento não encontrado.');
    if (match[2] === 'status' && req.method === 'POST') {
      if (!current.staff) throw security.fail(403, 'Apenas a equipe pode encerrar ou reabrir atendimentos.');
      if (!['Aberta', 'Encerrada'].includes(data.status)) throw security.fail(400, 'Status inválido.');
      conversation.status = data.status; conversation.updatedAt = now();
      audit(db, current.user.id, 'conversation.status', 'conversation', conversation.id, data.status);
      return send(200, { conversation: view(conversation) });
    }
    if (match[2] === 'messages' && req.method === 'GET') return send(200, { conversation: view(conversation), messages: db.supportMessages.filter(m => m.conversationId === conversation.id).map(m => ({ ...m, senderName: member(db, m.senderId) ? 'Equipe RenoLink' : db.users.find(u => u.id === m.senderId)?.name })) });
    if (match[2] === 'messages' && req.method === 'POST') {
      if (conversation.status !== 'Aberta') throw security.fail(409, 'Atendimento encerrado.');
      const text = security.text(data.text, 1, 5000, 'Mensagem');
      const message = { id: db.meta.nextSupportMessageId++, conversationId: conversation.id, senderId: current.user.id, text, createdAt: now() };
      db.supportMessages.push(message); conversation.updatedAt = message.createdAt;
      if (current.staff) audit(db, current.user.id, 'conversation.reply', 'conversation', conversation.id);
      return send(201, { message });
    }
  }
  return false;
}
module.exports = { handle, member, audit, ideaPayload };
