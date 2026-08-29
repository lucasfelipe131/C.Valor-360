# VALGlobalIntentRouter v1

Contrato: `val.global_intent_router.v1`
Implementação: `server/decision-copilot/global-intent-router.js`

## Política

O router classifica o pedido antes de qualquer reasoning profundo. Ele pode emitir `val.workspace_action.v1` apenas para `NAVIGATE`, `OPEN_CLIENT` e `PREPARE_VISIT`. Writes são classificados, mas nunca executados pelo router.

| Intenção | Exemplo | Caminho | Efeito |
|---|---|---|---|
| OPEN | “Abra o produtor Antônio.” | FAST | Abre `client360` com `client_id` autorizado. |
| SEARCH | “Procura o produtor Beber.” | FAST | Resolve a carteira e abre o resultado único. |
| PREPARE | “Prepare a visita do Antônio.” | FAST/UI + capacidade canônica | Abre Visitas com o produtor correto; a preparação profunda continua canônica. |
| NAVIGATE | “Abra Inteligência Agronômica.” | FAST | Abre módulo allowlisted. |
| SHOW | “Quanto está a soja hoje?” | LIVE_DATA existente | Não inventa preço; usa provider autorizado. |
| CALCULATE | “Calcula custo por hectare.” | TOOL existente | Usa calculadora canônica, não fórmula no modelo. |
| ANALYZE | “Interpreta essa análise.” | TOOL/CONTEXT existente | Usa adapter técnico e safety. |
| FOLLOW_UP | “Resume.” | sessão local | Reutiliza a última resposta. |
| EXPLAIN | “Por quê?” | contexto da conversa | Não troca produtor nem promove memória. |
| REGISTER | “Registra que...” | confirmação | Abre revisão humana existente. |
| CREATE/UPDATE/MARK_COMPLETE | comandos de write | bloqueado no router | Exige adapter canônico + confirmação; nenhum write direto. |

## Ordem de decisão

1. Identificar e reconciliar produtor autorizado.
2. Reconhecer PrepareVisit.
3. Reconhecer módulo canônico e navegação.
4. Reconhecer OPEN/SEARCH de cliente.
5. Classificar writes como confirmação obrigatória.
6. Delegar ferramentas e decisões aos routers existentes.

## Controles

- `workspace_action` não aceita URL livre, código, comando, tenant ou owner.
- O browser aceita apenas páginas presentes em `VAL_WORKSPACE_MODULES`.
- Se `client_id` não existir na carteira já carregada da sessão, a ação é negada.
- Ações destrutivas não fazem parte da allowlist.
