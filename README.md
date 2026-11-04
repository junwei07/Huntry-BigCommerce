# Huntry for BigCommerce

Huntry is a single-click BigCommerce app for running map-based treasure hunts
in a store. A merchant installs it from the control panel and manages events,
rewards, sponsors, featured placements and player claims in an admin UI inside
BigCommerce. Shoppers see a map on a storefront page, find eggs and claim
rewards as BigCommerce coupon codes.

## Overview

- **App:** Next.js (App Router) with the BigDesign UI, running as the app the
  merchant sees in the control panel iframe, and serving the public storefront
  APIs under `/api/public/huntry/{storeHash}/*`.
- **Data:** Firestore holds store credentials (tokens encrypted at rest) and all
  Huntry data. Uploaded images go to a dedicated Cloud Storage bucket.
- **Hosting:** Firebase App Hosting. Served from the default Firebase URL for now
- **BigCommerce:** the app is registered in the
  [Developer Portal](https://developer.bigcommerce.com/) and talks to each store
  through its OAuth access token, webhooks and a storefront script.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the install and session
flow, authorization, credentials storage, the API clients and caching.

## Prerequisites

- Node.js 24 or later and pnpm (`packageManager` in `package.json`)
- A BigCommerce [Developer Portal](https://developer.bigcommerce.com/) account
  and a sandbox or trial store to install into
- A Google Cloud project with Firestore and Cloud Storage, the `gcloud` and
  `firebase` CLIs, and an account allowed to impersonate the app's service
  account
- For the local-server mode, a public HTTPS tunnel to your dev server, see
  [docs/LOCAL-SINGLE-CLICK-APP.md](docs/LOCAL-SINGLE-CLICK-APP.md)

The app's origin (`APP_ORIGIN`) depends on where it runs:

| Where | `APP_ORIGIN` |
| --- | --- |
| Local server | your tunnel URL (e.g. cloudflared tunnel) |
| Dev backend `huntry-bc` (Firebase App Hosting, tracks `main`) | `https://huntry-bc--evms-demo-d1477.europe-west4.hosted.app/` (default URL) |
| Prod backend `huntry-bc-prod` (tracks `release`) | `https://huntry-bc-prod--evms-demo-d1477.europe-west4.hosted.app/` (default URL) |
| Prod custom domain (TODO) | `https://app.huntry.io`, not set up |

## Development setup

Development uses its own BigCommerce app, Firestore database and storage bucket. You can run dev in two ways: a local
server behind a tunnel, or the live Firebase App Hosting backend. Both need a
dev app and the same variables, which differ by where they are set:

1. **Register a dev app** in the [Developer Portal](https://developer.bigcommerce.com/) and note its client ID and
   secret. Enable the scopes and Multiple Users as listed in
   [docs/APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md). Its callback URLs
   (`/api/app/auth`, `/load`, `/uninstall`, `/remove_user`) point at one origin
   at a time, so they depend on the mode below.
2. **Install dependencies:** `pnpm install`.

| Variable | Local server (`.env.local`) | Hosted backend (`apphosting.yaml`, Secret Manager) | Notes |
| --- | --- | --- | --- |
| `BIGCOMMERCE_CLIENT_ID` | dev app's client ID | plain value, runtime | Developer Portal |
| `BIGCOMMERCE_CLIENT_SECRET` | dev app's secret | Secret Manager, runtime | Developer Portal |
| `APP_ORIGIN` | your tunnel URL | backend URL or custom domain, build and runtime | baked in at build; a change needs a new rollout |
| `SESSION_SECRET` | generated value | Secret Manager, runtime | command in [APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md); differs per environment |
| `CREDENTIALS_ENCRYPTION_KEY` | generated value | Secret Manager, runtime | differs per environment; changing it orphans stored tokens |
| `DATA_MODE` | `MULTITENANT` | `MULTITENANT`, runtime | `MOCK` and `STATIC` are for UI work without a store |
| `CREDENTIALS_STORE_DRIVER` | `FIRESTORE` (or `SQLITE` for local db) | `FIRESTORE`, build and runtime | SQLite throws on Cloud Run |
| `FIRESTORE_DATABASE_ID` | - | database name, runtime | required, never defaulted |
| `FIREBASE_PROJECT_ID` | - | project ID, runtime | optional locally if ADC supplies it |
| `FIREBASE_STORAGE_BUCKET` | - | bucket name, runtime | unset keeps image fields preview-only |
| `CACHE_ENABLED` | `FALSE` | `"FALSE"`, runtime | per-instance cache, keep off |
| `ERROR_LOGGING_ENABLED` | `TRUE` | `"TRUE"`, runtime | |
| `DEVELOPER_NAME`, `DEVELOPER_LOGO_FILENAME`, `SUPPORT_EMAIL`, `SUPPORT_URL` | as appropriate | as appropriate | branding for the Help page |
| `LOG_API_REQUESTS` | optional `TRUE` | - | logs BigCommerce calls |
| `CREDENTIALS_SQLITE_PATH`, `HUNTRY_SQLITE_PATH` | SQLite driver only | - | default `./data/` |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST` | emulator only | - | the app refuses to start with the first on Cloud Run |
| `FIRESTORE_TEST_LIVE`, `STORAGE_TEST_LIVE` | opt-in live test runs | - | see `.env.example` |

### A. Local server with a tunnel

Callbacks use your tunnel URL, and `APP_ORIGIN` in `.env.local` is the same URL.

1. Copy `.env.example` to `.env.local` and set the Local column above.
2. **Authenticate to Google Cloud** as the dev service account, with no key file:
   `gcloud auth application-default login --impersonate-service-account=<dev-service-account>`.
3. **Deploy Firestore rules and indexes** to the dev database once, see
   [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md) (Rules and indexes).
4. **Run:** `pnpm dev`, start your tunnel, set the portal callbacks to the tunnel
   URL, then install the dev app on the sandbox store and open it from the
   control panel.
5. **Test:** `pnpm test` runs the suites on SQLite. `pnpm test:firestore` runs
   the repository and credentials suites on the Firestore emulator (needs
   JDK 21 or later).

Restart `pnpm dev` after changing `CREDENTIALS_STORE_DRIVER`, because
`next.config.ts` reads it at startup.

### B. Live dev backend on Firebase App Hosting

The dev backend `huntry-bc` runs as its own service account, so there is no
`gcloud` impersonation step. Values come from `apphosting.yaml` and Secret
Manager. It tracks `main` and uses the draft app, the `huntry-bc` database and
the `huntry-bc-images` bucket.

1. Set `APP_ORIGIN` in `apphosting.yaml` to the backend's URL and make sure the
   secrets exist and are readable by the backend (see
   [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md)).
2. Set the developer portal callbacks to that URL.
3. **Deploy** by pushing to `main`, or by creating a new rollout without a
   commit:

   ```powershell
   git push origin main
   firebase apphosting:rollouts:create huntry-bc --git-branch main --project evms-demo-d1477
   ```

4. Install or re-open the dev app on the sandbox store.


## Production setup

Production is its own App Hosting backend, `huntry-bc-prod`, in the same Google
Cloud project (`evms-demo-d1477`). It has its own BigCommerce app (client ID and
secret), Firestore database, storage bucket, runtime service account and
secrets, so it never shares data or credentials with dev. One backend serves
one BigCommerce app, which is why dev and prod are separate backends.

| | Dev | Prod |
| --- | --- | --- |
| Backend | `huntry-bc` | `huntry-bc-prod` |
| Live branch | `main` | `release` |
| Config | `apphosting.yaml` | `apphosting.yaml` with `apphosting.prod.yaml` merged over it (backend environment name `prod`) |
| Database / bucket | `huntry-bc` / `huntry-bc-images` | `huntry-bc-prod` / `huntry-bc-images-prod` |
| Service account | `huntry-bc-app` | `huntry-bc-prod-app` |
| Secrets | `BIGCOMMERCE_CLIENT_SECRET`, `SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` | same names with a `_PROD` suffix |

The full runbook, the exact commands that were run, decisions and the progress
log are in [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md) ("Separate
dev and prod"). In short, the one-time setup was:

1. Create the prod database and bucket, the service account `huntry-bc-prod-app`
   and its grants (Firestore scoped to the prod database, Storage scoped to the
   prod bucket).
2. Deploy rules and indexes to prod only:

   ```powershell
   firebase deploy --only firestore:huntry-bc-prod --project evms-demo-d1477
   firebase deploy --only storage:huntry-prod --project evms-demo-d1477
   ```

   Never run an unqualified `--only firestore` or `--only storage`, it would
   hit both environments.
3. Register the production app in the Developer Portal with callbacks under the
   prod origin and the scopes in [docs/APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md),
   then create the `_PROD` secrets with `firebase apphosting:secrets:set`.
4. Push the `release` branch and create the backend with live branch `release`,
   **root directory `/`**, the prod service account, and "No" to "deploy now".
   Then grant the `_PROD` secrets to the backend with
   `firebase apphosting:secrets:grantaccess` and set the backend's environment
   name to `prod` in the console.
5. Commit `apphosting.prod.yaml` on `main` and promote.
6. Install the production app on a store and smoke test it. The custom domain
   `app.huntry.io` is not set up yet (console, App Hosting, the backend,
   Settings, Add custom domain, then the listed records at the DNS provider,
   Vultr, without touching existing records).

### Deploying

`main` is the only maintained history. `release` is never committed to
directly, it is fast-forwarded from `main` to promote:

```powershell
git push origin main           # rolls out dev (huntry-bc) only
git push origin main:release   # rolls out prod (huntry-bc-prod) only
```

To redeploy prod without a commit (for example after rotating a `_PROD` secret)
and to check a rollout:

```powershell
firebase apphosting:rollouts:create huntry-bc-prod --git-branch release --project evms-demo-d1477
firebase apphosting:backends:list --project evms-demo-d1477
```

The CLI has no command to list rollouts. Use the console (App Hosting, the
backend, Rollouts) or the REST call in the "Check a rollout" section of
[docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md), which also shows why a
build failed.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app works
- [docs/MIGRATION.md](docs/MIGRATION.md): the Huntry feature and migration plan
- [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md): dev and prod backends, deploy and promote runbook, progress log, marketplace checklist
- [docs/APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md): callbacks, scopes, secrets
- [docs/LOCAL-SINGLE-CLICK-APP.md](docs/LOCAL-SINGLE-CLICK-APP.md): tunnel setup
- [docs/VERCEL-DEPLOYMENT.md](docs/VERCEL-DEPLOYMENT.md): optional Vercel hosting
- [docs/HUNTRY-UI-REFERENCE.md](docs/HUNTRY-UI-REFERENCE.md): admin UI source of truth
