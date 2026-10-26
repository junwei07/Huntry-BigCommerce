# Huntry for BigCommerce

Huntry is a single-click BigCommerce app for running map-based treasure hunts
in a store. A merchant installs it from the control panel and manages events,
rewards, sponsors, featured placements and player claims in an admin UI inside
BigCommerce. Shoppers see a map on a storefront page, find eggs and claim
rewards as BigCommerce coupon codes. It is a migration of the Huntry WordPress
plugin (`huntry/`), see [docs/MIGRATION.md](docs/MIGRATION.md).

## How it fits together

- **App:** Next.js (App Router) with the BigDesign UI, running as the app the
  merchant sees in the control panel iframe, and serving the public storefront
  APIs under `/api/public/huntry/{storeHash}/*`.
- **Data:** Firestore holds store credentials (tokens encrypted at rest) and all
  Huntry data. Uploaded images go to a dedicated Cloud Storage bucket.
- **Hosting:** Firebase App Hosting. Production lives at `https://app.huntry.io`.
- **BigCommerce:** the app is registered in the
  [Developer Portal](https://developer.bigcommerce.com/) and talks to each store
  through its OAuth access token, webhooks and a storefront script.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the install and session
flow, authorization, credentials storage, the API clients and caching, and
[docs/MIGRATION.md](docs/MIGRATION.md) for the Huntry feature design.

## Prerequisites

- Node.js 24 or later and pnpm (`packageManager` in `package.json`)
- A BigCommerce [Developer Portal](https://developer.bigcommerce.com/) account
  and a sandbox or trial store to install into
- A Google Cloud project with Firestore and Cloud Storage, the `gcloud` and
  `firebase` CLIs, and an account allowed to impersonate the app's service
  account
- A public HTTPS URL for your dev server (tunnel), see
  [docs/LOCAL-SINGLE-CLICK-APP.md](docs/LOCAL-SINGLE-CLICK-APP.md)

## Development setup

Development uses its own BigCommerce app, Firestore database and bucket. Do not
point a dev machine at production data.

1. **Register a dev app** in the Developer Portal. Set the callback URLs
   (`/api/app/auth`, `/load`, `/uninstall`) to your tunnel URL
   and enable the scopes and Multiple Users as listed in
   [docs/APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md). Note the client ID and
   secret.
2. **Install dependencies:** `pnpm install`.
3. **Configure the environment.** Copy `.env.example` to `.env.local` for a
   local run. A dev backend on Firebase App Hosting takes the same names from
   `apphosting.yaml` and Secret Manager instead.

   | Variable | Local `.env.local` | Firebase hosting (`apphosting.yaml`) | Notes |
   | --- | --- | --- | --- |
   | `BIGCOMMERCE_CLIENT_ID` | dev app's client ID | plain value, runtime | Developer Portal |
   | `BIGCOMMERCE_CLIENT_SECRET` | dev app's secret | Secret Manager, runtime | never committed |
   | `APP_ORIGIN` | your tunnel URL | backend URL or custom domain, build and runtime | baked in at build, a change needs a new rollout |
   | `SESSION_SECRET` | generated value | Secret Manager, runtime | command in [APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md); differs per environment |
   | `CREDENTIALS_ENCRYPTION_KEY` | generated value | Secret Manager, runtime | differs per environment; changing it orphans stored tokens |
   | `DATA_MODE` | `MULTITENANT` | `MULTITENANT`, runtime | `MOCK` and `STATIC` are for UI work without a store |
   | `CREDENTIALS_STORE_DRIVER` | `FIRESTORE` (or `SQLITE` for a no-cloud run) | `FIRESTORE`, build and runtime | SQLite throws on Cloud Run |
   | `FIRESTORE_DATABASE_ID` | database name | database name, runtime | required, never defaulted |
   | `FIREBASE_PROJECT_ID` | project ID | project ID, runtime | optional locally if ADC supplies it |
   | `FIREBASE_STORAGE_BUCKET` | bucket name | bucket name, runtime | unset keeps image fields preview-only |
   | `CACHE_ENABLED` | `FALSE` | `"FALSE"`, runtime | per-instance cache, keep off |
   | `ERROR_LOGGING_ENABLED` | `TRUE` | `"TRUE"`, runtime | |
   | `DEVELOPER_NAME`, `DEVELOPER_LOGO_FILENAME`, `SUPPORT_EMAIL`, `SUPPORT_URL` | branding for the Help page | same, build and runtime | read at build time |
   | `LOG_API_REQUESTS` | optional `TRUE` | not set | logs BigCommerce calls |
   | `CREDENTIALS_SQLITE_PATH`, `HUNTRY_SQLITE_PATH` | SQLite driver only | not set | default `./data/` |
   | `FIRESTORE_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST` | emulator only | never set | the app refuses to start with the first on Cloud Run |
   | `FIRESTORE_TEST_LIVE`, `STORAGE_TEST_LIVE` | opt-in live test runs | not set | see `.env.example` |

   Locally there is no key file: `gcloud` impersonation (step 4) supplies the
   Google identity. On App Hosting the backend's service account does.
4. **Authenticate to Google Cloud** as the dev service account, with no key file:
   `gcloud auth application-default login --impersonate-service-account=<dev-service-account>`.
5. **Deploy Firestore rules and indexes** to the dev database once, see
   [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md) (Rules and indexes).
6. **Run:** `pnpm dev`, expose it through your tunnel, then install the dev app
   on the sandbox store and open it from the control panel.
7. **Test:** `pnpm test` runs the suites on SQLite. `pnpm test:firestore` runs
   the repository and credentials suites on the Firestore emulator (needs
   JDK 21 or later).

Restart `pnpm dev` after changing `CREDENTIALS_STORE_DRIVER`, because
`next.config.ts` reads it at startup.

## Production setup

Production is a separate BigCommerce app with its own client ID and secret, its
own database and bucket, and its own secrets. The full runbook, decisions and
progress log are in [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md).
Commands are PowerShell; `<project>` is the Google Cloud project and
`<backend-id>` the App Hosting backend (currently `evms-demo-d1477`).

1. **Sign in and select the project.**

   ```powershell
   firebase login
   gcloud auth login
   firebase use <project>
   gcloud config set project <project>
   ```

2. **Register the production app** in the Developer Portal with callbacks under
   `https://app.huntry.io` and the scopes in
   [docs/APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md).
3. **Create the secrets** in Secret Manager (each command prompts for the value):

   ```powershell
   firebase apphosting:secrets:set BIGCOMMERCE_CLIENT_SECRET
   firebase apphosting:secrets:set SESSION_SECRET
   firebase apphosting:secrets:set CREDENTIALS_ENCRYPTION_KEY
   ```

4. **Create the backend.** Answer No to "deploy now": secret access and
   `APP_ORIGIN` are not ready yet.

   ```powershell
   firebase apphosting:backends:create --project <project> --backend <backend-id> --primary-region <region> --runtime nodejs24 --service-account <runtime-sa>@<project>.iam.gserviceaccount.com
   ```

5. **Grant the runtime service account its roles.** Run the first two once; the
   Firestore and bucket roles are scoped to the production database and bucket
   only (see "Rules and indexes" and "Separate dev and prod" in the runbook for
   the conditioned `datastore.user` and bucket `objectAdmin` bindings).

   ```powershell
   gcloud projects add-iam-policy-binding <project> --member="serviceAccount:<runtime-sa>@<project>.iam.gserviceaccount.com" --role="roles/firebaseapphosting.computeRunner"
   $me = gcloud config get-value account
   gcloud iam service-accounts add-iam-policy-binding <runtime-sa>@<project>.iam.gserviceaccount.com --member="user:$me" --role="roles/iam.serviceAccountUser"
   firebase apphosting:secrets:grantaccess BIGCOMMERCE_CLIENT_SECRET,SESSION_SECRET,CREDENTIALS_ENCRYPTION_KEY --backend <backend-id>
   ```

6. **Deploy rules and indexes** to the production database and bucket. Answer no
   if it offers to delete indexes that are not in `firestore.indexes.json`, and
   wait until the composite indexes show Enabled in the console.

   ```powershell
   firebase deploy --only firestore:<database-id>
   firebase target:apply storage huntry <bucket-name>
   firebase deploy --only storage:huntry
   ```

7. **Configure `apphosting.yaml`:** `APP_ORIGIN`, `BIGCOMMERCE_CLIENT_ID`,
   `FIRESTORE_DATABASE_ID`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`.
   `APP_ORIGIN` is baked in at build time, so changing it needs a new rollout.
8. **Add the custom domain** `app.huntry.io`. This is console only: App Hosting,
   the backend, Settings, Add custom domain, then add the listed records in the
   DNS provider (Vultr) without touching existing records.
9. **Roll out and check.** A push to `main` starts a rollout; to redeploy
   without a commit (for example after rotating a secret) create one directly.

   ```powershell
   git push origin main
   firebase apphosting:rollouts:list --backend <backend-id> --project <project>
   firebase apphosting:rollouts:create <backend-id> --git-branch main --project <project>
   firebase apphosting:backends:list --project <project>
   ```

10. **Smoke test:** install the app on a sandbox store, write an event, upload an
    image, and confirm the webhooks and storefront script register against the
    production origin.

Separating the dev and production databases and buckets is planned, see
"Separate dev and prod" in [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md);
the database and bucket names above change once it is done.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app works
- [docs/MIGRATION.md](docs/MIGRATION.md): the Huntry feature and migration plan
- [docs/FIREBASE-DEPLOYMENT.md](docs/FIREBASE-DEPLOYMENT.md): production deploy runbook, dev/prod separation, marketplace checklist
- [docs/APP-SETUP-COMMON.md](docs/APP-SETUP-COMMON.md): callbacks, scopes, secrets
- [docs/LOCAL-SINGLE-CLICK-APP.md](docs/LOCAL-SINGLE-CLICK-APP.md): tunnel setup
- [docs/VERCEL-DEPLOYMENT.md](docs/VERCEL-DEPLOYMENT.md): optional Vercel hosting
- [docs/HUNTRY-UI-REFERENCE.md](docs/HUNTRY-UI-REFERENCE.md): admin UI source of truth
