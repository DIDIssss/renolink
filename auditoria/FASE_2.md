# RenoLink 2.0 — Fase 2: segurança e banco

Data: 23/10/2026, referência de data do usuário. Base: leitura integral de `RELATORIO.md` e revisão dos arquivos existentes. Identidade visual, páginas e dados originais preservados. Nenhum reset, publicação ou serviço de banco instalado.

## Resultado

Foram corrigidos os bloqueadores de acesso indevido e a perda de gravações no modo local. A aplicação permanece local e utiliza cópia operacional do banco. PostgreSQL tem schema, adaptador transacional, migrador e teste de integração preparados, mas **a execução SQL e a integração com PostgreSQL real permanecem pendentes**, pois não há `DATABASE_URL` configurada. O sistema ainda não foi certificado para uso público na feira.

## Correções entregues

| Problema | Implementação e comprovação |
| --- | --- |
| Banco exposto por caixa do caminho | Lista exata de páginas/assets; `/DATA/db.json`, variantes codificadas e caminho normal retornam 404 |
| Arquivos internos publicados | Servidor, bibliotecas, schema, scripts, configurações, backups, runtime e lockfile de pacotes ficam fora da lista pública |
| Ideias em análise expostas | Listagem geral entrega apenas ideias públicas; detalhes privados apenas ao autor; terceiro recebe 404 |
| Interesse aprova conteúdo | Interesse exige ideia pública e não altera seu status; ideia em análise não recebe negociação |
| Redirecionamento externo | Login usa função de lista permitida; URLs externas, relativas fora das páginas e esquemas executáveis são recusados |
| Perda de dados simultâneos | Corpo lido antes de entrar na transação; fila exclusiva, leitura atualizada, validação, gravação atômica e resposta após commit |
| Senhas e sessões | scrypt em cadastros; upgrade de SHA-256 após login correto; cookie HttpOnly, expiração de 8h, revogação e token apenas em hash no armazenamento |
| Validação e abuso | Limites de tentativas, validações no servidor, limites de campos/corpo, erros 400/413/415/429, restrição de origem e JSON |
| Indicadores fictícios | Removidas somas artificiais e restringida contagem pública de ideias |

A lista pública também inclui os diretórios permitidos por meio de arquivos específicos: CSS, JS e logo em `assets`. Não há liberação recursiva de diretório; novos assets precisam ser adicionados deliberadamente em `PUBLIC_FILES`.

## Preservação e backup

