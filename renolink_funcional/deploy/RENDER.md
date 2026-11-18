# RenoLink no Render Free

Preparação local concluída; não houve deploy, conexão MySQL ou migração real.

## Configuração

| Campo | Valor |
|---|---|
| Runtime / plano / branch | Node / Free / main |
| Root Directory | `renolink_funcional` (sem barra invertida) |
| Build Command | `npm ci --omit=dev` |
| Start Command | `node server.js` |
| Health Check Path | `/health/ready` |
| Auto Deploy | Off |

`render.yaml`, na raiz Git, é um modelo para revisão. Não foi aplicado. Criar
um serviço ou aplicar um Blueprint publica a aplicação e exige autorização.
`npm start` continua sendo o inicializador Windows local; não usá-lo no Render.
O Node escuta em `0.0.0.0:$PORT` somente no perfil Render validado. Os perfis
locais continuam em 127.0.0.1. Não definir PORT manualmente na plataforma.

## Variáveis

Configurar os valores fixos de `deploy/render.env.example` no painel:
`NODE_ENV=production`, `NODE_VERSION=24.22.1`, `APP_ENV=render`,
`TRUST_PROXY=render`, `STORAGE_DRIVER=mysql`, `COOKIE_SECURE=1`,
`MYSQL_SSL=1`, `APP_LOG_FORMAT=json`.

Valores obrigatórios do operador, nunca no Git:

- `APP_ORIGIN`: origem HTTPS exata do endereço onrender.com atribuído, sem
  barra final; deve corresponder a RENDER_EXTERNAL_HOSTNAME.
- `MYSQL_HOST`: DNS do provedor externo, correspondente ao certificado TLS.
  IPs, localhost e domínios .local são recusados neste perfil.
- `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`: destino
  dedicado, conta de aplicação sem root e sem privilégios DDL. A porta tem
  valor 3306 no Enzonic e o banco dedicado se chama `main`.
- `MYSQL_SSL_CA`, somente se necessário: caminho de um Secret File CA **público**,
  por exemplo `/etc/secrets/mysql-ca.pem`. Não fornecer chave privada.

`RENDER`, `RENDER_SERVICE_ID`, `RENDER_EXTERNAL_HOSTNAME` e `PORT` vêm da
plataforma. Não copiar configurações Windows, APP_ENV=fair, credenciais do
MYSQL80, permissões de migração ou TEST_MYSQL_* para esse ambiente.
Não há SECRET/JWT padrão: as sessões existentes usam tokens aleatórios e hashes
persistidos no MySQL. O servidor não carrega arquivos .env automaticamente.

## Proxy, saúde e SSE

O perfil exige a identidade de ambiente Render, Host exato, X-Forwarded-Proto
único igual a https e CF-Connecting-IP válido. A cadeia X-Forwarded-For é
validada da direita para a esquerda, removendo somente proxies privados e
redes publicadas da Cloudflare; o IP restante deve coincidir com a borda.
Prefixos arbitrários, cabeçalhos duplicados, peers públicos diretos e identidade
inconsistente são recusados. Forwarded/X-Real-IP/X-Forwarded-Host não concedem
confiança. Cookies, origem/CSRF e autorização continuam sendo verificados.

Fronteira de confiança: somente ingresso gerenciado Render, sem proxy adicional,
sem domínio personalizado nesta primeira configuração e sem serviços privados
não confiáveis na mesma workspace. Cabeçalhos não autenticam um proxy por si
só. Se a plataforma mudar sua topologia/cabeçalhos ou uma requisição legítima
for recusada, revisar evidências; não selecionar o primeiro IP arbitrariamente
nem desligar proteções. As redes Cloudflare foram consultadas em 16/11/2026.

Probes internos HTTP sem cabeçalhos de borda acessam exclusivamente GET
`/health/live` e `/health/ready`, com Host correto. A exceção não alcança APIs,
arquivos, login ou SSE. Ready consulta o MySQL e devolve 503 quando indisponível;
live verifica o processo. Os logs JSON omitem IP, cookies, corpo e query string.
Falhas de inicialização registram `startup_failed` com `stage` e uma categoria
enumerada, sem texto ou código bruto da exceção. Esses campos distinguem
configuração do Render, configuração MySQL, conexão/TLS, schema e bind da porta.

SSE mantém heartbeat, reconexão, isolamento e invalidação existente. Testes
locais simulam o proxy; buffering, cabeçalhos reais, retomada do Free e celulares
externos continuam pendentes de homologação autorizada. O plano Free suspende
por inatividade e tem disco efêmero: não usar JSON, uploads locais ou backups
locais como persistência. Não há garantia medida de capacidade para 50 pessoas.

## Inicialização do MySQL Enzonic

