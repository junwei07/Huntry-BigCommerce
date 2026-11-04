# Firebase App Hosting deployment

Runbook and progress log for deploying this app to Firebase App Hosting and
publishing it on the BigCommerce App Marketplace. Living doc: update the
progress table as steps complete.

Pointers, not restated here:

- Hosting config: [`apphosting.yaml`](../apphosting.yaml) (dev), and
  [`apphosting.prod.yaml`](../apphosting.prod.yaml) (prod overrides)
- Env var names and meanings: [`.env.example`](../.env.example)
- Original design and IAM rationale: [`FIREBASE-MIGRATION.md`](FIREBASE-MIGRATION.md)
  Phase 0 (hosting) and the scoped-IAM section
- BigCommerce Developer Portal steps: [`VERCEL-DEPLOYMENT.md`](VERCEL-DEPLOYMENT.md)
  (portal steps only, ignore the Vercel parts)

## Key facts

Two backends share one GCP project, each with its own BigCommerce app,
database, bucket, service account and secrets. Details and runbook: "Separate
dev and prod" below.

| Item | Dev | Prod |
| --- | --- | --- |
| GCP / Firebase project | `evms-demo-d1477` (shared with other apps) | same |
| App Hosting backend | `huntry-bc` | `huntry-bc-prod` |
| Region, runtime | `europe-west4`, `nodejs24` | `europe-west4`, `nodejs24` |
| Live branch | `main` | `release` |
| App root directory | `/` | `/` |
| Environment name (selects the override file) | none, uses `apphosting.yaml` only | `prod`, merges `apphosting.prod.yaml` over `apphosting.yaml` |
| Firestore database | `huntry-bc` (`europe-north2`) | `huntry-bc-prod` (`europe-north2`) |
| Storage bucket | `huntry-bc-images` (rules target `huntry`, see `.firebaserc`) | `huntry-bc-images-prod` (rules target `huntry-prod`) |
| Runtime service account | `huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com` | `huntry-bc-prod-app@evms-demo-d1477.iam.gserviceaccount.com` |
| BigCommerce app | draft app (also the local tunnel) | production app |
| Secrets (Secret Manager) | `BIGCOMMERCE_CLIENT_SECRET`, `SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` | the same names with a `_PROD` suffix |
| App origin | `https://huntry-bc--evms-demo-d1477.europe-west4.hosted.app/` | `https://huntry-bc-prod--evms-demo-d1477.europe-west4.hosted.app/` |

Neither backend ever uses the `(default)` or `huntry` databases, they belong to
other apps.

Planned prod custom domain: `https://app.huntry.io`, not set up. DNS for
`huntry.io` is at Vultr (`ns1.vultr.com`, `ns2.vultr.com`).

Auth needs no code change: `src/lib/firebase/admin.ts` passes no credential, so
it uses Application Default Credentials (gcloud locally, the backend's service
account on App Hosting).

`huntry.io` itself is the live website. The planned prod custom domain is the
subdomain `app.huntry.io`; adding it only needs new DNS records, the existing
records stay untouched.

## Decisions

- **Production BigCommerce app is a new app** with its own client ID and secret.
  The existing app stays as the dev app for the local tunnel.
- **One backend serves one BigCommerce app.** The client ID and secret are one
  pair per backend (`src/lib/bc-auth/verify-signed-payload.ts`,
  `exchange-code-for-token.ts`), so swapping the pair on the existing backend
  would break the draft app. Prod has its own backend.
- **Two backends, two live branches.** `huntry-bc` (dev) tracks `main`.
  `huntry-bc-prod` tracks `release`. Prod config differences live in
  `apphosting.prod.yaml` on `main`, not in edits on the `release` branch.
- **Promotion is a fast-forward.** `git push origin main` rolls out dev only.
  `git push origin main:release` rolls out prod only. `release` is never
  committed to directly, so `main` stays the only maintained history
  (`AGENTS.md`).
- **The environment name must equal the override filename.** The prod backend's
  environment name is `prod`, so it reads `apphosting.prod.yaml`. With no
  environment name the backend ignores that file and would build with the dev
  config.
- **Dev and prod data are separate.** Dev keeps `huntry-bc` and
  `huntry-bc-images` (they hold the live dev data, and a database ID or bucket
  name cannot be renamed). Prod uses `huntry-bc-prod` and `huntry-bc-images-prod`.
