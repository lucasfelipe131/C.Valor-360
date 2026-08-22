# ADR-005 — Execução e inteligência operacional

Status: aceito localmente para o Passo 05.

## Decisão

Evoluir o patrimônio existente com dois adapters explícitos:

- MEX transforma `DecisionThesis v1` + `ValuePlan v1` + `ContextSnapshot v1` em `ActionPlan v1`, limitado a três prioridades;
- VIS deriva `InsightCard v1` de visitas, compromissos, resultados e do Portfolio Radar atual.

`ActionPlan` e `Commitment` são persistidos como entidades de primeira classe. `InsightCard` é derivado sob demanda, com identidade determinística e expiração, para evitar uma segunda fonte de verdade.

## Compatibilidade

- `ValEngine`, prompts, barreiras agronômicas e APIs legadas permanecem intactos.
- o radar legado continua em `/api/intelligence`; `insights` é aditivo;
- `Commitment Ladder` continua orientando o menor compromisso útil e não é substituído;
- campos legados de visita, interação e oportunidade não são apagados ou reinterpretados;
- a migration é exclusivamente expand-only e roda depois das migrations MMI/MCTX.

## Tenancy e autorização

Todas as resoluções persistidas usam `tenant_id` e a carteira do ator. FKs compostas impedem vínculos de cliente, visita, oportunidade, snapshot e plano entre tenants. Nesta fase, o escopo permanece `own_portfolio`; nenhuma visão gerencial de equipe é criada implicitamente.

## Prioridade VIS

A política `val.insight_priority.experimental.v1` combina urgência, impacto, confiança, compromisso, risco e sinal relacional. Ela é uma ordenação operacional, não KPI, probabilidade de venda ou avaliação de pessoas. O score não precisa ser exibido ao usuário.

## Consequências

- ação sem owner, prazo e critério continua proposta e não vira compromisso;
- compromisso `DONE` exige evidência;
- compromisso vencido entra no próximo `ContextSnapshot`;
- visitas não comerciais não recebem fechamento comercial forçado;
- áudio, registro pós-visita e aprendizado fechado ficam para o Passo 06.

## Rollback

O binário anterior ignora as novas tabelas. O rollback preferencial é voltar ao commit-base e preservar os dados novos. Remoção estrutural só é admissível em banco descartável, após backup, removendo primeiro `val_commitments` e depois `val_action_plans`.
