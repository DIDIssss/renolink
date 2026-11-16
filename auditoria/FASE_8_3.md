# RenoLink — Fase 8.3: autenticação segura

Data: 31/10/2026. Ensaios locais isolados; nenhum deploy ou alteração de configuração do processo da aplicação em uso.

## Resultado e decisão

A navegação com 50 sessões e 50 SSE passou nos três comparativos finais. O pico de 50 logins ainda leva segundos. O perfil de oito threads melhora o pico de login nos ensaios, mas aumenta memória e piorou o p95 global misto nas duas rodadas realistas. **Não declarar a plataforma pronta para 50 visitantes com login simultâneo rápido.**

No perfil padrão de quatro threads, o código final apresentou p95 A/B/C de 371.88 / 4302.53 / 2178.55 ms, contra 435.92 / 4544.36 / 2236.64 ms no baseline pareado. As diferenças pequenas nesse único par não devem ser tratadas como ganho estatístico garantido. O limite principal de login permanece.

O padrão continua conservador: até quatro hashes ativos e 128 aguardando por processo. Oito threads é um perfil opcional para homologação, não foi ativado na aplicação em uso. Os ganhos comprovados que entram no código são o controle de trabalho criptográfico pendente, sua observabilidade e a retirada do rehash legado da transação.

## Diagnóstico e implementação

- O scrypt já era assíncrono e executado antes da transação para senhas modernas. Mantidos N=32768, r=8, p=3, chave de 64 bytes, salt aleatório e maxmem=64 MiB. Não houve troca de algoritmo ou redução do custo. A API assíncrona e seus parâmetros estão documentados em [Node.js Crypto](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback).
- O problema predominante no pico de autenticação é o custo dos hashes e a fila de trabalho do Node.js. As consultas e a sessão são medidas separadamente abaixo; não se atribui ao MySQL a duração total do login.
- Antes, 50 verificações podiam ser submetidas imediatamente ao libuv de quatro threads. A sonda PBKDF2 de uma iteração usa esse mesmo recurso: seu atraso mostra o efeito sobre outros trabalhos, sem conter dados de usuários. Controle com quatro threads: before: HTTP p95 4363.17 ms; sonda libuv máxima 4308.89 ms; after: HTTP p95 4606.79 ms; sonda libuv máxima 332.56 ms. Esse ensaio preliminar ainda usava a sequência mista da Fase 8.2; seus tempos não são comparados diretamente com o cenário C final.
- Nova fila FIFO em lib/crypto-queue.js: concorrência explícita, no máximo 128 pendentes e resposta 503 quando cheia, sem iniciar o hash excedente. Não altera os limites por IP/conta ou o rate limiter existente. Limites são por processo, não distribuídos. AsyncResource preserva a associação de cada tarefa ao seu solicitante. Falhas liberam slots. Observabilidade publica apenas tempos e tamanhos, nunca senhas, hashes, salts ou tokens.
- O primeiro login legado fazia SHA-256 compatível e depois scrypt dentro da transação. Agora a atualização é preparada antes da transação; a prova mantém os valores antigos e só pode ser aceita se ID, salt e hash ainda corresponderem à conta relida. A atribuição ocorre após a validação existente de senha e, no login administrativo, de papel. Senha errada ou credencial alterada não recebe sessão nem atualização indevida. Aplicado aos dois logins, visitante e equipe. Chamadas internas sem a etapa HTTP preparada conservam o fallback seguro.
- Ensaio com duas contas legadas sintéticas, mesmas quatro threads em ambos os lados: before: 2 hashes dentro do handler; handler p95 230.01 ms; fila de gravação p95 253.77 ms; after: 0 hashes dentro do handler; handler p95 2.40 ms; fila de gravação p95 37.68 ms. Ambos os hashes novos e sessões foram relidos e verificados no MySQL. Trata-se de evidência do bloqueio removido, não estimativa estatística de capacidade.
- A busca de credencial continua com duas consultas: identidade/versão da conexão e SELECT por email_normalized indexado. A transação relê a conta para impedir aceitar uma prova obsoleta. Essas verificações foram preservadas. Pool MySQL continua em cinco conexões, fila 100; não se identificou razão para aumentar o pool ou alterar índices/schema.
- A sessão conserva token aleatório, somente digest persistido, cookie HttpOnly/SameSite, expiração e revogação. A resposta HTTP continua após commit. Auditoria, autorização no backend e consultas parametrizadas permanecem.

## Metodologia e equivalência

