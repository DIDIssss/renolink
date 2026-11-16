# Homologação isolada — preparação, sem publicação

Nenhum destes modelos foi instalado. Banco e contas abaixo ainda **não foram
criados**. A execução externa requer autorização, origem real e credenciais novas.
O modelo aprovado tecnicamente é uma VM Linux, Nginx TLS no mesmo host e Node em
127.0.0.1:3000. Não abrir essa porta publicamente. PaaS exige outro perfil de proxy
e bind, ainda não homologado; não trocar para 0.0.0.0 automaticamente.

## Provisionamento a aprovar

1. Criar exclusivamente `renolink_staging`, verificando ausência antes, sem
   reutilizar renolink_dev/test. MySQL 8.0.17+ ou 8.4, InnoDB,
   utf8mb4_0900_bin, endpoint primário direto, TLS com CA e hostname verificados.
2. Contas novas: renolink_staging_app (SELECT nas 12 tabelas; INSERT/UPDATE
   somente em meta, users, ideas, messages, negotiations, sessions, conversations,
   support_messages e requests; INSERT em audit, sem UPDATE; staff/imports
   somente leitura). renolink_staging_migrator: CREATE, REFERENCES,
   SELECT/INSERT/UPDATE somente nesse schema, sem ALTER/DROP/DELETE desnecessários.
   renolink_staging_backup: SELECT; privilégios adicionais somente se necessários
   e aprovados. Sem GRANT OPTION, privilégios
   globais, hosts '%' ou senhas compartilhadas com dev. Restringir à rede/IP
   privado da aplicação. Conferir escaping de '_' e partial_revokes com o DBA;
   verificar SHOW GRANTS e permissões efetivas antes de usar. Preferir grants
   por tabela com nome de schema literal; em grants de nível database (schema.*)
   '_' precisa de escape quando partial_revokes=OFF, enquanto qualificadores de
   tabela são literais. O diagnóstico distingue esses casos e não altera a flag.
3. Banco novo vazio: revisar e aplicar somente 001_initial.sql, 002_phase5.sql
   e staging-meta.sql. Os CREATEs mantêm PK/FK/CHECK/índices originais. DDL MySQL
   tem commit implícito: não prometer rollback do schema. Falha exige parar,
   preservar o destino e revisar, sem reset ou recriação automática.
4. Não restaurar dumps reais nem JSON operacional em staging. Credenciais novas
   no gerenciador de segredos ou /etc/renolink/staging.env com dono restrito,
   modo 0600/0640 e diretórios 0700/0750; fora do release e do Git. CAs/chaves
   montadas fora do release. Não usar o cofre DPAPI do Windows no servidor.
5. Preparar um segredo aleatório de pelo menos 20 caracteres somente para as
   contas fictícias, em arquivo privado via gerenciador de segredos. Com conta
   migradora de staging, STAGING_FIXTURE_PASSWORD_FILE apontando ao arquivo e
   RENOLINK_STAGING_SEED_APPROVED=1, executar `node scripts/staging-seed.js`.
   Recusa destino errado, TLS ausente, usuário indevido ou dados preexistentes;
   cria criador/empresa/equipe fictícios @homologacao.invalid e auditoria. Nunca
   usar a senha ou conta administrativa real. A execução não foi autorizada aqui.

## Release e início (somente depois de autorização)

- Preparar pacote local: `node scripts/package-staging.js`. A allowlist exclui
  JSONs, backups, cofre, .env, node_modules, testes, logs e scripts de migração.
  Validar manifest.json e transferir apenas esse release. Sem auto-upload.
- No destino: Node 24 LTS, patch atualizado validado; `npm ci --omit=dev --ignore-scripts` com
  lockfile. `npm start` continua sendo o inicializador Windows local. Usar
  `npm run start:staging` ou systemd no Linux. Sem migrações no startup.
- Preencher arquivo real a partir de staging.env.example e injetar no processo,
  sem echo/printenv/logs. `node scripts/staging.js check` valida sem rede;
  `node scripts/staging.js diagnose` verifica identidade, TLS e grants por leitura.
- Validar `nginx -t` no host externo antes de instalar. Trocar domínio/certificado
  e aprovar VPN/allowlist. O template nega todos por padrão, salvo loopback.
  Não habilitar nginx/systemd, emitir certificado ou alterar DNS nesta fase.
- Autorização específica: RENOLINK_STAGING_START_APPROVED=1 e
  `node scripts/staging.js start`. Node escuta apenas loopback. O serviço usa
  usuário Linux sem privilégios, filesystem protegido e logs JSON sanitizados.

## Rede, HTTPS e SSE

Nginx termina TLS, sobrescreve X-Forwarded-For pelo endereço da conexão,
X-Forwarded-Proto=https e remove Forwarded/X-Real-IP. Nunca concatenar XFF
recebido do cliente. O backend só confia nesse contrato quando o peer é loopback;
sem configuração explícita ignora cabeçalhos encaminhados. Não adicionar CDN/LB
antes de revisar a cadeia e regras de confiança. Não servir arquivos por root/alias.

