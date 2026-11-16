'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'data/runtime/phase82-reproducibilidade'),read=name=>JSON.parse(fs.readFileSync(path.join(directory,name)));
const before=read('before.json'),after=read('after.json'),manifest=read('manifest.json'),integrity=read('integrity.json');
const dev=JSON.parse(fs.readFileSync(path.join(root,'data/runtime/phase82-dev-after.json'))),hash=JSON.parse(fs.readFileSync(path.join(root,'data/runtime/phase82/hash.json')));
assert.equal(integrity.status,'passed');assert.equal(dev.unchanged,true);assert.equal(before.cases.length,3);assert.equal(after.cases.length,3);
const number=(value,digits=2)=>Number(value).toFixed(digits).replace('.',','),seconds=value=>number(value/1000,3),range=value=>value.min===value.max?String(value.min):`${value.min}–${value.max}`;
const operations=[['Cadastro','/api/auth/register','POST /api/auth/register'],['Login','/api/auth/login','POST /api/auth/login'],['Listar ideias próprias','/api/ideas?mine=1','GET /api/ideas'],['Criar ideia','/api/ideas','POST /api/ideas'],['Enviar atendimento','/api/team/conversations','POST /api/team/conversations'],['Ler mensagens','/api/team/conversations/:id/messages','GET /api/team/conversations/:id/messages'],['Consultar negociações','/api/negotiations','GET /api/negotiations'],['Abrir SSE','/api/events','GET /api/events']];
let general='| Visitantes | p50 antes/final | p95 antes/final | p99 antes/final | Erros antes/final |\n|---:|---:|---:|---:|---:|\n',resources='| Visitantes | RPS na janela, ambos | RPS ativo antes/final | CPU Node antes/final | Pico RSS antes/final | SQL antes/final | Linhas SQL antes/final |\n|---:|---:|---:|---:|---:|---:|---:|\n',details='| Visitantes | Operação | p50 antes/final (ms) | p95 antes/final (ms) | p99 antes/final (ms) | SQL/op antes/final |\n|---:|---|---:|---:|---:|---:|\n';
const csv=[['variant','visitors','operation','route','count','p50_ms','p95_ms','p99_ms','window_rps','sql_min','sql_max','sql_total','rows_returned','sql_await_p95_ms','auth_await_p95_ms','write_handler_p95_ms','errors'].join(',')];
for(let i=0;i<3;i++){
 const a=before.cases[i],b=after.cases[i];for(const c of [a,b]){assert.equal(c.errors,0);assert.equal(c.oldRowsPreserved,true);assert.equal(c.verifiedFlows,c.virtualUsers);assert.equal(c.sse.failures,0);assert.equal(c.sse.duplicateFrames,0);}
 general+=`| ${a.virtualUsers} | ${seconds(a.http.p50Ms)} / ${seconds(b.http.p50Ms)} | ${seconds(a.http.p95Ms)} / ${seconds(b.http.p95Ms)} | ${seconds(a.http.p99Ms)} / ${seconds(b.http.p99Ms)} | 0 / 0 |\n`;
 resources+=`| ${a.virtualUsers} | ${number(a.windowRps)} | ${number(a.activeRps)} / ${number(b.activeRps)} | ${number(a.resources.cpuOneCorePercent,1)}% / ${number(b.resources.cpuOneCorePercent,1)}% | ${number(a.resources.peakRssMiB,1)} / ${number(b.resources.peakRssMiB,1)} MiB | ${a.resources.sqlCount} / ${b.resources.sqlCount} | ${a.resources.rowsReturned} / ${b.resources.rowsReturned} |\n`;
 for(const [label,route,key]of operations){const x=a.routes[route],y=b.routes[route],u=a.resources.operations[key],v=b.resources.operations[key];details+=`| ${a.virtualUsers} | ${label} | ${number(x.p50Ms)} / ${number(y.p50Ms)} | ${number(x.p95Ms)} / ${number(y.p95Ms)} | ${number(x.p99Ms)} / ${number(y.p99Ms)} | ${range(u.sqlCount)} / ${range(v.sqlCount)} |\n`;
  for(const [variant,c,m,op]of [['before',a,x,u],['after',b,y,v]])csv.push([variant,c.virtualUsers,label,route,m.count,m.p50Ms,m.p95Ms,m.p99Ms,m.count/60,op.sqlCount.min,op.sqlCount.max,op.sqlCount.total,op.rowsTotal,op.sql.p95Ms,op.auth.p95Ms,key.startsWith('POST')?op.handler.p95Ms:'',0].map(value=>JSON.stringify(value)).join(','));
 }
}
fs.writeFileSync(path.join(directory,'operacoes.csv'),csv.join('\n')+'\n');
const a=before.cases[2],b=after.cases[2],p95=key=>number(b.resources.stages[key]?.p95Ms||0),before95=key=>number(a.resources.stages[key]?.p95Ms||0);
const text=`# RenoLink — Fase 8.2: otimização estrutural do backend

Data da solicitação e validação: 30/10/2026, America/Sao_Paulo. As evidências também contêm carimbos UTC.

## Resultado

Evolução incremental da persistência implementada e validada em ambiente isolado. Navegação, ideias, atendimento e consulta de negociações deixaram de depender do estado completo para os caminhos priorizados. Autenticação continua sendo o principal limitador da experiência na rajada de 50 visitantes. **Não está demonstrada boa experiência global para 50 visitantes**, nem capacidade sustentada para uma feira inteira.

45 testes locais aprovados, além das regressões reais MySQL, paridade com 8.1, concorrência, rollback, persistência e SSE. Não houve reset, DDL, novos índices, mudanças de privilégios, administradores reais, credenciais, publicação ou gravações em renolink_dev.

## 1. Diagnóstico e ponto de partida

A versão 8.1 executava mysqlStore.transaction ou mysqlStore.read para quase toda API. Ambos chamavam lib/mysql.js:loadSnapshot: um SELECT de metadados e um UNION ALL com dez coleções completas. Escritas ainda clonavam, validavam e comparavam o grafo inteiro antes de salvar diferenças. A fila local compartilhava essas operações completas, inclusive leituras e SSE.

Somente o lookup de credenciais já era específico, pelo índice email_normalized. Retirar serializações na fase anterior não eliminava a transferência e a materialização do restante do banco. O scan SSE em lib/realtime.js também usava store.read: toda a base era carregada mesmo com poucos participantes.

Na rodada final, com 50 visitantes, espera pela fila de estado teve p95 de **${before95('stateQueue')} ms** antes e **${p95('stateQueue')} ms** depois. Espera pelo pool: **${before95('poolWait')} / ${p95('poolWait')} ms**. Portanto, aumentar conexões não era a correção sustentada pela evidência: havia principalmente trabalho excessivo e espera pela fila de estado.

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

- Mesma máquina: ${manifest.host.model}, ${manifest.host.cpus} CPUs lógicas, ${number(manifest.host.memoryGiB)} GiB RAM; Node ${manifest.node}, MySQL ${manifest.configuration.version}, loopback.
- Mesmo pool configurado para cinco conexões e mesmo scrypt com quatro workers. Mesmos limites de abuso, sem forjar IP ou desativar proteções.
- Mesma distribuição: cadastro, login, abertura SSE, criação de ideia, primeiro atendimento, leitura de ideias próprias, leitura de mensagens e consulta de negociações. Oito operações por visitante: 80/200/400 requisições.
- Uma rajada por cenário, janela nominal de 60 s com observação dos streams até o fim. Cada cenário usa processo Node novo; o banco é acumulado sem reset nos dois lados.
- A rodada final começou em cada lado com ${manifest.counts.users} usuários, ${manifest.counts.ideas} ideias, ${manifest.counts.sessions} sessões e ${manifest.counts.supportMessages} mensagens de atendimento. Cenários seguintes começam com os mesmos acréscimos de 10 e 35 visitantes em ambos os lados.
- Foram reutilizadas duas estruturas vazias preexistentes de renolink_test, com PK/FK/CHECK/índices conferidos. Nenhum CREATE, ALTER, DROP, TRUNCATE ou DELETE foi necessário. A segunda rodada reutilizou o mesmo par já preenchido, sem mudar registros anteriores.
- Integridade e equivalência são verificações distintas: registros anteriores são comparados campo a campo, incluindo IDs e conteúdo, em cada lado. Para comparar workloads, somente novos IDs de conclusão concorrente, lotes aleatórios, salts/hashes e timestamps sintéticos são canonizados por visitante/coorte em memória. IDs reais nunca são remapeados no banco; os contadores avançam conforme as novas gravações.

O comparador inicialmente identificava diferenças legítimas de ordem de alocação de IDs e tokens de sessão. Foi corrigido para representar a identidade do visitante sintético; nenhuma validação real de registro/relacionamento foi relaxada. A etapa já concluída não foi repetida no primeiro ensaio interrompido. Seus arquivos de diagnóstico e after-interrupted.json foram preservados. A rodada final foi executada completa e independentemente dessa retomada.

Os resultados históricos 1,49/3,32/6,84 s não são o baseline abaixo: variam quantidade de dados, distribuição e momento da medição. A comparação usa nova referência congelada 8.1 sob as mesmas condições da rodada final.

## 5. Resultados gerais

Latências em segundos; percentis empíricos, sem interpolação.

${general}
O p99 de 10 visitantes não melhorou: há variabilidade e custo criptográfico, não um ganho uniforme em todos os percentis. Não resumimos a experiência pelo p50 agregado, dominado pelas rotas rápidas de navegação.

${resources}
CPU é média do processo Node na janela inteira, em equivalentes de um núcleo; não é CPU total da máquina ou pico de utilização. RSS foi amostrado a cada 100 ms. RPS ativo divide as requisições pelo tempo para concluir a rajada; RPS da janela divide por 60 s. Não são limites de capacidade sustentada. O número oferecido de operações é igual, logo o RPS da janela é igual.

SQL inclui controle de transação, SETs, versões e locks, além das consultas de negócio. Linhas retornadas incluem linhas de controle/metadados. O total SQL aumentou, mas as linhas transferidas caíram: trocar duas consultas gigantes por filtros menores não exige que a quantidade de comandos diminua. CPU/RSS do daemon MySQL e IO total não foram medidos; não atribuímos toda melhoria ao motor SQL.

Conexões físicas efetivamente usadas com 50 visitantes: ${a.resources.mysqlConnections.createdConnections} antes e ${b.resources.mysqlConnections.createdConnections} depois, mantendo limite cinco. O p95 de espera por conexão final foi ${p95('poolWait')} ms; não é o gargalo principal medido.

### Por operação — milissegundos

${details}
SQL/op é contagem observada no servidor, incluindo controle e lookup prévio de credenciais; não inclui os scans SSE de fundo. Os tempos da tabela são do cliente HTTP. SQL await, autenticação e callback são spans aninhados: não podem ser somados como se fossem CPU exclusiva. CSV detalhado: [operacoes.csv](../renolink_funcional/data/runtime/phase82-reproducibilidade/operacoes.csv).

Criação/alteração de negociações, interesse e solicitações foram validadas funcionalmente; na carga, a operação de negociações é consulta. O cenário mede visitantes criadores e seus primeiros atendimentos, não respostas administrativas sob 50 sessões simultâneas.

### Etapas internas com 50 visitantes

| Etapa, p95 em ms | Antes | Final |
|---|---:|---:|
| Fila local de estado | ${before95('stateQueue')} | ${p95('stateQueue')} |
| Espera por conexão | ${before95('poolWait')} | ${p95('poolWait')} |
| Espera por GET_LOCK | ${before95('sql:namedLock')} | ${p95('sql:namedLock')} |
| Carregamento para escrita | ${before95('load')} | ${p95('load')} |
| Cópia inicial | ${before95('cloneFingerprint')} | ${p95('cloneFingerprint')} |
| Validar/diff/salvar | ${before95('validateDiffSave')} | ${p95('validateDiffSave')} |
| Scan SSE completo, incluindo espera | ${before95('sseScan')} | ${p95('sseScan')} |
| Chamada scrypt, incluindo fila | ${before95('scryptWithThreadQueue')} | ${p95('scryptWithThreadQueue')} |

Decode e validação síncrona do escopo foram instrumentados separadamente. Seus p95 finais foram ${p95('scopedDecode')} e ${p95('scopedValidate')} ms por chamada instrumentada. Handler de escrita e readHandler também são medidos; o campo handler por rota GET não foi instrumentado individualmente e não significa custo zero de JavaScript. O event loop p95, com resolução 20 ms, foi ${number(a.resources.eventLoopP95Ms)} / ${number(b.resources.eventLoopP95Ms)} ms.

## 6. Hashing e paralelismo

scrypt já é assíncrono, usando crypto.scrypt e o pool libuv. Cadastro e verificação ocorrem fora da transação; a prova é conferida novamente com hash, salt e ID atuais antes de emitir sessão. O rehash de contas legadas ainda pode acontecer dentro do handler transacional, caminho raro não representado pelas contas novas da carga. Não se deve generalizar o perfil das contas novas a esse caminho.

Experimento isolado, sem consultas MySQL, com 50 hashes e parâmetros inalterados N=32768, r=8, p=3:

| Workers | Tempo da rajada | p95 por chamada | CPU acumulada | Pico RSS | Compatibilidade |
|---:|---:|---:|---:|---:|---|
${hash.map(h=>`| ${h.workers} | ${seconds(h.wallMs)} s | ${seconds(h.calls.p95Ms)} s | ${number(h.cpuMs)} ms | ${number(h.peakRssMiB)} MiB | senha válida, errada e legado verificados |`).join('\n')}

Oito workers melhoraram a latência desse diagnóstico, mas elevaram memória e CPU acumulada. **Não foram ativados na aplicação ou no comparativo**. Antes de adotar, é necessário medir a aplicação inteira, orçamento de memória, carga simultânea e controle de admissão de hashes. Não houve redução de custo criptográfico nem troca de algoritmo.

## 7. Critérios funcionais e segurança

- 45 testes locais aprovados, incluindo os novos testes de escopo, paginação segura, identidade via cookie e corrida SSE.
- Regressão MySQL real aprovada: respostas de 8.1/8.2 comparadas em 16 rotas e cinco contextos (quatro papéis e anônimo), inclusive casos privados, estatísticas públicas, IDs extremos e paginação.
- Vinte criações concorrentes entre backend antigo e novo preservaram IDs únicos. A falha injetada depois do INSERT e UPDATE de metadados causou rollback integral; HTTP 500 genérico era esperado nesse teste, sem detalhes SQL/credenciais na resposta.
- Regressão Fase 5 aprovada com cadastro/login, moderação, conversas, solicitações, negociações, auditoria, bloqueio de acesso e persistência em outro processo.
- Navegador Chrome, dois visitantes e administrador em contextos separados e dois processos Node: atualização privada/pública, mensagens e rascunhos, aprovação/rejeição, mudanças de negociação, offline, reinício Node, replay e ausência de duplicações aprovados após a correção SSE. Inclui viewport móvel emulada; nenhum aparelho físico foi testado.
- Na rodada final, ${after.cases.map(c=>c.virtualUsers).join('/')} streams abriram e ficaram prontos. Zero IDs de mudança duplicados e zero encerramentos inesperados/erros de stream em todos os cenários. Frames de mudança finais: ${after.cases.map(c=>c.sse.changes).join('/')}; são invalidações agrupadas, não um frame obrigatório por gravação.
- Cada lado da rodada final acrescentou exatamente 85 usuários, 85 ideias, 85 conversas, 85 mensagens de atendimento e 170 sessões, sem perda ou duplicação e mantendo todos os registros anteriores. Autoria, conversa/remetente, status inicial e duas sessões por visitante foram conferidos no MySQL.

Autorização continua no backend, com cookie HttpOnly, verificações de origem e validação por papel. Não há promoção pública a administrador, cache persistente de privilégios nem exposição de eventos privados a outros visitantes.

## 8. Preservação e estado operacional

O snapshot final de renolink_dev confirmou unchanged=true para estado, schema e equipe. Contagens preservadas: ${Object.entries(dev.counts).map(([k,v])=>`${k}=${v}`).join(', ')}. Hash de estado: ${dev.stateSha256}. JSONs originais não foram alterados; hashes conferidos nos testes e na verificação final.

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
`;
fs.writeFileSync(path.resolve(root,'../auditoria/FASE_8_2.md'),text);console.log('Relatorio FASE_8_2.md e CSV por operacao gerados.');
