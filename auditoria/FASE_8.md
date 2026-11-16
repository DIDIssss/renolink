# RenoLink — Fase 8: estabilidade e preparação para a feira

Data: 26/10/2026. Testes com escritas exclusivamente em `renolink_test`, com
`renolink_tester`. Nenhuma migração, reset, mudança de privilégios ou publicação.

## Resultado e limite da aprovação

Os testes funcionais e a carga de 10, 25 e 50 visitantes concluíram sem erros HTTP
após as correções. Os dados sintéticos persistiram e os registros anteriores foram
preservados. Entretanto, **a capacidade para 50 visitantes com boa experiência
ainda não está aprovada**: p95 HTTP de 12,47 s e login de 13,43 s sob essa rajada.
A hospedagem e os aparelhos físicos também precisam de homologação.

## Problemas identificados e correções

| Evidência | Correção aplicada |
|---|---|
| Primeiro ensaio com 10 visitantes no mesmo IP: cinco cadastros receberam 429 | Cotas separadas para tentativas válidas, falhas e conta. Cadastro: 60/IP/15 min, falhas 5; login: 120/IP/15 min, falhas 10; login por conta: 10/15 min. Sem falsificar IP nem desligar limites durante carga. |
| Persistência regravava coleções completas em cada alteração | Comparação por chave e conteúdo: somente registros alterados/novos e metadados alterados geram SQL. Transações, validações, parâmetros, FKs e lock permanecem. |
| scrypt era calculado dentro da transação global | Cálculo fora da região de escrita, sem mudar parâmetros criptográficos. Prova interna vinculada ao ID/hash/salt é revalidada na transação antes de emitir sessão. Duplicidade de cadastro continua verificada dentro da transação. |
| Falha HTTP durante atualização SSE descartava tópicos pendentes | Retenção dos tópicos e repetição de leituras com espera progressiva até 30 s. Nenhuma repetição automática de gravações. |
| EventSource em estado CLOSED podia permanecer encerrado com sessão válida | Nova conexão após consulta de sessão, espera progressiva de 2 a 30 s; encerramento explícito cancela tentativas. Reconexão nativa continua usada para interrupções comuns. |
| Fetch sem prazo e JSON inválido no painel podiam deixar espera indefinida ou mostrar erro técnico | Prazo de 45 s, mensagem de indisponibilidade, tratamento de resposta não JSON; formulários preservam valores. Painel trata 401/403. |
| Navegação tablet ocultava todos os rótulos e dependia da fonte de ícones externa | Rótulos permanecem visíveis em 850 px; coluna ajustada com conteúdo flexível. |
| Tabela administrativa de negociações produzia overflow em 390 px nos dois navegadores | Contenção das posições absolutas na tabela rolável, sem esconder as colunas. Verificação posterior sem overflow. |
| Respostas administrativas atrasadas podiam substituir a seção ou conversa mais recente | Controle de geração de carregamento e conversa. Teste atrasa usuários, abre ideias e confirma que a resposta antiga não troca o conteúdo. |
| Regressão SSE detectou primeiro envio antes da conclusão da inicialização das mensagens | Formulário começa desabilitado no HTML e registra submit antes de habilitar a interação após carregar a conversa. Evita envio nativo e perda do primeiro texto. |
| Falha temporária em /api/me era tratada como sessão expirada | Apenas 401 limpa a sessão e redireciona. Indisponibilidade preserva a sessão e apresenta o erro na página, sem confiar nela para autorização. |

O limite geral continua em 600 requisições/IP/min, gravações em 120/IP/min, SSE em
100 conexões por processo e 3 por usuário. Proteção por IP ainda pode bloquear
visitantes na mesma rede após uso prolongado; a carga curta não comprova ausência
de bloqueios durante horas. Não aceitar IP encaminhado sem proxy confiável.

## Carga MySQL medida

Cada visitante fez cadastro, login, conexão SSE autenticada, ideia em análise,
mensagem à equipe e consulta de ideias próprias e conversa. Sessões independentes,
mesmo IP real. 7 requisições medidas por visitante, incluindo abertura do stream.
Após as ações, os streams permaneceram abertos por mais 3 s. Não houve reset;
cada cenário acumulou dados sintéticos. Não é um teste de longa duração.

