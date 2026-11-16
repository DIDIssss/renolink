# RenoLink — Fase 8.1: diagnóstico e otimização de desempenho

Data local: 26/10/2026, America/Sao_Paulo. Execução registrada em UTC também
abrange 27/10. Melhorias implementadas e validadas; **a meta p95 < 2 s com
50 visitantes ainda não foi atingida**. Nenhuma publicação ou alteração de
dados/schema em `renolink_dev` foi executada.

## 1. Método e equivalência do comparativo

Os números da Fase 8 (2,34 / 5,42 / 12,47 s) não são o baseline deste comparativo:
a quantidade de dados e a duração daquela medição eram diferentes. Medimos novamente
a implementação anterior antes de otimizar, com instrumentação equivalente.

- Mesma máquina: Intel Core i7-7700 @ 3,60 GHz, 8 CPUs lógicas, 31,93 GiB RAM,
  Windows, Node v24.19.0, MySQL 8.0.46, loopback. Gerador, aplicação e MySQL locais.
- Mesmo pool configurado para 5 conexões, fila do driver 100 e libuv padrão com
  4 workers. Não aumentamos o pool, alteramos parâmetros globais ou reiniciamos MySQL.
- Configuração lida: `max_connections=151`, buffer pool InnoDB 134217728 bytes,
  `innodb_flush_log_at_trx_commit=1`, `sync_binlog=1`. Conferida entre variantes.
- Cada cenário começa com cópia integral da mesma fixture imutável, verificada por
  hash. Inclui 266 usuários, 208 ideias, 10 negociações, 3 mensagens legadas,
  466 sessões, 42 membros de equipe sintéticos, 188 conversas, 209 mensagens de
  atendimento, 12 solicitações e 111 eventos de auditoria.
- As cópias são tabelas com prefixos exclusivos `b81_…`, dentro de `renolink_test`.
  Colunas geradas, PKs, FKs, CHECKs e índices são preservados. Nenhuma tabela existente
  foi sobrescrita, esvaziada ou removida; não houve reset. Importações e metadados
  também foram copiados. Credenciais: somente `renolink_tester` nesse trabalho.
- Mesma distribuição: cada visitante cadastra, autentica, abre SSE, cria uma ideia,
  envia atendimento e consulta ideias próprias e conversa. 7 requisições medidas
  por visitante: 70 / 175 / 350. Mesmos limites de abuso; mesmo IP, sem simular IPs.
- Rajada inicial com 10 / 25 / 50 visitantes e uma janela nominal fixa de 60 s,
  incluindo observação dos streams após terminar as operações. Janelas efetivamente
  medidas de aproximadamente 60,02–60,03 s. Não é carga contínua durante uma hora.
- Quantidade máxima de SSE igual ao número de visitantes. Abertura depende do
  cadastro/login; conexões ficam abertas até o fim da janela. A chegada e os
  segundos conectados podem variar com a latência, como consequência do fluxo.
- Sem alterar parâmetros de scrypt: N=32768, r=8, p=3; cookies e autorização mantidos.

Foi feita uma observação por tamanho/variante; isto não constitui estudo estatístico
de capacidade. Cache de páginas do MySQL é aquecido pela própria cópia em ambos os
casos, sem flush global. Processos externos do Windows não foram controlados.
O throughput na janela fixa mede trabalho oferecido; o throughput ativo, separado,
mede a conclusão da mesma rajada. Não se deve confundir esse valor com capacidade
sustentada máxima.

## 2. Causas e evidências

### Consultas, índices e pool

O carregador anterior fazia 11 SELECTs por snapshot: metadados e dez coleções
inteiras. Isso ocorria inclusive para GET, lookup de login e revalidação SSE.
Além das consultas, cada transação clonava e serializava todo o estado para descobrir
alterações, mesmo em leituras. A maioria das consultas não tinha WHERE: índices não
eliminariam a varredura necessária para esse desenho.

`EXPLAIN` mostrou:

| Consulta diagnóstica | Acesso | Índice | Linhas estimadas |
|---|---|---|---:|
| SELECT * FROM renolink_users | ALL | nenhum | 266 |
| Credenciais WHERE email = ? | ALL | nenhum | 266 |
| Credenciais WHERE email_normalized = ? | const | users_email_uq | 1 |
| Mensagens WHERE conversation_id = ? | ref | support_conversation_date_idx | 2 |

