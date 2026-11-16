# RenoLink — preparação de hospedagem para a feira

Revisão: 26/10/2026. Plano técnico; nenhum serviço contratado ou sistema publicado.

## Arquitetura recomendada para homologação

Uma instância Node.js sempre ligada, supervisionada por systemd ou equivalente,
atrás de NGINX com HTTPS, e MySQL persistente em rede privada. Começar a homologação
com 4 vCPU/4 GiB para a aplicação é uma hipótese de dimensionamento, não capacidade
comprovada: o teste local de 50 visitantes ainda apresentou p95 de 12,47 s.
Repetir carga no ambiente escolhido antes de aceitar essa configuração.

Preferir MySQL gerenciado, com versão compatível com as verificações do projeto,
TLS com CA e hostname verificados, armazenamento persistente, backups automáticos
e recuperação pontual. RDS é uma opção a cotar, não uma escolha contratada.
[A documentação do RDS descreve backups e recuperação dentro da retenção](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html).
Validar o uso de GET_LOCK com a conexão direta; não introduzir proxy que troque a
conexão durante uma transação. Não expor a porta 3306 à internet.

Evitar serviços que adormecem durante a feira: por exemplo, o plano gratuito do
Render suspende o serviço após 15 minutos sem tráfego e precisa iniciá-lo novamente.
[Limitações oficiais do plano gratuito](https://render.com/docs/free).

## Ajustes necessários antes de publicar

- Executar `node server.js` no serviço Linux. O iniciador atual usa PowerShell e
  o cofre local usa DPAPI do Windows; não são o procedimento de implantação Linux.
- Manter inicialmente um processo Node. Locks de escrita são compartilhados pelo
  MySQL, mas limites de abuso e histórico de SSE são locais a cada processo.
- Configurar `STORAGE_DRIVER=mysql`, `NODE_ENV=production`, `APP_ORIGIN` com a origem
  HTTPS exata, `COOKIE_SECURE=1`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`,
  `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_SSL=1` e `MYSQL_SSL_CA` conforme o provedor.
  Fornecer segredos pelo gestor de segredos do serviço, sem colocá-los no Git,
  comandos, imagens, QR Code ou logs. Não copiar credenciais de teste.
- Usar conta de aplicação sem DDL; conta migradora só durante migrações aprovadas.
  O provisionamento público será separado das contas e privilégios locais atuais.
- Node já escuta em loopback: NGINX no mesmo host pode encaminhar para ele.
  Plataforma de contêiner que exija `0.0.0.0` precisará de ajuste revisado do bind.
- Preservar Host no proxy para a validação de origem. Implementar e testar confiança
  apenas nos IPs do proxy conhecido antes de usar IP encaminhado nos limites.
  Atualmente usa-se o IP do socket: atrás do proxy todos podem compartilhar a cota.
  Nunca confiar cegamente em X-Forwarded-For fornecido por visitantes.
- Para `/api/events`, desabilitar cache e buffering e definir timeout superior ao
  intervalo de heartbeat. Evitar compressão que retenha frames. Homologar o caminho
  completo com HTTPS, proxy e rede móvel; não repetir POST automaticamente.
  [Diretivas oficiais do NGINX](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
- Servir fontes e ícones localmente, ou testar a experiência com os CDNs bloqueados.
  O layout usa fontes alternativas e os rótulos da navegação permanecem visíveis.
- Aplicar a lista pública de arquivos do servidor, nunca servir a pasta do projeto
  diretamente. Manter backups, cofre, scripts, relatórios internos e JSON fora do
  diretório público do proxy. Validar `/api/health` sem retornar detalhes do banco.

## Recuperação, observabilidade e disponibilidade

Proposta: retenção diária de 14 dias, cópia criptografada independente e backup antes
de cada atualização. Incluir estrutura, dados e instruções de restauração. Medir
RPO e RTO em ensaio autorizado de restauração em base separada; não restaurar sobre
`renolink_dev`. Metas iniciais propostas: RPO até 1 hora e RTO até 30 minutos,
dependentes do serviço contratado e do ensaio. Não foram demonstradas nesta fase.

Monitorar HTTP 5xx/429, p95 por rota, conexões SSE, reconexões, memória, CPU, atraso
do event loop, pool MySQL, tempo de transação, disco e idade do último backup.
Alertas devem chegar ao operador da feira. Não registrar corpos, mensagens,
senhas, cookies, tokens ou strings de conexão. Logs devem ter rotação, retenção
limitada e acesso restrito. O log atual de falha é genérico e precisa de correlação
e métricas antes da operação pública.

Configurar reinício supervisionado do Node, manutenção fora do horário da feira,
release anterior disponível e procedimento de rollback de código compatível com
o banco. Não fazer migrações automáticas no boot. Um único Node continua sendo
ponto de falha durante reinícios; alta disponibilidade exigirá desenho adicional.

Registrar domínio somente após escolha e autorização. Gerar QR Code apenas para
a URL HTTPS definitiva, verificando-a em celular com dados móveis. `localhost` e
`127.0.0.1` não dão acesso ao computador do estande a partir de outros aparelhos.
Preparar Wi-Fi do estande, conexão móvel de reserva, energia e operador responsável.
Uma apresentação de contingência pode usar a instalação local no próprio computador;
isso não permite interação remota dos visitantes.

## Critérios propostos para liberar a demonstração

- [ ] Resolver latência de rajadas de 25/50 cadastros e logins. Meta proposta:
  p95 até 3 s nas ações e atualização visível em até 3 s, aferida no ambiente real.
- [ ] Homologar 50 visitantes por período prolongado, com navegação e rede variáveis;
  os testes atuais são rajadas curtas e não um ensaio de várias horas.
- [ ] Validar HTTPS, cookies Secure, origem e SSE através do proxy.
- [ ] Validar iPhone/Safari, Android/Chrome e Opera em aparelhos físicos, teclado,
  rotação, toque, suspensão da aba, perda de Wi-Fi e retorno ao aplicativo.
- [ ] Testar recuperação de backup, reinício supervisionado e indisponibilidade.
- [ ] Revisar aviso de privacidade, finalidade/coleta mínima e contato da equipe.
- [ ] Conferir acesso da equipe, sem criar novas permissões nesta fase.
- [ ] Congelar release, verificar backup, URL e QR Code na véspera e antes da abertura.
- [ ] Definir operador, canal de suporte e procedimento de contingência do estande.

Nenhum item deste plano autoriza publicação, alteração de schema, criação de contas
ou contratação. Essas ações continuam pendentes de autorização específica.
