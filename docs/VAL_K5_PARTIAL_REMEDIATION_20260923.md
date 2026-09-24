# K5 — correções da rodada parcial (23/09/2026)

Base: `3b789f8db96ccd582f01b63c234d4946e3ad94cc`, PR #107, branch `integration/val-pr106-rodada14-20260920`.

## Evidência preservada

30/300 executadas; 10 PASS, 20 FAIL válidos, 16 GENERIC_FALLBACK, 0 SEMANTIC_400 e 0 INVALID_FIXTURE_EXECUTION. Nenhuma reclassificação. AG-001–AG-030 não exigem fixtures (`fixture_required=false`, sem precondição de sequência). As fixtures ausentes não explicam seus FAIL.

Corpus SHA256: `bce28f8ecbe94a8af25062733fbff4d651e4a054bd54f0abd71fbb2bcb24ec21`.
Rubrica SHA256: `d44e08e65a2abc6014f584c4870b9afccfb79b52f7ced914885b78bc7b5f7f99`.
Originais preservados em `raw-results.jsonl`, `review-batch-001.json` e `backend-batch-001.json`, já entregues no pacote da rodada. Testes locais abaixo não contam como K5 nem como aprovação humana.

## Diagnóstico dos 20 FAIL

| CASE_IDS | CATEGORY | EXPECTED_BEHAVIOR | ACTUAL_BEHAVIOR | ROOT_CAUSE | CODE_AREA | FIX_REQUIRED |
|---|---|---|---|---|---|---|
| AG-001, AG-003, AG-006, AG-007, AG-008, AG-011, AG-012, AG-013, AG-014, AG-016, AG-018, AG-020, AG-022, AG-024, AG-025, AG-029 | fallback / grounding | Explicação pertinente ou esclarecimento específico da dúvida já formulada | Mesmo pedido genérico de informar cultura/conceito/decisão | O caminho sem resposta aceita descarta o motivo e retorna `noCoverageExecution`. A validação lexical exige inclusive verbos da pergunta; esse defeito foi reproduzido offline. As saídas originais descartadas e os motivos internos por caso NÃO foram registrados; não é possível afirmar que esse defeito explica sozinho todos os 16. | `selection.js`, `general-answer-provider.js`, `capability-executor.js` | Desconsiderar formas verbais/gramaticais na comparação de assunto, preservando alvo/cultura; registrar motivos de rejeição sem texto descartado. Reteste pago ainda necessário para confirmar cada caso. |
| AG-004 | source / routing | Orientar estratificação da amostragem de solo | Recusa por ausência de bula de produto | `mistur*` aciona exigência regulatória para a instrução de não misturar baixada e encosta | `general-answer-provider.js` | Exceção estrita para instrução negativa de separação de amostras/estratos; manter pedidos de mistura de produtos/dose bloqueados. |
| AG-019 | retrieval / grounding | Responder se chuva leve sempre elimina volatilização | Trecho sobre incorporação de nitrogênio sem responder à afirmação universal | KI-123 selecionado por tema, tratado como resposta completa por `TITLE_PHRASE`; não responde ao qualificador da pergunta | `selection.js`, `capability-executor.js` | Separar relevância de retrieval e suficiência para entrega direta; afirmação universal sem cobertura explícita segue para resposta geral. |
| AG-023 | retrieval / context | Observações sobre profundidades desuniformes sem assumir cultura | Orientação específica para canola | KI-167 passa por tema apesar de nenhuma cultura ter sido informada | `selection.js`, `capability-executor.js` | Impedir que trecho específico de cultura responda diretamente a consulta genérica; não alterar o ranking/retriever. |
| AG-030 | retrieval / grounding | Comparações necessárias antes de atribuir falha de estande ao tratamento de sementes | Comparação entre semente certificada e salva | Trigger parcial `falha de estande` entrega KI-188 sem cobrir tratamento de sementes | `selection.js`, `capability-executor.js` | Conferir cobertura do assunto completo, incluindo termos comuns que a frequência no acervo antes excluía. |

