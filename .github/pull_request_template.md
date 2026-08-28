## Objetivo

Descreva o problema e a evolução proposta. Não inclua mudanças fora do escopo.

## Preservação de comportamento

- [ ] A solução evolui componentes existentes; não recria autenticação, banco, ValEngine, APIs ou front-end.
- [ ] O comportamento atual foi coberto por teste de caracterização antes da refatoração.
- [ ] Não há migration histórica reescrita nem operação destrutiva de dados.

## Validação obrigatória

- [ ] `npm test`
- [ ] `npm run build`
- [ ] `cd manual && npm run build`
- [ ] Alterações de banco seguem expand/contract e incluem plano de rollback.
- [ ] Alterações de tenancy incluem teste negativo cross-tenant.
- [ ] Logs novos não contêm segredo, cookie, prompt, SQL, parâmetros ou dado pessoal bruto.

## Banco, risco e rollback

Migration prevista/executada:

Risco principal:

Rollback ou roll-forward seguro:

## Evidências

Inclua saída resumida dos checks e, quando aplicável, prova de restore em ambiente controlado.

## Aprovações

- [ ] Pelo menos uma aprovação de CODEOWNER.
- [ ] Todas as conversas resolvidas.
- [ ] Branch atualizada com `main` e checks obrigatórios verdes.
