# RenoLink — Fase 10.5: pré-ativação do servidor local

Data: 01/11/2026  
Escopo: análise documental do caminho de startup, privilégios e isolamento.
Não executei scripts, não iniciei servidor, não conectei ao MySQL, não acessei
cofre/credenciais, não alterei código ou sistema, não instalei software, não
abri portas, não criei recursos e não expus a aplicação.

## Conclusão executiva

**A primeira execução ainda não está autorizada nem pronta.** Os modelos da
Fase 10.4 não ativam nada, mas também não demonstram que uma instância
independente, seus grants, TLS, identidade Windows e diretórios protegidos
existam.

O startup atual faz `store.transaction(() => {})`. No MySQL, isso usa o caminho
geral de escrita: adquire uma conexão, consulta banco/versão, obtém um named
lock `GET_LOCK`, configura variáveis da sessão, inicia transação, carrega e
valida um snapshot completo, executa o callback vazio, compara o estado e
confirma a transação. No caso de um callback vazio, **não há INSERT, UPDATE,
DELETE nem DDL**, mas há leitura do banco, lock temporário e transação. O lock
é liberado ao final.

O snapshot de startup inclui dados sensíveis em memória — entre eles hashes e
salts de senha e hashes de tokens de sessão — embora não sejam registrados em
log. Portanto, “não gravar linhas” não significa “não ler dados” nem “somente
health check”. Para uma prova inicial de execução, o destino deve ser banco
novo, vazio ou com dados fictícios, e não qualquer schema existente.

## 1. Dependências e operações do startup

### Caminho observado no código

1. `start()` valida a política de produção e constrói o pool MySQL.
2. Antes de abrir o listener HTTP, executa `store.transaction(() => {})`.
3. O wrapper MySQL enfileira a operação e entra em `transaction()`.
4. `withLock()` executa `SELECT DATABASE(), VERSION()`, valida a versão e
   obtém `GET_LOCK()` por até 10 segundos. Depois ajusta somente a sessão:
   `time_zone`, `sql_mode` e `innodb_lock_wait_timeout`.
5. A transação usa `READ COMMITTED`. O wrapper carrega `renolink_meta.payload`
   e o snapshot das tabelas mapeadas, clona/valida o estado, chama o callback
   vazio e compara o resultado. Como não houve mudança em memória, `save()` não
   é chamado e nenhuma linha é gravada.
6. A transação é confirmada e `RELEASE_LOCK()` libera o lock. Só depois o
   servidor começa a escutar em `127.0.0.1:3100`.

No schema de versão 5, o snapshot carrega `renolink_meta` e dez tabelas
operacionais: `renolink_users`, `renolink_ideas`, `renolink_negotiations`,
`renolink_messages`, `renolink_sessions`, `renolink_staff`,
`renolink_conversations`, `renolink_support_messages`, `renolink_requests` e
`renolink_audit`. A tabela `renolink_imports` é usada pelo migrador, não pelo
snapshot normal do servidor.

### Efeitos e risco de dados

- **Startup sozinho:** lê o estado e não executa DML/DDL; mantém um named lock
  temporário e executa uma transação que termina em commit. As mudanças de
  `SET SESSION` não alteram configuração global persistente.
- **Após o listener abrir:** requisições GET usam caminho de leitura
  `REPEATABLE READ, READ ONLY`; requisições não-GET passam pelo wrapper de
  escrita. Se um handler mudar o estado, o `save()` pode inserir ou atualizar
  linhas. O servidor não apaga linhas pelo mecanismo de persistência
  inspecionado.
- **Destino incorreto:** se apontado a um banco existente, o startup não deve
  mudar suas linhas, mas lerá os dados mapeados; após abrir o listener,
  operações da aplicação podem alterar os registros. A conta de produção não
  deve poder conectar a `renolink_dev` ou `renolink_test`.
- **Erro/interrupção:** falhas na transação tentam rollback e liberam ou
  descartam a conexão; não equivalem a prova de recuperação após falha do host.
