# MySQL na RenoLink

Primeiro administrador: usuário ID 3 ativado após autorização explícita na Fase 6,
com evento de auditoria ID 1. Consulte [FIRST_ADMIN.md](FIRST_ADMIN.md).
O comando antigo grant-staff sem confirmação não está mais habilitado.

## Fase 5 — aplicada em desenvolvimento após autorização

A migração [002_phase5.sql](002_phase5.sql) e o
[plano de aprovação](PHASE5_PLAN.md) adicionam cinco tabelas e metadados para
equipe, atendimento, negociações e auditoria. Após validação em renolink_test,
foram aplicados em renolink_dev com autorização específica, conta migradora,
backup completo, conferência integral dos registros e repetição segura.
Nenhum administrador real foi promovido. A aplicação não faz migração no bootstrap.
Resultados: [relatório de ativação](../../../auditoria/FASE_5_ATIVACAO.md).
Backup e restauração: [RESTORE_PHASE5.md](RESTORE_PHASE5.md).

## Estado atual após a Fase 4

Migração real concluída em 24/10/2026. `renolink_dev` contém 4 usuários,
9 ideias, 7 mensagens, 1 negociação e 0 sessões, com comparação integral
de conteúdo, IDs e relacionamentos. Uma segunda execução retornou
`already-imported`, com um único registro em renolink_imports. JSONs,
backups e manifestos permanecem verificados e inalterados.

`INICIAR_RENOLINK.bat`, `INICIAR_RENOLINK.ps1` e `npm.cmd start` carregam
o cofre DPAPI local e usam `renolink_app@127.0.0.1`, `renolink_dev`,
`STORAGE_DRIVER=mysql`, `MYSQL_SSL=0` para loopback e HTTP local na porta 3000.
Não há senha literal no código ou argumento. A aplicação escuta somente em
127.0.0.1 e não foi publicada. O cofre exige o usuário Windows que o criou.

Os testes funcionais criaram contas, ideia, mensagem, negociação e sessões
somente em renolink_test. O status público da ideia sintética foi preparado
pelo adaptador, pois ainda não há fluxo de publicação administrativa na API.
O teste não certifica esse fluxo ausente. Após reiniciar o Node, sessão e
registros foram conferidos integralmente. O banco migrado foi reaberto por
dois processos com a conta da aplicação e permaneceu igual à origem.

