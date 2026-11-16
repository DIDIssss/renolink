# RenoLink — Fase 10.7: preparação do banco isolado da feira

Data: 01/11/2026  
Escopo: revisão de código, modelos e documentação da feira, fixture sintética e
testes locais com mocks. Não houve conexão a banco real, acesso ao cofre,
instalação, alteração do Windows/serviços, migração, backup/restore ou
publicação.

## Conclusão

O alvo de planejamento passa a ser Node em `127.0.0.1:3100` e MySQL
independente em `127.0.0.1:3307`, schema `renolink_feira`. O desenvolvimento
permanece em `127.0.0.1:3000`. O modelo Cloudflare encaminha somente para
`http://127.0.0.1:3100`, com fallback 404; o tunnel não foi criado nem testado.

Foi encontrada e corrigida uma lacuna de preparação: o migrador incluía apenas
o DDL inicial, mas o runtime da versão 5 também depende das cinco tabelas da
Fase 5. Somente no perfil `APP_ENV=fair`, o migrador agora lista e prepara as
12 tabelas InnoDB dos arquivos `001_initial.sql` e `002_phase5.sql`; o caminho
base continua com as sete tabelas originais. Isso foi verificado estaticamente
e por teste; nenhuma migração foi executada.

O destino Feira falha fechado sem TLS verificado, CA, schema, usuário, host,
porta e UUID esperados. As conexões Feira também conferem `DATABASE()`,
`@@port` e `@@server_uuid` antes das operações; os outros perfis preservam a
consulta de identidade anterior e a porta padrão de desenvolvimento.

**O ambiente não existe e não está homologado.** Banco, contas, grants,
certificado, UUID aprovado, bind/firewall, cobertura de segurança do Windows,
backup, restauração e testes externos continuam pendentes.

## Revisão das fases 10.1–10.6

- As Fases 10.1–10.3 registram Windows 10 22H2 com ESU não comprovada, MySQL
  compartilhado observado em listeners wildcard e incerteza residual sobre
  SSH/firewall/dependências. Não alterar nem reutilizar o serviço `MYSQL80`
  observado; a topologia da Feira deve usar instância e diretório de dados
  separados.
- A Fase 10.4 preparou modelos inativos e o caminho de loopback na porta 3100.
  Essa porta passa a ser a decisão explícita desta fase; 3000 continua sendo o
  default atual de desenvolvimento.
- A Fase 10.5 identificou privilégio excessivo no caminho antigo de startup e
  seleção implícita de JSON. A Fase 10.6 implementou inicialização sem snapshot
  completo e origem explícita.
- Permanecem válidas as pendências operacionais anteriores: sistema com
  suporte, ACLs/conta Windows dedicada, isolamento de portas, TLS real,
  backup/restore, celulares, SSE, carga e autorização para qualquer exposição.

## Alterações preparadas

- `renolink_funcional/lib/mysql.js`
  - Perfil `APP_ENV=fair` agora aceita somente `127.0.0.1:3307`,
    `renolink_feira`, `renolink_feira_app` (runtime) ou
    `renolink_feira_migrator` (migração), senha não vazia, TLS com CA e
    verificação de certificado/identidade, além de
    `RENOLINK_FAIR_MYSQL_SERVER_UUID` válido.
  - Cada conexão Feira valida o schema selecionado, a porta do servidor e seu
    `@@server_uuid` antes de lock, leitura, escrita, credenciais e readiness.
    Divergência interrompe antes do `GET_LOCK`.
  - Fora do perfil Feira, a consulta de identidade e o comportamento do app
    continuam como antes. Nenhuma porta ou configuração global foi alterada.
- `renolink_funcional/scripts/migrate-mysql.js`
  - Somente no perfil `APP_ENV=fair`, o plano de criação inclui as sete tabelas
    iniciais e as cinco tabelas aditivas da Fase 5; o modo base mantém as sete
    tabelas anteriores.
  - A validação do destino Feira, incluindo conta migradora e UUID esperado,
    ocorre antes de criar backup ou abrir conexão.
- `renolink_funcional/scripts/create-fair-fixture.js` e
  `renolink_funcional/test/fixtures/fair-synthetic.js` (novos)
  - Geram dados fictícios apenas mediante caminho absoluto fora do projeto,
    diretório já existente e arquivo de saída ainda inexistente.
  - As quatro contas usam endereços `.invalid`; os hashes são gerados com
    segredos aleatórios efêmeros que não são armazenados nem impressos. Não
    existem sessões. Isso não cria credenciais utilizáveis; eventual teste de
    login exige credenciais sintéticas separadas e aprovação própria.
