# RenoLink — Fase 6: preparação do primeiro administrador

Atualização posterior: o responsável selecionou o ID 3 e autorizou a concessão.
Ela foi executada e auditada; consulte [FASE_6_ATIVACAO.md](FASE_6_ATIVACAO.md).
O texto abaixo preserva a preparação anterior à autorização.

Data: 26/10/2026, America/Sao_Paulo.

## Resultado

Assistente seguro preparado e operação subjacente validada em renolink_test.
**Nenhuma concessão real executada em renolink_dev.** Nenhum administrador real,
usuário fictício ou registro de concessão foi criado no banco principal.

Procedimento e comandos:
[FIRST_ADMIN.md](../renolink_funcional/database/mysql/FIRST_ADMIN.md).

## Revisão da implementação anterior

Os papéis da equipe ficam em renolink_staff, separados do perfil público
creator/company. Rotas administrativas verificam sessão e associação ativa
em cada requisição; support não recebe as operações exclusivas de admin.
O cadastro público não aceita papel admin ou parâmetros de equipe. Arquivos
internos/cofre não fazem parte da lista pública. Isso foi preservado.

Já existia scripts/grant-staff.js, condicionado à conta migradora e flag de
aprovação, com auditoria. Foram identificadas duas lacunas para o primeiro
administrador: não confirmava interativamente a identidade e usava mysql.save,
que regravava desnecessariamente linhas anteriores do conjunto de dados.

O caminho antigo sem confirmação foi desativado. O modo GrantStaff do operador
passou a encaminhar para o novo assistente. Não há endpoint novo de concessão.

## Procedimento implementado

- Preview somente de leitura como padrão; Grant é uma ação explícita.
- Terminal local interativo; senha MySQL via cofre Windows DPAPI, sem senha
  literal ou arquivo novo de configuração de segredos.
- Confirmação por ID existente, apresentação de nome/e-mail/perfil, digitação
  exata do e-mail e da frase CONCEDER ADMIN <ID> EM renolink_dev.
- Seleção vinculada a fingerprint; conta e associação são reavaliadas sob lock.
- Autenticação efetiva CURRENT_USER, banco, host e porta são conferidos.
- Exige renolink_migrator em dev; renolink_app e destinos remotos são recusados.
- Caminho isolado aceita somente renolink_test/renolink_tester com autorização
  de teste e nunca aceita renolink_dev com esse sinalizador.
- Insere somente uma associação e um evento staff.provision, e atualiza
  somente o documento de metadados para incrementar nextAuditId.
- Toda a concessão é transacional; comparação integral antes do commit.
- Associação existente, inclusive inativa, não é substituída. Repetição não
  acrescenta outro evento ou permissão.
- Nenhuma senha do usuário é criada, alterada ou solicitada pelo assistente.

O schema de auditoria exige actor_id de usuário. O beneficiário é referenciado
nesse campo, e a origem real é registrada explicitamente no detalhe e extras:
operador local, conta MySQL efetiva e usuário Windows. Não se trata de uma ação
iniciada pelo visitante nem de um endpoint de autopromoção.

Os prompts não impedem uma pessoa que já controle a conta Windows/cofre ou
credenciais SQL de agir como operador. Não foram alterados privilégios MySQL
nesta etapa; o procedimento aplica a restrição de conta na sua fronteira de
execução. O uso de uma conta humana com senha forte é pré-condição operacional;
a concessão não audita a força de uma senha armazenada e não a redefine.

## Testes

| Verificação | Resultado |
| --- | --- |
| Sintaxe JS e PowerShell | Aprovada |
| npm.cmd test | 28 testes locais aprovados |
| npm.cmd run test:phase6 | Integração real e Chrome aprovados em renolink_test |
| Sete tentativas com aprovação/identidade/frase inválidas | Recusadas sem mudar o snapshot |
| Conta/banco/host errados e test mode apontando para dev | Recusados antes de conectar |
| Concessão válida a usuário existente | Uma associação admin e um evento auditado |
| Repetição da concessão | Recusada sem auditoria adicional |
| Dados históricos durante concessão | Todas as coleções anteriores idênticas; apenas nextAuditId incrementado |
| Cookie falso, cabeçalhos e localStorage forjados | Sem acesso ao painel administrativo |
| Cadastro público com papel admin | Recusado |
| Login administrativo após concessão de teste | Painel, visitantes e histórico acessíveis no Chrome |

O usuário sintético foi inserido somente em renolink_test, antes da seleção do
procedimento, com senha aleatória criptográfica mantida em memória e hash scrypt
no banco. A concessão foi feita pela mesma função usada no assistente. O teste
não promoveu fixtures previamente administrativas nem tocou em contas reais.
Registros sintéticos foram preservados, sem reset.

Relatório técnico sem senhas/e-mails:
`renolink_funcional/data/runtime/phase6-test-report.json`.
O preenchimento humano dos prompts do terminal Windows não foi automatizado;
a lógica compartilhada de confirmação, autorização, gravação e auditoria foi
testada. A execução real do assistente permanece pendente de autorização.

## Banco principal e preservação

Inspeção somente de leitura com renolink_app confirmou schemaVersion=5,
zero associações de equipe, zero administradores ativos e zero eventos de
auditoria em renolink_dev. As contagens atuais observadas são 6 usuários,
10 ideias, 7 mensagens, 1 negociação e 3 sessões. São dados já existentes
consultados nesta etapa, não registros criados pelos testes da Fase 6.

A hash das coleções históricas, associação de equipe e auditoria foi comparada
antes/depois da rodada final de testes. Os JSONs preservam SHA-256
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.
Nenhum schema, senha ou registro histórico do banco principal foi alterado.
Nenhuma outra base/projeto foi modificada e não houve publicação ou reinício
de serviços nesta etapa.

Inspeção: `renolink_funcional/data/runtime/phase6-dev-inspection.json`.

## Arquivos

Adicionados:

- lib/staff-provision.js;
- scripts/first-admin.js e scripts/first-admin.ps1;
- scripts/test-phase6.ps1 e scripts/check-phase6-dev.js;
- test/phase6.mysql.test.js;
- database/mysql/FIRST_ADMIN.md e auditoria/FASE_6.md.

Alterados: scripts/grant-staff.js (desativação do caminho antigo),
scripts/phase5-operator.ps1 (encaminhamento), package.json (comando test:phase6)
e documentos de acesso/provisionamento.

## Próximo passo, ainda não autorizado

O responsável deve autorizar a concessão real e indicar a pessoa/conta
existente. O operador deve conferir o ID/e-mail no terminal, executar o modo
Grant e fornecer as duas confirmações. Depois a própria pessoa entra em
/admin-login.html com sua senha pessoal. Nenhuma senha deve ser enviada ao chat.
