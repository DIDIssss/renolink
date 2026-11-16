# RenoLink — primeiro administrador ativado

Em 26/10/2026, às 19:40:12 (America/Sao_Paulo), após seleção explícita da conta
ID 3 e confirmação da concessão pelo responsável nesta conversa, foi concedido
o papel admin em renolink_dev.

A identidade foi conferida novamente antes da operação; não existia outro
administrador ativo nem associação anterior para a conta selecionada.
Foi usada somente a conta renolink_migrator@127.0.0.1, com senha carregada
do cofre DPAPI, sem exibição ou alteração de credenciais.

Resultado: associação ativa user_id=3/access_role=admin e evento de auditoria
staff.provision, ID 1, na mesma transação. A comparação integral confirmou que
as coleções históricas foram preservadas; somente a associação, o evento e
nextAuditId foram acrescentados/atualizados. A concessão foi conferida após commit.

Nenhum usuário foi criado. Senha e perfil público não foram alterados.
Nenhum outro banco, JSON original ou registro histórico foi modificado.

Recibo sem credenciais:
`renolink_funcional/data/runtime/phase6-first-admin-grant.json`.

O titular deve iniciar a aplicação local pelo INICIAR_RENOLINK.bat e acessar
/admin-login.html com sua senha pessoal. A checagem HTTP nesta sessão não
conseguiu conectar à porta 3000; a concessão foi confirmada diretamente no MySQL.
Não houve login em nome da pessoa nem solicitação de sua senha nesta etapa.
