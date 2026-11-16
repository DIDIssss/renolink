# RenoLink 2.0 — Fase 5: equipe e experiência do visitante

Atualização: a migração foi posteriormente autorizada e aplicada em renolink_dev,
com backup completo e validações aprovadas. Consulte
[FASE_5_ATIVACAO.md](FASE_5_ATIVACAO.md) para o estado atual. Nenhum administrador
real foi criado. O texto abaixo preserva a entrega isolada anterior à ativação.

Data: 24/10/2026, America/Sao_Paulo.

## Resultado e limite da entrega

Funcionalidades implementadas e verificadas em ambiente isolado, incluindo
MySQL real e Chrome desktop/mobile. A migração incremental foi aplicada somente
em renolink_test. **O schema de renolink_dev não foi alterado.** A ativação no
ambiente de desenvolvimento aguarda autorização explícita da proposta descrita
em [PHASE5_PLAN.md](../renolink_funcional/database/mysql/PHASE5_PLAN.md).

O processo local da Fase 4 não foi reiniciado. Não considere a Fase 5 ativada
em http://127.0.0.1:3000 até aprovar o schema, escolher a equipe e reiniciar o
processo de forma controlada. O servidor novo permanece compatível com o
schema anterior; rotas novas recusam operações com 503 até o marcador Fase 5.

## Funcionalidades administrativas

- Login próprio em admin-login.html; painel admin.html protegido no servidor.
- Associação de equipe separada do perfil público: administração e atendimento.
  Nenhum cadastro público pode conceder acesso. A associação ativa é consultada
  em toda requisição; revogação bloqueia inclusive sessões já emitidas.
- Dashboard com contagens reais de ideias, pendências, usuários, conversas,
  solicitações e negociações anteriores.
- Listagem pesquisável de usuários sem hashes/salts e propostas filtráveis.
- Detalhes completos da ideia, contato do autor restrito à administração,
  aprovação e rejeição com parecer. Rejeição exige justificativa.
- Proteção contra análise concorrente/stale: status Em análise e updatedAt
  esperado; duas análises simultâneas resultam em uma decisão e um conflito.
- Caixa de atendimento com histórico, resposta, encerramento e reabertura.
- Acompanhamento de solicitações novas e negociações anteriores, transições
  controladas de etapa e registro de alterações.
- Histórico administrativo paginado por cursor, com ator, alvo, ação e data.
  Eventos de login da equipe, moderação, respostas, encerramentos e etapas são
  gravados na mesma transação da operação.

O papel support acessa somente sua identidade de equipe e os atendimentos.
Não pode listar usuários, moderar ideias, consultar auditoria ou gerir negociações.
Não existe endpoint público ou administrativo para promover usuários.
O script de concessão exige operador local migrador e autorização própria.

## Portal do visitante

- Cadastro e login existentes preservados, com cookie HttpOnly e hash scrypt.
- Criação de ideias inicia em Em análise. Edição da própria proposta por formulário
  preenchido com os dados atuais; ao salvar, ela retorna à análise.
- Visitantes não podem enviar status, autoria ou campos de moderação na edição.
  Tentativas de editar ideias alheias não revelam sua existência.
- Acompanhamento de status e parecer da equipe na área pessoal e no detalhe.
- Exploração e detalhes públicos somente para ideias publicadas; propostas em
  análise/rejeitadas permanecem privadas. Interesse não publica uma ideia.
- Atendimento real à equipe, sem destinatário numérico fixo. Conversas isoladas
  por visitante, com histórico bidirecional e botão para atualizar mensagens.
- Solicitação de negociação de ideia aprovada, sem duplicação por ideia/visitante,
  e acompanhamento de etapas. Negociações e mensagens anteriores são preservadas.
- Navegação inferior no celular, inclusive ao passar pelo catálogo e pelo detalhe;
  saída de sessão acessível. Interface da equipe tem menu mobile e foco visível.
- Marca, logo e paleta marinho/violeta preservados. Removidas as credenciais de
  demonstração e a linguagem de protótipo nas telas de entrada.

