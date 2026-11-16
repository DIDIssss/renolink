# RenoLink — Fase 5 aplicada em renolink_dev

Data: 24/10/2026, America/Sao_Paulo. Autorização condicional do responsável
cumprida. Backup concluído às 19:01:44; inspeção da aplicação às 19:03:07.

## Resultado

Migração aditiva concluída em renolink_dev com renolink_migrator@127.0.0.1.
Repetição retornou already-applied. A aplicação foi reaberta com renolink_app
e confirmou Fase 5 ativa. Nenhum administrador real foi criado.

| Coleção | Antes | Depois |
| --- | ---: | ---: |
| Usuários | 4 | 4 |
| Ideias | 9 | 9 |
| Mensagens | 7 | 7 |
| Negociações | 1 | 1 |
| Sessões | 0 | 0 |
| Equipe, conversas, mensagens de atendimento, solicitações e auditoria | inexistentes | cinco tabelas vazias |

Conteúdo integral, IDs, relacionamentos e estrutura das sete tabelas anteriores
preservados. Não houve substituição dos registros operacionais. O banco agora
tem 12 tabelas InnoDB. As cinco novas tabelas têm cinco PKs, sete FKs,
dez CHECKs e duas restrições únicas adicionais, além dos índices de consulta.
As definições SHOW CREATE TABLE estão preservadas no relatório técnico.

## Revisão prévia e concorrência

- SQL idêntico ao aprovado: SHA-256
  `48ed1afad24d682df513bcf671a4e3533f9ef487d62b47d2b49f247b5fcab0fd`.
- Exatamente cinco instruções CREATE TABLE previstas em PHASE5_PLAN.md.
  Nenhum DROP, TRUNCATE, DELETE, ALTER ou SET de relaxamento de proteção na migração.
  ON DELETE RESTRICT preserva as referências; não executa exclusão de registros.
- PKs/FKs/índices/CHECKs compatíveis com os IDs e tipos existentes, já certificados
  em MySQL isolado e novamente conferidos após aplicação real.
- Versão anterior aceita somente sem versão explícita ou versão 1. A inicialização
  agora recusa contadores novos preexistentes ou versões desconhecidas; não os
  sobrescreve. Cada chave anterior do metadata foi comparada com o resultado.
- Somente o Node RenoLink identificado por PID 12716, comando server.js e listener
  127.0.0.1:3000 foi encerrado durante a manutenção. Nenhum outro runtime foi
  encontrado. Nenhum processo de outro projeto foi encerrado.
- Após a parada, a conta da aplicação não tinha outras conexões em renolink_dev.
  A conta migradora também não tinha outra conexão no banco. O mesmo GET_LOCK
  utilizado pelo adaptador foi mantido durante backup, DDL e ativação, excluindo
  gravações/migrações participantes. Nenhum privilégio global foi solicitado.

## Backup completo e restauração

Diretório:
`renolink_funcional/data/backups/phase5-dev-full/2026-10-24T22-01-44-500Z/`.

| Arquivo | Bytes | SHA-256 |
| --- | ---: | --- |
| renolink_dev.sql | 15011 | a593e778b4a9fd597571e1af8adddb2c577efb835c3ae0f3a88c2fa83f07128c |
| snapshot.json | 13741 | 86a44ab4f6023728fca094f9057be1582e3e2017ed56b88baf415da12357e942 |

O manifesto inclui contagens das sete tabelas: users=4, ideas=9, messages=7,
negotiations=1, sessions=0, meta=1 e imports=1. Backup realizado com mysqldump
8.0.46, conta migradora e snapshot consistente. Contém estrutura, dados,
restrições e índices. Não havia objetos adicionais da aplicação além das tabelas
documentadas. A senha foi usada somente no ambiente transitório do processo,
sem argumento, log ou arquivo de configuração em texto aberto.

Foram conferidos: sete CREATEs, contagens dos INSERTs de todas as tabelas,
leitura/comparação do snapshot, tamanhos, hashes e estabilidade dos registros
da origem. Os hashes foram conferidos novamente após a migração/testes.

