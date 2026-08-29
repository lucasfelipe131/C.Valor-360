# GATE VAL CONVERSATIONAL OS REPROVADO

Data: 2026-08-29
Escopo: VAL Conversational Operating System vNEXT, somente staging
Decisão: **NO-GO para publicação/deploy até revisão humana da árvore; NO-GO para aprovação final até UAT físico.**

## Baseline reproduzido

| Item | Evidência |
|---|---|
| Branch de origem | `fix/val-realtime-natural-voice-v1` |
| Commit/tree congelados | `9267c28eceef405aa52d71700af9f4c5f409c4e6` / `eabbdb9d5d8d31ad55a6af4ec90090789656c7a5` |
| Branch local de evolução | `feature/val-conversational-os-vnext` |
| PR baseline | #92, DRAFT |
| CI baseline | 8/8 PASS |
| Railway baseline | `VAL - STAGING INTEGRATION 01 / val-web-staging`, deployment `7f7ec254-315f-485d-9390-ca3890716614`, SHA-base |
| Saúde baseline | `/live`, `/health`, `/ready` e runtime metadata PASS; PostgreSQL e IA ready/configured |
| Testes antes | 985/985 PASS |
| Builds antes | VAL/PWA PASS; Manual PASS; bundle PASS |

O hostname/environment interno chamado `production` continua sendo o ambiente isolado de staging informado; produção real não foi tocada.

## Implementação local

- `ProducerEntityResolver v1`: nome, token, alias, propriedade, fuzzy de transcrição, homônimos, cliente atual e anterior.
- Índice leve por tenant + owner, TTL de 30 s, preload após login e invalidação após mutações conhecidas.
- `VALGlobalIntentRouter v1` com ações FAST de OPEN/SEARCH/NAVIGATE/PREPARE.
- `VALWorkspaceContext v1` e validação dupla de ações no browser.
- Troca de produtor fail-closed: limpa contexto específico e preserva somente referência recente mínima.
- Context preload em background depois de entity resolution.
- Métrica `ENTITY` separada de `INTENT` no trace de servidor.
- Follow-ups “resume...”, “me manda escrito” e “fala de novo” reutilizam a resposta atual.
- Realtime tool passou a reconhecer `WORKSPACE` e devolver homônimos autorizados.
- Permissão do microfone ocorre antes de reservar orçamento/criar client secret pago.
- Semantic VAD passou de `auto` para `low` por padrão, configurável sem secret.
- Push-to-talk, Voice Capture, safety, memory review e ferramentas canônicas foram preservados.

## Regressão e builds

| Check | Resultado |
|---|---|
| Suíte completa | **996/996 PASS** |
| VAL/PWA build + stamp/verify | **PASS** |
| Manual build | **PASS** |
| Bundle audit | **PASS** |
| Voice golden | **PASS_AUTOMATED_CONTRACT**; physical UAT NOT_EXECUTED |
| Testes novos | entity resolver, cache, global router, workspace, voice ops, turn-detection fixtures |
| Diff hygiene | `git diff --check` PASS |

## Bundle

| Métrica | Antes | Depois | Leitura |
|---|---:|---:|---|
| Initial JS | 217.273 B | 220.230 B | +2.957 B (+1,36%) |
| Initial JS gzip | 69.475 B | 70.502 B | +1.027 B (+1,48%) |
| Largest application chunk | 409.146 B | 409.146 B | sem regressão |
| Auxiliary PDF worker | 1.417.586 B | 1.417.586 B | lazy/auxiliary, justificado |
| Oversized application chunks | 0 | 0 | PASS |

## Latência

Benchmark de componente local, 500 clientes sintéticos e 2.000 amostras:

| Caso | P50 | P90 | P95 |
|---|---:|---:|---:|
| OPEN_CLIENT exact + route | 1,125 ms | 1,670 ms | 2,046 ms |
| SEARCH_CLIENT fuzzy | 2,580 ms | 4,224 ms | 6,199 ms |
| NAVIGATE_AGRONOMY | 0,006 ms | 0,006 ms | 0,007 ms |
| PREPARE_VISIT route | 0,005 ms | 0,005 ms | 0,005 ms |
| FOLLOW_UP_RESUME | 0,001 ms | 0,002 ms | 0,002 ms |

Esses valores são `LOCAL_COMPONENT_ONLY`. A observação anterior de `/api/val/chat ≈ 38,548 s` não pode ser declarada corrigida sem deploy e medição no staging. `speech_end → first_audio` também permanece sem nova evidência física.