## Segurança e persistência

As rotas administrativas exigem autenticação e autorização no backend; ocultar
botões não é a proteção de acesso. As permissões de equipe não são confiadas ao
localStorage. Acesso ao HTML administrativo também é verificado no servidor.

Dados recebidos passam por limites, enums, autoria, estado e controle de versão.
Cookies, proteção de origem e limitação de tentativas anteriores foram mantidos,
inclusive no login administrativo. O cliente escapa conteúdo dinâmico; o título
contendo uma tag script nos testes não executa código. Arquivos internos,
SQLs, scripts e cofre DPAPI continuam fora da lista de arquivos públicos.

O adaptador MySQL usa parâmetros para valores e identificadores internos fixos.
As cinco coleções novas só são lidas se meta.schemaVersion=5. A validação inclui
IDs, contadores, papéis, FKs lógicas e remetente autorizado no atendimento.
JSONs originais nunca são usados para as escritas dos testes.

O histórico é imutável pela API, mas não é um log inviolável contra um operador
SQL privilegiado. O adaptador preserva a arquitetura atual de leitura/salvamento
do conjunto; dimensionamento para grande volume não foi certificado nesta fase.

## Migração proposta para aprovação

SQL: [002_phase5.sql](../renolink_funcional/database/mysql/002_phase5.sql).
SHA-256: `48ed1afad24d682df513bcf671a4e3533f9ef487d62b47d2b49f247b5fcab0fd`.

| Tabela nova | Finalidade |
| --- | --- |
| renolink_staff | Acesso da equipe vinculado a usuário existente |
| renolink_conversations | Atendimentos por visitante |
| renolink_support_messages | Mensagens do atendimento |
| renolink_requests | Solicitações de negociação à equipe |
| renolink_audit | Ações administrativas |

Tabelas InnoDB, utf8mb4, FKs, CHECKs e índices. Nenhuma coluna existente é
alterada e nenhum registro atual é substituído/excluído. A única atualização
em registro existente é o documento de metadados: versão, quatro contadores,
hash e data da migração. O migrador não regrava as linhas operacionais existentes.

Antes de aplicar, conserva snapshot lógico verificável do banco; ativa o marcador
em transação após criar e validar as tabelas. A segunda execução retorna
already-applied. DDL MySQL pode fazer commit implícito; uma falha parcial deixa
tabelas para inspeção, sem reset nem limpeza automática. Tabelas novas sem
marcador são recusadas, sem aceitar silenciosamente um schema desconhecido.

O comando exige renolink_migrator e aprovação específica para renolink_dev.
O wrapper `scripts/phase5-operator.ps1` usa o cofre DPAPI e tem modo padrão Plan.
ApplySchema e GrantStaff exigem -Approved e não foram executados nesta entrega.
Os privilégios existentes por schema cobrem as tabelas novas; não foram criados
usuários de banco ou ampliados privilégios.

## Testes realizados

| Validação | Resultado |
| --- | --- |
| npm.cmd test | 28 testes aprovados, incluindo regressões e suíte HTTP Fase 5 |
| MySQL Fase 5 isolado | Aprovado em renolink_test/renolink_tester |
| Migração incremental repetida | already-applied; snapshot e dados anteriores preservados |
| Bloqueio de dev sem autorização | Chamada recusada antes de abrir conexão |
| Visitante anônimo/autenticado | Sem acesso a todas as listagens administrativas testadas |
| Elevação no cadastro | role admin, teamRole e isAdmin recusados |
| Atendimento vs administração | Support não modera nem acessa dados administrativos |
| Revogação | Sessão existente perde acesso após active=0 |
| Moderação concorrente | Uma aprovação; segunda requisição recebe conflito |
| Rejeição/reenvio | Parecer obrigatório; edição retorna à análise |
| Atendimento privado | Outro visitante não lê nem responde à conversa |
| Negociações | Solicitação idempotente e transições válidas; visitante não muda etapa |
| Auditoria | Ações esperadas persistidas na transação |
| Reinício Node isolado | Sessão, conversa e snapshot integral persistiram em novo processo |
| Chrome desktop 1440×1000 | Login administrativo, dashboard e moderação aprovados |
| Chrome mobile 390×844 | Cadastro, logout/login, ideia, edição, negociação e conversa aprovados |
| Navegação mobile | Menus funcionais; sem overflow horizontal da página |
| Erros JS/diálogos inesperados | Nenhum na execução final |
| renolink_dev após os testes | Comparação integral com a origem aprovada, sem alteração de registros/schema |

