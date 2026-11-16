# RenoLink — Fase 10.2: auditoria de segurança do servidor local

Data: 01/11/2026  
Escopo: consultas locais somente de leitura e planejamento. Não houve conexão
ao MySQL, acesso ao cofre Windows, leitura de arquivos pessoais, varredura
externa, teste de exposição pela internet, alteração de firewall/rede/config,
instalação, criação de recursos ou publicação.

## Conclusão

**Não expor o PC neste estado.** A configuração estática confirma o serviço
`MYSQL80` em execução com listeners MySQL em endereços wildcard; o arquivo
`my.ini` não declara `bind-address` nem `skip-networking`. A inspeção não achou
regra de entrada explícita de firewall com nome/caminho MySQL ou porta local
3306; isso **não comprova** que a porta esteja inacessível, pois os perfis
mostram ações padrão `NotConfigured`, há regras genéricas possíveis e não foi
feita prova de bloqueio efetivo.

O Windows 10 22H2 está além do suporte regular. Foi encontrado um marcador de
ESU no registro e um pacote classificado como atualização de segurança em
2026, mas a cobertura e vigência ESU não puderam ser confirmadas. O Defender
estava habilitado na consulta; isso não substitui suporte do sistema, firewall
efetivo, isolamento ou atualizações confirmadas.

## 1. Diagnóstico de segurança

### Firewall, rede e sockets

- Os perfis **Domain**, **Private** e **Public** do Windows Defender Firewall
  estavam habilitados.
- `DefaultInboundAction` e `DefaultOutboundAction` aparecem como
  `NotConfigured` nos três perfis. Não concluir daí, isoladamente, qual regra
  final será aplicada a cada fluxo.
- Não foi localizada regra habilitada em `ActiveStore` que corresponda
  explicitamente a MySQL/mysqld ou `LocalPort=3306`. A busca também não achou
  regra ampla de entrada que, pelos filtros consultados, permitisse qualquer
  programa/porta em perfil Public com endereço remoto Any. A enumeração não
  equivale a uma auditoria completa da política efetiva do firewall.
- O perfil Ethernet (`Rede 3`) é **Private**; o adaptador **Radmin VPN** está
  classificado como **Public**. Hyper-V também está ativo, sem perfil de rede
  retornado na consulta.
- A leitura atual dos sockets mostrou `mysqld.exe` em `:::3306` e `:::33060`;
  a consulta anterior da Fase 10.1 também registrou `0.0.0.0:3306` e
  `[::]:3306`. O porto 33060 é outro listener do MySQL (MySQL X) e deve ser
  incluído em qualquer revisão de exposição. Isso indica escuta em interfaces
  amplas, não prova alcançabilidade remota.
- O arquivo de configuração do serviço em
  `C:\ProgramData\MySQL\MySQL Server 8.0\my.ini` contém `port=3306` e `datadir`,
  mas não contém uma diretiva ativa `bind-address`, `skip-networking` ou
  `mysqlx-bind-address`. O listener observado é consistente com o risco de
  bind padrão amplo. O conteúdo de credenciais não foi procurado nem exibido.
- Outros listeners que merecem avaliação antes de servidor público:
  `sshd.exe` em `0.0.0.0:22` e `[::]:22`, além de SMB/NetBIOS em interfaces
  locais; `vmms.exe` em `0.0.0.0:2179`/`[::]:2179`. Não foi feita análise de
  exposição externa ou de regras efetivas para esses serviços.
- Na hora da consulta não havia conexão TCP cliente estabelecida com a porta
  3306; o socket MySQL estava em LISTEN. Isso é apenas uma amostra instantânea.

### Regras de firewall para MySQL

Resultado verificável: não foi encontrada regra habilitada explicitamente
identificada por MySQL/mysqld nem regra de porta local 3306 na lista
`ActiveStore` consultada. Não foi aberta nenhuma porta e não houve teste de
conexão externa. A porta 33060 também precisa ser examinada em uma revisão
completa de política.

