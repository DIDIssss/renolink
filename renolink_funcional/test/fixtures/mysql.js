'use strict';
const { digest } = require('../../lib/security');
function fixture() {
  const now = '2026-08-23T12:00:00.000Z';
  const users = [1, 2, 3].map(id => ({ id, name: `Pessoa ${id}`, email: `pessoa${id}@teste.invalid`, role: id === 2 ? 'company' : 'creator', company: id === 2 ? 'Empresa Teste' : '', salt: `test-${id}`, passwordHash: digest(`test-${id}:123456`), createdAt: now }));
  const idea = (id, status, userId = 1) => ({ id, userId, title: `Ideia ${id} 💡`, category: 'Tecnologia', problem: 'Problema', solution: 'Solução', beneficiaries: '', participation: 'Ainda não sei', status, potential: 'Alto', createdAt: now, updatedAt: now });
  return {
    meta: { nextUserId: 4, nextIdeaId: 4, nextMessageId: 2, nextNegotiationId: 2 }, users,
    ideas: [idea(1, 'Publicada'), idea(2, 'Em análise'), idea(3, 'Publicada', null)],
    messages: [{ id: 1, fromUserId: 2, toUserId: 1, text: 'Mensagem preservada 📩', createdAt: now }],
    negotiations: [{ id: 1, ideaId: 1, creatorUserId: 1, companyUserId: 2, status: 'Interesse demonstrado', createdAt: now, updatedAt: now }],
    sessions: []
  };
}
module.exports = { fixture };
