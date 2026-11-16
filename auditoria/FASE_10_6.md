# Fase 10.6 — Endurecimento da inicialização

## Escopo e segurança

Foram feitas alterações somente no código, testes e documentação do projeto,
conforme autorizado. Não houve conexão ao MySQL/PostgreSQL, inicialização do
servidor RenoLink, importação, acesso ao cofre Windows, alteração de serviços
ou configurações do Windows, instalação de software ou exposição externa.

## Arquivos alterados

- `renolink_funcional/lib/mysql.js`
- `renolink_funcional/lib/postgres.js`
- `renolink_funcional/server.js`
- `renolink_funcional/scripts/migrate-mysql.js`
- `renolink_funcional/test/mysql.test.js`
- `renolink_funcional/test/postgres.initialize.test.js` (novo)
- `renolink_funcional/deploy/windows-fair/fair.env.example`
- `renolink_funcional/deploy/windows-fair/Start-Fair.ps1`
- `renolink_funcional/README.md`
- `renolink_funcional/database/mysql/README.md`
- `renolink_funcional/deploy/windows-fair/README.md`

## Correções

### Inicialização e transações

O startup agora chama `initialize()` quando o store oferece esse método. O
MySQL valida o banco realmente selecionado, a versão do MySQL e a versão do
schema, mantendo o `GET_LOCK`, isolamento, configurações de sessão, transação,
rollback e liberação segura do lock. Para a inicialização, consulta somente a
metainformação `schemaVersion`; não carrega as tabelas nem hashes/salts de
senhas ou tokens de sessão.

O PostgreSQL segue o mesmo princípio: conserva a transação e o advisory lock
existente e verifica somente a versão do schema. Para stores antigos sem
`initialize()`, o helper do servidor mantém o fallback
`transaction(() => {})`. As transações normais continuam carregando e salvando
seu estado pelo caminho existente; nenhum controle de concorrência foi
removido.

Essa alteração reduz a leitura no startup, mas não torna a inicialização
puramente offline: uma futura execução ainda precisará conectar ao banco
configurado e ler a metainformação do schema.

### Banco exclusivo da feira

Com `APP_ENV=fair`, a configuração recusa destinos diferentes do endereço
loopback `127.0.0.1`, porta `3307`, schema `renolink_fair`, conta
`renolink_fair_app` (runtime) ou `renolink_fair_migrator` (migração), senha
não vazia e TLS com validação do certificado/identidade e CA explícita. O banco
selecionado pela conexão também é comparado com o destino configurado antes do
lock. Em produção, `renolink_dev` e `renolink_test` continuam recusados.

Essas são validações de configuração/caminho; não comprovam que o servidor
MySQL real está isolado, que as grants efetivas estão corretas, nem que o TLS
será negociado como esperado.

### Migrador

O migrador deixou de escolher implicitamente `data/runtime/db.json` ou
`data/db.json`. Ele exige `--source` absoluto, existente, arquivo JSON regular
e não symlink, além de `--check` ou `--apply`. No ambiente feira, exige ainda
`--backup-dir` absoluto e explícito e valida o destino/conta migradora antes
de criar backup ou conectar.

Na ausência ou invalidade da origem, o comando interrompe antes do preflight,
backup e conexão. `--check` pode criar backup e manifesto depois que os
argumentos forem validados. `--apply` continua podendo executar DDL/DML e
requer aprovação independente; não foi executado nesta fase.

## Testes e verificações executados

Com variáveis de integração PostgreSQL removidas apenas no processo de teste:

- `node --test test/mysql.test.js test/mysql.read.test.js test/mysql.scopes.test.js test/hosting.test.js test/postgres.initialize.test.js test/postgres.test.js`
  - 37 testes contabilizados: 36 passaram, 0 falharam e 1 teste PostgreSQL
    real foi ignorado por depender de autorização/URL de banco.
  - O teste PostgreSQL executado foi mockado; verificou lock/transação,
    consulta da versão e ausência de leitura das tabelas do snapshot.
  - O teste MySQL de inicialização comprovou pelo mock a ausência do
    carregamento das tabelas sensíveis, tratamento de versão incompatível e
    rollback em falha.
  - Os testes de migração usaram fixtures locais; nenhum banco foi acessado.
