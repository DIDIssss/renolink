# RenoLink — Fase 10.3: plano de proteção e isolamento do servidor

Data: 01/11/2026  
Escopo: auditoria local somente de leitura e planejamento. Não conectei ao
MySQL, não acessei o cofre, não li arquivos pessoais, não instalei software,
não alterei serviços, firewall, rede ou configurações, não fiz testes externos
e não publiquei a aplicação.

## Conclusão

**Não autorizar publicação ainda.** A política efetiva reportada pelo
`netsh advfirewall` está habilitada e bloqueia entrada por padrão nos perfis
Domain, Private e Public; a consulta do ActiveStore não encontrou regra
habilitada aplicável às portas TCP 3306, 33060 ou 22. Isso é evidência favorável
de filtragem de entrada no momento, mas não confirma alcançabilidade pública:
não foram consultadas regras/port forwards do roteador, não houve teste remoto
e o MySQL e o SSH continuam escutando em endereços wildcard.

O SSH Server está rodando como `LocalSystem`, tem listener wildcard e serviço
broker dependente; sua configuração efetiva de autenticação não foi confirmada.
O Windows 10 22H2 continua com ESU não comprovada. A RenoLink deve usar processo
Node de baixo privilégio, banco e credenciais exclusivos, e o túnel deve
encaminhar somente para `127.0.0.1:3000`.

## 1. Riscos e evidências

### Firewall e interfaces

- `netsh advfirewall show allprofiles` informou **Estado Ligado** e
  `BlockInbound,AllowOutbound` para Domain, Private e Public. A consulta
  `Get-NetFirewallProfile` exibiu ações como `NotConfigured`; para a política
  atual, o estado agregado retornado pelo `netsh` é a evidência da ação padrão
  efetiva.
- Ethernet está no perfil Private; Radmin VPN está no perfil Public. As regras
  foram avaliadas na política ActiveStore para os perfis ativos e para portas
  TCP específicas.
- Não foram encontradas regras de entrada habilitadas que correspondam às
  portas TCP 3306, 33060 ou 22, inclusive regras de porta `Any` aplicáveis às
  buscas. Também não foram encontradas regras de firewall com nome/grupo
  OpenSSH nos stores PersistentStore/ActiveStore.
- O `netsh` reportou regras locais como `N/D (apenas repositório GPO)` nos três
  perfis. Não foram descobertas regras locais específicas; políticas GPO
  administrativas não foram investigadas além do que o ActiveStore apresentou.
- Log de conexões permitidas/descartadas do firewall estava desabilitado. Não
  foi alterado.
- Isso indica que conexões de entrada não solicitadas devem ser bloqueadas pela
  política padrão observada, na ausência de regra de permissão correspondente.
  **Não prova** que não existam regras dinâmicas, políticas fora da vista
  consultada, port forwards ou outro caminho de exposição. Nenhum teste externo
  foi realizado.

### MySQL

- O serviço `MYSQL80` está em execução e configurado como Automatic.
- Foram observados listeners MySQL wildcard nas portas TCP **3306** e **33060**.
  O `my.ini` do serviço especifica porta e diretório de dados, mas não declara
  `bind-address`, `mysqlx-bind-address` ou `skip-networking`. A falta de bind
  explícito deixa o serviço dependente do comportamento padrão e da política de
  firewall.
- Não se fez conexão, consulta SQL, leitura de contas/credenciais ou acesso ao
  cofre. O estado atual do schema, grants, TLS e dados permanece desconhecido.
- Não foram observados serviços Windows formalmente dependentes de `MYSQL80`.
  Isso não identifica todos os processos ou projetos que usam o banco.

### SSH / OpenSSH Server

- Serviço `sshd` (“OpenSSH SSH Server”) em execução, início Manual, executando
  como `LocalSystem`, binário `C:\Windows\System32\OpenSSH\sshd.exe`; listener
  TCP 22 em wildcard IPv4 e IPv6.
- Finalidade típica do serviço: acesso remoto por SSH e transferência de
  arquivos via SFTP. Nenhuma necessidade da RenoLink foi identificada; não
  foram lidos logs de autenticação nem investigado quem usa o serviço.
