# RenoLink — Fase 9.1: verificação final e plano de homologação

Data: 31/10/2026

## Decisão e escopo

Esta é uma revisão de planejamento. **Não foi realizada conexão com MySQL,
execução de testes, acesso ao cofre Windows, publicação, contratação ou criação
de recursos externos.** Não foram alterados dados nem configurações de
implantação. A hospedagem continua **não homologada**.

Foram revisados [`FASE_9.md`](./FASE_9.md), os modelos em
[`deploy/`](../renolink_funcional/deploy/), a política de hosting e MySQL e os
scripts de snapshot, diagnóstico e homologação. O registro
[`phase9-local-tests.json`](../renolink_funcional/data/runtime/phase9-local-tests.json)
confirma 62/62 testes locais aprovados; não foram repetidos. Os registros de
regressão e HTTPS local continuam sendo apenas evidência local; o teste HTTPS
marca `mysqlTlsValidated: false`.

## Verificações efetivamente realizadas

- **Integridade dos JSONs locais:** calculei SHA-256 sem gravar arquivos. Tanto
  `data/db.json` quanto `data/runtime/db.json` têm 7.690 bytes e hash
  `7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`,
  correspondendo ao valor registrado na evidência da fase 9.
- **Configurações:** o exemplo Nginx limita acesso a loopback, termina TLS em
  443, encaminha Node em `127.0.0.1:3000`, sobrescreve os cabeçalhos de proxy e
  desativa buffering/cache/gzip para SSE. O modelo `.env` deixa senha vazia e
  usa domínio fictício `.invalid`. O unit file systemd é apenas um modelo.
- **Não verificado:** estado atual de `renolink_dev`, TLS de MySQL real,
  Nginx/proxy real, disponibilidade, restauração de backup e carga externa.
  Não acessei o cofre para tentar obter credenciais.

### Correção importante sobre o snapshot existente

O relatório da fase 9 chamava a captura de `renolink_dev` de somente leitura.
Ao revisar o código, confirmei que
[`phase7-dev-snapshot.js`](../renolink_funcional/scripts/phase7-dev-snapshot.js)
invoca `mysql.transaction()`. Essa rotina obtém `GET_LOCK`, configura
`time_zone`/`sql_mode` na sessão e não inicia uma transação `READ ONLY`.
Embora o callback de snapshot não faça DML nas tabelas do aplicativo, o
procedimento **não satisfaz uma garantia estrita de somente leitura no servidor**.
Essa limitação foi corrigida no relatório
[`FASE_9.md`](./FASE_9.md); o comando antigo não deve ser reutilizado para a
verificação proposta abaixo.

## Procedimento independente proposto — aguarda aprovação

**Não conectei ao banco e este procedimento não foi executado.** A aprovação
solicitada é para revisar e autorizar esta sequência antes de qualquer conexão.
Não há script novo executado ou modo implícito de aprovação. O snapshot antigo
`phase7-dev-snapshot.js` não deve ser usado para este fim.

1. **Preparação sem segredos:** usar um cliente independente do fluxo de
   snapshot/escrita, sem importar `mysql.transaction()`, `mysqlStore()`,
   `mysql.pool()` ou scripts PowerShell. Não ler `.env`, `.clixml`, DPAPI nem
   cofre Windows. Depois de aprovação, o operador injeta diretamente no processo
   somente as variáveis de conexão necessárias; nenhuma senha é passada em
   argumento, impressa ou gravada.
2. **Alvo fixo e identidade:** destino fixo `127.0.0.1:3306` e
   `renolink_dev`; sem URL arbitrária. Conectar com a conta de auditoria
   previamente provisionada pelo DBA. Antes de ler tabelas, consultar
   `DATABASE()`, `CURRENT_USER()`, `CURRENT_ROLE()`, versão e nível de
   isolamento. Abortar sem ler dados se database/identidade forem diferentes,
   existir role ativa ou o servidor não for MySQL 8.0.17+/8.4.