SSE: proxy_buffering off, proxy_cache off, gzip off, HTTP/1.1 no upstream,
timeout 75 s para heartbeat de 15 s; não retransmitir POST em falha. Confirmar
flush imediato, eventos privados, reconexão e expiração no proxy real. Uma
instância Node é o início recomendado; duas foram testadas localmente via MySQL.
Replay é local ao processo: ao mudar de processo o cursor desconhecido gera
reset e o cliente relê o MySQL. Não há log de eventos durável/global. Rate limits,
limites SSE e fila de hashes também são por processo; múltiplas réplicas precisam
de nova revisão de abuso e capacidade. Não tratar duas instâncias como 2x capacidade.

## Operação e recuperação

`node scripts/healthcheck.js` consulta HTTPS /health/ready com validação de CA e
timeout; HEALTHCHECK_ORIGIN/HEALTHCHECK_CA opcionais. /health/live verifica só
processo; /health/ready verifica conexão/meta5 sem snapshot integral. Falha de DB
gera 503 genérico; liveness não deve reiniciar o processo apenas por DB indisponível.
SIGTERM fecha SSE e drena requisições; prazo de 10 s para fechar conexões restantes.

Monitorar erros/status, p50/p95/p99 por rota, CPU/RSS, fila/rejeições de hashes,
conexões/pool MySQL, SSE/reconexões e espaço/idade do backup. IDs gerados pelo
servidor correlacionam logs sem registrar IP, e-mail, corpo, cookies ou query.
Restringir acesso ao journal e definir retenção/rotação. Rever logs do proxy/LB
para não coletar URLs/cabeçalhos sensíveis. Não expor métricas detalhadas ao público.
Com APP_LOG_FORMAT=json, o processo iniciado por server.start emite métricas
privadas a cada 15 s: CPU, RSS, event loop, SSE, fila/rejeições de hashes e
percentis de espera no pool. Amostras de timing são limitadas a 512 por janela;
não são histogramas completos. Os logs não incluem parâmetros SQL ou credenciais.

## Runners externos preparados (não executados)

Com origem/conta/banco de staging verificados, TLS e autorização explícita
RENOLINK_STAGING_WRITE_APPROVED=1:

```
node scripts/staging-homologate.js flows
node scripts/staging-homologate.js A
node scripts/staging-homologate.js B
node scripts/staging-homologate.js C
```

Executar cada comando separadamente, fora do horário de outras visitas/testes.
`flows` usa o segredo sintético por STAGING_FIXTURE_PASSWORD_FILE para equipe e
empresa fictícias; verifica bloqueio administrativo, aprovação, mensagens,
solicitação, interesse/negociação e acompanhamento. A/B/C criam contas novas
sintéticas, conservadas após o teste, sem senha fixa ou cópia de hashes reais.
A: 50 sessões autenticadas; B: 50 logins; C: 10 cadastros + 20 logins + 20 sessões
existentes. Todos os 50 mantêm SSE; janela padrão 60 s, até 3600 s via
STAGING_SSE_WINDOW_SECONDS. Preparação não entra nos percentis, mas consome os
limites reais de cadastro/IP. Aguardar pelo menos 15 minutos entre comandos que
criam grandes lotes e conferir o tráfego do IP; 429 deve interromper, não ser
contornado reiniciando processos ou removendo limites. O runner não reinicia
serviços nem injeta falhas externas; essas etapas exigem operação controlada.
Saída: percentis e erros por operação em data/runtime/staging-*.json, sem corpos
ou cookies. Para CPU/RSS/event loop/pool/fila usar os logs privados de runtime
do servidor no mesmo intervalo; números do cliente não medem CPU do servidor.

Backup: usar conta própria e armazenamento criptografado fora do host. Exemplo
a revisar, com login-path configurado localmente sem senha em argumentos:

```
mysqldump --login-path=renolink-staging-backup --ssl-mode=VERIFY_IDENTITY --ssl-ca=/etc/renolink/secrets/mysql-ca.pem --single-transaction --skip-add-drop-table --skip-triggers --skip-routines --skip-events --no-tablespaces --set-gtid-purged=OFF --column-statistics=0 renolink_staging > /destino-protegido/staging.sql
```

Confirmar antes que não existem views/triggers/rotinas/eventos; se existirem,
parar e revisar o plano, sem omiti-los de um backup dito completo. Executar em
janela sem DDL/escritas de aplicação, incluir as 12 tabelas, schema,
meta, auditoria e imports. Gerar SHA-256/tamanho e contagens por tabela. Não
capturar contas/grants globais. Nada foi executado. Restaurar apenas em novo banco
dedicado autorizado e vazio, com conta própria; nunca sobre dev/test/staging ativo.
Conferir definições, IDs, conteúdos e relações com snapshot antes de aceitar.
Meta inicial proposta: RPO 15 min / RTO 60 min, ainda não demonstrada. Guardar
segredos de recuperação separadamente e ensaiar restauração/falha no destino.

## Aceite externo obrigatório

Validar os fluxos do plano FASE_9.md, TLS de navegador e DB, IP/rate limits,
50 SSE por pelo menos 60 min, reconexão, queda/reinício de uma instância, falha
de conexão DB simulada sem parar serviço compartilhado, recuperação e restauração.
Repetir A/B/C da Fase 8.3 com percentis por operação e objetivos acordados.
Não reutilizar os números locais como capacidade contratada. Não executar testes
com escrita contra uma URL arbitrária: confirmar origem, APP_ENV, banco e conta
de staging com o operador antes de usar qualquer runner remoto.
