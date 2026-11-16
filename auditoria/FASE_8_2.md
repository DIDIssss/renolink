# RenoLink — Fase 8.2: otimização estrutural do backend

Data da solicitação e validação: 30/10/2026, America/Sao_Paulo. As evidências também contêm carimbos UTC.

## Resultado

Evolução incremental da persistência implementada e validada em ambiente isolado. Navegação, ideias, atendimento e consulta de negociações deixaram de depender do estado completo para os caminhos priorizados. Autenticação continua sendo o principal limitador da experiência na rajada de 50 visitantes. **Não está demonstrada boa experiência global para 50 visitantes**, nem capacidade sustentada para uma feira inteira.

45 testes locais aprovados, além das regressões reais MySQL, paridade com 8.1, concorrência, rollback, persistência e SSE. Não houve reset, DDL, novos índices, mudanças de privilégios, administradores reais, credenciais, publicação ou gravações em renolink_dev.

## 1. Diagnóstico e ponto de partida

A versão 8.1 executava mysqlStore.transaction ou mysqlStore.read para quase toda API. Ambos chamavam lib/mysql.js:loadSnapshot: um SELECT de metadados e um UNION ALL com dez coleções completas. Escritas ainda clonavam, validavam e comparavam o grafo inteiro antes de salvar diferenças. A fila local compartilhava essas operações completas, inclusive leituras e SSE.

Somente o lookup de credenciais já era específico, pelo índice email_normalized. Retirar serializações na fase anterior não eliminava a transferência e a materialização do restante do banco. O scan SSE em lib/realtime.js também usava store.read: toda a base era carregada mesmo com poucos participantes.

Na rodada final, com 50 visitantes, espera pela fila de estado teve p95 de **3891,70 ms** antes e **153,15 ms** depois. Espera pelo pool: **0,43 / 0,32 ms**. Portanto, aumentar conexões não era a correção sustentada pela evidência: havia principalmente trabalho excessivo e espera pela fila de estado.

O tempo observado de SQL inclui o await do driver, rede local e agendamento no Node; não é CPU exclusiva do MySQL. EXPLAIN e EXPLAIN ANALYZE de SELECTs foram coletados, sem habilitar logs ou alterar parâmetros globais. Lookup de sessão usa PRIMARY, credenciais users_email_uq, ideias ideas_owner_idx, conversa o índice único visitor_id, mensagens support_conversation_date_idx e negociações negotiations_creator_idx. Há filesort nas ordenações de ideias e mensagens, mas nas amostras pequenas e indexadas; isso não justifica adicionar índices nesta fase.

## 2. Evolução implementada

Novo módulo lib/mysql-scopes.js seleciona um conjunto de trabalho específico por operação, com dados e IDs parametrizados. Antes de reutilizar o handler existente, carrega também o fechamento das referências: autores, participantes, remetentes, conversas e membros de equipe necessários ao validador. Cada linha alterável conserva todos os seus campos e extras JSON. Não são inventados usuários nem removidos relacionamentos para satisfazer validações.

O mesmo validador permanece aplicado ao conjunto relacionado; unicidade e integridade globais continuam garantidas pelos índices/constraints existentes. A integridade global foi conferida separadamente após as cargas. Isso substitui a validação reiterada de registros não envolvidos por seleção relacionada e constraints, sem desativar FKs ou reduzir autorização.

| Caminho | Seleção atual |
|---|---|
| Cadastro e login, inclusive administrativo | E-mail normalizado; registro atual e equipe necessária; prova de senha revalidada na escrita |
| Sessão, logout e logout-all | Token do cookie; sessões do usuário para revogação em lote |
| Listagem e detalhe de ideias | Autor autenticado, status público ou ID; relacionamentos das ideias selecionadas |
| Criação/edição de ideia, interesse e revisão | Sessão, alvo e referências; apenas linhas alteradas e metadados são escritos |
| Atendimento do visitante e mensagens legadas | Visitante/conversa/participantes; remetentes e equipe relacionados |
| Solicitações e negociações do visitante | Participante autenticado e ideias referenciadas |
| Resumos do portal | União dos escopos necessários no mesmo snapshot |
| Estatísticas públicas | COUNTs SQL em vez de coleções completas; resposta comparada com 8.1 |
| SSE de visitantes | Lote de sessões e usuários ativos; ideias públicas/próprias e relacionamentos autorizados |
| Listas administrativas, atendimento administrativo e SSE com equipe | Fallback integral mantido, exceto login e revisão já direcionados |
| Inicialização, auditoria global, migração e callbacks genéricos | Caminho integral preservado |