3. **Provar grants antes da captura:** executar `SHOW GRANTS` sem cláusula
   `FOR` e inspecionar todas as linhas em memória. Aceitar somente `USAGE ON
   *.*` (se apresentado) e `SELECT` por coluna nos objetos aprovados de
   `renolink_dev`. Recusar grants de role diretos/herdados, privilégios
   globais/schema/table-wide além das colunas aprovadas, privilégios dinâmicos,
   escrita ou `GRANT OPTION`. Conferir `CURRENT_ROLE()` e
   `@@GLOBAL.mandatory_roles`; exigir nenhuma role ativa nem obrigatória. Se a
   lista efetiva não puder ser verificada sem ambiguidade, abortar. Não imprimir
   grants, nomes de conta ou identidades; relatar somente flags redigidas.
4. **Snapshot consistente e somente leitura:** exigir isolamento corrente
   `REPEATABLE-READ`; se não estiver ativo, abortar, sem tentar alterar a
   sessão. Iniciar explicitamente `START TRANSACTION WITH CONSISTENT SNAPSHOT,
   READ ONLY`. O sucesso desse comando estabelece o modo somente leitura da
   transação; não inferir esse modo de `@@transaction_read_only`, que é uma
   variável de configuração e não comprova por si só o modo da transação ativa.
   Fazer apenas SELECT dos registros das tabelas permitidas e `SHOW CREATE
   TABLE` para schema. Não emitir `SET`, `LOCK TABLES`, `GET_LOCK`, DML, DDL,
   comandos de migração, `COMMIT` ou chamadas de helpers de escrita.
   Ao terminar, encerrar com `ROLLBACK` e fechar a conexão; se qualquer guarda
   falhar, abortar e fechar.
5. **Cálculo em memória:** validar contagens e relações entre chaves. Não
   produzir hashes nem fingerprints de IDs/relacionamentos: não há referência
   histórica compatível e esses valores não serão registrados. Comparar
   contagens e, se todo DDL estiver acessível e normalizado
   compativelmente, o hash de schema. Para `staff`, comparar somente contagem:
   o hash histórico inclui dados `extra` que serão omitidos. **Não
   recalcular nem comparar o hash global antigo de estado:** isso exigiria ler
   campos pessoais e de autenticação omitidos. Não exibir nem persistir
   registros, IDs individuais, emails, mensagens, credenciais, salts, hashes de
   senha ou digests de sessão. Saída limitada a destino lógico, versão, guardas
   booleanas, contagens e resultado; não emitir hashes derivados de IDs ou
   relações.
6. **Comparar sem “reparar”:** comparar apenas valores para os quais há
   referência anterior. Divergência interrompe a conclusão; nunca aciona
   correção, restore, nova tentativa com outra conta ou mudança de dados.
   Persistência de um relatório local exigiria aprovação separada; por padrão,
   mostrar o resumo redigido no terminal e encerrar.

### SQL completo para revisão — não executado

Este bloco é uma proposta para implementação em cliente que valide os guards,
consuma os resultados sem imprimir linhas e feche a conexão. **Não copiar/
executar antes de aprovação do procedimento e da conta.** Os SELECTs de IDs e
relacionamentos são usados apenas em memória para contagem e validação
referencial. Nenhum ID individual entra no relatório. Não há
SELECT de nome, email, empresa, conteúdo de ideia/mensagem, detalhes de auditoria,
`salt`, `password_hash` ou `token_hash`.