- Testes MySQL/hosting adicionados para UUID/porta/schema, recusa de destino
  incorreto, fixture relacional, proteção contra sobrescrita, lista DDL de 12
  tabelas e túnel/porta planejados.
- `deploy/windows-fair/fair.env.example`, `Start-Fair.ps1`,
  `cloudflared.yml.example`, `README.md` e `backup-restore.example.md`
  documentam `renolink_feira`, as identidades separadas, o UUID exigido e a
  porta 3100. O UUID de exemplo está vazio intencionalmente e o startup o
  recusa.
- `database/mysql/README.md` explica que o migrador Feira também prepara as
  tabelas Fase 5 e exige identidade da instância.

## Privilégios: análise do código

Os privilégios a seguir são uma proposta para revisão, não foram concedidos.
Os usuários MySQL devem ter host exato `127.0.0.1`, sem roles herdadas,
`GRANT OPTION`, privilégios globais ou acesso a dev/test. O role funcional
`admin` da RenoLink é autorização da aplicação; não é conta MySQL administrativa.

### Inicialização e execução

- Startup v5 e readiness: `SELECT` em `renolink_meta` para conferir
  `schemaVersion`. A consulta de identidade lê `DATABASE()`, `VERSION()`,
  `@@port` e `@@server_uuid`.
- Transações, `SET SESSION` e `GET_LOCK`/`RELEASE_LOCK` não exigem privilégios
  DML/DDL de tabela; o lock não é uma escrita de linha. O startup não precisa
  de `CREATE`, `ALTER`, `DROP`, `DELETE`, `FILE`, `PROCESS`, `SUPER`,
  `CREATE USER` ou `GRANT OPTION`.
- Operação normal materializa o snapshot completo, inclusive dados de contas,
  hashes/salts de senha, hashes de sessão e trilha de auditoria. Portanto o
  processo runtime precisa de `SELECT` nas 11 tabelas de aplicação, mesmo
  quando a requisição é de visitante. Isso é uma limitação de privacidade do
  modelo atual, não apenas uma concessão administrativa.
- Perfil runtime proposto, por tabela:

| Tabela | Privilégios runtime propostos | Motivo observado |
|---|---|---|
| `renolink_meta` | `SELECT`, `UPDATE` | versão e contadores; metadados são atualizados em transações. |
| `renolink_users` | `SELECT`, `INSERT`, `UPDATE` | cadastro, autenticação e atualização de hash de senha. |
| `renolink_ideas` | `SELECT`, `INSERT`, `UPDATE` | criação e moderação. |
| `renolink_negotiations` | `SELECT`, `INSERT`, `UPDATE` | criação e alteração de status. |
| `renolink_messages` | `SELECT`, `INSERT` | mensagens atuais são append-only. |
| `renolink_sessions` | `SELECT`, `INSERT`, `UPDATE` | emissão e revogação de sessão. |
| `renolink_staff` | `SELECT` | identificação de suporte/admin; provisionamento não é fluxo runtime. |
| `renolink_conversations` | `SELECT`, `INSERT`, `UPDATE` | abertura e estado do atendimento. |
| `renolink_support_messages` | `SELECT`, `INSERT` | mensagens de atendimento append-only. |
| `renolink_requests` | `SELECT`, `INSERT`, `UPDATE` | solicitações e status administrativo. |
| `renolink_audit` | `SELECT`, `INSERT` | leitura administrativa e eventos append-only. |
| `renolink_imports` | Nenhum | somente trilha de migração. |

Não há `DELETE` no caminho de persistência atual. O acesso amplo de leitura do
runtime continua expondo dados sensíveis ao processo; conceder somente grants
de tabela não limita o snapshot por papel da aplicação.

### Migração, provisionamento e manutenção

- **Migração de uso único:** identidade separada `renolink_feira_migrator`.
  O script consulta metadados e contagens, lê as 12 tabelas para verificação,
  cria estruturas e insere registros/manifesto. Proposta mínima: `CREATE`
  apenas no schema dedicado, `SELECT` e `INSERT` nas tabelas do schema e
  `REFERENCES` restrito às tabelas-pai necessárias para as FKs, se exigido
  pela versão/configuração MySQL. Não precisa de `UPDATE`, `DELETE`,
  `ALTER`, `DROP`, `FILE`, `PROCESS`, privilégios globais nem `GRANT OPTION`.
  O DDL faz commit implícito; falha pode deixar tabelas vazias, então exigir
  schema realmente novo e revisar definição antes de continuar.
