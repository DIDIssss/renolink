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
  default 3306, mas deve seguir o provedor. Sugestão de banco: renolink_render.
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

SSE mantém heartbeat, reconexão, isolamento e invalidação existente. Testes
locais simulam o proxy; buffering, cabeçalhos reais, retomada do Free e celulares
externos continuam pendentes de homologação autorizada. O plano Free suspende
por inatividade e tem disco efêmero: não usar JSON, uploads locais ou backups
locais como persistência. Não há garantia medida de capacidade para 50 pessoas.

## Banco: plano offline, nenhuma execução automática

É necessário contratar/obter separadamente um MySQL acessível ao Render com TLS:
o Web Service Free não inclui um MySQL persistente. MYSQL80 não é uma alternativa.

```text
node scripts/render-schema.js --check
node scripts/render-schema.js --sql
```

Ambos são offline: não carregam credenciais nem conectam a um banco. O segundo
imprime SQL para revisão; não o envia a servidor algum. Reutiliza 001_initial.sql
e 002_phase5.sql, mantendo doze tabelas, relacionamentos e CHECKs de MySQL
8.0.17+ / 8.4 LTS. Acrescenta apenas o bootstrap de metadados versão 5, com
contadores em 1 e hash do DDL Fase 5 normalizado para LF. Não cria usuários,
administradores ou dados.

Execução futura: aprovar destino, conta migradora, backup e ausência de gravações;
usar somente schema novo/dedicado vazio, nunca renolink_dev/test/MYSQL80. A conta
runtime deve ser distinta. DDL MySQL pode fazer commit implícito: falha parcial
exige inspeção, sem reset. O INSERT de metadados exige todas as tabelas vazias,
não sobrescreve metadados e permite repetição sem duplicar registros. Não usar
IF NOT EXISTS para legitimar tabelas preexistentes divergentes. Conferir as
estruturas e o resultado final schema_version=5 antes de liberar a aplicação.
Não foi validada uma execução real em 8.0/8.4 nesta etapa.

Antes de iniciar, o backend conecta, verifica versão/destino e meta.schemaVersion=5.
Falha impede abertura da porta. Nenhuma migração roda no build/start. As rotas
de administrador exigirão uma concessão separada e autorizada no banco novo.

## Dados e ferramentas locais

`data/db.json` e `data/db.seed.json` foram retirados apenas do índice Git e
ignorados. Os originais locais foram comparados byte a byte com HEAD e
preservados. Também foram removidas as credenciais de demonstração do README.
Ainda é necessário criar um commit futuro com essas mudanças; nenhum push ocorreu.

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

Histórico local: o commit inicial contém os JSONs e as credenciais antigas do
README. Untracking não remove esse conteúdo do histórico/GitHub. Para eliminá-lo
será necessária reescrita coordenada e atualização remota, sujeitas a autorização.
Tratar senhas antigas como expostas caso tenham sido usadas, avaliar revogação
de sessões/troca de senha e reutilização em outros sistemas; nada disso foi feito.
Reescrita não remove cópias, forks, caches ou clones de terceiros automaticamente.

## Validação e pendências

```text
npm run test:render
```

No PowerShell com política restrita, usar `npm.cmd run test:render` sem alterar
políticas do Windows. A suíte usa armazenamento em memória, mocks SQL e HTTP
loopback; não acessa MySQL real. Foram aprovados 73 testes, sem falhas finais.
A suíte padrão `npm.cmd test` também passou: 112 testes, incluindo TLS com
servidor simulado e certificados sintéticos locais, sem conexão a MySQL real.
Essa suíte padrão inclui mocks PowerShell; para Linux/CI, usar test:render.
Uma barreira de leitura bloqueia os JSONs privados durante toda essa suíte,
para que sua presença no computador não mascare dependências de um clone limpo.
O patch postinstall foi conferido como já
aplicado e mysql2 ficou fixado em 3.24.6 no package.json e lockfile. Build Linux
real e homologação Render dependem de autorização e do banco externo.

Pendências: commit/publicação autorizados; tratamento do histórico; provedor MySQL,
grants e TLS reais; migração aprovada; primeiro administrador; testes HTTPS/SSE,
persistência, reinício e acesso móvel no serviço real. Nada foi publicado.

Referências: [Render web services](https://render.com/docs/web-services),
[health checks](https://render.com/docs/health-checks),
[variáveis da plataforma](https://render.com/docs/environment-variables),
[borda Render](https://render.com/articles/how-render-handles-ddos-attacks),
[redes Cloudflare IPv4](https://www.cloudflare.com/ips-v4) e
[IPv6](https://www.cloudflare.com/ips-v6).