```sql
-- Guardas de conexão: abortar se destino/conta/versão/isolamento divergirem.
SELECT DATABASE() AS selected_database,
       USER() AS presented_identity,
       CURRENT_USER() AS authenticated_account,
       CURRENT_ROLE() AS active_roles,
       @@GLOBAL.mandatory_roles AS mandatory_roles,
       VERSION() AS server_version,
       @@transaction_isolation AS transaction_isolation;

-- Inspecionar sem ecoar; rejeitar roles e grants fora do escopo de colunas.
SHOW GRANTS;

-- Obter snapshot consistente sem locks de aplicação nem alteração de sessão.
START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;

-- renolink_meta: omitir completamente a leitura de dados.
-- payload, schemaVersion e contadores ficam não verificados.

-- renolink_users: chave para validação de relações; omitir dados de perfil,
-- papel de aplicação, email, empresa, salt e hash.
SELECT id
FROM renolink_users
ORDER BY id;

-- renolink_ideas: IDs e autoria para checagem de relações; omitir todo conteúdo.
SELECT id, user_id
FROM renolink_ideas
ORDER BY id;

-- renolink_negotiations: IDs e referências; omitir status/conteúdo.
SELECT id, idea_id, creator_user_id, company_user_id
FROM renolink_negotiations
ORDER BY id;

-- renolink_messages: IDs e remetente/destinatário; nunca ler text.
SELECT id, from_user_id, to_user_id
FROM renolink_messages
ORDER BY id;

-- renolink_sessions: não ler token_hash. Agregar quantidade por usuário;
-- não retorna tokens, digests ou timestamps de sessão.
SELECT user_id, COUNT(*) AS session_count
FROM renolink_sessions
GROUP BY user_id
ORDER BY user_id;

-- renolink_staff: somente chave para contagem e validação referencial.
SELECT user_id
FROM renolink_staff
ORDER BY user_id;

-- renolink_conversations: IDs e referência ao visitante; omitir status/textos.
SELECT id, visitor_id
FROM renolink_conversations
ORDER BY id;

-- renolink_support_messages: IDs e referências; nunca ler text.
SELECT id, conversation_id, sender_id
FROM renolink_support_messages
ORDER BY id;

-- renolink_requests: IDs e referências; omitir status/detalhes.
SELECT id, idea_id, visitor_id
FROM renolink_requests
ORDER BY id;

-- renolink_audit: IDs e referências/target type; nunca ler detail.
SELECT id, actor_id, target_type, target_id
FROM renolink_audit
ORDER BY id;

-- Confirmar em memória o conjunto de nomes renolink_* esperado pelo snapshot.
-- Não registrar nomes inesperados; se o conjunto diferir, não comparar o hash.
SELECT TABLE_NAME
FROM information_schema.tables
WHERE TABLE_SCHEMA = 'renolink_dev'
  AND LEFT(TABLE_NAME, 9) = 'renolink_'
ORDER BY TABLE_NAME;

-- DDL/metadados das 12 tabelas presentes nos modelos atuais.
-- Se os privilégios existentes não autorizarem SHOW CREATE, omitir comparação
-- de schema; não ampliar grants automaticamente.
SHOW CREATE TABLE renolink_meta;
SHOW CREATE TABLE renolink_users;
SHOW CREATE TABLE renolink_ideas;
SHOW CREATE TABLE renolink_negotiations;
SHOW CREATE TABLE renolink_messages;
SHOW CREATE TABLE renolink_sessions;
SHOW CREATE TABLE renolink_staff;
SHOW CREATE TABLE renolink_conversations;
SHOW CREATE TABLE renolink_support_messages;
SHOW CREATE TABLE renolink_requests;
SHOW CREATE TABLE renolink_audit;
SHOW CREATE TABLE renolink_imports;

-- Encerrar explicitamente a transação somente leitura sem commit.
ROLLBACK;
```

`SHOW GRANTS` (sem `FOR`) é inspecionado antes da captura. O cliente deve
reconhecer estritamente a gramática e o escopo dos grants; qualquer linha
ambígua causa aborto. Aceitar somente `USAGE ON *.*` (se emitido) e grants
`SELECT(colunas...) ON renolink_dev.tabela` para as colunas consultadas; não
aceitar SELECT de tabela/schema inteira, privilégio global, administrativo,
dinâmico ou de escrita. Rejeitar qualquer role concedida diretamente à conta,
mesmo inativa; com isso não há cadeia de roles herdadas a expandir. Além disso,
`CURRENT_ROLE()` deve indicar nenhuma role ativa e
`@@GLOBAL.mandatory_roles` deve estar vazio. Se qualquer role ou privilégio não
puder ser descartado sem ambiguidade, abortar sem ativar roles nem consultar
`mysql.*`. Nunca imprimir nem persistir resultados de grants ou identidade.

