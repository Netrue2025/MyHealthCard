# Architecture decisions

## Boundaries

The browser contains presentation state only. Authentication uses an opaque random session cookie (`HttpOnly`, `SameSite=Strict`, `Secure` in production) and a separate double-submit CSRF token. No access token or health record is written to localStorage or IndexedDB. The service worker precaches only public build assets and a generic offline page; `/v1`, health, and emergency routes are excluded.

Fastify validates input, resolves the actor, applies ownership or central policy, queries MongoDB with the patient boundary, records audit metadata, and returns `Cache-Control: no-store` on private downloads/exports. MongoDB is the system of record. All clinical child documents carry `patientId`; record creation also stores an immutable `record_versions` snapshot.

Uploads enter quarantine, retain checksum and scan/processing state, and become available only after a clean result. The included adapter intentionally leaves them pending unless synthetic-only `development-clean` is selected. Production needs private object storage, structural PDF/image validation, sandboxed previews and a real malware scanner.

## Safety choices

- Deny by default; resource existence is concealed across patient boundaries.
- Provider access requires verified status, MFA, active credentials, active named grant, action scope and exact resource scope.
- Feature flags default off for result comparison, OCR and emergency publication.
- Result comparison is a pure deterministic function. Only an explicit laboratory critical flag can produce red.
- Support has no routine PHI path. Administrative verification routes must be completed before a pilot.
- Logs redact cookies, authorization, passwords and MFA values and should contain identifiers rather than clinical text.

## Known production adapters

Email verification/recovery, TOTP/WebAuthn, S3 object storage, ClamAV protocol, Redis/BullMQ jobs, sanitised preview generation, push, regulator verification, PDF export and real FHIR profile validation are intentionally not claimed live.
