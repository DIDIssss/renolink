# Backup e restauração — procedimento futuro

**Este procedimento não foi executado e ainda não é um script operacional.**
Nenhum banco, cliente MySQL, credencial, ferramenta de criptografia ou destino
de backup foi criado ou acessado.

## Dependências e política

- Instância exclusiva de feira, confirmada como loopback `127.0.0.1:3307`,
  schema `renolink_feira` e `server_uuid` aprovado.
- Cliente `mysqldump`/`mysql` compatível e opção MySQL protegida por ACL, fora
  do repositório e do release. Não usar `MYSQL_PWD`, argumentos com senha nem
  credenciais de dev/test.
- Ferramenta de criptografia aprovada, chave pública de backup e cópia
  criptografada em mídia/armazenamento fora deste PC. A ferramenta, a
  identidade/chaves, a retenção e o destino ainda precisam de aprovação.
- Não usar pipeline de texto do Windows PowerShell 5.1 para transmitir um dump
  sem antes provar a integridade byte a byte; a conversão de encoding pode
  alterar os dados. Preparar e testar um invólucro stream-safe em instância
  descartável antes de tratar qualquer dump como confiável.

## Backup proposto

1. Confirmar operador, janela, RPO/RTO, espaço livre, destino externo e que o
   schema é exatamente `renolink_feira` na instância aprovada. Não incluir `renolink_dev` ou
   `renolink_test`.
2. Produzir dump consistente de InnoDB com `--single-transaction`,
   `--routines`, `--triggers`, `--events`, `--hex-blob` e
   `--set-gtid-purged=OFF`, usando a conta de backup de menor privilégio
   autorizada. Rever os privilégios/documentação da versão do cliente antes da
   primeira execução.
3. Encaminhar os bytes diretamente do cliente para a ferramenta de
   criptografia, sem arquivo SQL temporário em claro. Gravar somente o artefato
   cifrado no destino externo e interromper se qualquer processo falhar.
4. Verificar o código de saída de cada etapa, tamanho/hash do ciphertext e
   registrar apenas data, duração, bytes e resultado. Não registrar IDs, nomes,
   payloads, strings de conexão, chaves ou credenciais.
5. Aplicar retenção aprovada e verificar a acessibilidade do backup sem
   descriptografá-lo para o disco local.

## Restauração proposta

1. Exigir autorização explícita e escolher uma instância/schema vazio e
   independente, previamente provisionado. O destino deve ter nome
   `renolink_feira_restore_<identificador>` e nunca ser `renolink_dev` ou
   `renolink_test`. O script de restauração não deve criar banco nem usuário.
2. Conferir a origem e o hash do ciphertext; descriptografar em fluxo, sem
   materializar SQL em claro, diretamente para o cliente MySQL da instância de
   restauração. Usar identidade de restauração restrita e exclusiva.
3. Validar schema, integridade e fluxos com dados sintéticos, mantendo logs sem
   dados pessoais. Medir RTO e comparar com o objetivo previamente aprovado.
4. Não apontar a aplicação da feira ao destino restaurado até haver revisão e
   autorização separadas. Não restaurar sobre qualquer ambiente existente.

## Não comprovado

Não há backup, restauração, ferramenta de criptografia, chaves, retenção ou
cópia externa. As etapas acima são plano, não evidência de recuperabilidade.
