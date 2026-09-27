# K5 — orchestration contract (no paid run authorized)

`executor.mjs` wraps the ordinary authenticated application transport. It does not
create sessions or contact a provider. The frozen corpus, prompts and rubric are
unchanged. The historical `run_k5.py` remains an offline evaluator; all future
submissions/captures, including isolation probes, must use `runCase` through this
wrapper. No browser submission may bypass its reservation.

Adapter requirements:
- `readSession(A|B)`: authenticated session with id, email and role. Canonical
  fixture consultant accounts are verified; admin is refused. Select A or B from
  the UAT matrix explicitly, never from quota availability. Producer UAT B belongs
  to consultant A; producer name does not imply consultant B.
- `readPolicy(A|B)`: read `GET /api/val/status` `rateLimit` from that staging session.
  Missing policy stops execution. Current default remains 30 / 600000 ms / identity;
  staging currently has no override variable. No secrets or rate-limit changes.
- `submit`: perform one ordinary application submission, capture `http_status`,
  `rate_remaining` and `retry_after_seconds` from the response. Return the original
  evidence/rubric assessment. This wrapper never sends prompts to a model directly.
- `checkpoint`: durably write reservations and completed captures; fail before
  submission if reservation cannot be saved. No cookies or credentials in records.
- `authorizedSubmissions`: **defaults to 0**. A new user authorization is necessary
  before a live adapter may be invoked. Also enforce the separately authorized
  provider-attempt budget in the adapter; submissions are not provider calls.

The queue serializes concurrent requests. Each identity waits a full initial
window because prior UI actions/probes may have consumed quota. Uniform spacing
of ceil(window/limit)+1000 ms and a sliding ledger prevent executor bursts. A process
restart/policy change waits again; no assumption that a quota has reset. HTTP 429
is always FAIL and never automatically retried; the affected identity is paused
for at least a full window. Concurrent human use or another executor can still
consume the same server quota; use a single operator per identity, preserve any
unexpected 429 as failure. Do not rotate identities to continue a blocked case.

Offline proof: `node --test test/val-k5-zero-cost-remediation.test.js
test/val-k5-rate-http.test.js`. Tests inject a virtual clock, canonical synthetic
sessions, a real fixed-window simulator with quotas 30 and 7, and a local HTTP
server with an explicitly reduced quota of 2 and an empty provider key. No tests
exercise staging chat. A live authenticated browser adapter has not been rerun or
homologated during this zero-cost phase.
