# RenoLink — Fase 10.8: criação controlada do banco da feira

## Status

**Bloqueada na etapa de pré-verificação.** Não foi possível confirmar a
identidade de uma instância MySQL isolada no destino planejado
`127.0.0.1:3307`. Nenhuma consulta SQL ou conexão ao MySQL foi realizada.
Nenhum schema, usuário, tabela, fixture, serviço ou configuração foi criado
ou alterado. O banco da feira não está validado e a aplicação não foi iniciada.

Esta versão registra apenas os resultados efetivamente observados antes de
qualquer criação. Uma continuação exige resolver os bloqueios abaixo, repetir as
pré-verificações e obter confirmação explícita antes da primeira criação no
MySQL.

## Verificações locais realizadas

Inspeções somente de leitura no Windows:

- O serviço `MYSQL80` está em execução e configurado para inicialização
  automática.
- O executável associado ao serviço é `D:\MySQL\bin\mysqld.exe`; a versão do
  arquivo é **8.0.46.0**. Isso é metadado local do executável, não uma versão
  confirmada por consulta ao servidor.
- Foram observados processos `mysqld` com PIDs 4884 e 5520. O PID 5520 possui
  os listeners observados abaixo; não foi inferida a finalidade do outro
  processo.
- Não há listener TCP na porta **3307**.
- Há listeners em `::` nas portas **3306** e **33060**, associados ao PID 5520.
  Não foi feito teste externo ou de exposição pela internet.
- No arquivo de configuração conhecido do `MYSQL80`, as entradas selecionadas
  indicam `port=3306` e `datadir` configurado. Não foram encontradas entradas
  explícitas para `bind-address`, `require_secure_transport` ou certificados
  TLS entre as chaves inspecionadas. Isso não comprova os valores efetivos:
  defaults, outros arquivos e opções de inicialização não foram consultados.
- Os comandos de cliente `mysql`, `mysqld` e `mysqladmin` não estão no `PATH`.
- As variáveis de conexão da feira não estão definidas no ambiente de processo
  desta verificação.
- O modelo da feira mantém como destino `127.0.0.1:3307`,
  `renolink_feira`, usuário runtime `renolink_feira_app` e UUID ainda vazio.
  O modelo é inativo e não fornece credenciais.

## Identidade, TLS, existência e permissões

Não foi possível confirmar:

- `@@server_uuid`, versão reportada pelo servidor, schema selecionado ou porta
  reportada pelo MySQL.
- TLS negociado, identidade do certificado ou validade da CA.
- Se `renolink_feira` ou as contas planejadas já existem.
- Grants, roles herdadas ou permissão efetiva para criar schema e usuários.
- Se a instância corresponde ao serviço/diretório de dados isolados exigidos
  pelo plano da Fase 10.7.

Esses fatos exigiriam uma conexão autenticada ao destino. Nenhuma credencial foi
obtida ou usada; o cofre Windows não foi acessado. A ausência de listener em
3307 **não prova** que schema ou usuário inexistam em outra instância. Por
isso, a verificação de existência permanece pendente e não pode ser tratada
como aprovação para criar ou reutilizar recursos.

O serviço `MYSQL80` observado em 3306/33060 é o serviço compartilhado que as
fases anteriores determinaram não reutilizar nem alterar. Não foi tentada
conexão a ele ou a qualquer outro schema.

## Recursos e testes

- Recursos MySQL criados: **nenhum**.
- Recursos do Windows ou externos criados/alterados: **nenhum**.
- Migração, geração da fixture, backup, restore e startup: **não executados**.
- Consultas SQL, autenticação e teste TLS: **não executados**.
- Testes automatizados: **não repetidos**; a Fase 10.7 registra 40 testes
  locais com mocks aprovados. Eles não comprovam a disponibilidade nem a
  identidade de um servidor MySQL.
- A criação deste relatório é a única alteração desta etapa.

## Bloqueios e próximos passos

1. Disponibilizar, por procedimento separado e autorizado, uma instância
   isolada da feira em `127.0.0.1:3307`, sem alterar ou reutilizar o serviço
   compartilhado `MYSQL80`. A identificação deve incluir evidência
   administrativa de serviço e diretório de dados, além do UUID esperado.
2. Definir um método autorizado para fornecer e armazenar os segredos distintos
   de runtime e migração. Senhas não devem ser enviadas no chat, gravadas no
   projeto, passadas em argumentos ou registradas em logs. O cofre Windows
   permanece fora do escopo sem autorização específica.
3. Quando o listener isolado e o método de credenciais estiverem prontos,
   executar somente as consultas de pré-verificação aprovadas, limitadas à
   identidade, TLS, existência dos nomes planejados e privilégios. Não ler
   linhas de outros schemas.
4. Apresentar novamente os resultados. Interromper se a identidade, TLS,
   inexistência prévia dos recursos ou permissões mínimas não puderem ser
   comprovados.
5. Solicitar confirmação explícita do usuário imediatamente antes da primeira
   operação de criação. Só após essa confirmação poderá começar a criação do
   schema e das contas aprovadas; migração/fixture requerem suas próprias
   verificações e a autorização aplicável.

Até a resolução desses bloqueios, não executar `CREATE`, migração, fixture,
startup, alteração de serviço ou mudança de configuração. Não considerar o
ambiente homologado.

## Plano solicitado: segunda instância MySQL isolada

Este plano foi preparado após a solicitação de manter `MYSQL80` completamente
inalterado. **É uma proposta, não uma autorização de execução.** Nenhuma etapa
abaixo foi executada. Criar diretórios/ACLs, inicializar dados, registrar um
serviço ou iniciá-lo exige autorização administrativa explícita e uma revisão
prévia dos comandos e caminhos exatos.

### Desenho proposto

- Reutilizar somente o executável MySQL 8.0.46 já identificado em
  `D:\MySQL\bin\mysqld.exe`, depois de confirmar que o binário e seus arquivos
  de suporte são adequados para uma segunda instância. Não reinstalar,
  substituir, atualizar nem alterar a instalação existente.