Relatórios em data/runtime: mysql-dev-migration-report.json,
mysql-dev-verification-report.json e mysql-dev-live-report.json.
Resultados finais: [auditoria da Fase 4](../../../auditoria/MYSQL_FASE4.md).
As seções de diagnóstico inicial e instruções de provisionamento abaixo
preservam o histórico; não recrie bancos nem reexecute a migração como rotina
de inicialização. Para inspecionar a instalação atual sem escrever no banco:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/mysql-dev.ps1 -Mode Inspect
```

Data: 24/10/2026. Implementação preparada para MySQL 8.0.17+ e 8.4 LTS. A versão mínima considera CHECK aplicado pelo servidor e a collation utf8mb4_0900_bin. MariaDB e outros majors não são certificados por este adaptador.

## Diagnóstico nesta máquina

Existe um serviço Windows `MYSQL80` em execução. A porta 3306 respondeu ao handshake com versão **8.0.46**, sem autenticação ou consultas SQL. Foram encontrados MySQL Workbench, Shell e Router em `C:\Program Files\MySQL`. O cliente `mysql` não está no PATH desta sessão.

Não foram fornecidos usuário/senha nem banco de desenvolvimento/teste da RenoLink. O serviço existente não foi reconfigurado, iniciado, parado ou reinstalado. Sua escuta atual é `0.0.0.0:3306`; antes do uso real, verificar com o administrador se deve ser restrita a localhost/rede privada. Nenhuma regra de firewall foi alterada.

## Instalação/configuração Windows

Não reinstale o servidor existente para executar esta etapa. Use Workbench com sua conexão autorizada ou disponibilize o cliente correspondente no PATH. Para uma máquina nova, após autorização, usar os pacotes oficiais MySQL Community 8.4 LTS para Windows, instalar servidor e ferramentas cliente, configurar serviço local, InnoDB, charset utf8mb4 e fuso UTC. Não abrir a porta do banco à internet. Não é necessário trocar o serviço 8.0.46 atual para testar este código.

Verificação futura, com cliente disponível:

```powershell
mysql --version
mysql -h 127.0.0.1 -P 3306 -u root -p
```

`-p` solicita senha interativamente. Usar uma conta administrativa previamente autorizada; não adivinhar credenciais, não desabilitar autenticação e não colocar senha na linha de comando. No editor SQL autorizado, provisionar bancos separados, por exemplo:

```sql
CREATE DATABASE renolink_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE DATABASE renolink_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
```

Criar contas distintas pelo gerenciamento seguro de usuários, com senhas próprias e autenticação suportada pelo MySQL 8.0/8.4. A aplicação não deve usar root. Host de conta e host de conexão devem corresponder à política local. Privilégios necessários:

- Migrador: SELECT, INSERT, UPDATE, CREATE, INDEX e REFERENCES no banco dedicado; não precisa DROP, DELETE ou privilégios globais.
- Aplicação: SELECT, INSERT e UPDATE nas tabelas operacionais, com acesso aos metadados de seu banco. Não precisa CREATE, ALTER ou DELETE.
- Teste: banco dedicado e vazio com permissões equivalentes ao migrador; as tabelas e dados sintéticos ficam preservados ao terminar.

Não aplicar os comandos acima em banco preexistente sem conferir o destino. Provisionamento não foi executado nesta implementação.

## Variáveis e segredos

O backend não lê `.env` automaticamente. Configure no terminal ou gerenciador de segredos. `.env.example` é documentação; nunca versionar valores reais.

| Variável | Finalidade |
| --- | --- |
| STORAGE_DRIVER | `mysql` seleciona MySQL, `json` mantém cópia operacional local; `postgres` conservado somente em desenvolvimento |
| MYSQL_HOST | Host real, obrigatório |
| MYSQL_PORT | Porta, padrão 3306 |
| MYSQL_DATABASE | Banco real, obrigatório |
| MYSQL_USER | Conta autorizada, obrigatória |
| MYSQL_PASSWORD | Senha real, obrigatória e não vazia |
| MYSQL_SSL | `1` ativa TLS; `0` apenas para desenvolvimento local apropriado |
| MYSQL_SSL_CA | Arquivo CA confiável opcional; exige MYSQL_SSL=1 |
| NODE_ENV | `production` exige MySQL e TLS no banco |
| APP_ORIGIN | Origem exata; em produção, HTTPS obrigatório |
| COOKIE_SECURE | `1` em HTTPS; desenvolvimento HTTP local usa `0` |
| PORT | Porta HTTP da aplicação; padrão 3000 |
| RENOLINK_MYSQL_MIGRATION_APPROVED | `1` somente quando importação real estiver autorizada |
| TEST_MYSQL_* | HOST, PORT, DATABASE, USER, PASSWORD, SSL, SSL_CA exclusivos do teste real |
| RENOLINK_TEST_MYSQL_APPROVED | `1` habilita integração real com dados sintéticos |

Não usar DATABASE_URL PostgreSQL para MySQL. TLS verifica CA e identidade do servidor; não há opção para aceitar certificados inválidos. Em hospedagem, usar o DNS que corresponde ao certificado e CA fornecida pelo operador/provedor.

Exemplo de preparação do terminal local após provisionamento, sem senha literal:

```powershell
$env:STORAGE_DRIVER = 'mysql'
$env:MYSQL_HOST = '127.0.0.1'
$env:MYSQL_PORT = '3306'
$env:MYSQL_DATABASE = 'renolink_dev'
$env:MYSQL_USER = Read-Host 'Conta MySQL autorizada para esta operação'
$env:MYSQL_PASSWORD = [System.Net.NetworkCredential]::new(
  '', (Read-Host 'Senha MySQL' -AsSecureString)
).Password
$env:MYSQL_SSL = '0'
```

Os nomes de banco acima são sugestões de provisionamento, não bancos detectados. Só iniciar `npm.cmd start` depois de o banco escolhido conter uma importação validada. O bootstrap verifica o armazenamento e recusa destino não inicializado; nunca cria tabelas ou importa dados automaticamente.

## Modelo e transações

`001_initial.sql` define sete tabelas InnoDB: users, ideas, negotiations, messages, sessions, meta e imports, todas prefixadas por `renolink_`. IDs bigint são preservados; o adaptador recusa IDs fora do intervalo seguro de números JavaScript. Autor nulo de ideia demo é mantido. Datas são DATETIME(3) em UTC. Campos adicionais permanecem em JSON `extra`.

E-mail tem coluna normalizada gerada e índice único. Há FKs para autores, participantes, mensagens e sessões, unicidade de ideia/empresa e correspondência de criador/autor. Exclusões são restritas. Índices cobrem autor, status/data, participantes e sessões. As funções de negócio e o validador também verificam perfis dos participantes.

O adaptador `mysql2/promise` usa a mesma conexão para início, leituras, gravações e commit/rollback. Todas as entradas de usuário são parâmetros em `execute(sql, params)`; identificadores SQL vêm de listas fechadas. `multipleStatements` fica desabilitado. Conflito de índice único não é convertido em atualização de outra conta por `ON DUPLICATE KEY UPDATE`.

O startup chama `store.initialize()` nos stores SQL. No MySQL esse caminho
valida banco/versão, mantém o named lock e a transação de inicialização, mas
não carrega o snapshot nem lê hashes/salts/sessões. O comportamento padrão de
`store.transaction(callback)` continua igual para callbacks que usam o estado.
`/health/live` não consulta o banco; `/health/ready` consulta somente a
metainformação de schema. Em `APP_ENV=fair`, destino, papel e TLS são validados
antes de abrir o pool e o banco efetivamente selecionado é comparado ao destino
configurado.

Um `GET_LOCK` derivado do nome do banco é obtido antes da transação, com isolamento READ COMMITTED e fuso UTC. Ele serializa os adaptadores participantes na mesma instância MySQL, inclusive em pools/processos diferentes; os contadores de IDs são gravados na mesma transação. O lock é explicitamente liberado depois de commit/rollback, pois não é transacional. Se a liberação não puder ser confirmada, a conexão é descartada. Timeouts de conexão, espera de lock e limite de fila são definidos.

Essa arquitetura preserva o contrato do backend atual, mas lê e regrava o conjunto de registros nas operações de escrita; não é otimizada para grande volume. Precisa de teste de carga. Não usar roteamento por réplicas, multi-primary ou proxy que troque a conexão física durante uma operação: o lock exige o mesmo servidor/conexão. A resposta HTTP só é enviada depois do commit.

## Backup, preflight e importação futura

`data/db.json` nunca é aberto para escrita. O migrador não escolhe mais uma
origem implicitamente: `--source` é obrigatório, deve apontar para um arquivo
JSON regular existente por caminho absoluto e links simbólicos são recusados.
Confirme manualmente que o arquivo é a origem pretendida antes do preflight.
Na feira, passe também um `--backup-dir` explícito; a conta/destino MySQL da
feira é validado separadamente e não aceita `renolink_dev`, `renolink_test`,
outro schema ou host remoto. Um lock da origem impede a aplicação; não remover
lock sem verificar seu processo e preservar os dados.

Preflight, sem conexão MySQL:

```powershell
# Somente depois de confirmar manualmente qual arquivo é a origem:
$source = (Resolve-Path -LiteralPath 'CAMINHO_ABSOLUTO_DO_JSON').Path
$backup = 'CAMINHO_ABSOLUTO_DO_BACKUP'
node scripts/migrate-mysql.js --check --source $source --backup-dir $backup
```

Os caminhos abaixo são placeholders: substitua-os por caminhos absolutos
existentes e revisados. O argumento `--source` não aceita ausência, caminho
relativo, arquivo inexistente, diretório ou symlink. Não executar `npm run
db:check` sem anexar `--source`.

Ele cria backup por SHA-256 e manifesto, valida IDs, contadores, usuários e relações. Um backup já existente com bytes divergentes é recusado. O original não é sobrescrito. O backup/manifesto e o runtime continuam fora da lista de arquivos públicos. Manter também cópia externa protegida antes do corte real.

Somente após aprovação explícita e configuração da conta migradora:

```powershell
$env:RENOLINK_MYSQL_MIGRATION_APPROVED = '1'
node scripts/migrate-mysql.js --apply --source $source --backup-dir $backup
Remove-Item Env:\RENOLINK_MYSQL_MIGRATION_APPROVED
```

Para a instância Feira, forneça ainda `APP_ENV=fair`,
`RENOLINK_FAIR_DB_ROLE=migrator` e a configuração TLS exclusiva do migrador.
O destino fixado é `127.0.0.1:3307`/`renolink_feira`,
`renolink_feira_migrator`, CA TLS explícita e
`RENOLINK_FAIR_MYSQL_SERVER_UUID` obtido da instância independente aprovada.
O caminho de origem e o diretório de backup devem ser aprovados separadamente.
Não usar `.env`, JSON, conta ou dados de desenvolvimento como fonte sem revisão
explícita. A conta migradora não deve ser reutilizada pelo processo Node.

O destino deve ser um banco dedicado sem tabelas alheias. A criação de tabelas IF NOT EXISTS ocorre antes da transação de dados, ainda sob lock. **DDL no MySQL causa commits implícitos: tabelas vazias podem permanecer após uma falha.** Não é prometido rollback da criação das tabelas. Reexecução pode completar a criação parcial; IF NOT EXISTS não corrige definições preexistentes incompatíveis, portanto usar destino novo ou estrutura criada exclusivamente por este schema.

A importação de dados, a comparação completa após leitura e o registro do hash são uma única transação InnoDB. Destino com registros não é sobrescrito. Mesmo hash e destino idêntico retornam `already-imported`; destino já alterado é recusado. Não há sincronização automática entre JSON e MySQL nem mesclagem de bases.

Para o perfil Feira, o preflight de destino compara também o banco e a
identidade `@@server_uuid`/porta efetivamente selecionados antes de adquirir
`GET_LOCK`. A execução normal repete essa validação nas conexões de leitura,
escrita e readiness. O migrador prepara as cinco tabelas aditivas da Fase 5
além das sete tabelas iniciais; isso não foi executado nesta auditoria.

Usuários, ideias, mensagens, negociações, IDs e relações são preservados. Hashes de senha antigos são mantidos e atualizados para scrypt no login correto pelo backend existente. Sessões legadas viram registros revogados sem token bruto. O importador não precisa conhecer senhas.

Rollback de dados é transacional. Para rollback de implantação depois de novas escritas, preservar/reconciliar os registros do MySQL antes de retornar ao JSON; voltar diretamente ao snapshot antigo perderia atualizações. Backup MySQL e restauração em outro banco precisam ser ensaiados na próxima etapa.

## Testes

### Fase 3: provisionamento local autorizado

O provisionamento e os testes sintéticos foram autorizados pelo responsável em
24/10/2026. Essa autorização não inclui importar dados originais, reiniciar
MYSQL80, publicar a aplicação ou alterar recursos preexistentes.

No PowerShell local, execute:

```powershell
powershell.exe -NoProfile -File "D:\Downloads\renolink\renolink_funcional\scripts\mysql-local.ps1"
```

O script solicita usuário administrativo e senha com `Read-Host -AsSecureString`.
Não digite a senha como argumento, no chat ou no editor. Não execute sob um
depurador que capture variáveis/ambiente. Não é necessário abrir o PowerShell como
administrador do Windows; é necessária uma conta administrativa autorizada do MySQL.

Antes de qualquer CREATE, consulta os dois bancos e os três nomes de usuário
(em todos os hosts). Se qualquer um existir, interrompe sem reutilizar, alterar
ou sobrescrever. O preflight é repetido imediatamente antes das criações; os
CREATEs não têm IF NOT EXISTS. Falhas parciais preservam o que foi criado, sem
DROP, reset, revogação ou tentativa automática de completar recursos existentes.

Cria `renolink_dev` e `renolink_test`, e as contas `renolink_app`,
`renolink_migrator`, `renolink_tester`, todas com host exato `127.0.0.1`,
autenticação `caching_sha2_password` e os privilégios documentados acima.
O GRANT trata o sublinhado como literal conforme o valor atual de
`partial_revokes`; nenhuma variável global é alterada. Confere a autenticação
e SHOW GRANTS de cada conta. Recusa provisionar com `log_raw` habilitado para
preservar a ocultação de senhas do MySQL.

As três senhas novas são geradas com aleatoriedade criptográfica e gravadas
antes do CREATE USER como PSCredential no arquivo `.env.mysql.local.clixml`,
ignorado por `.gitignore` (`.env.*`). O Windows DPAPI cifra os segredos para o
usuário Windows atual nesta máquina. O arquivo não contém a senha administrativa.
Não compartilhe o arquivo. A senha administrativa fica apenas na memória do
processo durante o provisionamento. Valores MYSQL_* e TEST_MYSQL_* são definidos
somente para os processos envolvidos e o ambiente anterior é restaurado ao sair.

O script executa a integração somente com TEST_MYSQL_DATABASE=renolink_test e
deixa `renolink_dev` vazio. As credenciais MYSQL_* apontam para a conta da
aplicação em renolink_dev, mas o servidor de desenvolvimento não é iniciado.
Os servidores de teste usam a conta de testes, loopback e portas efêmeras.
Nenhum flag de importação original é habilitado.

Relatórios sem segredos ficam em `data/runtime/mysql-provision-report.json`,
`mysql-integration-report.json` e `mysql-inspection-report.json`.
Um relatório de integração `running` indica execução incompleta, não aprovação.
A integração compara todos os registros após rollback e após dois reinícios
do processo da aplicação, incluindo sessão e negociações via HTTP. O serviço
MYSQL80 não é parado nem reiniciado. A inspeção final valida relações, contadores,
sete tabelas InnoDB e confirma que renolink_dev continua sem tabelas.

Depois de uma execução, inspecione sem modificar os bancos:

```powershell
powershell.exe -NoProfile -File "D:\Downloads\renolink\renolink_funcional\scripts\mysql-local.ps1" -Mode Inspect
```

`-Mode Test` executa testes com as credenciais protegidas já salvas, mas ainda
exige banco de teste vazio. Não reexecute Setup/Test depois de uma execução
parcial ou completa: preserve os relatórios para diagnóstico; não apague bancos,
tabelas ou o cofre local para tentar contornar as proteções.

`-Mode Resume` permite concluir a validação após a falha conhecida na asserção
FK, sem reset ou reimportação. Exige exatamente os cinco usuários sintéticos,
15 ideias, duas mensagens, duas negociações e o hash da importação da fixture
original; não aceita um banco arbitrário. Revalida login/autorização, negociações,
rollback, unicidade, CHECK e dois reinícios da aplicação. Não repete cadastro e
criação concorrente, já executados na primeira rodada. Os logins de retomada
acrescentam sessões sintéticas. O relatório inicial é preservado em `.initial.json`.

Na máquina atual, scripts PowerShell podem exigir `-ExecutionPolicy Bypass`
somente no processo de execução (sem alterar a política permanente). O cofre
DPAPI precisa ser aberto no contexto Windows do usuário que o criou.

A integração real foi concluída em MySQL 8.0.46. A falha inicial era uma
asserção que aceitava apenas ER_NO_REFERENCED_ROW_2/1452; a conta restrita recebeu
ER_NO_REFERENCED_ROW/1216. O teste agora exige uma dessas combinações exatas de
símbolo/número, com SQLSTATE 23000, confirma o UPDATE dentro da transação e
compara integralmente o estado após rollback. Nenhuma FK ou permissão foi alterada.
Veja `auditoria/MYSQL_FASE3.md` para resultados e limites da validação local.

```powershell
npm.cmd test
npm.cmd run test:mysql
npm.cmd run test:postgres
```

O primeiro comando roda testes locais de segurança, regressão e unidades MySQL, sem autenticação no serviço. Os testes PostgreSQL anteriores foram conservados. Os testes de integração ficam ignorados sem suas condições explícitas de execução.

Para teste MySQL real, provisionar banco novo/vazio `renolink_test` ou `renolink_test_<sufixo>`, diferente de MYSQL_DATABASE, e definir as variáveis TEST_MYSQL_* com as credenciais autorizadas. A rotina não cria/apaga bancos e não usa MYSQL_* implicitamente. Habilitar somente no terminal de teste:

```powershell
$env:TEST_MYSQL_HOST = '127.0.0.1'
$env:TEST_MYSQL_PORT = '3306'
$env:TEST_MYSQL_DATABASE = 'renolink_test'
$env:TEST_MYSQL_USER = Read-Host 'Conta exclusiva de teste'
$env:TEST_MYSQL_PASSWORD = [System.Net.NetworkCredential]::new(
  '', (Read-Host 'Senha da conta de teste' -AsSecureString)
).Password
$env:TEST_MYSQL_SSL = '0'
$env:RENOLINK_TEST_MYSQL_APPROVED = '1'
npm.cmd run test:mysql
Remove-Item Env:\RENOLINK_TEST_MYSQL_APPROVED
```

O teste importa fixtures com usuários, ideias públicas/privadas e autor nulo, mensagem, negociação, sessão legada e campo adicional. Valida importação repetida, login/upgrade, cadastro, mensagens com conteúdo que parece SQL, autorização, concorrência entre dois pools, persistência ao reabrir, unicidade e CHECK. Também executa UPDATE real seguido de falha FK e compara o banco completo para comprovar rollback. Todas as tabelas e dados sintéticos ficam preservados. Para outra execução, fornecer novo banco de teste vazio; nenhuma limpeza destrutiva é feita automaticamente.

A integração foi executada com credenciais reais no MySQL 8.0.46, com schema,
rollback e persistência validados. A primeira rodada parou na asserção do código
FK; após a correção, o modo Resume concluiu a validação sem limpar os dados.
Validar também em 8.4 LTS se esse for o destino escolhido, além de recuperação
de backup, queda de conexão e carga da feira.

## Referências oficiais

- [mysql2, prepared statements](https://sidorares.github.io/node-mysql2/docs/documentation/prepared-statements)
- [MySQL, instalação Windows](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html)
- [MySQL, locks por conexão](https://dev.mysql.com/doc/refman/8.4/en/locking-functions.html)
- [MySQL, transações](https://dev.mysql.com/doc/refman/8.4/en/commit.html)
- [MySQL 8.0.17, collation](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-17.html)