**`SHOW CREATE TABLE`:** não é uma operação de escrita/DDL, mas requer
visibilidade/privilégio sobre a tabela. O requisito exato depende da versão e
não se presume que SELECT por coluna baste. Antes de qualquer execução, o DBA
deve confirmar que as doze definições podem ser lidas com os grants já
permitidos. Como `renolink_meta` e `renolink_imports` não recebem SELECT de
dados neste plano, se o servidor exigir SELECT nessas tabelas para `SHOW
CREATE`, não adicionar esse privilégio: declarar a comparação de schema
indisponível. Também não conceder SELECT de tabela, `SHOW VIEW`, SELECT global
ou outro privilégio automaticamente. A definição pode conter nomes, defaults
ou comentários; consumir em memória, sem logs. Como o resultado DDL pode não
participar do mesmo snapshot MVCC, se schema puder mudar concorrentemente,
interromper ou declarar a comparação não atômica; não bloquear DDL.

**`renolink_meta.payload`:** `SELECT(payload)` permitiria ler o JSON inteiro;
MySQL não restringe grants por caminho JSON. A alternativa de menor privilégio
é omitir totalmente SELECT de dados em `renolink_meta`; `payload`,
`schemaVersion` e contadores ficam não verificados. Não criar view/procedure
nem conceder `SELECT(payload)` sem autorização separada.
`renolink_imports` não recebe nenhum `SELECT` de dados, pois não integra o
estado carregado pelo snapshot; seu `SHOW CREATE TABLE` é solicitado apenas
para tentar reproduzir o hash de schema histórico, condicionado à permissão
metadata exigida pelo servidor. Se qualquer tabela ou DDL estiver invisível,
marcar a comparação de schema como indisponível/parcial.

O cliente deve abortar antes dos SELECT de negócio se os guards
de identidade, grants, role, versão ou isolamento falharem, ou se o servidor
recusar o início da transação `READ ONLY`. Não executar este bloco manualmente
com a conta de aplicação.

As colunas retornadas de identificadores e relações são necessárias somente
para contagem e validação referencial em memória. O cliente não deve despejar
linhas, IDs, relações, exceções SQL, grants, nomes de conta ou identidades em
logs/relatórios. Não persistir fingerprints derivados de IDs/relacionamentos:
não há baseline histórico e não são necessários para as comparações possíveis.
Descartar buffers ao fechar a conexão. As colunas de conteúdo omitidas não são
verificadas.

### Referências disponíveis e comparação possível

As referências locais revisadas são
[`phase9-dev-before.json`](../renolink_funcional/data/runtime/phase9-dev-before.json)
e o par
[`phase83-round1-dev-before.json`](../renolink_funcional/data/runtime/phase83-round1-dev-before.json) /
[`phase83-round1-dev-after.json`](../renolink_funcional/data/runtime/phase83-round1-dev-after.json).
Os três registros têm os mesmos:

- state SHA-256 `769e197bb56c6c7776089d9fb501efbe1ddf102fde607408c55312bdf9dea7aa`;
- schema SHA-256 `6c3b6aa742d9cc5e66f6d0e07061c661c89a88d59a216ec81b99068755c9f59e`;
- staff SHA-256 `9d41dd52adc7ab7aeea30b9b261b7f0b94d1cff02f4dc8a571e928cf6ab13a63`;
- contagens `users=8`, `ideas=11`, `negotiations=1`, `messages=7`,
  `sessions=12`, `staff=1`, `conversations=2`, `supportMessages=4`,
  `requests=1`, `audit=11`.

O relatório da fase 8.3 registra `unchanged: true` para o par de snapshots.
Isso fornece uma referência agregada anterior coerente, não uma lista de IDs.
As capturas antigas não contêm IDs individuais, hash de conjunto de IDs por
tabela, schema DDL bruto, hash canônico ordenado ou registro individual de
credenciais. O hash global do estado cobre os registros serializados, incluindo
IDs e campos de credencial, mas não permite dizer qual registro mudou se
divergir.

Há uma limitação adicional: o hash de estado anterior foi calculado com
`stable(db)`, que ordena chaves de objetos, mas não ordena os arrays; o loader
faz `SELECT *` sem `ORDER BY`. Logo, a impressão digital histórica pode depender
da ordem de retorno do MySQL. Igualdade do hash histórico é uma comparação
agregada, mas não equivale a comparar conjuntos de IDs independentemente da
ordem. Não existe fingerprint canônico por tabela salvo anteriormente.
Contagens iguais sozinhas também não provam igualdade dos IDs.