Leituras direcionadas são concorrentes no pool de cinco conexões e usam REPEATABLE READ, READ ONLY. Escritas continuam com fila limitada e GET_LOCK entre processos, IDs globais no JSON de metadados, transação, commit/rollback e save diferencial. O lock não foi removido para obter ganho. Não há cache de sessões/permissões entre requisições; a eliminação de consultas repetidas de equipe vale somente dentro do mesmo snapshot.

Listagem de ideias aceita limit de 1 a 100 e offset de 0 a 100000, validados antes de formar o limite SQL. Filtros usam parâmetros. Sem esses parâmetros, o contrato anterior continua retornando todas as ideias autorizadas, sem truncar contadores ou dados silenciosamente. A UI não foi reescrita para paginação obrigatória.

Os handlers existentes continuam decidindo autorização e status; o carregador não transforma uma URL com userId/role em permissão. Testes com visitante, empresa, administrador, suporte e anônimo comparam respostas inteiras ao backend 8.1. IDs fora da faixa segura não são enviados como números inválidos ao MySQL.

## 3. Corrida SSE encontrada e corrigida

O carregamento filtrado revelou uma condição antes mascarada pelo estado integral: uma conexão adicionada enquanto um scan aguardava SQL podia entrar na lista processada sem estar no lote de sessões consultado. Isso causava falsa expiração e encerramento do stream, sem perda dos registros no banco.

O teste determinístico realtime-scoped.test.js reproduziu a queda de duas conexões para uma. O scan agora captura um único lote e usa exatamente os mesmos participantes na consulta e no processamento. O teste passou após a correção. Não foram suprimidas verificações de expiração ou revogação.

O gerador de carga também passou a considerar encerramento limpo inesperado de stream como falha, além de erros de leitura. A primeira rodada foi preservada como diagnóstico e **não é a evidência final de estabilidade**. O comparativo abaixo é a segunda rodada completa, com essa verificação reforçada, nos dois backends. Reconexão nativa, Last-Event-ID, deduplicação e reinício de processo Node foram validados separadamente no navegador.

## 4. Método do comparativo final

- Mesma máquina: Intel(R) Core(TM) i7-7700 CPU @ 3.60GHz, 8 CPUs lógicas, 31,93 GiB RAM; Node v24.19.0, MySQL 8.0.46, loopback.
- Mesmo pool configurado para cinco conexões e mesmo scrypt com quatro workers. Mesmos limites de abuso, sem forjar IP ou desativar proteções.
- Mesma distribuição: cadastro, login, abertura SSE, criação de ideia, primeiro atendimento, leitura de ideias próprias, leitura de mensagens e consulta de negociações. Oito operações por visitante: 80/200/400 requisições.
- Uma rajada por cenário, janela nominal de 60 s com observação dos streams até o fim. Cada cenário usa processo Node novo; o banco é acumulado sem reset nos dois lados.
- A rodada final começou em cada lado com 399 usuários, 305 ideias, 666 sessões e 309 mensagens de atendimento. Cenários seguintes começam com os mesmos acréscimos de 10 e 35 visitantes em ambos os lados.
- Foram reutilizadas duas estruturas vazias preexistentes de renolink_test, com PK/FK/CHECK/índices conferidos. Nenhum CREATE, ALTER, DROP, TRUNCATE ou DELETE foi necessário. A segunda rodada reutilizou o mesmo par já preenchido, sem mudar registros anteriores.
- Integridade e equivalência são verificações distintas: registros anteriores são comparados campo a campo, incluindo IDs e conteúdo, em cada lado. Para comparar workloads, somente novos IDs de conclusão concorrente, lotes aleatórios, salts/hashes e timestamps sintéticos são canonizados por visitante/coorte em memória. IDs reais nunca são remapeados no banco; os contadores avançam conforme as novas gravações.