- `sshd_config` contém `AuthorizedKeysFile` ativo e configuração do subsistema
  SFTP. As linhas de `Port 22`, `ListenAddress 0.0.0.0`, `ListenAddress ::`,
  autenticação por senha/chave e encaminhamento estavam comentadas; portanto,
  esses parâmetros dependem dos defaults da versão.
- A leitura de opções efetivas com `sshd.exe -T` foi recusada pelo próprio
  binário com “no hostkeys available”. Não foram procuradas nem lidas host keys
  ou chaves de usuários. Assim, política efetiva de autenticação, forwarding e
  listen não foi provada por essa via.
- `SshdBroker` também está Running/Manual como `LocalSystem`. O SCM lista
  `SshdBroker` como serviço dependente de `sshd`; `sshd` não lista dependências
  próprias. O papel exato do broker e seus consumidores não foi determinado.
  Não parar nem desabilitar um serviço sem inventário e autorização.
- Não existe regra de entrada OpenSSH encontrada nos stores consultados; a
  política padrão de firewall observada bloqueia entrada. Isso reduz a
  exposição indicada pela configuração, sem provar ausência de qualquer caminho
  remoto.

### Windows Update / ESU

- Windows 10 Pro 22H2, build 19045; fim do suporte regular em 14/10/2025.
- O marcador `win10ConsumerESUStatus=2` está presente no registro, mas não foi
  possível interpretar com segurança esse número como prova de enrollment.
  `Win10CommercialAzureESUEligible` e
  `Win10CommercialKeybasedESUEligible` aparecem como 0; esses marcadores de
  elegibilidade não comprovam enrollment consumer nem commercial.
- `KB5126256` está instalada conforme a enumeração local. A documentação
  Microsoft a identifica como **Licensing Preparation Package para ESU**;
  instalação desse pacote é pré-requisito, não prova de inscrição nem de
  cobertura de updates.
- O histórico de update contém atividades recentes e updates do Defender, mas
  não prova que este dispositivo esteja inscrito e recebendo o último security
  cumulative update aplicável.
- A Microsoft informa que o status consumer pode ser conferido em
  **Settings > Update & Security > Windows Update**; para compra, a ordem deve
  constar no histórico da conta. A documentação informa cobertura consumer até
  12/10/2027 para dispositivos inscritos e elegíveis. Também diz que o programa
  consumer não pode ser usado em cenários comerciais. Como o uso pretendido é
  disponibilizar publicamente a RenoLink durante uma feira, a classificação
  comercial e elegibilidade precisam ser confirmadas com Microsoft/licenciamento;
  não presumir que enrollment consumer baste.
- Evidências a obter antes de publicar: confirmação visível de enrollment do
  dispositivo no Windows Update; confirmação de licença/ordem no canal
  apropriado ou comprovação de ESU comercial se aplicável; instalação do
  cumulative security update mais recente oferecido ao dispositivo inscrito;
  ausência de erro de ativação/enrollment. Se qualquer item não puder ser
  confirmado, tratar como **sem cobertura verificada** e usar sistema
  operacional ainda suportado.

## 2. Dependências identificadas

A inspeção de projeto foi restrita a `renolink_funcional` e aos relatórios
autorizados; não foi feita busca em diretórios pessoais ou outros projetos.

- [`mysql-dev.ps1`](../renolink_funcional/scripts/mysql-dev.ps1) configura o
  fluxo local para host `127.0.0.1`, porta 3306 e schema `renolink_dev`.
  Outros scripts da RenoLink referenciam `renolink_test` em testes, e a
  configuração de produção exige valores próprios para MySQL/TLS.
- Os testes e snapshots das fases 8/9 já demonstraram dependência de
  `MYSQL80`; a auditoria anterior observou Node conectado em outro instante.
  Na captura de sockets desta fase não foi identificado cliente MySQL ativo.
- Não foi possível identificar ou descartar projetos fora da RenoLink que
  dependam do serviço compartilhado. Nenhuma conexão MySQL, consulta de
  processos SQL, lista de credenciais, logs ou diretórios externos foi usada.
- `sshd` não é dependência da RenoLink identificada; pode servir administração
  remota/SFTP do computador, mas sua finalidade local real continua pendente.

## 3. Arquitetura de isolamento proposta

