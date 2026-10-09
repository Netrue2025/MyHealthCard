# MVP traceability

| Requirement area | Implementation | Evidence/status |
|---|---|---|
| Authentication/session/CSRF | `apps/api/src/security.ts`, auth routes, Auth page | Implemented; production MFA/recovery adapter pending |
| Central authorisation | `packages/policy`, owner-scoped routes | Unit tests implemented; full integration matrix pending |
| Records/version/provenance | record APIs, `record_versions`, Records UI | Implemented for manual records and synthetic results |
| Upload quarantine | `/v1/uploads` | Size/type/signature/checksum/pending implemented; scanner/object/preview adapters pending |
| Health history | history APIs and Health summary | Implemented across required categories |
| Sharing/revocation | grant APIs and Sharing UI | Exact records/actions/recipient/expiry implemented |
| Practitioner portal | provider patient route and Provider UI | Active grant list implemented; record/review workflow partial |
| Facility submissions | data model direction | Not complete; directory only |
| Result rules | `packages/results` and result UI | Deterministic engine/tests implemented; feature off by default |
| Facility directory | facility API/UI/favourites route | Synthetic directory implemented; verification/admin pending |
| Emergency profile | emergency routes | Publish/read implemented behind disabled flag; rotate/disable UI pending |
| PWA/offline/privacy cache | Vite PWA, offline page, logout cache clear | Implemented; Playwright cache assertions pending |
| Export/FHIR | export APIs | JSON + explicit partial FHIR placeholder; complete resource mapping pending |
| Deletion/retention | deletion request API | Revoke + recovery request implemented; purge/holds/ledger pending |
| Audit/operations | audit helper/routes, health checks, docs | Core metadata trail implemented; alerts/metrics pending |

This is a functional synthetic-data MVP slice, not the full release evidence package. Open items are explicit rather than represented as live.