O comparador inicialmente identificava diferenças legítimas de ordem de alocação de IDs e tokens de sessão. Foi corrigido para representar a identidade do visitante sintético; nenhuma validação real de registro/relacionamento foi relaxada. A etapa já concluída não foi repetida no primeiro ensaio interrompido. Seus arquivos de diagnóstico e after-interrupted.json foram preservados. A rodada final foi executada completa e independentemente dessa retomada.

Os resultados históricos 1,49/3,32/6,84 s não são o baseline abaixo: variam quantidade de dados, distribuição e momento da medição. A comparação usa nova referência congelada 8.1 sob as mesmas condições da rodada final.

## 5. Resultados gerais

Latências em segundos; percentis empíricos, sem interpolação.

| Visitantes | p50 antes/final | p95 antes/final | p99 antes/final | Erros antes/final |
|---:|---:|---:|---:|---:|
| 10 | 0,638 / 0,059 | 1,280 / 1,186 | 1,324 / 1,396 | 0 / 0 |
| 25 | 1,656 / 0,053 | 3,788 / 3,276 | 4,465 / 3,430 | 0 / 0 |
| 50 | 3,138 / 0,034 | 6,448 / 5,276 | 7,629 / 5,624 | 0 / 0 |

O p99 de 10 visitantes não melhorou: há variabilidade e custo criptográfico, não um ganho uniforme em todos os percentis. Não resumimos a experiência pelo p50 agregado, dominado pelas rotas rápidas de navegação.

| Visitantes | RPS na janela, ambos | RPS ativo antes/final | CPU Node antes/final | Pico RSS antes/final | SQL antes/final | Linhas SQL antes/final |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1,33 | 13,78 / 29,97 | 21,7% / 13,5% | 218,2 / 198,8 MiB | 1249 / 2295 | 315841 / 7855 |
| 25 | 3,33 | 13,97 / 30,12 | 45,9% / 33,0% | 256,1 / 206,8 MiB | 2446 / 4250 | 601675 / 16024 |
| 50 | 6,67 | 13,70 / 37,13 | 85,3% / 62,0% | 260,9 / 225,0 MiB | 4409 / 7351 | 1149204 / 30626 |

CPU é média do processo Node na janela inteira, em equivalentes de um núcleo; não é CPU total da máquina ou pico de utilização. RSS foi amostrado a cada 100 ms. RPS ativo divide as requisições pelo tempo para concluir a rajada; RPS da janela divide por 60 s. Não são limites de capacidade sustentada. O número oferecido de operações é igual, logo o RPS da janela é igual.

SQL inclui controle de transação, SETs, versões e locks, além das consultas de negócio. Linhas retornadas incluem linhas de controle/metadados. O total SQL aumentou, mas as linhas transferidas caíram: trocar duas consultas gigantes por filtros menores não exige que a quantidade de comandos diminua. CPU/RSS do daemon MySQL e IO total não foram medidos; não atribuímos toda melhoria ao motor SQL.

Conexões físicas efetivamente usadas com 50 visitantes: 2 antes e 5 depois, mantendo limite cinco. O p95 de espera por conexão final foi 0,32 ms; não é o gargalo principal medido.

### Por operação — milissegundos

