# Auditoria e plano executado — Voice Capture

Status: registro consolidado da auditoria que orientou a implementação local. Não é resultado de gate.

## Base escolhida

HEAD remoto confirmado antes da branch:

| Referência | Hash |
|---|---|
| `origin/main` | `f405617405fb66811207fdf006c2fbdaebfb8c9d` |
| `origin/phase2/core-contracts` | `498ebf3f31fde404dd11fb7eca894e6c85b7169a` |
| `origin/phase3/memory-context` | `172ca81214d2364d38b8fd0a144af492cd543566` |
| `origin/phase4/behavior-decision-value` | `b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec` |
| `origin/phase5/execution-insight` | `ea82fdaa9a401505e661be5409e21ae2d6a3112a` |
| `origin/phase6/visit-learning-loop` | `7c0a8e7f6edbf581b893dc17eae43528e464b6f0` |
| `origin/integration/val-v1-staging` | `b5967758428dc501d97407bb50d2cdb200c4ade7` |

`git merge-base --is-ancestor origin/main origin/integration/val-v1-staging` foi verdadeiro. O histórico da integração contém as pontas das Fases 02–06. A branch `feature/voice-capture` foi criada nessa ponta, não em `main`.

## Auditoria do suporte existente

| Área | Encontrado antes do VCE | Consequência para o plano |
|---|---|---|
| uploads/anexos | `/api/val/attachments`, `val_attachments`, limite de 6 MB, base64 e SHA-256 | reutilizar atrás de abstração temporária |
| mídia/áudio | attachment aceita áudio, mas não havia agregado transversal | criar VoiceInteraction, sem duplicar upload genérico fora do adapter |
| transcrição | `server/visit-loop/audio.js` e provider injetável para Visit Report | preservar compatibilidade e criar porta transversal separada |
| OpenAI | cliente server-side, secrets por ambiente, sem chave no browser | usar o mesmo padrão; provider abstrato |
| arquivos temporários | não havia storage de mídia em filesystem; o novo probe precisa de temp curto | usar `mkdtemp`, modo 0600 e remoção em `finally` |
| storage | bytes em `val_attachments.content_base64` no PostgreSQL | assumir como ponte e documentar object storage como alvo |
| Visit Report | `source_type` aceita `TEXT/AUDIO`; `transcript_ref` e `transcript_id` existem | adaptar POST_VISIT ao Visit Loop, não criar report paralelo |
| Interactions/MMI | confirmação da Fase 6 já escreve Interaction e memórias | reaproveitar funções/transações e preservar epistemologia |
| Commitment/Outcome/Learning | pipeline transacional existente | somente POST_VISIT usa Outcome/Learning; nunca KnowledgeItem automático |
| observabilidade | allowlist em `server/observability.js` | ampliar apenas metadata operacional de voz |
| body HTTP | `VAL_MAX_BODY_BYTES`, padrão 10 MB | data URL de áudio de 6 MB cabe; responder 413 antes de persistência parcial |

## Riscos identificados

### Áudio em PostgreSQL

- expansão base64;
- crescimento de WAL e backup;
- restore mais lento;
- retenção/deleção custosa;
- maior raio de exposição se leitura do attachment falhar no escopo.

Mitigação implementada: porta de storage, referência opaca, limite baixo, anexo exclusivo, FKs tenant-aware, leitura por ator/produtor e política explícita de migração futura. Object storage não foi criado por exigir autorização/custo.

### Transcript como instrução

Risco: prompt injection, comando, prescrição ou classificação sensível.

Mitigação implementada: transcript delimitado como `input_text` não confiável, schema fechado, filtros determinísticos, confirmação humana e revalidação das edições.

### Retry e concorrência

Risco: worker antigo persistir depois de cancelamento/retry e confirmação duplicar efeitos.

Mitigação implementada: compare-and-set por estado/revisão, `processing_lease` UUID, abort local, verificação antes/depois do provider e confirmação transacional.

### Duração informada pelo browser

Risco: metadata forjada ou container inválido.

Mitigação implementada: assinatura binária e duração medida com `ffprobe` no servidor.

### Confirmação indevida

Risco: candidato rejeitado/hipótese virar fato ou Visit Report ser criado com revisão inválida.

Mitigação implementada: decisão para todos os candidatos, epistemologia preservada, safety reaplicado e validação POST antes de criar report pendente.

## Contratos reutilizados

- `VisitReport v1` e `VisitTranscript v1` da Fase 6;
- `MemoryRecord`/ContextSnapshot da Fase 3;
- sinais MIC e preparação MDI/MVV da Fase 4;
- `Commitment v1`, ActionPlan e PrepareVisit da Fase 5;
- `Outcome v1` e `LearningCandidate` da Fase 6;
- `val_attachments` como storage temporário.

Novos contratos foram limitados a `VoiceInteraction v1` e `VoiceCandidate v1`.

## Plano adotado e estado

| Etapa | Entrega | Estado |
|---:|---|---|
| 1 | contratos e máquina de estados | implementado localmente |
| 2 | migration expand-only e repositório tenant-safe | implementado localmente |
| 3 | abstração de storage + validação/ffprobe | implementado; `ffprobe` real aprovado com WAV sintético |
| 4 | TranscriptionProvider OpenAI/mock/unavailable | implementado localmente |
| 5 | extração segura e fallback determinístico | implementado localmente |
| 6 | confirmação e adaptadores de domínio | implementado localmente |
| 7 | APIs/OpenAPI/rate limit/observabilidade | implementado localmente |
| 8 | UI móvel contextual e fallback textual | implementado localmente |
| 9 | testes, regressões e builds | 601/601 na suíte; Voice 93/93; fases 164/164; Vite/PWA e Manual verdes |
| 10 | gate PostgreSQL 16, drift, backup/restore | aprovado no Validate #178 |
| 11 | smokes HTTP, deploy e OpenAI real em staging | deploy/health e transcrição real aprovados; jornada autenticada integral pendente |
| 12 | navegador e dispositivos móveis físicos | pendente |
| 13 | `GATE_VOICE_CAPTURE_RESULTADO.md` | criado; gate reprovado pelas provas humana/mobile pendentes |

## Limites preservados

- nenhuma mudança em produção;
- nenhum merge em `main`;
- nenhum Passo 07;
- nenhum recurso pago adicional;
- nenhuma gravação secreta;
- nenhum dado real em staging;
- nenhuma chave em código, log ou documentação;
- nenhuma promoção `áudio → KnowledgeItem`.