1. **Sistema suportado:** preferir host/Windows com suporte de segurança
   comprovado. Se permanecer no Windows 10, validar ESU aplicável ao cenário
   antes de qualquer exposição.
2. **Identidade Windows dedicada:** criar conta local de serviço sem login
   interativo, sem grupo Administrators e sem perfil/mapeamentos pessoais.
   Conceder apenas “Log on as a service” quando necessário e ACL de leitura/
   execução no release; escrita limitada a logs, temporários e dados designados.
3. **Node restrito:** executar `node server.js` em ambiente de produção sob essa
   identidade, sem usar o lançador local, `npm start`, `mysql-dev.ps1` ou cofre
   DPAPI. Configuração separada por processo, segredos fora do release e do
   Git; `NODE_ENV=production`, `STORAGE_DRIVER=mysql`, origem HTTPS canônica,
   cookies secure e TLS MySQL validado.
4. **MySQL de feira:** não reutilizar dados nem conta de `renolink_dev` ou
   `renolink_test`. Preferir instância dedicada com diretório de dados próprio,
   bind `127.0.0.1`, porta loopback dedicada (por exemplo 3307), sem X Protocol
   se não necessário, schema `renolink_fair` e conta runtime exclusiva sem DDL.
   Criar conta migradora separada apenas para migrações autorizadas.
5. **Serviço compartilhado atual:** não alterar `MYSQL80`, bind, portas ou
   firewall antes de inventário autorizado de outros consumidores. A instância
   isolada evita interferir em projetos que usem o serviço atual, mas não
   corrige o listener wildcard existente. Depois do inventário, decidir com o
   proprietário entre restringir o bind global a loopback, manter clientes
   remotos aprovados com controles adequados ou migrar os consumidores.
   Qualquer restrição global exige janela e plano de rollback.
6. **Acesso local e firewall:** o Node permanece em `127.0.0.1:3000`; apenas o
   próprio Node acessa o MySQL de feira em loopback. Não criar regra de firewall
   para expor 3000, 3306, 33060 ou SSH. O túnel só encaminha para a aplicação.
7. **Cloudflare Tunnel:** após autorização, um tunnel nomeado com um hostname
   e ingress estrito para `http://127.0.0.1:3000`; regra final sem fallback
   encaminha a um destino inválido/404. Não encaminhar MySQL, SSH, SMB,
   interfaces administrativas nem portas genéricas. Proteger o token do túnel
   em arquivo/secret acessível apenas à conta de serviço.
8. **Proxy confiável:** o código RenoLink em produção exige conexão do proxy
   local e `X-Forwarded-Proto: https`; usa `X-Forwarded-For` somente quando é
   um único IP. Não lê `CF-Connecting-IP`. Confirmar formato de cabeçalhos e
   sua origem real em homologação. Não confiar em cabeçalhos enviados pelo
   visitante nem desativar validação; se houver incompatibilidade, revisar
   implementação, testes e rate limits antes de publicar.
9. **Backups:** produzir backup criptografado da base exclusiva e cópia
   independente do PC, sob autorização, com retenção/RPO/RTO definidos.
   Realizar restauração em instância vazia e isolada e validar aplicação/dados
   fictícios. Não copiar dumps para o release e nunca restaurar sobre dev/test.

## 4. Alterações propostas, permissões e impactos

| Alteração planejada | Escopo provável | Privilégio e impacto |
|---|---|---|
| Criar conta Windows de serviço, “Log on as a service” e ACLs restritas | Host/RenoLink se ACLs forem estritamente delimitadas | Administração local pode ser necessária; sem elevação pode não ser possível conceder o direito de serviço ou alterar ACLs fora de pastas próprias. |
| Instalar/registrar instância MySQL adicional e serviço em porta loopback | Serviço dedicado, porém compartilha CPU/RAM/disco | Requer administrador para instalação/serviço, diretórios e eventual firewall. Não altera `MYSQL80` se realmente separado; validar portas, data dir e consumo. |
| Criar schema/contas feira | Instância escolhida | Privilégio DBA na instância; pode ser restrito ao novo banco, mas exige autorização expressa. |
| Restringir bind de `MYSQL80` existente | Global a todos os projetos que usam o daemon | Privilégio administrativo e reinício; pode quebrar conexões remotas. Não realizar sem inventário/aprovação. |
| Regras de firewall para MySQL/SSH | Perfil/rede do host; possivelmente GPO | Administração; uma regra ampla pode interromper outros projetos ou administração remota. Não é necessária para expor o site via túnel, mas revisão efetiva é gate. |
| Instalar `cloudflared` como serviço | Host ou identidade de serviço | Administração para instalação/registro conforme método. Executável/túnel afetam somente o hostname se ingress for restrito; alterações de conta/DNS são externas e exigem autorização. |
| Alterar/reinstalar Windows, ESU, energia ou Defender | Global | Administração/licença/janela; pode afetar apps, reinícios e proteção do computador. |
| Alterar Node/npm globais/PATH | Global | Pode quebrar outros projetos. Preferir versão instalada isoladamente ou ambiente controlado; sem alteração global nesta fase. |
| Backup externo e restore | Dados/armazenamento fora do PC | Aprovação de destino externo, custo, credenciais e retenção; restauração somente em instância nova aprovada. |

