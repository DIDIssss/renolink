# RenoLink — Fase 4: migração controlada

## Resultado final: migração e validação concluídas

Data: 24/10/2026, America/Sao_Paulo. Migração concluída às 17:58:23;
testes funcionais às 17:59:22; inspeção final às 18:00:40.

| Coleção | Origem | Destino antes/depois dos testes |
| --- | ---: | ---: |
| Usuários | 4 | 4 |
| Ideias | 9 | 9 |
| Mensagens | 7 | 7 |
| Negociações | 1 | 1 |
| Sessões | 0 | 0 |

### Verificações e migração

A rotina corrigida foi testada isoladamente, sem conexão MySQL ou abertura
de handles próprios. Duas consultas separadas por dez segundos passaram:
nenhum runtime ativo, nenhum usuário dos JSONs e lock ausente. A consulta
ocorre antes dos handles de leitura protetores, sem ignorar códigos de erro
ou excluir o próprio PID dos resultados. A rotina completa repetiu a verificação.

O preflight confirmou renolink_dev sem tabelas, vinculado ao provisionamento
exclusivo RenoLink, com collation utf8mb4_0900_bin. A identidade efetiva foi
renolink_migrator@127.0.0.1, com os grants previamente autorizados. Os dois
JSONs e os backups/manifestos existentes foram conferidos por SHA-256 e
integridade estrutural. Handles de leitura impediram gravações nos JSONs
durante o preflight e a migração; foram fechados no finally.

O importador existente criou sete tabelas InnoDB sob lock e executou os dados,
contadores, comparação integral e marcador de importação na mesma transação.
DDL permanece fora da transação de dados devido ao commit implícito MySQL.
Conteúdo, campos adicionais, IDs e relacionamentos foram comparados por
mysql.verify. Não houve erro nesta tentativa.

A primeira execução retornou imported; a segunda, already-imported, com
as mesmas contagens e exatamente um registro em renolink_imports. A comparação
integral foi repetida após ambas. Não houve duplicação.

### Testes isolados e persistência

Os testes HTTP usaram somente renolink_test com renolink_tester. Foram criados
dois usuários sintéticos (IDs 6/7), uma ideia (ID 16), mensagem, negociação
(ID 3) e sessões. Cadastro, login, privacidade de ideia, mensagens e interesse
idempotente passaram. Para viabilizar o interesse, somente a ideia sintética
recebeu status Publicada por preparação de fixture no adaptador: o fluxo de
publicação administrativa, ainda ausente, não foi testado.

O processo Node de teste foi encerrado e reaberto, e sessão HTTP, ideia,
negociação e estado integral do banco sintético permaneceram corretos.
Os registros sintéticos foram preservados, sem reset ou limpeza.

Dois processos reais adicionais da aplicação abriram renolink_dev com
renolink_app@127.0.0.1. Leitura HTTP e comparação integral com a origem passaram
em ambos. Nenhum cadastro, login ou outra escrita foi executado nesse banco
durante os testes; nem mesmo as sessões/contadores migrados foram alterados.

### Configuração e aplicação em execução

Os inicializadores INICIAR_RENOLINK.bat, INICIAR_RENOLINK.ps1 e npm.cmd start
passam a usar scripts/mysql-dev.ps1, com configuração explícita MySQL:
renolink_dev, renolink_app, 127.0.0.1:3306, SSL=0 apenas para o acesso local,
NODE_ENV=development, COOKIE_SECURE=0 e porta HTTP 3000. Credencial carregada
do cofre DPAPI ignorado pelo Git; não há senha literal em código ou argumentos.
O ambiente anterior é restaurado ao sair. O migrador não é usado no runtime.

Aplicação iniciada em segundo plano com janela oculta, PID observado 12716.
Escuta confirmada exclusivamente em 127.0.0.1:3000. Página inicial, /api/stats
e /api/ideas responderam 200. Endereço: http://127.0.0.1:3000.
O PID é uma observação desta execução, não um identificador permanente.

Relatórios verificáveis em renolink_funcional/data/runtime:

- mysql-dev-preflight-report.json: destino vazio, identidade e backups;
- mysql-dev-migration-report.json: imported/already-imported e comparação;
- mysql-dev-verification-report.json: testes isolados e preservação do destino;
- mysql-dev-live-report.json: identidade da aplicação, estado integral e HTTP.

JSON original, operacional e backups continuam com SHA-256
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.
Não houve reset, alteração de outros bancos/projetos, reinício do MYSQL80
ou publicação na internet. Os relatos a seguir preservam o histórico anterior.

## Histórico das tentativas e autorizações anteriores

## Última tentativa: interrompida na inspeção de uso dos arquivos

Após a autorização final, a rotina preparatória recebeu
`Resource query incomplete: 16` do Windows Restart Manager, antes de carregar
as credenciais, rodar o preflight MySQL ou chamar o importador. Nenhum DDL ou
registro foi importado. Nenhuma aplicação foi iniciada, nenhum serviço foi
reiniciado e os inicializadores continuam sem alterações.