- Registrar um serviço novo, por exemplo `RenoLinkFairMySQL`, com configuração
  própria e modo de inicialização manual. O serviço `MYSQL80` deve manter seu
  nome, estado, conta, configuração e diretório de dados.
- Manter os arquivos separados:

| Finalidade | Caminho proposto | Acesso pretendido |
|---|---|---|
| Configuração | `C:\ProgramData\RenoLink\mysql-fair\my.ini` | Administradores: controle; identidade do serviço: leitura |
| Dados | `C:\ProgramData\RenoLink\mysql-fair\data` | Identidade do serviço: modificar; administradores: controle |
| Logs | `C:\ProgramData\RenoLink\mysql-fair\logs` | Serviço: gravar; leitura administrativa restrita |
| Temporários | `C:\ProgramData\RenoLink\mysql-fair\tmp` | Serviço: modificar |
| CA/certificados | `C:\ProgramData\RenoLink\fair\secrets` | Serviço: leitura da CA e chave privada estritamente restrita |
| Backups | `E:\RenoLinkFair\backups` | Identidades autorizadas; confirmar que o volume existe e é protegido |

Esses diretórios não existem necessariamente. Não criá-los até confirmar
volume, espaço, política de retenção e ACLs. O serviço MySQL deve usar uma
identidade Windows dedicada de baixa permissão (preferencialmente a identidade
virtual do serviço, se validada para a instalação). Não usar `LocalSystem` por
conveniência. O processo Node deve continuar sob identidade separada
`renolink_fair_svc` e não receber acesso ao diretório de dados nem à chave
privada do servidor.

### Configuração a revisar antes de ativar

O arquivo exclusivo da instância deve conter somente opções intencionais para
ela, sem `!include` de configuração compartilhada. A configuração proposta é:

```ini
[mysqld]
basedir=D:/MySQL
datadir=C:/ProgramData/RenoLink/mysql-fair/data
port=3307
bind-address=127.0.0.1
log-error=C:/ProgramData/RenoLink/mysql-fair/logs/mysql-fair.err
pid-file=C:/ProgramData/RenoLink/mysql-fair/data/mysql-fair.pid
tmpdir=C:/ProgramData/RenoLink/mysql-fair/tmp
character-set-server=utf8mb4
collation-server=utf8mb4_0900_bin
require_secure_transport=ON
ssl-cert=C:/ProgramData/RenoLink/fair/secrets/mysql-server-cert.pem
ssl-key=C:/ProgramData/RenoLink/mysql-fair/private/mysql-server-key.pem
```

O modelo exige conexão TLS validada também na aplicação. O certificado do
servidor deve ser emitido por uma CA aprovada e conter SAN de endereço IP
`127.0.0.1`; não desativar validação de identidade. Restringir a leitura da
chave privada à identidade do MySQL e aos administradores autorizados.

A aplicação utiliza o protocolo MySQL clássico, não o X Protocol. Para evitar
conflito com o listener existente em 33060, a instância Feira deve desativar
explicitamente o MySQL X Plugin usando uma opção suportada pelo binário
instalado, e confirmar que não abriu listener. Se o plugin não puder ser
desativado de forma suportada, a alternativa requer uma porta X exclusiva
aprovada, vinculada também a `127.0.0.1`; nunca usar o default 33060. A escolha
final precisa ser validada com o `--help`/documentação correspondente à versão
instalada antes de registrar o serviço.

### Credenciais e privilégios separados

- Inicializar um diretório de dados novo e vazio; nunca copiar o diretório de
  dados, `auto.cnf`, usuários, grants ou backups do `MYSQL80`.
- Usar o mecanismo seguro de inicialização do próprio MySQL e proteger os logs
  antes da inicialização, pois a configuração inicial pode produzir material
  de autenticação temporário em log. Não imprimir ou anexar esse log ao chat.
  Não usar inicialização sem senha em serviço acessível a outros processos
  locais.
- Manter uma conta administrativa exclusiva da nova instância para
  provisionamento, sem utilizá-la pelo Node, pela migração normal ou por outros
  projetos.
- Criar credenciais MySQL distintas para `renolink_feira_app` (runtime) e
  `renolink_feira_migrator` (migração). Escopo limitado ao schema
  `renolink_feira`, host exato `127.0.0.1`, TLS obrigatório e sem grants globais,
  `GRANT OPTION` ou roles herdadas não revisadas. Aplicar a matriz de
  privilégios da Fase 10.7; não ampliar grants automaticamente.
- Senhas devem ser geradas e armazenadas por mecanismo protegido aprovado,
  sem chat, repositório, linha de comando, logs ou arquivo de configuração
  versionado. A conta de backup, se necessária, deve ser separada e ter
  privilégios validados segundo a ferramenta e a estratégia escolhidas.

### Prevenção de conflitos e proteção do MYSQL80

Antes do provisionamento, registrar de forma controlada o estado, caminho do
executável, identidade de serviço, portas e configuração efetiva observável do
`MYSQL80`; verificar também que o serviço e os caminhos específicos Feira ainda
não existem. Confirmar que as portas 3307 e, se necessária, a porta X dedicada
estão livres. Comparar esses mesmos indicadores após cada mudança autorizada.

Cada instância deve ter serviço, arquivo de configuração, diretório de dados,
PID, log, diretório temporário e porta exclusivos. O serviço novo deve apontar
explicitamente apenas para sua configuração. Não alterar `PATH`, configuração
global, firewall, serviço, ACLs ou arquivos do `MYSQL80`. Não criar regra de
entrada no Firewall: o bind em loopback deve impedir conexão remota ao MySQL.
Se for necessária qualquer mudança no `MYSQL80`, em firewall ou em configuração
global, interromper e pedir autorização separada.

### Ordem futura e comandos ainda não autorizados

1. Obter autorização administrativa específica para criar somente diretórios e
   ACLs Feira e registrar/iniciar o serviço novo. Revisar caminhos, conta do
   serviço, portas e comandos exatos antes de executá-los.
2. Confirmar inexistência do serviço `RenoLinkFairMySQL`, ausência dos caminhos
   Feira ou obter decisão explícita se já existirem, espaço disponível e
   ausência de listeners conflitantes. Capturar uma referência do estado do
   `MYSQL80`.