### Proteção do MySQL sem interrupção improvisada

Não reiniciar ou reconfigurar o serviço compartilhado agora. A evidência atual
mostra firewall com bloqueio inbound por padrão e sem regra habilitada
encontrada para as três portas analisadas; isso reduz risco de entrada, mas o
bind continua wildcard e é frágil a mudança futura de política. O procedimento
seguro é:

1. inventariar, em escopo autorizado, os consumidores do `MYSQL80` sem ler
   credenciais ou dados;
2. provisionar a instância da feira em loopback/porta independente, evitando
   alteração do serviço compartilhado;
3. manter túnel apenas em `127.0.0.1:3000`;
4. depois, com os proprietários dos outros projetos, avaliar bind/firewall do
   `MYSQL80` e validar todos os consumidores antes de reinício.

Uma regra explícita de bloqueio em 3306/33060 pode afetar clientes remotos
legítimos; não a criar até esclarecer dependências e autorizar o impacto.

## 5. Plano de validação

Todas as verificações a seguir são futuras e exigem aprovação/janela. Nenhuma
foi executada nesta etapa.

### Rede, Firewall e MySQL

- [ ] Em todos os perfis aplicáveis, revisar política efetiva e regras allow/
      block para TCP 3306, 33060 e 22. Confirmar listeners da instância feira
      limitados a `127.0.0.1` e que nenhum ingress do túnel aponta a essas
      portas.
- [ ] Confirmar que não há encaminhamento de portas no roteador e que não
      existe regra de entrada permissiva para MySQL/SSH. Para afirmar ausência
      de exposição pública, realizar somente depois de autorização uma
      verificação independente e controlada a partir de rede externa; não fazer
      varredura nesta fase. Se tal prova não for autorizada, manter a condição
      como não comprovada e não publicar.
- [ ] Confirmar que a aplicação conecta somente ao banco `renolink_fair`, com
      usuário sem DDL; TLS/CA/hostname valida corretamente; certificados
      inválidos falham fechado. Não consultar `renolink_dev` em teste.
- [ ] Se SSH não for requisito operacional, propor desativação como mudança
      separada e autorizada. Se for necessário, manter o serviço restrito a
      administração privada/VPN e provar que não está acessível publicamente;
      nunca encaminhá-lo pelo tunnel.

### Windows, privilégios e aplicação

- [ ] Confirmar Windows ainda suportado ou ESU ativa para a classificação correta
      do uso; verificar enrollment/ordem/licença e instalar o cumulative security
      update mais recente oferecido. Se ESU ou update atual não se comprovar,
      bloquear publicação.
- [ ] Validar que Node e `cloudflared` executam com identidade não
      administrativa e sem acesso a arquivos pessoais; confirmar ACLs por
      revisão administrativa e teste de leitura negada de diretórios fora do
      escopo, sem ler conteúdo pessoal.
- [ ] Testar cada rota `/api/admin/*` e página administrativa: anônimo e
      usuário comum recebem negação; somente equipe autenticada/autorizada
      acessa; sessão/cookies, origem e rate limit são verificados. Não instalar
      credenciais admin compartilhadas ou de dev.