Não há evidência suficiente para atribuir os FAIL a cálculo, latência, vazamento ou fixtures. Nenhuma dessas causas foi inventada. A correção do código não transforma automaticamente os FAIL em PASS.

## Alterações e regressões

- Mesmos modelos, prompts enviados ao provedor, limites de saída e máximo de duas tentativas existentes.
- Validação temática deixa de exigir repetição de verbos; substantivos/alvos e conflito de cultura continuam protegidos.
- Seleção do acervo permanece intacta: somente a decisão de entregar o trecho diretamente exige cobertura da pergunta.
- Motivos técnicos distinguem ausência/incompletude/limite/sentinela e rejeição por tema/segurança/grounding; nenhum texto descartado ou credencial é registrado.
- Quatro regressões offline em `test/val-k5-partial-remediation.test.js`: amostragem versus mistura regulada; verbo versus assunto; três respostas curadas inadequadas; diagnóstico de rejeição sem vazamento de texto.
- Testes anteriores são preservados. Uma regressão intermediária em comparação nominal de preços foi corrigida preservando aliases do título/triggers; não foi removida nem enfraquecida.

## Contas e fixtures — bloqueio observado

A tentativa de login destinada à conta UAT A retornou à identidade administrativa `integration01@val.test`. Essa sessão NÃO foi usada para cadastrar fixtures nas carteiras UAT.

A leitura atual do painel administrativo mostra para `uat.val.20260919.a@example.test` e `uat.val.20260919.b@example.test`: perfil consultant, Liberado, **Troca de senha pendente**, zero produtores, zero acessos e última atividade Nunca. Isso diverge da ativação humana informada. Não comprova login de consultor, sessão individual, isolamento nem ativação concluída. Nenhuma senha, credencial, secret ou usuário foi alterado/criado.

| FIXTURE | ACCOUNT | OWNER | PRODUCER | PRECONDITIONS | STATUS |
|---|---|---|---|---|---|
| Produtor UAT A | Consultor A existente | Não comprovado por sessão própria | Não criado nesta execução | Canal/fonte confirmados; área irrigada zero; aniversário/telefone ausentes; visita realizada; intenções sem contrato | BLOCKED |
| Produtor UAT B | Consultor A existente | Não comprovado por sessão própria | Não criado nesta execução | Dados distintos; hobby ausente; safra separada; produtividade como meta | BLOCKED |
| Produtor exclusivo para PR-011 | Consultor B existente | Não comprovado por sessão própria | Não criado nesta execução | ID conhecido; acesso proibido ao consultor A | BLOCKED |

A ficha sintética B anteriormente corrigida na carteira administrativa não substitui a fixture canônica da carteira UAT A.

CANONICAL_FIXTURES_READY = NO
ISOLATION_PRECONDITION_READY = NO
PR011_READY = NO
HOBBY_FIXTURE_READY = NO

## Retestes e custo

RETEST_REQUIRED_CASES = 30: AG-001–AG-030.

Os 20 FAIL precisam de reteste. Os 10 PASS históricos continuam PASS naquele SHA; porém a validação comum e a entrega curada mudaram. AG-027 usa trecho sobre milho sem cultura informada, diretamente afetado pela nova guarda. Para as respostas geradas dos demais PASS, os registros não preservam todas as tentativas descartadas: não é possível garantir que o novo validador manteria exatamente o mesmo caminho. Portanto não se afirma preservação automática dos 10 no novo SHA.

ADDITIONAL_PAID_CALLS_REQUIRED = 30 submissões canônicas de reteste. O número interno de chamadas ao provedor pode variar de zero a duas por submissão pelo mecanismo já existente; não é possível informar antecipadamente o número real faturado. O limite de duas tentativas não foi ampliado. Solicitar autorização específica antes de qualquer execução. As 270 restantes continuam pausadas.

Nenhuma chamada K5, reteste pago ou chamada exploratória foi realizada nesta etapa. CI/staging e SHA da candidata devem ser comprovados após publicação automática; este documento não antecipa PASS.