A causa identificada foi a ordem das verificações na nova rotina: ela abriu
os JSONs em leitura para impedir gravações e depois consultou os usuários dos
arquivos. O Windows detectou o próprio processo (RmRebootReasonDetectedSelf).
A ordem foi corrigida em `scripts/mysql-dev.ps1`: consulta antes de abrir os
handles de proteção, seguida de nova checagem do lock e do preflight protegido.
Nenhuma exceção foi ignorada nem proteção removida. A rotina corrigida não foi
executada, respeitando a condição de interromper após qualquer erro.

Os 27 testes locais passaram antes dessa tentativa. Após o erro, foi confirmado
que o lock continua ausente, não existe relatório de importação e os dois JSONs
mantêm o SHA-256 registrado abaixo. A migração e a configuração/testes da
aplicação continuam pendentes. O último preflight aprovado, documentado a seguir,
precisa ser repetido em uma próxima execução autorizada.

Referência: [RM_REBOOT_REASON, Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/ne-restartmanager-rm_reboot_reason).

## Atualização: lock removido; preflight aprovado; importação não executada

Em 24/10/2026, às 17:50:50 (America/Sao_Paulo), após autorização explícita e
repetição das verificações, somente `data/runtime/db.json.lock` foi removido.
PID 10500 ausente; nenhum runtime ou uso dos arquivos detectado em duas
observações; hashes, datas e tamanhos idênticos ao diagnóstico anterior.
Nenhum processo foi encerrado e ambos os JSONs mantiveram seus bytes.

Às 17:51:38, o preflight autenticado com `renolink_migrator@127.0.0.1` confirmou:

- renolink_dev vazio, charset utf8mb4 e collation utf8mb4_0900_bin;
- vínculo com o provisionamento exclusivo RenoLink e grants restritos intactos;
- integridade dos dois JSONs, IDs, contadores e todos os relacionamentos;
- 4 usuários, 9 ideias, 7 mensagens, 1 negociação e nenhuma sessão;
- backups separados de original e operacional com SHA-256 e manifestos
  conferidos em `renolink_funcional/data/backups/mysql-phase4/original/`
  e `renolink_funcional/data/backups/mysql-phase4/operational/`;
- ausência do lock antes e após as verificações e backups.

O SHA-256 de ambos os JSONs e respectivos backups permanece
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.

Relatórios: `data/runtime/json-lock-removal-report.json` e
`data/runtime/mysql-dev-preflight-report.json`, no projeto funcional.
O preflight não possui caminho de aplicação de schema ou importação: somente
SELECT/SHOW no banco e cópias verificadas dos arquivos locais.

Podemos prosseguir à migração controlada após nova autorização do responsável
e rechecagem das condições no momento da execução. Nenhuma importação, DDL,
alteração dos inicializadores, início da aplicação, reset, reinício de serviço
ou publicação foi realizado nesta etapa. O relato abaixo preserva a tentativa
anterior interrompida.

Data: 24/10/2026, America/Sao_Paulo.

## Resultado: interrompida antes da migração

O responsável autorizou importar exclusivamente em renolink_dev, desde que
todas as verificações passassem, e determinou interrupção caso qualquer uma
falhasse, sem contornar proteções.

Foi encontrado `renolink_funcional/data/runtime/db.json.lock`, contendo PID
10500. A consulta aos processos Node, inclusive via Win32_Process fora do
sandbox, não retornou processos em execução. Isso sugere um lock remanescente,
mas não autoriza removê-lo automaticamente. O migrador existente recusa uma
origem com lock independentemente de o PID estar ativo. A operação foi
interrompida; o lock foi preservado.

## Verificações somente de leitura

- O relatório da Fase 3 confirma criação exclusiva de renolink_dev para RenoLink.
- Conexão com renolink_app@127.0.0.1 em renolink_dev autenticada com o cofre
  Windows DPAPI, sem exibição de senhas.
- renolink_dev continua sem tabelas: nenhuma importação ocorreu.
- Original e operacional passaram em `lib/data.validate`: IDs, contadores,
  usuários, ideias, mensagens, negociações, sessões e relacionamentos íntegros.
- Ambos os arquivos têm 4 usuários, 9 ideias, 7 mensagens, 1 negociação e
  nenhuma sessão.
- SHA-256 idêntico em ambos:
  `7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.
- A inspeção de renolink_test permaneceu consistente, sem alterar os dados.

## Trabalho não executado por causa do bloqueio

Não foram criados novos backups nesta tentativa, aplicada migração, testada
idempotência em renolink_dev, alterados os inicializadores ou iniciada a aplicação.
Essas etapas continuam pendentes. Nenhum arquivo JSON ou lock foi modificado.
Não houve reset, exclusão, reinício do MYSQL80, alteração de outros bancos ou
publicação. Nenhum endereço de aplicação em execução foi confirmado.

Para uma próxima tentativa, o bloqueio da origem precisa ser resolvido de forma
explícita e segura. A autorização de migração não foi interpretada como
permissão para descartar um lock existente.