3. Criar os diretórios Feira com ACLs mínimas, preparar certificados
   aprovados, e revisar o `my.ini` independente. Inicializar exclusivamente o
   diretório novo. O padrão aproximado de inicialização seria:

   ```powershell
   & 'D:\MySQL\bin\mysqld.exe' --defaults-file='C:\ProgramData\RenoLink\mysql-fair\my.ini' --initialize
   ```

   O comando é ilustrativo e **não foi executado**. Antes de usá-lo, validar a
   sintaxe e os requisitos da versão instalada, confirmar que o diretório está
   vazio e que o destino resolvido é exatamente o diretório Feira.
4. Registrar o serviço novo usando o mesmo executável e seu arquivo de
   configuração dedicado. O formato exato de `--install` deve ser confirmado
   na versão local antes da execução; não reutilizar nem editar o comando de
   instalação do serviço `MYSQL80`.
5. Iniciar somente `RenoLinkFairMySQL` quando houver autorização específica.
   Verificar serviço, identidade, `@@port`, `@@server_uuid`, `@@datadir`,
   configuração de bind, certificado/TLS e listeners. Confirmar que 3307 está
   vinculado somente a `127.0.0.1`, que o X Protocol está desativado ou isolado,
   e que o estado/configuração/listeners do `MYSQL80` permanecem inalterados.
6. Usar uma conexão autenticada restrita à nova instância para validar
   identidade, TLS, privilégios e a ausência prévia de `renolink_feira` e das
   contas planejadas. Não consultar linhas nem outros schemas.
7. Apresentar os resultados e aguardar confirmação explícita **antes** de criar
   schema ou contas. Migração, fixture e startup continuam exigindo as
   autorizações específicas já previstas; validar a instância não as autoriza.

### Início, parada e reversão

Os comandos abaixo são apenas referências e exigem autorização futura:

```powershell
Start-Service -Name 'RenoLinkFairMySQL'
Stop-Service -Name 'RenoLinkFairMySQL'
```

Antes de cada operação, conferir que o nome exato é o novo serviço e que
`MYSQL80` não será afetado. Para reversão, parar somente o serviço Feira e
remover somente seu registro de serviço por procedimento MySQL documentado e
revisado. Preservar diretórios, logs e dados para análise; não apagar
automaticamente o diretório de dados, certificados ou backups. Qualquer
eliminação requer uma autorização separada, caminho resolvido e verificação de
que não aponta para dados do `MYSQL80`.

## Critérios de isolamento antes de criar `renolink_feira`

- Serviço novo identificado por nome, executável e configuração dedicados; o
  `MYSQL80` continua no estado e configuração de referência.
- `@@datadir` aponta para o diretório vazio e exclusivo Feira; `@@server_uuid`
  é não vazio, distinto da instância existente e aprovado como pin.
- `@@port` é 3307, `@@bind_address`/evidência equivalente é loopback e o
  listener observado é somente `127.0.0.1:3307`, sem bind em `0.0.0.0`, `::`
  ou interface LAN.
- Nenhum listener de aplicação ou X Protocol conflita com 3306/33060; firewall
  não recebeu regra de exposição.
- TLS negociado e identidade do certificado verificada com a CA aprovada.
- A conexão de auditoria identifica `USER()`, `CURRENT_USER()`,
  `CURRENT_ROLE()` e grants efetivos; sem privilégios globais, acesso a outros
  schemas ou roles não aprovadas.
- Só após esses itens e a confirmação explícita pode começar a criação do
  schema e das contas da Feira.

## Situação da autorização

O usuário solicitou este planejamento e determinou que nenhuma alteração seja
executada agora. Permanecem sem autorização: criação de diretórios/ACLs,
inicialização de dados, criação/registro/início do serviço, credenciais e
certificados, SQL de criação, migração, fixture, backup/restore e startup.
`MYSQL80` permanece inalterado; nenhuma conexão foi feita. A Fase 10.8
continua **bloqueada e não homologada** até nova autorização e conclusão das
validações.

## Retomada supervisionada — pré-verificações e plano de comandos

Data: 01/11/2026. A solicitação autorizou somente inspeções locais de leitura e
preparação de comandos. Nada abaixo foi executado para criar ou alterar
recursos.

### Resultados observados

Esta proposta atualiza o nome do serviço anterior para o nome solicitado
`MYSQL_RENLINK_FEIRA` e substitui o plano de colocar dados/logs em `C:`:
as medições abaixo mostram pouco espaço livre em C: e mais espaço em D:.

- `D:\MySQL\bin\mysqld.exe` existe; versão do arquivo **8.0.46.0**.
  `D:\MySQL\bin\mysql.exe` e `mysqladmin.exe` também existem. O utilitário
  `mysql_ssl_rsa_setup.exe` está presente; `openssl.exe` não foi encontrado
  nesse diretório nem no `PATH`.
- O serviço **MYSQL80** está `Running`, `Automatic`, executando como
  `NT AUTHORITY\NetworkService`. Seu executável é o mesmo
  `D:\MySQL\bin\mysqld.exe`; o arquivo de opções apontado pelo serviço é
  `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini`. Não conectei ao serviço.
- Na configuração, as entradas de porta encontradas são `port=3306`; há
  `datadir` e `log-error` configurados. Não há diretivas explícitas encontradas
  para `bind-address`, `mysqlx`, `mysqlx-bind-address` ou `mysqlx-port`.
  Os listeners observados para o PID associado ao serviço continuam em
  `:::3306` e `:::33060`. A leitura de opções do binário com
  `--no-defaults --verbose --help` informa os defaults `mysqlx=ON`,
  `mysqlx-port=33060` e `mysqlx-bind-address=*`.
- A porta **3307** não tem listener TCP observado. Isso é uma checagem local de
  socket, não uma reserva contra processos futuros.
- Não existe serviço Windows com nome correspondente a
  `MYSQL_RENLINK_FEIRA` ou `RenoLinkFairMySQL`.
