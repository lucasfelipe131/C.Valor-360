# Season report synchronization

Base: `3819599f2653b9f8ba88b6a5c421503dc37f0f94` (staging).

The embedded Manual persisted reports but returned HTTP 207 because its shared webhook secret was missing in staging. Configure `VAL_MANUAL_WEBHOOK_SECRET` on the staging web service; the existing process launcher passes it to the embedded publisher and the receiver uses the same value. Activation requires a deployment. Startup now logs configuration presence only, never the secret.

The report UI now treats confirmed persistence separately from delivery. Partial delivery updates the saved report and history, displays the pending status, and offers another save using the same report ID. Both save buttons are disabled during an in-flight save. Demonstration records remain isolated, and a response without a saved record cannot announce success.

Validation: web build, Manual production build/type checking, signed integration smoke test, and save-result regression tests passed. The full local suite passed 1805/1806 initially; its only failure was readiness against a stale build stamp. After rebuilding for the current source, the readiness test and both new regression tests passed (3/3). CI validates the complete commit independently.

Existing producer records were not replayed or accessed. Reopen an already saved report and save it to retry delivery after deployment. This change does not alter closing calculations or production/main.