O destino aprovado para preparação é `renolink-prod-m84hr0.db.enzonic.com:3306/main`. O estado desse banco só pode ser confirmado em uma consulta real autorizada. O GitHub recebeu a base limpa `e07173e`. As mudanças Enzonic são locais.

### Ambiente do Web Service

Use os campos da tabela acima e os valores de `deploy/render.env.example`. A origem é `https://<nome-atribuído>.onrender.com`, sem barra final. Preencha `MYSQL_PROVIDER=enzonic`, `MYSQL_HOST=renolink-prod-m84hr0.db.enzonic.com`, `MYSQL_PORT=3306`, `MYSQL_DATABASE=main` e `MYSQL_SSL=1`.

Forneça `MYSQL_USER` e `MYSQL_PASSWORD` como segredos de runtime no painel do Render, com conta dedicada ao aplicativo e sem DDL. Se o provedor disponibilizar apenas uma conta administrativa, confirme com ele como separar credenciais antes do deploy. Evite copiar a URL completa de conexão. O projeto usa os campos individuais. O mysql2 envia o DNS em SNI, exige cadeia confiável e verifica o hostname. Se a cadeia precisar de uma CA própria, obtenha o certificado público da CA por canal autenticado do provedor, monte como Secret File e informe `MYSQL_SSL_CA=/etc/secrets/mysql-ca.pem`. Falha de CA ou hostname bloqueia a conexão.

### Ensaio offline e operações futuras

Execute da pasta `renolink_funcional`. Somente o primeiro comando é offline.

| Etapa | Comando | Resultado esperado |
|---|---|---|
| Revisar plano offline | `node scripts/render-schema.js --check` | 12 tabelas, 13 instruções, `connected:false` |
| Inspecionar com autorização de leitura | `node scripts/enzonic-schema.js --check-empty` | `EMPTY_VERIFIED` |
| Inicializar após autorização de escrita | `node scripts/enzonic-schema.js --initialize-empty-main` | `EMPTY_SCHEMA_V5_VERIFIED` |

1. Na futura sessão privada do operador, injete os cinco campos públicos `MYSQL_PROVIDER/HOST/PORT/DATABASE/SSL` acima (todos com o prefixo `MYSQL_`), a CA se necessária e os segredos `ENZONIC_MIGRATOR_USER` e `ENZONIC_MIGRATOR_PASSWORD` por um gerenciador de segredos no ambiente **do processo**. Encerre a sessão após o uso. Mantenha a conta migradora fora do Render, do Git, de arquivos .env, do histórico do terminal e de comandos com URI ou senha. Os modos operacionais não usam `MYSQL_USER/PASSWORD` como fallback.
2. Reserve uma janela exclusiva para o schema, com o aplicativo e outros escritores fora dele. Confira a identidade do banco no painel Enzonic e a opção de recuperação disponível. O lock nomeado coordena clientes RenoLink que respeitam o mesmo lock. A exclusividade diante de outras ferramentas depende do operador.
3. Na inspeção, uma única conexão dedicada verifica banco selecionado, versão 8.4, cifra TLS, grants e inventário. Tabelas e views, rotinas, triggers e eventos devem totalizar zero. Um catálogo filtrado por permissões pode parecer vazio. A ferramenta exige prova de visibilidade por grants diretos abrangendo `main.*`, incluindo SELECT, EVENT, TRIGGER e visibilidade sobre todas as rotinas (por exemplo EXECUTE no schema). Grants globais suficientes já existentes também são reconhecidos. Permissões exclusivamente via roles ou revogações parciais podem tornar a prova inconclusiva. Pare e revise com o provedor se houver bloqueio. O procedimento não concede privilégios.
4. A inicialização adquire o lock sem espera e repete a inspeção na mesma conexão imediatamente antes do DDL. Exige também CREATE, REFERENCES e INSERT. Cria as tabelas dos dois SQLs versionados em ordem, com erro se o nome já existir, e insere apenas o metadado gerado pelo plano v5. Confere o inventário exato, uma linha de metadados com payload integral (versão, contadores e hash) e zero linhas nas outras onze tabelas. A conexão fecha ao final. Nenhum importador, arquivo de dados antigo ou etapa de administração integra esse fluxo.
5. MySQL confirma DDL implicitamente. Se houver erro, timeout ou perda da resposta, considere o estado indeterminado e inspecione antes de decidir o próximo passo. Repetir em destino parcial ou já inicializado é bloqueado pela inspeção. O utilitário não faz rollback de DDL, reset nem repetição automática.
6. Só depois da verificação pós-DDL, homologar com credenciais de runtime, `/health/ready`, autenticação, SSE e uma retomada real após hibernação. Publicar o código e criar/iniciar o serviço são operações separadas.