- Os caminhos anteriormente propostos em
  `C:\ProgramData\RenoLink\` e `C:\ProgramData\RenoLink\mysql-fair\` não
  existem. Também não existem `C:\ProgramData\RenoLink\fair\secrets`,
  `D:\RenoLinkFair\` nem `D:\RenoLinkFair\mysql\`. O caminho
  `E:\RenoLinkFair\backups` não existe e o volume `E:` não está disponível
  nesta sessão. `C:` tem cerca de 13,2 GiB livres; `D:` tem cerca de 518 GiB
  livres.
- Portanto, recomendo manter configuração e certificados em
  `C:\ProgramData\RenoLink\mysql-fair\`, mas colocar dados, logs e temporários
  em `D:\RenoLinkFair\mysql\`, sujeito à confirmação de ACL, espaço e
  armazenamento. Não tratar `D:` como backup externo. A estratégia de backup
  permanece pendente de volume externo aprovado.
- O parser do executável reconhece `--mysqlx=OFF` e reporta `mysqlx OFF` em
  `--no-defaults --mysqlx=OFF --verbose --help`. Isso valida o nome da opção,
  mas não prova o estado de uma futura instância. A instância nova deverá usar
  `mysqlx=OFF` e o teste final deverá confirmar ausência de listener X.
- A configuração atual do MYSQL80 não declara bind explícito; os listeners
  wildcard observados persistem. A instância Feira proposta usará
  `bind-address=127.0.0.1`. Nenhuma diretiva, listener ou serviço do MYSQL80 foi
  alterado.

### Proposta exata — artefatos e identidade

Se autorizada, a etapa de provisionamento criaria somente:

1. `C:\ProgramData\RenoLink\mysql-fair\my.ini` — configuração exclusiva,
   sem incluir o `my.ini` compartilhado.
2. Diretórios novos:
   `C:\ProgramData\RenoLink\mysql-fair\`,
   `D:\RenoLinkFair\mysql\data`,
   `D:\RenoLinkFair\mysql\logs` e
   `D:\RenoLinkFair\mysql\tmp`.
3. ACLs somente nesses novos caminhos, para `SYSTEM`, administradores e a
   identidade virtual proposta `NT SERVICE\MYSQL_RENLINK_FEIRA`. Essa conta
   teria Modify apenas nos diretórios operacionais da instância, Read no
   arquivo de configuração e leitura somente dos arquivos de certificado
   necessários. A aplicação Node não receberia acesso ao datadir nem à chave
   privada.
4. Serviço exclusivo **`MYSQL_RENLINK_FEIRA`**, inicialização manual (`demand`),
   com `D:\MySQL\bin\mysqld.exe`, configuração própria e identidade virtual
   dedicada. Não seria iniciado automaticamente com o Windows.
5. Diretório de dados inicializado e vazio, sem schema RenoLink nem dados
   fictícios. A inicialização cria somente as tabelas de sistema internas do
   servidor MySQL.

Não seriam criados banco `renolink_feira`, contas MySQL de aplicação/migração,
dados sintéticos, backup, túnel ou processo Node. Não seria modificado o
`MYSQL80`, Firewall, SSH, `PATH`, variáveis globais, registro fora do necessário
para o novo serviço, nem configuração global do MySQL.

### Configuração proposta para revisão

O conteúdo planejado de `my.ini` é:

```ini
[mysqld]
basedir=D:/MySQL
datadir=D:/RenoLinkFair/mysql/data
port=3307
bind-address=127.0.0.1
mysqlx=OFF
log-error=D:/RenoLinkFair/mysql/logs/mysql-fair.err
pid-file=D:/RenoLinkFair/mysql/data/mysql-fair.pid
tmpdir=D:/RenoLinkFair/mysql/tmp
character-set-server=utf8mb4
collation-server=utf8mb4_0900_bin
require_secure_transport=ON
ssl-ca=C:/ProgramData/RenoLink/fair/secrets/mysql-ca.pem
ssl-cert=C:/ProgramData/RenoLink/fair/secrets/mysql-server-cert.pem
ssl-key=C:/ProgramData/RenoLink/fair/secrets/mysql-server-key.pem
```

**Bloqueio antes de iniciar o serviço:** os três arquivos de certificado não
existem, nem há emissor/CA aprovado nesta etapa. O certificado do servidor
precisa ter SAN de IP `127.0.0.1`, cadeia verificável pelo Node e chave privada
com ACL restrita. O utilitário `mysql_ssl_rsa_setup.exe` local não foi executado
e não foi validado para gerar certificado com essa identidade. Não iniciar o
serviço com TLS desativado nem enfraquecer a verificação. A origem dos
certificados precisa ser definida antes do comando de start.

### Comandos preparados, ainda não executados

Todos os comandos a seguir são administrativos e condicionais. Executá-los
exigiria nova confirmação explícita, revisão de cada caminho e um estado
prévio sem colisões. O PowerShell deve estar elevado somente durante as
operações administrativas:

```powershell
$ErrorActionPreference = 'Stop'
$mysqld = 'D:\MySQL\bin\mysqld.exe'
$service = 'MYSQL_RENLINK_FEIRA'
$config = 'C:\ProgramData\RenoLink\mysql-fair\my.ini'
$root = 'D:\RenoLinkFair\mysql'

# Pré-condição: todas as rotas abaixo foram verificadas como ausentes.
New-Item -ItemType Directory -Path 'C:\ProgramData\RenoLink'
New-Item -ItemType Directory -Path 'C:\ProgramData\RenoLink\mysql-fair'
New-Item -ItemType Directory -Path 'D:\RenoLinkFair'
New-Item -ItemType Directory -Path 'D:\RenoLinkFair\mysql'
New-Item -ItemType Directory -Path "$root\data"
New-Item -ItemType Directory -Path "$root\logs"
New-Item -ItemType Directory -Path "$root\tmp"

# Gravar o conteúdo exato de [Configuração proposta para revisão] em $config.
# Não criar o arquivo enquanto os certificados listados não estiverem prontos.

# Registrar manualmente somente o serviço novo com configuração exclusiva.
& $mysqld --install-manual $service "--defaults-file=$config"
if ($LASTEXITCODE -ne 0) { throw 'Registro do serviço Feira falhou; não iniciar serviço algum.' }