O índice de e-mail já existia na coluna gerada normalizada. A aplicação antiga
carregava todos os usuários para procurar em JavaScript; trocar simplesmente para
`WHERE email = ?` continuaria sem aproveitá-lo. A nova busca usa o índice existente.
Nenhum índice novo foi necessário ou aplicado. Não habilitamos slow query log nem
mudamos configuração global para diagnosticar.

Com 50 visitantes no baseline, p95 da espera pelo pool foi **4103,74 ms**, espera
por GET_LOCK **454,63 ms**, carga do estado **34,53 ms**, cópia/fingerprint
**19,99 ms** e validação/diff/save **54,84 ms**. O problema era composto por fila,
materialização e trabalho repetido, não evidência de uma única consulta de segundos.

### Autenticação

Na carga final de 50 usuários houve 100 chamadas de scrypt, entre cadastro e login.
O p95 de chamada, incluindo fila do thread pool, foi **4819,89 ms**. O lookup SQL
de credenciais, já otimizado, teve p95 **3,35 ms**. Esse contraste localiza parte
importante da cauda na autenticação, não em falta de índice nessa consulta.

Diagnóstico separado, sem consultas ao banco: 10 hashes sequenciais tiveram média
**234,26 ms**; uma rajada de 50 hashes terminou em **4,11 s**, com p95 de chamada
**3,89 s**, usando os mesmos parâmetros e workers. O teste isolado demonstra a fila
de computação mesmo sem MySQL. Não reduzimos a proteção da senha para esconder isso.

### SSE e chamadas por página

As chamadas de SSE continuam autenticadas e limitadas por usuário. O scan por
processo carrega um snapshot compartilhado entre seus participantes; não há uma
consulta completa por usuário em cada poll. O custo do escopo privado foi medido
separadamente: no perfil final, 50 escopos em memória tiveram média de 94 ms por
lote e p95 de 201 ms, em dez lotes. Não é benchmark antes/depois com fixture
idêntica e não demonstra ganho do broadcast. Na carga, o p95 do callback de leitura
(incluindo varreduras SSE) foi 81,72 ms. Esse trabalho também ocupa o event loop.

O Chrome revelou repetição de consultas na abertura e na atualização inicial SSE.
Dashboard fazia 10 chamadas, negociações 8. A atualização inicial cobre mudanças
entre o GET inicial e a assinatura; removê-la poderia deixar dados desatualizados.

## 3. Alterações retidas e alternativas rejeitadas

1. Busca parametrizada de credenciais por `email_normalized`, retornando apenas
   ID, salt e hash ao código interno. A emissão de sessão continua revalidando a
   prova contra o usuário atual dentro da transação de escrita.
2. GETs e SSE usam transação `REPEATABLE READ, READ ONLY`, sem GET_LOCK de escrita.
   Os vários resultados pertencem a um snapshot consistente, sem dados não
   confirmados. Escritas continuam com GET_LOCK, commit/rollback, validação e FKs.
3. Snapshot consolidado: um SELECT de metadados e um `UNION ALL` de registros JSON
   substituem os 11 SELECTs separados. `multipleStatements` permanece desativado.
   Datas UTC, extras JSON, Unicode, IDs e relacionamentos foram comparados
   integralmente com o carregador anterior.
4. `isDeepStrictEqual` e cópia estrutural substituem serializações ordenadas
   repetidas no caminho de detecção de mudança. O validador permanece ativo antes
   de salvar; somente diferenças geram escrita. `stable` continua na verificação
   canônica de integridade e migração.
5. Operações que materializam o estado inteiro entram numa fila local limitada a
   100 antes de ocupar conexão. A busca indexada de credenciais é independente.
   A implementação atual ainda tem um callback completo de estado por vez em cada
   processo; não apresentamos isso como paralelismo irrestrito ou arquitetura final.
   Outros processos podem gravar durante uma leitura MVCC, comprovado no teste.
6. Resumos autenticados de dashboard e negociações reutilizam os mesmos handlers
   e filtros dos endpoints individuais, no mesmo snapshot. Frontend passa a usá-los.
   Existe fallback somente para 404/405 em backend antigo; 401/403 não são contornados.
7. O atendimento administrativo preserva o mesmo campo de resposta no DOM durante
   atualização da conversa, em vez de recriar o formulário. Há proteção de envio em
   andamento e preservação de novo rascunho digitado durante a resposta HTTP.

