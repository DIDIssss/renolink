# RenoLink - Protótipo local funcional

## Fase 7 — atualizações automáticas locais

SSE adiciona atualizações automáticas de propostas, status, conversas,
solicitações e negociações com cookie HttpOnly, isolamento no backend,
reconexão e recuperação pelo MySQL. Nenhuma migração ou alteração de credenciais
foi necessária. Atualize as abas abertas para carregar o cliente desta fase.
Relatório, testes e limites: [FASE_7.md](../auditoria/FASE_7.md).

`npm.cmd test` agora inclui 29 testes locais. `npm.cmd run test:phase7` executa
o teste completo com MySQL e três sessões Chrome somente em renolink_test,
preservando as fixtures. Opera nativo e aparelhos físicos ainda não foram ensaiados.

## Fase 6 — primeiro administrador ativado

O assistente local `scripts/first-admin.ps1` consulta contas existentes e exige
ID, confirmação exata do e-mail e frase explícita para conceder o papel admin.
Seu modo padrão Preview é somente leitura. Após seleção e autorização explícitas,
o usuário ID 3 recebeu o papel admin, com auditoria ID 1. Novas concessões
exigem autorização própria. O comando antigo sem
confirmação foi desativado. Procedimento:
[FIRST_ADMIN.md](database/mysql/FIRST_ADMIN.md).
Testes: `npm.cmd run test:phase6`, exclusivamente em renolink_test.
Resultado e preservação do banco principal:
[auditoria da Fase 6](../auditoria/FASE_6.md).

## Fase 5 — schema ativado, equipe ainda não provisionada

Painel da equipe, moderação de ideias, atendimento e solicitações de negociação
implementados e testados em MySQL isolado e Chrome desktop/mobile. O schema de
`renolink_dev` recebeu a Fase 5 após autorização, backup completo e validação.
O primeiro administrador, ID 3, foi posteriormente autorizado e ativado na
Fase 6. Estado da aplicação, backup e testes da Fase 5:
[relatório de ativação](../auditoria/FASE_5_ATIVACAO.md).

Testes adicionais: `npm.cmd run test:phase5:mysql` e
`npm.cmd run test:phase5:browser`, ambos exclusivamente em `renolink_test`.
As fixtures são preservadas, sem reset. O processo local já executa o código
Fase 5 com MySQL real, somente em http://127.0.0.1:3000. A página administrativa
de entrada está em /admin-login.html; a conta ID 3 já está autorizada.

## Como iniciar

1. Extraia a pasta inteira.
2. Dê dois cliques em `INICIAR_RENOLINK.bat`.
3. Abra `http://127.0.0.1:3000` no navegador.
4. Não abra os arquivos `.html` diretamente; a aplicação depende do servidor local.

## Contas de demonstração


## Banco de dados

Migração local concluída em 24/10/2026: `renolink_dev` contém os 4 usuários,
9 ideias, 7 mensagens e 1 negociação, comparados integralmente com a origem.
Os inicializadores `.bat`, `.ps1` e `npm.cmd start` usam MySQL 8.0.46 com
`renolink_app@127.0.0.1`. A senha vem do cofre Windows DPAPI
`.env.mysql.local.clixml`, ignorado pelo Git, sem senha literal nos comandos.
Se a conexão ou o cofre falhar, a inicialização é interrompida.
Os dois JSONs e seus backups foram preservados. Veja
[database/mysql/README.md](database/mysql/README.md) e
[relatório da migração](../auditoria/MYSQL_FASE4.md).

## Tecnologias

HTML, CSS, JavaScript, Font Awesome e Node.js. O backend usa `mysql2/promise` para MySQL e mantém o adaptador PostgreSQL anterior para referência e compatibilidade de desenvolvimento.

## Resetar os testes

Não execute `RESETAR_BANCO.bat` nem `npm run reset-db` sobre dados reais: são scripts históricos que sobrescrevem o original. Os testes automatizados usam dados sintéticos isolados e não precisam de reset.

Também é possível iniciar pelo terminal Windows com `npm.cmd start`. O comando
direto `node server.js` só seleciona MySQL com as variáveis explícitas;
use os inicializadores para carregar com segurança a configuração local.

## Histórico — Fase 2: segurança e persistência

O texto a seguir preserva a etapa anterior à migração MySQL:

- `data/db.json` é preservado como origem histórica. A execução local usa `data/runtime/db.json`, criado uma única vez a partir de backup verificado em `data/backups/`.
- Novos cadastros, ideias e mensagens são gravados na cópia operacional, nunca no original. Não execute os comandos de reset em uso real.
- Use `npm.cmd start` no PowerShell caso `npm.ps1` seja bloqueado. Nenhuma mudança na política do Windows é necessária.
- Execute `npm.cmd test` para os testes locais isolados. O migrador MySQL não seleciona mais JSON implicitamente; use `--source` absoluto e explícito.
- Sessões passam a usar cookie HttpOnly. Sessões antigas exigem novo login; senhas existentes são mantidas e fortalecidas após login correto. Novas senhas exigem 10 a 128 caracteres.
- PostgreSQL é opcional nesta etapa. Para habilitá-lo, é necessária configuração explícita e migração autorizada; não há fallback silencioso se a conexão falhar.

## MySQL — arquitetura atual

- Leia [database/mysql/README.md](database/mysql/README.md) para instalação Windows, variáveis, segurança e importação autorizada.
- Os inicializadores locais configuram `STORAGE_DRIVER=mysql`, `MYSQL_DATABASE=renolink_dev` e `MYSQL_USER=renolink_app`. A execução direta do módulo sem essas variáveis conserva o modo JSON histórico. Não ocorre fallback silencioso se MySQL falhar.
- `npm.cmd test` executa as regressões anteriores e os testes unitários MySQL sem conexão real.
- `npm.cmd run test:mysql` exige banco de teste dedicado/vazio, credenciais e aprovação explícita; sem aprovação o teste é ignorado.
- `db:check` faz preflight MySQL e backup sem conexão somente com origem JSON absoluta explícita (`npm.cmd run db:check -- --source <caminho>`). Na feira, também exige `--backup-dir` explícito e destino MySQL TLS autorizado. `db:migrate` exige aprovação e configuração do migrador separadas; não o execute antes do corte planejado.
- PostgreSQL permanece em `lib/postgres.js`, `database/001_initial.sql`, `scripts/migrate-postgres.js` e `test/postgres.test.js`. Comandos históricos explícitos: `db:check:postgres`, `db:migrate:postgres`, `test:postgres`.
- Produção passa a exigir MySQL com TLS, `NODE_ENV=production`, `APP_ORIGIN` HTTPS e `COOKIE_SECURE=1`.

Relatórios: `../auditoria/FASE_2.md` e `../auditoria/MYSQL.md`. O teste histórico `../auditoria/testar.cjs` reproduz a versão anterior e não é a suíte de validação atual.

A validação funcional desta migração usou exclusivamente dados novos em
`renolink_test`; os registros migrados permaneceram intactos. Estado integral
e sessões foram conferidos após reinício do Node. `renolink_dev` foi comparado
com a origem após dois processos reais da aplicação, sem escritas de teste.