# Vincular o novo serviço à conta virtual própria e garantir início manual.
sc.exe config $service start= demand obj= "NT SERVICE\$service" password= ''
if ($LASTEXITCODE -ne 0) { throw 'Configuração da identidade do serviço falhou; não iniciar.' }

# ACLs propostas; revisar herança de diretórios-pai antes de aplicar.
icacls 'C:\ProgramData\RenoLink\mysql-fair' /inheritance:r
icacls 'C:\ProgramData\RenoLink\mysql-fair' /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 'NT SERVICE\MYSQL_RENLINK_FEIRA:(OI)(CI)RX'
icacls $config /inheritance:r
icacls $config /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' 'NT SERVICE\MYSQL_RENLINK_FEIRA:R'
icacls "$root\data" /inheritance:r
icacls "$root\data" /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 'NT SERVICE\MYSQL_RENLINK_FEIRA:(OI)(CI)M'
icacls "$root\logs" /inheritance:r
icacls "$root\logs" /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 'NT SERVICE\MYSQL_RENLINK_FEIRA:(OI)(CI)M'
icacls "$root\tmp" /inheritance:r
icacls "$root\tmp" /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 'NT SERVICE\MYSQL_RENLINK_FEIRA:(OI)(CI)M'

# Inicialização local do diretório vazio; não inicia listener.
# A sintaxe e os efeitos devem ser revisados com o manual local antes de uso.
& $mysqld --no-defaults --basedir='D:\MySQL' --datadir="$root\data" --log-error="$root\logs\mysql-fair-init.err" --initialize
if ($LASTEXITCODE -ne 0) { throw 'Inicialização MySQL falhou; parar e revisar o log protegido.' }
```

O `my.ini` deve ser gravado antes do registro do serviço. As ACLs do diretório
de configuração dão leitura à identidade do serviço; as ACLs do diretório de
logs também protegem o log de inicialização, que pode conter a senha temporária
do administrador MySQL. A sequência e sintaxe de instalação do serviço devem
ser conferidas no manual local do MySQL 8.0.46; os comandos acima são uma
proposta para aprovação, não uma garantia de execução.

Somente depois de certificados/ACLs prontos, uma autorização que inclua
explicitamente start e validação permitiria:

```powershell
Start-Service -Name 'MYSQL_RENLINK_FEIRA'
Get-Service -Name 'MYSQL_RENLINK_FEIRA'
Get-NetTCPConnection -State Listen -LocalPort 3307,33060 -ErrorAction SilentlyContinue
```

A validação autenticada subsequente deve usar `mysql.exe` do diretório
`D:\MySQL\bin`, conexão TCP a `127.0.0.1:3307`, CA aprovada e prompt interativo
de senha (`-p`, nunca senha na linha de comando). Limitar SQL a identidade da
instância, TLS/cipher, grants do administrador dessa instância e existência
dos nomes planejados; não selecionar nem ler dados de outros schemas.

### Credenciais: proposta sem cofre e sem segredo em argumentos

Não acessar o cofre Windows. Se aprovada, `mysqld --initialize` criaria a conta
administrativa inicial e uma senha temporária reportada no log de erro
protegido. Um administrador autorizado a recuperaria localmente sem copiar o
log para chat ou relatório, faria login com o cliente usando prompt interativo
`-p`, e rotacionaria a senha usando a opção MySQL 8 de senha aleatória
(`ALTER USER 'root'@'localhost' IDENTIFIED BY RANDOM PASSWORD;`). O segredo
retornado seria transferido diretamente para um gerenciador de segredos
aprovado, sem transcript, redirecionamento, argumentos ou histórico contendo
valor secreto. Se não existir método seguro disponível para essa transferência
e retenção, interromper antes de iniciar/autenticar.

Esse procedimento trata apenas a credencial administrativa inicial da nova
instância; não cria contas de runtime/migração nem o schema da aplicação.
Credenciais `renolink_feira_app` e `renolink_feira_migrator` exigirão a
confirmação posterior expressamente prevista pelo usuário.

### Validação do isolamento e reversão proposta

Antes de qualquer criação SQL, confirmar:

- Serviço novo em `Manual`, identidade esperada, executável e arquivo de
  configuração Feira; serviço `MYSQL80` sem mudança de estado ou configuração.
- Consulta autenticada confirma `@@port=3307`, `@@datadir` no caminho exclusivo,
  `@@server_uuid` próprio e não vazio; conferir também versão e certificado.
- `Get-NetTCPConnection` mostra somente `127.0.0.1:3307` para a porta clássica;
  não há listener X em 33060 para o PID/serviço novo. Os listeners anteriores do
  serviço existente são comparados por PID/porta e permanecem em 3306/33060.
- Sem regra nova no Firewall; nenhuma variável global ou configuração do
  serviço `MYSQL80` foi alterada.
- Só após exibir esse resumo e receber nova confirmação pode-se criar
  `renolink_feira`, usuários ou fixtures. Essa etapa não está incluída na
  autorização para a segunda instância.

Reversão futura: parar somente `MYSQL_RENLINK_FEIRA`; após confirmar o nome,
remover somente o registro desse serviço por comando MySQL documentado e
revisado. Preservar dados, logs, configuração e certificados. Não apagar
diretórios automaticamente; qualquer remoção exige autorização separada e
confirmação de caminho. Não executar `sc.exe delete`, remoção de arquivos,
revogação ou limpeza como parte da primeira autorização sem aprovação
específica.

Comandos de reversão propostos, não executados:

```powershell
Stop-Service -Name 'MYSQL_RENLINK_FEIRA'
& 'D:\MySQL\bin\mysqld.exe' --remove MYSQL_RENLINK_FEIRA
```

Executar apenas se o serviço novo existir, depois de confirmar seu nome e
pará-lo. Isso não remove `D:\RenoLinkFair\mysql\` nem qualquer banco; a
eliminação de arquivos continua exigindo outra autorização.

### Efeitos possíveis no MYSQL80 e decisão pendente

Impacto planejado: o binário compartilhado será executado por um segundo
processo; haverá consumo adicional de RAM, CPU e espaço em `D:`. Nenhuma
alteração intencional de configuração, serviço, porta, dados ou credenciais do
`MYSQL80`. Não é possível garantir impacto zero de recursos: a inicialização e
operação concorrentes podem disputar CPU, memória, I/O e handles. Interromper
se for necessário alterar o serviço atual, seus arquivos, Firewall ou opções
globais.

O volume `E:` indicado anteriormente não existe; backups externos não estão
resolvidos. A configuração TLS não pode ser ativada até haver certificados
aprovados. Portanto, **o plano ainda tem duas decisões prévias**: método/origem
de certificado com SAN `127.0.0.1` e destino externo de backup. Não houve
solicitação de autorização para executar as alterações neste turno, e nenhum
comando do plano foi executado.

## Definições solicitadas: TLS local e credencial administrativa

Escopo desta revisão: documentação e inspeção de código/dependências. Não
foram gerados certificados, alterados arquivos operacionais, instalados
programas, iniciados serviços, acessados credenciais ou feitas conexões.

### TLS: arquivos e emissão proposta

OpenSSL não está disponível no `PATH` nem em `D:\MySQL\bin`. O utilitário
`D:\MySQL\bin\mysql_ssl_rsa_setup.exe` existe, mas não foi executado; não foi
comprovado que ele gere um SAN IP adequado. Portanto, não usar esse utilitário
sem antes comprovar seu resultado. Não instalar ferramenta nesta etapa.

Topologia de arquivos proposta:

| Conteúdo | Local planejado | Leitura permitida |
|---|---|---|
| Chave privada da CA criptografada | Volume removível cifrado, offline, designado pelo proprietário; caminho ainda não escolhido. | Administrador emissor apenas; nunca Node ou serviço MySQL. |
| Certificado público da CA | `C:\ProgramData\RenoLink\fair\secrets\mysql-ca.pem` | Conta Node Feira e serviço MySQL. |
| Certificado público do servidor | `C:\ProgramData\RenoLink\fair\secrets\mysql-server-cert.pem` | Conta Node Feira e serviço MySQL. |
| Chave privada do servidor | `C:\ProgramData\RenoLink\mysql-fair\private\mysql-server-key.pem` | Identidade `NT SERVICE\MYSQL_RENLINK_FEIRA` (leitura), SYSTEM e administradores; negar à conta Node. |
| CSR/configuração de extensões | Diretório temporário de PKI fora do projeto, sem segredos. | Administrador emissor; apagar CSR após emissão, conforme política de retenção. |

O volume `E:` está ausente; não presumir um local para a chave CA. A operação
fica bloqueada até ser identificado um volume offline e cifrado. A CA privada
deve ser cifrada com senha solicitada interativamente pelo OpenSSL, nunca
passada em argumentos. A chave da CA não deve ser copiada para o PC servidor
nem ficar disponível durante o funcionamento do serviço. A chave privada do
servidor precisa ser utilizável sem prompt pelo serviço; por isso, seria
armazenada sem criptografia de arquivo, mas em diretório com ACL estrita e
acesso somente de leitura para a identidade do serviço. O risco residual de
comprometimento do PC e de cópia por administrador deve ser aceito antes da
ativação.

Quando houver um OpenSSL 3.x aprovado e disponível, o procedimento proposto
seria executado em console interativo, fora do projeto. Nomes de caminhos são
variáveis a preencher após escolher o volume offline e provisionar os
diretórios; não são comandos executados:

```powershell
$openssl = '<CAMINHO_APROVADO>\openssl.exe'
$caKey = '<VOLUME_OFFLINE_CIFRADO>\RenoLinkFairCA\private\ca.key.pem'
$caCert = 'C:\ProgramData\RenoLink\fair\secrets\mysql-ca.pem'
$serverKey = 'C:\ProgramData\RenoLink\mysql-fair\private\mysql-server-key.pem'
$serverCsr = 'D:\RenoLinkFair\pki-work\mysql-server.csr.pem'
$serverCert = 'C:\ProgramData\RenoLink\fair\secrets\mysql-server-cert.pem'
$extensions = 'D:\RenoLinkFair\pki-work\mysql-server-ext.cnf'

