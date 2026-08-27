# VAL Agronomic Capability Diff

## Purpose and evidence rule

This document compares the current Manual do Agrônomo implementation with the VAL surfaces that expose or orchestrate it. It is a source-level capability diff, not a production-readiness certificate. A route, card, static test or `iframe` proves discoverability or a contract only; it does not prove browser, tool execution, persistence, microphone, camera, upload or cross-tenant E2E behavior.

Audit baseline: 2026-08-26, branch `feature/val-master-evolution-vnext`, committed baseline `277411dc32f0`. The Manual package declares version `0.2.0`. The detailed source inventory is in `MANUAL_CURRENT_CAPABILITY_AUDIT.md`.

## Status legend

| Status | Meaning |
|---|---|
| `ENGINE_CONFIRMED` | Domain logic exists and has direct code-level or deterministic test evidence. |
| `ACCESS_PRESERVED` | VAL can open the existing Manual capability, without claiming native execution in the Copilot. |
| `PARTIAL` | Part of the contract exists, but a material adapter, linkage, persistence or verification boundary is missing. |
| `CONTRACT_ONLY` | A route/UI contract exists; execution is not yet proven. |
| `UAT_REQUIRED` | Physical/browser behavior cannot be promoted from static/unit evidence. |

## Capability matrix

