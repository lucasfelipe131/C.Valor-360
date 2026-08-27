# VAL Master Experience vNEXT

## Decision

VAL Experience + Performance + Agronomic Intelligence + Copilot + Brand Refinement vNEXT is an evolution of the existing system. It keeps the existing engines and specialized modules, makes VAL the common conversational/orchestration surface, and preserves direct drill-down for technical depth.

This document is the consolidated architecture and verification contract. It is not the final gate and does not authorize merge, production deployment, Passo 07, destructive migration, secret changes or paid-resource creation.

## Audited baseline

| Item | Audited value |
|---|---|
| Audit date | 2026-08-26 |
| Work branch | `feature/val-master-evolution-vnext` |
| Committed baseline at audit start | `277411dc32f0` |
| Remote | `origin` → `lucasfelipe131/C.Valor-360` |
| Manual package | `manual-do-agronomo` `0.2.0` |
| Last versioned migration | `20260825_006_soil_measurement_sets_expand.sql` |
| Prior full-screen gate | 763/763 tests and both builds passed on its own earlier commit; promotion remained blocked |

The prior 763/763 result is historical baseline evidence, not a claim that the shared vNEXT working tree has already passed. vNEXT must run its focused contracts, the complete regression and both builds again after all changes settle.

Current versioned migrations are additive:

1. `20260820_001_manual_tenant_scope_expand.sql`
2. `20260820_002_memory_context_expand.sql`
3. `20260822_003_execution_insight_expand.sql`
4. `20260823_004_visit_learning_loop_expand.sql`
5. `20260823_005_voice_capture_expand.sql`
6. `20260825_006_soil_measurement_sets_expand.sql`

No new or destructive migration is part of this verification infrastructure.

## Preserved product surfaces

The evolution must preserve, rather than replace:

- Home, Clients and Producer 360;
- visits, Prepare Visit, opportunities and commercial tools;
- full-screen Copilot and the existing entry shortcuts;
- Voice Capture and voice-review governance;
- Agronomic Intelligence and the Manual do Agrônomo;
- properties, fields, crop seasons, field history and area mapping;
- soil analyses and link/unlink history;
- image diagnosis, NutriScan, FitoScan, InsetoScan and DaninhaScan;
- the nine current calculators, labels, climate, market, commodities and news;
- reports, VAL Library, knowledge and evidence;
- commitments, outcomes, LearningCandidates, memory and audit trails;
- mobile/PWA and desktop access.

The UX rule is: simplify access, not capability inventory.

## One VAL architecture

| Layer | Responsibility | Explicit boundary |
|---|---|---|
| Full-screen Copilot | Conversation, multimodal composer, structured decision cards, context panel and drill-down. | It is not a generic model wrapper and does not replace specialized modules. |
| Intent and session command routers | Resolve a natural command, intent and likely reasoning path. | They do not authorize access, write memory or prescribe. |
| Orchestrator / capability router | Resolve tenant-scoped context and execute permitted capabilities. | The model may request a capability; the orchestrator decides whether it may run. |
| Existing engines | Context, Memory, MCA, MIA, MDI, MVV, MIC, MEX, VIS, Manual domain logic and tools. | vNEXT reuses these engines; it does not create a parallel reasoning engine. |
| Specialized modules | Mapping, soil, scans, calculators, labels, reports and deep navigation. | They remain directly accessible and are opened when deeper interaction is useful. |
| Persistence and governance | Confirmed memory, records, attachments, tenancy, safety, review and audit. | Conversation/session state is never promoted implicitly. |

## Copilot experience contract

The full-screen VAL page remains the primary conversation/work surface with:

- compact header and active producer/object context when authorized;
- central natural conversation plus structured decision cards;
- fixed text/voice/photo/file composer;
- optional context panel on desktop and a collapsible sheet on mobile;
- context-aware suggestions and a useful empty state;
- conversation continuity without duplicating confirmed memory;
- drill-down actions back to the traditional module;
- a short answer first, followed by rationale, numbers, agronomy and evidence on demand.

