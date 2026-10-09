# Operations runbook

- Database outage: readiness fails; do not serve authenticated workflows as healthy. Restore encrypted MongoDB backup and verify patient boundaries, grants and deletion ledger before reopening.
- Scanner outage: keep new files pending; never mark them clean. Alert on queue age and retry with bounded attempts.
- Object outage: keep metadata and object health distinct; disable preview/download, preserve records and alert.
- Export failure: keep private, mark failed, avoid delivery, and require a new audited request after repair.
- Audit write failure: privileged reads, exports, grants and facility finalisation fail closed.
- Incident: contain, revoke credentials, preserve evidence, identify affected data, obtain privacy/legal notification decision, recover, and document a post-incident review.

Pilot targets proposed in the source standard are 24-hour RPO, 8-hour RTO and monthly coordinated restore tests. These require an accountable owner and evidence before launch.