| Visitantes | Operação | p50 antes/final (ms) | p95 antes/final (ms) | p99 antes/final (ms) | SQL/op antes/final |
|---:|---|---:|---:|---:|---:|
| 10 | Cadastro | 966,27 / 769,91 | 1324,22 / 1155,92 | 1324,22 / 1155,92 | 14 / 14 |
| 10 | Login | 1076,99 / 1134,29 | 1304,89 / 1396,09 | 1304,89 / 1396,09 | 14 / 15 |
| 10 | Listar ideias próprias | 633,51 / 25,35 | 881,84 / 88,42 | 881,84 / 88,42 | 7 / 11 |
| 10 | Criar ideia | 641,55 / 78,97 | 701,69 / 103,72 | 701,69 / 103,72 | 13 / 15 |
| 10 | Enviar atendimento | 619,35 / 98,87 | 906,62 / 119,05 | 906,62 / 119,05 | 14 / 17 |
| 10 | Ler mensagens | 641,55 / 28,54 | 879,52 / 35,32 | 879,52 / 35,32 | 7 / 11 |
| 10 | Consultar negociações | 385,81 / 24,18 | 883,12 / 31,28 | 883,12 / 31,28 | 7 / 10 |
| 10 | Abrir SSE | 618,04 / 59,44 | 680,88 / 75,87 | 680,88 / 75,87 | 7 / 15 |
| 25 | Cadastro | 1691,34 / 1929,74 | 2690,25 / 2936,65 | 2784,34 / 3114,28 | 14 / 14 |
| 25 | Login | 3212,19 / 3154,15 | 4465,10 / 3430,36 | 4497,81 / 3482,66 | 14 / 15 |
| 25 | Listar ideias próprias | 1321,51 / 24,88 | 2263,97 / 56,45 | 2314,35 / 68,20 | 7 / 11 |
| 25 | Criar ideia | 1724,16 / 83,06 | 2098,55 / 172,63 | 2119,20 / 225,32 | 13 / 15 |
| 25 | Enviar atendimento | 1648,21 / 95,06 | 2121,97 / 171,85 | 2347,27 / 238,18 | 14 / 17 |
| 25 | Ler mensagens | 1028,94 / 22,25 | 1754,96 / 60,87 | 2069,93 / 93,78 | 7 / 11 |
| 25 | Consultar negociações | 738,05 / 24,13 | 1719,44 / 63,60 | 1754,06 / 67,22 | 7 / 10 |
| 25 | Abrir SSE | 1759,34 / 38,64 | 2270,39 / 84,89 | 2295,62 / 91,07 | 7 / 15 |
| 50 | Cadastro | 3472,45 / 2661,95 | 5851,65 / 4664,71 | 6039,35 / 4913,90 | 14 / 14 |
| 50 | Login | 6170,42 / 5217,42 | 7698,12 / 5648,87 | 7802,35 / 5666,88 | 14 / 15 |
| 50 | Listar ideias próprias | 3018,57 / 19,96 | 3385,80 / 47,12 | 3426,81 / 51,85 | 7 / 11 |
| 50 | Criar ideia | 3342,58 / 43,44 | 4287,63 / 156,75 | 4337,23 / 199,15 | 13 / 15 |
| 50 | Enviar atendimento | 3265,14 / 49,98 | 3934,67 / 223,29 | 4063,84 / 282,15 | 14 / 17 |
| 50 | Ler mensagens | 2648,15 / 17,99 | 3326,82 / 44,73 | 3342,57 / 54,39 | 7 / 11 |
| 50 | Consultar negociações | 2084,66 / 15,89 | 2869,55 / 39,48 | 2934,03 / 57,47 | 7 / 10 |
| 50 | Abrir SSE | 3395,97 / 23,89 | 4198,80 / 72,84 | 4266,90 / 81,78 | 7 / 15 |

SQL/op é contagem observada no servidor, incluindo controle e lookup prévio de credenciais; não inclui os scans SSE de fundo. Os tempos da tabela são do cliente HTTP. SQL await, autenticação e callback são spans aninhados: não podem ser somados como se fossem CPU exclusiva. CSV detalhado: [operacoes.csv](../renolink_funcional/data/runtime/phase82-reproducibilidade/operacoes.csv).

Criação/alteração de negociações, interesse e solicitações foram validadas funcionalmente; na carga, a operação de negociações é consulta. O cenário mede visitantes criadores e seus primeiros atendimentos, não respostas administrativas sob 50 sessões simultâneas.

### Etapas internas com 50 visitantes

| Etapa, p95 em ms | Antes | Final |
|---|---:|---:|
| Fila local de estado | 3891,70 | 153,15 |
| Espera por conexão | 0,43 | 0,32 |
| Espera por GET_LOCK | 0,55 | 1,97 |
| Carregamento para escrita | 61,32 | 14,43 |
| Cópia inicial | 7,45 | 0,12 |
| Validar/diff/salvar | 19,89 | 6,52 |
| Scan SSE completo, incluindo espera | 3275,27 | 65,29 |
| Chamada scrypt, incluindo fila | 4526,51 | 5459,57 |