Os testes sintéticos conservam seus registros, sem reset. As contas de equipe
criadas nas fixtures existem somente no banco de testes e não são administradores
reais. A aprovação no navegador usou a rota administrativa efetiva; a Fase 5
não promove mais a ideia por preparação manual da fixture.

Uma execução inicial da suíte HTTP falhou porque a página administrativa ainda
não havia sido criada. O primeiro teste de navegador identificou ausência do
menu mobile no detalhe da ideia; a navegação foi corrigida e os testes passaram
nas execuções finais. Essas falhas não envolveram renolink_dev.

Relatórios sem segredos em `renolink_funcional/data/runtime/`:
phase5-mysql-report.json, phase5-browser-report.json e mysql-dev-live-report.json.

Capturas visuais:

- [Administração desktop](../renolink_funcional/data/runtime/phase5-preview/admin-desktop.png)
- [Administração mobile](../renolink_funcional/data/runtime/phase5-preview/admin-mobile.png)
- [Visitante mobile](../renolink_funcional/data/runtime/phase5-preview/visitante-mobile.png)

## Arquivos adicionados

- admin.html; admin-login.html.
- assets/js/admin.js; assets/css/phase5.css.
- lib/phase5.js; lib/phase5-data.js.
- database/mysql/002_phase5.sql; database/mysql/PHASE5_PLAN.md.
- scripts/migrate-phase5.js; scripts/grant-staff.js;
  scripts/phase5-operator.ps1; scripts/test-phase5.ps1.
- test/phase5.test.js; test/phase5.mysql.test.js; test/phase5.browser.js;
  test/fixtures/phase5.js.
- auditoria/FASE_5.md.

## Arquivos alterados

- server.js: integração das rotas, proteção do HTML, rate limit administrativo
  e exposição restrita do parecer.
- lib/data.js e lib/mysql.js: validação e mapeamento opcional da Fase 5.
- assets/js/app.js: portal, edição, atendimento, solicitações e navegação mobile.
- index.html, empresa.html, explorar.html, ideia.html, cadastro.html, login.html,
  dashboard.html, nova-ideia.html, mensagens.html e negociacoes.html: inclusão
  dos estilos complementares; ajustes de conteúdo e atendimento onde aplicável.
- package.json e package-lock.json: comandos de testes e Playwright de
  desenvolvimento (instalação informou zero vulnerabilidades).
- README.md e database/mysql/README.md: estado da entrega e ativação pendente.

## Preservação e pendências

renolink_dev mantém 4 usuários, 9 ideias, 7 mensagens, 1 negociação e 0 sessões.
JSON original, operacional e backups mantêm SHA-256
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.
MYSQL80 continua ativo e não foi reiniciado. Nenhum outro projeto/banco foi
alterado. Nada foi publicado.

Pendências para a demonstração:

1. Aprovar a migração aditiva em renolink_dev.
2. Coordenar a parada/reabertura do processo local para ativar o código e o
   schema juntos; manter backup e conferência dos dados durante a janela.
3. Escolher uma conta humana com senha forte para admin e, se necessário,
   outra para support; conceder pelo operador local, nunca pelo cadastro público.
   Não usar as credenciais legadas de demonstração para a equipe.
4. Validar a instalação ativada com as contas reais da equipe. Testes de
   carga/recuperação e requisitos de hospedagem permanecem fora desta validação.

Atendimento usa atualização manual; notificações externas, tempo real e fluxo
contratual/pagamentos de negociação não fazem parte desta entrega.