Apenas retirar o lock das leituras e deixá-las paralelas **regrediu** p95 de 50
visitantes para 9,30 s. Consolidar o snapshot e o diff, ainda com materializações
paralelas, deu 8,33 s. Essas variantes não foram selecionadas como solução final;
suas evidências foram preservadas. A fila compartilhada medida depois resultou
nos números finais abaixo. A nova fila também tem custo: p95 de espera de 2383,45 ms
com 50 visitantes; ela não torna a espera inexistente, mas controla onde ocorre.

Não foi introduzido cache de sessões ou permissões, nem cache de estado que pudesse
ficar desatualizado entre processos. Não alteramos privilégios, schema de desenvolvimento,
configuração global, intensidade criptográfica ou limites para obter a medição.

## 4. Comparativo de desempenho

Latências em segundos; percentis empíricos, sem interpolação.

| Visitantes | p50 antes | p50 final | p95 antes | p95 final | p99 antes | p99 final | Erros antes/final |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 0,954 | 0,543 | 1,578 | 1,487 | 1,761 | 1,560 | 0 / 0 |
| 25 | 2,351 | 1,213 | 3,843 | 3,324 | 4,372 | 3,525 | 0 / 0 |
| 50 | 3,924 | 2,296 | 7,355 | 6,837 | 7,886 | 7,111 | 0 / 0 |

Redução de p95: 5,8%, 13,5% e 7,0%, respectivamente. A melhora de p50 foi
43,0%, 48,4% e 41,5%. Não usamos a diferença contra os 12,47 s da Fase 8 para
anunciar um ganho, pois aquele ensaio não tinha a mesma fixture e janela.

| Visitantes | RPS na janela, ambos | RPS ativo antes/final | Conclusão da rajada antes/final | CPU Node antes/final* | Pico RSS antes/final | Conexões usadas antes/final |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1,17 | 10,01 / 13,96 | 6,99 / 5,01 s | 24,5% / 17,6% | 222,1 / 215,5 MiB | 5 / 2 |
| 25 | 2,92 | 9,92 / 15,96 | 17,65 / 10,97 s | 54,6% / 41,3% | 255,9 / 221,2 MiB | 5 / 2 |
| 50 | 5,83 | 10,91 / 16,16 | 32,09 / 21,65 s | 101,4% / 76,9% | 306,0 / 255,6 MiB | 5 / 2 |

*CPU média sobre a janela de 60 s, em equivalentes de um núcleo. Não é CPU total
da máquina; 101% corresponde a pouco mais de um núcleo. O pico de memória do Node
foi amostrado a cada 100 ms. Não medimos CPU/RSS do daemon MySQL nem de toda a máquina.
JSON no SQL pode deslocar trabalho para o MySQL, portanto não afirmamos redução de
CPU total do sistema. Conexões são as efetivamente criadas pelo pool da aplicação
medida; o limite configurado permaneceu 5, e não contam ferramentas/servidor principal.

Com 50 visitantes, SQL total instrumentado caiu de 9110 para 4136 comandos,
incluindo setup de transação e controle de locks, não apenas SELECT de negócio.
A espera pelo pool caiu para p95 de 0,49 ms e GET_LOCK para 0,69 ms. Cópia/detecção
inicial: 5,69 ms; validação/diff/save: 15,96 ms. O event loop p95 passou de
66,32 para 37,81 ms. Tempos por etapa se sobrepõem entre requisições e não podem
ser somados para reconstruir o tempo de parede de uma requisição.

### Rotas com 50 visitantes — p95

| Operação | Antes | Final |
|---|---:|---:|
| Cadastro | 7,985 s | 5,165 s |
| Login | 7,745 s | 7,140 s |
| Abertura SSE | 4,262 s | 2,414 s |
| Criar ideia | 4,646 s | 2,426 s |
| Enviar atendimento | 4,647 s | 2,554 s |
| Consultar ideias próprias | 4,451 s | 2,484 s |
| Consultar mensagens | 3,651 s | 2,469 s |

Logo, nem excluir autenticação da análise faria a meta de 2 s ser atingida sob 50
visitantes nesta rajada. Com 25, essas ações de negócio tiveram p95 até cerca de
1,40 s, mas cadastro/login continuaram acima de 2 s. O cenário de 10 apresentou
p95 global inferior a 2 s nesta observação.

### Efeito no navegador, medido separadamente