- **Provisionador DBA:** `CREATE DATABASE`, `CREATE USER` e `GRANT` são ações
  administrativas do MySQL. Executar somente após autorização, em instância
  Feira identificada; não entregar esses privilégios ao Node. Escapar os
  `_` do nome do schema ao conceder privilégio de schema quando
  `partial_revokes` estiver desligado, conforme a semântica MySQL. Preferir
  grants por tabela sempre que possível; não usar wildcard sem confirmar que
  representa o schema literal.
- **Backup:** identidade separada somente de leitura, com `SELECT` limitado às
  tabelas Feira. Para o esquema atual, não há views, triggers, eventos ou
  rotinas; se isso mudar, revisar separadamente `SHOW VIEW`, `TRIGGER` e
  `EVENT`. Preferir dump consistente de InnoDB, `--single-transaction`,
  `--no-tablespaces` e `--set-gtid-purged=OFF`, sem `LOCK TABLES`, `PROCESS`,
  `FILE`, `RELOAD` ou credenciais inline. A ferramenta/criptografia/backup
  externo ainda não foram escolhidos ou testados.
- **Restauração:** conta distinta e uso único em schema de restauração vazio,
  previamente criado pelo DBA. Precisa de DDL para criar tabelas e `INSERT`
  para dados; manter limitada ao schema `renolink_feira_restore_<id>`.
  Não apontar ao schema operacional nem conceder direitos de restauração ao
  runtime.
- **Estrutura e auditoria:** `SHOW GRANTS` para a própria conta e
  `CURRENT_ROLE()` devem confirmar ausência de roles; não ampliar privilégio
  automaticamente se `SHOW CREATE TABLE` for recusado. Confirme a exigência
  de privilégio da versão MySQL usada; qualquer `SELECT` adicional permite
  leitura de linhas e precisa de autorização, não sendo um privilégio
  meramente estrutural.

## TLS e identificação local/remota

- Para um serviço MySQL **estritamente local**, bind somente em
  `127.0.0.1:3307`, instância/data directory/serviço separados, conta host
  `127.0.0.1`, firewall sem exposição e processo Windows dedicado são
  fronteiras essenciais. TLS não protege contra administrador local ou
  processo já comprometido. Tecnicamente, uma política local pode decidir
  sobre TLS conforme o modelo de ameaça; **o perfil RenoLink Feira atual,
  porém, exige TLS e não tem exceção**.
- No perfil atual, CA explícita, `rejectUnauthorized`, verificação de
  identidade do servidor e certificado com SAN para o IP `127.0.0.1` são
  obrigatórios; conta MySQL deve exigir conexão TLS. Falha de CA, nome,
  cipher ou UUID deve bloquear a ativação, nunca ser corrigida desligando
  validação.
- Se o banco for **remoto**, a política atual o recusa. Uma futura arquitetura
  teria de ser revista separadamente: TLS obrigatório ponta a ponta, SAN para
  hostname DNS aprovado, CA confiável, validação de identidade, credencial
  distinta, firewall restrito ao IP da aplicação, bind/ACL e auditoria de
  rede. Não encaminhar MySQL pelo Cloudflare Tunnel nem usar `127.0.0.1` como
  identidade remota.
- A identidade Feira não depende somente do nome do schema: validar
  `DATABASE()`, `@@server_uuid`, `@@port=3307`, host fixado, usuário
  `CURRENT_USER()`, TLS/cipher e certificado. Antes da autorização operacional,
  conferir também serviço/binário, configuração e `datadir` por inventário
  administrativo independente. Não usar `SHOW PROCESSLIST`/privilégio
  `PROCESS` como atalho.

## Fixture sintética

O gerador proposto, ainda não executado:

```powershell
node scripts/create-fair-fixture.js --output 'C:\ProgramData\RenoLink\fair\fixtures\renolink-feira-synthetic.json'
```

O diretório deve existir e ter ACL restrita antes; o comando recusa caminho
relativo, saída dentro do projeto e sobrescrita. Gera visitantes `.invalid`,
contas fictícias de atendimento/administração, ideia, mensagens, negociação,
solicitação, conversa, auditoria, schema v5 e hashes derivados de segredos
aleatórios efêmeros. Não copia nem registra senha, hash, salt ou sessão de
banco existente. O arquivo JSON contém hashes sintéticos necessários ao modelo
de dados; não contém senha em texto claro nem sessões válidas.