# A senha da chave CA é solicitada pelo OpenSSL; não usar -passout.
& $openssl genpkey -algorithm RSA -aes-256-cbc -pkeyopt rsa_keygen_bits:3072 -out $caKey
& $openssl req -x509 -new -sha256 -days 1825 -key $caKey -out $caCert `
  -subj '/CN=RenoLink Fair MySQL Local CA' `
  -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' `
  -addext 'keyUsage=critical,keyCertSign,cRLSign' `
  -addext 'subjectKeyIdentifier=hash'

# A chave de serviço fica sem senha de arquivo para permitir start autônomo;
# sua proteção depende das ACLs restritas descritas abaixo.
& $openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $serverKey
& $openssl req -new -key $serverKey -out $serverCsr -subj '/CN=127.0.0.1'
& $openssl x509 -req -in $serverCsr -CA $caCert -CAkey $caKey -CAcreateserial `
  -out $serverCert -days 397 -sha256 -extfile $extensions -extensions server_cert

# Conteúdo público do arquivo $extensions:
# [server_cert]
# basicConstraints=critical,CA:FALSE
# keyUsage=critical,digitalSignature,keyEncipherment
# extendedKeyUsage=serverAuth
# subjectAltName=IP:127.0.0.1
# subjectKeyIdentifier=hash
# authorityKeyIdentifier=keyid,issuer

& $openssl verify -CAfile $caCert -verify_ip 127.0.0.1 $serverCert
& $openssl x509 -in $serverCert -noout -subject -issuer -dates -ext subjectAltName -ext extendedKeyUsage
```

Pré-condições para esses comandos: OpenSSL de origem aprovada e assinatura
verificada; diretório privado da CA em volume cifrado/offline; ACLs aplicadas
antes de gerar chaves; diretórios `secrets` e `private` fora do release; relógio
do sistema correto; revisão do prazo de validade e procedimento de rotação.
`openssl verify -verify_ip` precisa confirmar especificamente `IP Address:
127.0.0.1`; um `CN=127.0.0.1` sozinho não é suficiente. Nunca imprimir a chave
privada ou copiar a chave CA para relatório. O certificado/CA são públicos,
mas não devem ser incluídos no repositório.

ACLs futuras planejadas, a aplicar somente em diretórios novos depois de
confirmar os principals e revisar herança:

```powershell
# Chave CA: somente administradores locais; serviço e Node sem acesso.
icacls '<VOLUME_OFFLINE_CIFRADO>\RenoLinkFairCA\private' /inheritance:r
icacls '<VOLUME_OFFLINE_CIFRADO>\RenoLinkFairCA\private' /grant:r '*S-1-5-32-544:(OI)(CI)F'