| Página/seção | Chamadas antes | Chamadas finais |
|---|---:|---:|
| Dashboard do visitante | 10 | 4 |
| Negociações do visitante | 8 | 4 |
| Nova ideia | 2 | 2 |
| Mensagens, visitante novo sem conversa | 4 | 4 |
| Explorar, autenticado | 3 | 3 |
| Administração, abertura | 6 | 6 |
| Cada seção administrativa após abrir o painel | 1 | 1 |

Incluem a abertura SSE e sua primeira invalidação. Conversas existentes acrescentam
consulta de mensagens. O comparativo de carga manteve os sete endpoints antigos por
visitante para não mudar a distribuição; não somamos o ganho dos resumos ao p95
do benchmark. A redução de chamadas foi comprovada separadamente no Chrome.

## 5. Integridade e validação funcional

Todas as 12 combinações de tamanho/variante terminaram sem erros HTTP e com fluxos
completos. Cada variante de 10+25+50 acrescentou exatamente 85 usuários, 85 ideias,
85 conversas, 85 mensagens de atendimento e 170 sessões nas suas próprias cópias.
Nenhum registro anterior divergiu. Foi verificada autoria da ideia, estado inicial
Em análise, associação visitante/conversa/remetente e duas sessões por usuário;
sem perda ou duplicação de registros. A seed permaneceu com o mesmo hash.

SSE final: 10/25/50 conexões abertas e prontas, zero falhas e zero IDs de frames
duplicados. Frames de mudança foram 17/48/99. São invalidações agrupadas de tópicos,
não um frame obrigatório por mensagem; a persistência foi conferida nos registros.

- Suíte local: **41 testes aprovados** de autenticação, CSRF, cookies, papéis, isolamento, arquivos
  internos, abuso, concorrência, rollback e novos testes de snapshots/credenciais,
  resumo autorizado e compatibilidade com backend anterior.
- MySQL real: snapshot pausado após ler metadados, escrita concorrente por outra
  conexão e retomada; leitor continua vendo a versão anterior inteira, e uma nova
  leitura vê o commit. Resultado comparado ao carregador original, inclusive extras.
- Callback somente de leitura não persiste alterações acidentais no objeto.
- Erros de leitura executam rollback; falha de rollback descarta a conexão.
- Regressão MySQL Fase 5: moderação, atendimento, negociações, auditoria, acessos
  indevidos e persistência em outro processo Node aprovados.
- Regressão MySQL Fase 8: UPDATE seguido de violação real de FK confirma rollback
  integral; save sem alteração não emite escrita. Aprovada, sem remover FKs.
- Regressão SSE com dois visitantes e administrador, dois processos Node e contextos
  separados: ideias privadas, aprovação/rejeição, mensagens bidirecionais, rascunhos,
  solicitações, negociações, offline, Last-Event-ID, reinício Node e deduplicação.
  Duas execuções consecutivas aprovadas após a correção do compositor, com asserção
  de identidade do elemento de edição preservado durante atualização recebida.
- Chrome e Opera GX: revisão final aprovada em 34 combinações de página/seção e
  viewport por navegador, além do tablet. Inclui campos obrigatórios, HTTP 503,
  navegação fora de ordem e inicialização do formulário de mensagens. Apenas
  automação headless/emulação; nenhum aparelho físico foi testado nesta fase.

Uma execução anterior da regressão teve timeout na resposta administrativa. A nova
instrumentação não reproduziu o erro na execução seguinte; a revisão encontrou
recriação do formulário e corrigiu essa condição. Não atribuímos toda falha anterior
a uma causa que não foi capturada: o ensaio prolongado permanece recomendado.

## 6. Preservação, limitações e próximos passos

Somente testes sintéticos e cópias de tabelas dentro de `renolink_test` receberam
escritas. Nenhuma conta MySQL, privilégio, administrador real, JSON original ou
configuração global foi alterada. As duas primeiras tentativas de montar a fixture
foram interrompidas antes de qualquer medição: uma incluía coluna gerada no INSERT,
e outra recusava identificador com dígitos. O INSERT foi corrigido para deixar o
MySQL gerar essas colunas; as transações de cópia falhas sofreram rollback. As
tabelas vazias dessas tentativas foram preservadas, sem limpeza destrutiva.

O snapshot final do desenvolvimento confirmou `unchanged: true` para estado,
schema e equipe: 6 usuários, 10 ideias, 7 mensagens legadas, 1 negociação, 4 sessões,
1 membro de equipe, 1 conversa, 1 mensagem de atendimento, 0 solicitações e 3 eventos
de auditoria. São as mesmas contagens e registros encontrados no início.
JSON original e operacional conservaram SHA-256
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.

