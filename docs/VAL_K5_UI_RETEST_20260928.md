# Reteste UAT A — 28/09/2026

SHA executado: `0fa72e3895bc01ecfff3cf51601cc8ab22acae4b`.
Onze submissões pela UI de staging autenticada como UAT A, cada uma em nova conversa geral sem produtor. Nenhuma alteração de código durante a rodada.

- SUCCESS: AG-001, AG-014, AG-018.
- GENERIC_FALLBACK: AG-003, AG-006, AG-011, AG-016, AG-019, AG-022, AG-024, AG-029.
- HTTP 200: 11/11. Provider calls: 22. Custo estimado pela aplicação: US$ 0,00320895 (não é conciliação de fatura).
- Provider failure e HTTP 429: zero. Telemetria correlacionada por request_id; nenhuma chamada desconhecida.
- Os oito fallbacks terminaram em GENERAL_ANSWER_VALIDATOR / UNSUPPORTED_CLAIM. Há também registros de GLOBAL_INDIVIDUAL_ASSERTION, GLOBAL_NOT_SEMANTICALLY_GENERAL e UNSAFE_GENERAL_ANSWER em tentativas. Não presumir falsos positivos sem reprodução.
- HISTORICAL_ROOT_CAUSE permanece UNRECOVERABLE_EVIDENCE_GAP. Texto bruto das respostas rejeitadas não está disponível; não atribuir a elas a reprodução construída abaixo.

## Reprodução offline e mudança

Uma explicação geral completa sobre vigor e germinação passa. Prefixá-la com `Sim.` isolado cria um claim sem token material, rejeitado como UNSUPPORTED_SPECIFIC_CLAIM. O mesmo ocorre com `Não.`; essa variante pode contradizer a explicação e deve continuar bloqueada.

A mudança acrescenta apenas orientação geral de redação ao prompt: conclusão inicial em frase completa, conceito explícito e antecedente claro. Não altera perguntas, respostas esperadas, seleção, grounding, safety, escopo ou proveniência. Não remove nem aprova automaticamente fragmentos gerados.

Regressões preservam entrega da proposição completa e rejeição de fragmentos/caudas privadas ou reguladas. Focados: 72/72 PASS. A eficácia da orientação depende de reteste dos oito casos após CI e staging no novo SHA.

K5 300/300 ainda não executado: corpus original completo e rubrica versionada ainda em recuperação. G1–G4 preservados; UAT físico e avaliação humana permanecem pendentes.