Structured answers may use decision, visit preparation, opportunity, commitment, agronomic insight, soil, diagnosis, calculation, market, evidence, knowledge and confirmation cards. A source-level card contract does not prove tool execution; each card must carry the evidence produced by the executed capability.

## Voice Decision Copilot

The conversational loop is:

`speech → capture → transcription → intent → authorized context → reasoning/tool → text and/or audio response → follow-up`

Required behavior:

- text, audio or text + audio preference;
- calm, clear agronomist/field-partner voice;
- natural session commands such as “Resume”, “Repete”, “Explica melhor”, “Só as Perguntas de Ouro”, “Agora por escrito”, “Agora fala comigo”, “Me mostra os números”, “Por que?”, “Registra”, “Não registra”, “Aprofunda” and “Só o essencial”;
- one to three Decision Interview questions per round when material facts are missing;
- no repeated question when the answer is already in authorized session context or confirmed memory;
- no persistence for speech or questions by default.

Unit/static evidence may prove command normalization, state transitions and error mapping. Only physical-device UAT can prove permission, recording, cancellation, transcription quality, TTS audibility and conversational continuity.

## Session context and confirmed memory

| Data class | Lifetime | May personalize the current reply? | May personalize a later session? |
|---|---|---:|---:|
| `SESSION_CONTEXT` | Current scoped conversation | Yes | No, unless explicitly reviewed and confirmed through the memory workflow |
| Pending/proposed/expired profile | Review lifecycle | No | No |
| `CONFIRMED_MEMORY` | Tenant/producer-scoped persisted memory | Yes | Yes, while valid and authorized |

`ASK`, tool calculation, scan triage and follow-up do not write memory. `REGISTER` requires an identified producer, review and explicit confirmation. Rejecting or choosing “use only in this conversation” leaves confirmed memory unchanged. Every new request must recompute premises from the selected producer and current authorized scope. Cross-tenant or invalid implicit context is discarded, not inherited.

## Reasoning-path contract

| Path | Use | Examples | Engine/materiality rule |
|---|---|---|---|
| `FAST` | Literal, deterministic retrieval or formatting | last visit, open commitment, summary, Golden Questions already computed | Do not invoke the full engine when deterministic authorized data answers the question. |
| `CONTEXT` | Material subset of current producer/session context | approach, barrier, natural follow-up, hero text context | Load only the facts that can change the answer. |
| `DEEP` | Multi-domain thesis and alternatives | cross agronomy, history, profile and price | Run the complete governed reasoning plan; ask for missing material facts. |
| `TOOL` | A specialized operation is primary | mapping, soil, scan, calculator, label | Execute the tool first; reason over its result only when material. |
| `LIVE_DATA` | Current external observation | market, commodity, weather, news, price | Require an authorized current source, date/freshness and fail closed. |

Before adding a stage, the orchestrator asks: “Can this information change the answer?” Safe independent retrievals may run in parallel. Session cache can reuse current client/crop/field, ContextSnapshot, valid profile, commitments and DecisionThesis, but must be invalidated after material change and must never cross tenant boundaries.

## Performance and observability

The performance objective is fast without becoming shallow. vNEXT measures total latency and `TIME_TO_FIRST_USEFUL_RESPONSE` (TTFR). TTFR is not transport first byte: it is the first useful conclusion or usable structured card reported by the application.

Canonical stage contract:

`AUTH`, `INTENT`, `CONTEXT`, `MEMORY`, `MCA`, `MIA`, `TOOL`, `MODEL`, `VALIDATION`, `TTS`, `TOTAL`.

Every metric set reports p50, p75, p90 and p95 using nearest rank. Text streaming, progressive TTS and processing labels are valid only when they reflect real events. A spinner or a transport byte is not a useful response.

The reproducible assets are:

- `evals/val-golden-performance-v1.json`: GP-001–GP-016 with declared path, target and evidence boundary;
- `scripts/val-performance-benchmark.mjs`: offline synthetic-sample aggregation or explicit staging-only probes;
- `test/val-master-evolution-contract.test.js`: suite, percentile and opt-in contract.

