# RenoLink — Fase 10.1: auditoria para hospedagem no PC principal

Data: 01/11/2026  
Escopo: auditoria somente de leitura e planejamento. Nenhuma configuração foi
alterada; nenhuma aplicação foi publicada; nenhum teste de carga na internet
foi executado; não houve conexão ao banco de dados nem leitura do cofre Windows.

## Decisão preliminar

**Não publicar neste momento.** O hardware parece comparável ao do benchmark
local da Fase 8.3, mas isso não comprova capacidade para operação pública. Há
dois bloqueios relevantes: o Windows 10 Pro 22H2 está fora do período regular
de suporte desde 14/10/2025 (não foi verificada eventual cobertura ESU), e o
MySQL local foi observado escutando em `0.0.0.0:3306` e `[::]:3306`. A política
do firewall não foi inspecionada; portanto, não se afirma que o banco esteja
acessível pela LAN ou pela internet. A configuração atual não atende à
recomendação de manter o MySQL isolado em loopback.

O Node já escuta em `127.0.0.1:3000`, o que é compatível com uma origem local
de túnel, mas não basta para declarar Cloudflare Tunnel compatível: confiança
de proxy, cabeçalhos, IP real e SSE ainda precisam de homologação ponta a ponta.
Não há evidência de túnel ou hostname configurado.

## 1. Especificações identificadas

Levantamento por consultas locais de leitura em 01/11/2026. Valores de memória
e disco são do instante da consulta; não são monitoramento contínuo.

| Item | Observado | Limite da evidência |
|---|---|---|
| CPU | Intel Core i7-7700 @ 3,60 GHz; 4 núcleos físicos, 8 processadores lógicos. | Identificado pelo sistema. |
| RAM | 31,94 GiB visíveis; 17,29 GiB livres na consulta. | A memória livre varia com processos, cache e VMs. |
| Windows | Windows 10 Pro, versão 10.0.19045, build 19045 (22H2), 64 bits. | A condição de ESU/atualizações não foi verificada. O suporte regular terminou em 14/10/2025. Não operar publicamente com sistema sem atualizações de segurança. |
| Disco D: | 1.000.203.087.872 bytes totais; 556.438.106.112 bytes livres (aprox. 518,1 GiB livres). | Espaço livre no volume D:, não medição do espaço utilizado pelo MySQL nem garantia de espaço de backup. |
| Node.js | v24.19.0. | Compatível com o requisito do projeto `>=24.19.0 <25`. |
| npm | 11.17.0. | Compatível com o requisito `>=11 <12`. |
| MySQL Server | Binário do serviço `MYSQL80`: MySQL Community Server 8.0.46. Serviço em execução, inicialização automática. | Versão do binário local, obtida por `--version`; não houve conexão ao servidor nem verificação do schema, grants ou TLS. O cliente `mysql` não está no PATH. |
| `cloudflared` | Não encontrado no PATH; nenhum processo com esse nome foi observado. | Não prova ausência do executável em outros diretórios; não foi instalado nem procurado no disco. |
| Processos relevantes | Dois processos `mysqld.exe` (aprox. 27 MiB e 464 MiB de memória de trabalho) e um `node.exe` (aprox. 60 MiB). Serviço `MYSQL80` ativo. | Medição instantânea; não foi lida linha de comando com argumentos nem investigada a finalidade do segundo `mysqld`. |
| Aplicação local | Porta 3000 em LISTEN em `127.0.0.1`; conexões locais estabelecidas. | A inspeção de sockets não enviou requisições HTTP. O PID do listener coincide com o processo Node observado. |
| MySQL local | Porta 3306 em LISTEN em `0.0.0.0` e `[::]`; conexões locais estabelecidas. | Indica escuta em todas as interfaces IPv4/IPv6. Firewall, NAT e alcançabilidade externa não foram testados. |

### Energia

O esquema ativo é **Equilibrado**. Na alimentação CA, o tempo de suspensão
está em 0 (nunca); na alimentação CC, 900 segundos (15 minutos). Hibernação
após está em 0 (nunca), e suspensão híbrida está habilitada. O botão de energia
está configurado para suspender. Esses valores foram apenas consultados. Não
foi confirmado se o PC permanecerá em CA nem foi alterado qualquer ajuste.
Uma interrupção elétrica, suspensão manual, reinício ou atualização ainda pode
derrubar a aplicação; continuidade exige planejamento de energia e operador.

