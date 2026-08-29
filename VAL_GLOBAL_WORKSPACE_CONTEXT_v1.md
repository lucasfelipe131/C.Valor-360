# VALWorkspaceContext v1

Contrato: `val.workspace_context.v1`
Implementação: `src/lib/val-workspace-context.js`

## Estado compartilhado

| Campo | Origem | Invalidação |
|---|---|---|
| `current_module` | página real do App | sempre validado contra allowlist |
| `current_client` | seleção autenticada da carteira | troca de produtor |
| `current_property` | contexto agronômico | sem cliente ou troca de cliente |
| `current_field` | contexto agronômico | sem propriedade ou troca de propriedade |
| `current_visit` | jornada de Visitas | troca de cliente |
| `current_opportunity` | Oportunidades | troca de cliente |
| `current_attachment` | conversa/diagnóstico | remoção ou mudança de análise |
| `current_analysis` | Agronomia | mudança de cliente/objeto |
| `current_conversation` | seed da conversa | nova conversa/logout |

O contexto é enviado ao Copilot como pista de workspace, não como autoridade. Objetos privados continuam sendo reconciliados no backend antes de entrar no contexto autorizado.

## Sincronização

- App cria o contexto a partir do estado real.
- Copilot o envia junto à pergunta.
- O backend pode devolver `workspaceAction` assinada pelo contrato, sem URL arbitrária.
- App valida tipo, página e `client_id` contra a carteira da sessão antes de executar.

## Política de write

O contrato aceita somente `NAVIGATE`, `OPEN_CLIENT` e `PREPARE_VISIT`. REGISTER/UPDATE/CREATE/DELETE/MARK_COMPLETE não podem entrar como ação executável; seguem proposed change → human confirmation → persist → audit.