Sample mode:

```bash
node scripts/val-performance-benchmark.mjs \
  --samples path/to/synthetic-samples.json \
  --output path/to/result.json
```

The sample document must declare `fixture_class: "SYNTHETIC_ONLY"`, `contains_real_data: false` and contain metrics only. The benchmark rejects prompt/client payloads in samples.

Staging mode:

```bash
node scripts/val-performance-benchmark.mjs \
  --staging-url https://your-staging-host.example \
  --confirm-staging-only \
  --repeat 3
```

Staging mode refuses hostnames that do not identify staging or localhost. Optional credentials are read from process environment and never emitted. Disabled cases are reported as `SKIPPED`; microphone/camera/upload/context cases are not simulated as backend E2E. TTFR remains null when the application does not report it.

## Agronomic Intelligence

The page remains a native VAL surface organized into five clear domains:

1. Field and Soil
2. Diagnosis
3. Technical Decision
4. Context
5. Knowledge

The current Manual engine is embedded only as the specialized workspace behind those VAL groups. The VAL page owns hierarchy, hero, context handoff and orchestration; it does not copy the Manual’s parallel layout as a second product shell.

### Hero interaction contract

Each main action—voice, text, photo and file—must have a real handler, explicit `idle/loading/success/error` state, validation, error recovery and basic telemetry. The context payload may include producer, property, field, analysis and active tool, but only after authorized resolution.

Evidence boundaries:

- helper/unit tests can prove file policy, context normalization, session-only persistence, state transitions and permission-error mapping;
- component/source tests can prove that handlers and inputs are connected;
- controlled browser UAT must prove focus, picker/camera opening, dispatch and same-ecosystem response;
- physical-device UAT must prove microphone/camera behavior;
- tenant A/B fixtures must prove context isolation.

No static test may mark AGRO_HERO_001–010 as full E2E pass.

## Manual integration findings

The latest repository Manual was audited in `MANUAL_CURRENT_CAPABILITY_AUDIT.md`. The important facts are:

- area mapping is complete in the Manual, but geometry synchronization into normalized VAL fields is partial;
- soil analysis has robust linking/version/history infrastructure;
- NutriScan and FitoScan exist as safe visual-triage methodologies; the Copilot executor can select them and require an authorized image, but it does not execute the Manual scan engine. An explicit user action in the Manual can save a specialized, sanitized metadata-only result history, while raw photos remain transient and are not linked to VAL attachments;
- `FitScan` is an accepted input alias only; `FitoScan` remains the canonical product name;
- the VAL image bank is producer-scoped and tenant/consultant isolated, but is not yet linked to Manual scans or directly to property/field;
- the Manual has exactly nine calculators; VAL preserves access/routing and now has an initial deterministic cost/ha executor, while native execution parity for the nine Manual engines still requires adapters and numeric comparison;
- labels/catalog records vary in source completeness and must not be presented as currently valid without verified source/date.

The complete comparison and actions are in `VAL_AGRONOMIC_CAPABILITY_DIFF.md`.

## Mapping, images and calculators

### Mapping

Reuse `FieldMap`, `field-geometry` and official-source adapters. Preserve drawing, editing, import/export, area/perimeter/centroid and provenance. Do not claim geometry synchronization until `geometry_ref` and version can reproduce the saved polygon under concurrency and tenancy tests.

### Images and scans

Preserve `val_attachments` isolation, hash, status and binary boundary. Metadata-only listings must not expose binary; authorized content reads remain separately scoped. The Manual diagnosis record stores the reviewed result, context, image metadata/hash, provenance and safety only after an explicit user action; its sanitizer must continue removing image/base64/file-content fields. Any future scan-to-image-bank integration passes authorized attachment references, not duplicate binary. Selecting NutriScan/FitoScan or returning `READY` does not prove that the Manual engine ran. Triages never become prescriptions or confirmed facts automatically.

### Calculators