## 2. Rede residencial

- Adaptador Ethernet Realtek ativo, link negociado a **100 Mbps**; endereço
  privado local `192.168.15.7`, gateway `192.168.15.1`. O link é a velocidade
  negociada entre PC e rede local, **não** a taxa de upload da fibra.
- Adaptadores Radmin VPN e Hyper-V também estão ativos. A rota padrão observada
  usa Ethernet; a rota Radmin tem métrica maior. A presença de VPNs/bridges
  acrescenta rotas e superfícies locais a revisar antes de operação pública.
- Contadores consultados naquele instante mostravam zero pacotes descartados
  nos adaptadores listados com estatísticas disponíveis. Uma amostra instantânea
  não demonstra estabilidade, ausência de perda ou qualidade do ISP.
- Não foram consultados roteador, endereço IP público, CGNAT, DNS público,
  regras de firewall, velocidade contratada, upload, jitter ou perda ao longo
  do tempo. Nenhuma porta foi aberta e nenhum teste externo foi executado.

### Como medir depois, sem teste de carga da aplicação

1. Consultar a velocidade de upload contratada com o provedor; verificar se o
   adaptador de 100 Mbps poderá limitar a taxa caso o plano supere esse enlace.
2. Em janela sem visitantes, medir upload/download uma única vez por meio da
   ferramenta do provedor ou de um serviço confiável. Esse teste consome banda;
   não executá-lo durante demonstração ou tráfego importante.
3. Medir estabilidade por período acordado (por exemplo, 30–60 minutos), com
   sondas ICMP de baixa frequência para gateway e destino público, registrando
   RTT, jitter e perda. Fazer a medição de um celular por rede móvel em etapa
   separada, sem carga concorrente.
4. Em homologação autorizada, observar desconexões/reconexões do conector do
   túnel e testar uma transferência pequena controlada desde rede móvel. Não
   usar repetição agressiva, flood ou teste de estresse contra a internet.

Os resultados dessas medições continuam pendentes; não há capacidade de banda
residencial comprovada nesta auditoria.

## 3. RenoLink e requisitos de execução

Foram revisados os relatórios das Fases 8.3, 9 e 9.1, o `package.json`, os
modelos de staging e os arquivos de runtime/proxy. Nenhum teste foi repetido.
O registro da Fase 9 aponta 62/62 testes locais aprovados; é evidência
registrada, não execução desta auditoria. A Fase 8.3 registra 52 testes
aprovados e 18 cenários finais com 50 SSE cada. A Fase 9 também registra que o
HTTPS local passou, mas a conexão MySQL não usou TLS (`mysqlTlsValidated:
false`) e não houve validação de infraestrutura externa.

### Configuração de produção

O projeto requer Node 24.19 ou superior na linha 24 e MySQL 8.0.17+ ou 8.4.
O binário MySQL atual 8.0.46 atende à faixa registrada, mas ainda é necessário
verificar atualização suportada, TLS e banco de feira antes de escolher o
destino. A configuração de produção exige, entre outros:

- `NODE_ENV=production`, `STORAGE_DRIVER=mysql`, `APP_ORIGIN` como origem HTTPS
  canônica e `COOKIE_SECURE=1`;
- `MYSQL_SSL=1`, verificação de certificado e identidade do servidor
  (`rejectUnauthorized: true`, `verifyIdentity: true`); usar CA explícita
  quando necessária;
- `TRUST_PROXY=loopback`. Outros valores são recusados pela política de hosting;
- conexão Node em loopback, atualmente `127.0.0.1:3000`; pool MySQL de cinco
  conexões e fila de espera de até 100.

O executável `npm start` chama PowerShell com `-ExecutionPolicy Bypass`, e o
iniciador local usa procedimentos do banco de desenvolvimento e cofre DPAPI.
**Não usar `npm start`, `INICIAR_RENOLINK.ps1`, `mysql-dev.ps1` ou credenciais
locais para a instância da feira.** Planejar uma inicialização explícita de
`node server.js` com ambiente de produção, identidade de serviço e segredos
exclusivos. Nenhum segredo do projeto ou cofre foi lido.

O servidor tem encerramento em `SIGINT`/`SIGTERM`, fecha SSE e storage e possui
prazo de até 10 segundos antes de encerrar conexões. O comportamento real de
um supervisor de serviços Windows ao enviar esses sinais precisa ser ensaiado;
não se presume equivalência com o unit file systemd de staging.

