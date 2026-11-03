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
| Backend (dev, existing) | `huntry-bc`, region `europe-west4`, runtime `nodejs24`, live branch `main` |
| Runtime service account | `huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com` |
| App origin (dev backend) | `https://huntry-bc--evms-demo-d1477.europe-west4.hosted.app/` (`apphosting.yaml`) |
| Backend (prod, planned) | `huntry-bc-prod`, live branch `release`, see "Separate dev and prod" |
| Planned custom domain | `https://app.huntry.io` for prod, not set up |
| DNS for `huntry.io` | Vultr (`ns1.vultr.com`, `ns2.vultr.com`) |

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
  would break the draft app. Prod gets its own backend.
- **Two backends, two live branches.** The existing backend `huntry-bc` is dev
  and tracks `main`. A new backend `huntry-bc-prod` tracks `release`. Prod
  config differences live in an environment override file on `main`, not on the
  `release` branch. See "Separate dev and prod".
- **Dev and prod data are separate.** Today the dev backend and local dev use
  `huntry-bc` and `huntry-bc-images`; keep those as dev (they hold the live dev
  data) and create new prod resources. Not done yet.
- **Runtime `nodejs24`.** `package.json` `engines.node` is `>=24` and the docs
  say the backend runtime must match `engines`. Fallback: `nodejs22` and lower
  `engines` to `>=22.5` (needed for `node:sqlite`). Unversioned `nodejs` turns
  off automatic base-image patching.
- **Until prod exists, `main` is the only rollout.** Today a push to `main`
  rolls out the one backend, which is the dev backend. After the split, `main`
  rolls out dev only and prod changes only when `release` moves.
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
| Prod database, bucket, `huntry-bc-prod-app` and its grants | Done (verified 2026-11-03). `huntry-bc-prod` and `huntry-bc-images-prod` are in `europe-north2`, bucket has uniform access and public access prevention. The account has `datastore.user` (conditioned to `huntry-bc-prod`, stored with single-quoted CEL), unconditioned `computeRunner`, and `objectAdmin` on the prod bucket only. `huntry-bc-app` has no binding on the prod bucket. `serviceAccountUser` for the deployer was run but not re-checked. |
| Prod rules and indexes deployed | Done (2026-11-03). `firebase.json` has a `huntry-bc-prod` firestore entry and a `huntry-prod` storage target, `.firebaserc` maps `huntry-prod` to `huntry-bc-images-prod`. Both composite indexes on `huntry-bc-prod` are READY. Storage rules release not independently checked. |
| `release` branch created and pushed | Not done |
| Prod `_PROD` secrets created and granted to `huntry-bc-prod-app` | Not done |
| Prod backend `huntry-bc-prod` (live branch `release`) | Not done |
| `apphosting.<env>.yaml` prod override file on `main` | File written (`apphosting.prod.yaml`, 2026-11-03), not committed or pushed. Needs the backend's environment name set to `prod` in the console, and the override semantics are unverified until the first prod rollout. |
| Production BigCommerce app installed on the prod backend | Not done |
| BigCommerce listing and submission | Not done |

Dev backend (from `firebase apphosting:backends:list`, 2026-10-30): ID
`huntry-bc`, region `europe-west4`, runtime `nodejs24`. Its runtime service
account is not shown by the CLI list; confirm it is `huntry-bc-app` in the
console (backend settings).

The "Custom domain", "Finalize and roll out" and "Smoke test" runbook sections
below were written for a single backend. Once prod exists they apply to
`huntry-bc-prod` (domain `app.huntry.io`, production app), and the dev backend
keeps its `*.hosted.app` origin.

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
image URL, because the token URLs embed the bucket name. So keep the existing
resources as dev and create new ones for prod. The names stay misleading
(`huntry-bc` is the dev database); this doc is where that is recorded.

| | Dev (existing) | Prod (new) |
| --- | --- | --- |
| App Hosting backend | `huntry-bc` | `huntry-bc-prod` |
| Live branch | `main` | `release` |
| Firestore database | `huntry-bc` | `huntry-bc-prod` |
| Storage bucket | `huntry-bc-images` | `huntry-bc-images-prod` |
| Service account | `huntry-bc-app` | `huntry-bc-prod-app` |
| BigCommerce app | existing draft app (also the local tunnel) | production app |
| Secrets in Secret Manager | `BIGCOMMERCE_CLIENT_SECRET`, `SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` | `BIGCOMMERCE_CLIENT_SECRET_PROD`, `SESSION_SECRET_PROD`, `CREDENTIALS_ENCRYPTION_KEY_PROD` |
| Config | `apphosting.yaml` | `apphosting.<env>.yaml` override on `main` |

Secrets are project-wide in Secret Manager, so prod needs its own names, not a
second value under the same name. The prod `SESSION_SECRET` and
`CREDENTIALS_ENCRYPTION_KEY` must differ from dev's.

