# RenoLink — diagnóstico do lock JSON

Atualização em 24/10/2026, 17:50:50 (America/Sao_Paulo): o responsável autorizou
a remoção exclusiva do lock após nova verificação. As duas novas observações
(17:50:40 e 17:50:50) confirmaram PID ausente, ausência de processos e usuários
dos arquivos, hashes, tamanhos e datas exatamente iguais aos do diagnóstico.
Somente `data/runtime/db.json.lock` foi removido. Ambos os JSONs foram mantidos
abertos em modo leitura, impedindo gravações durante a conferência final e a
remoção. Seus hashes permaneceram inalterados após o procedimento.

Evidência detalhada: `renolink_funcional/data/runtime/json-lock-removal-report.json`.
Nenhum processo foi encerrado. Não houve importação. O texto abaixo preserva
o diagnóstico anterior à autorização.

Data: 24/10/2026. Verificações entre 17:47:18 e 17:47:28,
America/Sao_Paulo.

## Conclusão

As evidências confirmam um lock órfão no mecanismo da RenoLink. A remoção
continua pendente de autorização explícita; o arquivo foi preservado. Nenhuma
migração foi executada, nenhum processo foi encerrado e nenhum banco foi alterado.

## Evidências

- `data/runtime/db.json.lock` contém somente `10500`, cinco bytes.
- Consulta Windows Win32_Process confirmou que o PID 10500 não existe.
  Portanto não há processo atual para identificar; o nome do processo histórico
  não pode ser recuperado apenas pelo PID gravado.
- Nenhum processo node.exe, nodejs.exe, bun.exe ou deno.exe foi encontrado.
- O Windows Restart Manager não identificou aplicação/serviço usando o JSON
  operacional ou o lock. Foram usadas apenas APIs de consulta, sem RmShutdown
  ou RmRestart.
- Duas observações separadas por dez segundos deram os mesmos resultados.
- Tamanho, última gravação e SHA-256 dos dois arquivos permaneceram idênticos.
- Nenhum temporário `db.json.*.tmp` foi encontrado no diretório operacional.
- JSON: 7690 bytes; última gravação em 23/10/2026 às 23:55:16 no fuso local.
- Lock: cinco bytes; última gravação em 23/10/2026 às 23:55:31 no fuso local.

SHA-256 do JSON operacional:
`7b64c805aaf352374c6185e405ee10d792432b10b4253f30d77daef81b227676`.

SHA-256 do lock:
`751965f4d8a6e3fe5fa61c1df1cf71bfb2699dc391ae5dd9e94df1b93a35bf12`.

## Como o lock funciona

Em `renolink_funcional/lib/data.js`, `localStore` cria o lock com abertura
exclusiva `wx`, grava o PID e fecha imediatamente o descritor. O arquivo funciona
como marcador de propriedade do armazenamento JSON: sua existência impede
outra instância participante. Não é um bloqueio de sistema operacional mantido
por um handle aberto durante toda a execução.

Por isso a ausência de handles isoladamente não provaria que o lock está órfão.
Neste diagnóstico ela foi combinada com a inexistência do PID, ausência dos
runtimes, estabilidade dos arquivos e ausência de temporários de gravação.

As transações JSON são enfileiradas. A escrita cria um temporário exclusivo,
valida os dados, faz fsync e renomeia o temporário sobre o arquivo operacional.
`close` só remove o lock se o conteúdo ainda corresponder ao PID do processo.
`server.js` chama essa limpeza em encerramentos tratados e no evento exit.
Um término que não execute os handlers pode deixar o marcador no disco.
Não é possível determinar a causa exata do término histórico apenas pelo lock.

O migrador recusa a origem sempre que o arquivo `.lock` existe; ele não tenta
remover locks nem concluir automaticamente que um PID antigo é órfão.

## Limites e próximo passo

As verificações descrevem os instantes observados, não garantem ausência de uma
futura abertura por outro programa. Antes de uma eventual remoção autorizada,
repetir as verificações e conferir conteúdo/hash do lock. Se houver processo,
uso de arquivo, alteração ou erro de inspeção, preservar o lock e interromper.

Após remover exclusivamente o lock mediante autorização, a Fase 4 poderá ser
retomada com todas as verificações originais de banco vazio, origem estável,
backup e integridade. A autorização para remover o lock não será interpretada
como instrução para executar migração nesta etapa.

Diagnóstico reproduzível: `renolink_funcional/scripts/diagnose-json-lock.ps1`.

Referência da API de consulta:
[Microsoft RmGetList](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/nf-restartmanager-rmgetlist).