### MySQL e isolamento de dados

O achado mais urgente é o listener atual em todas as interfaces, não somente
loopback. Antes de qualquer publicação, exigir revisão autorizada de bind e
firewall para que o MySQL de feira não seja exposto à LAN/internet.

Criar posteriormente uma instância lógica exclusiva, por exemplo
`renolink_fair`, sem importar JSONs, dumps, usuários, hashes, credenciais ou
administradores de `renolink_dev`/`renolink_test`. Usar conta runtime exclusiva
sem DDL e conta migradora separada, usada apenas numa janela aprovada. Um schema
separado na mesma instância protege contra mistura acidental, mas compartilha
serviço, CPU, memória, disco e risco de falha; avaliar MySQL isolado se o risco
de interferência não for aceitável. Não fazer migração automática no boot.
Provisionamento, contas, banco, TLS e migrations não foram criados/executados.

### Cloudflare Tunnel, proxy e IP real

O modelo de arquitetura é tecnicamente plausível: um conector iniciado no PC
estabelece conexão de saída com a Cloudflare e encaminha um hostname público
para `http://127.0.0.1:3000`; não é necessário abrir uma porta de entrada no
roteador para esse modelo. A terminação HTTPS pública ficaria na borda do
provedor, enquanto a conexão do conector à origem local pode ser HTTP em
loopback. Isso **não** equivale a teste nem significa que a aplicação fique
privada: o hostname torna as rotas encaminhadas acessíveis publicamente.

A integração do IP de cliente é uma pendência concreta. O middleware só aceita
proxy se o socket de origem for loopback e exige `X-Forwarded-For` contendo um
único endereço IP válido e `X-Forwarded-Proto: https`; ele usa esse IP para
contexto/limites e não lê `CF-Connecting-IP`. Um `X-Forwarded-For` com lista,
ausente ou malformado resulta em recusa. É necessário confirmar o formato real
que o conector envia, garantir que cabeçalhos trazidos pelo visitante não sejam
confiados e validar a origem HTTPS e cookies `Secure`. Não confiar cegamente
em cabeçalhos do cliente nem relaxar `TRUST_PROXY`; se a integração exigir
adaptação de código, revisar e testar antes de publicar.

Uma configuração de túnel nomeado, conta, domínio, DNS ou política de acesso
não existe nesta auditoria. Embora o túnel evite encaminhamento de portas, ele
não protege rotas da aplicação contra abuso, login automatizado, exploração de
vulnerabilidades ou negação de serviço.

### SSE

O servidor implementa SSE em `/api/events`, envia heartbeats a cada 15 s,
polling de estado a cada 1 s e limita a 100 conexões por processo (até 3 por
usuário). O Nginx de exemplo desativa buffering/cache/gzip e usa timeout SSE
de 75 s, mas **não há configuração Cloudflare Tunnel homologada**. Confirmar
que a resposta não é armazenada/bufferizada, que os heartbeats mantêm a conexão,
que `Last-Event-ID`/reconexão funciona e que eventos não cruzam usuários.
Limites e histórico SSE são locais ao processo; reinício encerra streams.

## 4. Segurança do PC principal

Hospedar a aplicação numa máquina de uso pessoal aumenta o impacto potencial
de falhas do servidor. Um processo Node comprometido executa com a identidade
Windows que o iniciou; privilégios do usuário pessoal podem dar acesso a
arquivos e sessões pessoais. O MySQL em wildcard aumenta a superfície local.
O túnel não abre o PC inteiro por si só, mas transforma a aplicação e todas as
rotas encaminhadas em alvo público.

### Estratégia proposta de menor privilégio

- Não executar aplicação, conector ou MySQL como Administrador nem como o
  usuário pessoal. Provisionar, somente após autorização, identidade de serviço
  local sem login interativo, perfil/mapeamentos pessoais e privilégios
  administrativos.
- Limitar ACLs NTFS do release a leitura/execução e conceder escrita apenas em
  diretórios dedicados para logs/temporários necessários. Não conceder acesso
  a documentos, perfil pessoal, pastas sincronizadas ou unidades de rede.
  Guardar segredos em local protegido acessível somente à identidade de serviço;
  nunca no release, Git, argumentos de processo ou logs.
- Separar a identidade e diretório de dados do serviço MySQL; limitar acesso de
  rede ao necessário e conta de aplicação ao schema da feira. A auditoria não
  alterou permissões nem inspecionou arquivos pessoais.
