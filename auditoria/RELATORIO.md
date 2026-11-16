# Auditoria inicial da RenoLink

Data: 23/10/2026. Escopo: análise do código, execução local, testes HTTP e persistência em cópia isolada. Nenhuma publicação ou alteração no código da aplicação.

## Parecer

A RenoLink é um protótipo local com fluxos reais de persistência. A base visual e as páginas podem ser preservadas. Ainda não está pronta para receber visitantes simultaneamente ou dados reais pela internet: foram reproduzidas exposição do banco e perda de gravações concorrentes. Também faltam administração da RenoLink, aprovação de ideias, conversas direcionadas e acompanhamento em tempo real.

## Estrutura e tecnologias

| Parte | Implementação atual |
| --- | --- |
| Páginas públicas | `index.html`, `empresa.html`, `explorar.html`, `ideia.html` |
| Autenticação | `cadastro.html`, `login.html` |
| Área autenticada | `dashboard.html`, `nova-ideia.html`, `mensagens.html`, `negociacoes.html` |
| Comportamento frontend | `assets/js/app.js`: Fetch, eventos DOM, sessão em localStorage, renderização por página |
| Visual | `assets/css/style.css`, logo SVG, fonte Inter e Font Awesome externos |
| Backend | `server.js`: Node.js, módulos nativos HTTP, fs, path, crypto e URL; API e arquivos estáticos no mesmo servidor |
| Persistência | `data/db.json`: usuários, ideias, sessões, negociações, mensagens e contadores de IDs |
| Dados de demonstração | `data/db.seed.json` |
| Inicialização | `INICIAR_RENOLINK.bat`, `INICIAR_RENOLINK.ps1`, `npm start` |
| Restauração destrutiva | `reset-db.js`, `RESETAR_BANCO.bat`: substituem o banco pelo seed. Não executados |

O banco original contém 4 usuários, 9 ideias, 7 mensagens, 1 negociação e nenhuma sessão no início da auditoria. Há registros além das contas de demonstração. Não há banco SQL, ORM, framework de frontend, serviço de notificações, painel administrativo ou infraestrutura de hospedagem no material analisado.

## Ambiente e execução

- Node.js disponível: `v24.19.0`; npm disponível: `11.17.0` via `npm.cmd`.
- `package.json` não declara dependências ou devDependencies. Não foi necessário instalar pacotes; não foi gerado lockfile artificialmente.
- `npm` diretamente no PowerShell encontra bloqueio da política de scripts em `npm.ps1`. Usar `npm.cmd start` ou `node server.js` funciona sem mudar a política do Windows.
- `node --check server.js` e `node --check assets/js/app.js` concluíram sem erros de sintaxe.
- Servidor original iniciado em `http://localhost:3000`, com escuta exclusiva em `127.0.0.1`.
- Não está acessível aos celulares da rede nessa configuração. Isso foi mantido nesta etapa.
- A saúde foi verificada por `/api/health`. Para reiniciar: abrir a pasta `renolink_funcional` no terminal e executar `node server.js`.
- O processo desta auditoria fica em execução enquanto a sessão de terminal permanecer ativa. Encerrar com Ctrl+C no terminal correspondente.

## Método e evidências

O script `testar.cjs`, fora da raiz servida da aplicação, copia o projeto para uma pasta temporária, inicia o servidor copiado em porta local livre, executa os cenários e encerra somente esse processo de teste. As escritas ocorrem exclusivamente na cópia. O SHA-256 do banco original foi comparado antes e depois e permaneceu igual.

Executar novamente a partir de `D:\Downloads\renolink`: `node auditoria/testar.cjs`.

Os 40 registros em `resultados.json` foram confirmados. Esse número inclui entregas de arquivos e reproduções de defeitos: **não significa 40 aprovações de segurança**. Os registros com `FALHA:` representam problemas reproduzidos, e `ok: true` nesses registros significa que a reprodução funcionou.

A cópia temporária é conservada, sem exclusões, e seu caminho está no arquivo de resultados. Ela contém cópia dos dados locais e dados sintéticos de teste; não deve ser publicada. O relatório não transcreve dados pessoais, tokens, hashes de senhas ou conteúdo das mensagens existentes.