Hardware: Intel(R) Core(TM) i7-7700 CPU @ 3.60GHz, 8 processadores lógicos, 31.93 GiB. Node v24.19.0; MySQL 8.0.46. Loopback. Pool MySQL 5. Baseline é a autenticação congelada da Fase 8.2, com quatro threads; nas rodadas realistic8 o final usa fila limitada a oito e UV_THREADPOOL_SIZE=8, definidos antes de criar cada processo filho. A rodada realistic-control4 compara baseline com o código final no padrão de quatro threads. **A diferença de paralelismo nas realistic8 é a variável experimental**, sem alteração dos parâmetros scrypt ou globais do MySQL. Os números do perfil opcional não são apresentados como resultados do padrão.

A: 50 visitantes com cookies válidos preparados fora da medição; cada um abre SSE e consulta identidade, ideias próprias, negociações, conversas e dashboard. 300 requisições.

B: 50 visitantes existentes iniciam login praticamente juntos e abrem SSE após autenticar. 100 requisições. É uma rajada deliberadamente severa em intervalo curto, não tráfego distribuído ao longo de minutos.

C: 10 cadastros, 20 logins e 20 sessões existentes; todos abrem SSE, criam ideia, enviam a primeira mensagem de atendimento, consultam suas ideias, leem a mensagem e listam negociações. 330 requisições. O cadastro já emite sessão, portanto não se exige login redundante. A criação e transição de solicitações/negociações também foram cobertas pelos testes funcionais completos.

Cada cenário mantém 50 SSE por uma janela mínima de 15 s. Nos cenários A/C as requisições de um visitante são sequenciais e os 50 visitantes concorrem. Limites de abuso e IP compartilhado permanecem. Nenhum outro teste do agente foi executado em paralelo ao benchmark. A máquina não é dedicada: variação de processos externos não é eliminada. A ordem é sempre baseline seguida de final, sem randomização. A usa novas contas sintéticas sem histórico próprio; não representa contas com centenas de ideias ou conversas.

Foram reutilizadas duas estruturas sintéticas existentes em renolink_test, sem DDL, reset ou exclusões. Inicialmente cada lado tinha 786 usuários, 540 ideias e 1438 sessões. Na segunda repetição: 846, 590, 1568; no controle padrão: 906, 640, 1698, respectivamente. Cada lado ganha, por rodada, 60 usuários (50 de preparação e 10 de cadastro medido), 50 ideias, 50 mensagens e 130 sessões. A quantidade de registros é equivalente antes/depois de cada par de cenário e validada pelo gerador deste relatório; entre rodadas os dados crescem deliberadamente. IDs e tempos dos novos dados podem diferir por ordem de conclusão. Registros anteriores são comparados campo a campo no próprio lado; IDs únicos, relações e quantidades novas são verificados após cada cenário. Não se alegam duas cópias byte a byte idênticas.

Diferenças em relação à Fase 8.2: janela 15 s em vez de 60 s; três populações separadas; C realista com 30 autenticações em vez de 100 hashes de cadastro+login redundante. Por isso 5,28 s da Fase 8.2 não é um baseline comparável para C. Os arquivos control4/tuned8-1/tuned8-2 preservam os diagnósticos preliminares da sequência antiga; os dois realistic8 são a comparação final reproduzida do perfil opcional, e realistic-control4 mede o padrão entregue.

Percentis são de requisições individuais, não de pessoas ou da duração total de cada visita. HTTP SSE mede a abertura, não o fluxo completo. RPS ativo é requisições divididas pelo tempo até a última operação; não é capacidade sustentada. RPS por janela está no CSV. CPU é tempo do processo Node, incluindo threads nativas, e a porcentagem usa uma CPU lógica como 100%; memória é pico RSS amostrado a cada 100 ms. A média de CPU na janela inclui o período ocioso com SSE. Não foi medida CPU/IO do serviço MySQL, CPU por função nem CPU por requisição individual; atribuir isso por operação sob concorrência seria incorreto. O CSV repete recursos do cenário como contexto.

## Comparativo HTTP global — ms