- `GET_LOCK` é lock consultivo do servidor, não lock de tabela nem escrita de
  dados. Os grants SQL normais de tabela não são o mecanismo de autorização
  desse lock; a conta precisa conseguir conectar e executar as consultas e
  configurações de sessão. O lock pode serializar outra cópia da aplicação
  que use o mesmo nome de banco no mesmo servidor, razão adicional para
  instância/identidade exclusivas.
- Se a política exigida for **nenhuma transação, nenhum lock ou nenhuma leitura
  de dados no startup**, o código atual não satisfaz esse requisito. Isso
  exigiria uma mudança de persistência e revisão/testes em outra etapa; não foi
  feita aqui.

### Privilégios mínimos — separar prova de startup e operação

**Somente iniciar e consultar liveness**, com banco v5 previamente existente:

- Conexão/autenticação no host e porta da instância exclusiva.
- `SELECT` nas onze tabelas que o snapshot lê: `renolink_meta` e as dez
  tabelas operacionais listadas acima.
- Não é necessário DML para o callback vazio. Tampouco o startup precisa de
  `CREATE`, `ALTER`, `DROP`, `DELETE`, `FILE`, `PROCESS`, `SUPER`,
  `CREATE USER`, `GRANT OPTION` ou privilégios globais.
- Uma prova de startup com grants somente de leitura reduz o impacto de
  requisições de escrita: estas devem falhar sem privilégios DML. Ainda assim,
  a aplicação lerá o snapshot e esse ensaio não é uma operação de privacidade
  zero.

**Operação normal com fluxos que gravam dados:** o código de persistência usa
`INSERT` e `UPDATE` para salvar diferenças, não `DELETE`. Como a conta runtime
carrega o estado e pode alterar várias coleções por meio dos handlers, o
perfil mínimo analisado é por tabela:

| Tabelas do schema `renolink_fair` | Privilégios runtime propostos |
|---|---|
| `renolink_meta`, `renolink_users`, `renolink_ideas`, `renolink_messages`, `renolink_negotiations`, `renolink_sessions`, `renolink_conversations`, `renolink_support_messages`, `renolink_requests` | `SELECT`, `INSERT`, `UPDATE` |
| `renolink_audit` | `SELECT`, `INSERT` |
| `renolink_staff` | `SELECT` |
| `renolink_imports` | Nenhum para o runtime; `SELECT` apenas se um preflight/migrador explicitamente aprovado precisar dela. |

Esse perfil é uma base para revisão, não um grant executado ou auditado. Deve
ser aplicado **somente** ao schema feira, sem `*.*`, sem role herdada ou
privilégio indireto, sem `DELETE` e sem DDL. A lista segue o padrão de grants
restritos validado pelos testes de staging; a implantação de feira ainda não
tem um verificador de grants próprio.

**Migração/provisionamento:** não pertence à conta runtime. Requer identidade
separada, uso único e janela aprovada para criar o schema/tabelas e carregar
somente dados sintéticos. O código de migração executa DDL e DML, então a
conta migradora terá poderes adicionais limitados ao banco novo. Não se deve
dar esses direitos persistentes ao processo Node. **Não executar o migrador
com seus defaults neste projeto:** ele escolhe `data/runtime/db.json` se
existir, caso contrário `data/db.json`, e importa a origem para o MySQL quando
`--apply` é autorizado. Isso pode ser dado preexistente. A origem sintética
precisa ser explicitamente selecionada e revisada; nenhum arquivo de dados foi
lido nesta fase.

## 2. Revisão do isolamento proposto