| Fluxo | Resultado observado |
| --- | --- |
| Entrega do frontend | As 10 páginas HTML, CSS, JS e logo responderam HTTP 200 |
| Cadastro | Criador e empresa cadastrados; duplicidade recusada com 409; resposta omite hash e salt |
| Login | Credenciais válidas aceitas; senha errada recusada com 401; `/api/me` reconhece sessão |
| Logout | Token deixa de autenticar após saída |
| Ideia | Criação retorna 201, persiste e aparece na listagem do autor, inicialmente em análise |
| Publicação | Nova ideia não aparece na listagem pública; não existe fluxo de aprovação. Interesse de empresa altera o status e a torna pública sem revisão |
| Mensagens | API envia, persiste e entrega ao destinatário correto; vazio recusado; leitura filtrada por participante |
| Negociações | Interesse cria negociação, visível aos participantes; repetição reutiliza registro |
| Isolamento parcial | Terceiro não lê mensagens/negociações alheias pelas respectivas listagens; anônimo recebe 401 nessas rotas |
| Concorrência | Duas criações simultâneas retornaram 201 e o mesmo ID 11; somente uma das duas foi persistida |
| Preservação | Banco original permaneceu byte a byte equivalente pelo hash |

Os testes funcionais foram executados diretamente pela API. A análise do frontend incluiu leitura dos fluxos, responsividade declarada e entrega HTTP; **não houve automação de navegador, cliques reais, inspeção visual em celular nem teste de acessibilidade assistiva**. Não foram feitos testes de carga representativos da feira, reinicialização com recuperação de falha, envio de e-mail ou validação de serviços externos. O teste concorrente reproduz um defeito de integridade, não mede capacidade máxima.

## Problemas encontrados

### P0 — Bloqueadores para uso real

1. **Exposição integral do banco no Windows.** `server.js:304` bloqueia o texto minúsculo `data`, mas o sistema de arquivos aceita variantes de caixa. Na cópia, `/data/db.json` retornou 403 e `/DATA/db.json` retornou 200 com o banco completo. Isso expõe usuários, hashes de senha, mensagens e eventuais tokens. O servidor também entrega `/server.js`. Correção: servir apenas páginas e assets explicitamente permitidos, mantendo banco e código fora da área pública; testar variantes de caixa, caminhos codificados e travessia.

2. **Perda de dados com usuários simultâneos.** `server.js:102` lê um snapshot antes de aguardar o corpo da requisição; `writeDb` regrava o arquivo inteiro sem transação. Dois pedidos podem ler os mesmos contadores e a gravação posterior sobrescrever a anterior. Reprodução: 2 respostas 201, mesmo ID e apenas 1 ideia salva. A escrita síncrona não impede a disputa entre snapshots. Correção: persistência transacional com unicidade e integridade referencial; migrar os registros existentes com conferência e backup. O arquivo também é sobrescrito diretamente, sem substituição atômica ou recuperação de interrupções.

3. **Ideias em análise expostas e aprovação contornável.** `/api/ideas` sem filtros e `/api/ideas/:id` entregam ideias não públicas a anônimos. A rota de interesse não exige status público e transforma uma ideia em análise em `Empresa interessada`, incluindo-a no marketplace. Correção: impor visibilidade no backend e separar publicação de interesse comercial.

### P1 — Segurança, operação e adequação ao negócio

4. **RenoLink não tem perfil administrativo.** Só existem `creator` e `company`; qualquer visitante pode cadastrar uma empresa. Não há equipe autorizada a aprovar ideias, atender visitantes ou gerenciar negociações. A empresa demo não equivale a administração. Criar permissões próprias da equipe, sem atribuição pública de privilégios.

5. **Mensagens do frontend têm destinatários fixos.** `assets/js/app.js:364` envia sempre ao usuário 1 para empresas e ao usuário 2 para criadores. Uma empresa nova não responde necessariamente ao visitante que a contatou. A tela mistura mensagens sem organizar conversas; não há ligação com negociação nem escolha de destinatário. A API permite mensagem a qualquer ID existente, mesmo sem relação prévia, comportamento reproduzido. Definir atendimento à RenoLink e conversas autorizadas por participante.

6. **Sem acompanhamento em tempo real.** As telas carregam dados na abertura. Mensagens só são recarregadas na própria sessão após envio; destinatário e equipe não recebem atualizações automáticas. Implementar atualização incremental e estados de conexão, conforme o modelo de atendimento.

7. **Negociação incompleta.** Existe registro inicial de interesse e consulta, mas não há proposta, resposta, aceite, recusa, encerramento ou histórico de mudanças. Contar qualquer status como negociação ativa também não representa o andamento real. Definir etapas e transições permitidas antes de ampliar a interface.

8. **Autenticação insuficiente para exposição pública.** Senhas usam SHA-256 simples com salt (`server.js:59`); sessões ficam em texto no JSON, sem expiração verificada, e tokens ficam em localStorage. Login remove todas as sessões anteriores do usuário. Não há limite de tentativas, recuperação de senha, verificação de e-mail ou proteção operacional contra abuso. Planejar hash de senha com custo apropriado, sessões expirantes/revogáveis e transporte seguro. A presença de `escapeHtml` nas renderizações é positiva, mas não certifica ausência de XSS.