## Áudio cortado: antes/depois

- Antes: corte e turn detection agressivo observados em dispositivo físico.
- Depois no código: `semantic_vad.eagerness=low`; barge-in/create-response mantidos; fixtures TD-001–TD-007; microfone antes da sessão paga.
- Depois físico: **NOT EXECUTED**. Não há evidência para afirmar que o corte foi eliminado.

## Cobertura

`VOICE_OPERATION_COVERAGE = 74%` na prioridade inicial. Reads e tools estão mais completos; writes de visita/compromisso, filtros de Clientes e lifecycle pós-visita permanecem parciais. Detalhes: `VAL_VOICE_OPERATION_COVERAGE_v1.md` e `VAL_SYSTEM_VOICE_AUDIT_v1.md`.

## Classificação do gate

| Capacidade | Estado | Evidência/gap |
|---|---|---|
| ENTITY RESOLUTION | PASS_LOCAL | exato, alias, propriedade, fuzzy, ambiguidade, recent/current, cross-scope |
| CLIENT SEARCH | PASS_LOCAL | fast path e cache; staging/voz física pendentes |
| TURN DETECTION | PARTIAL | tuning/config PASS; UAT físico pendente |
| AUDIO CUTTING | NOT_VERIFIED | sem depois físico |
| LATENCY | PARTIAL | componentes rápidos; E2E/first audio não medidos |
| VOICE NAVIGATION | PASS_LOCAL | OPEN/SEARCH/NAVIGATE/PREPARE; persistência entre páginas parcial |
| VOICE READ | PASS_LOCAL | última visita, contexto, agronomia e mercado preservados |
| VOICE WRITE | PARTIAL | REGISTER governado; create/update/complete incompletos |
| PREPARE | PASS_LOCAL | adapter e roteamento existentes; físico pendente |
| VISIT | PARTIAL | abrir/preparar; create/update por voz incompletos |
| POST-VISIT | PARTIAL | Voice Capture/VisitLoop existem; orquestração realtime parcial |
| OPPORTUNITIES | PARTIAL | leitura sim; ação/filtro/update parciais |
| AGRONOMY | PASS_LOCAL | módulos/adapters canônicos preservados |
| TOOLS | PASS_LOCAL | 9 calculadoras, mapa, solo e diagnóstico passam regressão |
| REALTIME | PARTIAL | WebRTC/VAD/tool contracts PASS; nova árvore não implantada |
| BARGE-IN | PARTIAL | configuração/teste contratual; físico pendente |
| MEMORY | PASS_LOCAL | confirmação obrigatória; hipóteses session-only |
| TENANCY | PASS_LOCAL | cache, resolver, contexto e UI fail-closed |
| IOS | NOT_EXECUTED | aparelho real obrigatório |
| ANDROID | NOT_EXECUTED | aparelho real obrigatório |

## Riscos remanescentes

1. `semantic_vad=low` pode reduzir cortes e aumentar um pouco o fim de turno; somente UAT A/B físico decide.
2. Mudar de página fecha a superfície full-screen atual; hands-free persistente entre todas as telas ainda é parcial.
3. Filtros de Clientes, criação de visita, conclusão de compromisso e updates de Oportunidade ainda não têm adapters de voz completos.
4. A árvore está sem commit; `source.commitSha` não pode representar estas mudanças até haver commit técnico revisado.
5. Nenhum consumo pago Realtime novo foi realizado nesta rodada local; custo físico permanece desconhecido.

## Staging, iPhone e Android

- A árvore nova não foi publicada.
- Nenhum CI remoto existe para esta branch local.
- O Railway permanece no baseline `9267c28...`.
- iPhone real: NOT EXECUTED.
- Android real: NOT EXECUTED.
- Não houve tentativa de substituir evidência física por automação.

## Rollback

O baseline remoto e a branch `fix/val-realtime-natural-voice-v1` permanecem intactos. Como não houve commit, push ou deploy desta evolução, o rollback operacional é manter o Railway no SHA `9267c28...`. Qualquer descarte da árvore local deve ser feito somente com autorização humana explícita.

## Recomendação

**NO-GO para classificar o Conversational OS como aprovado.** A implementação local está tecnicamente apta para revisão e futura publicação controlada, mas o gate só pode mudar após commit/CI/deploy staging autorizados, smokes autenticados, medição E2E e UAT físico iPhone + Android.

Nenhum merge, produção ou Passo 07 foi executado.
