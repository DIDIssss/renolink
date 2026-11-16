# RenoLink — Fase 9: estado da homologação

Data: 31/10/2026

## Decisão

**Hospedagem não homologada.** A evidência disponível é local e não valida Nginx,
proxy real, TLS do MySQL ou qualquer infraestrutura externa. Nenhuma aplicação
foi publicada, nenhum serviço externo foi contratado e nenhum recurso externo
foi criado durante esta verificação.

O relatório foi produzido a partir dos artefatos existentes. Não foram
executados novamente testes já registrados, operações de banco, migrações,
provisionamentos ou tentativas de `SnapshotAfter`.

## Evidências revisadas

| Verificação | Evidência | Resultado |
|---|---|---|
| Testes locais | [`phase9-local-tests.json`](../renolink_funcional/data/runtime/phase9-local-tests.json) | **62/62 passaram**, 0 falhas, exit code 0; Node v24.19.0. Inclui os testes de segurança, MySQL (unitários), hosting, proxy/cookies e SSE. O registro aponta 13 arquivos de teste. |
| Regressão MySQL | [`phase9-regression.json`](../renolink_funcional/data/runtime/phase9-regression.json) | **Passou** em `renolink_test`: 16 rotas × 5 contextos, 20 gravações concorrentes e rollback induzido; `schemaChanged: false`. |
| HTTPS local | [`phase9-https.json`](../renolink_funcional/data/runtime/phase9-https.json) | **Passou** com certificado sintético verificado e rejeição de CA desconhecida, healthcheck, cookies seguros, autorização administrativa, dois processos Node, SSE entre processos, reconexão após reinício, recuperação de falha e 20 ideias concorrentes. Só loopback; nenhum porto público. |
| Transporte MySQL no teste HTTPS | Mesmo relatório | **Não validado com TLS**: o teste declara `mysqlTlsValidated: false` e usa a configuração local de loopback. |
| Dependências | [`phase9-npm-audit.json`](../renolink_funcional/data/runtime/phase9-npm-audit.json) | Registro existente: zero vulnerabilidades reportadas (28 dependências contabilizadas). |
| Pacote de staging | [`phase9-release.json`](../renolink_funcional/data/runtime/phase9-release.json) | Auditoria local passou: 40 arquivos, fontes correspondentes, sem JSON original, cofre, chave privada ou hash scrypt embutidos. Não comprova publicação. O próprio registro marca `gitHistoryReviewed: false`. |

Os resultados acima são os registrados nos artefatos existentes; não foram
reexecutados para esta finalização.

## Snapshot, integridade e limites da confirmação

Existe snapshot **anterior** da fase 9 em
[`phase9-dev-before.json`](../renolink_funcional/data/runtime/phase9-dev-before.json).
Ele registra `renolink_dev`, marcado como `readOnly: true` no artefato, com:

- Estado SHA-256: `769e197bb56c6c7776089d9fb501efbe1ddf102fde607408c55312bdf9dea7aa`
- Schema SHA-256: `6c3b6aa742d9cc5e66f6d0e07061c661c89a88d59a216ec81b99068755c9f59e`
- Equipe/administração SHA-256: `9d41dd52adc7ab7aeea30b9b261b7f0b94d1cff02f4dc8a571e928cf6ab13a63`
- Contagens: 8 usuários, 11 ideias, 1 negociação, 7 mensagens, 12 sessões,
  1 registro de equipe, 2 conversas, 4 mensagens de suporte, 1 solicitação e
  11 registros de auditoria.

O snapshot anterior da fase 9 coincide integralmente com os snapshots
`phase83-round1` **before** e **after**, cujo relatório da fase 8.3 registra
`unchanged: true`. Os hashes de estado, schema e equipe e todas as contagens
coincidem. O hash do estado cobre os registros carregados, inclusive salts e
hashes de credenciais; o hash de equipe cobre os registros administrativos.
Não são credenciais em texto claro.

**Não existe `phase9-dev-after.json`.** Portanto, a comparação disponível
confirma a preservação no ciclo anterior da fase 8.3 e que o snapshot inicial
da fase 9 ainda tem aqueles mesmos valores, mas **não demonstra por si só o
estado de `renolink_dev` após a fase 9**. Não se declara preservação pós-fase 9
como comprovada por snapshot posterior.

Para os JSONs locais, o resultado HTTPS registra os mesmos SHA-256 para
`data/db.json` e `data/runtime/db.json` e declara que as linhas antigas foram
preservadas. O teste calcula os hashes antes e os compara novamente ao final.
Esse teste usou `renolink_test` e dados sintéticos; não é uma comparação
posterior de `renolink_dev`.

## Recusa de `SnapshotAfter`

