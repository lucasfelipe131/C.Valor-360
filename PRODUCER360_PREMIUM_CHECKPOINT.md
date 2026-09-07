# VAL Producer 360 Premium — implementation checkpoint

Date: 2026-09-07. Branch: `feature/val-producer360-premium-v1`.
Base: `a043a8725cc4f92cef9f203315233b8a8be5500c` from `feature/val-satellite-visit-routes-v1`.
Frozen PR #95: `5848574f24c4ddbe628b125856d54d9500f7fce9`, unchanged.
Remote main checked before work: `f405617405fb66811207fdf006c2fbdaebfb8c9d`.

## Scope and implementation

The supplied Producer 360 image is the visual target; none of its names, numbers, dates, crop areas, behavioural assertions, grain stocks or credit signals were introduced as runtime facts.

- New overview composition: identity, nine tabs, KPI strip, behavioural summary, next-action empty state, satellite map, timeline and season strip.
- Existing dossier extracted into `Client360Details.jsx`. Commercial overview, profile editor, technical observations, map editing, gallery and confirmed audio capture remain reachable in the tabs.
- The existing GlobalValCopilot instance supports an embedded right panel. Expand, collapse and pin are presentation state; no replacement AI engine or route is created. The explicit producer switch cancels requests, clears object context/attachments and selects the corresponding producer conversation.
- The reference's logo is not recreated. Existing VAL logo components and navigation routes remain intact.
- Explicit empty, loading and error states. Presentation datum kinds: REAL DATA, DERIVED DATA, ESTIMATE, DEMO, MISSING. Demo records are rejected when selecting presentation evidence for a real producer. No display projection is sent to an API or memory.
- Property endpoints now use the same server session owner resolution (`id || email`) as the other protected producer endpoints. This fixes the demonstrated null-ID demo session path. Normal authenticated PostgreSQL creation already assigns the session owner, ignoring form ownership fields; its live UAT remains outstanding.

## Verified

- Full suite: **1574/1574 PASS**.
- Build and PWA verification: PASS.
- Phase 2, 5 and 6 HTTP smoke tests: PASS.
- New SSR tests: empty producer preserves cards and renders no reference values; actual provided values render unchanged; demo is labelled; loading skeletons are present.
- Datum tests: zero is distinct from missing; NaN/null/empty do not become zero; foreign producer and demo evidence are filtered.
- Local isolated HTTP check: property PUT without owner succeeds (200), and forged body owner/tenant do not replace server session scope. Test data has `isDemo=true` and remains in scratch, outside the repository and all remote databases.
- Existing structural dossier tests were relocated to follow the extracted dossier component. Obsolete full-screen-only assertions now cover the shared inline/full-screen host.

## Not yet approved

**Visual gate: NOT VERIFIED.** The supported cloud browser returned `ERR_BLOCKED_BY_CLIENT` for both local preview host forms. No screenshot or desktop/mobile visual acceptance is claimed.

**Functional gate: PARTIAL.** Live authenticated PostgreSQL UAT, microphone/device UAT and staging producer-switch interaction remain outstanding. No staging deploy, production change, merge or Passo 07 was performed.

Areas awaiting further integration/visual verification:

- Grain position, season totals and next best action have no newly invented consolidation. Their overview cards remain empty until the relevant canonical read models are wired and evidenced. The existing grain engine is untouched.
- Documents remain available via the existing attachment interface; a dedicated consolidated document list is not implemented here.
- The existing global sidebar is retained. Exact sidebar target composition and viewport proportions must be reviewed together with the screenshots.
- The display datum classification is a UI contract; this change does not retrofit provenance classifications across the AI backend or claim an audit of every existing engine.
- The commercial detail fallback now distinguishes missing values from zero and only derives credit availability, open potential and averages when all required inputs exist. Backend read-model completeness still requires live UAT.

Do not mark the complete visual or functional acceptance gate PASS from the local checks above. Continue from this branch, preserving the frozen PR and the staging base.