Os artefatos de teste são aditivos e ocupam espaço. Uma eventual remoção futura
precisa de escopo aprovado; esta fase não executa limpeza nem reset. As cópias
incluem FKs e não são destinadas ao uso operacional.

Gargalos restantes: materializar todo o banco, fila local de estado, lock de escrita
entre processos, CPU de hashing e escopos SSE. A capacidade demonstrada é completar
50 fluxos na rajada sem erros e com integridade; **isso não demonstra 50 visitantes
com p95 < 2 s**, nem disponibilidade prolongada de uma feira ou capacidade pública.

Próximo trabalho recomendado: repositórios com SELECTs por usuário/conversa e
gravações específicas, reduzindo o trecho protegido por lock e evitando o snapshot
inteiro. Reusar os índices já existentes antes de propor novos. Qualquer índice ou
schema necessário em desenvolvimento requer plano e autorização prévios. Não usar
cache de permissões sem invalidação verificável entre processos.

Antes da hospedagem: repetir as medições em homologação isolada com infraestrutura
real, HTTPS/proxy e rede móvel; medir também CPU/IO do MySQL, duração prolongada e
admissão de autenticações sob rajadas. Não aumentar workers/pool às cegas nem reduzir
scrypt. Fixar versão do Node e validar limites de CPU/RAM do serviço, conexões,
backups/restauração e alertas. As recomendações de
[HOSPEDAGEM_FEIRA.md](HOSPEDAGEM_FEIRA.md) continuam pendentes de implantação.

O backend principal não foi reiniciado. As otimizações MySQL entram no próximo
início normal do Node por `INICIAR_RENOLINK.bat`; o frontend mantém fallback para
o backend anterior enquanto isso. Nenhuma publicação ou reinicialização de MYSQL80.

## 7. Evidências e reprodução segura

Em `renolink_funcional/data/runtime/phase81/`: `manifest.json`, `before.json`
(baseline equivalente), `after.json` (primeira variante), `candidate.json`
(segunda), `balanced.json` (final), `explain.json`, `hash.json`, `integrity.json`,
`implementation.json`, `pages-before-summary.json`, `pages.json`.
Contêm estatísticas e hashes de verificação; não registram parâmetros com credenciais,
senhas, cookies ou conteúdo de mensagens. Todo runtime é ignorado pelo Git e bloqueado
pelo servidor HTTP. Snapshot do dev: `phase81-dev-before.json` e `phase81-dev-after.json`.

O baseline foi congelado antes das otimizações e seu hash registrado no manifesto.
A cópia portável de referência está em `test/fixtures/phase81-baseline-mysql.js`;
a cópia usada nesta medição, com caminhos locais de require, também permanece no
runtime. Referência usada apenas pelo teste, nunca por configuração da aplicação.

Para uma nova rodada comparável, usar um identificador novo, sem apagar resultados:

```powershell
cd D:\Downloads\renolink\renolink_funcional
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase81.ps1 -Mode Init -RunId rodada2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase81.ps1 -Mode Before -RunId rodada2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase81.ps1 -Mode Balanced -RunId rodada2
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase81.ps1 -Mode Verify -RunId rodada2
```

O script recusa sobrescrever manifesto, resultados e tabelas de ensaio. Before usa
o baseline; Balanced usa a implementação atual. After/Candidate foram rótulos de
experimentos desta execução, não presets para reconstruir versões históricas.
Credenciais são obtidas do cofre DPAPI e fornecidas só ao ambiente temporário,
restaurado no fim. Não executar esses ensaios com o banco ou conta de desenvolvimento.

Arquivos de aplicação: `lib/mysql.js`, `lib/security.js`, `lib/realtime.js`,
`server.js`, `assets/js/app.js`, `assets/js/admin.js`. Instrumentação/testes:
`scripts/test-phase81.ps1`, `scripts/phase81-benchmark.js`,
`scripts/phase7-dev-snapshot.js`, `test/phase8.load.js`, `test/phase81.mysql.test.js`,
`test/phase81.pages.js`, `test/mysql.read.test.js`, `test/portal-summary.test.js`,
`test/app-client.test.js`, `test/phase7.browser.js`, `test/fixtures/phase81-*.js`,
`package.json` e este relatório. Nenhum arquivo SQL de migração foi criado ou aplicado.