**Limite importante:** ausência de regra específica não é prova de bloqueio.
As ações padrão aparecem como não configuradas; podem existir regras por
serviço, programa, grupo, política corporativa, endereço ou escopo que não
foram classificadas como MySQL pelo filtro. A política efetiva não pode ser
declarada aprovada com esta evidência. Não usar varredura externa para sanar
essa incerteza; uma revisão administrativa autorizada de regras/escopos seria
necessária antes da publicação.

### Dependências locais do serviço MYSQL80

- O serviço `MYSQL80` estava `Running`, `Automatic`; não constavam serviços
  Windows dependentes nem relações WMI de dependência.
- A consulta de sockets não mostrou cliente ativo na amostra. A inspeção de
  processo da [Fase 10.1](./FASE_10_1.md), em outro instante, encontrou RenoLink Node com
  conexões locais MySQL estabelecidas.
- Os scripts do projeto indicam uso local de `renolink_dev` pelo fluxo
  [`mysql-dev.ps1`](../renolink_funcional/scripts/mysql-dev.ps1) e de
  `renolink_test` pelos testes Fase 8. Isso confirma
  dependências da RenoLink, não inventaria os outros projetos instalados.
- Não foram consultados logs SQL, contas, schemas, conexões MySQL, arquivos de
  outros diretórios ou projetos pessoais. A inexistência de outros clientes
  não foi comprovada. Aplicações Node/desktop podem usar MySQL sem registrar
  uma dependência formal de serviço Windows.

### Windows, atualizações e proteções

- Windows 10 Pro 22H2, build 19045. O suporte regular terminou em 14/10/2025;
  o estado de suporte estendido deve ser comprovado antes de exposição pública.
- A chave local
  `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SoftwareProtectionPlatform\ESU`
  existe. Os valores observados foram
  `win10ConsumerESUStatus=2`,
  `Win10CommercialAzureESUEligible=0` e
  `Win10CommercialKeybasedESUEligible=0`. Sem fonte confiável para interpretar
  o estado numérico e sem validação de licença/conta, **não é possível concluir
  que ESU está ativa ou vigente**. Não presumir cobertura com base no valor 2.
- `Get-HotFix` listou `KB5126256`, classificado como Security Update e instalado
  em 12/09/2026; o histórico mais recente consultado continha sobretudo
  atualizações de inteligência/plataforma do Defender. Isso é evidência de
  instalação registrada, não prova de que o sistema esteja totalmente
  atualizado ou elegível a receber patches atuais.
- O serviço Windows Update apareceu como Manual e foi observado parado numa
  consulta e em execução noutra. O estado é variável; não foi iniciada nem
  interrompida ação de atualização.
- Microsoft Defender estava habilitado, com proteção em tempo real,
  monitoramento de comportamento, proteção IOAV e NIS ativos. A assinatura
  observada tinha atualização recente em 31/10/2026; última verificação rápida
  constava há 4 dias; não havia registro de verificação completa (`4294967295`).
  Exclusões não foram acessíveis sem elevação e não foram consultadas.
- UAC estava habilitado (`EnableLUA=1`) com prompt seguro. RDP estava desativado
  (`fDenyTSConnections=1`). O serviço OpenSSH `sshd` estava em execução com
  inicialização manual, e havia sockets SSH em wildcard; regras efetivas para
  SSH não foram determinadas.

### Riscos classificados por prioridade

| Prioridade | Risco | Evidência e condição |
|---|---|---|
| **P1 — bloqueador** | MySQL escutando em interfaces wildcard | Listener 3306 e 33060 amplo; `my.ini` sem bind restritivo. Firewall efetivo não foi comprovado. A porta 3306 nunca deve ser encaminhada pelo túnel. |
| **P1 — bloqueador** | Sistema operacional fora do suporte regular; ESU incerta | Windows 10 22H2 EOS; marcador ESU não interpretado/validado. Sem suporte de segurança confirmado, não hospedar publicamente. |
| **P1 — alto** | Serviços adicionais em interfaces de rede | SSH 22 e serviços Windows/SMB visíveis em listeners amplos; a auditoria não prova exposição externa nem eficácia das regras. |
| **P2 — alto** | Aplicação torna-se serviço público pelo hostname do túnel | Tunnel não torna rotas privadas; abuso, exploração e negação de serviço continuam possíveis. Sem tunnel nem teste público nesta fase. |
| **P2 — alto** | Trust proxy / IP real ainda não compatibilizados | RenoLink exige peer loopback, `X-Forwarded-For` como um IP único e `X-Forwarded-Proto=https`; cabeçalhos e formato reais do túnel precisam ser verificados sem confiar em entrada do visitante. |
| **P2 — médio/alto** | PC pessoal é ponto único de falha e domínio de impacto | Sessões pessoais, serviços e dados residem no mesmo computador; execução com a conta pessoal ampliaria o impacto de comprometimento. |
| **P2 — médio** | Backups/recuperação e continuidade não ensaiados | Cópia apenas no PC não resiste a falha, ransomware, furto, queda de energia ou ISP. |

