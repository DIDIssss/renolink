# RenoLink — Fase 10.4: preparação controlada do ambiente da feira

Data: 01/11/2026  
Escopo autorizado: planejamento detalhado, modelos de configuração dentro do
projeto e verificações estáticas/testes locais sem acesso a bancos existentes,
serviços ou configurações do Windows.

## Conclusão

Foram preparados modelos inativos para uma instância futura e independente.
**Nada foi ativado e a hospedagem não está homologada.** Não conectei ao MySQL,
não acessei cofre/credenciais, não instalei software, não alterei Windows,
Firewall, SSH, MySQL ou serviços, não criei banco/usuário/túnel, não fiz testes
externos e não publiquei a aplicação.

A proposta usa Node em `127.0.0.1:3100`, MySQL futuro em
`127.0.0.1:3307`/`renolink_fair` e um tunnel futuro somente para a porta 3100.
A porta 3100 foi escolhida para não reutilizar a porta 3000 observada na
instância local; disponibilidade e conflito precisam ser rechecados antes de
qualquer ativação.

## 1. Arquivos preparados

Todos os arquivos são modelos no repositório, não foram carregados pelo
aplicativo e não contêm credenciais reais:

- [`deploy/windows-fair/README.md`](../renolink_funcional/deploy/windows-fair/README.md) —
  topologia, operação futura e limites.
- [`deploy/windows-fair/fair.env.example`](../renolink_funcional/deploy/windows-fair/fair.env.example) —
  variáveis ilustrativas, origem `.invalid`, senha vazia e caminhos ainda não
  provisionados.
- [`deploy/windows-fair/Start-Fair.ps1`](../renolink_funcional/deploy/windows-fair/Start-Fair.ps1) —
  início em primeiro plano, exige `-AuthorizeActivation`, identidade dedicada
  `renolink_fair_svc`, recusa token administrativo, valida perfil fixo da feira,
  TLS, Node 24.19+, origem canônica HTTPS, diretórios previamente provisionados
  fora do projeto e recusa porta ocupada. Não lê `.env`, cofre ou credenciais.
- [`deploy/windows-fair/Health-Fair.ps1`](../renolink_funcional/deploy/windows-fair/Health-Fair.ps1) —
  health check somente em loopback; readiness exige a opção
  `-AllowDatabaseRead`.
- [`deploy/windows-fair/cloudflared.yml.example`](../renolink_funcional/deploy/windows-fair/cloudflared.yml.example) —
  hostname/UUID/caminho de credenciais em placeholders; ingress único para
  `127.0.0.1:3100` e fallback 404.
- [`deploy/windows-fair/backup-restore.example.md`](../renolink_funcional/deploy/windows-fair/backup-restore.example.md) —
  processo proposto de backup cifrado e restauração em destino independente.
  Intencionalmente não é script executável: criptografia, clientes, chaves,
  destino externo e fluxo binário seguro ainda não foram escolhidos/testados.

O exemplo de ambiente não é um `.env` operacional. `server.js` não carrega
arquivos `.env` automaticamente. A conta Windows, os diretórios, ACLs e
segredos precisam ser provisionados por processo autorizado e fora do release.

## 2. Configurações propostas e observações técnicas

### Aplicação e banco

- `NODE_ENV=production`, `APP_ENV=fair`, `STORAGE_DRIVER=mysql`,
  `PORT=3100`, `APP_ORIGIN` como origem HTTPS canônica real,
  `COOKIE_SECURE=1`, `TRUST_PROXY=loopback` e logs JSON.
- O código atual fixa o listener HTTP em `127.0.0.1`; o modelo não abre porta
  de rede nem adiciona configuração de bind.
- Destino futuro fixado nos modelos: `127.0.0.1:3307`, schema
  `renolink_fair`, usuário runtime exclusivo `renolink_fair_app`, TLS
  obrigatório e CA indicada fora do projeto. Banco e usuário ainda não existem.
- `MYSQL_SSL_CA` existir não basta: a CA deve ser confiável e o certificado
  MySQL precisa corresponder à identidade `127.0.0.1` usada na conexão
  (`verifyIdentity`). Validar SAN/IP ou aprovar uma solução local de identidade
  antes de iniciar.
- `Start-Fair.ps1` não executa migrações. O schema terá de estar preparado e
  validado previamente, por procedimento separado e autorizado.
- **Atenção ao comportamento de inicialização existente:** `server.js` valida
  o armazenamento chamando `store.transaction(() => {})`; no driver MySQL, o
  caminho atual usa transação, `GET_LOCK` e ajustes de sessão antes de abrir o
  servidor. O modelo não foi executado e não contorna esse comportamento.
  Qualquer ativação exige autorização explícita para a conexão e para essas
  operações na instância exclusiva já aprovada. Se a exigência futura for
  estritamente “sem transação/lock”, será necessária uma alteração e validação
  separadas do aplicativo; não fazer essa alteração implicitamente nesta fase.

### Processo, logs e saúde

- O início é foreground; `Ctrl+C` usa o tratamento atual de SIGINT do Node para
  fechar SSE, encerrar conexões e armazenamento. Não cria serviço agendado,
  daemon, conta, diretório ou ACL.