Procedimento completo: [RESTORE_PHASE5.md](../renolink_funcional/database/mysql/RESTORE_PHASE5.md).
A restauração deve ocorrer em outro banco vazio e especificamente autorizado.
Não foi executado ensaio de restauração nesta etapa: não houve autorização para
criar esse destino, e renolink_test contém dados sintéticos preservados.

## Aplicação da migração

A função existente de migração recebeu uma verificação/backup obrigatória para
o destino de desenvolvimento, executada sob seu mesmo lock. Sem esse callback,
aplicações diretas em renolink_dev são recusadas. O wrapper do operador encaminha
a ativação para scripts/activate-phase5.ps1.

As tabelas foram criadas antes da transação de dados, conforme o comportamento
DDL do MySQL. Depois, somente renolink_meta.payload recebeu schemaVersion=5,
quatro novos contadores iniciados em 1, hash e data da migração. Os valores
anteriores foram preservados. O metadata foi ativado em transação, com comparação
integral antes do commit. Nenhuma linha antiga das tabelas operacionais foi atualizada.

A primeira execução retornou applied e a segunda already-applied. Não houve
duplicação de tabelas ou registros. Não foi necessário limpar, corrigir ou
reexecutar uma migração falha. Todas as verificações desta aplicação passaram.

## Testes e aplicação em execução

| Verificação | Resultado |
| --- | --- |
| 28 testes locais | Aprovados, após a aplicação |
| Integração MySQL Fase 5 | Aprovada exclusivamente em renolink_test |
| Fluxos administrativos | Login, papéis, aprovação/rejeição, concorrência, atendimento, etapas e auditoria aprovados em fixtures |
| Bloqueio de visitantes | Rotas administrativas negadas; tentativas de elevação recusadas |
| Revogação de equipe | Sessão existente perde o acesso após active=0 |
| Persistência em novo Node | Snapshot integral, sessão e conversa preservados no teste isolado |
| Chrome desktop/mobile | Cadastro, logout/login, edição, aprovação, negociação e conversa aprovados |
| Erros JS inesperados na execução final | Nenhum |
| Aplicação real em renolink_dev | schemaVersion=5, /api/features confirma phase5=true |
| Acesso não autenticado em dev | Seis rotas privadas retornaram 401; admin.html redirecionou para login |
| Tabela renolink_staff em dev | Vazia: nenhuma conta real promovida |

Os cenários autenticados de administrador e visitante foram executados somente
com as contas sintéticas do banco de testes. Isso respeita a proibição de criar
administradores reais. A aplicação real teve leitura HTTP e comparação dos dados,
sem cadastros ou escritas de demonstração em renolink_dev.

Processo novo observado: PID 16284, com escuta somente em 127.0.0.1:3000.
Endereço: http://127.0.0.1:3000.
Página de acesso da equipe: http://127.0.0.1:3000/admin-login.html.
Sem concessão administrativa posterior, nenhuma conta atual pode usar o painel.

## Evidências e preservação

Relatórios em renolink_funcional/data/runtime:

- phase5-activation-report.json: backup, identidade migradora, applied/already-applied,
  contagens e definições das tabelas novas;
- phase5-mysql-report.json: integração, persistência e preservação de fixtures;
- phase5-browser-report.json: fluxos no navegador e capturas visuais;
- mysql-dev-live-report.json: identidade da aplicação, constraints, HTTP e schema 5.

JSON original e operacional mantêm o SHA-256:
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.
Os backups anteriores também passaram na inspeção final. MYSQL80 permanece
Running e não foi reiniciado. Não houve reset, alteração de outros bancos ou
projetos, modificação de renolink_test fora dos testes autorizados ou publicação.

## Arquivos desta ativação

Adicionados: scripts/activate-phase5.js, scripts/activate-phase5.ps1,
scripts/phase5-app-connections.js, database/mysql/RESTORE_PHASE5.md e este relatório.
Alterados: lib/phase5-data.js (proteção de metadados), scripts/migrate-phase5.js
(backup obrigatório de desenvolvimento), scripts/phase5-operator.ps1
(encaminhamento seguro), scripts/inspect-mysql-dev.js (inspeção do schema 5)
e documentos de estado/plano.

Pendências: escolher e autorizar uma conta humana para administração e, se desejado,
atendimento; realizar um ensaio de restauração em destino especificamente
autorizado. Nenhuma dessas ações foi executada nesta etapa.