| Rodada | Cenário | Variante | p50 | p95 | p99 | RPS ativo | Erros |
|---|---|---|---:|---:|---:|---:|---:|
| realistic8-1 | A | before | 162.78 | 477.71 | 548.00 | 213.03 | 0 |
| realistic8-1 | B | before | 477.37 | 4112.26 | 4376.25 | 22.68 | 0 |
| realistic8-1 | C | before | 40.62 | 2259.57 | 3349.45 | 79.55 | 0 |
| realistic8-1 | A | after | 150.73 | 386.58 | 459.15 | 251.01 | 0 |
| realistic8-1 | B | after | 453.06 | 3449.61 | 3550.48 | 28.04 | 0 |
| realistic8-1 | C | after | 36.72 | 2696.81 | 3556.69 | 65.75 | 0 |
| realistic8-2 | A | before | 203.05 | 626.44 | 709.77 | 175.61 | 0 |
| realistic8-2 | B | before | 475.49 | 4331.17 | 4617.55 | 21.51 | 0 |
| realistic8-2 | C | before | 43.92 | 2214.44 | 3268.23 | 76.92 | 0 |
| realistic8-2 | A | after | 171.14 | 376.32 | 447.24 | 242.32 | 0 |
| realistic8-2 | B | after | 587.65 | 3765.70 | 3913.58 | 25.34 | 0 |
| realistic8-2 | C | after | 40.21 | 2339.99 | 3179.37 | 72.73 | 0 |
| realistic-control4 | A | before | 173.85 | 435.92 | 495.46 | 212.05 | 0 |
| realistic-control4 | B | before | 484.21 | 4544.36 | 4839.99 | 20.54 | 0 |
| realistic-control4 | C | before | 42.94 | 2236.64 | 3342.46 | 78.95 | 0 |
| realistic-control4 | A | after | 149.98 | 371.88 | 427.98 | 255.52 | 0 |
| realistic-control4 | B | after | 458.69 | 4302.53 | 4583.45 | 21.75 | 0 |
| realistic-control4 | C | after | 41.47 | 2178.55 | 3317.52 | 81.14 | 0 |

## Recursos por cenário

| Ensaio | CPU ms | CPU % de um núcleo | RSS MiB | Event loop p95/p99/máx ms | Crypto submetidas/pendentes na aplicação pico | SQL total | Conexões MySQL pico/limite |
|---|---:|---:|---:|---:|---:|---:|---:|
| realistic8-1/A/before | 2171.00 | 14.45 | 97.95 | 16.28/27.46/73.14 | 0/0 | 3510 | 5/5 |
| realistic8-1/B/before | 16437.00 | 109.36 | 221.50 | 17.04/28.20/49.51 | 50/0 | 2025 | 5/5 |
| realistic8-1/C/before | 12891.00 | 85.79 | 229.67 | 22.09/30.79/86.57 | 28/0 | 5386 | 5/5 |
| realistic8-1/A/after | 1843.00 | 12.27 | 100.57 | 16.24/26.44/54.20 | 0/0 | 3510 | 5/5 |
| realistic8-1/B/after | 16517.00 | 110.01 | 338.15 | 20.76/36.08/54.00 | 8/42 | 2100 | 5/5 |
| realistic8-1/C/after | 13703.00 | 91.26 | 334.09 | 25.76/34.24/222.43 | 8/14 | 5461 | 5/5 |
| realistic8-2/A/before | 2343.00 | 15.59 | 97.76 | 16.25/27.62/64.49 | 0/0 | 3510 | 5/5 |
| realistic8-2/B/before | 17313.00 | 115.26 | 224.50 | 19.99/31.56/53.87 | 50/0 | 2115 | 5/5 |
| realistic8-2/C/before | 13547.00 | 90.18 | 222.65 | 23.10/32.83/98.89 | 28/0 | 5371 | 5/5 |
| realistic8-2/A/after | 1953.00 | 13.00 | 99.96 | 16.26/29.00/50.36 | 0/0 | 3510 | 5/5 |
| realistic8-2/B/after | 18578.00 | 123.63 | 352.32 | 20.02/32.29/64.72 | 8/42 | 2130 | 5/5 |
| realistic8-2/C/after | 13671.00 | 91.01 | 334.50 | 22.87/33.49/193.72 | 8/13 | 5349 | 5/5 |
| realistic-control4/A/before | 2048.00 | 13.63 | 97.85 | 16.21/26.20/62.46 | 0/0 | 3510 | 5/5 |
| realistic-control4/B/before | 17375.00 | 115.60 | 224.88 | 18.38/32.39/56.89 | 50/0 | 2130 | 5/5 |
| realistic-control4/C/before | 13750.00 | 91.57 | 226.75 | 21.58/32.52/84.28 | 30/0 | 5404 | 5/5 |
| realistic-control4/A/after | 2016.00 | 13.42 | 100.11 | 16.23/25.80/46.30 | 0/0 | 3510 | 5/5 |
| realistic-control4/B/after | 17515.00 | 116.65 | 225.41 | 20.27/30.61/51.71 | 4/46 | 2205 | 5/5 |
| realistic-control4/C/after | 13109.00 | 87.26 | 225.71 | 21.40/30.92/68.35 | 4/26 | 5419 | 5/5 |