- **Runtime `nodejs24`.** `package.json` `engines.node` is `>=24` and the docs
  say the backend runtime must match `engines`. Fallback: `nodejs22` and lower
  `engines` to `>=22.5` (needed for `node:sqlite`). Unversioned `nodejs` turns
  off automatic base-image patching.
- At backend creation, answer **No** to "deploy now": secret access and the
  environment name are not ready for the first rollout.

## Progress

Status is as reported by the user unless a date says it was verified.
"Unconfirmed" means the command was given but nobody has reported running it.
Verify before relying on it.

### Dev backend (`huntry-bc`)

| Step | Status |
| --- | --- |
| `apphosting.yaml` created | Done. `APP_ORIGIN` is the backend's `*.hosted.app` URL. |
| Draft BigCommerce app registered | Its client ID is in `apphosting.yaml`. Confirm callbacks, Multiple Users and scopes in the portal. |
| Secrets created in Secret Manager | `BIGCOMMERCE_CLIENT_SECRET` confirmed. `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` unconfirmed. |
| IAM for `huntry-bc-app`: `roles/firebaseapphosting.computeRunner`, plus `iam.serviceAccountUser` for the deploying user | Unconfirmed. On 2026-10-30 the project policy showed `computeRunner` carrying the same `huntry-bc-only` database condition as `datastore.user`; see "Separate dev and prod". |
| Firestore and storage rules and indexes deployed | Unconfirmed |
| Backend created | Done. Verified 2026-10-30: ID `huntry-bc`, `europe-west4`, `nodejs24`. The CLI list does not show its service account, confirm it is `huntry-bc-app` in the console (backend settings). |
| Secret access granted (`apphosting:secrets:grantaccess`) | Done per user. Confirm the grantee is `huntry-bc-app`. |
| Sandbox store install test | Done per user (draft app installed on the sandbox store). Smoke test details below not individually recorded. |

### Prod backend (`huntry-bc-prod`)

| Step | Status |
| --- | --- |
| Prod database, bucket, `huntry-bc-prod-app` and its grants | Done, verified 2026-11-03. `huntry-bc-prod` and `huntry-bc-images-prod` are in `europe-north2`, the bucket has uniform access and public access prevention. The account has `datastore.user` (conditioned to `huntry-bc-prod`, stored with single-quoted CEL), unconditioned `computeRunner`, and `objectAdmin` on the prod bucket only. `huntry-bc-app` has no binding on the prod bucket. `serviceAccountUser` for the deployer was run but not re-checked. |
| Prod rules and indexes deployed | Done 2026-11-03. `firebase.json` has a `huntry-bc-prod` firestore entry and a `huntry-prod` storage target, `.firebaserc` maps `huntry-prod` to `huntry-bc-images-prod`. Both composite indexes on `huntry-bc-prod` are READY. Storage rules release not independently checked. |
| Production BigCommerce app registered | Done per user. Client ID is in `apphosting.prod.yaml`. Confirm callbacks (prod origin), Multiple Users and scopes in the portal. |
| `_PROD` secrets created and granted to `huntry-bc-prod-app` | Done per user. Verified 2026-11-03 that the prod Cloud Run service has the three variables wired as Secret Manager references. The secret names behind them were not read. |
| `release` branch created and pushed | Done. `origin/release` equals `origin/main` (`4e51c38`) on 2026-11-03. |
| Prod backend `huntry-bc-prod` created | Done, verified 2026-11-03: `europe-west4`, `nodejs24`, root directory `/`, live branch `release`, environment name `prod`, service account `huntry-bc-prod-app`. |
| `apphosting.prod.yaml` committed on `main` | Done (commit `4e51c38`). |
| First prod rollout | `rollout-2026-11-03-001` failed: the root directory had been set to `release` instead of `/`. After fixing it, `rollout-2026-11-03-002` succeeded from `release` at `4e51c38`. |
| Override applied on the running service | Verified 2026-11-03 on the prod Cloud Run service: prod client ID, `FIRESTORE_DATABASE_ID=huntry-bc-prod`, `FIREBASE_STORAGE_BUCKET=huntry-bc-images-prod`, prod `APP_ORIGIN`, secrets as references, and the base-file values (driver, branding, cache) inherited. |
| Production BigCommerce app installed on the prod backend | Not done. Then run the smoke test below against prod. |
| Isolation check (dev ADC against the prod database is denied) | Not done |
| Custom domain `app.huntry.io` and Vultr DNS records | Not done |
| BigCommerce listing and submission | Not done |

