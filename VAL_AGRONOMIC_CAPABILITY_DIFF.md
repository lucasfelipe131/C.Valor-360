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
| Properties, fields and crop seasons | Producer workspace stores properties, fields, crop, season, area, registrations and polygon provenance. | Manual events materialize clients/properties/fields/crop seasons with tenant/owner checks; `AgronomicGeometryAdapter.v1` validates and writes the canonical geometry reference/version without a parallel representation. | `ENGINE_CONFIRMED` | The Manual remains the editing surface; physical map interaction is still UAT evidence, not unit-test evidence. | Preserve the versioned adapter and execute mobile/desktop map UAT. |
| Area mapping | `FieldMap` supports Locate, Import, Draw and Review; KML/GeoJSON; edit/simplify; area, perimeter and centroid; CAR/SIGEF; NDVI overlay; export. | Polygon/MultiPolygon, invalid coordinates, computed area, edit, clear/rebind and round-trip are covered by the canonical adapter; the technical bootstrap decodes the same reference and rejects cross-tenant geometry. | `ENGINE_CONFIRMED` | The executor descriptor opens the real Manual editor; it does not pretend that a chat card drew a polygon. | Keep the current editor and prove touch/scroll/map behavior on physical devices. |
| Soil analysis | PDF/photo/camera, OCR/extraction, editing, interpretation, history and the four real link states. | Normalized schema, versioned measurement sets, tenant-scoped materialization and linking tests exist; the Manual remains available through the VAL surface. | `ENGINE_CONFIRMED` | Hero file intent and Copilot orchestration still require browser/tool evidence; interpretation remains subject to human review. | Reuse existing linking and ingestion; prove controlled upload, likely-intent prompt, inherited context and no automatic memory write. |
| Photo diagnosis core | One to three images, four modes, structured ranking, evidence gaps and safety note. Explicit save persists result/context/safety while keeping raw binary out of the record. | Protocol v2 carries authorized attachment references into the Manual; `agronomic.scan.completed` is signed and records `AgronomicScanProvenance.v1` back on the source attachment. | `ENGINE_CONFIRMED` | Raw binary remains only in `val_attachments`; the result stores references and metadata, by design. | Preserve explicit save, metadata-only sanitation and physical camera UAT. |
| NutriScan | Canonical mode `nutrition`; exactly three hypotheses; physiological/contextual differential. | VAL Attachment → handoff → NutriScan → signed result → source attachment reference is implemented with tenant/owner/client validation. | `ENGINE_CONFIRMED` | Clinical/agronomic quality still requires controlled licensed-image and human-review UAT. | Execute controlled image cases without weakening triage safety. |
| FitoScan | Canonical mode `disease`; exactly three disease/damage hypotheses with confounders. | FitoScan/FitScan normalizes to `FITOSCAN`; the same versioned reference flow records the result against the source attachment. | `ENGINE_CONFIRMED` | Physical camera and agronomic quality remain UAT evidence. | Preserve canonical name `FitoScan`; never create a second product. |
| InsetoScan | Mode `insect`; distinguishes pests, beneficials and visually similar taxa; no control-level inference. | The shared reference adapter also supports `INSETOSCAN`. | `ENGINE_CONFIRMED` | Human review and controlled-image UAT remain mandatory. | Keep safety boundaries. |
| DaninhaScan | Mode `weed`; botanical differential; no resistance inference or herbicide prescription. | The shared reference adapter also supports `DANINHASCAN`. | `ENGINE_CONFIRMED` | Human review and controlled-image UAT remain mandatory. | Keep safety boundaries. |
| VAL image bank | The Manual uses raw images only during active analysis; explicit save persists sanitized result/provenance and image metadata/hash, never inline binary. | `val_attachments` supports producer-linked and explicit `UNLINKED` rows under tenant/consultant scope. Protocol v2 passes `attachment_id`; the signed result records organization, optional client/property/field, type, timestamps, result reference and provenance. | `ENGINE_CONFIRMED` | Property/field belong to the result context rather than duplicating geometry or binary columns. | Keep both sanitizers and fail closed on tenant/owner/client/property/field mismatch. |
| Sowing-machine setup | Current calculator `semeadora`. | Manual and Copilot call `calculatePlanter` through `AgronomicCalculatorAdapter.v1`. | `ENGINE_CONFIRMED` | Physical field usability remains UAT evidence. | Preserve explicit units and input echo. |
| Ideal population | Current calculator `populacao`. | Manual facade and Copilot call the same canonical `recommendPlantPopulation`. | `ENGINE_CONFIRMED` | Cultivar and establishment inputs are never inferred. | Keep regional/yield-gap tests and warnings. |
| Seed demand | Current calculator `sementes`. | Manual and Copilot call `calculateSeedDemand`. | `ENGINE_CONFIRMED` | Missing area/population/package returns `INPUT_REQUIRED`. | Preserve area, margin and packaging units. |
| Harvest forecast | Current calculator `colheita`. | Manual facade and Copilot call the same canonical `estimateRegionalHarvest`. | `ENGINE_CONFIRMED` | ZARC is not used as cultivar cycle. | Keep regional/season assumptions visible. |
| ZARC zoning | Current calculator `zoneamento`. | Manual `/api/zarc` and Copilot call `consultZarc` / `val.zarc_provider.v1`. | `ENGINE_CONFIRMED` | It remains source-dependent and fails closed. | Display municipality, soil, cycle, risk, crop year, timestamp, dataset and MAPA source. |
| Spraying | Current calculator `pulverizacao`. | Manual and Copilot call `calculateSpraying`. | `ENGINE_CONFIRMED` | Calculation is not a prescription. | Retain explicit dose/unit, bula and responsible-professional safety. |
| Fertilizers | Current calculator `fertilizante`. | Manual and Copilot call `calculateFertilizer`. | `ENGINE_CONFIRMED` | Catalog items still expose sources only when present. | Preserve assumptions and never invent a catalog source. |
| Nutrient removal/export | Current calculator `reposicao`. | Manual and Copilot call `calculateNutrientRemoval` with the same versioned profiles. | `ENGINE_CONFIRMED` | Result remains a technical comparison, not an autonomous prescription. | Preserve crop source/note and soil-adjustment visibility. |
| Input quotation | Current calculator `cotacao`. | Manual and Copilot call `calculateQuote`; ROI remains a separate capability. | `ENGINE_CONFIRMED` | Quote and ROI are intentionally distinct. | Continue routing by objective and persist only by explicit action. |
| Generic cost per hectare | Not one of the nine Manual calculator IDs; it is the deterministic formula `total_cost / area_ha`. | The compatibility executor returns `INPUT_REQUIRED` when either value is missing and a session-only structured result when both are explicit. | `ENGINE_CONFIRMED` | This auxiliary tool is not counted as a tenth Manual calculator. | Keep it deterministic and unit-explicit. |
| Labels and product sources | Agrofit/commercial/foliar catalogs, label OCR and source links. | Router exposes `LABELS` and fails closed when an authorized current source is unavailable. | `PARTIAL` | Some catalog records have blank sources and no homogeneous global version. | Show source and validity only when actually verified; retain prescription/review/audit controls. |
| Market and news | Manual market page, cache and source notices. | VAL has `MARKET_COMMODITY`; the direct client-independent route now reports `LIVE_DATA`, requires source/date and fails closed when authorized data is unavailable. | `ENGINE_CONFIRMED` | The authoritative Copilot source is the tenant/owner-scoped market snapshot, not the Manual news scraper. | Preserve source/freshness metadata and validate the deployed network path separately from component timing. |
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