Os cenários autenticados não executam scrypt. SQL total inclui SSE e inicialização; consultas por operação estão no detalhamento e CSV. A preparação de dados está fora da medição. Na carga mista há espera relevante no pool e na fila serial de gravação: liberar hashes mais cedo pode concentrar commits e aumentar a competição com as outras operações. Oito threads não resolve esses efeitos; não há evidência suficiente para aumentar o pool MySQL como resposta automática. A primeira rodada realista regrediu no p95 global misto, apesar de reduzir o tempo do scrypt. A observação de SQL/pool por operação deve orientar a próxima investigação.

## Decomposição observada — ms

| Ensaio | Credencial + pool p95 | Scrypt total p95 | Admissão p95 | Submissão-callback p95 | API persistência p95 | Pool p95 | Sonda libuv máx |
|---|---:|---:|---:|---:|---:|---:|---:|
| realistic8-1/B/before | 120.39 | 3978.72 | não separada | não separada | 91.03 | 103.76 | 3574.04 |
| realistic8-1/C/before | 383.57 | 2614.50 | não separada | não separada | 899.87 | 318.46 | 1922.48 |
| realistic8-1/B/after | 108.94 | 3243.78 | 2828.93 | 1101.22 | 460.22 | 102.38 | 241.20 |
| realistic8-1/C/after | 752.71 | 1512.11 | 1027.54 | 1063.46 | 1408.15 | 587.16 | 312.86 |
| realistic8-2/B/before | 89.90 | 4203.42 | não separada | não separada | 53.09 | 78.34 | 4142.45 |
| realistic8-2/C/before | 394.68 | 2493.05 | não separada | não separada | 901.69 | 310.06 | 1759.41 |
| realistic8-2/B/after | 142.11 | 3580.99 | 3073.08 | 1388.22 | 533.23 | 129.69 | 408.69 |
| realistic8-2/C/after | 750.56 | 1370.64 | 820.67 | 763.88 | 1122.98 | 612.85 | 297.46 |
| realistic-control4/B/before | 103.72 | 4577.39 | não separada | não separada | 91.73 | 81.45 | 4344.98 |
| realistic-control4/C/before | 309.42 | 2652.18 | não separada | não separada | 862.11 | 248.18 | 1865.42 |
| realistic-control4/B/after | 98.36 | 4197.16 | 3871.72 | 398.19 | 63.58 | 89.63 | 227.11 |
| realistic-control4/C/after | 332.42 | 2647.65 | 2285.59 | 433.81 | 868.76 | 279.24 | 312.81 |

O scrypt total inclui espera na fila de admissão e o intervalo da chamada nativa ao callback. **Submissão-callback não é CPU pura**: inclui execução, eventual espera interna do libuv e entrega do callback. Não existe sinal de início de execução do scrypt na API Node utilizada. A fila de admissão é medida exatamente; a espera interna é observada indiretamente pela sonda, sem inventar uma separação numérica. Percentis de etapas não devem ser somados. Na baseline a fila interna não é separável; zero pendentes na aplicação significa ausência de fila própria, não ausência de espera no libuv. Campos de fila não medidos ficam vazios no CSV. Event loop lag é medido por monitorEventLoopDelay com resolução de 10 ms.

O CSV contém tempos por operação de busca de credencial, scrypt, fila, construção da sessão, persistência da API, pool, rate limiting e validações com leitura do corpo. Construção da sessão é apenas token/cookie/objeto; persistência da API inclui fila de gravação, reler e validar o escopo, INSERT da sessão, atualização de contadores e commit. O JSON registra separadamente cada comando SQL, incluindo INSERT de sessão e COMMIT. O tempo de rate limiting por operação é a soma das chamadas instrumentadas daquele pedido; validações incluem parsing/leitura do corpo e não são uma medição pura de CPU.

## HTTP por operação — ms

