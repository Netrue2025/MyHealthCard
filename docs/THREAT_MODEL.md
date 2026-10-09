# Threat model summary

| Threat | Primary control | Remaining work |
|---|---|---|
| IDOR / cross-patient access | Patient-scoped queries, central policy, opaque IDs | Expand integration suite against real Mongo replica set |
| Stolen browser token | HttpOnly strict cookie, TLS, expiry, session revocation | Add MFA enrollment and risk controls |
| CSRF | SameSite Strict, exact CORS origin, double-submit token | Independent penetration test |
| Malicious upload | Signature/MIME/size checks, quarantine, fail-closed scan | PDF structure checks, sandbox previews, ClamAV adapter |
| Consent bypass | Named recipient, expiry, exact resources/actions, request-time recheck | Stream termination and completed export recheck |
| PHI leakage through caches/logs | No-store APIs, no runtime PWA cache, log redaction | Infrastructure and observability audit |
| Privileged misuse | No support PHI path, separated roles, audit records | Exceptional-admin approval flow and SIEM alerts |
| Backup resurrection | Deletion ledger design | Implement/test coordinated database + object restore |

No real patient data should enter this system before independent security, privacy and clinical review.