As contas geradas não têm senha conhecida e não servem para login direto. Para
exercitar autenticação/painel, provisionar credenciais fictícias separadas
após autorização, por mecanismo protegido e sem alterar contas reais.

## Verificações futuras propostas — comandos não executados

Os comandos abaixo são modelos para revisão e dependem de autorização de
provisionamento/acesso. Placeholders não são credenciais. O uso de um DBA deve
ser restrito ao schema e à instância confirmados:

```sql
CREATE DATABASE `renolink_feira`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE USER 'renolink_feira_app'@'127.0.0.1'
  IDENTIFIED BY '<SEGREDO_RUNTIME_FORNECIDO_POR_CANAL_PROTEGIDO>' REQUIRE SSL;
CREATE USER 'renolink_feira_migrator'@'127.0.0.1'
  IDENTIFIED BY '<SEGREDO_MIGRADOR_DISTINTO_E_PROTEGIDO>' REQUIRE SSL;
```

Não executar sem confirmar ausência do schema/contas, serviço e UUID. Os
`GRANT`s runtime devem ser aplicados por tabela segundo a matriz acima. Exemplo
de forma (repita somente para tabelas e privilégios autorizados):

```sql
GRANT SELECT, INSERT, UPDATE
  ON `renolink_feira`.`renolink_users`
  TO 'renolink_feira_app'@'127.0.0.1';
GRANT SELECT, INSERT
  ON `renolink_feira`.`renolink_audit`
  TO 'renolink_feira_app'@'127.0.0.1';
```

Para o migrador, emitir concessões temporárias específicas após conferir
`@@GLOBAL.partial_revokes` e a forma literal de escapar o schema: `CREATE` no
schema Feira; `REFERENCES` apenas nas tabelas-pai requeridas; `SELECT` e
`INSERT` somente nas tabelas da migração. Rever `SHOW GRANTS` antes de
prosseguir. Não incluir SQL de `DROP`, `DELETE`, wildcard global,
`GRANT OPTION` ou comandos de revogação automática.

Depois de provisionamento aprovado e obtenção independente do UUID, as
consultas de verificação propostas (não executadas nesta fase) são:

```sql
SELECT DATABASE() AS selected_database, @@port AS server_port,
       @@server_uuid AS server_uuid, VERSION() AS server_version,
       USER() AS login_identity, CURRENT_USER() AS privilege_account,
       CURRENT_ROLE() AS active_roles;
SHOW GRANTS;
SHOW SESSION STATUS LIKE 'Ssl_cipher';
SELECT @@GLOBAL.partial_revokes AS partial_revokes;
```

Critérios: schema exato `renolink_feira`; porta 3307; UUID igual ao UUID
aprovado; conta/host da função correta; `CURRENT_ROLE()` sem roles não
revisadas; grants sem privilégios extra/globais; cipher TLS não vazio e
identidade de certificado válida. IDs, dados de pessoas, hashes e conteúdo
não devem ir a logs/relatório. A comparação de UUID exige validar também
serviço/data directory por evidência administrativa, pois o UUID isolado não
prova bind nem exclusividade de arquivo de dados.

### Preflight e ativação futuros

Com fixture gerada e origem revisada, estes comandos também são apenas plano:

```powershell
# Preflight local do JSON: cria backup/manifesto; ainda não conecta ao MySQL.
$env:APP_ENV = 'fair'
$env:RENOLINK_FAIR_DB_ROLE = 'migrator'
$env:MYSQL_HOST = '127.0.0.1'
$env:MYSQL_PORT = '3307'
$env:MYSQL_DATABASE = 'renolink_feira'
$env:MYSQL_USER = 'renolink_feira_migrator'
$env:MYSQL_SSL = '1'
# MYSQL_PASSWORD e MYSQL_SSL_CA devem ser injetados por canal protegido.
$env:RENOLINK_FAIR_MYSQL_SERVER_UUID = '<UUID_DA_INSTANCIA_APROVADA>'
node scripts/migrate-mysql.js --check --source 'C:\ProgramData\RenoLink\fair\fixtures\renolink-feira-synthetic.json' --backup-dir 'C:\ProgramData\RenoLink\fair\backups'

# --apply altera o banco e exige autorização nova e explícita; não executar agora.
# A ativação Node exige perfil runtime, credencial runtime e aprovação separada.
```