9. **Redirecionamento de login sem restrição.** `assets/js/app.js:144` atribui diretamente o parâmetro `redirect` a `location.href`. Permite direcionar o usuário a destino externo após login, conforme análise estática. Restringir a páginas internas conhecidas. Não foi executado redirecionamento externo durante a auditoria.

10. **Validações frágeis e erros genéricos.** Backend aceita `invalido@` como e-mail; categoria e participação não são validadas contra opções conhecidas; campos não têm limites individuais. JSON inválido resulta em erro interno genérico e o limite de corpo destrói a conexão, sem resposta 413 controlada. Melhorar contratos, limites e mensagens, além de prevenção de spam.

11. **Navegação mobile incompleta.** No CSS abaixo de 650px, `.sidebar` recebe `display: none`; as páginas internas não oferecem navegação móvel substituta. Isso dificulta acessar mensagens, negociações e sair pelo celular. Preservar o visual e adicionar navegação móvel acessível. Necessária validação visual posterior em dispositivos.

12. **Persistência e operação sem controles.** Não há backup/restauração verificados, migrações, trilha de auditoria, política de retenção ou observabilidade operacional. O reset substitui todos os dados sem confirmação no script Node. Não usar reset no ambiente com usuários reais; preparar cópia verificável e recuperação antes da migração.

### P2 — Qualidade e apresentação

13. **Indicadores artificiais.** `/api/stats` soma 33 às empresas e 11 às negociações. Na base original, os números seriam 35 empresas e 12 negociações, embora existam 2 e 1. A contagem de ideias também inclui as não públicas. Usar métricas reais e distinguir demonstração de operação.

14. **Internet necessária para fontes e ícones.** HTML referencia Google Fonts e CDN do Font Awesome; o backend não depende deles, mas a apresentação pode degradar sem conexão. Validar fallback e disponibilização de assets para a feira.

15. **Tratamento de erros de interface incompleto.** Dashboard não captura falhas das consultas em `loadDashboard`; uma falha pode deixar carregamento incompleto. A hidratação privada trata indisponibilidade como sessão inválida e pode deslogar o visitante. Mensagens não bloqueiam duplo envio. Acrescentar estados de erro, repetição e confirmação de envio.

16. **Conteúdo ainda de protótipo.** Há rótulos de demonstração e oportunidades sem autor cadastrado; estas recusam negociação pela API. Revisar os textos e separar conteúdo demonstrativo antes da apresentação real.

## Plano de correção proposto

| Ordem | Entrega | Critério de conclusão |
| --- | --- | --- |
| 1 | Bloquear exposição de dados e corrigir autorização das ideias | Somente assets públicos acessíveis; nenhuma ideia privada lida por terceiro; interesse não aprova conteúdo |
| 2 | Introduzir banco transacional e migrar sem perda | Cópia preservada, contagens e relações conferidas; criações concorrentes com IDs únicos e todos os registros persistidos; recuperação validada |
| 3 | Fortalecer autenticação e validações | Sessões com ciclo de vida definido, privilégios restritos, validações no servidor e testes de abuso/negação de acesso |
| 4 | Criar administração RenoLink e aprovação | Equipe autorizada revisa ideias e atende visitantes; visitante não obtém papel administrativo |
| 5 | Corrigir conversas e negociação | Mensagens chegam ao participante correto; lista por conversa; etapas comerciais e histórico verificáveis |
| 6 | Atualizar dados em tempo real e concluir navegação mobile | Dois celulares e painel da equipe refletem ações; navegação interna e saída disponíveis no celular; reconexão tratada |
| 7 | Preparar apresentação e operação | Métricas reais, textos revisados, erros claros, backup recuperável e teste de carga conforme público esperado |
| 8 | Planejar hospedagem em etapa posterior | Definir ambiente, armazenamento persistente, HTTPS e monitoramento; publicar somente quando autorizado |

Preservar HTML, componentes visuais, logo, paleta, funcionalidades úteis e todos os registros durante a evolução. Mudanças de arquitetura devem ser incrementais e acompanhadas de migração verificável. Dimensionar o teste de carga após estabelecer o número esperado de visitantes simultâneos e a rede disponível na feira.

## Entregas desta etapa

- Aplicação executada localmente, sem publicação.
- Auditoria e plano neste documento.
- Testes reproduzíveis em `testar.cjs` e evidências em `resultados.json`.
- Nenhuma dependência instalada por não haver pacotes requeridos.
- Nenhuma alteração nos arquivos existentes, nenhuma exclusão ou reset de dados.
- Alterações maiores e correções de produto ainda não iniciadas, para apresentar primeiro estes resultados.
