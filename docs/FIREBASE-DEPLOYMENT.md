# Firebase App Hosting deployment

Runbook and progress log for deploying this app to Firebase App Hosting and
publishing it on the BigCommerce App Marketplace. Living doc: update the
progress table as steps complete.

Pointers, not restated here:

- Hosting config: [`apphosting.yaml`](../apphosting.yaml)
- Env var names and meanings: [`.env.example`](../.env.example)
- Original design and IAM rationale: [`FIREBASE-MIGRATION.md`](FIREBASE-MIGRATION.md)
  Phase 0 (hosting) and the scoped-IAM section
- BigCommerce Developer Portal steps: [`VERCEL-DEPLOYMENT.md`](VERCEL-DEPLOYMENT.md)
  (portal steps only, ignore the Vercel parts)

## Key facts

| Item | Value |
| --- | --- |
| GCP / Firebase project | `evms-demo-d1477` (shared with other apps) |
| Firestore database | `huntry-bc` (never the `(default)` database, it belongs to another app) |
| Storage bucket | `huntry-bc-images` (deploy rules via target `huntry`, see `.firebaserc`) |
| Runtime service account | `huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com` |
| App origin | `https://app.huntry.io` |
| DNS for `huntry.io` | Vultr (`ns1.vultr.com`, `ns2.vultr.com`) |

Auth needs no code change: `src/lib/firebase/admin.ts` passes no credential, so
it uses Application Default Credentials (gcloud locally, the backend's service
account on App Hosting).

`huntry.io` itself is the live website. The app uses the subdomain
`app.huntry.io`; adding it only needs new DNS records, the existing records
stay untouched.

## Decisions

- **Production BigCommerce app is a new app** with its own client ID and secret.
  The existing app stays as the dev app for the local tunnel.
- **Dev and prod data should be separate.** Today both use `huntry-bc` and
  `huntry-bc-images`. Plan: keep those as dev (they hold the live dev data)
  and create new prod resources. See "Separate dev and prod". Not done yet.
- **Runtime `nodejs24`.** `package.json` `engines.node` is `>=24` and the docs
  say the backend runtime must match `engines`. Fallback: `nodejs22` and lower
  `engines` to `>=22.5` (needed for `node:sqlite`). Unversioned `nodejs` turns
  off automatic base-image patching.
- **No staging backend** for now. A push to `main` rolls out to prod.
- At backend creation, answer **No** to "deploy now": secret access and
  `APP_ORIGIN` are not ready for the first rollout.

## Progress

Status is as reported by the user. "Unconfirmed" means the command was given
but nobody has reported running it. Verify before relying on it.

| Step | Status |
| --- | --- |
| `apphosting.yaml` created | Done locally. `APP_ORIGIN` is still a `TODO` placeholder. Not committed or pushed. |
| Production BigCommerce app registered | Its client ID is in `apphosting.yaml`. Confirm callbacks, Multiple Users and scopes in the portal. |
| Secrets created in Secret Manager | `BIGCOMMERCE_CLIENT_SECRET` confirmed. `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` unconfirmed. |
| IAM for `huntry-bc-app`: `roles/firebaseapphosting.computeRunner`, plus `iam.serviceAccountUser` for the deploying user | Unconfirmed |
| Firestore and storage rules and indexes deployed | Unconfirmed |
| Backend created | Done per user. Backend ID, region, runtime and service account were not recorded: fill them in below. |
| Secret access granted (`apphosting:secrets:grantaccess`) | Done per user. Confirm the grantee is `huntry-bc-app`. |
| Custom domain `app.huntry.io` and Vultr DNS records | Not done |
| `APP_ORIGIN` set, committed, pushed, first rollout | Not done |
| Sandbox store install test | Done per user (app installed on the sandbox store). Smoke test details below not individually recorded. |
| Separate dev database and bucket | Not done. Runbook written, see "Separate dev and prod". |
| BigCommerce listing and submission | Not done |

Backend details to record: ID `___`, region `___`, runtime `___`, service
account `___`.

## Runbook

### Verify what is already done