Com as colunas minimizadas do SQL acima, é possível comparar contagens
históricas e validar relações entre IDs somente no snapshot atual. O hash
histórico de `staff` não pode ser reproduzido sem ler `extra`, que foi omitido;
a contagem de staff não comprova que administradores, papéis ou estado ativo
foram preservados. O hash de schema só poderá ser comparado se, sem ampliar
grants de dados, o conjunto atual de tabelas `renolink_*` corresponder
exatamente ao conjunto histórico, todos os 12 `SHOW CREATE TABLE` forem
permitidos e a serialização/normalização for compatível. A tabela
`renolink_imports` não tem contagem de dados histórica e
não receberá SELECT de dados, mas seu DDL consta no hash histórico e pode ser
incluído sem ler suas linhas. Se a tabela ou DDL não estiver visível, não
comparar o hash de schema. Não é possível reproduzir o hash global antigo de
estado sem ler nomes, emails, textos, JSONs `extra`, hashes/salts de senha e
digests de sessão; por isso ele não será recalculado. As referências não têm
IDs individuais; hashes/fingerprints de IDs calculados agora não podem ser
comparados com referência histórica e não serão produzidos nem registrados.

O `schemaSha256` antigo usa o texto de `SHOW CREATE TABLE`; além de diferenças
de versão/formatação, essa saída pode conter atributos operacionais como o
próximo `AUTO_INCREMENT`. Uma divergência exige revisão, mas não prova
isoladamente alteração estrutural. Sem DDL bruto anterior não há comparação
coluna a coluna retroativa.

**Conclusão permitida:** este plano não pode provar integridade completa. No
máximo, após aprovação e execução, poderá relatar contagens compatíveis,
relações atuais válidas e, condicionalmente, comparação agregada do hash de
schema. Não poderá afirmar preservação de cada registro, conteúdo, credencial,
administrador/papel ou do estado global.

`phase9-dev-after.json` não existe. Portanto, nada aqui comprova o estado atual
de `renolink_dev` nem preservação desde o snapshot inicial da fase 9. Uma futura
captura igual à referência sustentaria igualdade agregada no instante da
captura; não provaria que não houve alterações temporárias entre capturas. Se
o hash legado divergir, não concluir automaticamente que os dados mudaram:
primeiro comparar as métricas canônicas disponíveis e registrar a limitação de
ordenação; qualquer investigação permanece somente leitura e depende da mesma
aprovação.

### Permissões necessárias — não verificadas nem concedidas

Não sei se existe uma conta de auditoria somente leitura nem posso verificar
isso sem acesso. Não reutilize nem amplie silenciosamente `renolink_app`.
Se não houver uma identidade aprovada com acesso suficiente, **pare antes de
conectar** e solicite autorização do operador/DBA para disponibilizar uma conta
temporária, restrita a `127.0.0.1`, com:

- `SELECT` somente nas tabelas `renolink_users`,
  `renolink_ideas`, `renolink_negotiations`, `renolink_messages`,
  `renolink_sessions`, `renolink_staff`, `renolink_conversations`,
  `renolink_support_messages`, `renolink_requests` e `renolink_audit`, no
  schema `renolink_dev`, limitado às colunas efetivamente usadas no bloco SQL:
  `users(id)`; `ideas(id,user_id)`;
  `negotiations(id,idea_id,creator_user_id,company_user_id)`;
  `messages(id,from_user_id,to_user_id)`; `sessions(user_id)` para contagem
  agregada; `staff(user_id)`;
  `conversations(id,visitor_id)`;
  `support_messages(id,conversation_id,sender_id)`;
  `requests(id,idea_id,visitor_id)`; `audit(id,actor_id,target_type,target_id)`.
  Não conceder SELECT em `renolink_meta` ou `renolink_imports`;
- capacidade de consultar `DATABASE()`, `USER()`, `CURRENT_USER()`,
  `CURRENT_ROLE()`, versão e isolamento, executar `SHOW GRANTS`, iniciar a
  transação de leitura, consultar os nomes visíveis em
  `information_schema.tables` e obter `SHOW CREATE TABLE`/metadados das 12
  tabelas.
  O requisito exato de privilégio para `SHOW CREATE TABLE` depende da versão e
  deve ser confirmado pelo DBA; não ampliar grants automaticamente. Se o
  mínimo aprovado não permitir essa consulta — em especial para `meta` e
  `imports`, sem SELECT de dados — omitir a comparação de schema.
  O cliente deve confirmar o resultado, não presumir a semântica pelo nome da
  conta;