| Visitantes | HTTP | Erros | Fluxos completos | p50 | p95 | Máximo | Pico RSS Node |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 70 | 0 | 10 | 0,715 s | 2,338 s | 3,245 s | 227,5 MiB |
| 25 | 175 | 0 | 25 | 1,410 s | 5,425 s | 6,490 s | 259,7 MiB |
| 50 | 350 | 0 | 50 | 3,770 s | 12,467 s | 13,680 s | 320,3 MiB |

Antes de retirar scrypt da região de escrita, os p95 eram 5,02 / 14,54 / 28,30 s
para 10/25/50, já com gravação diferencial. Comparação indicativa: a base acumulou
dados e a máquina é compartilhada; não é benchmark com fixture idêntica.

| Visitantes | SSE abertas/prontas | Frames changes | Duplicados/falhas SSE | CPU Node* | Event loop p95 | Transação p95 |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 10/10 | 19 | 0/0 | 99,9% | 53,7 ms | 1,277 s |
| 25 | 25/25 | 45 | 0/0 | 142,6% | 61,2 ms | 1,507 s |
| 50 | 50/50 | 95 | 0/0 | 146,0% | 82,7 ms | 3,923 s |

*CPU do processo Node expressa em equivalentes de um núcleo, podendo ultrapassar
100%. Máquina Windows com 8 CPUs lógicas e 31,93 GiB. Não medimos CPU/RSS do serviço
MySQL, consumo de cada navegador ou recursos de uma máquina de hospedagem.

As bases de cada cenário começaram com 149/159/184 usuários e 119/129/154 ideias.
Ao todo, a execução final acrescentou 85 usuários, 85 ideias e 85 mensagens de
atendimento; nenhum registro anterior divergiu. As sessões de cadastro e login
também foram persistidas. O p95 de login foi 3,245 / 6,146 / 13,427 s.
As demais ações sob 50 visitantes tiveram p95 próximo de 3,9–4,0 s.

Evidências locais ignoradas pelo Git em `renolink_funcional/data/runtime/`:
`phase8-load-baseline.json`, `phase8-load-after-diff.json`, `phase8-load-final.json`.
Incluem contagens, tempos por rota, recursos, SSE e comparação dos registros antigos;
não incluem senhas, cookies ou corpos de mensagens.

## Segurança e testes

- `npm.cmd test`: 34 testes aprovados, incluindo isolamento, CSRF, arquivo público
  permitido, sessões/cookies, abuso, validações, concorrência e transações.
- Testes novos comprovam recuperação do cliente SSE após falha de leitura e erro
  terminal; autenticação preparada recusa prova se ID, hash ou salt mudar.
- Regressão MySQL Fase 5: fluxos administrativos e de visitantes, aprovação/rejeição,
  atendimento, negociações, auditoria, bloqueio de acesso indevido e persistência
  após iniciar outro processo Node.
- Teste MySQL Fase 8: UPDATE seguido de violação real de FK, rollback e comparação
  integral do banco; save sem alteração não emite SQL de escrita. A asserção inicial
  do teste foi ajustada para os códigos FK 1216/1452 com SQLSTATE 23000 retornados
  pelo servidor/driver, mantendo a exigência de violação FK e igualdade dos dados.
- Consulta `npm audit --omit=dev --json`: zero vulnerabilidades conhecidas nas
  dependências de produção consultadas. Não substitui pentest.
- SSE usa cookie HttpOnly, autorização no backend, escopo por participante e tópicos
  de invalidação, sem conteúdo privado nos frames. Testes de regressão verificam
  visitante sem sessão, origem indevida, papéis, revogação e ausência de duplicação.
- Regressão de navegador SSE, depois da correção do formulário: aprovada com dois
  visitantes e administrador, dois processos Node, mensagens e rascunhos preservados,
  offline/retorno, reinício Node, Last-Event-ID, deduplicação, solicitações,
  negociações, aprovação e rejeição com parecer. Dados anteriores e JSON preservados.

## Navegadores e aparelhos

Chrome 155.0.8059.86 e Opera GX (Chromium reportado 153.0.8010.55), executáveis
instalados, perfis temporários, automação headless Playwright. Cada navegador cobre
34 combinações de página/seção e tamanho: 1366×900 e 390×900, além de navegação
tablet 850×900. Portal público, cadastro/login, painel do visitante, envio de ideia,
mensagens, negociações e seis seções administrativas.