- O script exige a identidade local `renolink_fair_svc` e rejeita token
  administrativo. Isso não prova que a conta não pertença ao grupo
  Administrators nem valida ACLs; essa verificação depende do provisionamento
  e de revisão autorizada.
- O script grava a saída em arquivo datado em um diretório de log que deve
  existir fora do release e ter ACL restrita. Rotação, retenção e alertas ainda
  precisam ser definidos. Não iniciar até confirmar ACL e espaço.
- `/health/live` é o padrão e não pede banco. `/health/ready` consulta saúde do
  MySQL; `-Readiness` sem `-AllowDatabaseRead` é recusado. Cabeçalhos sintéticos
  são usados somente no endereço local e não provam comportamento do tunnel.
- Os logs do aplicativo foram projetados para metadados reduzidos, mas a
  configuração de ACL/rotação do host não foi testada.

### Tunnel e conteúdo administrativo

- O arquivo Cloudflare é um modelo de ingress fechado: um hostname para
  `http://127.0.0.1:3100` e fallback `http_status:404`. Não contém UUID,
  token, hostname real ou destino ativo.
- Nenhum MySQL, SSH, diretório de arquivos, painel do Windows ou porta genérica
  deve ser incluído no ingress.
- O servidor usa allowlist de arquivos estáticos e não deve servir raiz,
  scripts internos, `.env`, `.clixml`, logs ou backups. A tela de login
  administrativa pode ser pública como interface; **as APIs administrativas
  continuam exigindo autenticação/autorização**. Revisar todas as rotas e
  testar negação de acesso antes de publicar.
- O projeto exige proxy confiável em loopback, `X-Forwarded-Proto: https` e
  um único IP válido em `X-Forwarded-For`; não usa `CF-Connecting-IP`.
  Compatibilidade real dos cabeçalhos, cookies e SSE não foi testada via
  Cloudflare.

### Backup e restauração

- Não há rotina pronta para executar porque ainda faltam cliente MySQL, conta
  de backup restrita, ferramenta/chaves de criptografia, destino externo,
  retenção e RPO/RTO.
- O plano requer dump consistente cifrado diretamente em fluxo, sem arquivo
  SQL em claro; cópia fora do PC; logs apenas de status, bytes e duração.
- Restauração somente em instância/schema vazio separado
  `renolink_fair_restore_<identificador>`, nunca dev/test, sem criar banco ou
  usuários pelo procedimento.
- O fluxo binário precisa ser testado byte a byte em ambiente descartável. Não
  usar pipeline de texto do PowerShell para dump sem validar integridade.
  Nenhum backup ou restore foi feito; recuperação não está comprovada.

## 3. Dependências pendentes e riscos herdados

As Fases 10.1–10.3 permanecem válidas:

1. Windows 10 Pro 22H2/build 19045 está fora do suporte regular. ESU vigente e
   aplicável ao uso público da feira não está comprovada; um marcador de
   registro e a KB5126256 não provam cobertura. Preferir sistema suportado ou
   obter evidência de ESU/licenciamento e updates atuais.
2. O serviço compartilhado `MYSQL80` foi observado escutando em wildcard nas
   portas 3306 e 33060. A evidência de Firewall indica bloqueio de entrada por
   padrão e nenhuma regra habilitada encontrada para essas portas na consulta,
   mas não prova inacessibilidade pública. Não alterar nem reiniciar esse
   serviço sem inventário/autorização; o MySQL de feira deve ser separado e
   local-only.
3. SSH (`sshd`) escuta em wildcard na porta 22. A configuração efetiva de
   autenticação não foi confirmada (`sshd -T` falhou por falta de host keys);
   não desligar serviço nem ler chaves para contornar. Confirmar finalidade,
   dependências e política por revisão autorizada.
4. Node 24.19.0 e npm 11.17.0 foram observados antes; não se atualizou ou
   instalou software. `cloudflared` não estava disponível na auditoria anterior.
5. Não foram identificados todos os projetos/consumidores do MySQL fora do
   escopo RenoLink. O modelo não altera PATH, configuração global, Firewall,
   energia, SSH ou serviços existentes.
6. Porta 3000 já foi observada ocupada por uma instância local em outro momento.
   O modelo usa 3100, mas não há garantia de disponibilidade futura.
7. Capacidade de 10/25/50 visitantes, upload residencial, estabilidade,
   TLS/SSE/cookies atrás do tunnel e celulares físicos não foram comprovados.

## 4. Testes e verificações efetivamente realizados

- **8/8 subtestes locais selecionados** de `test/hosting.test.js`: política
  HTTPS/produção, proxy/cabeçalhos, readiness com pool falso, grants, métricas,
  health/logs e fixture sintética em memória. O teste HTTP usou loopback e
  servidor efêmero. Não houve conexão a MySQL, credenciais reais ou rede externa.
- Parser do PowerShell analisou os dois scripts de exemplo; **2/2 sem erros
  sintáticos**. Os scripts não foram executados.
