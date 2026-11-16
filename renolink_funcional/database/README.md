# Persistência e migração PostgreSQL

> Documento da fase 2 conservado. A arquitetura principal passou a MySQL: consulte [mysql/README.md](mysql/README.md). Os comandos genéricos `db:check` e `db:migrate` agora selecionam MySQL; para esta implementação histórica use `db:check:postgres` e `db:migrate:postgres`. Em produção, o backend exige MySQL. Os scripts, schema e testes PostgreSQL continuam preservados.

## Situação atual

O modo padrão continua local e sem serviço externo: uma cópia operacional do JSON, transações serializadas no processo, gravação em arquivo temporário com fsync e rename, e lock exclusivo de processo. O banco original não é usado para escrita. O lock evita dois servidores RenoLink atualizados sobre o mesmo arquivo. Não garante coordenação com editores externos ou com o servidor antigo; não execute a versão antiga em paralelo.

Um encerramento abrupto pode deixar o `.lock`. Não o remova automaticamente: confirme primeiro que o processo registrado não existe mais e preserve uma cópia do banco antes de liberar o bloqueio. Nenhum reset é necessário. Arquivos `.tmp` eventualmente deixados por falha também não são publicados nem excluídos automaticamente.

Esse modo permite validar integridade localmente, mas não substitui PostgreSQL para múltiplas instâncias, nem oferece garantias de recuperação equivalentes a um banco transacional em falhas de energia. A serialização também limita throughput.

## Modelo PostgreSQL preparado

`001_initial.sql` define tabelas de usuários, ideias, negociações, mensagens, sessões, metadados e importações. IDs originais são preservados como bigint e não renumerados. Os contadores do JSON são mantidos em `renolink_meta`, alocados dentro da mesma transação que cria o registro; não dependem de sequências reiniciadas incorretamente.

- E-mail possui índice único normalizado.
- Autor de ideia é anulável para preservar as oportunidades de demonstração sem autor.
- Negociação referencia ideia, criador e empresa, tem unicidade por ideia/empresa e exige que criador corresponda ao autor da ideia.
- Mensagens e sessões referenciam usuários.
- Sessões armazenam somente digest SHA-256 do token, datas de criação/expiração/revogação e índice por usuário.
- FKs usam `ON DELETE RESTRICT`. Não há exclusões em cascata ou limpeza automática de registros.
- Índices cobrem autor, status/data, participantes e expiração de sessões.
- Campos adicionais não conhecidos são preservados em `extra` JSONB; os campos principais têm colunas próprias.

O adaptador usa um único cliente por transação, `BEGIN`, lock consultivo transacional, leitura atualizada, gravação parametrizada e `COMMIT`/`ROLLBACK`. O lock também coordena pools/processos diferentes que usem este adaptador. A resposta HTTP só é enviada após o commit. Esta primeira versão deliberadamente lê o conjunto de dados e serializa as operações para manter compatibilidade com a aplicação; otimização para consultas específicas e locks mais finos fica para o teste de carga.

## Backup e preflight sem infraestrutura

Na pasta `renolink_funcional`:

```powershell
npm.cmd run db:check
```

Sem `--apply`, não conecta ao PostgreSQL. Valida estrutura, IDs únicos, e-mails duplicados, contadores e relacionamentos; cria backup por conteúdo e manifesto; relê e verifica o SHA-256. Um backup ou manifesto já existente e divergente é recusado, nunca sobrescrito.

O arquivo de origem padrão é `data/runtime/db.json`, se existir, e caso contrário `data/db.json`. Para selecionar explicitamente:

```powershell
node scripts/migrate-postgres.js --check --source data/runtime/db.json
```

Cada backup é nomeado `data/backups/db-<SHA256>.json`, acompanhado de `.manifest.json` com hash, tamanho e contagens. Guarde outra cópia segura fora desta máquina antes da migração real; o backup local foi verificado, mas restauração operacional em infraestrutura externa ainda não foi ensaiada.

## O que falta configurar

1. PostgreSQL de destino e de teste, fornecidos pelo operador. Nenhum serviço de banco foi instalado.
2. `DATABASE_URL` real por variável de ambiente/gerenciador de segredos, com conexão TLS validada conforme o provedor. Não colocar credenciais no repositório, navegador ou relatório.
3. Banco/schema dedicado e vazio, permissões de criação para o papel migrador, e permissões mínimas de leitura/escrita para o papel da aplicação. Não utilizar superusuário na execução.
4. Aprovação explícita para a importação real, janela de corte sem escritas e cópia externa verificável do backup.
5. PostgreSQL de teste autorizado para executar `npm.cmd run test:postgres`, com `TEST_DATABASE_URL` e `RENOLINK_TEST_POSTGRES_APPROVED=1`. O teste cria um schema aleatório e o conserva; não executa DROP/DELETE. Nenhuma dessas variáveis é preenchida automaticamente com credenciais fictícias.