| Componente | Proposta e evidência | Falta/problema antes da execução |
|---|---|---|
| Banco | Nova instância MySQL, data directory próprio, `127.0.0.1:3307`, schema `renolink_fair`; não reutilizar `MYSQL80`, dev/test. | Nada disso existe ou foi verificado por conexão. A instância compartilhada atual foi observada em wildcard nas portas 3306/33060. |
| Conta Windows | `renolink_fair_svc`, não administrativa, fora do perfil pessoal. O script valida identidade e token não administrativo. | Conta não criada; membership efetivo em Administrators, direito de logon e ACLs precisam de verificação administrativa. Um token UAC filtrado, sozinho, não prova que a conta não pertença ao grupo Administrators. |
| Credenciais MySQL | Usuário `renolink_fair_app`, senha exclusiva, runtime sem DDL e TLS com validação da CA/identidade. | Conta, senha e certificado não existem. Confirmar `CURRENT_USER()`/grants por procedimento autorizado sem registrar valores sensíveis. Certificado precisa validar o endpoint `127.0.0.1` (por exemplo, SAN de IP) com `verifyIdentity`; CA existir não basta. |
| Node | `server.js` fixa bind `127.0.0.1`; o modelo usa porta 3100. | Verificar listener após uma execução expressamente autorizada. A checagem no script de que a porta está livre não comprova o bind final nem testa rede. |
| Logs | Saída redirecionada a arquivo em diretório externo ao projeto. | Diretório/ACL não existem; o script verifica existência e caminho, mas não valida ACL. Não há rotação/retenção automatizada. Arquivo deve ser acessível somente à conta de serviço e administradores autorizados. |
| Backups | Plano separado de backup cifrado fora do PC. | Nenhum backup/restore testado; o diretório de backup é requisito de configuração, mas o startup não realiza backup nem valida ACL do diretório. |
| Tunnel | Template com um hostname, origem `http://127.0.0.1:3100` e fallback 404. | Sem cloudflared/conta/tunnel. Não iniciar conector para a primeira execução local. |

### Impactos em outros projetos

- Nova instância MySQL ocupa CPU/RAM/disco e adiciona um serviço, mas não deve
  reiniciar nem reconfigurar `MYSQL80`; escolher porta e diretório sem colisão.
- Alterar bind/firewall do `MYSQL80`, porta 3306/33060, regras globais,
  OpenSSH, Node/PATH, serviços, energia ou Windows Update pode afetar outros
  projetos e requer autorização administrativa e inventário.
- Conta/ACLs restritas às pastas da feira, variáveis do processo e porta 3100
  podem permanecer escopo RenoLink se provisionadas dessa forma.
- O Node não deve usar `npm start`, iniciador local, credenciais DPAPI,
  `renolink_dev`, `renolink_test` ou o serviço compartilhado.

## 3. Windows e fronteira de exposição

### Updates / ESU

O baseline disponível identifica Windows 10 Pro 22H2/build 19045, fora do
suporte regular. `win10ConsumerESUStatus=2` e KB5126256 não demonstram
inscrição/cobertura atual. Antes de uso da feira, exigir:

1. Windows ainda suportado ou evidência oficial de enrollment/licença ESU
   vigente e aplicável à classificação comercial do evento;
2. confirmação visível do estado de enrollment/updates pelo canal Windows
   Update e evidência de que o cumulative security update mais recente
   aplicável está instalado, sem erro pendente;
3. confirmação de que o caso de uso público não depende indevidamente de
   programa consumer incompatível com uso comercial.

Se não for possível comprovar, substituir por sistema suportado antes de
qualquer exposição pública. Nenhuma verificação de conta/licença foi feita.

### MySQL, SSH e acesso público

- A auditoria anterior observou `MYSQL80` em endereços wildcard nas portas
  3306/33060 e `sshd` em wildcard na porta 22. As consultas do Firewall
  indicaram inbound bloqueado por padrão e não localizaram regras habilitadas
  aplicáveis nessas portas, mas não provam ausência de port-forward ou
  alcançabilidade pública.
- Revisão administrativa futura deve examinar política efetiva ActiveStore
  para todos os perfis, regras allow/block e escopos de endereço, programa,
  serviço, interface e portas 3306, 33060, 22 e 3100. Não alterar regras nesta
  etapa.
- Confirmar que o MySQL de feira escuta somente em `127.0.0.1:3307`, que
  `3306/33060` compartilhadas não são encaminhadas pelo tunnel e que a
  aplicação não é servida por interface LAN. Não desabilitar SSH/serviços sem
  inventário e autorização.