The "Custom domain", "Finalize and roll out" and "Smoke test" runbook sections
below were written for a single backend. They apply to `huntry-bc-prod` (domain
`app.huntry.io`, production app); the dev backend keeps its `*.hosted.app`
origin.

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

Dev (`huntry-bc`). Prod uses `firestore:huntry-bc-prod` and
`storage:huntry-prod`, see "Separate dev and prod".

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

### Finalize and roll out (custom domain, prod)

Applies once the custom domain is set up.

1. In `apphosting.prod.yaml` set `APP_ORIGIN` to `https://app.huntry.io/`.
2. Commit and push to `main`, then promote (see "Promote to prod").
3. Update the production app's callbacks, and re-open the app on every store so
   webhooks and the storefront script re-point.

### Check a rollout

`firebase apphosting:rollouts:list` does not exist (firebase-tools 15.33.0 only
has `rollouts:create`). Use the console (App Hosting, the backend, Rollouts) or
the REST API, which also returns a failed build's error:

```powershell
$t = gcloud auth print-access-token
$base = "https://firebaseapphosting.googleapis.com/v1/projects/evms-demo-d1477/locations/europe-west4/backends/huntry-bc-prod"
(Invoke-RestMethod -Uri "$base/rollouts" -Headers @{Authorization="Bearer $t"}).rollouts | ForEach-Object { "$($_.name.Split('/')[-1]) | $($_.state) | $($_.createTime)" }
```

For the error behind a `FAILED` rollout, `GET $base/builds/<build-id>` and read
`errors[].error.message`. Change the backend ID for dev.

### Smoke test

1. Register the app's callbacks in the Developer Portal under its backend's
   origin: `/api/app/auth`, `/load`, `/uninstall`, `/remove_user`. Enable
   Multiple Users. Draft app: the dev origin. Production app: the prod origin
   (later `https://app.huntry.io`).
2. Install the app on a BigCommerce sandbox store. The auth and load pages
   should render in the control-panel iframe.
3. Confirm a Firestore write lands in that environment's database, an image
   upload lands in its bucket, and the webhooks and storefront script register
   against its origin.

## Separate dev and prod

Status: done through the first prod rollout (2026-11-03). Still open: install
the production app on a store, the isolation check, and the custom domain; see
the Progress table. Same GCP project (`evms-demo-d1477`).

**Why a second backend.** The BigCommerce client ID and secret are one pair per
backend (`src/lib/bc-auth/verify-signed-payload.ts`,
`exchange-code-for-token.ts`, `storefront-auth/verify-customer-jwt.ts`). Pointing
the existing backend at the production app would break the draft app, and the
stores it installed keep tokens, webhooks and a storefront script that belong to
the draft app's client ID (`register-storefront-script.ts` matches scripts by
`api_client_id`). So dev and prod are two backends, each with its own BigCommerce
app, database, bucket and service account.

**Why not rename.** A Firestore database ID and a Cloud Storage bucket name
are immutable. Copying the data to new names would also break every stored
image URL, because the token URLs embed the bucket name. So the existing
resources stay as dev and prod got new ones. The names stay misleading
(`huntry-bc` is the dev database); this doc is where that is recorded.

The side-by-side values are in "Key facts". Secrets are project-wide in Secret
Manager, so prod has its own `_PROD` names, not a second value under the same
name. The prod `SESSION_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` differ from
dev's.

**Where the prod config lives.** On `main`, not on `release`. If the prod client
ID and secret names were edited into `apphosting.yaml` on `release`, every
promotion would conflict on those lines. Instead `apphosting.yaml` is the dev
config and [`apphosting.prod.yaml`](../apphosting.prod.yaml) lists only what
differs for prod. The backend's environment name (`prod`) selects the file.
Both files are safe to commit (secrets are Secret Manager references, the
client ID is not secret). Verified 2026-11-03 on the running prod service that
an override entry replaces the base value and can switch a value to a secret,
and that variables not overridden are inherited.

Steps as they were run (PowerShell, after `gcloud config set project evms-demo-d1477`).
`gcloud config set project` may warn that the project does not match the quota
project in the Application Default Credentials file. That file is the
impersonated `huntry-bc-app` login for local dev; the warning is harmless here
and `gcloud auth application-default set-quota-project` is not needed.