| Ensaio | Operação | N | p50 | p95 | p99 | SQL atribuídas |
|---|---|---:|---:|---:|---:|---:|
| realistic8-1/A/before | GET /api/events | 50 | 417.93 | 548.00 | 555.29 | 750 |
| realistic8-1/A/before | GET /api/me | 50 | 244.90 | 368.67 | 369.10 | 450 |
| realistic8-1/A/before | GET /api/ideas?mine=1 | 50 | 156.82 | 164.81 | 165.31 | 500 |
| realistic8-1/A/before | GET /api/negotiations | 50 | 156.50 | 162.18 | 165.00 | 500 |
| realistic8-1/A/before | GET /api/team/conversations | 50 | 150.26 | 165.45 | 168.52 | 500 |
| realistic8-1/A/before | GET /api/portal/dashboard | 50 | 165.77 | 170.47 | 177.20 | 600 |
| realistic8-1/B/before | POST /api/auth/login | 50 | 2518.45 | 4188.44 | 4376.25 | 750 |
| realistic8-1/B/before | GET /api/events | 50 | 24.27 | 54.55 | 57.59 | 750 |
| realistic8-1/C/before | GET /api/events | 50 | 41.05 | 422.94 | 427.52 | 750 |
| realistic8-1/C/before | POST /api/ideas | 50 | 497.64 | 922.80 | 938.42 | 750 |
| realistic8-1/C/before | POST /api/auth/register | 10 | 1658.54 | 2185.13 | 2185.13 | 140 |
| realistic8-1/C/before | POST /api/team/conversations | 50 | 582.66 | 922.31 | 942.26 | 850 |
| realistic8-1/C/before | GET /api/ideas?mine=1 | 50 | 18.38 | 40.62 | 45.01 | 550 |
| realistic8-1/C/before | GET /api/team/conversations/:id/messages | 50 | 19.72 | 42.06 | 46.49 | 550 |
| realistic8-1/C/before | GET /api/negotiations | 50 | 14.81 | 36.69 | 47.39 | 500 |
| realistic8-1/C/before | POST /api/auth/login | 20 | 2961.99 | 3589.29 | 3589.29 | 300 |
| realistic8-1/A/after | GET /api/events | 50 | 327.45 | 459.15 | 461.38 | 750 |
| realistic8-1/A/after | GET /api/me | 50 | 233.06 | 316.35 | 321.28 | 450 |
| realistic8-1/A/after | GET /api/ideas?mine=1 | 50 | 148.15 | 162.40 | 163.16 | 500 |
| realistic8-1/A/after | GET /api/negotiations | 50 | 145.73 | 160.86 | 162.59 | 500 |
| realistic8-1/A/after | GET /api/team/conversations | 50 | 137.27 | 142.21 | 143.24 | 500 |
| realistic8-1/A/after | GET /api/portal/dashboard | 50 | 152.37 | 156.38 | 157.20 | 600 |
| realistic8-1/B/after | POST /api/auth/login | 50 | 2182.64 | 3500.25 | 3550.48 | 750 |
| realistic8-1/B/after | GET /api/events | 50 | 29.56 | 69.58 | 73.90 | 750 |
| realistic8-1/C/after | GET /api/events | 50 | 35.96 | 777.54 | 863.41 | 750 |
| realistic8-1/C/after | POST /api/ideas | 50 | 1184.43 | 1469.93 | 1488.02 | 750 |
| realistic8-1/C/after | POST /api/auth/register | 10 | 2067.42 | 2433.70 | 2433.70 | 140 |
| realistic8-1/C/after | POST /api/team/conversations | 50 | 1055.45 | 1469.36 | 1511.76 | 850 |
| realistic8-1/C/after | GET /api/ideas?mine=1 | 50 | 16.94 | 40.62 | 42.59 | 550 |
| realistic8-1/C/after | GET /api/team/conversations/:id/messages | 50 | 12.72 | 38.56 | 57.87 | 550 |
| realistic8-1/C/after | GET /api/negotiations | 50 | 12.03 | 33.76 | 36.49 | 500 |
| realistic8-1/C/after | POST /api/auth/login | 20 | 2937.90 | 3619.08 | 3619.08 | 300 |
| realistic8-2/A/before | GET /api/events | 50 | 549.99 | 709.77 | 724.88 | 750 |
| realistic8-2/A/before | GET /api/me | 50 | 287.42 | 477.28 | 480.17 | 450 |
| realistic8-2/A/before | GET /api/ideas?mine=1 | 50 | 176.48 | 184.03 | 184.43 | 500 |
| realistic8-2/A/before | GET /api/negotiations | 50 | 191.32 | 206.95 | 210.62 | 500 |
| realistic8-2/A/before | GET /api/team/conversations | 50 | 200.72 | 213.13 | 215.48 | 500 |
| realistic8-2/A/before | GET /api/portal/dashboard | 50 | 204.97 | 212.64 | 212.91 | 600 |
| realistic8-2/B/before | POST /api/auth/login | 50 | 2520.16 | 4397.14 | 4617.55 | 750 |
| realistic8-2/B/before | GET /api/events | 50 | 28.20 | 52.33 | 58.99 | 750 |
| realistic8-2/C/before | GET /api/events | 50 | 45.56 | 433.71 | 442.07 | 750 |
| realistic8-2/C/before | POST /api/ideas | 50 | 589.35 | 929.28 | 968.08 | 750 |
| realistic8-2/C/before | POST /api/auth/register | 10 | 1704.32 | 2142.75 | 2142.75 | 140 |
| realistic8-2/C/before | POST /api/team/conversations | 50 | 645.66 | 951.10 | 989.57 | 850 |
| realistic8-2/C/before | GET /api/ideas?mine=1 | 50 | 18.47 | 46.89 | 58.37 | 550 |
| realistic8-2/C/before | GET /api/team/conversations/:id/messages | 50 | 13.45 | 51.76 | 62.15 | 550 |
| realistic8-2/C/before | GET /api/negotiations | 50 | 11.65 | 42.76 | 56.11 | 500 |
| realistic8-2/C/before | POST /api/auth/login | 20 | 2795.22 | 3583.52 | 3583.52 | 300 |
| realistic8-2/A/after | GET /api/events | 50 | 320.05 | 447.24 | 449.79 | 750 |
| realistic8-2/A/after | GET /api/me | 50 | 233.60 | 313.81 | 317.71 | 450 |
| realistic8-2/A/after | GET /api/ideas?mine=1 | 50 | 150.09 | 176.92 | 178.31 | 500 |
| realistic8-2/A/after | GET /api/negotiations | 50 | 167.74 | 176.24 | 177.05 | 500 |
| realistic8-2/A/after | GET /api/team/conversations | 50 | 133.85 | 138.32 | 138.89 | 500 |
| realistic8-2/A/after | GET /api/portal/dashboard | 50 | 175.43 | 183.11 | 184.29 | 600 |
| realistic8-2/B/after | POST /api/auth/login | 50 | 2483.77 | 3843.25 | 3913.58 | 750 |
| realistic8-2/B/after | GET /api/events | 50 | 27.68 | 90.11 | 129.41 | 750 |
| realistic8-2/C/after | GET /api/events | 50 | 35.10 | 727.03 | 806.76 | 750 |
| realistic8-2/C/after | POST /api/auth/register | 10 | 1606.71 | 2009.44 | 2009.44 | 140 |
| realistic8-2/C/after | POST /api/ideas | 50 | 951.39 | 1157.92 | 1160.35 | 750 |
| realistic8-2/C/after | POST /api/team/conversations | 50 | 951.18 | 1153.42 | 1166.50 | 850 |
| realistic8-2/C/after | GET /api/ideas?mine=1 | 50 | 15.76 | 45.90 | 57.59 | 550 |
| realistic8-2/C/after | GET /api/team/conversations/:id/messages | 50 | 12.49 | 46.36 | 56.46 | 550 |
| realistic8-2/C/after | GET /api/negotiations | 50 | 11.29 | 32.29 | 36.55 | 500 |
| realistic8-2/C/after | POST /api/auth/login | 20 | 2708.73 | 3282.16 | 3282.16 | 300 |
| realistic-control4/A/before | GET /api/events | 50 | 374.12 | 495.46 | 497.39 | 750 |
| realistic-control4/A/before | GET /api/me | 50 | 235.06 | 350.49 | 351.13 | 450 |
| realistic-control4/A/before | GET /api/ideas?mine=1 | 50 | 245.85 | 253.24 | 253.82 | 500 |
| realistic-control4/A/before | GET /api/negotiations | 50 | 143.92 | 151.72 | 153.91 | 500 |
| realistic-control4/A/before | GET /api/team/conversations | 50 | 134.55 | 144.10 | 146.65 | 500 |
| realistic-control4/A/before | GET /api/portal/dashboard | 50 | 167.69 | 198.16 | 204.09 | 600 |
| realistic-control4/B/before | POST /api/auth/login | 50 | 2567.30 | 4751.78 | 4839.99 | 750 |
| realistic-control4/B/before | GET /api/events | 50 | 29.36 | 56.28 | 134.52 | 750 |
| realistic-control4/C/before | GET /api/events | 50 | 45.38 | 350.27 | 356.02 | 750 |
| realistic-control4/C/before | POST /api/ideas | 50 | 519.57 | 908.04 | 924.96 | 750 |
| realistic-control4/C/before | POST /api/team/conversations | 50 | 600.89 | 945.65 | 998.37 | 850 |
| realistic-control4/C/before | GET /api/ideas?mine=1 | 50 | 18.20 | 42.47 | 58.55 | 550 |
| realistic-control4/C/before | POST /api/auth/register | 10 | 1665.27 | 2112.88 | 2112.88 | 140 |
| realistic-control4/C/before | GET /api/team/conversations/:id/messages | 50 | 20.00 | 48.18 | 50.91 | 550 |
| realistic-control4/C/before | GET /api/negotiations | 50 | 15.37 | 46.08 | 51.17 | 500 |
| realistic-control4/C/before | POST /api/auth/login | 20 | 2907.38 | 3584.07 | 3584.07 | 300 |
| realistic-control4/A/after | GET /api/events | 50 | 314.28 | 427.98 | 431.14 | 750 |
| realistic-control4/A/after | GET /api/me | 50 | 216.94 | 295.22 | 299.40 | 450 |
| realistic-control4/A/after | GET /api/ideas?mine=1 | 50 | 137.03 | 146.43 | 148.03 | 500 |
| realistic-control4/A/after | GET /api/negotiations | 50 | 149.26 | 152.15 | 153.53 | 500 |
| realistic-control4/A/after | GET /api/team/conversations | 50 | 145.84 | 149.13 | 149.49 | 500 |
| realistic-control4/A/after | GET /api/portal/dashboard | 50 | 156.47 | 162.25 | 163.29 | 600 |
| realistic-control4/B/after | POST /api/auth/login | 50 | 2501.48 | 4390.57 | 4583.45 | 750 |
| realistic-control4/B/after | GET /api/events | 50 | 22.71 | 48.37 | 64.43 | 750 |
| realistic-control4/C/after | GET /api/events | 50 | 42.27 | 358.71 | 365.95 | 750 |
| realistic-control4/C/after | POST /api/ideas | 50 | 491.94 | 912.54 | 964.48 | 750 |
| realistic-control4/C/after | POST /api/auth/register | 10 | 1577.01 | 2082.02 | 2082.02 | 140 |
| realistic-control4/C/after | POST /api/team/conversations | 50 | 546.57 | 933.44 | 964.44 | 850 |
| realistic-control4/C/after | GET /api/ideas?mine=1 | 50 | 16.64 | 46.01 | 50.77 | 550 |
| realistic-control4/C/after | GET /api/team/conversations/:id/messages | 50 | 16.99 | 39.39 | 50.45 | 550 |
| realistic-control4/C/after | GET /api/negotiations | 50 | 15.69 | 38.50 | 42.87 | 500 |
| realistic-control4/C/after | POST /api/auth/login | 20 | 2894.85 | 3505.80 | 3505.80 | 300 |