As prioridades refletem planejamento; não são afirmação de vulnerabilidade
remota confirmada.

## 2. Plano de isolamento proposto

1. **Plataforma suportada e decisão do host:** antes de qualquer exposição,
   confirmar oficialmente atualização/ESU aplicável ou escolher máquina/OS
   suportado. Preferir equipamento dedicado à feira, sem perfil e documentos
   pessoais.
2. **Identidade de serviço:** executar Node e o conector do túnel com conta
   local separada, sem login interativo, administração, acesso ao perfil
   pessoal ou pastas de rede. Preparar release imutável com leitura/execução;
   escrita apenas em diretórios dedicados e limitados para logs/temporários.
3. **Banco independente:** criar futuramente schema `renolink_fair` vazio,
   dados apenas fictícios e sem copiar `renolink_dev`, `renolink_test`,
   JSONs, administradores ou credenciais. Conta runtime apenas com permissões
   da aplicação e sem DDL; conta migradora separada e temporária. Um schema no
   mesmo serviço reduz mistura acidental, mas não isola recursos nem o daemon.
   Considerar instância MySQL separada se isolamento de falha/rede for requisito.
4. **MySQL privado:** em janela autorizada, restringir bind e firewall ao
   necessário para a instância da feira, incluindo listeners 3306 e 33060.
   Não tunelar nem publicar MySQL; não alterar serviço compartilhado sem
   inventário dos clientes. Confirmar a regra de firewall efetiva por meios
   administrativos locais aprovados, não por varredura externa.
5. **Credenciais/TLS:** gerar credenciais exclusivas e segredos fora do release,
   entregues somente ao processo de serviço. Exigir TLS e verificação de CA e
   identidade do MySQL como produção requer. Não reutilizar DPAPI/cofre atual,
   contas de dev/test ou senhas de usuários.
6. **Túnel restrito:** instalar e configurar, após aprovação, tunnel nomeado
   com um único hostname e ingress para `http://127.0.0.1:3000`. O conector
   executa com a identidade limitada. Não encaminhar 3306/33060, painel do
   sistema, compartilhamentos ou portas genéricas. Validar cabeçalhos,
   origem, IP cliente, cookies e SSE antes da divulgação do endereço.
7. **Dados e superfície:** servir somente os arquivos públicos allowlisted;
   manter configuração, segredos, logs e backups fora da raiz servida. Reduzir
   acesso administrativo da aplicação, revisar rate limits e preparar resposta
   a incidente. Logs sem corpos, mensagens, cookies, tokens, senhas, strings
   de conexão e identificadores pessoais desnecessários.
8. **Backup e restauração:** backups criptografados com cópia fora do PC e
   retenção aprovada. Ensaiar restore em novo schema/instância isolada antes
   de dados reais; nunca restaurar sobre dev/test. Definir RPO/RTO, teste de
   recuperação, operador e contingência para falha do PC, energia, ISP ou
   Cloudflare.

## 3. Alterações futuras e compatibilidade com outros projetos

### Mudanças globais ou compartilhadas — autorização e inventário necessários

- `bind-address`, `mysqlx-bind-address`, configuração, reinício ou atualização
  do serviço `MYSQL80`: afetam todos os schemas e conexões que usam a instância,
  não apenas RenoLink.
- Regras de Firewall para 3306/33060, SSH, SMB ou perfis: aplicam-se ao host
  inteiro e podem interromper clientes remotos legítimos ou abrir caminhos
  para outras aplicações.