1. Create the prod database and bucket in the same location as the dev ones
   (`europe-north2`):

   ```powershell
   gcloud firestore databases create --database=huntry-bc-prod --location=europe-north2 --type=firestore-native
   gcloud storage buckets create gs://huntry-bc-images-prod --project=evms-demo-d1477 --location=europe-north2 --uniform-bucket-level-access --public-access-prevention
   ```

2. Create `huntry-bc-prod-app` and its grants. PowerShell 5.1 strips embedded
   double quotes from native command arguments, so write the condition with
   single quotes inside a double-quoted flag (CEL accepts both):

   ```powershell
   gcloud iam service-accounts create huntry-bc-prod-app --display-name="Huntry BC prod runtime"
   $sa = "serviceAccount:huntry-bc-prod-app@evms-demo-d1477.iam.gserviceaccount.com"
   gcloud projects add-iam-policy-binding evms-demo-d1477 --member=$sa --role=roles/datastore.user --condition="expression=resource.name == 'projects/evms-demo-d1477/databases/huntry-bc-prod',title=huntry-bc-prod-only"
   gcloud storage buckets add-iam-policy-binding gs://huntry-bc-images-prod --member=$sa --role=roles/storage.objectAdmin
   gcloud projects add-iam-policy-binding evms-demo-d1477 --member=$sa --role=roles/firebaseapphosting.computeRunner --condition=None
   $me = gcloud config get-value account
   gcloud iam service-accounts add-iam-policy-binding huntry-bc-prod-app@evms-demo-d1477.iam.gserviceaccount.com --member="user:$me" --role=roles/iam.serviceAccountUser
   ```

   `--condition=None` is needed because the project policy already has
   conditional bindings. IAM stores the database condition with single quotes;
   read it back to confirm the database name.

   `computeRunner` is deliberately unconditioned. On 2026-10-30 the project
   policy showed `huntry-bc-app`'s `computeRunner` binding carrying the same
   `huntry-bc-only` database condition as its `datastore.user` binding. A
   database-name condition is unlikely to match what App Hosting checks for that
   role. Whether the dev binding actually works is not resolved; the dev backend
   did roll out on 2026-10-28.
3. Confirm `huntry-bc-app` has no binding on prod resources and
   `huntry-bc-prod-app` none on dev.
4. Add a `huntry-bc-prod` entry to the `firestore` array and a `huntry-prod`
   entry to the `storage` array in `firebase.json`, map the target, and deploy.
   A storage target is a local alias for a bucket (`.firebaserc` holds the
   mapping) and is what lets `--only storage:huntry-prod` deploy one bucket's
   rules; `--only storage:<x>` matches only an entry's `target`.

   ```powershell
   firebase target:apply storage huntry-prod huntry-bc-images-prod --project evms-demo-d1477
   firebase deploy --only firestore:huntry-bc-prod --project evms-demo-d1477
   firebase deploy --only storage:huntry-prod --project evms-demo-d1477
   ```

   Wait for the composite indexes to show Enabled. Answer no to deleting
   indexes that are not in `firestore.indexes.json`. Never run an unqualified
   `firebase deploy --only firestore` or `--only storage`: it would deploy to
   both dev and prod.
5. Register the production app in the Developer Portal. Create the `_PROD`
   secrets (generate different values for `SESSION_SECRET_PROD` and
   `CREDENTIALS_ENCRYPTION_KEY_PROD`, command in `docs/APP-SETUP-COMMON.md`).
   Answer **n** to "add this secret to apphosting.yaml?", because that file is
   the dev config:

   ```powershell
   firebase apphosting:secrets:set BIGCOMMERCE_CLIENT_SECRET_PROD --project evms-demo-d1477
   firebase apphosting:secrets:set SESSION_SECRET_PROD --project evms-demo-d1477
   firebase apphosting:secrets:set CREDENTIALS_ENCRYPTION_KEY_PROD --project evms-demo-d1477
   ```