| Capability | Current Manual | Current VAL / Copilot | Status | Material difference | Required action / proof |
|---|---|---|---|---|---|
| Properties, fields and crop seasons | Producer workspace stores properties, fields, crop, season, area and registrations. | Manual events materialize clients/properties/fields/crop seasons with tenant/owner checks; Agronomic Intelligence opens the producer workspace. | `PARTIAL` | The normalized VAL field does not receive the complete polygon from the producer event. | Preserve current materialization; add versioned geometry references only through a validated adapter. |
| Area mapping | `FieldMap` supports Locate, Import, Draw and Review; KML/GeoJSON; edit/simplify; area, perimeter and centroid; CAR/SIGEF; NDVI overlay; export. | The executor can count authorized properties/fields and return a mapping descriptor that drills down to `produtores`; it does not draw or persist geometry. | `PARTIAL` | The editor remains the Manual surface and `geometry_ref`/`geometry_version` are not populated by the producer event. A descriptor is not geometry execution. | Keep the current engine; prove context handoff, geometry versioning, concurrency, cross-tenant rejection and mobile/desktop UAT. |
| Soil analysis | PDF/photo/camera, OCR/extraction, editing, interpretation, history and the four real link states. | Normalized schema, versioned measurement sets, tenant-scoped materialization and linking tests exist; the Manual remains available through the VAL surface. | `ENGINE_CONFIRMED` | Hero file intent and Copilot orchestration still require browser/tool evidence; interpretation remains subject to human review. | Reuse existing linking and ingestion; prove controlled upload, likely-intent prompt, inherited context and no automatic memory write. |
| Photo diagnosis core | One to three images, four modes, structured ranking, evidence gaps and safety note. An explicit user action now saves a `photo_diagnosis` record containing result, context, image metadata/hash, provenance and safety while declaring metadata-only retention. | Router has `IMAGE_DIAGNOSIS`; VAL attachments can be used as unconfirmed visual evidence; the Manual diagnosis page and its sanitized record history are accessible. | `PARTIAL` | The saved record deliberately excludes raw images and is not linked to a VAL attachment; no dedicated tool adapter connects the Copilot execution to that record. | Preserve explicit save and metadata-only sanitation; add a reference-based adapter/linkage only if approved, with triage semantics and human review. |
| NutriScan | Canonical mode `nutrition`; exactly three hypotheses; physiological/contextual differential; explicitly saved sanitized result history is available. | The executor selects `NUTRISCAN`, requires an authorized image and returns `READY` unless an existing attachment analysis supplies a summary. | `PARTIAL` | Selection/attachment inspection does not execute the Manual `nutrition` engine, and there is no persistent scan-result → VAL-attachment reference. | Follow `VAL_NUTRISCAN_INTEGRATION_v1.md`; controlled licensed-image tests and safety review are required. |
| FitoScan | Canonical mode `disease`; exactly three disease/damage hypotheses with confounders; explicitly saved sanitized result history is available. | The executor normalizes FitoScan/FitScan to `FITOSCAN`, requires an authorized image and returns `READY` unless an existing attachment analysis supplies a summary. | `PARTIAL` | Selection/attachment inspection does not execute the Manual `disease` engine, and there is no persistent scan-result → VAL-attachment reference. | Preserve canonical name `FitoScan`; normalize the accepted input alias `FitScan` to the same methodology; never create a second product. |
| InsetoScan | Mode `insect`; distinguishes pests, beneficials and visually similar taxa; no control-level inference; explicit sanitized result history uses the shared `photo_diagnosis` record. | Available through the Manual diagnosis surface and generic image capability. | `PARTIAL` | No dedicated Copilot adapter or scan-result → VAL-attachment linkage. | Keep safety boundaries; require controlled image, source and human-review evidence before declaring full integration. |
| DaninhaScan | Mode `weed`; botanical differential; no resistance inference or herbicide prescription; explicit sanitized result history uses the shared `photo_diagnosis` record. | Available through the Manual diagnosis surface and generic image capability. | `PARTIAL` | No dedicated Copilot adapter or scan-result → VAL-attachment linkage. | Keep safety boundaries; require controlled image and human-review evidence before declaring full integration. |
| VAL image bank | The Manual scan component uses raw images only in the active browser session; an explicit save persists sanitized result/provenance and image metadata/hash, never inline binary. | `val_attachments` persists producer-linked binary, MIME, size, SHA-256, status, analysis and timestamps under tenant/consultant/client scope. | `PARTIAL` | Manual scan records are not connected to this bank; attachments have no direct property/field foreign key; Manual integration strips image/base64 payloads. Both PostgreSQL and fallback listings omit binary content, and fallback reads now require explicit tenant + consultant + client scope. | Keep both sanitizers. If integration is added, pass authorized attachment references, not duplicate base64. Prove property/field scoping and end-to-end provenance before declaring parity. |
| Sowing-machine setup | Current calculator `semeadora`. | Calculators page is accessible; `CALCULATE` plans `CALCULATORS`. The initial executor can calculate cost/ha only, not this engine. | `ACCESS_PRESERVED` | No deterministic in-chat result for `semeadora`. | Expose the current calculation through a validated adapter with explicit units and input echo. |
| Ideal population | Current calculator `populacao`; `recommendPlantPopulation` has deterministic tests. | Drill-down and capability routing only. | `ACCESS_PRESERVED` | No in-chat executor. | Reuse the current function/catalog; do not infer cultivar or establishment inputs. |
| Seed demand | Current calculator `sementes`. | Drill-down and capability routing only. | `ACCESS_PRESERVED` | No in-chat executor. | Add deterministic adapter only; preserve area, margin and packaging units. |
| Harvest forecast | Current calculator `colheita`; `estimateRegionalHarvest` has deterministic tests. | Drill-down and capability routing only. | `ACCESS_PRESERVED` | No in-chat executor. | Reuse current regional/season logic and display assumptions; do not use ZARC as cultivar cycle. |
| ZARC zoning | Current calculator `zoneamento`, backed by the Manual route and source/fallback notices. | Drill-down and capability routing only. | `ACCESS_PRESERVED` | No current-source in-chat tool. | Adapter must display municipality, soil, cycle, risk, crop year, source date and fallback state. |
| Spraying | Current calculator `pulverizacao`. | Drill-down and capability routing only. | `ACCESS_PRESERVED` | No in-chat executor; actionable dose remains safety-sensitive. | Deterministic tool plus explicit unit/source/review; never convert a calculation into a prescription automatically. |
| Fertilizers | Current calculator `fertilizante`. | Drill-down and capability routing only. | `ACCESS_PRESERVED` | No in-chat executor and catalog items do not all have a uniform freshness version. | Reuse the current engine; expose missing sources and assumptions. |
| Nutrient removal/export | Current calculator `reposicao`, including `NutrientRemovalCalculator` and cited crop references. | Drill-down and capability routing only. | `ACCESS_PRESERVED` | No in-chat executor. | Reuse current logic; present as technical comparison, not autonomous prescription. |
| Input quotation | Current calculator `cotacao`, discount/payment and PDF flow. | VAL has separate value/ROI cards plus Manual drill-down. | `PARTIAL` | VAL ROI is not the same calculation as the Manual input quotation. | Route by user objective; preserve both capabilities and do not label one as parity for the other. |
| Generic cost per hectare | Not one of the nine Manual calculator IDs; it is the deterministic formula `total_cost / area_ha`. | The initial `CALCULATORS` executor returns `INPUT_REQUIRED` when either value is missing and an executed structured result when both are explicit. | `ENGINE_CONFIRMED` | This useful tool must not be presented as parity with the nine Manual engines. | Keep it deterministic, unit-explicit and session-only; retain drill-down for the nine canonical calculators. |
| Labels and product sources | Agrofit/commercial/foliar catalogs, label OCR and source links. | Router exposes `LABELS` and fails closed when an authorized current source is unavailable. | `PARTIAL` | Some catalog records have blank sources and no homogeneous global version. | Show source and validity only when actually verified; retain prescription/review/audit controls. |
| Market and news | Manual market page, cache and source notices. | VAL has `MARKET_COMMODITY` and a direct client-independent route; current-data requests fail closed when data is unavailable. | `PARTIAL` | The runtime historically labels the deterministic market route `FAST`; the vNext target declares `LIVE_DATA`. | Instrument the actual path and source freshness; a label change alone is not a performance or current-data proof. |
| Climate | Manual overview contains weather context and source labels. | Router has `WEATHER`; VAL refuses current weather without an authorized current source. | `PARTIAL` | No authorized live source was established by this audit. | Connect only an approved source; show observation/forecast time and fail closed. |
| Reports, records and knowledge | Season reports, records archive, backup/restore and Manual knowledge sources. | VAL exposes Manual/Library/history drill-down and knowledge capabilities. | `ACCESS_PRESERVED` | A navigation entry does not prove every record is retrievable as Copilot evidence. | Prove source refs, permissions, freshness and no binary leakage per record type. |
| Agronomic hero: text | vNext action contract opens a text composer and builds an agronomic launch payload with `persistenceMode=NONE`. | Source-level handler/state/telemetry contract exists in the VAL Agronomic Intelligence page. | `UAT_REQUIRED` | Static tests do not prove focus, send, same-ecosystem response or context preservation on staging. | Execute AGRO_HERO_002/005/008/009/010 with controlled browser fixtures. |
| Agronomic hero: voice | Manual/VAL surfaces allow microphone access; vNext contract handles permission and recording states. | Source-level handler/error mapping exists. | `UAT_REQUIRED` | No static test can prove a real permission prompt, microphone capture, transcription, TTS or continuing conversation. | Execute AGRO_HERO_001/006 plus physical mobile/desktop voice UAT. |
| Agronomic hero: photo/file | File policy, input contract, validation and likely agronomic intent exist at source level. | Source-level handlers can dispatch controlled payloads. | `UAT_REQUIRED` | File picker/camera, upload, analysis and returned response are not proven by handler inspection. | Execute AGRO_HERO_003/004/005/007/008/009/010 with synthetic licensed assets. |