- A configuração efetiva de autenticação SSH continua não comprovada. A
  tentativa anterior de `sshd -T` foi recusada por falta de host keys; não
  acessar chaves privadas para contornar. O administrador deve confirmar
  finalidade, política de autenticação/forwarding e escopo de rede por método
  autorizado.
- Uma primeira execução somente em loopback, sem tunnel e sem regra de entrada,
  não publica a aplicação; ainda não prova que serviços já existentes estejam
  inacessíveis publicamente. Ausência de exposição pública requer também
  revisão autorizada de roteador/port-forward e, quando a publicação for
  considerada, verificação externa controlada explicitamente autorizada.

### Proteção dos arquivos pessoais

Antes do start, uma revisão administrativa de ACL deve comprovar:

- conta local da feira fora de Administrators e sem login/perfil/mapeamentos
  pessoais;
- release somente leitura/execução para a conta; escrita apenas nas pastas
  específicas realmente necessárias;
- nenhum acesso a perfil pessoal, documentos, pastas sincronizadas, unidades
  de rede ou segredos de outros projetos;
- CA MySQL, segredo runtime, logs e futura credencial do tunnel em locais com
  ACL explícita, sem Git, argumentos, `.env` no repositório ou logs;
- processo filho herda apenas as variáveis da feira e executa a versão
  Node aprovada.

Não ler conteúdo pessoal para testar isolamento; usar testes de acesso negado
em caminhos de teste aprovados e revisão de ACL por operador autorizado.

## 4. Checklist objetivo da primeira execução

### A. Ações seguras já preparadas

- [x] Modelo de ambiente com placeholders, segredo vazio, database/usuário
  nomeados para feira e destinos loopback distintos.
- [x] Script de início exige `-AuthorizeActivation`, perfil fixo, identidade
  de conta esperada, Node 24.19+ e porta 3100 livre.
- [x] Código do servidor fixa o listener em `127.0.0.1`; não depende do tunnel
  para iniciar.
- [x] Modelo do tunnel tem um único ingress para a aplicação e fallback 404;
  permanece inativo.
- [x] Plano de backup/restore separado; não há execução automática.
- [x] Fases 10.1–10.4 e arquivos `deploy/windows-fair` revisados. Nenhuma
  ação operacional foi executada nesta Fase 10.5.

**Limite dos modelos:** o switch `-AuthorizeActivation` é uma trava de
procedimento, não mecanismo de autorização humana. O script não consulta uma
aprovação externa, não valida ACLs, não prova membership completo da conta,
não testa listener MySQL local-only, não valida grants efetivos e não confirma
identidade do banco via consulta prévia. Exige que operador confira esses
gates separadamente.

### B. Ações que exigem autorização administrativa

- [ ] Confirmar suporte Windows/ESU e cumulative update atual; trocar SO se
      cobertura não for provada.
- [ ] Revisar política efetiva do Firewall e listeners de 3306/33060/22;
      revisar autenticação SSH sem ler material privado. Ajustes, reinícios ou
      desativação de serviços são mudanças globais separadas.
- [ ] Criar a conta Windows dedicada e validar que não pertence a
      Administrators; definir direitos mínimos de execução/logon conforme o
      modo de operação aprovado.
- [ ] Provisionar diretórios específicos, ACLs de release, CA, segredo,
      logs e backup. Confirmar negação de acesso a locais pessoais sem ler seus
      conteúdos.
- [ ] Preparar release imutável/isolado e confirmar versão Node/dependências.
      Não alterar Node global ou PATH sem inventário.
- [ ] Revalidar disponibilidade da porta 3100 e demais listeners antes de
      iniciar; não terminar processos existentes para liberar porta.

### C. Ações que exigem acesso ao MySQL

- [ ] Autorizar separadamente criação de uma instância/data directory
      independente, restrita a `127.0.0.1:3307`; sem modificar `MYSQL80`.