- [ ] Validar HTTPS público, origem canônica, cookies `Secure`, `HttpOnly`,
      `SameSite`, cabeçalhos Host/proxy e IP de cliente. Cabeçalhos falsificados
      enviados do visitante não podem alterar identidade, rate limit ou decisão
      de segurança.

### SSE, celulares e recuperação

- [ ] Via o hostname e túnel reais, testar SSE em navegador: `text/event-stream`,
      sem buffer/cache, heartbeat de 15 s, reconexão/`Last-Event-ID`, isolamento
      de eventos entre contas e encerramento limpo ao parar Node. Fazer ensaio
      sustentado por pelo menos 60 minutos, progressivo e sem contornar limites.
- [ ] Testar celulares físicos Android/Chrome e iPhone/Safari em Wi-Fi e dados
      móveis: login, fluxo de visitante, cookies, navegação, SSE, troca de rede,
      suspensão/retorno da aba, rotação e acessibilidade de controles.
- [ ] Ensaiar encerramento/reinício controlado de Node, MySQL feira, conector e
      Windows; confirmar recuperação de processo, reconexão SSE e ausência de
      duplicações ou corrupção. Simular falta de rede e falha do host apenas em
      janela aprovada.
- [ ] Fazer backup criptografado e restauração em base nova separada; verificar
      contagens e fluxos sintéticos. Registrar duração e resultado para
      demonstrar RPO/RTO aprovados.
- [ ] Monitorar CPU/RAM/disco/upload, 5xx/429/503, atraso de login, fila de
      hashes, pool MySQL, conexões SSE, healthchecks, status do túnel e idade do
      backup. Logs devem omitir senhas, tokens, cookies, strings de conexão,
      corpos e conteúdo de usuários.

## 6. Critérios para autorizar publicação

Publicação só pode ser considerada depois de autorização explícita separada e
de todos os gates seguintes:

1. Sistema Windows suportado com segurança ou ESU vigente e aplicável
   comprovada; updates atuais instalados.
2. Evidência revisada de que MySQL e SSH não são acessíveis publicamente:
   listener MySQL local-only na instância feira, política efetiva de firewall
   sem permissão de entrada, sem port forward no roteador, nenhum desses
   serviços no tunnel e verificação externa controlada aprovada. Sem teste
   externo autorizado, esta condição fica pendente.
3. Node e conector com privilégios mínimos; release não dá acesso a arquivos
   pessoais; banco/contas da feira independentes de dev/test e sem credenciais
   reais reutilizadas.
4. Todas as rotas administrativas negam acesso indevido; cookies seguros,
   origem, cabeçalhos e IP confiável validados pelo caminho de produção.
5. HTTPS e SSE funcionais através do Tunnel, inclusive heartbeat, reconexão,
   privacidade entre usuários e ensaio prolongado.
6. Testes aprovados em celulares físicos, incluindo iPhone/Safari e
   Android/Chrome com dados móveis.
7. Backup externo criptografado e restauração testada, recuperação dos serviços
   ensaiada, alertas/operador e contingência definidos.
8. Capacidade de 10/25/50 visitantes medida no caminho real e dentro de metas
   aceitas; resultados de loopback não substituem o teste do túnel/rede.

**A hospedagem não está homologada.** Aprovar esta fase documental não autoriza
instalação, alteração global, criação de recursos, testes externos ou
publicação.

## Fontes e limitações

- Resultados de Fases anteriores: [FASE_10_1.md](./FASE_10_1.md) e
  [FASE_10_2.md](./FASE_10_2.md).
- O procedimento e projetos RenoLink foram examinados apenas dentro do
  workspace; não foi feito inventário de outros projetos, contas ou arquivos
  locais.
- Microsoft:
  [Consumer ESU para Windows 10](https://www.microsoft.com/en-us/windows/extended-security-updates);
  [programa ESU Windows 10](https://learn.microsoft.com/en-us/windows/whats-new/extended-security-updates);
  [KB5126256 — ESU Licensing Preparation Package](https://support.microsoft.com/en-us/servicing/os/windows-10/2026/09/kb5126256-windows-10-21h2-22h2-standalone-cbs).
- A consulta `sshd.exe -T` não completou por “no hostkeys available”; não se
  leram chaves para tentar contornar essa limitação.
- Nenhum teste de exposição externa foi feito; a política/firewall descrita é
  a evidência local observada no instante da coleta.