```powershell
firebase apphosting:backends:list --project evms-demo-d1477
firebase apphosting:secrets:describe SESSION_SECRET --project evms-demo-d1477
firebase apphosting:secrets:describe CREDENTIALS_ENCRYPTION_KEY --project evms-demo-d1477
gcloud projects get-iam-policy evms-demo-d1477 --flatten="bindings[].members" --filter="bindings.members:huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com" --format="table(bindings.role,bindings.condition.title)"
```

The IAM list should show `roles/datastore.user` (conditioned to the `huntry-bc`
database) and `roles/firebaseapphosting.computeRunner`. The bucket
`objectAdmin` role is granted on the bucket itself and does not appear here.

### Missing IAM

```powershell
gcloud config set project evms-demo-d1477
gcloud projects add-iam-policy-binding evms-demo-d1477 --member="serviceAccount:huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com" --role="roles/firebaseapphosting.computeRunner"
$me = gcloud config get-value account
gcloud iam service-accounts add-iam-policy-binding huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com --member="user:$me" --role="roles/iam.serviceAccountUser"
```

### Rules and indexes (run from the repo root)

```powershell
firebase use evms-demo-d1477
firebase deploy --only firestore:huntry-bc
firebase deploy --only storage:huntry
```

Wait until the composite indexes show Enabled in the console. If the deploy
offers to delete indexes that are not in `firestore.indexes.json`, answer no:
the project is shared with other apps. If the storage target is missing, run
`firebase target:apply storage huntry huntry-bc-images`.

### Custom domain

1. Console, App Hosting, the backend, Settings, Add custom domain, enter
   `app.huntry.io`.
2. Add the records it lists in Vultr DNS (Products, DNS, `huntry.io`). Do not
   edit or remove existing records, and do not replace the root `@` record.
3. Wait for verification and the SSL certificate.

### Finalize and roll out

1. In `apphosting.yaml` set `APP_ORIGIN` to `https://app.huntry.io`.
2. Commit and push to `main`. The push triggers the first real rollout.
3. Check the rollout in the console or with
   `firebase apphosting:rollouts:list --backend <backend-id> --project evms-demo-d1477`.

### Smoke test

1. Register the production app's callbacks in the Developer Portal:
   `https://app.huntry.io/api/app/auth`, `/load`, `/uninstall`, `/remove_user`.
   Enable Multiple Users.
2. Install the draft app on a BigCommerce sandbox store. The auth and load
   pages should render in the control-panel iframe.
3. Confirm a Firestore write lands in `huntry-bc`, an image upload lands in
   `huntry-bc-images`, and the webhooks and storefront script register against
   `app.huntry.io`.

## Separate dev and prod

Status: planned, nothing below has been run. Same GCP project
(`evms-demo-d1477`).

**Why not rename.** A Firestore database ID and a Cloud Storage bucket name
are immutable. Copying the data to new names would also break every stored
image URL, because the token URLs embed the bucket name. So keep the existing
resources as dev and create new ones for prod. The names stay misleading
(`huntry-bc` is the dev database); this doc is where that is recorded.

| | Dev (existing) | Prod (new) |
| --- | --- | --- |
| Firestore database | `huntry-bc` | `huntry-bc-prod` |
| Storage bucket | `huntry-bc-images` | `huntry-bc-images-prod` |
| Service account | `huntry-bc-app` | `huntry-bc-prod-app` |
| BigCommerce app | existing dev app (tunnel) | production app |
| Secrets | `.env.local` | Secret Manager, different `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` |

Steps (run from PowerShell, after `gcloud config set project evms-demo-d1477`):

1. Create the prod database and bucket in the same location as the dev ones:

   ```powershell
   gcloud firestore databases create --database=huntry-bc-prod --location=<same as huntry-bc> --type=firestore-native
   gcloud storage buckets create gs://huntry-bc-images-prod --location=<same as huntry-bc-images> --uniform-bucket-level-access --public-access-prevention
   ```

2. Create `huntry-bc-prod-app` and grant it `roles/firebaseapphosting.computeRunner`,
   `roles/datastore.user` with the condition
   `resource.name.endsWith("/databases/huntry-bc-prod")`, and
   `roles/storage.objectAdmin` on the prod bucket only. Give the deploying
   user `roles/iam.serviceAccountUser` on it. Mirror how `huntry-bc-app` is
   set up (see Verify what is already done).
