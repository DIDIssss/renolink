# RenoLink — Fase 3: MySQL local

Data: 24/10/2026, America/Sao_Paulo.

## Resultado

Integração local real concluída no MySQL 8.0.46. O provisionamento terminou e
os testes foram retomados com sucesso após corrigir uma asserção de erro FK.
renolink_dev permanece vazio. A aplicação está apta à próxima etapa de migração
local, que continua dependente de autorização posterior para importar os originais.

| Recurso | Resultado |
| --- | --- |
| renolink_dev | Criado, utf8mb4_0900_bin, sem tabelas/dados |
| renolink_test | Criado, sete tabelas InnoDB e somente dados sintéticos |
| renolink_app@127.0.0.1 | SELECT, INSERT, UPDATE somente em renolink_dev |
| renolink_migrator@127.0.0.1 | SELECT, INSERT, UPDATE, CREATE, INDEX, REFERENCES somente em renolink_dev |
| renolink_tester@127.0.0.1 | Os mesmos privilégios do migrador, somente em renolink_test |

As três autenticações e SHOW GRANTS foram conferidos no provisionamento.
Nenhum recurso com esses nomes existia no preflight. Contas sem GRANT OPTION
e sem privilégios globais; USAGE em SHOW GRANTS não concede acesso global.

## Autorização e preparação

Provisionamento dos bancos renolink_dev/renolink_test e das três contas locais
autorizado pelo responsável, sujeito a recusa caso qualquer nome já exista.
Entrada da credencial administrativa deve ocorrer exclusivamente no terminal
local com senha oculta. Nenhuma credencial foi fornecida ao chat.

Os dois documentos exigidos foram lidos. O serviço MYSQL80 foi observado ativo.
A verificação anterior confirmou handshake MySQL 8.0.46 em 127.0.0.1:3306.
Nesta fase, 27 testes locais passaram: os 24 anteriores e três testes de proteção
do provisionamento, incluindo conflito de nomes, log_raw e falha parcial.
A integração inicialmente ignorada foi executada pelo responsável após a
entrada oculta da credencial administrativa e retomada nesta sessão usando
somente as credenciais DPAPI das contas dedicadas.

## Preparação entregue

- `scripts/mysql-local.ps1`: entrada oculta, cofre Windows DPAPI local ignorado
  pelo Git, variáveis somente por processo, execução de testes e inspeção.
- `scripts/provision-mysql.js`: preflight antes de criar, recusa de nomes já
  existentes inclusive usuários em outros hosts, apenas criações autorizadas,
  host 127.0.0.1, privilégios mínimos e conferência de SHOW GRANTS.
- `scripts/inspect-mysql.js`: leitura do banco sintético, validação integral de
  relações/IDs/contadores, contagens e confirmação de desenvolvimento vazio.
- Integração ampliada para negociação nova concorrente, estado completo após
  falhas de FK/unicidade/CHECK e dois reinícios reais do processo RenoLink com
  sessão e negociação consultadas por HTTP. Originais JSON conferidos por hash.

## Resultados reais

O responsável digitou a credencial administrativa localmente. Os resultados
efetivos estão em `renolink_funcional/data/runtime/`:

- `mysql-provision-report.json`: recursos encontrados/criados e privilégios.
- `mysql-integration-report.json`: somente `passed` certifica o término da suíte.
- `mysql-inspection-report.json`: contagens e consistência do estado persistido.

| Verificação | Resultado |
| --- | --- |
| Schema, importação sintética e repetição idempotente | Aprovados na primeira execução |
| Cadastro e login, upgrade de hash, autorização de ideia privada | Aprovados |
| 12 ideias simultâneas em dois pools | Criadas com IDs únicos; 15 ideias preservadas |
| Mensagens e conteúdo que parece SQL | Persistidos como dados, com privacidade |
| Nova negociação concorrente | Uma criação e cinco repetições idempotentes |
| UPDATE seguido de INSERT com FK inválida | FK rejeitou; estado integral restaurado pelo rollback |
| E-mail duplicado e CHECK de perfil | Rejeitados; estado integral preservado |
| Snapshot antigo sobre dados novos | Recusado |
| Persistência | Estado integral e sessão HTTP preservados após dois reinícios reais do processo RenoLink |
| Consistência | IDs, contadores, autoria e todos os relacionamentos validados |
| renolink_dev | Inspeção final confirmou ausência de tabelas |

Estado após a retomada: 5 usuários, 15 ideias, 2 negociações, 2 mensagens e
11 sessões sintéticas. Os logins adicionais nas duas retomadas explicam o
aumento de sessões; nenhum usuário, ideia, mensagem ou negociação foi removido.

O erro original ocorreu na asserção FK: o servidor retornou
ER_NO_REFERENCED_ROW, errno 1216, SQLSTATE 23000, em vez de
ER_NO_REFERENCED_ROW_2/1452. Ambas são variantes documentadas para uma
referência inexistente. O teste agora confere combinações exatas de símbolo e
número e exige SQLSTATE 23000. Também confirma que o UPDATE atingiu uma linha
e foi visível dentro da transação, antes da falha, e compara todos os registros
após o rollback. Nenhuma FK, validação de dados ou permissão foi removida.

Para não limpar o banco, o modo Resume reconhece a fixture por hash e conteúdo,
preserva o relatório inicial e continua os testes restantes. Cadastro,
importação e criação concorrente não foram repetidos nessa retomada; haviam
passado antes da asserção que falhou na primeira execução.

O PowerShell bloqueou inicialmente scripts por política de execução; foi usado
Bypass apenas nos processos de inspeção/teste. A leitura do DPAPI falhou no
sandbox e funcionou no contexto Windows autorizado fora dele. Nenhuma política
permanente ou configuração do MySQL foi alterada. Senhas não foram exibidas.

Originais e runtime preservam SHA-256:
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.

Não houve importação dos dados originais, reset, exclusão de bancos, alteração
global, reinício do MYSQL80 ou publicação. Os reinícios testados foram apenas
do processo da aplicação. Recuperação após reinício do serviço MySQL, restauração
de backup e carga de produção não foram ensaiadas nesta fase.

Referência: [erros de servidor MySQL 8.0](https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html).