- Servir somente a allowlist estática do aplicativo; não expor raiz do projeto,
  relatórios de auditoria, backups, logs, `.env`, `.clixml`, certificados
  privados ou dados locais. Usar hostname/ingress único e sem fallback para
  serviços genéricos.
- Manter rate limiting e controles atuais, atualizar dependências e limitar
  a exposição de rotas administrativas. Definir alerta, logs com rotação e
  resposta a incidente. Logs não devem conter corpos, mensagens, cookies,
  tokens, senhas, strings de conexão, IPs desnecessários ou conteúdo pessoal.

O Windows 10 fora do suporte regular é um bloqueio de segurança independente
da configuração da aplicação. Verificar elegibilidade/estado de ESU e planejar
uma plataforma ainda suportada antes de expor o servidor. Não foi feita essa
verificação de conta nem qualquer mudança do sistema.

### Logs e backups

O modelo de staging prevê saída estruturada JSON, sem access log Nginx e com
log de erro restrito; isso é apenas template Linux, não política pronta para
Windows. O logger da aplicação registra método, rota normalizada, status,
duração e ID de requisição, sem corpo; outros logs/runtime ainda precisam ser
revisados no release final. Definir ACLs, rotação, retenção curta, monitoramento
e acesso restrito; nunca confiar em arquivos `stdout` sem política de retenção.

Backup da feira deve ser criptografado, ter cópia fora do PC e não incluir
segredos em claro. Ensaiar restauração em banco novo e isolado. Backup somente
no mesmo disco não protege contra falha, ransomware, furto ou perda do PC.
Nenhum backup ou restore da instância da feira foi criado/testado.

## 5. Capacidade preliminar — não comprovada

A Fase 8.3 mediu localmente um i7-7700, 8 processadores lógicos, 31,93 GiB,
Node 24.19 e MySQL 8.0.46; as especificações do PC atual coincidem. Foram
ensaios de loopback com MySQL local. Isso melhora a comparabilidade de hardware,
mas não inclui o túnel, internet residencial, carga variável desta sessão,
tráfego público sustentado nem teste de várias horas.

No perfil padrão de quatro threads, 50 logins simultâneos tiveram p95 de
aprox. **4,39 s**; no cenário misto C, que reuniu 10 cadastros, 20 logins e
20 sessões, o p95 global foi aprox. **2,18 s**, enquanto as 20 operações de
login nesse cenário tiveram p95 aprox. **3,51 s**. Cenários locais mantiveram
50 SSE durante ao menos 15 s e passaram sem erros HTTP inesperados/queda de
stream. Isso não equivale a 50 visitantes sustentados. O perfil de oito threads
não é recomendação de produção: melhora alguns picos de login, aumenta memória
e piorou o p95 global misto nas duas rodadas realistas.

| Visitantes | Risco preliminar | Evidência e interpretação |
|---:|---|---|
| 10 | Baixo a moderado, **estimativa** | Abaixo das populações de cenários locais; não houve ensaio específico de 10 usuários atrás de túnel nem por período prolongado. Login simultâneo continua sujeito ao custo de scrypt. |
| 25 | Moderado, **estimativa** | Intermediário entre as observações; não há benchmark específico de 25. Uma rajada de cadastro/login pode causar latência mesmo se navegação/SSE forem leves. |
| 50 | Alto para aceitação pública sem homologação | Navegação/SSE curta passou localmente, porém logins concorrentes tiveram p95 perto de 4,4 s e não há ensaio sustentado de uma hora com túnel, rede móvel e concorrência real. Não declarar capacidade para 50. |

Essas classificações são avaliação de risco, não metas/SLO nem medição de
capacidade. A banda de upload da fibra, o limite físico do link Ethernet
100 Mbps, estabilidade, latência externa, CPU/RAM durante uma feira e efeito
do Cloudflare Tunnel permanecem desconhecidos.

## 6. Checklist de implantação — somente após autorização

### Ambiente independente

- [ ] Resolver primeiro o suporte do Windows; preferir máquina/OS suportado e
      dedicado, ou comprovar atualização/ESU aplicável.
- [ ] Criar release imutável separado, conta de serviço limitada, diretórios
      exclusivos e segredos novos. Revisar histórico Git do release e pacote.
- [ ] Provisionar banco `renolink_fair` e contas runtime/migradora exclusivas;
      conferir que nenhuma configuração aponta para `renolink_dev` ou
      `renolink_test`. Gerar apenas dados fictícios e revisar aviso de privacidade.