3. Run the backend as the new service account (backend settings in the console,
   or `firebase apphosting:backends:update`), then re-run
   `firebase apphosting:secrets:grantaccess` for the three secrets with the new
   account.
4. Confirm `huntry-bc-app` has no binding on prod resources and
   `huntry-bc-prod-app` none on dev.
5. Add a `huntry-prod` storage target to `.firebaserc`
   (`firebase target:apply storage huntry-prod huntry-bc-images-prod`), add a
   `huntry-bc-prod` entry to the `firestore` array and a `huntry-prod` entry to
   the `storage` array in `firebase.json`, then deploy:

   ```powershell
   firebase deploy --only firestore:huntry-bc-prod
   firebase deploy --only storage:huntry-prod
   ```

   Wait for the composite indexes to show Enabled. Answer no to deleting
   indexes that are not in `firestore.indexes.json`.
6. In `apphosting.yaml` set `FIRESTORE_DATABASE_ID` to `huntry-bc-prod` and
   `FIREBASE_STORAGE_BUCKET` to `huntry-bc-images-prod`. Make sure the prod
   `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` differ from the dev
   `.env.local` values; rotate the prod ones now if they match (the prod
   database is empty, so nothing needs re-encrypting). Commit and push to
   `main` to roll out.
7. Prod starts empty. Install the production app on a store so its credentials,
   webhooks, storefront script and `/huntry/` page register under prod. If the
   production app was already installed on the sandbox store, its record is in
   `huntry-bc` (dev): remove it there and delete duplicate webhooks and scripts
   on the store.
8. Verify isolation: a prod write appears only in `huntry-bc-prod`, an upload
   only in `huntry-bc-images-prod`, and dev ADC against the prod database (and
   the prod account against the dev one) gets `PERMISSION_DENIED`.
9. Optional: add a guard in `src/lib/firebase/admin.ts` that refuses the prod
   names when `NODE_ENV` is not `production`.

When done, update Key facts, the Progress table and the README table.

## Gotchas

- `APP_ORIGIN` is baked in at build time (`next.config.ts`,
  `src/lib/routing/app-url.ts`). Changing it needs a new rollout.
- Registered webhooks and the storefront script are per store and point at
  `APP_ORIGIN`. A changed origin means re-opening the app on every store.
- Secrets pin to the latest version at build time. Redeploy after rotating.
- Never set `FIRESTORE_EMULATOR_HOST` in the deployed backend
  (`src/lib/firebase/admin.ts` throws on Cloud Run).
- Never defaulted: `FIRESTORE_DATABASE_ID` must be `huntry-bc`.
- Risks to check on the first build: Node 24 support in the buildpack, and the
  `@bigcommerce/big-design` pnpm patch (`pnpm-workspace.yaml`) under pnpm 11.
- The default `build` script runs `vitest run`. `apphosting.yaml` overrides
  `scripts.buildCommand` to skip it.

## BigCommerce publishing checklist

Source: docs.bigcommerce.com `publishing-apps`, `approval-requirements`,
`handling-callbacks`.

1. Partner account at partners.bigcommerce.com (Technology Partner, approval
   up to about two days). The Partner ID is required for the listing.
2. App requirements: single-click OAuth, HTTPS callbacks, JWT verification on
   every callback, tokens keyed by store hash, Multiple Users enabled with a
   remove-user callback, minimal scopes (no "Modify All"), branded UI,
   onboarding and support links inside the app.
3. Listing (all required except videos and case studies): contact, partner and
   support details, Partner ID, storefront compatibility, testing instructions
   with test store access, short and full description, category, icon, logos,
   screenshots, up to five features, installation guide, user guide, **privacy
   policy and terms of service URLs**, pricing and billing.
4. Submit: build.bigcommerce.com/apps, action menu, **Publish app...**, then
   **Submit app for Review** (the review fee is paid here).
5. Respond to reviewer feedback within 30 days, or the submission is rejected
   and a new fee applies. Questions: appstore@bigcommerce.com.
