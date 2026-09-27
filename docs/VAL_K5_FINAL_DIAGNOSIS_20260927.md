# K5 — diagnóstico final sem inferência paga

Checkpoint recebido: `fbca0acf4e79569023b17d7fcb64310ef89b17e8`.
Histórico investigado: lote em `345ed8ec1a054dfa6f9ac31a3771693d4bbc415c`.

**Resultado causal: não é possível comprovar a causa final dos 15 fallbacks com
os artefatos disponíveis. ROOT_CAUSE_KNOWN = 0/15.** O trecho determinístico de
retrieval/seleção está explicado em 15/15; isso não equivale a explicar a rejeição
das respostas geradas posteriormente. A nova instrumentação não recupera eventos
que não foram armazenados. Nenhuma autorização de reteste pago é solicitada.

## Evidência e reprodutibilidade

- Logs originais: 15 `val.answer.completed`, 30 `provider_call`, 30 `provider_usage`
  com status completed, 15 resumos de retrieval, 18 eventos de candidatos e 4 de
  seleção. Nenhum reason code da rejeição final e nenhum texto gerado descartado.
- IDs selecionados foram recuperados dos logs originais. Contagens completas de
  candidatos e IDs rejeitados são **reprodução determinística**, não campos que
  apareceram retroativamente no log antigo.
- `selection.js`, índice semântico e acervo eram iguais entre o SHA histórico e o
  checkpoint recebido. A mudança atual extrai os mesmos booleanos de cobertura
  para decisões com reason code, sem alterar ranking, filtros ou thresholds.
- Replay usa intent histórico ASK_GENERAL, rota CONTEXT e horário do caso. Chamar
  o roteador sem o intent já resolvido no handler pode produzir ASK_AGRONOMIC em
  alguns casos; isso não é a rota observada no lote e não é prova de falha.
- Reprodução local: `node scripts/k5/diagnose-historical.mjs <arquivo.json>`.
  Não cria cliente de IA; não faz rede. A matriz completa por caso está em
  `VAL_K5_FINAL_DIAGNOSTIC_MATRIX_20260927.json`.

## Os onze casos sem retrieval aplicável

| Casos | Decisão reproduzida | Quantidade |
|---|---|---:|
| AG-001,003,007,011,013,014,016,028,029 | QUESTION_OUTSIDE_CORPUS: filtro de vocabulário/escopo excluiu os 198 itens | 9 |
| AG-018 | Sem candidatos após relevância (123), assunto (48), módulo (24), cobertura fraca (3) | 1 |
| AG-024 | Sem candidatos após relevância (117), módulo (24), assunto (34), cobertura fraca (1), cultura incompatível (22) | 1 |

Para **cada um dos onze**, confirmado na matriz: intent ASK_GENERAL, rota CONTEXT;
retrieval é uma preferência do caminho existente, não exigência da pergunta. São
perguntas conceituais que podem usar o caminho já existente de conhecimento geral
não verificado. Nenhuma corresponde a uma definição determinística completa já
implementada. Não houve gatilho material de tópico ou produtor ausente. Não foi
criado retrieval adicional, texto agronômico fixo, item novo ou lista de respostas.

O filtro demonstravelmente decidiu NO_DATA no acervo. Isso não comprova nem um
bug de retrieval nem que o fallback final seja correto: a etapa seguinte fez duas
tentativas de geração e descartou/não aproveitou o resultado. O motivo dessa etapa
é a informação que falta. Não há prova de que uma resposta determinística completa
já disponível tenha sido indevidamente escondida.

## Os quatro casos com seleção

`candidate_count` conta candidatos elegíveis após os filtros, não os 198 itens
avaliados. `selected_count` conta seleção de ranking, não aceitação para entrega.
Todos têm selected_count = 1; nenhum item selecionado foi aceito para entrega.

| Caso | candidate_count | selected_ids (histórico) | rejected_ids (replay, ranking + entrega) | Rejeição do item selecionado |
|---|---:|---|---|---|
| AG-006 | 1 | KI-137 | KI-137 | SUBJECT_NOT_FULLY_COVERED |
| AG-019 | 4 | KI-123 | KI-102, KI-160, KI-146; KI-123 | UNIVERSAL_QUALIFIER_NOT_COVERED |
| AG-022 | 2 | KI-188 | KI-137; KI-188 | SUBJECT_NOT_FULLY_COVERED |
| AG-027 | 6 | KI-127 | KI-147, KI-173, KI-166, KI-135, KI-198; KI-127 | UNREQUESTED_CROP_IN_STATEMENT |