CSV: renolink_funcional/data/runtime/phase83-operacoes.csv. O CSV mostra a consulta SQL de credencial separadamente; o JSON detalha os demais comandos. Não se somam percentis de consultas distintas, pois isso não produz um percentil agregado válido.

## Testes funcionais, segurança e integridade

- 52 testes locais aprovados (45 anteriores + 7 da fila, compatibilidade e atualização de hash).
- Integração MySQL: paridade de 16 rotas em cinco contextos, privacidade de IDs, paginação, concorrência de 20 ideias e rollback por falha SQL induzida; suíte adicional de autenticação, cadastro, aprovação/rejeição, atendimento, solicitações, negociações, auditoria, revogação e persistência em outro processo Node, sem executar migração.
- Chrome automatizado: dois visitantes e administrador em sessões independentes, eventos privados, aprovação, respostas, solicitações, reconexão offline/reinício do Node, ausência de duplicações, viewport móvel emulado e desktop. Não foram feitos testes físicos ou novos testes nativos de Opera.
- Os 18 cenários finais passaram com 50 SSE cada, sem erro HTTP inesperado, queda de stream ou frame duplicado. Todos os dados sintéticos persistiram e foram verificados. Nenhum registro anterior foi perdido ou alterado pelo benchmark. A sobrecarga da fila foi testada deterministicamente: 503 sem executar o trabalho recusado; falhas liberam slots; FIFO e contexto assíncrono preservados.
- A troca de credencial entre a prova e a transação continua rejeitada. Senhas erradas não fazem upgrade; hashes com parâmetros adulterados são recusados; formatos atuais e legados continuam compatíveis. Sobrecarga não concede sessão nem contorna autorização.

