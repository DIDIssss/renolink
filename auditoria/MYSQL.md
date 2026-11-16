# RenoLink 2.0 — adaptação da arquitetura para MySQL

Atualização: a Fase 3 de integração real local foi concluída após este relatório.
Resultados atuais, recursos criados e correção da asserção FK estão em
[MYSQL_FASE3.md](MYSQL_FASE3.md). O texto abaixo preserva a auditoria da etapa
anterior, quando ainda não havia credenciais nem execução real.

Data: 24/10/2026, America/Sao_Paulo.

## Resultado

MySQL foi preparado como destino principal, selecionado explicitamente por `STORAGE_DRIVER=mysql`. O modo JSON seguro continua disponível enquanto faltarem configuração e importação autorizada. O frontend, a identidade visual e os contratos HTTP foram preservados. Os arquivos e a dependência PostgreSQL permanecem no projeto; não houve exclusão ou migração real.

## Diagnóstico do computador

- Serviço `MYSQL80`: Running.
- Porta 3306 em escuta; handshake inicial informa MySQL **8.0.46**. Essa leitura não autentica, não tenta senha e não executa SQL.
- Workbench, Shell e Router encontrados em `C:\Program Files\MySQL`. Executáveis mysql/mysqld/mysqladmin não foram encontrados no PATH da sessão.
- Variáveis MYSQL_* e TEST_MYSQL_DATABASE não estavam configuradas na verificação.
- O servidor existente escuta em `0.0.0.0:3306`; nenhuma configuração ou regra de firewall foi alterada. Rever o alcance de rede com o administrador antes do uso real.
- Não foi instalado, reiniciado ou reconfigurado serviço MySQL. Somente a biblioteca npm foi adicionada.

## Implementação entregue

| Área | Alteração |
| --- | --- |
| Schema | `database/mysql/001_initial.sql`: sete tabelas InnoDB, bigint, JSON, UTF-8 completo, datas UTC, FKs, unicidade e CHECK |
| Conexões | `lib/mysql.js`: mysql2/promise, pool limitado, configuração explícita, TLS com CA/identidade verificados e recusa de versão incompatível |
| Transações | Mesma conexão, GET_LOCK antes da transação, READ COMMITTED, commit/rollback e liberação explícita do lock; conexão descartada se liberação não for confirmada |
| SQL Injection | Dados externos apenas por parâmetros em execute; identificadores internos fixos; múltiplas instruções desabilitadas nas conexões |
| Persistência | IDs e contadores preservados; campos adicionais em extra JSON; datas convertidas em UTC; unicidade não atualiza outro usuário por conflito |
| Importação | `scripts/migrate-mysql.js`: backup/manifesto SHA-256, preflight independente de conexão, aprovação específica MySQL, recusa de lock e destino não vazio, comparação integral e idempotência |
| Backend | `server.js`: seleção explícita mysql/json/postgres; produção exige MySQL, TLS no banco, origem HTTPS e cookie seguro |
| Autenticação | Backend existente preservado: hash legado atualizado para scrypt após login correto, cookie HttpOnly, expiração/revogação; dados das sessões mapeados para MySQL sem token bruto |
| Configuração | `.env.example` documenta MYSQL_* e TEST_MYSQL_*; nenhum segredo ou conta real foi incluído |

MySQL 8.0.17 é o mínimo preparado porque a collation utf8mb4_0900_bin surgiu nessa versão. A implementação aceita a família 8.0 a partir desse patch e 8.4; versões antigas e MariaDB são recusadas. A validação real do schema e das transações ainda depende de acesso autenticado ao servidor.

Diferença relevante em relação ao PostgreSQL: DDL MySQL pode fazer commit implícito. As tabelas são criadas antes da transação de importação, sob o mesmo lock. **Rollback de dados não remove tabelas criadas.** Uma falha pode deixar tabelas vazias para inspeção/reexecução. IF NOT EXISTS não atualiza um schema preexistente incompatível; o destino deve ser novo ou criado por este schema.

O lock serializa os adaptadores participantes na mesma instância MySQL. O adaptador inicial lê e regrava o conjunto de registros nas escritas; não foi otimizado nem dimensionado para o público da feira. Clientes externos que desrespeitem o lock não são coordenados por ele. Usar endpoint primário direto, sem multiplexação de conexão ou distribuição para réplicas durante uma transação.

## Arquivos adicionados

- `renolink_funcional/lib/mysql.js`.
- `renolink_funcional/database/mysql/001_initial.sql`.
- `renolink_funcional/database/mysql/README.md`.
- `renolink_funcional/scripts/migrate-mysql.js`.
- `renolink_funcional/test/mysql.test.js`.
- `renolink_funcional/test/mysql.integration.test.js`.
- `renolink_funcional/test/fixtures/mysql.js`.
- `auditoria/MYSQL.md`.

## Arquivos modificados

- `server.js`: seleção do driver e requisitos de produção.
- `package.json` / `package-lock.json`: mysql2 3.24.6, comandos MySQL e aliases PostgreSQL explícitos.
- `test/security.test.js`: preservado e ampliado com bloqueio HTTP dos novos arquivos internos.
- `.env.example`: variáveis MySQL e aprovação de testes/importação.
- `.gitignore`: cache npm, certificados e chaves não entram no versionamento.
- `README.md`: persistência atual, comandos e avisos sobre scripts históricos de reset.
- `database/README.md`: aviso inicial de que o documento PostgreSQL foi conservado e de que MySQL é o destino atual.

