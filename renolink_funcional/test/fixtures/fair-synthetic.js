'use strict';
const crypto = require('node:crypto');
const { passwordHash } = require('../../lib/security');

async function createFairFixture() {
  const credentials = await Promise.all(
    Array.from({ length: 4 }, () => passwordHash(crypto.randomBytes(32).toString('base64url')))
  );
  const stamp = '2026-10-01T12:00:00.000Z';
  return {
    meta: {
      schemaVersion: 5,
      nextUserId: 5,
      nextIdeaId: 2,
      nextMessageId: 2,
      nextNegotiationId: 2,
      nextConversationId: 2,
      nextSupportMessageId: 3,
      nextRequestId: 2,
      nextAuditId: 2
    },
    users: [
      { id: 1, name: 'Visitante Criador Sintético', email: 'criador@feira.invalid', role: 'creator', company: '', ...credentials[0], createdAt: stamp },
      { id: 2, name: 'Visitante Empresa Sintético', email: 'empresa@feira.invalid', role: 'company', company: 'Companhia Fictícia', ...credentials[1], createdAt: stamp },
      { id: 3, name: 'Atendimento Sintético', email: 'atendimento@feira.invalid', role: 'creator', company: '', ...credentials[2], createdAt: stamp },
      { id: 4, name: 'Administração Sintética', email: 'admin@feira.invalid', role: 'creator', company: '', ...credentials[3], createdAt: stamp }
    ],
    ideas: [
      { id: 1, userId: 1, title: 'Horta urbana fictícia', category: 'Sustentabilidade', problem: 'Cenário sintético para teste.', solution: 'Proposta demonstrativa sem dados reais.', beneficiaries: 'Comunidade fictícia', participation: 'Demonstração', status: 'Publicada', potential: 'Fictício', createdAt: stamp, updatedAt: stamp }
    ],
    messages: [
      { id: 1, fromUserId: 2, toUserId: 1, text: 'Mensagem de demonstração sem conteúdo pessoal.', createdAt: stamp }
    ],
    negotiations: [
      { id: 1, ideaId: 1, creatorUserId: 1, companyUserId: 2, status: 'Interesse demonstrado', createdAt: stamp, updatedAt: stamp }
    ],
    sessions: [],
    staff: [
      { userId: 3, accessRole: 'support', active: 1, createdAt: stamp },
      { userId: 4, accessRole: 'admin', active: 1, createdAt: stamp }
    ],
    conversations: [
      { id: 1, visitorId: 1, status: 'Aberta', createdAt: stamp, updatedAt: stamp }
    ],
    supportMessages: [
      { id: 1, conversationId: 1, senderId: 1, text: 'Pedido sintético de atendimento.', createdAt: stamp },
      { id: 2, conversationId: 1, senderId: 3, text: 'Resposta sintética da equipe.', createdAt: stamp }
    ],
    requests: [
      { id: 1, ideaId: 1, visitorId: 2, status: 'Solicitada', createdAt: stamp, updatedAt: stamp }
    ],
    audit: [
      { id: 1, actorId: 4, action: 'staff.fixture', targetType: 'staff', targetId: 4, detail: 'Evento inteiramente sintético.', createdAt: stamp }
    ]
  };
}

module.exports = { createFairFixture };