## Preservação e arquivos

Snapshot somente de leitura de renolink_dev antes/depois: estado, schema e equipe idênticos. Estado final: {"users":8,"ideas":11,"negotiations":1,"messages":7,"sessions":12,"staff":1,"conversations":2,"supportMessages":4,"requests":1,"audit":11}. SHA-256 estado 769e197bb56c6c7776089d9fb501efbe1ddf102fde607408c55312bdf9dea7aa; schema 6c3b6aa742d9cc5e66f6d0e07061c661c89a88d59a216ec81b99068755c9f59e; equipe 9d41dd52adc7ab7aeea30b9b261b7f0b94d1cff02f4dc8a571e928cf6ab13a63. Hashes dos JSONs originais e operacionais idênticos em todos os ensaios. Nenhuma conta, permissão, administrador ou credencial real alterada; mudanças de dados limitadas às contas sintéticas em renolink_test. Nenhum parâmetro global, banco de outro projeto ou serviço MYSQL80 alterado. Nenhuma publicação.

Código: lib/security.js, lib/crypto-queue.js, lib/phase5.js e server.js. Ferramentas: scripts/test-phase83.ps1, phase83-benchmark.js, phase83-legacy.js, phase83-local-tests.js, phase83-report.js, start-auth-profile.ps1 e ajuste da allowlist de nomes de snapshot em phase7-dev-snapshot.js. Testes/fixtures: test/crypto-queue.test.js, test/phase83.mysql.test.js, test/fixtures/phase83-server.js e baseline-security congelado. package.json inclui os novos testes/comando. Relatórios brutos permanecem em data/runtime/phase83-* e não contêm credenciais. As senhas sintéticas e reais ficam apenas em memória durante os processos; cofre DPAPI não foi modificado.

