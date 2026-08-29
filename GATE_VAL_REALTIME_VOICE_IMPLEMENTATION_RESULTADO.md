# Gate VAL Natural Realtime Voice — Resultado

Data: 2026-08-29

Branch: `fix/val-realtime-natural-voice-v1`

Base técnica preservada: `baca0d678979f376dd389de4e6f86bdb2a97b3a3`

## Classificação atual

**VAL NATURAL REALTIME VOICE = REPROVADO (gate ainda aberto).**

A implementação local existe, mas ainda não há CI remoto, deploy do novo commit, sessão real, latência do provider nem UAT físico. Não é permitido converter esses itens em PASS por inferência.

| Capacidade | Estado | Evidência |
|---|---|---|
| WebRTC | PASS_LOCAL | implementação + contrato automatizado |
| ephemeral auth | PASS_LOCAL | auth/tenant/tester/rate/budget + secret 30 s |
| microphone | PARTIAL | getUserMedia implementado; físico pendente |
| VAD | PARTIAL | semantic VAD configurado; físico pendente |
| turn detection | PARTIAL | eventos/métricas implementados; físico pendente |
| transcription | PARTIAL | streaming configurado; provider real pendente |
| first audio latency | NOT_MEASURED | staging/UAT pendentes |
| TTS | PARTIAL | áudio remoto WebRTC implementado; físico pendente |
| barge-in | PARTIAL | provider interrupt + cancel/clear; físico pendente |
| context continuity | PASS_LOCAL | contexto/estado Copilot canônicos |
| tools | PASS_LOCAL | gateway governado reutilizado |
| multimodal | PARTIAL | mesma thread preservada; UAT pendente |
| memory governance | PASS_LOCAL | revisão obrigatória; persistência automática ausente |
| iOS | NOT_EXECUTED | aparelho físico obrigatório |
| Android | NOT_EXECUTED | aparelho físico obrigatório |
| cost | PASS_LOCAL | teto/reserva/expiração/deduplicação; consumo US$ 0 |

## Regressão local

- 985/985 testes PASS;
- VAL/PWA build PASS;
- PWA stamp/verify PASS;
- Manual build PASS;
- bundle audit PASS;
- voice golden automatizado PASS, sem substituir UAT físico;
- nenhum secret permanente criado/exposto;
- nenhum consumo pago realizado.

## Recomendação

`NO-GO` para aprovação do gate. Próxima ação permitida: publicar somente a branch de correção, exigir CI verde, implantar no Railway staging isolado com flag limitada a testers e executar desktop/iPhone/Android UAT dentro do teto de US$ 25.

Rollback: desligar `VAL_REALTIME_VOICE_ENABLED`; o fallback Push-to-talk/Voice Capture permanece intacto. Não requer migration reversa.

Não fazer merge, não promover para produção e não iniciar Passo 07.