- **nenhum** `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`,
  `LOCK TABLES`, `FILE`, privilégio global, acesso a `mysql.*` ou `GRANT OPTION`.

`SELECT` de tabela inteira sobre `renolink_users` ou `renolink_sessions`
permitiria ler hashes/salts de senha ou digests de token e **não é aceito**.
O SQL requer privilégios SELECT por coluna e evita essas colunas: usuário lê
somente ID, sessão lê somente `user_id` em agrupamento e
mensagens/ideias/auditoria omitem conteúdo. Como `payload` é uma coluna JSON
indivisível para privilégios MySQL, `SELECT(payload)` permite tecnicamente ler
o JSON inteiro; por isso não é solicitado nem necessário. A comparação integral
do estado não pode ser feita. `SHOW GRANTS` e `CURRENT_ROLE()` são conferidos
de forma fail-closed; qualquer role concedida é rejeitada e, portanto, não há
privilégios herdados a considerar. Isso não substitui a validação prévia pelo
DBA. Criar uma conta exige privilégios DBA (`CREATE USER`/`GRANT`) e altera
configuração de contas; isso requer autorização separada e não faz parte do
procedimento. Não buscar credenciais no cofre Windows.

## Requisitos técnicos e dimensionamento

| Item | Requisito ou proposta | Evidência / limite |
|---|---|---|
| Node.js | Linha 24, versão `>=24.19.0 <25` conforme `package.json` e política de hosting. | Requisito do código; validar o patch suportado no destino. |
| MySQL | MySQL 8.0.17+ ou 8.4, InnoDB e esquema/collation exigidos pelas migrações. Conexão direta, `MYSQL_SSL=1`, CA e identidade do servidor verificadas. | Requisito do código e dos modelos. Proxy/pooling entre app e primário precisa preservar transações e `GET_LOCK`. |
| CPU | **4 vCPU reservadas** como ponto inicial para cotação/homologação, não mínimo comprovado. | Estimativa registrada na fase 8.3 para comparar com o host local; vCPU compartilhada e hardware externo não foram medidos. |
| RAM | **4 GiB** como hipótese inicial somente; preferir medir e ajustar, especialmente se Node e MySQL compartilharem VM. | Estimativa registrada, não garantia nem benchmark de produção. O perfil de 8 threads aumentou memória e não foi adotado como padrão. |
| Armazenamento | Persistência separada para MySQL e backups externos criptografados. **Não há mínimo em GiB validado**: o tamanho dos JSONs locais não mede banco, índices, logs ou crescimento. Para orçamento preliminar, reservar 20–30 GiB persistentes para uma homologação pequena e revisar após medir o banco e executar o lote sintético; não tratar isso como aceite técnico. | Estimativa de planejamento; medir uso real, crescimento, binlogs, logs e espaço livre antes de escolher. Backup não deve compartilhar o único disco/host. |
| HTTPS | Domínio autorizado, certificado válido e renovável, TLS 1.2/1.3 no proxy, Node inacessível externamente, origem canônica HTTPS, `COOKIE_SECURE=1`, `HttpOnly`, `SameSite=Strict`. | O certificado foi exercitado localmente; o template Nginx não foi instalado nem validado com `nginx -t`. |
| Rede | Expor somente HTTPS 443 ao público/allowlist; Node 3000 apenas loopback. MySQL 3306 somente na rede privada/loopback, sem exposição pública. | Recomendação e configuração de exemplo, ainda sem destino real. |
| Backup/recuperação | Backup criptografado fora do host, conta dedicada e restauração ensaiada em banco novo e isolado. | Nenhum restore externo foi executado. Os documentos divergem nas metas: STAGING sugere RPO 15 min/RTO 60 min; HOSPEDAGEM_FEIRA sugere RPO 60 min/RTO 30 min. Escolher metas antes de contratar/configurar. |

