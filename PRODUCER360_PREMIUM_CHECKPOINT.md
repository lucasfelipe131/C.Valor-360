# VAL Producer 360 Premium — delivery checkpoint

Date: 2026-09-07. Branch: `feature/val-producer360-premium-v1`.
Base: `a043a8725cc4f92cef9f203315233b8a8be5500c` (`feature/val-satellite-visit-routes-v1`).
PR #95 remains frozen at `5848574f24c4ddbe628b125856d54d9500f7fce9`.
Initial delivery had no deployment, production data write or Passo 07.

## Authorized staging integration

The user subsequently authorized staging deployment and integration of the newer
staging fix `335df6d892b4cec03c22700ca98d7d42af014064`. Its profile/approach routing
and regression tests are retained. The extracted dossier label is aligned with
the existing registered-visit contract. Target: `val-web-staging` in project
`VAL - STAGING INTEGRATION 01`, source branch `release/val-staging-validated`.
No new migrations or seed records are introduced. Main, production and PR #95
remain outside this deployment. Live status must be verified after publication.

## Delivered

- Producer navigation, identity/actions, nine tabs, KPI strip, behavioural summary, next action, properties/map, timeline and season cards following the reference composition.
- Existing dossier retained in Client360Details: profile, commercial overview, technical observations, field gallery, property editing and confirmed voice capture.
- The same GlobalValCopilot instance is embedded at right, with pin, close/reopen and fullscreen controls. Producer changes cancel outstanding requests and clear transient cross-producer context. Demo context has an explicit banner.
- Read-only producer workspace endpoint over canonical properties, fields, crop seasons and existing action plans. Each SQL read enforces tenant and consultant ownership. Truncated coverage is marked incomplete.
- Season selector, crop-specific area and production estimates. Estimates require complete inputs and compatible units; sacks across crops are never summed. Expired, completed or unsupported next actions are excluded.
- Dedicated scoped documents list with search, loading/error/retry states and protected attachment links. Grain profiles and intentions are read from the existing canonical grain workspace.
- Missing information remains empty with cards preserved. Loading uses skeletons. REAL DATA, DERIVED DATA, ESTIMATE, DEMO and MISSING are presentation classifications; no display projection is sent to storage, ContextSnapshot, memory or intelligence engines.
- No numeric/name/date/profile examples from the reference were imported as runtime records. Local QA used two explicitly synthetic producers in an isolated temporary data directory excluded from this branch.
- Property endpoints use consistent session owner resolution (`id || email`). No request-body ownership override is trusted.

## Validation evidence

- Full suite: **1579/1579 PASS**, zero failures or skipped tests.
- Final focused rerun: **8/8 PASS**, including SSR, missing-versus-zero, demo filtering, SQL tenant/owner scoping, truncated coverage, duplicate season records, incompatible units and expired next actions.
- Production build and PWA stamp/verification: PASS.
- Phase 2, 5 and 6 HTTP smoke checks: PASS in the preceding implementation checkpoint.
- Browser: desktop composition inspected; documents and grains load their empty states; tabs preserve the Copilot draft; fullscreen/retract and close/reopen preserve it; switching to a second producer clears the draft and leaves exactly one correctly scoped panel.
- Browser: existing property editor opens, Leaflet satellite imagery and controls render, and no field or location is invented. A development optimizer-cache conflict found during QA was isolated by giving the SSR test its own temporary cache.
- Previous isolated property HTTP check: owner-less PUT succeeded; forged body owner/tenant could not override session scope.

## Remaining acceptance limits

This is an implementation delivery with local validation, not production acceptance. Authenticated live PostgreSQL UAT, physical microphone/GPS use and mobile-device visual acceptance require the target environment. Exact pixel acceptance at the reference viewport is not claimed from the available desktop viewport.

Grain balance/commercialized quantities and credit need remain explicit empty states where an evidenced, reconciled read model is absent. Intentions do not establish executed sales. The existing intelligence engines were not rewritten, and the presentation provenance contract is not a retrospective audit or retrofit of all backend provenance.

The header's opportunity action opens the existing opportunities module; this change does not add a new opportunity-creation engine. Existing canonical workflows and their confirmation requirements remain authoritative.

## Municipality navigation and producer season goals — 2026-09-07

User-requested extension on the same authorized staging target. Adds bundled
IBGE state boundaries (visible by default), UF filtering and municipality
search that changes viewport only; no automatic property assignment.

Producer profile > Safra / Mapa e talhões now supports 2627V, 2727I and prior
season codes, with Milho, Soja, Trigo and Canola inputs. Declared consolidated
areas are never added to field areas. Actual historical yields and projected
yields are separate; adopting the area-weighted historical yield requires a
user action. Available volume requires explicit reserve and other-buyer
amounts, including confirmed zero. Goals are per crop, with a printable PDF
report available after saving. Unit: 60 kg sacks.

Additive migration 20260907_009 creates a scoped season-input table with
optimistic revision checks and client-row locking. No seed or example values
are inserted. Missing inputs remain null; demo status comes from the client,
not the request. Estimates and goals do not create opportunities or feed
ContextSnapshot, memory, Copilot, Grains Intelligence or Credit Intelligence.

Validation includes actual HTTP save/read/restart, unauthorized/foreign scope,
revision conflict, retained nulls, report escaping and municipality navigation
without producer-location mutation. Main, production and frozen PR95 remain
outside this release.

### Additional user-requested productive map editor

Drawing tools now remain inside fullscreen, with a collapsible icon toolbar.
A productive polygon has crop, season, approximate hectares and projected
yield (sc/ha). Existing field points can be reopened and removed by one touch;
map bubbling is disabled on vertices. Invalid, repeated or self-crossing
vertices are rejected before persistence. Yield uses the existing crop_seasons
columns; missing yield gives missing potential. No cross-crop volume sum.

CAR, SIGEF and matrícula reference files can be imported as GeoJSON WGS84,
toggled and filtered by their supplied attributes. These overlays are temporary,
labelled user-provided references, and never become producer ownership evidence
or productive hectares. Live cadastral services are not connected: the official
Acervo Fundiário currently requires gov.br authentication and CAR lookup was
unavailable during verification. Official lookup links are exposed in the panel.
No cadastral coverage or document validity is implied by the imported label.
