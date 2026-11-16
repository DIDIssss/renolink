'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'data/runtime'),read=f=>JSON.parse(fs.readFileSync(path.join(runtime,f))),rounds=['realistic8-1','realistic8-2','realistic-control4'].map(id=>read('phase83-'+id+'/results.json'));
for(const r of rounds){assert.equal(r.status,'passed');assert.equal(r.cases.length,6);for(const c of r.cases){assert.equal(c.errors,0);assert.equal(c.oldRowsPreserved,true);assert.equal(c.sse.ready,50);assert.equal(c.sse.failures,0);assert.equal(c.sse.duplicateFrames,0);assert.equal(c.resources.hashesInsideWrite,0);}for(const label of ['A','B','C'])assert.deepEqual(r.cases.find(c=>c.variant==='before'&&c.scenario===label).countsBefore,r.cases.find(c=>c.variant==='after'&&c.scenario===label).countsBefore);}
const dev=read('phase83-round1-dev-after.json'),functional=read('phase83-functional.json'),legacy=read('phase83-legacy.json'),sse=read('phase7-test-report.json'),local=read('phase83-local-tests.json');assert.equal(dev.unchanged,true);assert.equal(functional.status,'passed');assert.equal(legacy.status,'passed');assert.equal(sse.status,'passed');assert.equal(local.status,'passed');assert.equal(local.tests,52);assert.equal(local.passed,52);
for(const r of rounds)for(const [file,expected]of Object.entries(r.implementation))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),expected,'Implementacao mudou depois do ensaio: '+file);
const n=v=>Number(v||0).toFixed(2),names={A:'Navegação autenticada',B:'Pico de login',C:'Carga mista realista'},lines=[];
for(const r of rounds)for(const c of r.cases)lines.push(`| ${r.runId} | ${c.scenario} | ${c.variant} | ${n(c.http.p50Ms)} | ${n(c.http.p95Ms)} | ${n(c.http.p99Ms)} | ${n(c.activeRps)} | ${c.errors} |`);
const resources=[],stages=[],perOp=[],csv=[['rodada','cenario','variante','operacao','quantidade','p50_ms','p95_ms','p99_ms','rps_janela','cpu_processo_ms','rss_pico_mib','event_loop_p95_ms','sql_consultas','sql_credencial_ms_p95','credencial_total_ms_p95','scrypt_total_ms_p95','fila_crypto_ms_p95','crypto_submetido_callback_ms_p95','sessao_construcao_ms_p95','persistencia_api_ms_p95','pool_ms_p95','rate_limiting_ms_p95','validacoes_corpo_ms_p95','erros_http']];
for(const r of rounds)for(const c of r.cases){const v=c.resources,s=v.stages;
 resources.push(`| ${r.runId}/${c.scenario}/${c.variant} | ${n(v.cpuMs)} | ${n(v.cpuOneCorePercent)} | ${n(v.peakRssMiB)} | ${n(v.eventLoopP95Ms)}/${n(v.eventLoopP99Ms)}/${n(v.eventLoopMaxMs)} | ${v.peakCryptoSubmitted}/${v.peakCryptoPending} | ${v.sqlCount} | ${v.mysqlConnections.peakActive}/5 |`);
 if(c.scenario!=='A')stages.push(`| ${r.runId}/${c.scenario}/${c.variant} | ${n(s.credentialTotalIncludingPool?.p95Ms)} | ${n(s.scryptTotal?.p95Ms)} | ${c.variant==='before'?'não separada':n(s.cryptoAdmissionQueue?.p95Ms)} | ${c.variant==='before'?'não separada':n(s.cryptoSubmittedToCallback?.p95Ms)} | ${n(s.apiPersistence?.p95Ms)} | ${n(s.poolWait?.p95Ms)} | ${n(s.libuvProbe?.maxMs)} |`);
 for(const [route,t]of Object.entries(c.routes)){const method=route.startsWith('/api/auth/')||route==='/api/ideas'||(route==='/api/team/conversations'&&c.scenario==='C')?'POST':'GET',key=method+' '+route.split('?')[0],o=v.operations[key],z=o?.stages||{},sql=Object.entries(z).find(([k])=>k.startsWith('sql:SELECT id, password_hash, salt FROM renolink_users'))?.[1].p95Ms??'';
 perOp.push(`| ${r.runId}/${c.scenario}/${c.variant} | ${method} ${route} | ${t.count} | ${n(t.p50Ms)} | ${n(t.p95Ms)} | ${n(t.p99Ms)} | ${o?.sqlCount.total??0} |`);
 csv.push([r.runId,c.scenario,c.variant,key,t.count,t.p50Ms,t.p95Ms,t.p99Ms,t.count/(v.wallMs/1000),v.cpuMs,v.peakRssMiB,v.eventLoopP95Ms,o?.sqlCount.total??0,sql,z.credentialTotalIncludingPool?.p95Ms??0,z.scryptTotal?.p95Ms??0,z.cryptoAdmissionQueue?.p95Ms??'',z.cryptoSubmittedToCallback?.p95Ms??'',z.sessionConstruction?.p95Ms??0,z.apiPersistence?.p95Ms??0,z.poolWait?.p95Ms??0,z.rateLimiting?.p95Ms??0,z.validationIncludingBody?.p95Ms??0,o?.errors??0]);
 }
}
const legacyText=legacy.cases.map(c=>`${c.variant}: ${c.metrics.hashesInsideWrite} hashes dentro do handler; handler p95 ${n(c.metrics.stages.handler.p95Ms)} ms; fila de gravação p95 ${n(c.metrics.stages.stateQueue.p95Ms)} ms`).join('; ');
const diagnostic=read('phase83-control4/results.json'),control=diagnostic.cases.filter(c=>c.scenario==='B').map(c=>`${c.variant}: HTTP p95 ${n(c.http.p95Ms)} ms; sonda libuv máxima ${n(c.resources.stages.libuvProbe.maxMs)} ms`).join('; ');
const first=rounds[0],last=rounds[1];
const text=`# RenoLink — Fase 8.3: autenticação segura

Data: 31/10/2026. Ensaios locais isolados; nenhum deploy ou alteração de configuração do processo da aplicação em uso.

## Resultado e decisão

A navegação com 50 sessões e 50 SSE passou nos três comparativos finais. O pico de 50 logins ainda leva segundos. O perfil de oito threads melhora o pico de login nos ensaios, mas aumenta memória e piorou o p95 global misto nas duas rodadas realistas. **Não declarar a plataforma pronta para 50 visitantes com login simultâneo rápido.**

No perfil padrão de quatro threads, o código final apresentou p95 A/B/C de ${rounds[2].cases.filter(c=>c.variant==='after').map(c=>n(c.http.p95Ms)).join(' / ')} ms, contra ${rounds[2].cases.filter(c=>c.variant==='before').map(c=>n(c.http.p95Ms)).join(' / ')} ms no baseline pareado. As diferenças pequenas nesse único par não devem ser tratadas como ganho estatístico garantido. O limite principal de login permanece.

O padrão continua conservador: até quatro hashes ativos e 128 aguardando por processo. Oito threads é um perfil opcional para homologação, não foi ativado na aplicação em uso. Os ganhos comprovados que entram no código são o controle de trabalho criptográfico pendente, sua observabilidade e a retirada do rehash legado da transação.

## Diagnóstico e implementação

- O scrypt já era assíncrono e executado antes da transação para senhas modernas. Mantidos N=32768, r=8, p=3, chave de 64 bytes, salt aleatório e maxmem=64 MiB. Não houve troca de algoritmo ou redução do custo. A API assíncrona e seus parâmetros estão documentados em [Node.js Crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
- O problema predominante no pico de autenticação é o custo dos hashes e a fila de trabalho do Node.js. As consultas e a sessão são medidas separadamente abaixo; não se atribui ao MySQL a duração total do login.
- Antes, 50 verificações podiam ser submetidas imediatamente ao libuv de quatro threads. A sonda PBKDF2 de uma iteração usa esse mesmo recurso: seu atraso mostra o efeito sobre outros trabalhos, sem conter dados de usuários. Controle com quatro threads: ${control}. Esse ensaio preliminar ainda usava a sequência mista da Fase 8.2; seus tempos não são comparados diretamente com o cenário C final.
- Nova fila FIFO em lib/crypto-queue.js: concorrência explícita, no máximo 128 pendentes e resposta 503 quando cheia, sem iniciar o hash excedente. Não altera os limites por IP/conta ou o rate limiter existente. Limites são por processo, não distribuídos. AsyncResource preserva a associação de cada tarefa ao seu solicitante. Falhas liberam slots. Observabilidade publica apenas tempos e tamanhos, nunca senhas, hashes, salts ou tokens.
- O primeiro login legado fazia SHA-256 compatível e depois scrypt dentro da transação. Agora a atualização é preparada antes da transação; a prova mantém os valores antigos e só pode ser aceita se ID, salt e hash ainda corresponderem à conta relida. A atribuição ocorre após a validação existente de senha e, no login administrativo, de papel. Senha errada ou credencial alterada não recebe sessão nem atualização indevida. Aplicado aos dois logins, visitante e equipe. Chamadas internas sem a etapa HTTP preparada conservam o fallback seguro.
- Ensaio com duas contas legadas sintéticas, mesmas quatro threads em ambos os lados: ${legacyText}. Ambos os hashes novos e sessões foram relidos e verificados no MySQL. Trata-se de evidência do bloqueio removido, não estimativa estatística de capacidade.
- A busca de credencial continua com duas consultas: identidade/versão da conexão e SELECT por email_normalized indexado. A transação relê a conta para impedir aceitar uma prova obsoleta. Essas verificações foram preservadas. Pool MySQL continua em cinco conexões, fila 100; não se identificou razão para aumentar o pool ou alterar índices/schema.
- A sessão conserva token aleatório, somente digest persistido, cookie HttpOnly/SameSite, expiração e revogação. A resposta HTTP continua após commit. Auditoria, autorização no backend e consultas parametrizadas permanecem.

## Metodologia e equivalência

Hardware: ${first.host.cpu}, ${first.host.logicalCpus} processadores lógicos, ${n(first.host.memoryGiB)} GiB. Node ${first.node}; MySQL ${first.configuration.version}. Loopback. Pool MySQL 5. Baseline é a autenticação congelada da Fase 8.2, com quatro threads; nas rodadas realistic8 o final usa fila limitada a oito e UV_THREADPOOL_SIZE=8, definidos antes de criar cada processo filho. A rodada realistic-control4 compara baseline com o código final no padrão de quatro threads. **A diferença de paralelismo nas realistic8 é a variável experimental**, sem alteração dos parâmetros scrypt ou globais do MySQL. Os números do perfil opcional não são apresentados como resultados do padrão.

A: 50 visitantes com cookies válidos preparados fora da medição; cada um abre SSE e consulta identidade, ideias próprias, negociações, conversas e dashboard. 300 requisições.

B: 50 visitantes existentes iniciam login praticamente juntos e abrem SSE após autenticar. 100 requisições. É uma rajada deliberadamente severa em intervalo curto, não tráfego distribuído ao longo de minutos.

C: 10 cadastros, 20 logins e 20 sessões existentes; todos abrem SSE, criam ideia, enviam a primeira mensagem de atendimento, consultam suas ideias, leem a mensagem e listam negociações. 330 requisições. O cadastro já emite sessão, portanto não se exige login redundante. A criação e transição de solicitações/negociações também foram cobertas pelos testes funcionais completos.

Cada cenário mantém 50 SSE por uma janela mínima de 15 s. Nos cenários A/C as requisições de um visitante são sequenciais e os 50 visitantes concorrem. Limites de abuso e IP compartilhado permanecem. Nenhum outro teste do agente foi executado em paralelo ao benchmark. A máquina não é dedicada: variação de processos externos não é eliminada. A ordem é sempre baseline seguida de final, sem randomização. A usa novas contas sintéticas sem histórico próprio; não representa contas com centenas de ideias ou conversas.

Foram reutilizadas duas estruturas sintéticas existentes em renolink_test, sem DDL, reset ou exclusões. Inicialmente cada lado tinha ${first.initialCounts.users} usuários, ${first.initialCounts.ideas} ideias e ${first.initialCounts.sessions} sessões. Na segunda repetição: ${last.initialCounts.users}, ${last.initialCounts.ideas}, ${last.initialCounts.sessions}; no controle padrão: ${rounds[2].initialCounts.users}, ${rounds[2].initialCounts.ideas}, ${rounds[2].initialCounts.sessions}, respectivamente. Cada lado ganha, por rodada, 60 usuários (50 de preparação e 10 de cadastro medido), 50 ideias, 50 mensagens e 130 sessões. A quantidade de registros é equivalente antes/depois de cada par de cenário e validada pelo gerador deste relatório; entre rodadas os dados crescem deliberadamente. IDs e tempos dos novos dados podem diferir por ordem de conclusão. Registros anteriores são comparados campo a campo no próprio lado; IDs únicos, relações e quantidades novas são verificados após cada cenário. Não se alegam duas cópias byte a byte idênticas.

Diferenças em relação à Fase 8.2: janela 15 s em vez de 60 s; três populações separadas; C realista com 30 autenticações em vez de 100 hashes de cadastro+login redundante. Por isso 5,28 s da Fase 8.2 não é um baseline comparável para C. Os arquivos control4/tuned8-1/tuned8-2 preservam os diagnósticos preliminares da sequência antiga; os dois realistic8 são a comparação final reproduzida do perfil opcional, e realistic-control4 mede o padrão entregue.

Percentis são de requisições individuais, não de pessoas ou da duração total de cada visita. HTTP SSE mede a abertura, não o fluxo completo. RPS ativo é requisições divididas pelo tempo até a última operação; não é capacidade sustentada. RPS por janela está no CSV. CPU é tempo do processo Node, incluindo threads nativas, e a porcentagem usa uma CPU lógica como 100%; memória é pico RSS amostrado a cada 100 ms. A média de CPU na janela inclui o período ocioso com SSE. Não foi medida CPU/IO do serviço MySQL, CPU por função nem CPU por requisição individual; atribuir isso por operação sob concorrência seria incorreto. O CSV repete recursos do cenário como contexto.

## Comparativo HTTP global — ms

| Rodada | Cenário | Variante | p50 | p95 | p99 | RPS ativo | Erros |
|---|---|---|---:|---:|---:|---:|---:|
${lines.join('\n')}

## Recursos por cenário

| Ensaio | CPU ms | CPU % de um núcleo | RSS MiB | Event loop p95/p99/máx ms | Crypto submetidas/pendentes na aplicação pico | SQL total | Conexões MySQL pico/limite |
|---|---:|---:|---:|---:|---:|---:|---:|
${resources.join('\n')}

Os cenários autenticados não executam scrypt. SQL total inclui SSE e inicialização; consultas por operação estão no detalhamento e CSV. A preparação de dados está fora da medição. Na carga mista há espera relevante no pool e na fila serial de gravação: liberar hashes mais cedo pode concentrar commits e aumentar a competição com as outras operações. Oito threads não resolve esses efeitos; não há evidência suficiente para aumentar o pool MySQL como resposta automática. A primeira rodada realista regrediu no p95 global misto, apesar de reduzir o tempo do scrypt. A observação de SQL/pool por operação deve orientar a próxima investigação.

## Decomposição observada — ms

| Ensaio | Credencial + pool p95 | Scrypt total p95 | Admissão p95 | Submissão-callback p95 | API persistência p95 | Pool p95 | Sonda libuv máx |
|---|---:|---:|---:|---:|---:|---:|---:|
${stages.join('\n')}

O scrypt total inclui espera na fila de admissão e o intervalo da chamada nativa ao callback. **Submissão-callback não é CPU pura**: inclui execução, eventual espera interna do libuv e entrega do callback. Não existe sinal de início de execução do scrypt na API Node utilizada. A fila de admissão é medida exatamente; a espera interna é observada indiretamente pela sonda, sem inventar uma separação numérica. Percentis de etapas não devem ser somados. Na baseline a fila interna não é separável; zero pendentes na aplicação significa ausência de fila própria, não ausência de espera no libuv. Campos de fila não medidos ficam vazios no CSV. Event loop lag é medido por monitorEventLoopDelay com resolução de 10 ms.

O CSV contém tempos por operação de busca de credencial, scrypt, fila, construção da sessão, persistência da API, pool, rate limiting e validações com leitura do corpo. Construção da sessão é apenas token/cookie/objeto; persistência da API inclui fila de gravação, reler e validar o escopo, INSERT da sessão, atualização de contadores e commit. O JSON registra separadamente cada comando SQL, incluindo INSERT de sessão e COMMIT. O tempo de rate limiting por operação é a soma das chamadas instrumentadas daquele pedido; validações incluem parsing/leitura do corpo e não são uma medição pura de CPU.

## HTTP por operação — ms

| Ensaio | Operação | N | p50 | p95 | p99 | SQL atribuídas |
|---|---|---:|---:|---:|---:|---:|
${perOp.join('\n')}

CSV: renolink_funcional/data/runtime/phase83-operacoes.csv. O CSV mostra a consulta SQL de credencial separadamente; o JSON detalha os demais comandos. Não se somam percentis de consultas distintas, pois isso não produz um percentil agregado válido.

## Testes funcionais, segurança e integridade

- 52 testes locais aprovados (45 anteriores + 7 da fila, compatibilidade e atualização de hash).
- Integração MySQL: paridade de 16 rotas em cinco contextos, privacidade de IDs, paginação, concorrência de 20 ideias e rollback por falha SQL induzida; suíte adicional de autenticação, cadastro, aprovação/rejeição, atendimento, solicitações, negociações, auditoria, revogação e persistência em outro processo Node, sem executar migração.
- Chrome automatizado: dois visitantes e administrador em sessões independentes, eventos privados, aprovação, respostas, solicitações, reconexão offline/reinício do Node, ausência de duplicações, viewport móvel emulado e desktop. Não foram feitos testes físicos ou novos testes nativos de Opera.
- Os 18 cenários finais passaram com 50 SSE cada, sem erro HTTP inesperado, queda de stream ou frame duplicado. Todos os dados sintéticos persistiram e foram verificados. Nenhum registro anterior foi perdido ou alterado pelo benchmark. A sobrecarga da fila foi testada deterministicamente: 503 sem executar o trabalho recusado; falhas liberam slots; FIFO e contexto assíncrono preservados.
- A troca de credencial entre a prova e a transação continua rejeitada. Senhas erradas não fazem upgrade; hashes com parâmetros adulterados são recusados; formatos atuais e legados continuam compatíveis. Sobrecarga não concede sessão nem contorna autorização.

## Preservação e arquivos

Snapshot somente de leitura de renolink_dev antes/depois: estado, schema e equipe idênticos. Estado final: ${JSON.stringify(dev.counts)}. SHA-256 estado ${dev.stateSha256}; schema ${dev.schemaSha256}; equipe ${dev.staffSha256}. Hashes dos JSONs originais e operacionais idênticos em todos os ensaios. Nenhuma conta, permissão, administrador ou credencial real alterada; mudanças de dados limitadas às contas sintéticas em renolink_test. Nenhum parâmetro global, banco de outro projeto ou serviço MYSQL80 alterado. Nenhuma publicação.

Código: lib/security.js, lib/crypto-queue.js, lib/phase5.js e server.js. Ferramentas: scripts/test-phase83.ps1, phase83-benchmark.js, phase83-legacy.js, phase83-local-tests.js, phase83-report.js, start-auth-profile.ps1 e ajuste da allowlist de nomes de snapshot em phase7-dev-snapshot.js. Testes/fixtures: test/crypto-queue.test.js, test/phase83.mysql.test.js, test/fixtures/phase83-server.js e baseline-security congelado. package.json inclui os novos testes/comando. Relatórios brutos permanecem em data/runtime/phase83-* e não contêm credenciais. As senhas sintéticas e reais ficam apenas em memória durante os processos; cofre DPAPI não foi modificado.

## Operação e reprodução

No diretório renolink_funcional: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase83.ps1 -Mode Run -RunId nova-rodada. Não sobrescreve resultados existentes. Um RunId contendo control seleciona quatro threads no final; outro usa oito. As duas estruturas precisam continuar com quantidades equivalentes; divergência interrompe antes de continuar. Os dados sintéticos são mantidos, não há limpeza destrutiva.

Para testes: npm.cmd test; powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase83.ps1 -Mode Functional; scripts/test-phase7.ps1 -Mode Test. Não executar carga e regressões em paralelo. O gerador scripts/phase83-report.js recusa falta de evidência, mudança do código medido, cenário com erro ou snapshot dev divergente.

Início local opcional: powershell.exe -NoProfile -File scripts/start-auth-profile.ps1 -Threads 4 (padrão), ou -Threads 8 apenas após avaliar memória/CPU no destino. Não executado nesta fase. A rotina passa os dois valores para o novo processo Node e restaura o ambiente do PowerShell, sem gravar segredos/configurações globais. Não tentar substituir um processo já ativo. O uso normal de INICIAR_RENOLINK mantém o perfil padrão. Concorrência explicitamente maior que UV_THREADPOOL_SIZE e valores inválidos são recusados. Mudanças exigem novo processo Node; não reiniciar MySQL. A necessidade de definir o tamanho antes do início do processo e o compartilhamento do pool são descritos em [Node.js CLI](https://nodejs.org/api/cli.html#uv_threadpool_sizesize); o contexto dos trabalhos segue [AsyncResource](https://nodejs.org/api/async_context.html#class-asyncresource).

## Riscos e prontidão para hospedagem

Há evidência de boa navegação para estes 50 visitantes autenticados nestas rajadas curtas. **Não há evidência de boa experiência para 50 logins concorrentes, carga sustentada de feira, todos os administradores simultâneos ou infraestrutura pública.** Autenticação continua limitada por CPU/memória e distribuição de chegadas, e a fila finita pode retornar 503 sob sobrecarga maior. Requisições já admitidas podem continuar consumindo hash após desconexão do cliente. Rate limiting e fila são locais ao processo; múltiplas instâncias exigem avaliar proteção distribuída, sessões/eventos e afinidade sem relaxar segurança.

Recomendação: pronta para homologação de hospedagem e demonstração local supervisionada; ainda não validar operação pública para 50 autenticações simultâneas. Manter quatro hashes ativos como padrão conservador. Homologar oito apenas como alternativa para picos de login, com orçamento de memória e avaliação do cenário misto. Não aumentar paralelismo indiscriminadamente nem reduzir scrypt. Distribuir entrada/cadastro ao longo do tempo e preservar a sessão existente evita hashes desnecessários sem enfraquecer autenticação.

Como ponto de partida de homologação, inferido das medições e não garantia: CPU reservada, pelo menos quatro vCPU para comparar com este host e cerca de 4 GiB para aplicação + MySQL + margem operacional se compartilharem a máquina; medir novamente na CPU real, principalmente se forem vCPU compartilhadas. Banco persistente próximo da aplicação e TLS, HTTPS, segredos fora do repositório, backups/restauração verificados e monitoramento de latência por operação, rejeições/filas criptográficas, memória, SSE e pool. Confirmar IP de cliente via proxy confiável antes de ajustar limites de abuso; não confiar indiscriminadamente em X-Forwarded-For. Ensaiar carga sustentada, falhas, recuperação e dispositivos físicos no destino antes da feira. Nenhum serviço foi contratado ou publicado.
`;
fs.writeFileSync(path.resolve(root,'../auditoria/FASE_8_3.md'),text);
fs.writeFileSync(path.join(runtime,'phase83-operacoes.csv'),csv.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')+'\n');
console.log('Relatorio e CSV gerados com evidencias validadas.');