# Chave TLS do servidor: MySQL lê; Node não tem permissão.
icacls 'C:\ProgramData\RenoLink\mysql-fair\private' /inheritance:r
icacls 'C:\ProgramData\RenoLink\mysql-fair\private' /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 'NT SERVICE\MYSQL_RENLINK_FEIRA:(OI)(CI)RX'

# CA/certificado públicos: leitura da aplicação e do MySQL, sem chave privada.
icacls 'C:\ProgramData\RenoLink\fair\secrets' /inheritance:r
icacls 'C:\ProgramData\RenoLink\fair\secrets' /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' 'NT SERVICE\MYSQL_RENLINK_FEIRA:(OI)(CI)RX' 'renolink_fair_svc:(OI)(CI)RX'
```

`renolink_fair_svc` ainda não existe; seu SID e a resolução do principal
precisam ser confirmados quando a identidade for aprovada. Se qualquer ACL não
puder ser comprovada, interromper em vez de ampliar permissões. A configuração
final do servidor deve usar apenas `ssl-cert` e `ssl-key`; `ssl-ca` no servidor
não é necessário para TLS unilateral sem autenticação de certificado cliente.
O Node recebe somente `MYSQL_SSL_CA` apontando para o certificado público da
CA. Manter `require_secure_transport=ON`, `bind-address=127.0.0.1`,
`port=3307` e `mysqlx=OFF`.

### Compatibilidade real do conector Node.js

O projeto fixa `mysql2` **3.24.6** (`package-lock.json`). Em
[`lib/mysql.js`](../renolink_funcional/lib/mysql.js), produção carrega a CA
configurada e define `rejectUnauthorized: true` e `verifyIdentity: true`.
Inspeção do código instalado em
[`connection.js`](../renolink_funcional/node_modules/mysql2/lib/base/connection.js)
encontrou uma limitação importante:

- `mysql2` calcula `servername` como `undefined` quando `host` é um IP literal
  (`Net.isIP(host)`).
- Embora passe `Tls.checkServerIdentity` quando `verifyIdentity` está ativo,
  sua verificação manual posterior só chama a função se `servername` for uma
  string. Para `MYSQL_HOST=127.0.0.1`, essa condição não ocorre.
- Portanto, a cadeia pode ser validada com a CA e `rejectUnauthorized`, mas a
  implementação instalada não comprova a comparação do SAN IP contra
  `127.0.0.1`. A opção `verifyIdentity: true` isoladamente não basta.

**Bloqueio de segurança:** não considerar o TLS MySQL da Feira validado nem
iniciar a aplicação enquanto esse caminho não for corrigido. A solução
preferida é atualizar para uma versão do `mysql2` cuja implementação e teste
comprovem verificação de SAN IP, ou manter um patch de dependência revisado que
chame `tls.checkServerIdentity(host, cert)` também para hosts IP, mantendo SNI
desativado para o literal IP. Não editar `node_modules` manualmente como solução
persistente. O patch/upgrade requer alteração de código e testes autorizados em
outra etapa.

Teste de aceitação obrigatório depois da correção, ainda sem banco real:

1. Com uma CA de fixture e certificado de teste que contém `IP:127.0.0.1`, a
   verificação da conexão deve aceitar a cadeia e a identidade.
2. Com a mesma CA confiável e certificado de teste contendo IP SAN diferente,
   a conexão precisa falhar com erro de identidade.
3. Certificado assinado por CA não confiável também precisa falhar.
4. Confirmar por teste que `rejectUnauthorized` nunca é desativado e que não há
   bypass por `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### Inicialização e senha sem segredo em log ou histórico

> **Substituído pela Fase 10.8.2:** não execute o procedimento abaixo baseado
> em `--initialize-insecure` e named pipe. O método agora avaliado usa
> `--initialize` com log temporário protegido por ACLs; continua inativo e
> depende das autorizações/pré-condições documentadas em
> [`FASE_10_8_2.md`](./FASE_10_8_2.md).

Esta seção substitui a proposta anterior baseada em `--initialize`; não usar
essa proposta antiga, porque o MySQL grava a senha temporária no error log.

O `mysqld --initialize` gera senha temporária e a registra no error log; não
atende ao requisito de não expor segredos em logs. A alternativa proposta é
**não gerar senha temporária**:

1. Inicializar o datadir vazio com `--initialize-insecure`. Isso cria root sem
   senha; não iniciar com TCP habilitado. Na primeira inicialização e na janela
   de configuração, usar uma configuração bootstrap temporária com
   `skip-networking=ON`, `named-pipe=ON`, `named-pipe-full-access-group` limitado
   ao grupo local Administrators e `mysqlx=OFF`. A identidade do serviço
   continua sendo `NT SERVICE\MYSQL_RENLINK_FEIRA`, sem privilégios de
   administrador.
2. Antes de iniciar nesse modo, conferir a ACL efetiva do named pipe. Se não
   for possível provar que somente Administrators (e os principals de sistema
   estritamente necessários) conseguem conectar, **não iniciar** com root sem
   senha; parar e escolher outro bootstrap aprovado.
3. Conectar localmente com
   `mysql.exe --no-defaults --protocol=PIPE --user=root`, sem rede TCP. Gerar a
   senha no servidor usando
   `ALTER USER 'root'@'localhost' IDENTIFIED BY RANDOM PASSWORD;`.
   O valor retornado é exibido pelo cliente uma vez; não aparece no texto SQL.
   Não usar PowerShell transcription, transcript de terminal, redirecionamento,
   captura de saída em arquivo ou logging de consultas. Armazenar o valor
   manualmente em um gerenciador de senhas local aprovado pelo proprietário;
   se não houver local seguro disponível, interromper.
