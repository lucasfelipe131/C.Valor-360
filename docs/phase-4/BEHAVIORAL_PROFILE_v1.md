# BehavioralProfile v1

Versão: `val.behavioral_profile.v1`
Owner: MIC

O contrato estima como o decisor prefere avaliar uma decisão. Não é diagnóstico psicológico, não infere atributo sensível e não autoriza manipulação.

## Campos

- `subject_id`, `organization_id`, `context_snapshot_id`;
- `profile_weights`: `analytical`, `relational`, `innovative`, `conservative`, sempre normalizados para soma 1;
- `signals[]` com `reason_code`, dimensão, delta, origem, data e `evidence_ref`;
- `evidence_refs[]`, `confidence`, `updated_at`, `version`;
- `approach_guidance`: comunicação, prova, ritmo, risco e até três perguntas sugeridas;
- `missing_information[]`;
- `legacy`: tags preservadas e auditoria de `DIGITAL`.

Sem sinais, os pesos ficam neutros em 0,25 e a confiança permanece baixa. Sinais mistos produzem perfil híbrido. A confiança depende de sinais rastreáveis e diversidade de evidência.

## DIGITAL

O cálculo histórico trata Digital como quinta tag nas perguntas 7–18. A auditoria das alternativas mostra predominância de canal, formato, rapidez, celular, vídeo e atendimento remoto. O Projeto Mestre usa “analítico digital” como combinação, enquanto formaliza quatro preferências decisórias.

Decisão da Fase 4:

- preservar tag e score legados;
- classificar Digital como `INTERACTION_PREFERENCE` no adapter;
- não convertê-lo automaticamente em outro perfil;
- não migrar ou reclassificar registros existentes.

## Invariantes

- fatos técnicos não mudam entre perfis;
- evidência é recuperável;
- correção futura pode recalcular pesos sem apagar histórico de origem;
- busca e cálculo exigem o mesmo `organization_id` do ContextSnapshot.