- [ ] Provisionar schema v5 vazio e compatível em `renolink_fair`, com dados
      exclusivamente fictícios; executar DDL/import apenas por fluxo migrador
      autorizado, nunca no boot.
- [ ] Criar contas/runtime e migradora exclusivas com senhas novas. Verificar
      destino efetivo, `CURRENT_USER()`, versão, TLS e grants sem registrar
      credenciais, IDs, dados ou conteúdo de payload.
- [ ] Para prova inicial sem gravação, considerar runtime temporário somente
      leitura (SELECT nas onze tabelas do snapshot). Executar apenas startup e
      `GET /health/live`; não chamar `/health/ready` sem autorização de leitura
      e não executar endpoints de escrita.
- [ ] Após aprovação do primeiro start, autorizar explicitamente o perfil DML
      runtime de menor privilégio antes de testar operações com dados
      fictícios. Não conceder DDL, DELETE, grants globais ou acesso dev/test.
- [ ] Confirmar que nenhuma conexão ou credencial de `renolink_dev`,
      `renolink_test` ou de outros projetos está no ambiente do processo.

### D. Ações que exigem exposição externa

- [ ] Nenhuma é necessária para o primeiro start local. Manter
      `cloudflared` parado/ausente, sem hostname, DNS, tunnel ou encaminhamento.
- [ ] Instalar/configurar cloudflared, criar conta/tunnel/hostname/DNS,
      autorizar tráfego público ou ativar política de acesso requer autorização
      explícita separada.
- [ ] Antes de abrir ao público: revisar a política efetiva, router/port
      forwarding, ausência de rota para MySQL/SSH, HTTPS/cookies/cabeçalhos e
      SSE; depois autorizar testes externos, celulares e carga em dados
      fictícios.
- [ ] Sem verificação externa aprovada, a afirmação de ausência de exposição
      pública permanece **não comprovada** e publicação fica bloqueada.

## 5. Ordem recomendada para ativação local futura

1. **Fechar gates de host:** suporte/updates, revisão efetiva de Firewall,
   serviços wildcard e finalidade do SSH; não fazer alterações globais sem
   aprovação.
2. **Provisionar isolamento:** conta não administrativa, release e ACLs,
   pastas separadas; conferir acesso negado a caminhos fora do escopo.
3. **Provisionar banco independente:** instância/porta loopback, TLS/CA com
   identidade válida, schema v5 e registros exclusivamente sintéticos.
4. **Auditar acesso MySQL:** confirmar banco/conta/grants e que somente o
   destino feira está configurado. A prova de grants deve ocorrer antes de
   iniciar Node; não imprimir dados sensíveis.
5. **Autorizar primeiro start read-only:** usar conta temporária sem DML,
   ambiente de processo exclusivo e `Start-Fair.ps1`; isso ainda exige
   autorização específica para iniciar Node e conectar ao banco. O startup
   fará snapshot completo e named lock transitório.
6. **Validar localmente:** verificar apenas `127.0.0.1:3100`, executar
   liveness e confirmar listener loopback. Parar com `Ctrl+C`; confirmar
   processo encerrado e nenhum tunnel ativo.
7. **Se necessário, autorizar etapa funcional separada:** aplicar grants DML
   estritos, usar fixtures fictícias e validar rotas/admin, cookies, TLS,
   persistência e recuperação. Não importar dados existentes.
8. **Publicação é outro gate:** só depois de testes completos e autorização
   externa separada, configurar tunnel, testar IP/proxy/HTTPS/SSE/celulares e
   verificar exposição pela rede autorizada. Não inferir homologação do sucesso
   local.

## 6. Plano de reversão

- Parar o processo no console com `Ctrl+C`, aguardar o encerramento gracioso e
  confirmar que não resta listener Node em `127.0.0.1:3100`. Não matar outros
  processos pelo nome nem liberar porta por força.
- Manter cloudflared/tunnel desligado durante a fase local; se ativado
  posteriormente sob autorização, retirar primeiro o ingress/hostname pelo
  procedimento aprovado e só então parar o conector.
