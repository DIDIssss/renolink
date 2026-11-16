# RenoLink — Fase 7: atualizações em tempo real

Data: 26/10/2026, America/Sao_Paulo.

## Resultado

SSE implementado e ativado localmente. Visitantes e equipe recebem atualizações
automáticas de ideias, aprovação/rejeição, atendimento, solicitações e negociações.
Nenhuma migração de schema foi necessária. Nenhuma conta administrativa ou
credencial foi modificada. Testes com escritas ocorreram somente em renolink_test.

Aplicação: http://127.0.0.1:3000. Atualize uma vez as abas já abertas para carregar
os scripts desta fase. Cookies HttpOnly e sessões existentes foram preservados.
O endpoint /api/features confirma `realtime: sse`. O processo foi iniciado com
renolink_app em loopback (PID observado 9520); não havia listener na porta antes.
MYSQL80 continua Running e não foi reiniciado. Nada foi publicado.

## Arquitetura e escolha da tecnologia

O servidor Node HTTP já recebe todas as gravações por POST e só responde depois
do commit. O adaptador usa MySQL, transações e um GET_LOCK compartilhado entre
os processos participantes. O frontend atualiza áreas por consultas HTTP.

| Alternativa | Avaliação para a RenoLink |
| --- | --- |
| WebSocket | Canal bidirecional útil para alto volume, mas exigiria protocolo de reconexão, mensagens, heartbeat e autorização adicional sem necessidade de novo canal de escrita. |
| SSE | Canal HTTP unidirecional suficiente para avisar mudanças, com EventSource nativo, cookie de mesma origem, retry e Last-Event-ID. Mantém as rotas transacionais existentes. |

Foi escolhido SSE sem novas dependências de runtime. O canal envia somente
invalidações com nomes de tópicos, nunca textos de mensagens, propostas, e-mails,
tokens, IDs de entidades ou listas de participantes. As telas continuam a obter
os dados por endpoints que validam autorização no backend.