`test/agronomic-calculator-adapter.test.js` executes all nine messages through `CALCULATE → TOOL → CALCULATORS` and deeply compares each Copilot output with direct execution of the same canonical input. The reproduced focused result is 15/15 PASS, including nine numerical/source-equivalence subtests. `test/val-calculator-parity.test.js` continues to protect the inventory, navigation, persistence boundary and technical safety.

## Image-bank integrity boundary

`test/agro-image-bank.test.js` verifies what the repository can prove today:

- `val_attachments` is scoped by tenant and consultant, with either a validated producer link or explicit `UNLINKED` association;
- metadata, content, hash, status and timestamps exist;
- both PostgreSQL and fallback listings omit binary content; fallback records without an explicit tenant fail closed;
- rejected attachments are terminal and omitted from normal reads;
- Manual-to-VAL sanitization removes image/base64/file-content fields;
- protocol v2 carries references, never duplicate binary;
- the signed `agronomic.scan.completed` event validates tenant/owner/link claims and records `attachment_id`, organization, optional client/property/field, analysis type, timestamps and result reference;
- Manual raw photos remain transient in the diagnostic record, while an explicit user action persists the specialized metadata-only result with context, provenance and safety.

This source-level boundary is `ENGINE_CONFIRMED`; it does not upgrade physical camera behavior or agronomic result quality to PASS. Those remain controlled UAT obligations.

## Verification still required before the final gate

1. Browser UAT for all ten AGRO_HERO scenarios on desktop and mobile.
2. Physical microphone/TTS and camera tests; emulation is supporting evidence only.
3. Synthetic tenant A/B fixtures for cross-tenant and cross-client rejection.
4. Controlled soil, PDF and licensed image fixtures; no real producer data.
5. GP-001–GP-016 samples with p50/p75/p90/p95 and explicitly reported TTFR coverage.
6. Full regression and both builds after all shared changes settle.
7. Final gate must preserve every partial or blocked item; documentation contracts cannot upgrade them to `PASS`.