- Revogar ou rotacionar credencial runtime somente após aprovação e garantir
  que nenhum outro projeto use a conta. Não alterar `MYSQL80` compartilhado.
- Preservar schema/diretório de dados/logs para análise; não apagar nem
  restaurar sobre `renolink_dev`/`renolink_test`. Descarte exige decisão
  explícita com retenção definida.
- Em falha de TLS, identidade, grants, ACL ou bind, não relaxar validações:
  manter serviço parado e corrigir a causa sob autorização.

## 7. Critérios de decisão

### Aprovar apenas o primeiro start local, com dados fictícios

Todos devem ser comprovados e autorizados:

1. Alvo é instância exclusiva `renolink_fair` em `127.0.0.1:3307`, sem
   importação de dados existentes e sem referência a dev/test.
2. Windows e Node estão em condição de segurança aprovada para o teste; a
   conta e ACLs passam revisão.
3. Runtime está temporariamente sem privilégios DML; grants limitados a
   SELECT nas tabelas do snapshot, sem roles/privilegios globais herdados.
4. TLS MySQL valida CA e identidade; conexão é autorizada, sem cofre.
5. Não há tunnel/hostname/regra de entrada para a aplicação; processo
   limitado ao loopback.
6. Proprietário autoriza explicitamente, em etapa própria, o startup com
   leitura completa do snapshot, transação e named lock temporário.
7. Liveness e encerramento podem ser comprovados sem endpoints de escrita.

### Bloquear primeira execução

Qualquer destino ambíguo ou compartilhado; ausência de prova do banco/conta;
grants globais ou DML amplo; TLS ignorado; uso de conta pessoal/admin; falta de
ACL; schema incompleto; tentativa de usar credenciais de dev/test; exigência
de operação sem transação/lock; porta ocupada; ou ausência de autorização
explícita de start/conexão.

### Aprovar exposição pública

Além da autorização local, são gates separados: cobertura Windows/ESU
aplicável e updates; isolamento efetivo de MySQL/SSH e router; ausência de
exposição não autorizada demonstrada; rotas admin protegidas; teste de HTTPS,
cookies, proxy/IP e SSE pelo tunnel; celulares físicos; backup cifrado com
restore demonstrado; monitoramento, contingência e capacidade externa aceitos.
Sem esses resultados, **não publicar nem declarar hospedagem homologada**.

## Estado desta fase

Foram lidos os relatórios das Fases 10.1–10.4 e os modelos
[`deploy/windows-fair`](../renolink_funcional/deploy/windows-fair/README.md),
além do caminho MySQL de startup e persistência. Não rodei testes ou scripts
nesta fase; não conectei a banco, não iniciei servidor, não acessei o cofre e
não fiz verificação de Windows/rede neste turno.

**Resultado: planejamento concluído; primeira execução bloqueada até cumprir
os gates e receber autorização específica.** Nenhuma aplicação foi publicada
e a hospedagem continua não homologada.

## Referências revisadas

- [FASE_10_1.md](./FASE_10_1.md), [FASE_10_2.md](./FASE_10_2.md),
  [FASE_10_3.md](./FASE_10_3.md) e [FASE_10_4.md](./FASE_10_4.md).
- [server.js](../renolink_funcional/server.js),
  [mysql.js](../renolink_funcional/lib/mysql.js) e
  [migrate-mysql.js](../renolink_funcional/scripts/migrate-mysql.js).
- [Start-Fair.ps1](../renolink_funcional/deploy/windows-fair/Start-Fair.ps1),
  [fair.env.example](../renolink_funcional/deploy/windows-fair/fair.env.example),
  [Health-Fair.ps1](../renolink_funcional/deploy/windows-fair/Health-Fair.ps1),
  [cloudflared.yml.example](../renolink_funcional/deploy/windows-fair/cloudflared.yml.example)
  e [backup-restore.example.md](../renolink_funcional/deploy/windows-fair/backup-restore.example.md).