Decode e validação síncrona do escopo foram instrumentados separadamente. Seus p95 finais foram 0,48 e 0,50 ms por chamada instrumentada. Handler de escrita e readHandler também são medidos; o campo handler por rota GET não foi instrumentado individualmente e não significa custo zero de JavaScript. O event loop p95, com resolução 20 ms, foi 47,55 / 33,00 ms.

## 6. Hashing e paralelismo

scrypt já é assíncrono, usando crypto.scrypt e o pool libuv. Cadastro e verificação ocorrem fora da transação; a prova é conferida novamente com hash, salt e ID atuais antes de emitir sessão. O rehash de contas legadas ainda pode acontecer dentro do handler transacional, caminho raro não representado pelas contas novas da carga. Não se deve generalizar o perfil das contas novas a esse caminho.

Experimento isolado, sem consultas MySQL, com 50 hashes e parâmetros inalterados N=32768, r=8, p=3:

| Workers | Tempo da rajada | p95 por chamada | CPU acumulada | Pico RSS | Compatibilidade |
|---:|---:|---:|---:|---:|---|
| 4 | 4,230 s | 4,009 s | 13922,00 ms | 170,04 MiB | senha válida, errada e legado verificados |
| 8 | 3,131 s | 3,074 s | 16048,00 ms | 297,79 MiB | senha válida, errada e legado verificados |

Oito workers melhoraram a latência desse diagnóstico, mas elevaram memória e CPU acumulada. **Não foram ativados na aplicação ou no comparativo**. Antes de adotar, é necessário medir a aplicação inteira, orçamento de memória, carga simultânea e controle de admissão de hashes. Não houve redução de custo criptográfico nem troca de algoritmo.

## 7. Critérios funcionais e segurança

- 45 testes locais aprovados, incluindo os novos testes de escopo, paginação segura, identidade via cookie e corrida SSE.
- Regressão MySQL real aprovada: respostas de 8.1/8.2 comparadas em 16 rotas e cinco contextos (quatro papéis e anônimo), inclusive casos privados, estatísticas públicas, IDs extremos e paginação.
- Vinte criações concorrentes entre backend antigo e novo preservaram IDs únicos. A falha injetada depois do INSERT e UPDATE de metadados causou rollback integral; HTTP 500 genérico era esperado nesse teste, sem detalhes SQL/credenciais na resposta.
- Regressão Fase 5 aprovada com cadastro/login, moderação, conversas, solicitações, negociações, auditoria, bloqueio de acesso e persistência em outro processo.
- Navegador Chrome, dois visitantes e administrador em contextos separados e dois processos Node: atualização privada/pública, mensagens e rascunhos, aprovação/rejeição, mudanças de negociação, offline, reinício Node, replay e ausência de duplicações aprovados após a correção SSE. Inclui viewport móvel emulada; nenhum aparelho físico foi testado.
- Na rodada final, 10/25/50 streams abriram e ficaram prontos. Zero IDs de mudança duplicados e zero encerramentos inesperados/erros de stream em todos os cenários. Frames de mudança finais: 19/48/93; são invalidações agrupadas, não um frame obrigatório por gravação.
- Cada lado da rodada final acrescentou exatamente 85 usuários, 85 ideias, 85 conversas, 85 mensagens de atendimento e 170 sessões, sem perda ou duplicação e mantendo todos os registros anteriores. Autoria, conversa/remetente, status inicial e duas sessões por visitante foram conferidos no MySQL.

Autorização continua no backend, com cookie HttpOnly, verificações de origem e validação por papel. Não há promoção pública a administrador, cache persistente de privilégios nem exposição de eventos privados a outros visitantes.

## 8. Preservação e estado operacional

O snapshot final de renolink_dev confirmou unchanged=true para estado, schema e equipe. Contagens preservadas: users=8, ideas=11, negotiations=1, messages=7, sessions=9, staff=1, conversations=2, supportMessages=3, requests=1, audit=9. Hash de estado: 1b720d9cd3717a4671a23ed83c342e4e9492b9052058422f0f25c058bdc03baf. JSONs originais não foram alterados; hashes conferidos nos testes e na verificação final.

Escritas ficaram em renolink_test. Não foram criados administradores reais, alteradas credenciais/permissões, reiniciados MYSQL80 ou publicados serviços. O processo operacional Node não foi reiniciado; carregará o backend novo no próximo início normal. Não houve alteração de arquivos de outros projetos.

