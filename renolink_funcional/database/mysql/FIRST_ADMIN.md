# Primeiro administrador — procedimento local preparado

Estado em 26/10/2026: validado em renolink_test. Após autorização explícita do
responsável, a primeira concessão foi executada ao ID 3 e registrada no evento
de auditoria ID 1. Consulte [relatório de ativação](../../../auditoria/FASE_6_ATIVACAO.md).
Qualquer concessão adicional exige nova autorização; não repita a operação para
essa conta, pois associações anteriores são recusadas.

## Quem pode executar

O assistente precisa do usuário Windows capaz de abrir o cofre DPAPI local
`.env.mysql.local.clixml` e da autenticação efetiva
`renolink_migrator@127.0.0.1`, exclusivamente em `renolink_dev:3306`.
Não utiliza root nem a conta renolink_app para conceder acesso.
Sem o cofre válido, conta correta e confirmação explícita, a operação é recusada.
Não existe rota HTTP para promover usuários ou consultar a lista do assistente.

O terminal deve ser interativo e local, sem redirecionamento de entrada/saída.
O processo carrega a senha MySQL somente na memória/ambiente transitório e
restaura o ambiente anterior ao terminar. Não digite senhas no chat, parâmetros,
arquivos de código ou relatórios. O assistente não pede, cria ou redefine a
senha da pessoa selecionada. Escolha uma conta humana com senha pessoal forte;
não use contas compartilhadas ou legadas de demonstração para a equipe.

## 1. Conferir as contas — somente leitura

Em um terminal PowerShell local:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\renolink\renolink_funcional\scripts\first-admin.ps1" -Mode Preview
```

Mostra localmente ID, nome, e-mail e perfil das contas existentes sem associação
prévia à equipe. Não imprime hashes/salts, senha MySQL ou senha da pessoa.
Associações anteriores, inclusive desativadas, não são substituídas.
Caracteres de controle são neutralizados na apresentação do terminal.
Não compartilhe a listagem completa no chat ou em relatórios públicos.

## 2. Conceder — apenas após autorização real

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "D:\Downloads\renolink\renolink_funcional\scripts\first-admin.ps1" -Mode Grant
```

O assistente:

1. Consulta novamente as contas e o número de administradores ativos.
2. Pede o ID existente. Enter vazio cancela sem alterar dados.
3. Mostra nome, e-mail, ID, perfil e o alcance do papel administrador.
4. Exige digitar exatamente o e-mail para confirmar a identidade.
5. Exige a frase `CONCEDER ADMIN <ID> EM renolink_dev` para confirmar o papel e
   o banco de destino. Não existe confirmação automática por Sim/Enter.
6. Confere novamente a identidade e o estado da conta sob o lock transacional
   MySQL, incluindo uma impressão digital da seleção. Se nome/e-mail/perfil,
   credenciais da pessoa ou associação mudarem, exige nova seleção.
7. Insere a associação admin e o evento de auditoria na mesma transação,
   incrementando somente nextAuditId. Compara o estado completo antes do commit.
8. Mostra apenas ID do beneficiário e ID do evento ao concluir.

Não insere usuários, altera senhas, atualiza perfis públicos, reativa associações
antigas ou regrava linhas históricas. A repetição é recusada sem duplicar a
associação ou a auditoria. Em falha, rollback; nenhuma repetição automática.

## Auditoria e atribuição

Evento `staff.provision`, alvo `staff`, ID da pessoa beneficiária. O schema exige
actor_id de usuário: esse campo referencia a pessoa que recebe a associação.
O detalhe e os campos extras identificam explicitamente que a iniciativa veio
do operador local, com a conta MySQL efetiva e identidade do processo Windows;
não apresentam a ação como autopromoção do visitante. Não guardam senha ou token.

## 3. Validar o acesso depois da concessão autorizada

Abrir http://127.0.0.1:3000/admin-login.html e usar a senha pessoal da conta.
Conferir o dashboard, a associação ativa e o evento de concessão. O usuário não
deve compartilhar a senha com o operador ou com este chat.
Concessão e revogação são avaliadas em cada requisição; localStorage/cookies
forjados não substituem a sessão e a associação verificadas no servidor.

## Proteções e limites

Os comandos antigos `node scripts/grant-staff.js ID admin` foram desativados.
O modo GrantStaff do operador antigo também encaminha para as confirmações do
novo assistente, sem aceitar o ID antigo como aprovação suficiente.

A autorização é baseada no usuário Windows/cofre e na conta SQL migradora.
Uma pessoa que já controla esse usuário, código local ou credenciais SQL está
dentro da fronteira de confiança do operador; os prompts não são uma barreira
contra o próprio operador privilegiado. Não foram alterados os grants existentes
do schema nesta etapa. A conta da aplicação mantém os grants da Fase 5, mas
este procedimento recusa executá-los como renolink_app. A concessão não mede
a força de uma senha já armazenada nem altera credenciais existentes.

## Testes isolados

```powershell
npm.cmd run test:phase6
```

Usa somente renolink_test com renolink_tester e autorização explícita de teste.
O modo de testes recusa renolink_dev mesmo que alguém indique o nome da conta
migradora. A senha do usuário sintético é aleatória, apenas em memória; nenhum
segredo aparece no relatório. Não existe switch de teste no assistente real.

A suíte usa a mesma função transacional do assistente, testa confirmações
divergentes, banco/conta inválidos, ausência de aprovação, repetição, auditoria,
preservação das coleções e acesso ao painel no Chrome. O preenchimento manual
dos prompts Windows fica para o operador na execução real autorizada.