## Calculator summary

The source of truth contains exactly nine calculator IDs:

| Group | IDs |
|---|---|
| Plantability | `semeadora`, `populacao`, `sementes`, `colheita`, `zoneamento` |
| Spraying | `pulverizacao` |
| Fertilizers | `fertilizante`, `reposicao` |
| Costs | `cotacao` |

`test/val-calculator-parity.test.js` protects this inventory and the current boundary: Manual execution and save-record support exist; VAL access/routing and a deterministic cost/ha tool exist; native execution parity for the nine Manual engines must not be claimed until each adapter returns a numerically compared result.

## Image-bank integrity boundary

`test/agro-image-bank.test.js` verifies what the repository can prove today:

- `val_attachments` is scoped by tenant, consultant and producer;
- metadata, content, hash, status and timestamps exist;
- both PostgreSQL and fallback listings omit binary content; fallback records without an explicit tenant fail closed;
- rejected attachments are terminal and omitted from normal reads;
- Manual-to-VAL sanitization removes image/base64/file-content fields;
- Manual raw photos remain transient, while an explicit user action can persist a specialized, metadata-only `photo_diagnosis` result record with context, provenance and safety.

This boundary is intentionally `PARTIAL`. It prevents a false statement that the new sanitized NutriScan/FitoScan record history is already linked to VAL attachments or that binary, property/field linkage and end-to-end provenance are integrated.

## Verification still required before the final gate

1. Browser UAT for all ten AGRO_HERO scenarios on desktop and mobile.
2. Physical microphone/TTS and camera tests; emulation is supporting evidence only.
3. Synthetic tenant A/B fixtures for cross-tenant and cross-client rejection.
4. Controlled soil, PDF and licensed image fixtures; no real producer data.
5. GP-001–GP-016 samples with p50/p75/p90/p95 and explicitly reported TTFR coverage.
6. Full regression and both builds after all shared changes settle.
7. Final gate must preserve every partial or blocked item; documentation contracts cannot upgrade them to `PASS`.