- `renolink_funcional/data/db.json` e `data/db.seed.json` não foram alterados.
- Original: 4 usuários, 9 ideias, 7 mensagens, 1 negociação, 0 sessões.
- SHA-256 do original e backup verificado: `7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.
- Backup: `renolink_funcional/data/backups/db-7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676.json`, com manifesto ao lado.
- Execução local: `data/runtime/db.json`, criado do backup verificado e mantido entre reinicializações. Novas operações não alteram o original.
- Os testes usam dados sintéticos em diretórios temporários separados; o hash do original é conferido ao concluir cada cenário HTTP.
- Conteúdo de credenciais, mensagens existentes e tokens não foi transcrito para os relatórios.

## Arquivos modificados

| Arquivo existente | Alteração |
| --- | --- |
| `renolink_funcional/server.js` | Acesso estático, autorização, validações, transações, sessão, limites, headers e inicialização segura |
| `renolink_funcional/assets/js/app.js` | Cookies em Fetch; nenhuma credencial no localStorage; redirecionamento seguro |
| `renolink_funcional/login.html` | Carrega helper de redirecionamento, sem alteração visual |
| `renolink_funcional/cadastro.html` | Informa nova exigência de senha e limita seu tamanho |
| `renolink_funcional/package.json` | Biblioteca pg e comandos de testes/preflight/migração |
| `renolink_funcional/README.md` | Instruções atualizadas e aviso sobre banco operacional |

## Arquivos adicionados

- `lib/security.js`: senhas, cookies, autenticação, limites e validação de origem.
- `lib/data.js`: validação de dados, backup/manifesto, cópia operacional e transações locais.
- `lib/postgres.js`: mapeamento das tabelas, transação, persistência e comparação pós-importação.
- `assets/js/security.js`: destino interno permitido após login, reutilizado nos testes.
- `database/001_initial.sql`: tabelas, FKs, índices e restrições.
- `scripts/migrate-postgres.js`: backup, preflight e importação idempotente autorizada.
- `test/security.test.js`: regressões funcionais e de segurança com fixtures sintéticas.
- `test/postgres.test.js`: integração real opcional com schema de teste separado e preservado.
- `database/README.md`: arquitetura, variáveis necessárias, segurança e procedimento de corte.
- `.gitignore`, `.env.example`, `package-lock.json`: proteção contra versionamento acidental de segredos/runtime e instalação reproduzível.
- `auditoria/FASE_2.md`: este relatório.
- Backup e manifesto; cópia operacional local; `node_modules` da dependência instalada. Esses arquivos locais não são públicos.

## Testes executados e resultados

Comandos na pasta `renolink_funcional`:

| Comando/cenário | Resultado |
| --- | --- |
| `npm.cmd test` | 15 testes, 15 aprovados, 0 falhas, 0 ignorados |
| Exposição original do banco/código | Bloqueada em caminhos normais, variantes de caixa, codificação, travessia e backups |
| Autorização | Autor acessa ideia privada; anônimo, empresa e terceiro não; negociação não aprova ideia |
| Regressão funcional | Páginas/assets entregues; cadastro, login legado, nova senha, logout, mensagens e interesses funcionando pela API |
| Concorrência de ideias | 2 corpos intercalados + 20 criações paralelas: 22 respostas 201, 22 IDs únicos, 22 novos registros preservados |
| Concorrência de cadastros | 3 tentativas do mesmo e-mail: 1 cadastro e 2 respostas 409 |
| Concorrência de interesses | 10 tentativas: 1 negociação criada, mesmo ID nas demais respostas |
| Persistência e rollback | Reabertura conserva alterações; exceção não grava mudanças; segundo escritor sobre o mesmo JSON é recusado |
| Sessões | Token bruto ausente das respostas/dados novos; expiração, revogação atual e geral verificadas |
| Validação/abuso | JSON inválido, excesso de corpo, cadastro inválido, origem externa e excesso de tentativas recusados |
| Backup/preflight | Hash, contagens, IDs e relações validados; repetição idempotente; backup adulterado recusado |
| Transação PostgreSQL simulada | Verificado uso de um cliente, sequência BEGIN/lock/COMMIT e ROLLBACK em erro; não substitui teste real |
| `npm.cmd run test:postgres` | 1 teste ignorado por ausência de infraestrutura/autorização de teste; nenhuma conexão ou migração real |
| `node scripts/migrate-postgres.js --check` | Backup do original verificado; estrutura válida; `databaseConfigured: false` |
| `node --check` | Sintaxe de servidor, frontend e módulos verificada sem erros |
| `npm.cmd install pg --save` | pg 8.23.1 e dependências instalados; npm informou 0 vulnerabilidades na instalação |

Não houve automação de navegador nem teste visual em dispositivos nesta fase. As páginas existentes e o CSS foram preservados; testes de entrega HTTP não certificam comportamento visual. O arquivo `auditoria/testar.cjs` e `resultados.json` da fase anterior são evidência histórica, não a suíte de aprovação atual.

## Pendências e limites

1. Configurar PostgreSQL real e de teste, credenciais seguras, TLS e permissões; obter aprovação antes de importar. Executar SQL, migração repetida, FKs/índices, concorrência entre processos e rollback no banco real. O teste opcional está preparado, mas não executado.
2. Fazer corte sem escritas e migrar o arquivo operacional mais recente; não importar apenas o original se já houver dados novos no runtime. O destino não pode ter registros preexistentes.
3. Validar carga para o público esperado. Tanto o fallback local quanto o primeiro adaptador PG serializam operações; não houve benchmark de capacidade da feira.
4. Configurar limites compartilhados e política de proxy confiável antes de múltiplas instâncias. Os limites atuais ficam na memória do processo e não sobrevivem a reinícios.
5. Concluir administração da RenoLink, aprovação de ideias, destinatários/conversas reais, etapas de negociação e atualização em tempo real. Estes itens do relatório inicial seguem fora do escopo implementado nesta fase. Cadastros públicos não podem obter privilégio administrativo.
6. Mensagens da interface ainda têm destinatários fixos; a API continua permitindo envio a usuário existente sem negociação prévia. Leitura permanece restrita aos participantes e foi testada. Definir o atendimento da equipe antes de aplicar restrições que quebrem esse fluxo.
7. Completar recuperação/verificação de e-mail, navegação mobile, estados de erro e validação visual; planejar retenção/expurgo de sessões por política futura, sem apagar registros agora.
8. Fazer cópia externa e ensaio de restauração. O backup local foi verificado por hash, mas não certifica recuperação em um host futuro.

Senhas legadas não podem ser convertidas sem sua senha original: as contas existentes permanecem acessíveis, com upgrade oportunista após login correto. As contas de demonstração continuam existindo e devem ter sua política definida antes do acesso público, sem exclusão automática nesta fase.

As orientações de transação e scrypt seguem as referências oficiais registradas em `database/README.md`.