O arquivo `.env.example` é documentação; a aplicação não carrega `.env` automaticamente. Configure as variáveis no terminal ou no mecanismo de segredos do ambiente.

## Procedimento de migração futura — exige aprovação

1. Parar o servidor e impedir novas escritas. Confirmar qual arquivo operacional contém os registros mais recentes; importar apenas o original depois de novos cadastros descartaria esses novos registros do destino.
2. Executar preflight com `--source` explícito e preservar backup externo. Não misturar bancos de demonstração com dados reais.
3. Após aprovação, configurar `DATABASE_URL` e `RENOLINK_MIGRATION_APPROVED=1` no terminal de migração e executar `node scripts/migrate-postgres.js --apply --source data/runtime/db.json` (ou o original se nunca houve execução operacional).
4. O migrador recusa uma origem com lock ativo. Cria o schema de tabelas em transação, recusa destino com registros, insere IDs e dados, lê novamente e compara contagens, IDs, relacionamentos e conteúdo campo a campo. Qualquer falha reverte a transação.
5. Reexecução com o mesmo hash e destino ainda idêntico retorna `already-imported`, sem duplicar registros. Se o destino já evoluiu, a comparação recusa a reexecução: não reaplica o snapshot sobre dados mais novos. Outra origem não é mesclada automaticamente com destino não vazio.
6. Remover a variável de aprovação do terminal e configurar `STORAGE_DRIVER=postgres` para a aplicação. Testar os fluxos antes de habilitar acesso dos visitantes. Conexão ou schema inválidos impedem a inicialização; não há retorno silencioso ao JSON.
7. Manter origem e backups. Planejar rollback de implantação sem retornar a um snapshot antigo depois que o PostgreSQL receber novas escritas; reconciliar esses registros primeiro.

Sessões legadas são importadas como revogadas, sem token bruto; não são transportadas como sessões válidas. Usuários, ideias, mensagens, negociações e metadados são preservados. Hashes antigos permanecem até o login correto efetuar atualização para scrypt. A importação não precisa conhecer senhas.

## Autenticação e operação

Novas senhas e upgrades utilizam scrypt nativo assíncrono, N=32768, r=8, p=3, salt aleatório e chave de 64 bytes. A comparação usa tempo constante. Não é possível converter SHA-256 em scrypt sem a senha: o upgrade ocorre apenas após verificação correta, dentro da transação, ou futuramente por redefinição de senha. Não há redefinição em massa ou senha padrão nova. Contas inativas continuarão com hash legado até autenticação ou recuperação autorizada.

Cookies têm HttpOnly, SameSite=Strict, Path=/ e validade de 8 horas, também verificada no servidor. Em HTTPS configurar `COOKIE_SECURE=1` e `APP_ORIGIN` com a origem exata. Tokens não aparecem em JSON, logs ou localStorage; o localStorage conserva somente o perfil usado pela interface. Logout revoga a sessão atual, e `/api/auth/logout-all` revoga todas do usuário. Sessões expiradas/revogadas são conservadas para evitar exclusão de registros nesta etapa.

POST exige JSON, valida origem e bloqueia contexto cross-site; não há CORS aberto. Limites locais por IP: 10 logins/15 minutos, 5 cadastros/15 minutos, 120 outras escritas/minuto e 600 requisições/minuto; login também tem limite de 20 tentativas por e-mail/15 minutos. As cotas incluem tentativas válidas. Reiniciar o processo zera esses limites; múltiplas instâncias precisam de armazenamento de limites compartilhado e política de proxy confiável. `X-Forwarded-For` não é aceito cegamente. Configurar isso antes da feira evita que um proxy concentre todos os visitantes em uma única cota.

Produção exige `STORAGE_DRIVER=postgres`, `COOKIE_SECURE=1` e `APP_ORIGIN` HTTPS. O servidor continua escutando apenas em 127.0.0.1; hospedagem, proxy, certificados e abertura de rede não fazem parte desta etapa.

Referências consultadas: [Node.js crypto/scrypt](https://nodejs.org/download/release/latest-jod/docs/api/crypto.html), [transações node-postgres](https://node-postgres.com/features/transactions), [locks transacionais PostgreSQL](https://www.postgresql.org/docs/18/explicit-locking.html).