Os outros candidatos foram descartados por RANK_LIMIT. AG-006 recuperou princípio
sobre fixação de fósforo, sem cobrir pH/alumínio limitando raízes. AG-019 recuperou
incorporação de ureia, sem responder à universalidade de “sempre” com chuva leve.
AG-022 recuperou semente salva/certificada, sem cobrir germinação alta versus vigor.
AG-027 recuperou densidade com afirmações específicas de milho e números de estudo,
quando a pergunta não especificava cultura. Não se tornou esse conteúdo uma
recomendação geral para obter PASS.

Nos quatro: `grounding_decision` do **item selecionado** =
NOT_REACHED_COVERAGE_REJECTED. `language_validation_decision` do enhancer =
NOT_IN_GENERAL_ANSWER_PATH. O grounding da resposta posteriormente gerada pelo
modelo continua NOT_RECORDED no histórico. Não confundir o grounding aprovado do
texto fixo de fallback com aprovação da resposta descartada.

## Separação A–J

| Classe | Conclusão para o histórico |
|---|---|
| A NO_DATA correto | Ausência de item/rejeição de cobertura comprovadas no trecho determinístico; zero casos de NO_DATA final comprovadamente corretos |
| B Clarification específica | Zero necessidades materiais identificadas; não reclassificar fallback como clarification |
| C Falha de routing | Não demonstrada; o caminho geral chegou ao provedor em todos |
| D Falha de retrieval | Decisões dos filtros reproduzidas; nenhuma indisponibilidade da fonte comprovada |
| E Falha de seleção | Quatro candidatos parciais foram recusados antes da entrega; não se provou aceite indevido ou item completo omitido |
| F Language enhancer | Fora deste caminho; seu validator é diferente do general-answer validator |
| G Grounding blocked | Decisão sobre geração histórica ausente; não inferir a partir de mock |
| H Provider failure | Não demonstrada nos quinze; duas respostas completed não provam texto utilizável |
| I Fallback determinístico genérico | Mecanismo final comprovado em 15; não substitui a causa da rejeição anterior |
| J Outro motivo | Lacuna de observabilidade comprovada; origem causal final não identificável nos registros disponíveis |

## Instrumentação e regressões

As respostas e eventos correlacionados agora incluem ROUTE_REASON,
RETRIEVAL_REASON, SELECTION_REASON, SELECTION_REJECTION_REASON, GROUNDING_REASON,
LANGUAGE_REJECTION_REASON, PROVIDER_REASON e FALLBACK_ORIGIN. Registram contagens,
IDs públicos de conhecimento, rejeição por item, separação ranking/entrega,
decisões de grounding por etapa e razões por tentativa do provedor. Erro de
retrieval deixa de ser um catch silencioso. Resposta completed mas vazia, longa,
incompleta ou recusada tem motivo próprio. Cache HIT/COALESCED é distinguido de
chamada ao provedor. Reason codes do enhancer não incluem nome de produto, número
inventado, pergunta, resposta descartada, nome de produtor ou mensagem de exceção.

19 novos testes focados passam. Para cada um dos 15 casos, dois mocks diferentes
produzem o mesmo texto genérico, duas tentativas e status completed, mas por causas
diferentes: UNSAFE_GENERAL_ANSWER versus GROUNDING_BLOCKED. **Não são respostas
originais**, nem reprodução das contagens históricas de tokens. Provam que esses
sinais não determinam uma causa única; contagens de tokens não recuperam o texto.
Também se testam a causa específica da seleção, ausência de retrieval artificial
para definição fixa, provider failure, limite de saída e privacidade dos logs.

Não houve correção especulativa de comportamento agronômico. Foram corrigidas
lacunas comprovadas de diagnóstico. Perguntas/rubrica K5, safeguards, isolamento,
grounding, rate limit, secrets e quantidade máxima de tentativas foram preservados.

## Gate

ROOT_CAUSE_KNOWN = 0/15 (causa final histórica)
ROOT_CAUSE_GROUPS = 0 comprovados para o fallback final
DETERMINISTIC_PREFIX_GROUPS = 5 (9 + 1 + 2 + 1 + 1 casos)
DETERMINISTIC_PREFIX_EXPLAINED = 15/15
CASES_FIXED = 0/15 historicamente comprovados nesta fase
CASES_CORRECT_NO_DATA = 0/15 comprovados no resultado final
CASES_NEEDING_SPECIFIC_CLARIFICATION = 0 identificados
CASES_STILL_UNEXPLAINED = 15
PAID_CALLS_USED_THIS_PHASE = 0

Para fechar a causa histórica faltam os envelopes originais com rejection reasons
ou as respostas descartadas, obtidos de registros já existentes e autorizados.
Não se afirma que esses registros existam em outro sistema. Reexecutar agora seria
um novo experimento, não recuperação do histórico. Sem essa evidência, o gate
ROOT_CAUSE_KNOWN não pode ser declarado PASS. Reteste pago permanece bloqueado.