Referências primárias:
[WHATWG — Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
e [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

## Entrega, privacidade e reconexão

- GET /api/events exige sessão válida e mesma origem. Não aceita escolha de
  usuário/canal pelo navegador. Não utiliza token em URL ou localStorage.
- O servidor calcula fingerprints das visões autorizadas: ideias próprias e
  públicas para o visitante; propostas completas somente para admin; atendimento
  próprio para visitantes e caixa da equipe para membros autorizados; solicitações
  e negociações apenas dos participantes. Support não recebe ideias, usuários,
  negociações ou auditoria da administração.
- Sessão e papel ativo são revalidados em cada consulta. Sessão revogada/expirada
  encerra o canal; alteração de papel exige nova autorização/navegação.
- Uma única leitura compartilhada do armazenamento por servidor a cada segundo,
  somente enquanto há assinantes. O mesmo resultado atende as conexões daquele
  ciclo, com fingerprint calculada uma vez por usuário/papel.
- POST concluído com sucesso agenda uma verificação rápida após o commit.
  Operações recusadas/revertidas não publicam alterações inexistentes.
- A leitura periódica detecta commits feitos por outro processo Node ou operador
  participante sem exigir tabela de eventos, trigger ou mudança de schema.
- EventSource reconecta automaticamente com retry de 2 segundos e Last-Event-ID.
  O histórico em memória é segregado por usuário/papel, até 100 eventos por chave
  com retenção de cinco minutos. IDs têm prefixo aleatório por chave, sem sequência
  global que revele atividade de outros usuários.
- Cursor desconhecido, histórico expirado ou reinício de servidor resultam em
  reset da visão autorizada, recuperada pelas rotas HTTP/MySQL. Cursor de outro
  usuário nunca permite acessar seu histórico.
- O cliente ignora IDs já recebidos e agrupa tópicos por 150ms, serializando suas
  atualizações. Renderiza snapshots, sem acrescentar mensagens duplicadas.
- Heartbeat de 15 segundos, controle de backpressure e liberação ao fechar a aba.
  Limites: 100 conexões por servidor e três por usuário. Timers param sem assinantes.
- O fechamento do servidor encerra SSE antes de aguardar as conexões HTTP,
  permitindo o encerramento/reinício do processo.

## Experiência de uso

Status discreto de conexão/reconexão e indicadores de atualizações em mensagens
e solicitações. O menu da equipe e a navegação mobile mantêm a identidade visual.
O catálogo, área pessoal, detalhe, negociações e atendimento atualizam somente
quando os tópicos relevantes mudam. As listas administrativas preservam filtros.

Rascunhos de mensagens da equipe e do visitante são preservados. Durante uma
moderação ou seleção de etapa, alterações não sobrescrevem silenciosamente o
formulário; continuam sujeitas ao controle de versão do backend. Abas ocultas
agrupam invalidações e recuperam o estado quando voltam ao primeiro plano.
Botões manuais de atualização continuam disponíveis.

Foi corrigida uma corrida de inicialização do botão de solicitação: ele agora
fica desabilitado até a autorização e o handler estarem prontos. A re-renderização
não instala múltiplos listeners de interesse ou filtros.

## Testes aprovados

| Cenário | Resultado |
| --- | --- |
| npm.cmd test | 29 testes aprovados: 28 anteriores e suíte SSE |
| Sessão ausente, origem externa, cursor inválido | Canal recusado |
| Dois visitantes e administrador | Sessões e contextos independentes |
| Ideia privada | Autor e admin recebem atualização; visitante não envolvido não recebe evento |
| Aprovação/rejeição | Status e parecer atualizados no autor sem recarregar a página |
| Mensagens privadas | Entrega bidirecional automática; outro visitante não recebe evento/conteúdo |
| Solicitações | Nova linha no admin e etapas atualizadas para o solicitante |
| Negociação anterior | Etapa chega automaticamente às partes autorizadas |
| Reconexão | Last-Event-ID usado após offline e reinício do Node; reset recupera estado persistido |
| Replay | Eventos retomados após interrupção; cursor de outro usuário recebe somente reset próprio |
| Duplicação | Evento repetido injetado não gerou carga HTTP adicional; mensagem apareceu uma vez |
| Rascunhos | Texto preservado durante chegada de novas mensagens |
| Revogação de sessão/papel | Canal encerrado; não continua recebendo tópicos privilegiados |
| Limites e falhas de escrita | Quarta conexão recusada; operação inválida não gerou evento |
| Escrita em outro processo | Admin no processo A recebeu commit feito pelo visitante no processo B |
| Persistência MySQL | Mensagem gravada durante offline recuperada após novo processo |
| Histórico sintético anterior | Registros anteriores de todas as coleções preservados |
| Chrome desktop/mobile emulado | Fluxo completo aprovado; sem overflow horizontal ou erros JS |

O teste isolado real usou MySQL/renolink_tester, dois processos Node e três
contextos Chrome: admin 1440×1000, visitante 390×844 e visitante 1280×900.
Somente as fixtures novas receberam autenticação e gravações de teste. As
credenciais e a associação do administrador real não foram usadas ou alteradas.

As primeiras execuções do navegador encontraram a corrida do botão de solicitação
durante a atualização do detalhe. A correção foi aplicada e o teste completo
subsequente passou. As falhas e fixtures dessas execuções ficaram restritas ao
banco de testes, sem reset ou exclusão.

Relatório: `renolink_funcional/data/runtime/phase7-test-report.json`.
Capturas:
[admin](../renolink_funcional/data/runtime/phase7-preview/admin-live.png) e
[visitante mobile](../renolink_funcional/data/runtime/phase7-preview/visitante-mobile-live.png).

## Preservação do ambiente principal

Snapshots somente de leitura com renolink_app antes/depois dos testes e da
inicialização local confirmaram igualdade exata:

- Estado completo: `d4aa473fb74eb3cd7a676785bda116f2d7b0c402ca99dd551c211722a12fa241`.
- Schema: `6c3b6aa742d9cc5e66f6d0e07061c661c89a88d59a216ec81b99068755c9f59e`.
- Equipe: `9d41dd52adc7ab7aeea30b9b261b7f0b94d1cff02f4dc8a571e928cf6ab13a63`.

Contagens existentes preservadas: seis usuários, dez ideias, sete mensagens,
uma negociação, quatro sessões, uma associação de equipe, uma conversa,
uma mensagem de atendimento, nenhuma solicitação e três eventos de auditoria.
São dados já existentes, não fixtures criadas por esta fase.

Evidências: phase7-dev-before.json e phase7-dev-after.json em data/runtime;
o relatório posterior contém `unchanged: true`. JSONs originais preservados.
Nenhum schema, conta, credencial ou dado principal foi alterado.

## Arquivos

Adicionados: lib/realtime.js; assets/js/realtime.js; test/realtime.test.js;
test/fixtures/events.js; test/phase7.browser.js; scripts/test-phase7.ps1;
scripts/phase7-dev-snapshot.js; auditoria/FASE_7.md.

Alterados: server.js; lib/phase5.js; assets/js/app.js; assets/js/admin.js;
assets/css/phase5.css; package.json; README.md. As páginas HTML existentes e
administrativas passaram a carregar realtime.js antes do script de cada portal;
ideia.html também inicia o botão de solicitação desabilitado.

## Limites e pendências

- Opera não está instalado nesta máquina. A compatibilidade usa EventSource e
  APIs web padrão; o ensaio nativo no Opera permanece pendente. O teste mobile
  foi emulação Chrome, não execução em aparelho físico ou Safari/iOS.
- O canal é de invalidação de estado, não uma fila durável de notificações ou
  comprovante de leitura. Após reinício/perda de histórico, recupera o estado
  final pelo MySQL, sem prometer reproduzir cada transição intermediária.
- A persistência é das operações de negócio, não dos eventos SSE. A latência
  esperada inclui o intervalo de até um segundo, consultas e atualização da tela.
- O adaptador atual lê o conjunto de dados. Carga elevada, múltiplas réplicas,
  proxy/TLS de hospedagem e dimensionamento da feira precisam de ensaio próprio;
  esta fase não publicou nem configurou infraestrutura externa.