4. Desligar o serviço imediatamente. Revisar a ausência de listener TCP/3307,
   X Protocol e logs de consulta. Trocar a configuração do serviço para
   `my.ini` final (TLS ativo, loopback e named pipe desativado), preservando
   `mysqlx=OFF`; revisar novamente o binPath e a identidade antes de start.
5. Iniciar somente após certificados e ACLs validados, e testar a conexão TCP
   com CA e identidade IP validadas pelo conector corrigido. Não criar ainda
   `renolink_feira`, usuários de aplicação ou dados fictícios.

Opções bootstrap que serão usadas no arquivo temporário, não executado:

```ini
[mysqld]
basedir=D:/MySQL
datadir=D:/RenoLinkFair/mysql/data
skip-networking=ON
named-pipe=ON
named-pipe-full-access-group=BUILTIN\\Administrators
mysqlx=OFF
log-error=D:/RenoLinkFair/mysql/logs/mysql-fair-bootstrap.err
general-log=OFF
```

O nome/sintaxe exatos do grupo do named pipe e sua ACL não foram comprovados
por runtime; confirmar com documentação compatível com MySQL 8.0.46 e uma
verificação local segura antes de qualquer start. `--initialize-insecure`
somente pode ser usado com datadir novo e vazio. A senha final será solicitada
ao banco via resultado gerado; não registrar o resultado. O SQL não contém
senha, logo não há valor secreto para histórico do cliente; manter general log
desligado e não habilitar auditoria de consultas para essa operação.

Comandos revistos para a sequência bootstrap, não executados:

```powershell
$mysqld = 'D:\MySQL\bin\mysqld.exe'
$mysql = 'D:\MySQL\bin\mysql.exe'
$service = 'MYSQL_RENLINK_FEIRA'
$bootstrap = 'C:\ProgramData\RenoLink\mysql-fair\bootstrap.ini'
$finalConfig = 'C:\ProgramData\RenoLink\mysql-fair\my.ini'
$data = 'D:\RenoLinkFair\mysql\data'

# 1. Depois de ACLs e config bootstrap revisadas; datadir deve estar vazio.
& $mysqld "--defaults-file=$bootstrap" --initialize-insecure
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap não inicializado; não iniciar serviço.' }

# 2. Registrar início manual e conta virtual dedicada; ainda não iniciar
#    até comprovar por leitura que o bootstrap desabilita TCP e X.
& $mysqld --install-manual $service "--defaults-file=$bootstrap"
if ($LASTEXITCODE -ne 0) { throw 'Registro bootstrap falhou.' }
sc.exe config $service start= demand obj= "NT SERVICE\$service" password= ''
if ($LASTEXITCODE -ne 0) { throw 'Conta dedicada do serviço não foi configurada.' }

# 3. Somente após autorização específica do start e aprovação da ACL do pipe:
Start-Service -Name $service
& $mysql --no-defaults --protocol=PIPE --user=root
# No prompt SQL do cliente, executar: ALTER USER 'root'@'localhost'
# IDENTIFIED BY RANDOM PASSWORD;
# Registrar manualmente o valor retornado no gerenciador local aprovado.
# Nunca redirecionar stdout/terminal nem iniciar PowerShell transcription.

# 4. Depois de confirmar que a senha foi armazenada, parar e trocar para a
#    configuração final TLS. Não excluir nem reinicializar o datadir.
Stop-Service -Name $service
& $mysqld --remove $service
if ($LASTEXITCODE -ne 0) { throw 'Remoção do registro bootstrap falhou; parar.' }
& $mysqld --install-manual $service "--defaults-file=$finalConfig"
if ($LASTEXITCODE -ne 0) { throw 'Registro da configuração final falhou.' }
sc.exe config $service start= demand obj= "NT SERVICE\$service" password= ''
if ($LASTEXITCODE -ne 0) { throw 'Conta dedicada não foi reaplicada.' }
# Não iniciar a configuração final antes da validação TLS/certificado e de
# autorização explícita separada para start e testes autenticados.
```

O arquivo bootstrap e o `my.ini` final contêm apenas configurações, não
credenciais. Armazenar senha em um gerenciador local já aprovado e operado pelo
proprietário; não acessar nem criar credencial no Windows Vault nesta fase. Se
o cliente/ambiente registrar saída de console ou houver transcript ativo, não
executar a etapa de rotação até existir um procedimento que impeça essa captura.
O valor pode aparecer visualmente no terminal durante a rotação, mas não deve
ser copiado para logs, histórico, arquivo ou relatório.

Permissões administrativas para a futura etapa: criar diretórios novos e
ACLs, registrar/configurar/iniciar/parar exclusivamente o serviço Feira,
inicializar o datadir e inspecionar listeners/ACL do named pipe. A operação
SQL de `ALTER USER` precisa da conta root recém-inicializada no named pipe,
mas não cria banco nem usuário. A conta serviço não recebe direitos
administrativos. A etapa de armazenar o segredo depende de um gerenciador local
aprovado; não acessar o cofre Windows sem autorização explícita.

### Recuperação e pendências

- Se a geração/emissão falhar antes do start, não iniciar o serviço; preservar
  a chave CA cifrada offline e os arquivos incompletos em local restrito até
  decisão de limpeza.
- Se a senha root não puder ser rotacionada ou armazenada, manter o serviço
  parado, sem TCP, e não prosseguir. Não gravar senha em arquivo de emergência.
- Se a chave privada do servidor ou CA for exposta, parar apenas a instância
  Feira, revogar/substituir o certificado por uma nova CA aprovada e repetir a
  validação; não reutilizar credenciais. O procedimento de remoção exige
  autorização própria.
- Confirmar previamente: mídia offline cifrada para CA; disponibilidade e
  origem aprovada do OpenSSL 3; nomes e ACLs das contas Windows; método de
  senha local aprovado; compatibilidade de IP SAN no `mysql2`; e revisão do
  serviço MySQL Windows com virtual account.

Nenhuma dessas definições autoriza alterações. O provisionamento permanece
aguardando nova solicitação e confirmação explícita.
