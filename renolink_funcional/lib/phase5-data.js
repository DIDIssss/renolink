'use strict';
const mappings = {
  staff: ['userId', 'accessRole', 'active', 'createdAt'],
  conversations: ['id', 'visitorId', 'status', 'createdAt', 'updatedAt'],
  supportMessages: ['id', 'conversationId', 'senderId', 'text', 'createdAt'],
  requests: ['id', 'ideaId', 'visitorId', 'status', 'createdAt', 'updatedAt'],
  audit: ['id', 'actorId', 'action', 'targetType', 'targetId', 'detail', 'createdAt']
};
const counters = { conversations: 'nextConversationId', supportMessages: 'nextSupportMessageId', requests: 'nextRequestId', audit: 'nextAuditId' };
const requestStatuses = ['Solicitada', 'Em contato', 'Em negociação', 'Concluída', 'Encerrada'];
function initialize(db) {
  if (db.meta.schemaVersion === 5) return db;
  if ((db.meta.schemaVersion !== undefined && db.meta.schemaVersion !== 1) || Object.values(counters).some(key => key in db.meta)) throw Error('Versao ou contadores Fase 5 preexistentes; inspecao necessaria.');
  if (Object.keys(mappings).some(key => db[key] !== undefined)) throw Error('Extensao Fase 5 preexistente.');
  for (const key of Object.keys(mappings)) db[key] = [];
  for (const counter of Object.values(counters)) db.meta[counter] = 1;
  db.meta.schemaVersion = 5;
  return db;
}
function validate(db) {
  if (db.meta.schemaVersion !== 5) {
    if (Object.keys(mappings).some(key => db[key] !== undefined)) throw Error('Fase 5 exige versao de schema.');
    return;
  }
  const users = new Set(db.users.map(u => u.id)), ideas = new Set(db.ideas.map(i => i.id));
  const sets = {};
  for (const key of Object.keys(mappings)) {
    if (!Array.isArray(db[key])) throw Error('Colecao Fase 5 ausente.');
    sets[key] = new Set();
    for (const row of db[key]) {
      const id = key === 'staff' ? row.userId : row.id;
      if (!Number.isSafeInteger(id) || id < 1 || sets[key].has(id) || !Number.isFinite(Date.parse(row.createdAt)) || ('updatedAt' in row && !Number.isFinite(Date.parse(row.updatedAt)))) throw Error('Registro Fase 5 invalido.');
      sets[key].add(id);
    }
  }
  for (const row of db.staff) if (!users.has(row.userId) || !['admin', 'support'].includes(row.accessRole) || ![0, 1].includes(row.active)) throw Error('Equipe invalida.');
  const visitors = new Set();
  for (const row of db.conversations) {
    if (!users.has(row.visitorId) || visitors.has(row.visitorId) || !['Aberta', 'Encerrada'].includes(row.status)) throw Error('Conversa invalida.');
    visitors.add(row.visitorId);
  }
  for (const row of db.supportMessages) {
    const conversation = db.conversations.find(c => c.id === row.conversationId);
    if (!conversation || !users.has(row.senderId) || (conversation.visitorId !== row.senderId && !sets.staff.has(row.senderId)) || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 5000) throw Error('Mensagem de atendimento invalida.');
  }
  const pairs = new Set();
  for (const row of db.requests) {
    const pair = `${row.ideaId}:${row.visitorId}`;
    if (!ideas.has(row.ideaId) || !users.has(row.visitorId) || pairs.has(pair) || !requestStatuses.includes(row.status)) throw Error('Solicitacao invalida.');
    pairs.add(pair);
  }
  for (const row of db.audit) if (!sets.staff.has(row.actorId) || typeof row.action !== 'string' || typeof row.detail !== 'string' || !['idea', 'conversation', 'request', 'negotiation', 'staff'].includes(row.targetType) || !Number.isSafeInteger(row.targetId) || row.targetId < 1) throw Error('Auditoria invalida.');
  for (const [key, counter] of Object.entries(counters)) if (!Number.isSafeInteger(db.meta[counter]) || db.meta[counter] <= Math.max(0, ...sets[key])) throw Error('Contador Fase 5 invalido.');
}
module.exports = { mappings, counters, requestStatuses, initialize, validate };