Adaptador, schema, migrador e teste de integração PostgreSQL não foram removidos nem reescritos. Continuam disponíveis por `test:postgres`, `db:check:postgres` e `db:migrate:postgres`. Os relatórios anteriores permanecem como histórico.

## Testes e verificações

| Verificação | Resultado |
| --- | --- |
| Detecção do servidor | Serviço e versão 8.0.46 confirmados por leitura do ambiente e handshake, sem autenticação |
| `npm.cmd test` | 24 testes aprovados: 15 anteriores e 9 unidades MySQL |
| Segurança HTTP e autorização | Páginas/assets preservados; novos arquivos internos bloqueados; ideias privadas e regras de interesse mantidas |
| Concorrência local existente | 22 ideias novas com IDs distintos e registros preservados; cadastros duplicados e interesses simultâneos continuam tratados |
| Unidades MySQL | Configuração/versões, TLS, conexão única, sequência de commit/rollback, liberação de lock, parâmetros SQL e round-trip dos mapeamentos validados com conexões simuladas |
| Preflight sintético | Backup por hash, repetição, aprovação e proteção por lock testados sem banco real |
| `npm.cmd run test:mysql` | 1 integração ignorada por ausência de autorização/credenciais/banco de teste configurado; nenhuma escrita no servidor real |
| `npm.cmd run test:postgres` | Teste anterior preservado; 1 integração ignorada sem sua configuração/autorização |
| `npm.cmd run db:check` | Preflight MySQL sem conexão; origem/backup verificados, sem aplicar migração |
| Sintaxe | Servidor, módulo, migrador e teste de integração MySQL verificados com node --check |
| Dependências | mysql2 3.24.6 e pg 8.23.1 instalados; npm informou zero vulnerabilidades na instalação de mysql2 |

Uma asserção inicial do novo teste de lock falhou por esperar a palavra `lock` em uma mensagem que não a continha. A mensagem foi esclarecida, e a suíte completa passou. Não houve falha de integridade ou escrita real associada a esse cenário.

O teste real preparado usa um banco dedicado/vazio, sem criação/exclusão de bancos e sem reset automático. As fixtures contêm usuários, ideias com/sem autor e privadas, mensagem, negociação, sessão legada e campo adicional. Ele verifica importação completa e repetida, login/upgrade de hash, cadastro, mensagens, autorização, 12 criações por dois pools, persistência após reabertura e tentativa de reaplicar snapshot sobre dados novos. O rollback previsto executa UPDATE SQL válido seguido de falha FK e compara o estado integral. Esses cenários **ainda não foram executados no MySQL real**.

## Preservação dos dados

Original `renolink_funcional/data/db.json` mantém SHA-256:

`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`

Contagens: 4 usuários, 9 ideias, 7 mensagens, 1 negociação, 0 sessões. Runtime mantém o mesmo hash nesta verificação. Seed não foi alterado. O backup verificado existente foi reutilizado pelo preflight, sem sobrescrita. Testes locais usam arquivos sintéticos em diretórios temporários, conservados sem limpeza destrutiva.

Nenhum dado foi importado no MySQL. Não houve reset, exclusão de registros, publicação ou alteração visual. Nenhum usuário/senha de banco foi inventado, solicitado em texto aberto ou registrado em logs/relatórios.

## Próximos passos e configurações pendentes

1. Prover conta migradora, conta de aplicação e banco de desenvolvimento dedicado, com permissões mínimas. Não usar root na aplicação.
2. Prover conta e banco MySQL de teste novo/vazio, chamado `renolink_test` ou `renolink_test_<sufixo>`, diferente do operacional. Configurar TEST_MYSQL_* e habilitar `RENOLINK_TEST_MYSQL_APPROVED=1` para executar a integração sintética. As tabelas ficam preservadas; outra rodada exige outro banco vazio.
3. Validar DDL, FKs, CHECK, unicidade, UTC/Unicode, concorrência real e rollback SQL em MySQL 8.0.46; repetir em 8.4 se for a versão de hospedagem.
4. Antes da migração real, obter autorização, parar as escritas, escolher o JSON operacional mais recente, preservar backup externo e validar origem/lock. Aplicar somente em destino dedicado, com `RENOLINK_MYSQL_MIGRATION_APPROVED=1` no terminal do migrador.
5. Depois da importação validada, iniciar com conta da aplicação e `STORAGE_DRIVER=mysql`. Não habilitar MySQL em produção antes desses testes.
6. Planejar backup MySQL e ensaio de restauração, queda de conexão e teste de carga; configurar TLS, rede privada, limites compartilhados e proxy confiável para hospedagem.
7. As pendências funcionais da auditoria continuam: administração/aprovação da RenoLink, destinatários reais das conversas, negociação completa, tempo real e navegação mobile. A troca do armazenamento não implementa esses fluxos.

Comandos, variáveis e instalação Windows estão detalhados em `renolink_funcional/database/mysql/README.md`, com referências oficiais MySQL/mysql2. Nenhuma instalação de serviço ou migração real faz parte desta entrega.