O script [`test-phase9.ps1`](../renolink_funcional/scripts/test-phase9.ps1)
implementa `SnapshotAfter` chamando
[`phase7-dev-snapshot.js`](../renolink_funcional/scripts/phase7-dev-snapshot.js).
O snapshot Node é restrito a `127.0.0.1`, `renolink_dev` e `renolink_app`,
faz leitura dos registros e grava o resultado em arquivo. Isso não equivale a
uma transação estritamente `READ ONLY`, conforme a correção abaixo. A rota PowerShell
importa `.env.mysql.local.clixml`, recupera a credencial da conta de aplicação,
define marcadores de aprovação da fase e a invocação registrada no script usa
`-ExecutionPolicy Bypass`. Além disso, o código Node oculta a causa concreta de
falha e retorna apenas uma mensagem genérica.

Não foi encontrado no workspace um log/resultado da revisão automática que
identifique sua regra específica; o arquivo `phase9-dev-after.json` também não
foi criado. Assim, **não é possível afirmar qual regra interna exata recusou a
execução**. O motivo técnico mais provável, inferido do caminho de execução, é
a combinação de acesso a segredo local e a `renolink_dev`, ativação de
marcadores de aprovação e uso explícito de `ExecutionPolicy Bypass`.

**Correção de precisão:** a implementação atual lê os registros sem executar
DML, mas `phase7-dev-snapshot.js` chama `mysql.transaction()`, que adquire
`GET_LOCK`, altera variáveis de sessão (`time_zone` e `sql_mode`) e usa uma
transação comum, não `READ ONLY`. Portanto, o rótulo `readOnly: true` descreve
a intenção de não alterar as tabelas de negócio, mas **não demonstra uma
verificação estritamente somente leitura no servidor MySQL**. Ela não deve ser
reexecutada para essa finalidade. A recusa foi mantida: nenhuma política ou
bloqueio foi contornado e a operação não foi tentada novamente.

## Configurações revisadas

- **HTTPS e cookies:** a política de produção exige origem HTTPS canônica,
  `COOKIE_SECURE=1`, `SameSite=Strict` e cookies `HttpOnly`; exige também
  `TRUST_PROXY=loopback`. O teste local verificou certificado e cookie seguros.
- **Proxy:** o exemplo Nginx limita TLS a 1.2/1.3, encaminha para loopback,
  sobrescreve os cabeçalhos encaminhados e desativa buffer/cache/gzip em SSE.
  Configuração SSE prevê timeout de 75 s para heartbeat de 15 s. O exemplo
  mantém `allow 127.0.0.1; deny all;` e domínio fictício `.invalid`; Nginx real
  não foi instalado nem testado.
- **SSE:** há teste local de eventos, conexão entre processos e reconexão após
  reinício. O comportamento através do proxy Nginx real ainda precisa ser
  verificado; replay e limites são locais ao processo.
- **MySQL:** produção exige `MYSQL_SSL=1`; o código configura validação de
  certificado e identidade, e aceita CA explícita. A conexão TLS real com o
  servidor MySQL de homologação não foi testada.
- **Serviço:** o unit file systemd e os modelos de staging são apenas exemplos;
  não foram instalados, habilitados ou iniciados.

## Credenciais e publicação

O arquivo [`staging.env.example`](../renolink_funcional/deploy/staging.env.example)
é um modelo sem senha preenchida e com domínio fictício. A revisão do pacote
registrada em `phase9-release.json` excluiu arquivos `.env`, `.clixml`, `.pfx`,
`.pem`, `.key`, JSONs originais e hashes de credenciais embutidos. Não há
evidência de credencial real nos arquivos de implantação revisados. O cofre
local existente não foi lido nem alterado para esta finalização.

O pacote de release está apenas no workspace local. Não houve upload, alteração
de DNS, abertura de portas, instalação de Nginx/systemd, criação de banco ou
usuários externos, contratação de serviço ou publicação da aplicação.

## Pendências e autorizações necessárias

1. Obter procedimento autorizado e registrar a decisão da revisão automática
   antes de qualquer snapshot posterior de `renolink_dev`. Não executar com
   `ExecutionPolicy Bypass` nem acessar o cofre sem autorização explícita.
2. Autorizar e preparar um ambiente externo isolado, credenciais novas e
   allowlist/rede privada; validar grants, TLS MySQL com CA/hostname, proxy
   Nginx real, cookies, SSE, healthcheck, carga, falhas e recuperação.
3. Executar os testes externos no destino real, incluindo reconexão SSE através
   do proxy e persistência após reinício, somente com autorização do ambiente.
4. Revisar histórico Git do release em um checkout/repositório disponível;
   a auditoria existente registra que isso não foi feito.
5. Só então decidir sobre homologação. Até que esses testes externos sejam
   realizados, o estado permanece **preparação local; hospedagem não homologada**.