O ensaio local realista de fase 8.3 registrou p95 de cerca de **4,39 s para 50
logins concorrentes** no perfil padrão de quatro threads. Esse é um resultado
local, curto e não um SLO comprovado. Houve evidência de 50 SSE/navegação em
ensaios locais, mas não de 50 visitantes sustentados por uma hora em hospedagem
externa. A meta p95 de 3 s mencionada em `HOSPEDAGEM_FEIRA.md` é proposta e não
foi atingida pelo resultado local citado. Capacidade deve ser reavaliada no
destino e com metas aprovadas.

## Opções de infraestrutura

| Opção | Compatibilidade com Node, MySQL e SSE | Avaliação para a RenoLink |
|---|---|---|
| VM Linux + Nginx local + MySQL gerenciado em rede privada | Mantém Nginx no mesmo host do Node, Node em loopback, streaming SSE controlável e MySQL externo com TLS. | **Melhor encaixe inicial** com os templates atuais. Confirmar conectividade privada, CA/hostname, versão MySQL, grants, conexão direta e `GET_LOCK`. Mais operação de VM, rede e monitoramento. |
| VM Linux única com Nginx, Node e MySQL | Topologia simples, proxy loopback controlado e latência local. | Compatível como staging pequeno, mas concentra falha e exige administrar patches, disco, MySQL, TLS local e backups. Não usar como único destino sem recuperação testada. |
| PaaS Node + MySQL gerenciado (ex.: Railway) | Railway documenta serviços Node, MySQL privado no projeto, backups de volume e opção HA para MySQL. SSE e compatibilidade com a cadeia de proxy ainda precisam de ensaio. | **Não é drop-in**: a RenoLink exige proxy TLS cujo peer seja loopback (`TRUST_PROXY=loopback`); PaaS normalmente recebe tráfego em porta/bind público do container e o peer pode não ser loopback. Exigiria Nginx interno corretamente confiável ou revisão de código/proxy, além de validar MySQL 8, TLS e identidade. Sem escolha ou contratação. |
| PaaS Node (ex.: Render) + MySQL externo | Render documenta web services Node e exige bind em `0.0.0.0`; sua documentação consultada descreve Render Postgres gerenciado, não MySQL gerenciado. MySQL teria de ser outro serviço. | Maior divergência com bind e confiança de proxy atuais, dependência de MySQL externo e rede/TLS entre provedores. Não recomendada sem adaptação e ensaios específicos. |