- Trocar Node global/PATH, atualizar npm ou alterar variáveis de máquina:
  pode mudar a versão utilizada por outros projetos e serviços.
- Alterar energia, Windows Update/ESU, UAC, Defender, ACLs abrangentes,
  serviços, rotas ou adaptadores: afeta o computador e outros usos da rede.
- Instalar `cloudflared` como serviço de máquina, configurar política de
  execução ou alterar DNS/conta Cloudflare: pode ter efeito além do processo
  RenoLink e do hostname planejado.
- Usar o daemon MySQL atual para banco adicional compartilha CPU, RAM, disco,
  pool global e disponibilidade, ainda que o schema e as contas sejam novos.

### Mudanças que podem ser limitadas à RenoLink, se desenhadas assim

- Cópia versionada do release e configuração em variáveis do processo, sem
  alterar `.env`, scripts ou `PATH` globais.
- Identidade de serviço e ACLs restritas aos diretórios específicos da
  aplicação, logs, temporários e segredos exclusivos.
- Schema `renolink_fair` e conta runtime/migradora dedicadas no MySQL; isso
  evita mistura de dados, mas não isola o serviço ou seus recursos.
- Processo Node na porta loopback dedicada, desde que não conflite com o
  listener atual em 3000; ingress de tunnel restrito a essa porta.
- Diretório/tarefa própria para backups e logs, com rotação sem acesso a dados
  pessoais ou aos arquivos de outras aplicações.

### Dependências observadas e lacunas

- Serviço Windows `MYSQL80`: Running, Automatic; sem serviços dependentes
  declarados. Não foi encontrada relação de dependência WMI.
- RenoLink usa `renolink_dev` em seus scripts locais de MySQL e `renolink_test`
  nos testes da Fase 8; a evidência de Fase 10.1 encontrou um processo Node
  conectado ao MySQL local.
- Na amostra desta fase, nenhum cliente TCP de 3306 estava conectado. Não
  pesquisamos diretórios externos ao projeto, credenciais, logs ou dados e não
  conectamos ao servidor; portanto, **não foi possível identificar ou excluir
  outros projetos que usam MySQL**.
- Node 24.19.0 é instalado globalmente em `Program Files`; não alterar sua
  versão/PATH sem inventário de todos os consumidores. `cloudflared` não foi
  encontrado no PATH nem observado como processo na coleta da Fase 10.1.

## 4. Ações que exigem autorização explícita

1. Confirmar situação ESU/suporte com o administrador/licenciamento Windows e
   autorizar migração para sistema suportado, se necessária.
2. Autorizar inventário local mais abrangente de serviços/clientes do MySQL,
   sem ler segredos ou dados pessoais, para identificar consumidores antes de
   eventual mudança global.
3. Autorizar restrição de bind do MySQL e revisão/ajuste de regras de firewall,
   incluindo impacto nos demais projetos. Não alterar regras globais por
   suposição.
4. Autorizar identidade de serviço, ACLs específicas, schema e contas
   exclusivas, TLS local e diretórios protegidos.
5. Autorizar instalação/configuração do `cloudflared`, conta e domínio,
   hostname, tunnel nomeado e política pública/de acesso. Sem autorização,
   nada será criado nem publicado.
6. Aprovar janela de testes controlados com dados fictícios, aparelhos físicos,
   rede móvel, SSE, restauração e critérios de aceite.
7. Definir backup externo, retenção, RPO/RTO, operador e contingência.

## Estado desta fase

Consultados localmente e somente para leitura: perfis/regras selecionadas do
Firewall, perfis de rede, sockets/listeners, serviço/dependências Windows,
metadados de `my.ini`, versões/indicadores de Windows Update e ESU, estado do
Defender, UAC e RDP. Revisados os scripts de MySQL da RenoLink e
[`FASE_10_1.md`](./FASE_10_1.md). Não conectei ao banco, não acessei o cofre, não li arquivos
pessoais, não modifiquei serviços/configuração/firewall/rede, não rodei
varreduras externas nem publiquei o site. **A hospedagem continua não
homologada; nenhuma alteração está autorizada ou foi realizada.**
