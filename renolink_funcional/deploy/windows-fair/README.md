# RenoLink Feira — modelos Windows

Estes arquivos são modelos inativos. Nenhum deles é carregado pelo aplicativo
automaticamente. Não copie `fair.env.example` para um `.env` no repositório e
nunca coloque segredos reais nestes arquivos.

## Limites e topologia

- Processo Node: `127.0.0.1:3100` (bind é fixado no código em loopback).
- MySQL futuro: `127.0.0.1:3307`, schema `renolink_feira` e conta exclusiva
  `renolink_feira_app`; a instância ainda não existe.
- O desenvolvimento local permanece em `127.0.0.1:3000`; a instância de feira
  usa porta distinta somente quando ativada por procedimento autorizado.
- Túnel futuro: um hostname autorizado para `http://127.0.0.1:3100`, com
  fallback 404. Não encaminhar MySQL, SSH, arquivos ou outros serviços.
- A configuração e cada conexão da feira validam schema, porta e
  `@@server_uuid`; a pinagem deve ser preenchida após provisionamento
  autorizado e não pode ser inferida do nome do banco.

`fair.env.example` é documentação, não um mecanismo de carregamento. O perfil
`RENOLINK_FAIR_DB_ROLE=runtime` é obrigatório para o processo da aplicação. Para
um migrador futuro, a configuração separada deve usar `APP_ENV=fair`,
`RENOLINK_FAIR_DB_ROLE=migrator`, a identidade `renolink_feira_migrator` e
destino TLS idêntico em `127.0.0.1:3307`/`renolink_feira`; não reutilizar as
variáveis/credenciais do processo runtime.

No ambiente da feira, o migrador exige `--source` explícito, absoluto,
existente, JSON regular e não symlink, e `--backup-dir` explícito. Não omite a
aprovação de migração. Selecionar e revisar a origem fictícia antes de qualquer
preflight, que cria backup/manifesto; `--apply` exige autorização e causa DDL
e DML no destino novo. O DDL de preparação inclui os esquemas `001_initial.sql`
e `002_phase5.sql` (12 tabelas InnoDB). Os defaults antigos do migrador não são
usados.

`fair.env.example` é documentação, não um mecanismo de carregamento. No futuro,
um operador autorizado deverá fornecer as variáveis ao processo por um meio
protegido, disponível somente à conta Windows dedicada. O script de início
valida esses valores, mas não lê arquivos de ambiente nem cofre.

O caminho de inicialização MySQL usa um método `initialize` específico: valida
o banco/versão conectados, mantém `GET_LOCK`, configura apenas variáveis de
sessão e abre/fecha uma transação sem carregar o snapshot das tabelas. As
transações normais continuam carregando e salvando estado; elas mantêm os
controles de lock, transação e rollback. `/health/live` não consulta o banco;
readiness faz uma consulta de leitura e precisa de autorização separada.

## Início e encerramento

Preparação futura, somente depois das aprovações listadas em
[`../../../auditoria/FASE_10_4.md`](../../../auditoria/FASE_10_4.md):

1. Provisionar primeiro o sistema operacional suportado/ESU aplicável,
   identidade Windows, ACLs, release, banco exclusivo, TLS, credenciais e
   diretórios protegidos.
2. Confirmar que `127.0.0.1:3100` está livre e que a instância MySQL de feira
   está limitada a `127.0.0.1:3307`, schema `renolink_feira`, e que o
   `RENOLINK_FAIR_MYSQL_SERVER_UUID` corresponde à instância aprovada. Não
   alterar `MYSQL80` compartilhado.
3. Fornecer as variáveis do modelo ao processo autorizado, substituindo todos
   os placeholders e mantendo segredos fora do projeto, Git, argumentos e logs.
4. Em console da conta local dedicada `renolink_fair_svc`, não administrativa,
   executar `Start-Fair.ps1` com `-AuthorizeActivation`. O script recusa outra
   identidade e token administrativo; sem a opção encerra antes de iniciar
   Node. O processo fica em primeiro plano; o log é gravado na pasta aprovada.
5. Parar no mesmo console com `Ctrl+C`. O servidor captura SIGINT, fecha SSE,
   aguarda conexões por até 10 segundos e fecha o armazenamento. Confirmar o
   encerramento antes de fechar a sessão. Não usar encerramento forçado.

O modelo **não registra serviço Windows**, não altera PATH/políticas, não cria
contas, pastas ou ACLs e não inicia MySQL nem cloudflared.

## Health check local

`Health-Fair.ps1` consulta apenas `127.0.0.1:3100`. Por padrão verifica
`/health/live`. A opção `-Readiness -AllowDatabaseRead` consulta
`/health/ready`, que faz uma verificação de leitura no MySQL; não a executar até
que o banco e a autorização estejam prontos. Os cabeçalhos HTTPS são sintéticos
e servem somente ao teste local; isto não substitui a validação ponta a ponta
via Cloudflare Tunnel.

## Túnel

`cloudflared.yml.example` é apenas a forma da configuração futura. O UUID,
hostname, caminho de credenciais e domínio são placeholders. Não existe túnel
nem token criado. Revisar ingress, cabeçalhos, cookies, HTTPS e SSE em
homologação antes de divulgação.

## Backup e restauração

O fluxo é especificado em [`backup-restore.example.md`](./backup-restore.example.md).
Ele não é executável: cliente MySQL, ferramenta/identidade de criptografia,
destino externo, conta de backup e ACLs precisam ser escolhidos e aprovados.
Não produzir dump em claro nem restaurar em `renolink_dev`/`renolink_test`.

## O que falta

- Revisar [`mysql-bootstrap.ini.example`](./mysql-bootstrap.ini.example) e
  [`mysql-fair.ini.example`](./mysql-fair.ini.example) somente como modelos.
  `--initialize` grava a senha temporária no error log; ACLs restritivas do
  diretório de bootstrap precisam ser aplicadas e comprovadas antes de criá-lo.
  A verificação declarativa em `lib/fair-mysql-bootstrap-plan.js` não verifica
  ACLs do Windows e nunca executa comandos. Não usar o named pipe da proposta
  anterior sem homologar suporte e ACLs para a segunda instância.
- Confirmar atualizações de segurança do Windows e elegibilidade ESU aplicável.
- Revisar política efetiva do Firewall e listeners de MySQL (3306/33060) e SSH
  (22); esclarecer autenticação SSH. Nenhum desses estados é corrigido por
  estes modelos.
- Criar, com autorização explícita, conta Windows sem privilégios elevados,
  release isolado, diretórios/ACLs e instância de banco de feira.
- Aprovar credenciais exclusivas, CA TLS MySQL, ferramenta de backup e cópia
  criptografada fora do PC.
- Autorizar instalação/configuração do cloudflared, túnel, domínio/DNS e testes
  externos. Esta fase não os autoriza.