Reuse the nine current Manual engines. The initial cost/ha tool (`total_cost / area_ha`) is a separate deterministic capability and must not be labeled as parity for those nine. Each calculator adapter echoes normalized inputs, units, assumptions, source/version and structured result. Recording the result is a separate human action. `CALCULATE` routing, the generic cost/ha result or a drill-down card alone does not prove execution parity for all Manual calculators.

## Safety, evidence and tenancy

The following remain non-negotiable:

- tenant, actor and client authorization are enforced outside the model;
- current market/weather/label claims require source and date;
- image output is triage with evidence gaps and human review;
- dose, mixture, compatibility, prescription and label validity remain governed;
- model output cannot approve memory, persistence, permissions or a technical prescription;
- source refs and provenance identify what was actually used;
- ambiguous or material missing data produces one to three questions, not invention;
- a tool error, missing provider or invalid upload is an error, never an empty success.

## Brand refinement boundary

The refinement preserves the VAL blue/green identity and existing design-system base. Adaptive dark/light/mono/compact/icon variants may improve legibility and presence, but they are not a rebrand. Source assets, small-size rendering and surface/theme selection need their own visual verification; brand files do not prove product behavior.

## Verifiable test matrix

| Evidence layer | What it can approve | What it cannot approve |
|---|---|---|
| Unit/contract | routing, state transitions, percentile math, domain logic, schema/scope markers, naming and fixture policy | real browser/hardware behavior or deployment health |
| Integration | repository scope, ingest/link state, adapter result, safety/tenancy failure | physical mic/camera and unauthenticated claims about staging |
| Controlled browser UAT | click/focus/picker dispatch, context continuity, desktop/mobile viewport | physical-device quality unless run on that device |
| Physical UAT | mic, camera, TTS, mobile OS/browser behavior | percentile distribution without enough samples |
| Performance samples | p50/p75/p90/p95 and TTFR coverage for the sampled build | unsampled cases or TTFR when the app does not report it |
| Build/regression | compilation and known contract preservation | user experience or live-provider accuracy by itself |

Required focused contracts for this workstream:

- `test/val-master-evolution-contract.test.js`
- `test/agro-manual-parity.test.js`
- `test/agro-image-bank.test.js`
- `test/val-calculator-parity.test.js`
- existing hero, voice, routing, memory, mapping, soil, attachments, tenancy and safety suites

The final regression must include Copilot, Voice, AI Reasoning, MMI/MCTX/MIC/MDI/MVV/MEX/MCA/MIA/VIS, Manual, Agronomic Intelligence, scans, calculators, mapping, uploads, mobile/PWA, tenancy, safety and both builds. Missing physical or provider evidence must remain partial in the final gate.

## Release and rollback

Release scope is the feature branch and isolated staging only. Promotion requires an explicit human authorization after the final gate.

Rollback order:

1. point staging back to the last known-good feature commit;
2. disable new UI/adapters through their existing boundary while retaining the traditional modules;
3. preserve confirmed records, attachments, memory and geometry revisions;
4. do not roll back by deleting data or weakening tenancy/safety;
5. re-run health, focused tests, regression and controlled UAT.

No merge to `main`, production deploy or Passo 07 is included.

## Exit criteria for the later final gate

The later `GATE_VAL_MASTER_EVOLUTION_RESULTADO.md` may approve only evidence actually collected for:

- all four hero actions with context, errors and desktop/mobile behavior;
- full-screen Copilot, natural commands, Decision Interview and voice preference;
- preserved legacy functions and module drill-down;
- Manual audit, current mapping/calculator inventory and truthful scan/image-bank status;
- FAST/CONTEXT/DEEP/TOOL/LIVE_DATA routing with materiality and isolation;
- GP-001–GP-016 distributions and TTFR coverage, without invented samples;
- source-specific agronomic answers, safety and tenancy;
- adaptive logo/wordmark visual checks;
- complete regressions and builds;
- staging deployment health, risk and recoverable rollback.

Documentation presence is never sufficient evidence for a `PASS`. If any required UAT, live-source connection, percentile sample or integration remains absent, the gate must say `PARTIAL` or `BLOCKED` and must not promote.