Verificados menus, formulários obrigatórios, preservação de campos em HTTP 503,
mensagem amigável no painel, resposta fora de ordem, rótulos tablet, ausência de
erros JavaScript e de overflow da página. Tabelas continuam com rolagem interna.
Relatório e screenshots: `phase8-mobile-report.json` e `phase8-mobile/` no runtime.

**Nenhum aparelho físico foi testado.** Pendentes: Chrome/Opera Android, Safari
iPhone, teclado virtual, toque, rotação, zoom/acessibilidade, aba em segundo plano,
rede móvel instável e QR Code no local. Emulação de viewport não comprova esses casos.

## Riscos restantes e preparação

1. Leitura integral do banco e lock global por transação ainda limitam concorrência.
   Próximo passo: repositórios com consultas específicas/paginação e menor região de
   lock, mantendo atomicidade; repetir carga antes de prometer 50 usuários fluidos.
2. Rajadas de hashing ainda consomem CPU/memória. Não reduzir scrypt para mascarar
   latência. Medir duração prolongada e capacidade em infraestrutura real.
3. Reconexão e privacidade foram testadas localmente; HTTPS/proxy, reinício automático,
   quotas compartilhadas, múltiplos processos e perda prolongada de MySQL exigem ensaio.
4. Fontes/ícones externos, internet e energia do estande são dependências operacionais.
5. Política de backups hospedados, restauração, monitoramento e privacidade precisam
   de implantação e validação. Nenhum serviço externo foi criado.

Plano de infraestrutura, segredos, HTTPS/SSE, backups, recuperação, domínio/QR Code,
critérios de aprovação e checklist: [HOSPEDAGEM_FEIRA.md](HOSPEDAGEM_FEIRA.md).

## Preservação do ambiente principal

A comparação somente de leitura em `phase8-dev-before.json` e
`phase8-dev-after.json` confirmou `unchanged: true`: mesmos hashes de estado,
schema e equipe. Contagens antes/depois: 6 usuários, 10 ideias, 7 mensagens legadas,
1 negociação, 4 sessões, 1 membro de equipe, 1 conversa, 1 mensagem de atendimento,
0 solicitações e 3 eventos de auditoria. Estes são os registros encontrados no
início desta fase, incluindo os acréscimos de fases anteriores.

JSON original e operacional conservaram SHA-256
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.
Não houve mudança de contas, privilégios, arquivos JSON ou registros de outros bancos.

## Execução e arquivos

No diretório `renolink_funcional`, usar `powershell.exe -NoProfile -ExecutionPolicy
Bypass -File scripts/test-phase8.ps1 -Mode Load`, `-Mode Mobile` ou `-Mode Functional`.
O Bypass vale somente para esse processo, sem mudar a política global. Credenciais
são descriptografadas do cofre DPAPI local para o ambiente temporário e restauradas
ao sair. Os scripts recusam banco/conta de teste inesperados. Nunca imprimir o cofre.
Também disponíveis `npm.cmd run test:phase8:load` e `test:phase8:mobile`.

Arquivos de implementação alterados: `lib/mysql.js`, `lib/security.js`, `server.js`,
`lib/phase5.js`, `assets/js/app.js`, `assets/js/admin.js`, `assets/js/realtime.js`,
`assets/css/style.css`, `assets/css/phase5.css`, `mensagens.html`. Testes/execução: `package.json`,
`test/security.test.js`, `test/realtime-client.test.js`, `test/app-client.test.js`, `test/phase8.load.js`,
`test/fixtures/load-server.js`, `test/phase8.mobile.js`, `test/phase8.mysql.test.js`,
`scripts/test-phase8.ps1`, `scripts/phase7-dev-snapshot.js`, e os dois relatórios
em `auditoria/`. Nenhum SQL de migração foi criado ou aplicado.

As correções de backend são validadas em processos isolados. O processo da aplicação
principal não foi reiniciado nesta fase; carregará o novo backend no próximo início
normal por `INICIAR_RENOLINK.bat`. Não reiniciamos MYSQL80 nem expusemos nova porta
pública. Para abas abertas, recarregar a página após o reinício do Node.