- [ ] Confirmar TLS e hostname MySQL, bind/firewall restritos, permissões
      mínimas e ausência de migrações automáticas no boot.

### Backup, recuperação e operação

- [ ] Definir RPO/RTO, retenção, criptografia e cópia independente do PC.
- [ ] Fazer backup inicial e ensaiar restauração em banco vazio separado antes
      de aceitar dados da feira; nunca restaurar sobre dev/test.
- [ ] Escolher supervisor Windows apropriado, testar início após boot, restart
      controlado, logs com rotação, parada graciosa de SSE/Node e desligamento.
- [ ] Planejar alimentação contínua/UPS, atualizações e reinício fora da feira.
      Mudanças de energia/sistema exigem autorização e janela.

### HTTPS, túnel e celulares

- [ ] Autorizar domínio/conta e criar um túnel **nomeado**; proteger token e
      limitar o ingress a um único hostname e a `127.0.0.1:3000`.
- [ ] Não abrir portas no roteador nem publicar MySQL; revisar regras existentes
      antes de ativação. Testar HTTPS público, origem, Host, `X-Forwarded-For`,
      `X-Forwarded-Proto`, IP real e cookies `Secure`/`HttpOnly`/`SameSite`.
- [ ] Verificar TLS no navegador e comportamento em Android/Chrome e
      iPhone/Safari físicos, incluindo Wi-Fi e dados móveis, suspensão da aba,
      troca de rede, perda de conexão e retorno.
- [ ] Testar SSE por uma hora com heartbeat/reconexão e isolamento de eventos,
      primeiro com poucos clientes e depois com 10/25/50 gradualmente. Confirmar
      ausência de buffering e documentar limites/erros sem contorná-los.

### Carga, monitoramento e contingência

- [ ] Medir upload/latência/estabilidade em janela acordada, sem carga durante
      a feira. Repetir benchmarks com contas fictícias e carga realista no
      caminho PC–túnel–celular; não assumir o resultado de loopback.
- [ ] Definir limites de aceite para p95/p99, 5xx/429/503, RAM/CPU, disco,
      conexões SSE, event loop, fila de hash, pool MySQL e reconexões.
- [ ] Alertar operador para falha do Node/MySQL/túnel, disco baixo, backup
      vencido e degradação de rede. Não registrar credenciais ou conteúdo.
- [ ] Preparar plano para queda de energia, PC, ISP, Cloudflare, domínio ou
      MySQL: suspender novos cadastros, comunicar indisponibilidade, demonstrar
      uma cópia local sem interação remota ou usar conectividade/dispositivo
      alternativo previamente homologado. Não fazer failover improvisado para
      `renolink_dev`.

## 7. Pendências e ações que exigem autorização

1. Decidir se o PC principal é aceitável para exposição pública; resolver
   suporte/atualização do Windows 10 e verificar a elegibilidade ESU.
2. Autorizar revisão e posterior restrição de bind/firewall do MySQL. O listener
   atual em `0.0.0.0`/`[::]` deve ser tratado como risco até prova de isolamento.
3. Aprovar criação de identidade de serviço, ACLs, banco/contas independentes,
   certificados e local de segredos; nenhum foi criado ou alterado.
4. Aprovar eventual conta/domínio Cloudflare, túnel nomeado, DNS, políticas de
   acesso e publicação. Não foram criados recursos externos nem contratados
   serviços. Custo total não foi cotado; domínio, energia, backup e conectividade
   podem gerar custos mesmo sem hospedagem mensal.
5. Aprovar janela de testes externos e critérios de carga/SSE em dados fictícios,
   celulares físicos, conexão móvel e eventuais testes de upload.
6. Definir backup, RPO/RTO, operador, alertas, resposta a incidente e plano de
   contingência da feira.

## Estado desta auditoria

Realizadas consultas locais somente de leitura a hardware, sistema, versões,
processos, serviço MySQL, energia, interfaces/rotas e sockets; revisado o
código e os relatórios das Fases 8.3, 9 e 9.1. Não foi conectada a base,
consultado o roteador/firewall, acessado o cofre, instalado software, alterado
configuração, criado banco/conta/túnel/DNS, contratado serviço ou publicado o
site. Não foram repetidos testes do projeto nem executado teste de carga na
internet. **Hospedagem não homologada.**
