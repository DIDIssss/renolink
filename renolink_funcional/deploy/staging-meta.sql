-- Somente no novo renolink_staging vazio, apos aprovacao do provisionamento.
-- Nao ha USE, reset, sobrescrita nem ON DUPLICATE KEY. Duplicidade deve falhar.
INSERT INTO renolink_meta (id,payload) VALUES (1,JSON_OBJECT(
 'schemaVersion',5,'nextUserId',1,'nextIdeaId',1,'nextNegotiationId',1,
 'nextMessageId',1,'nextConversationId',1,'nextSupportMessageId',1,
 'nextRequestId',1,'nextAuditId',1
));