### Hibernação e pool

O plano gratuito do Enzonic suspende o compute após cinco minutos **sem conexões** e a próxima conexão espera a retomada. Com mysql2 3.24.6, o coletor de conexões livres só é ativado quando `maxIdle < connectionLimit`. O perfil Enzonic mantém cinco conexões simultâneas, até quatro livres e descarta as ociosas após cerca de 60 segundos. O tempo de conexão passa de 5 para 30 segundos para acomodar o despertar. O valor é uma margem inicial, ainda sem medição nesse destino. Conexões ativas não são removidas pelo coletor. O driver retira do pool conexões encerradas, mas uma operação em andamento pode falhar durante uma interrupção. Escritas não são repetidas automaticamente.

O Render consulta o health check a intervalos de poucos segundos e exige resposta HTTP em cinco segundos. A consulta de readiness e acessos SSE podem manter o banco acordado enquanto o serviço está ativo. Na homologação, meça a primeira conexão após suspensão real e a primeira resposta bem-sucedida de readiness. O timeout da conexão do driver não amplia o prazo da probe da plataforma. [Enzonic MySQL](https://enzonic.dev/databases/mysql/) · [Hibernação Enzonic](https://enzonic.com/cloud/databases) · [Health checks do Render](https://render.com/docs/health-checks)

## Dados e ferramentas locais

`data/db.json` e `data/db.seed.json` foram retirados apenas do índice Git e
ignorados. Os originais locais foram comparados byte a byte com HEAD e
preservados. Também foram removidas as credenciais de demonstração do README.
A versão limpa foi publicada no GitHub em `e07173e`.

Dependências que continuam exclusivamente locais e exigem arquivos privados:

- `server.js`: somente o modo JSON de desenvolvimento usa data/db.json como origem.
- `reset-db.js`: ferramenta legada usa os dois originais; não executar no Render.
- `scripts/{inspect-mysql,inspect-mysql-dev,migrate-mysql-dev,migrate-postgres,
  preflight-mysql-dev,verify-mysql-dev,phase83-benchmark}.js`.
- `scripts/{mysql-dev,preflight-mysql-dev,diagnose-json-lock,remove-orphan-json-lock}.ps1`.
- Testes operacionais opcionais `{mysql.integration,phase5.mysql,phase6.mysql,
  phase83.mysql,phase9.https}.test.js` e `phase7.browser.js` usam hashes dos arquivos
  locais para verificar preservação. Não fazem parte de test:render e exigem
  preparação/autorização próprias; não importar os originais para CI.
- Migrador MySQL genérico exige --source explícito; fontes privadas não são
  distribuídas. O plano Render não importa dados nem usa JSON operacional.

`test/security.test.js` agora verifica preservação de uma fixture vazia sintética;
os demais testes padrão usam fixtures geradas, em diretórios temporários ou memória.

O histórico anterior à limpeza continha os JSONs e as credenciais antigas do README.
Tratar senhas antigas como expostas caso tenham sido usadas, avaliar revogação
de sessões/troca de senha e reutilização em outros sistemas; nada disso foi feito.
Reescrita não remove cópias, forks, caches ou clones de terceiros automaticamente.

## Validação e pendências

```text
npm run test:render
```

No PowerShell com política restrita, usar `npm.cmd run test:render` sem alterar
políticas do Windows. A suíte usa armazenamento em memória, mocks SQL e HTTP
loopback; não acessa MySQL real. A suíte portátil com os oito testes Enzonic passou em 81 testes.
A suíte padrão `npm.cmd test` também passou: 112 testes, incluindo TLS com
servidor simulado e certificados sintéticos locais, sem conexão a MySQL real.
Essa suíte padrão inclui mocks PowerShell; para Linux/CI, usar test:render.
Uma barreira de leitura bloqueia os JSONs privados durante toda essa suíte,
para que sua presença no computador não mascare dependências de um clone limpo.
O patch postinstall foi conferido como já
aplicado e mysql2 ficou fixado em 3.24.6 no package.json e lockfile. Build Linux
real e homologação Render dependem de autorização e do banco externo.

Pendências para o Enzonic e o Render incluem a inspeção real de TLS, grants e inventário, a inicialização autorizada, a publicação das alterações locais e a homologação do serviço.

Referências: [Render web services](https://render.com/docs/web-services),
[health checks](https://render.com/docs/health-checks),
[variáveis da plataforma](https://render.com/docs/environment-variables),
[borda Render](https://render.com/articles/how-render-handles-ddos-attacks),
[redes Cloudflare IPv4](https://www.cloudflare.com/ips-v4) e
[IPv6](https://www.cloudflare.com/ips-v6).
