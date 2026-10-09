# Permission matrix

| Action | Patient owner | Named practitioner | Facility member | Support | Security admin |
|---|---:|---:|---:|---:|---:|
| Read own record | Yes | Active grant + view + MFA | No | No | No routine access |
| Download original | Yes | Active grant + download + MFA | No | No | No routine access |
| Add review note | No | Active grant + review + MFA | No | No | No |
| Create/finalise facility report | Approves request | No | Active membership + approved request | No | No |
| Create/revoke grant | Yes | No | No | No | No |
| View patient audit | Yes (successful named events) | No | No | No | Denied-event security view only |
| Export patient data | Yes + reauthentication | Only if separately granted (not MVP) | No | No | No |
| Verification/suspension | No | No | No | No | Privileged route + MFA |

Implemented policy tests cover owner/cross-patient isolation, suspended providers, and action/resource scope. API queries additionally bind record, history, grant, export and audit operations to `patientId`.