Não foram cotados preços nem selecionados provedores. Páginas oficiais consultadas:
[Render Web Services](https://render.com/docs/web-services),
[Render Private Services](https://render.com/docs/private-services),
[Render PostgreSQL](https://render.com/docs/postgresql-creating-connecting),
[Render Health Checks](https://render.com/docs/health-checks),
[Railway MySQL](https://docs.railway.com/databases/mysql),
[Railway MySQL HA](https://docs.railway.com/databases/mysql-ha),
[Railway Backups](https://docs.railway.com/volumes/backups),
[diretivas proxy do Nginx](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) e
[TLS no MySQL](https://dev.mysql.com/doc/refman/8.4/en/using-encrypted-connections.html).
A documentação oficial do MySQL bloqueou a leitura automatizada nesta revisão;
os requisitos de TLS também foram conferidos no código local.

## Plano de homologação externa — somente após autorização

1. **Aprovar o ambiente:** escolher VM/PaaS e região, operador, janela, origem,
   allowlist/VPN, metas de latência, RPO/RTO e orçamento. Recursos externos,
   DNS e contrato dependem de autorização explícita separada.
2. **Isolar dados e identidades:** criar apenas `renolink_staging` vazio,
   independente de `renolink_dev` e `renolink_test`, MySQL compatível e contas
   exclusivas `renolink_staging_app`, `renolink_staging_migrator` e
   `renolink_staging_backup`, cada qual com menor privilégio. Não copiar JSON,
   dump, credenciais, administradores ou dados reais. Usar somente fixture
   `@homologacao.invalid` e segredo sintético novo.
3. **Preparar implantação:** pacote revisado, secrets manager/arquivo protegido
   fora do release, CA e certificado montados fora do pacote; revisar grants,
   portas e logs. Não usar o DPAPI/cofre do Windows no servidor. Nenhuma
   migração ou inicialização automática no boot.
4. **Validar MySQL TLS:** conexão Node com `MYSQL_SSL=1`, `rejectUnauthorized`
   e `verifyIdentity`; confirmar `CURRENT_USER()`, database, versão e
   `SHOW SESSION STATUS LIKE 'Ssl_cipher'` sem imprimir credenciais. Confirmar
   CA e hostname corretos; uma CA ou hostname incorretos devem falhar fechado.
   O diagnóstico existente exige TLS e grants, mas ainda não foi executado em
   staging.
5. **Validar Nginx/HTTPS:** aplicar o template somente após ajustar domínio,
   certificado e allowlist; `nginx -t` antes de ativar. Conferir TLS 1.2/1.3,
   cadeia válida, redirecionamento/HTTPS, `/health/ready`, cabeçalhos Host e
   proxy. Confirmar que XFF recebido do cliente é substituído, backend não é
   acessível externamente e falhas não retransmitem POST.
6. **Validar cookies e autorização:** em navegador, confirmar `Secure`,
   `HttpOnly`, `SameSite=Strict`, origem permitida, rejeição de origem externa,
   autorização admin e ausência de sessão/cookie em login recusado.
7. **Validar SSE pelo caminho real:** manter 50 conexões, confirmar entrega
   imediata de frames, heartbeat de 15 s, ausência de buffering/cache/gzip,
   isolamento de eventos, ausência de duplicatas e reconexão após queda/reinício.
   Fazer ensaio contínuo de **60 minutos** além dos cenários de carga; observar
   reinícios, timeouts, file descriptors e métricas. A regra de replay entre
   processos está limitada e precisa ser observada.
8. **Executar fluxos fictícios:** após aprovações correspondentes, executar
   `flows`, depois cenários A, B e C **um por vez** usando
   `scripts/staging-homologate.js` e `RENOLINK_STAGING_WRITE_APPROVED=1` somente
   no destino verificado. A = 50 sessões; B = 50 logins em rajada; C = 10
   cadastros, 20 logins e 20 sessões existentes. Cada cenário abre SSE para
   50 visitantes. O runner conserva os dados sintéticos e consome rate limits;
   esperar ao menos 15 minutos entre lotes, parar em 429/erro e nunca remover
   limites nem reiniciar para contorná-los. Para a janela de uma hora,
   configurar `STAGING_SSE_WINDOW_SECONDS=3600` no plano e executar em janela
   controlada, com evidência/saída protegida.
9. **Aceite de carga/recuperação:** comparar p50/p95/p99 por rota, 5xx/429,
   atraso do event loop, CPU/RSS, fila de hash, pool, MySQL e reconexões. O
   limite p95 de 3 s é apenas meta candidata de `HOSPEDAGEM_FEIRA.md`, sujeita
   à sua aprovação; não confundir com capacidade demonstrada. Testes de falha,
   backup e restore exigem janela, ambiente isolado e autorização do operador;
   qualquer restauração deve ser em banco novo, nunca sobre dev/test/staging
   ativo.

O runner de homologação **escreve** dados sintéticos em staging; não deve ser
usado contra URL arbitrária e nunca contra `renolink_dev`. Corrigir destino,
identidade, TLS ou expectativa exige parar, não tentar outra conta/banco.

## Pendências e ações que precisam da sua autorização

- Se a verificação for autorizada posteriormente, aprovar uma conta de auditoria
  estritamente limitada a SELECT por coluna listado acima, sem acesso a
  `payload`, hashes/salts, digests de sessão ou linhas de `renolink_imports`.
  A necessidade exata de privilégio para `SHOW CREATE TABLE` ainda requer
  confirmação do DBA. Nenhuma conexão foi feita e nenhuma permissão foi criada
  ou ampliada.
- Aprovar provedor, região, arquitetura, domínio, rede/allowlist, orçamento e
  contratação antes de qualquer criação de recurso.
- Aprovar criação de banco/contas exclusivos de staging, migrações, fixtures e
  testes externos com escrita somente em staging.
- Definir metas de CPU/latência e resolver a divergência RPO/RTO; autorizar
  janelas para simulação de falha e restauração.
- Completar revisão do histórico Git do release, marcada como pendente no
  registro de auditoria local.

Até autorização e testes externos concluídos, o estado permanece
**planejamento; hospedagem não homologada**.