Senha e CA devem chegar por canal protegido e nunca ser escritas nos comandos
acima, argumentos, logs ou repositório. `--check` valida origem/destino e cria
backup/manifesto local do JSON, sem conexão MySQL. `--apply` executa DDL e DML;
o primeiro startup lê metadado de schema e obtém lock/transação. Ambos exigem
aprovação específica antes de qualquer uso real.

## Validações executadas

- `node --test test/mysql.test.js test/mysql.read.test.js test/mysql.scopes.test.js test/hosting.test.js test/postgres.initialize.test.js`
  - **40 passaram, 0 falharam, 0 ignorados.** São testes locais com mocks,
    fixtures e arquivos temporários; nenhum teste MySQL/PostgreSQL real foi
    habilitado.
  - Foram testados destino Feira, divergência de banco/porta/UUID antes do
    lock, fixture sintética, recusa de sobrescrita, DDL Feira de 12 tabelas
    sem alterar as sete do modo base, readiness sem lock e tunnel limitado ao
    loopback.
- `node --check` passou em seis arquivos JavaScript alterados/novos.
- O parser PowerShell analisou `Start-Fair.ps1`, sem executar o script.
- Busca estática confirmou que o endpoint de tunnel específico da feira é
  somente `127.0.0.1:3100` com fallback 404; o código mantém o default 3000.
- A inspeção dos modelos confirmou senha e UUID vazios no exemplo e ausência
  de listener MySQL/SSH no ingress do túnel.
- Não foram executados `scripts/create-fair-fixture.js`, scripts de startup,
  preflight/migração, backup/restore, consultas SQL, conexão, nem teste externo.

## Ordem recomendada, reversão e autorizações

1. **Antes de banco:** resolver o bloqueio de suporte/ESU do Windows; confirmar
   se a instância e o serviço de feira podem coexistir sem alterar o `MYSQL80`
   compartilhado; obter aprovação administrativa para instalação/configuração
   de instância isolada, data directory, bind loopback, porta 3307 e firewall.
2. **Provisionar:** confirmar versão MySQL suportada; criar schema e contas
   exclusivamente com DBA autorizado; emitir CA/certificado para
   `127.0.0.1`; capturar UUID da instância e validar grants/roles.
3. **Fixture:** provisionar pasta fora do projeto com ACL; pedir aprovação
   explícita para gerar arquivo fictício e escolher retenção/eliminação. O
   gerador não sobrescreve arquivo.
4. **Migração:** revisar fixture, grants e backup; obter autorização separada
   para `--apply`. Usar a conta migradora apenas nessa janela. Não ativar
   runtime até verificar schema v5, contagens sintéticas e destino outra vez.
5. **Primeira execução local:** fornecer segredos protegidos à conta Windows
   dedicada, validar app em loopback 3100 e health/readiness com autorização
   de leitura. Testar flows com credenciais sintéticas separadas.
6. **Exposição:** só após HTTPS, cookies, proxy, SSE, rotas administrativas,
   backup/restore, celulares, falha/recuperação e carga; obter autorização
   externa separada para conta/tunnel/hostname. Nenhum recurso externo foi
   criado.

Reversão do código desta fase: restaurar somente os arquivos de código,
modelos e testes listados no histórico de alterações para a revisão anterior,
após revisão. Não tocar em dados, bancos ou serviços. Se uma implantação
futura já tiver gravado dados, parar o app, preservar banco e evidências e
restaurar somente em schema separado; não excluir schema/conta automaticamente
nem voltar a JSON antigo perdendo alterações.

## Pendências bloqueadoras

- Confirmação ESU/atualizações de segurança e política efetiva de portas 3306,
  33060 e 22; dependências de outros consumidores MySQL não inventariadas.
- Criação/identificação da instância MySQL isolada, bind real, serviço,
  diretório de dados, UUID, CA/certificado e negociação TLS não comprovados.
- Grants, roles herdadas, backup criptografado e restauração não foram
  verificadas em servidor.
- O modelo MySQL usa snapshot integral; grants `SELECT` runtime dão acesso a
  hashes/salts e dados de todas as coleções ao processo. Rever se essa
  exposição é aceitável antes da feira.
- Fixture gerada não tem senhas conhecidas; conta admin/support não poderá
  autenticar até autorização para provisionar credenciais sintéticas.
- Ativação, conectividade, conflitos de portas, hostname/tunnel, HTTPS externo,
  SSE, dispositivos, carga, disponibilidade e recuperação permanecem sem
  comprovação. Não declarar homologação nem publicar.
