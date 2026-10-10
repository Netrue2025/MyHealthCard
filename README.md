# Netrue Health MVP

Mobile-first installable medical-record PWA for synthetic-data review. Patients can maintain records and health history, share exact records with a named verified practitioner, search a managed facility directory, inspect access history, request exports and start the deletion workflow.

> This repository is an engineering MVP, not evidence of clinical safety, regulatory approval, privacy compliance or production readiness. Use synthetic data until every item in `docs/RELEASE_CHECKLIST.md` has a named approval.

## Stack

- React 19, Vite, React Router, TanStack Query, Tailwind CSS
- Fastify 5 and TypeScript
- MongoDB 7 (replica set recommended for transactions)
- Optional Redis/MinIO/ClamAV production adapters; local filesystem storage is development-only and scanner access fails closed by default
- Vitest, Playwright and PWA service worker

The supplied standard proposed PostgreSQL/Prisma. MongoDB is an explicit project adaptation requested for Railway. Patient IDs remain denormalised on all clinical documents, every query scopes by patient, immutable snapshots preserve versions, and compound/TTL indexes enforce the important access and lifecycle paths.

## Local setup

1. Install Node.js 20+ and Docker.
2. Copy `.env.example` to `.env`; replace `SESSION_SECRET`.
3. Run `docker compose up -d`.
4. Run `corepack enable`, `pnpm install`, `pnpm seed`, then `pnpm dev`.
5. Open `http://localhost:5173`.

Synthetic accounts:

- Patient: `patient@netrue.test` / `DemoPatient!2026`
- Practitioner: `doctor@netrue.test` / `DemoPatient!2026` / MFA `123456`

`SCANNER_MODE=fail-closed` is the safe default: new files stay pending. `development-clean` is permitted only for synthetic local review and must never be used in production.

## Railway

Create a Railway project with this repository and a MongoDB service/plugin. Set all variables from `.env.example`, particularly `MONGODB_URI`, a random 32+ character `SESSION_SECRET`, `APP_ORIGIN` and `API_ORIGIN` to the final HTTPS URL, `COOKIE_SECURE=true`, and `SCANNER_MODE=fail-closed` until a real ClamAV-compatible scanner adapter is connected. Use a persistent volume only for temporary quarantine; production originals belong in private S3-compatible object storage.

Until private object storage is connected, attach a Railway persistent volume to the application service at `/data` and set `UPLOAD_DIR=/data/uploads`. Without a volume, Railway redeployments erase locally uploaded files while their MongoDB metadata remains. Files lost before the volume was attached must be uploaded again.

Railway uses `railway.json`, builds the web and API together, serves the PWA from Fastify, and checks `/health/ready`. Run `pnpm seed` only in a synthetic development environment.

### Medication push reminders

Generate a VAPID key pair with `npx web-push generate-vapid-keys`, then add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a valid `VAPID_SUBJECT` (normally a `mailto:` address) to Railway. Users must tap **Enable alerts** once on each device and allow notifications. The reminder worker checks due daily schedules every 30 seconds and uses a unique delivery record to prevent duplicate notifications. Notification text is deliberately generic so medication details are not exposed on a lock screen.

### Google Find Care setup

Enable **Places API (New)** and **Geocoding API** in Google Cloud. Set `GOOGLE_PLACES_API_KEY` only on the API/Railway service and restrict it to those APIs and the server environment. The optional `VITE_GOOGLE_MAPS_BROWSER_KEY` must use HTTP-referrer restrictions and Maps JavaScript API restrictions; the current low-bandwidth map view does not require it. Never reuse an unrestricted browser key as the server key.

## Commands

- `pnpm dev` – web and API development servers
- `pnpm typecheck` – strict TypeScript checks
- `pnpm test` – policy and clinical-rule unit tests
- `pnpm test:e2e` – browser suite (requires configured test services)
- `pnpm build` – production bundle
- `pnpm seed` – replace synthetic fixtures

See `docs/` for architecture, permissions, threats, result rules, FHIR mapping, operations and requirement traceability.
