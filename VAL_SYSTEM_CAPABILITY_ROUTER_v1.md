# VAL System Capability Router v1

> **Status da entrega:** contrato candidato em validação exclusiva no staging. Não autoriza produção, merge em `main` nem Passo 07.

## Responsabilidade

O System Capability Router traduz intenção em capacidades existentes da plataforma e escolhe o caminho `FAST` ou `DEEP`.

Ele não concede permissão, não escolhe tenant pelo payload, não persiste memória e não reduz safety.

## Entrada e saída

Entrada:

- mensagem;
- intent explícito opcional;
- presença de produtor;
- tipos de anexo.

Saída `val.system_capability_router.v1`:

- intent canônico;
- `path`;
- `direct`;
- `capabilities[]`, como plano de execução;
- `current_data_required`;
- `client_context_required`;
- `persistence_mode`;
- razão auditável.

## Intents canônicos

- `ASK_GENERAL`;
- `ASK_CLIENT`;
- `ASK_AGRONOMIC`;
- `ASK_MARKET`;
- `ASK_COMMODITY`;
- `PREPARE_VISIT`;
- `REGISTER_INFORMATION`;
- `POST_VISIT`;
- `ANALYZE_SOIL`;
- `IMAGE_DIAGNOSIS`;
- `CALCULATE`;
- `CHECK_LABEL`;
- `CHECK_WEATHER`;
- `CHECK_MARKET`;
- `CHECK_OPPORTUNITY`;
- `OBJECTION_HELP`;
- `FOLLOW_UP_HELP`.

Aliases v2 continuam aceitos para compatibilidade, mas a saída é sempre canônica.

## Registry de capacidades

- contexto do produtor e memória confirmada;
- histórico comercial, visitas e oportunidades;
- workspace agronômico e solo;
- diagnóstico por imagem;
- calculadoras;
- bulas/labels;
- clima;
- mercado/commodities;
- Biblioteca VAL;
- Manual do Agrônomo;
- voz de entrada e saída.

O registry declara disponibilidade lógica. O adapter confirma disponibilidade operacional e autorização.

## Plano versus execução

O retorno do router descreve o plano. No `AIReasoningResult v1`, esse plano aparece em `run.capabilities_planned`. Ele não deve ser copiado automaticamente para `run.capabilities_used`.

- `capabilities_planned`: selecionadas pelo router para aquela intenção;
- `capabilities_used`: adapters realmente executados e cujos dados contribuíram para a resposta;
- `capability_results`: status e evidência operacional de cada execução.

Capacidade indisponível, bloqueada ou não chamada permanece visível no resultado correspondente, mas não pode ser apresentada como fonte usada. Progresso, confidence e explicação ao usuário obedecem a essa distinção.

## Regras principais

- “Qual foi a última visita?” -> `VISIT_HISTORY`, FAST, leitura direta.
- “Qual a última cotação de soja?” -> `MARKET_COMMODITY`, `LIVE_DATA`, fonte/data obrigatórias.
- “Isso muda a negociação com João?” -> mercado + contexto do cliente, DEEP.
- solo, imagem e agronomia -> capacidades técnicas, DEEP.
- cálculo determinístico com valores suficientes -> `CALCULATORS`, FAST.
- preparação de visita -> contexto, memória, histórico, oportunidades e knowledge, DEEP.

## Contexto opcional

Nesta entrega, somente mercado/commodity diretos (`ASK_MARKET`, `ASK_COMMODITY` e `CHECK_MARKET`) podem ser consultados sem produtor. Clima, bula/label e os demais intents seguem o contrato de contexto autorizado e de adapter específico; a seleção planejada da capacidade não equivale a uma consulta concluída.

Se a pergunta pede impacto na negociação, oportunidade, histórico ou agronomia do produtor, `client_context_required=true`. A API deve pedir seleção explícita em vez de escolher uma conta silenciosamente.

## Informação atual

`ASK_MARKET`, `ASK_COMMODITY`, `CHECK_MARKET`, `CHECK_WEATHER` e `CHECK_LABEL` marcam `current_data_required=true`.

Uma resposta só pode chamar o dado de atual quando o adapter devolve fonte e data dentro da policy de freshness. Sem adapter ou referência adequada, a resposta é `UNAVAILABLE`. Para mercado, fonte e data/hora devem aparecer no texto principal e no texto falável, não somente em metadata.

## Persistência

- ASK/CHECK/ANALYZE/CALCULATE/PREPARE: `NONE`;
- REGISTER/POST_VISIT: `CONFIRM_REQUIRED`.

O endpoint de ASK rejeita intents que exigem confirmação e direciona o usuário para Registrar.

## Auditoria

Registrar apenas metadata necessária:

- intent;
- path;
- capacidades planejadas, usadas e seus resultados, sem tratá-las como equivalentes;
- duração por estágio;
- status/fallback;
- IDs de fonte permitidos;
- motivo da rota.

Não registrar prompt integral, transcript, segredo ou documento em log operacional.

## Falhas

- capacidade indisponível: resposta explícita e ação segura;
- current data sem fonte: indisponível, nunca memória antiga como “hoje”;
- contexto obrigatório ausente: pedir produtor;
- provider profundo indisponível: fallback determinístico específico;
- adapter não autorizado: negar sem tentar outro tenant.

## Testes

Cobrir todos os intents, aliases, pergunta com/sem cliente, anexos, FAST/DEEP, current data, persistence mode, capacidade indisponível e ausência de vazamento cross-tenant.
