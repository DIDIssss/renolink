# Fase 5 — proposta de alteração do banco

Estado atual: autorizado e aplicado em `renolink_dev` em 24/10/2026.
Backup completo, preservação dos registros e repetição segura aprovados;
nenhum administrador real criado. Evidências em
[FASE_5_ATIVACAO.md](../../../auditoria/FASE_5_ATIVACAO.md).
O plano a seguir documenta o escopo revisado.

SQL revisável: [002_phase5.sql](002_phase5.sql).
SHA-256: `48ed1afad24d682df513bcf671a4e3533f9ef487d62b47d2b49f247b5fcab0fd`.

## Alterações propostas

| Tabela nova | Finalidade e proteção |
| --- | --- |
| renolink_staff | Associação ao usuário existente; admin/support; habilitação 0/1; FK e CHECK. Não altera o perfil público. |
| renolink_conversations | Um atendimento por visitante; status Aberta/Encerrada; FK e unicidade. |
| renolink_support_messages | Histórico do atendimento; remetente/conversa com FKs; texto limitado e índice por data. |
| renolink_requests | Solicitação de negociação à RenoLink; unicidade por ideia/visitante; FKs e etapas válidas. |
| renolink_audit | Ator, ação, alvo, descrição e data das ações; FKs, CHECK e índices. |

Todas as tabelas usam InnoDB e utf8mb4_0900_bin. Nenhuma tabela existente recebe
ALTER/DROP/TRUNCATE/DELETE. A alteração em dados existentes é limitada ao
documento `renolink_meta.payload`: `schemaVersion=5`, quatro contadores novos,
hash e data da migração, preservando os valores anteriores.

As ideias mantêm suas colunas atuais. O parecer de moderação usa o campo JSON
extra já existente. Usuários, ideias, mensagens e negociações existentes não
são substituídos ou apagados. Os CHECKs de perfis creator/company permanecem.

## Procedimento após aprovação explícita

1. Confirmar o destino exclusivo RenoLink e interromper novas escritas da
   aplicação em uma janela local de manutenção autorizada.
2. Obter snapshot verificável do banco. O migrador conserva backup lógico por
   hash em `data/backups/phase5/` e recusa divergências.
3. Usar somente `renolink_migrator`, com os grants já aprovados. Configurar
   `RENOLINK_PHASE5_DEV_SCHEMA_APPROVED=1` exclusivamente no processo do migrador.
4. Usar `scripts/activate-phase5.ps1`, que carrega o cofre, verifica a janela
   de manutenção e exige backup completo validado sob o mesmo lock da migração.
   Uma chamada direta sem essa verificação é recusada em renolink_dev.
5. A criação das tabelas ocorre sob o lock compartilhado da RenoLink. O metadata
   é ativado em transação, com comparação integral de todos os registros antes
   e depois. Uma repetição confere hash/schema e retorna already-applied.
6. Validar a aplicação com renolink_app e a comparação dos dados existentes.
   Escolher explicitamente uma conta humana para administração; nenhuma conta
   atual foi promovida automaticamente.

O wrapper `scripts/phase5-operator.ps1` carrega a conta migradora do cofre DPAPI
sem senha em argumentos. Seu modo padrão Plan não abre conexão. ApplySchema e
GrantStaff exigem o parâmetro explícito `-Approved`. O schema foi aplicado pela
rotina de ativação aprovada; GrantStaff não foi executado. O encerramento/reinício do processo local deve
ser coordenado antes da ativação para impedir uma instância antiga de continuar
gravando com o schema novo.

Os grants atuais por schema já cobrem as novas tabelas. Não são solicitados
novos privilégios globais, DROP, DELETE ou ALTER.

MySQL faz commit implícito de DDL. Se a criação falhar parcialmente, as novas
tabelas podem permanecer; o marcador só é ativado após validação. O script
recusa tabelas novas preexistentes sem marcador, sem apagar ou tentar corrigir
automaticamente. IF NOT EXISTS não é usado para aceitar um schema desconhecido.

## Concessão administrativa restrita

Não existe rota HTTP para conceder permissões. Na Fase 6, o comando antigo
`scripts/grant-staff.js` foi desativado e substituído pelo assistente
`scripts/first-admin.ps1`, com ID, confirmação de e-mail e frase de concessão.
Exige o cofre do operador local, conta migradora efetiva, usuário existente e
ausência de associação anterior; insere permissão e auditoria atomicamente sem
regravar os históricos. A senha pessoal não é exibida nem redefinida. Nenhuma
concessão real foi executada. Veja [FIRST_ADMIN.md](FIRST_ADMIN.md).

As rotas da equipe conferem sessão e associação ativa em cada requisição.
Desabilitar uma associação pelo operador revoga o acesso da sessão já emitida.
O histórico de auditoria é imutável pela API, mas não constitui armazenamento
inviolável contra um operador com privilégios SQL; o adaptador atual usa UPDATE.

## Validação isolada

`npm.cmd test`, `npm.cmd run test:phase5:mysql` e
`npm.cmd run test:phase5:browser` executam testes locais/sintéticos. Os dois
últimos usam o cofre DPAPI e somente renolink_test/renolink_tester. Não os confunda
com os comandos históricos de integração que exigem banco inicialmente vazio.
Nenhum reset ou limpeza automática é executado. As fixtures e seus registros
ficam preservados. A aplicação PostgreSQL histórica não é destino da Fase 5.
