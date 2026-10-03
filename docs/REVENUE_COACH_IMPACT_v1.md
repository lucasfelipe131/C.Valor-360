# Passo 10 — receita, execução e impacto

Base: `2226b31808dcebcbf266cc3dc70537e06bc4542d`. Branch: `feature/val-passo10-revenue-coach-impact-v1`. PR deve permanecer draft, empilhado sobre Passo 09 e sem merge. K5 e UAT físico são gates de release, fora desta implementação.

## Contratos e cálculo

`buildRevenueIntelligence`, no motor de conversão existente, projeta oportunidades e `val.outcome.v1`. Não cria CRM nem score. Valores desconhecidos são `null` com estado `UNKNOWN`; zero é reservado a soma vazia ou valor explicitamente informado. Potencial, pipeline, comprometido, ganho, realizado e perdido não são aditivos. Compras maiores que potencial mantêm o share calculado e exibem inconsistência, sem truncar o indicador.

Share = compras atuais / potencial total × 100. Sem denominador positivo conhecido não há share. Observações históricas são capturadas de registros canônicos, com fonte; aumento exige duas observações. Alterações do potencial também alteram o denominador e não são atribuídas ao consultor.

Pipeline inclui apenas oportunidades abertas. Ausência de valor invalida o total completo, sem converter ausência em zero. Estagnação exige pelo menos 30 dias desde movimentação registrada e ausência de compromisso completo, prazo vencido ou falta de próximo passo. Cenários COMMITTED, ADVANCING, NEEDS_VALIDATION, STALLED, NO_DECISION e CLOSED são categorias determinísticas, sem probabilidades.

`val.value_plan.v1` recebe vínculo à oportunidade e hipótese com baseline, agir, esperar, manter, métrica, horizonte, prova e incerteza. Planos incompletos têm lacunas explícitas, sem texto fabricado. Casos econômicos calculam somente entradas KNOWN; premissas ASSUMED permanecem identificadas. Receita incremental/economia observadas exigem fonte e medição. Não se fabrica ROI ou margem.

## Outcomes e impacto

WON exige referência confirmada de pedido, faturamento, evento comercial ou registro confirmado. Proposta, intenção e score não bastam. LOST exige motivo governado; NO_DECISION é outro resultado. Resultados técnicos e relacionais não entram em receita ganha. Repetição do mesmo outcome é conflito; referências comerciais repetidas são deduplicadas na projeção. Registros históricos não são reclassificados pela migration.

Outcomes mantêm organização, responsável, produtor, visita, plano de ação, compromisso, recomendação, data, confiança e fontes. `result.opportunity_id` e `result.decision_card_id` são vínculos adicionais, verificados no banco. INSERTs também geram auditoria; resultados avulsos sem relatório propõem LearningCandidate no contrato existente, sem promover conhecimento.

Impacto exige resultado e plano de ação do mesmo escopo, baseline, medição, unidade e método comparáveis, datas ordenadas e fonte. Delta = depois − antes. Estado padrão CAUSAL_NOT_PROVEN, independentemente do valor enviado pelo cliente. Validação causal exige administrador, justificativa, método, contrafactual e explicações alternativas. Toda revisão é auditada. Uma alteração técnica nunca gera venda automaticamente.

## Coach e revisão

O playbook existente produz observações sobre execução, sem classificação da pessoa. PRICE_TOO_EARLY exige cronologia explícita; ausência de problema não prova que houve discussão precoce de preço. Compromissos usam descrição/ação, responsável, prazo, prova e critério da próxima decisão. Relatório textual sozinho não fecha o ciclo da visita.

Feedback ÚTIL/ADAPTEI/EXECUTEI/DESCARTEI inclui resultado. Estados de revisão: PROPOSED → REVIEWED → APPROVED ou REJECTED; APPROVED → ROLLED_BACK. Nenhuma transição altera pesos automaticamente.

## APIs e superfícies

- GET `/api/revenue`: carteira própria ou `clientId`; projeções, coach, impactos e proveniência.
- PUT `/api/revenue/opportunities/:id/value-plan`: versão esperada obrigatória.
- POST `/api/v1/outcomes`: contrato canônico existente; `outcome_id` permite detectar repetição.
- POST `/api/revenue/impacts`: medição idempotente por requestId.
- POST `/api/revenue/coach/:id/feedback`: feedback idempotente.
- POST `/api/revenue/learning/:id/review` e `/api/revenue/impacts/:id/validation`: revisão administrativa, auditada.
- GET `/api/management/revenue`: unidade atual, com período e filtros existentes da gestão.

Home mostra Valor em movimento; Cliente 360, Oportunidades e Visitas têm detalhes progressivos, registro de resultado, ValuePlan e medição. Gestão separa categorias e comportamento; resultados/impactos usam o período, carteira e pipeline representam estado atual. Não há ranking de pessoas. Copilot usa estas mesmas regras para as oito perguntas de receita e coach, sem chamada generativa para calcular fatos.

## Isolamento, performance e rollback

A autorização consulta membership ativo. Leituras e gravações verificam tenant, owner e propriedade atual do produtor; homônimos não compartilham fatos. Gestão resolve unidade e fatos no mesmo snapshot. Fixtures K5/Passo09 são excluídas da receita. Flags novas usam o registry e histórico do Passo08; defaults somente staging/test/development, com rollback de revisão. Desligar a UI não remove fatos ou salvaguardas de evidência.

Migration 019 é aditiva. Projeções, cartões, observações de share e auditoria são gravados em lotes. Leitura de receita dispensa a expansão territorial pesada do contexto; não recalcula carteira em cada render. A UI pagina detalhes de produtores e preserva totais completos. Tests incluem 250 produtores e mais de mil cartões com número limitado de queries, e projeção de 10 mil produtores.

HUB, VAL CRED, SOG e Agro/Geo mantêm contratos e fluxos anteriores. Nenhuma integração externa é simulada como real; intenções não se tornam negócios fechados. Expansão pós-conversão usa apenas outcomes comerciais comprovados e sugere descoberta, sem criar contato, oportunidade ou pedido.
