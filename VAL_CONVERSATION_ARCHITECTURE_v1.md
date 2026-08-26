# VAL Conversation Architecture v1

## Fluxo canônico

1. A superfície resolve o contexto implícito autorizado.
2. A mensagem recebe uma intenção canônica.
3. O System Capability Router seleciona FAST ou DEEP e declara capacidades planejadas.
4. O Orchestrator recupera ContextSnapshot, memória confirmada, histórico, agronomia, conhecimento e dados atuais aplicáveis.
5. AI Reasoning sintetiza Decision Thesis, estratégia e Perguntas de Ouro.
6. Safety, tenancy, qualidade, NAME_SWAP_TEST e CONTEXT_REMOVAL_TEST validam a saída.
7. A UI renderiza resposta curta e componentes estruturados.
8. ASK permanece em sessão; REGISTER segue o pipeline de confirmação existente.

## Escopos de thread

`conversationScopeKey` define quatro famílias sem duplicar memória:

- `__global__`: conversa geral e current data sem produtor;
- `client:<id>`: conversa por produtor;
- `context:opportunity:<id>:<client>`: conversa por oportunidade;
- `context:visit|visit_draft|agronomic_tool|attachment_batch:<id>:<client|global>`: conversa por objeto ativo.

O `conversation_id` enviado ao backend é estável na sessão e escopado pela chave contextual. O backend filtra recomendações anteriores pelo mesmo `conversation_id` e pelo cliente autorizado.

## Continuidade

- Uma resposta curta como “E o milho?” pode herdar uma âncora de mercado compatível.
- Uma solicitação independente como “Me prepare para uma conversa comercial” rompe a âncora antiga.
- Respostas da Decision Interview são agregadas no pedido da sessão e marcadas como não persistentes.
- `+ Nova conversa` limpa apenas a thread ativa e gera outro `conversation_id`; não apaga memória ou histórico de negócio.

## Histórico de interface

A UI guarda no `sessionStorage` somente as threads da sessão, sob uma chave que inclui `storageScope` de tenant/owner. O limite é de 12 contextos e 20 turnos por contexto. O agrupamento visual é Hoje, Ontem e Anteriores; a busca cobre produtor, contexto e resumo da última mensagem.

Histórico de conversa não equivale a memória da VAL. Ele serve para continuidade e navegação; não alimenta premissas confirmadas por si só.

## Intenções

Permanecem canônicas as 17 intenções do Intent Router v2, incluindo `ASK_GENERAL`, `ASK_CLIENT`, `ASK_AGRONOMIC`, `ASK_MARKET`, `ASK_COMMODITY`, `PREPARE_VISIT`, `REGISTER_INFORMATION`, `ANALYZE_SOIL`, `IMAGE_DIAGNOSIS`, `CALCULATE`, `CHECK_OPPORTUNITY` e `FOLLOW_UP_HELP`.

## Falha fechada

- Contexto fora da carteira é descartado antes da abertura.
- Anexo fora do cliente/owner é rejeitado.
- Clima e bula/rótulo atual retornam indisponibilidade até fonte autorizada existir.
- Envelope inesperado não é renderizado e nenhuma memória é alterada.
- Uma intenção persistente enviada ao endpoint de ASK recebe `val_confirmation_required`.