## Operação e reprodução

No diretório renolink_funcional: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase83.ps1 -Mode Run -RunId nova-rodada. Não sobrescreve resultados existentes. Um RunId contendo control seleciona quatro threads no final; outro usa oito. As duas estruturas precisam continuar com quantidades equivalentes; divergência interrompe antes de continuar. Os dados sintéticos são mantidos, não há limpeza destrutiva.

Para testes: npm.cmd test; powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-phase83.ps1 -Mode Functional; scripts/test-phase7.ps1 -Mode Test. Não executar carga e regressões em paralelo. O gerador scripts/phase83-report.js recusa falta de evidência, mudança do código medido, cenário com erro ou snapshot dev divergente.

Início local opcional: powershell.exe -NoProfile -File scripts/start-auth-profile.ps1 -Threads 4 (padrão), ou -Threads 8 apenas após avaliar memória/CPU no destino. Não executado nesta fase. A rotina passa os dois valores para o novo processo Node e restaura o ambiente do PowerShell, sem gravar segredos/configurações globais. Não tentar substituir um processo já ativo. O uso normal de INICIAR_RENOLINK mantém o perfil padrão. Concorrência explicitamente maior que UV_THREADPOOL_SIZE e valores inválidos são recusados. Mudanças exigem novo processo Node; não reiniciar MySQL. A necessidade de definir o tamanho antes do início do processo e o compartilhamento do pool são descritos em [Node.js CLI](https://nodejs.org/api/cli.html#uv_threadpool_sizesize); o contexto dos trabalhos segue [AsyncResource](https://nodejs.org/api/async_context.html#class-asyncresource).

## Riscos e prontidão para hospedagem

Há evidência de boa navegação para estes 50 visitantes autenticados nestas rajadas curtas. **Não há evidência de boa experiência para 50 logins concorrentes, carga sustentada de feira, todos os administradores simultâneos ou infraestrutura pública.** Autenticação continua limitada por CPU/memória e distribuição de chegadas, e a fila finita pode retornar 503 sob sobrecarga maior. Requisições já admitidas podem continuar consumindo hash após desconexão do cliente. Rate limiting e fila são locais ao processo; múltiplas instâncias exigem avaliar proteção distribuída, sessões/eventos e afinidade sem relaxar segurança.

Recomendação: pronta para homologação de hospedagem e demonstração local supervisionada; ainda não validar operação pública para 50 autenticações simultâneas. Manter quatro hashes ativos como padrão conservador. Homologar oito apenas como alternativa para picos de login, com orçamento de memória e avaliação do cenário misto. Não aumentar paralelismo indiscriminadamente nem reduzir scrypt. Distribuir entrada/cadastro ao longo do tempo e preservar a sessão existente evita hashes desnecessários sem enfraquecer autenticação.

Como ponto de partida de homologação, inferido das medições e não garantia: CPU reservada, pelo menos quatro vCPU para comparar com este host e cerca de 4 GiB para aplicação + MySQL + margem operacional se compartilharem a máquina; medir novamente na CPU real, principalmente se forem vCPU compartilhadas. Banco persistente próximo da aplicação e TLS, HTTPS, segredos fora do repositório, backups/restauração verificados e monitoramento de latência por operação, rejeições/filas criptográficas, memória, SSE e pool. Confirmar IP de cliente via proxy confiável antes de ajustar limites de abuso; não confiar indiscriminadamente em X-Forwarded-For. Ensaiar carga sustentada, falhas, recuperação e dispositivos físicos no destino antes da feira. Nenhum serviço foi contratado ou publicado.