6. Create the `release` branch from `main` and push it, then create the prod
   backend (backend creation: `README.md`). In the prompts set the live branch
   to `release` and the **root directory to `/`** (not the branch name), and
   answer **No** to "deploy now":

   ```powershell
   git push origin main:release
   firebase apphosting:backends:create --project evms-demo-d1477 --backend huntry-bc-prod --primary-region europe-west4 --runtime nodejs24 --service-account huntry-bc-prod-app@evms-demo-d1477.iam.gserviceaccount.com
   firebase apphosting:secrets:grantaccess BIGCOMMERCE_CLIENT_SECRET_PROD,SESSION_SECRET_PROD,CREDENTIALS_ENCRYPTION_KEY_PROD --backend huntry-bc-prod --project evms-demo-d1477
   ```

   In the console (backend, Settings) set the **environment name to `prod`**,
   which must equal the override filename. No CLI flag for it was found in
   firebase-tools 15.33.0. Check the backend's service account there too; the
   CLI list does not show it.
7. On `main`, add `apphosting.prod.yaml` with the prod overrides, commit and
   push, then promote (next section). The prod origin follows the pattern
   `https://<backend-id>--<project>.<region>.hosted.app`, so it is known before
   the backend exists.
8. Install the production app on a store and open it once so its credentials,
   webhooks, storefront script and `/huntry/` page register under prod. Prefer
   a different store from the one with the draft app. If the production app was
   already installed on the sandbox store, remove its record from `huntry-bc`
   (dev) and delete duplicate webhooks and scripts on the store.
9. Verify isolation: a prod write appears only in `huntry-bc-prod`, an upload
   only in `huntry-bc-images-prod`, and dev ADC against the prod database (and
   the prod account against the dev one) gets `PERMISSION_DENIED`, for example
   by running the live credentials suite against the prod database:

   ```powershell
   $env:FIRESTORE_TEST_LIVE=1; $env:FIRESTORE_DATABASE_ID="huntry-bc-prod"; $env:FIREBASE_PROJECT_ID="evms-demo-d1477"; npx vitest run tests/lib/credentials-store
   ```

   The draft app must still install and load on the dev backend.
10. Optional: add a guard in `src/lib/firebase/admin.ts` that refuses the prod
    names when `NODE_ENV` is not `production`.

### Promote to prod

`release` is only ever fast-forwarded from `main`, so `main` stays append-only
(`AGENTS.md`, Git model):

```powershell
git push origin main           # rolls out dev (huntry-bc) only
git push origin main:release   # rolls out prod (huntry-bc-prod) only
```

Check the prod rollout as described in "Check a rollout". To redeploy prod
without a commit (for example after rotating a `_PROD` secret):

```powershell
firebase apphosting:rollouts:create huntry-bc-prod --git-branch release --project evms-demo-d1477
```

Rollback: unverified. Either roll back from the console's rollout list for the
backend, or push the previous commit to `release` with `--force-with-lease`
(the one allowed exception to fast-forward only, because `release` is a
deployment pointer and not history).

## Gotchas

- `APP_ORIGIN` is baked in at build time (`next.config.ts`,
  `src/lib/routing/app-url.ts`). Changing it needs a new rollout.
- Registered webhooks and the storefront script are per store and point at
  `APP_ORIGIN`. A changed origin means re-opening the app on every store.
- Secrets pin to the latest version at build time. Redeploy after rotating.
- Never set `FIRESTORE_EMULATOR_HOST` in the deployed backend
  (`src/lib/firebase/admin.ts` throws on Cloud Run).
- Never defaulted: `FIRESTORE_DATABASE_ID` is set per backend (`huntry-bc` on
  dev, `huntry-bc-prod` on prod) and never falls back to `(default)`.
- The BigCommerce client ID and secret are one pair per backend. One backend
  cannot serve both the draft app and the production app.
- Secrets are project-wide in Secret Manager. Prod uses its own `_PROD` names,
  not a second value under a dev name.
- The backend's **App root directory** is `/`, not the branch name. A wrong
  value fails the build with "Invalid root directory specified. No buildable
  app found rooted at '/workspace/release'" (this happened on the first prod
  rollout). Fix it in the backend's Settings, Deployment tab.
- The backend's **environment name** must equal the override filename
  (`prod` for `apphosting.prod.yaml`). Without it the override file is ignored
  and the build uses the dev config.
- `firebase apphosting:rollouts:list` does not exist; see "Check a rollout".
- Never run an unqualified `firebase deploy --only firestore` or
  `--only storage`; with two entries it hits dev and prod.
- Risks to check on the first build: Node 24 support in the buildpack, and the
  `@bigcommerce/big-design` pnpm patch (`pnpm-workspace.yaml`) under pnpm 11.
  Both passed on the first prod build (`rollout-2026-11-03-002`).
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
