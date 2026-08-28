# VAL Performance Architecture v2

## Decision

VAL vNEXT improves response time by routing each request through the smallest governed path that can answer it without losing specificity. It reuses the existing Context, Memory, MCA, MIA, model and tool engines. This architecture does not authorize production deployment, `main` merge or Passo 07.

## Reasoning paths

| Path | Primary use | Engine rule |
|---|---|---|
| `FAST` | Last visit, open commitment, an already-computed summary or session command | Deterministic authorized retrieval; do not run the complete reasoning engine. |
| `CONTEXT` | Approach, barrier and follow-up that depend on a material subset of the producer context | Load only facts that can change the answer. |
| `DEEP` | Multi-domain thesis crossing agronomy, profile, history, opportunity and price | Run the complete governed pipeline and expose material gaps. |
| `TOOL` | Mapping, soil, diagnosis, scan, calculator or label | Execute the authorized tool first; reason over its output only when material. |
| `LIVE_DATA` | Market, commodity, weather, current price and news | Require a current authorized source, observation date and freshness; fail closed when unavailable. |

The capability router records both `capabilities_planned` and `capabilities_used`. Planning a capability or rendering its card is not evidence that the tool ran.

## Materiality control

Before invoking a reasoning stage, the orchestrator evaluates: **“Can this information materially change the answer?”**

- A literal authorized fact remains on `FAST`.
- A current-source lookup remains on `LIVE_DATA` unless the user asks for impact, comparison or strategy.
- A tool result invokes reasoning only when interpretation is material.
- Context and Deep paths may invoke the model because the answer changes with scoped facts or cross-domain alternatives.

Authorization, tenancy, persistence, memory approval, safety and prescription remain deterministic controls outside the model.

## Context loading, parallel work and cache

Independent safe reads may execute in parallel. Dependent operations remain ordered—for example, authorization precedes client-scoped retrieval, and a tool result precedes its interpretation.

The session cache is keyed by all three identifiers:

`tenant_id + owner_id + client_id`

Its default TTL is 30 seconds, with in-flight load deduplication and bounded entries. A missing key component fails closed. `REGISTER` confirmation or another material change invalidates only the affected scope. Cache statistics are content-free. The cache never converts session context into confirmed memory and never provides a cross-tenant fallback.

## Latency measurements

The canonical stages are:

| Stage | Meaning |
|---|---|
| `AUTH` | Session and authorization resolution |
| `INTENT` | Natural command and intent routing |
| `CONTEXT` | Authorized contextual retrieval |
| `MEMORY` | Confirmed-memory retrieval |
| `MCA` | Commercial analysis stage when executed |
| `MIA` | Agronomic analysis stage when executed |
| `TOOL` | Capability execution |
| `MODEL` | Model inference |
| `VALIDATION` | Output, safety and contract validation |
| `TTS` | Server-side text-to-speech when executed |
| `TOTAL` | Request start to completed application result |
| `TTFR` | Request start to first useful conclusion or usable structured card |

An unexecuted stage is `null`, never zero. Legacy engine measurements for MCA, MIA and model inference are inherited only when actually present. The in-memory registry records content-free path/intent series and reports nearest-rank `p50`, `p75`, `p90` and `p95`.

`TTFR` is not HTTP first byte. In the current non-streaming response contract it equals the completed usable response unless the application explicitly reports an earlier usable result. The benchmark never infers TTFR from transport timing.

## Streaming and voice boundary

Text streaming and progressive server TTS were evaluated but are not claimed as implemented in this cycle. Processing labels may be shown only for real stages. Browser-native speech playback does not create a server `TTS` measurement, so that stage remains `null`; physical audibility and progressive playback require device UAT.

## Golden Performance Set

`evals/val-golden-performance-v1.json` declares GP-001 through GP-016 across all five paths. `scripts/val-performance-benchmark.mjs` supports:

- offline, metric-only synthetic samples; and
- explicit staging-only probes with host and opt-in controls.

Disabled cases remain `SKIPPED`, not passed. Microphone, camera, file picker and authenticated producer context are browser/device UAT scenarios and are not simulated as backend performance successes. A distribution is only reported for observed samples; missing cases and missing TTFR remain visible.

The reproduced local integration run is recorded in `VAL_GOLDEN_PERFORMANCE_RESULT_v1.md` and `evals/val-golden-performance-local-result-v1.json`: 320/320 technical executions, 20 per GP, zero path mismatch, zero target miss and zero technical error. Quality, specificity, grounding, service class and explicit PARTIAL device boundaries are part of every sample. This evidence does not replace Railway or physical-device measurements.

The measured critical path is MCA/`buildCommercialComposition` for GP-004, GP-011 and GP-014 (93.7%–96.9% of local p95). Its p95 remains below the component SLO in `VAL_PERFORMANCE_SLOS_v1.md`; changing it now would be speculative, so no additional MCA/MIA rewrite was made.

## Acceptance evidence

Performance approval requires all applicable layers:

1. unit tests for routing, materiality, cache isolation, stage semantics and percentile math;
2. integration/regression tests for existing engine and tenancy contracts;
3. release builds for VAL/PWA and Manual;
4. authenticated staging samples for supported golden probes;
5. controlled browser UAT for useful-response behavior; and
6. physical-device UAT for microphone, camera and audio.

Documentation or a single fast response is not sufficient evidence of improved p50/p95. Any unsampled distribution or device-only behavior remains a gate qualification.

## Rollback boundary

The change is adapter, routing, UI and observability work without a destructive migration. Rollback is performed by repointing staging to the previously verified commit. No memory, attachment or tenant data should be rewritten to roll back this architecture.