- `node --check` passou nos seis arquivos JavaScript modificados ou novos.
- O parser PowerShell analisou `Start-Fair.ps1` sem executar o script.
- Verificações estáticas do modelo confirmaram papel runtime, schema fixo,
  senha vazia no exemplo, túnel apontado somente para loopback e fallback 404.

Uma primeira execução identificou apenas uma expectativa de mensagem
incompatível em um teste; o assert foi corrigido e a execução final acima
passou integralmente para os testes locais habilitados.

## Riscos e pendências

1. **Banco e grants ainda não verificados:** será necessário provisionamento
   explicitamente autorizado de um banco independente, revisão das grants
   efetivas e validação de que o runtime não possui DDL nem acesso a dev/test.
   Não usar a conta migradora no processo da aplicação.
2. **TLS MySQL não exercitado:** ainda precisam ser comprovados CA, identidade
   do certificado e negociação TLS no servidor isolado.
3. **Schema exigido:** o novo `initialize()` espera metadado de schema versão
   5. Um banco vazio não será criado ou migrado pelo startup; a preparação
   inicial deverá seguir procedimento de migração separado e autorizado.
4. **Operações funcionais gravam:** uma conta runtime estritamente somente
   leitura pode servir para comprovar o startup/readiness, mas não comprova os
   fluxos que escrevem dados. Quaisquer grants adicionais devem ser mínimas e
   aprovadas antes dos testes funcionais.
5. **Origem de migração:** a origem fictícia e o diretório de backup precisam
   ser escolhidos e revisados explicitamente. Não foi feita importação.
6. **Endpoint do túnel:** o modelo `windows-fair` usa atualmente
   `127.0.0.1:3100`, enquanto a Fase 10.3 mencionava `127.0.0.1:3000`.
   Confirmar a porta local pretendida antes de configurar o túnel.
7. Permanecem pendentes as comprovações operacionais das Fases 10.1–10.5,
   incluindo cobertura de segurança do Windows, portas/Firewall/SSH, ACLs,
   identidade dedicada, recuperação de backup, celulares físicos, SSE e
   carga concorrente. Os testes locais não comprovam capacidade nem prontidão
   para publicação.

## Reversão

Antes de qualquer alteração futura, preservar cópia revisada dos arquivos.
Para reverter somente esta fase, restaurar as versões anteriores dos arquivos
listados em “Arquivos alterados” e remover o novo teste
`test/postgres.initialize.test.js` e este relatório, após autorização.
Não reverter arquivos de dados, diretórios de runtime, banco, credenciais ou
configurações do Windows como parte dessa reversão.

## Condições para primeira execução isolada

Não executar até que haja autorização explícita para cada etapa aplicável:

1. Confirmar Windows coberto por atualizações de segurança e isolamento do
   MySQL/SSH, sem afetar dependências de outros projetos.
2. Provisionar sob autorização a conta Windows não administrativa, diretórios
   restritos, release revisado, banco exclusivo e contas distintas de runtime
   e migração.
3. Aprovar origem fictícia, backup e migração inicial separadamente; confirmar
   schema versão 5 e grants mínimas antes do primeiro startup.
4. Fornecer segredos exclusivamente por meio protegido, fora do projeto,
   argumentos, logs e Git; validar TLS MySQL com CA confiável.
5. Confirmar porta local escolhida e o endpoint do túnel; testar primeiro
   localmente em loopback, sem exposição externa.
6. Validar rotas administrativas, cookies, HTTPS, SSE, backup/restore, logs,
   celulares físicos, recuperação após falhas e carga de até 50 visitantes
   com dados fictícios e ambiente independente.
7. Obter autorização separada antes de criar túnel, publicar ou expor a
   aplicação. A homologação e a capacidade não estão comprovadas.