**Where the prod config lives.** On `main`, not on `release`. If the prod client
ID and secret names were edited into `apphosting.yaml` on `release`, every
promotion would conflict on those lines. Instead `apphosting.yaml` stays the dev
config and `apphosting.<env>.yaml` lists only what differs for prod, where
`<env>` is the environment name set on the prod backend. Both files are safe to
commit (secrets are Secret Manager references, the client ID is not secret).
Unverified: the exact console field or CLI flag that sets the environment name
and the override semantics. Check the App Hosting docs when creating the backend.

Prod overrides:

| Variable | Prod value |
| --- | --- |
| `BIGCOMMERCE_CLIENT_ID` | production app's client ID |
| `BIGCOMMERCE_CLIENT_SECRET` | `secret: BIGCOMMERCE_CLIENT_SECRET_PROD` |
| `SESSION_SECRET` | `secret: SESSION_SECRET_PROD` |
| `CREDENTIALS_ENCRYPTION_KEY` | `secret: CREDENTIALS_ENCRYPTION_KEY_PROD` |
| `FIRESTORE_DATABASE_ID` | `huntry-bc-prod` |
| `FIREBASE_STORAGE_BUCKET` | `huntry-bc-images-prod` |
| `APP_ORIGIN` | the prod backend's URL (or `https://app.huntry.io` once the domain is set up). Known only after the backend exists, so it needs a second rollout. |

Steps (run from PowerShell, after `gcloud config set project evms-demo-d1477`):

1. Create the prod database and bucket in the same location as the dev ones:

   ```powershell
   gcloud firestore databases create --database=huntry-bc-prod --location=<same as huntry-bc> --type=firestore-native
   gcloud storage buckets create gs://huntry-bc-images-prod --location=<same as huntry-bc-images> --uniform-bucket-level-access --public-access-prevention
   ```

2. Create `huntry-bc-prod-app` and give it `roles/datastore.user` with the
   condition `resource.name == "projects/evms-demo-d1477/databases/huntry-bc-prod"`,
   `roles/storage.objectAdmin` on the prod bucket only, and
   `roles/firebaseapphosting.computeRunner`. Give the deploying user
   `roles/iam.serviceAccountUser` on it. Mirror how `huntry-bc-app` is set up
   (see "Verify what is already done").

   Bind `computeRunner` without a condition. On 2026-10-30 the project policy
   showed `huntry-bc-app`'s `computeRunner` binding carrying the same
   `huntry-bc-only` database condition as its `datastore.user` binding. A
   database-name condition is unlikely to match what App Hosting checks for that
   role, so do not copy it. Whether the dev binding actually works is not
   resolved; the dev backend did roll out on 2026-10-28.
3. Create the three `_PROD` secrets and grant them to the new account:

   ```powershell
   firebase apphosting:secrets:set BIGCOMMERCE_CLIENT_SECRET_PROD --project evms-demo-d1477
   firebase apphosting:secrets:set SESSION_SECRET_PROD --project evms-demo-d1477
   firebase apphosting:secrets:set CREDENTIALS_ENCRYPTION_KEY_PROD --project evms-demo-d1477
   ```

   Then run `firebase apphosting:secrets:grantaccess` for each with
   `huntry-bc-prod-app` as the grantee (`README.md` has the exact command).
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
6. Create the `release` branch from `main` and push it:

   ```powershell
   git push origin main:release
   ```

7. Create the prod backend with live branch `release`, runtime `nodejs24`,
   `--service-account huntry-bc-prod-app@evms-demo-d1477.iam.gserviceaccount.com`
   and the environment name for the override file (backend creation command:
   `README.md`). Answer **No** to "deploy now".
8. On `main`, add `apphosting.<env>.yaml` with the prod overrides above, commit
   and push, then promote (next section). Once the prod URL is known, set
   `APP_ORIGIN` in the override file and promote again.
9. In the Developer Portal, point the production app's callbacks at the prod
   origin (`/api/app/auth`, `/load`, `/uninstall`, `/remove_user`) and enable
   Multiple Users. Install it on a store and open it once so its credentials,
   webhooks, storefront script and `/huntry/` page register under prod.
10. If the production app was already installed on the sandbox store, remove its
    record from `huntry-bc` (dev) and delete duplicate webhooks and scripts on
    the store.
11. Verify isolation: a prod write appears only in `huntry-bc-prod`, an upload
    only in `huntry-bc-images-prod`, and dev ADC against the prod database (and
    the prod account against the dev one) gets `PERMISSION_DENIED`. The draft
    app must still install and load on the dev backend.
12. Optional: add a guard in `src/lib/firebase/admin.ts` that refuses the prod
    names when `NODE_ENV` is not `production`.

When done, update Key facts, the Progress table and the README table.

### Promote to prod

`release` is only ever fast-forwarded from `main`, so `main` stays append-only
(`AGENTS.md`, Git model):

```powershell
git push origin main:release
```

The push triggers a rollout on `huntry-bc-prod` only. A push to `main` rolls out
`huntry-bc` only. Check with
`firebase apphosting:rollouts:list --backend huntry-bc-prod --project evms-demo-d1477`.

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
