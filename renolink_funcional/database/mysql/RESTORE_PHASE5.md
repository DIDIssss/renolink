# Restauração do backup anterior à Fase 5

O backup completo da aplicação fica em
`data/backups/phase5-dev-full/<data-UTC>/`, fora da lista pública e do Git.
Trate esses arquivos como sensíveis: contêm dados pessoais e hashes de senha,
mas não incluem senhas das contas MySQL.

- `renolink_dev.sql`: dump MySQL 8.0.46 das sete tabelas existentes, estrutura,
  índices, CHECKs, FKs, dados e marcador de importação.
- `snapshot.json`: definições SHOW CREATE TABLE e estado integral da aplicação.
- `manifest.json`: SHA-256, tamanhos e contagens por tabela.

O dump é feito com a conta migradora, `--single-transaction`, sem tablespaces,
locks de tabelas, DROP TABLE ou configurações globais. A senha é fornecida
somente no ambiente do processo filho, sem argumento ou arquivo de configuração
em texto aberto. A migração segura da RenoLink mantém o advisory lock durante
o backup e só executa DDL após sua validação. A aplicação fica parada nessa janela.

A instalação documentada possui somente sete tabelas. Antes do dump, a rotina
recusa views/engines diferentes e objetos detectados fora do plano. Não há
triggers, rotinas ou eventos da aplicação; o dump não transporta objetos globais,
contas MySQL ou grants. O provisionamento e o cofre DPAPI são recursos separados.

## Procedimento — não executado automaticamente

1. Escolher o diretório pelo manifesto do relatório de ativação e copiar os
   arquivos para armazenamento protegido. Recalcular SHA-256 de cada arquivo
   e comparar tamanho/hash com o manifesto; interromper se qualquer valor divergir.
2. Solicitar autorização específica para criar **outro banco vazio e dedicado**
   de restauração. Não usar renolink_dev, renolink_test ou banco de outro projeto.
   A criação desse destino e concessões não estão autorizadas por este procedimento.
3. Com uma conta autorizada somente nesse destino, conectar o cliente MySQL
   usando `-p` interativo, sem senha na linha de comando. Selecionar explicitamente
   o banco novo e confirmar `SELECT DATABASE()` e ausência de tabelas.
4. Executar `SOURCE` apontando para o caminho absoluto de renolink_dev.sql.
   O dump não contém CREATE DATABASE, USE ou DROP TABLE. Seus SETs são de sessão;
   as verificações de FKs são temporariamente ajustadas pelo formato padrão do
   dump para permitir a ordem de criação e restauradas ao final. Não executar
   esse arquivo sobre banco existente/populado.
5. Confirmar sete tabelas InnoDB, definições de chaves/índices/CHECKs e contagens
   do manifesto. Comparar todos os registros com snapshot.json e validar IDs,
   contadores e relacionamentos pelo validador da RenoLink. Verificar explicitamente
   ausência de referências órfãs; reativar a checagem de FKs não faz essa varredura.
6. Só usar uma cópia restaurada na aplicação após a validação integral. Um eventual
   rollback de ambiente exige preservar/reconciliar gravações posteriores ao backup
   e nova autorização, sem DROP/reset do ambiente atual.

A validação feita nesta etapa confere hash, leitura do snapshot, sete CREATEs,
contagem de INSERTs por tabela e estabilidade integral da origem. O ensaio de
restauração em outro banco não é executado sem autorização desse destino.

Referência: [mysqldump MySQL 8.0](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html).