- **11/11 verificações estáticas** passaram: senha vazia, origem `.invalid`,
  portas dedicadas, host/schema MySQL local exclusivos, ausência de destino
  dev/test, ingress loopback, fallback 404, trava de ativação e validação de
  origem HTTPS canônica, conta dedicada configurada e checagem de identidade/
  token administrativo no script.
- Uma primeira asserção estática ampla tratou comentários que proíbem
  `renolink_dev`/`renolink_test` como destino real; foi refinada para avaliar
  somente atribuições ativas e passou. Não foi defeito nos arquivos.
- Não rodei suíte integral, testes de integração, health check de readiness,
  scripts de início/backup/restore, nem testes do tunnel: poderiam acessar
  serviços/dados, iniciar processos ou gravar artefatos fora do escopo seguro.
- Não foram criados bancos, contas, arquivos de dados, backups, logs de
  execução, túneis ou recursos externos. Apenas os arquivos de modelo e este
  relatório foram adicionados ao projeto.

## 5. Procedimento futuro de ativação

Cada etapa abaixo requer autorização própria; esta Fase 10.4 **não concede**
essas autorizações:

1. Comprovar sistema operacional suportado/ESU aplicável e estado atualizado.
2. Autorizar revisão de Firewall, listeners 3306/33060/22, autenticação SSH e
   inventário limitado de consumidores antes de qualquer ajuste compartilhado.
3. Provisionar sob aprovação identidade Windows local `renolink_fair_svc` de
   baixo privilégio, confirmar que não pertence a Administrators, release
   imutável, ACLs e diretórios dedicados para logs/segredos/backups. Não dar
   acesso a perfil, documentos ou arquivos pessoais.
4. Criar uma instância MySQL independente, diretório de dados e schema
   fictício `renolink_fair`, bind exclusivo `127.0.0.1:3307`, X Protocol
   desabilitado se desnecessário, credenciais separadas runtime/migrator e
   grants mínimos. Não reutilizar `MYSQL80`, `renolink_dev` ou
   `renolink_test`.
5. Preparar TLS MySQL com CA confiável e identidade compatível com o endpoint;
   testar rejeição de certificado/identidade inválidos.
6. Só depois de schema e dados sintéticos aprovados, conceder autorização de
   ativação, fornecer ambiente seguro ao processo e revisar a transação/lock
   feita pelo startup. Executar `Start-Fair.ps1 -AuthorizeActivation` sob a
   conta dedicada; não usar `npm start`, `INICIAR_RENOLINK.ps1` ou scripts de
   desenvolvimento.
7. Verificar liveness local; readiness somente com autorização para a leitura
   MySQL. Testar login/admin, cookies, allowlist, HTTPS, cabeçalhos e SSE sem
   dados pessoais.
8. Autorizar separadamente instalação/configuração do cloudflared, tunnel
   nomeado, hostname/DNS e uso do domínio. Confirmar ingress único e fallback
   404. Testar SSE, cookies, troca de rede e Android/iPhone em ambiente
   controlado; realizar carga gradual apenas após aprovação.
9. Escolher e testar backup cifrado fora do PC e restauração em ambiente
   descartável; definir operador, retenção, alertas, RPO/RTO e contingência.
10. Publicação exige gate adicional separado, revisão de segurança e evidência
    externa autorizada. Aprovar modelos ou ambiente local não autoriza divulgar
    o site.

## 6. Plano de reversão

- Antes de túnel: parar somente o processo RenoLink da feira com `Ctrl+C`,
  confirmar que terminou e guardar logs restritos conforme retenção aprovada.
- Se falhar: manter site indisponível e tunnel não conectado; investigar
  somente logs sem segredos. Não apontar para dev/test, não afrouxar TLS e não
  desativar Firewall/SSH.
- Após tunnel autorizado: desabilitar o hostname/ingress da feira pelo
  procedimento aprovado, depois parar o conector e a aplicação. Remoção de
  DNS, tunnel ou software é operação separada, não automatizada por estes
  modelos.
- Não apagar banco, diretórios ou backups no rollback. Preservar a instância
  isolada até revisão e autorização explícita de retenção/descarte; jamais
  reverter alterando `MYSQL80`, `renolink_dev` ou `renolink_test`.

## 7. Ações que exigem autorização explícita

- Confirmar ESU/sistema suportado e atualizações atuais.
- Inventariar consumidores e revisar políticas de Firewall, MySQL e SSH;
  qualquer alteração em `MYSQL80`, serviço, bind, porta ou regras tem impacto
  global.
- Criar conta Windows, serviços, ACLs, instância/schema/contas MySQL, dados
  fictícios, TLS e diretórios.
- Fornecer segredos exclusivos ao processo e autorizar a transação/lock do
  startup atual.
- Instalar cloudflared, criar tunnel/hostname/DNS ou configurar acesso externo.
- Escolher ferramenta/chaves/destino de backup, fazer dump/restore e definir
  retenção/RPO/RTO.
- Executar teste externo, teste de carga, testes com celulares e publicar.

**Estado final:** preparação documental e arquivos de exemplo concluídos.
Nenhum serviço foi ativado, nenhum dado existente foi modificado e nenhuma
aplicação foi publicada. A homologação continua pendente.