## 9. Reprodutibilidade e evidências

Rodada final: renolink_funcional/data/runtime/phase82-reproducibilidade/ — manifest.json, before.json, after.json, integrity.json, implementation.json, explain.json e operacoes.csv. O baseline congelado é test/fixtures/phase82-baseline-mysql.js; hashes do código final ficam em implementation.json. Rodada diagnóstica inicial preservada em phase82/, incluindo hash.json para o experimento de workers.

Os arquivos de runtime são ignorados pelo Git e não são servidos pelo HTTP. Não contêm senhas, cookies, parâmetros de credenciais ou conteúdo de mensagens. A canonização produz apenas hashes lógicos; não substitui os checks reais de registros. Os dados de teste foram mantidos, sem limpeza destrutiva.

Nova rodada, sem reset ou DDL, pode reutilizar o par já existente com outro identificador. A base terá crescido; os dois lados continuam equivalentes na nova rodada. Não se promete reproduzir o mesmo número de milissegundos ou a fixture histórica menor:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase82.ps1 -Mode Prepare -RunId nova-rodada -ReuseFrom reproducibilidade
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase82.ps1 -Mode Before -RunId nova-rodada
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase82.ps1 -Mode After -RunId nova-rodada
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase82.ps1 -Mode Verify -RunId nova-rodada

Executar somente uma rodada por vez no par. Preparação e resultados existentes são protegidos contra sobrescrita; dados antigos são preservados. Credenciais vêm do cofre DPAPI para ambiente temporário, restaurado no fim. Se não houver estruturas disponíveis, o runner interrompe: qualquer nova estrutura ou índice requer plano e autorização antes de execução. Não usar o banco/conta de desenvolvimento no runner.

## 10. Limitações e hospedagem

O ganho de navegação não elimina a fila de scrypt: cadastro/login continuam em segundos sob a rajada de 50. As listas administrativas e SSE com equipe ainda podem materializar a base completa. A paginação é opcional para preservar o contrato existente; adotar paginação na UI e DTOs administrativos é trabalho futuro. Não foi medida carga prolongada com administrador ativo junto aos 50 visitantes.

Uma observação por tamanho/variante, host Windows compartilhado, gerador e banco na mesma máquina, cache aquecido e janelas curtas não equivalem à internet ou capacidade sustentada. Não medimos CPU/IO do MySQL. A maior quantidade de comandos curtos pode se comportar de outra forma com RTT de nuvem; homologar Node e MySQL na mesma rede privada e medir TLS/proxy/SSE, CPU, memória, pool, falhas e recuperação.

Antes de hospedar: avaliar oito workers com memória dimensionada e carga completa; manter parâmetros criptográficos e adicionar admissão/backpressure segura para rajadas. Validar cotas por IP atrás de proxy confiável, sem confiar em X-Forwarded-For arbitrário. Continuam necessários HTTPS, segredos fora do código, backup/restauração, monitoramento e teste em aparelhos físicos. Nenhum serviço foi contratado.

Não há evidência atual para aplicar novos índices: os principais filtros já usam índices existentes e as ordenações pequenas não dominam a medição. Se volume real justificar índices compostos, apresentar EXPLAIN, desenho, impacto, backup e plano de aplicação separado antes de alterar schema/permissões. Para o restante do backend, evoluir listas administrativas e agregados específicos, mantendo os handlers/contratos, em vez de reescrever toda a aplicação.

## Arquivos principais

Aplicação: lib/mysql-scopes.js (novo), lib/mysql.js, server.js e lib/realtime.js. Instrumentação/reprodução: scripts/test-phase82.ps1, scripts/phase82-benchmark.js, scripts/phase82-report.js, scripts/phase7-dev-snapshot.js, test/phase8.load.js e test/fixtures/phase81-pool.js. Referência e testes: test/fixtures/phase82-*.js, test/phase82.mysql.test.js, test/mysql.scopes.test.js, test/realtime-scoped.test.js e package.json. Nenhum SQL de migração foi criado, nem foram modificados iniciadores, JSONs ou configurações de outros projetos.
