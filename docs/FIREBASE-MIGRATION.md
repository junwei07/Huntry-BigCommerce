# Firebase migration: App Hosting + Firestore

Living plan for hosting the backend on Firebase and replacing SQLite/Postgres
with Firestore. Status is tracked per phase below. Update the checkboxes as
phases ship, and record new decisions in the Decision log.

## Decision log

- **Host**: Firebase App Hosting (Next.js on Cloud Run). Not classic Hosting +
  Cloud Functions.
- **Database**: Firestore (as in the EVMS app), not Cloud SQL / Postgres.
- **Project**: the existing `evms-demo-d1477` project, database **`huntry-bc`**
  (supersedes the earlier "new dedicated project" decision). The project also
  holds EVMS's `(default)` database and a `huntry` database, so every client
  names `huntry-bc` explicitly (`FIRESTORE_DATABASE_ID` is required and never
  defaulted), and access is scoped to that one database (see "Phase 2 setup:
  scoped IAM" below). Billing and quotas are shared with EVMS.
- **Local dev**: SQLite stays the default. The Firestore emulator is the
  Firestore dev/test target.
- **Coupon uniqueness** is case-insensitive on Firestore (normalized uppercase),
  stricter than the SQL `UNIQUE(store_hash, coupon_code)`; intentional, since
  BigCommerce codes are case-insensitive.
- **Driver selection fails closed** (Phase 1): one shared resolver, no silent
  SQLite fallback on Cloud Run.
- **Precedent**: `C:\Users\junwei\Desktop\EVMS` uses Firestore with named
  databases (`owner` + `db-<tenant>`), Auth, Storage and one gen2 scheduled
  function (Node 22, `europe-west1`). It has no App Hosting, Cloud Run, Secret
  Manager or Postgres, so server hosting is new ground. Its project IDs are
  inconsistent across files (`.firebaserc`, `firebase.json`,
  `lib/firebase_options_*.dart`), so always pass `--project` on deploy.

## Current data layer (what is being replaced)

- Credentials store: `CredentialsStore` interface in
  `src/lib/credentials-store/types.ts` (15 methods); drivers SQLITE, POSTGRES,
  D1 chosen in `src/lib/credentials-store/get-credentials-store.ts` by
  `CREDENTIALS_STORE_DRIVER`.
- Huntry data: no abstraction. `getHuntryDb()` in
  `src/lib/huntry/db/get-db.ts` returns `Pool | DatabaseSync`, and each
  `src/lib/huntry/*/*-api.ts` branches on `db instanceof DatabaseSync` with
  SQL written for both dialects. Biggest: `rewards/rewards-api.ts`,
  `events/events-api.ts`, `eggs/eggs-api.ts`, `claims/player-claim.ts`.
- Schema: `src/lib/huntry/db/migrations/*.sql`,
  `src/lib/credentials-store/postgres-driver/migrations/*.sql`; SQLite mirror in
  `src/lib/huntry/db/sqlite-schema.ts`.
- Tests: about 23 files seed and assert through real SQLite (pattern in
  `tests/lib/huntry/claims/*.test.ts`); `player-claim.postgres.test.ts` covers
  locking only when `HUNTRY_TEST_DATABASE_URL` is set.

## Phases

### Phase 0: host on App Hosting against current Postgres  [ ]

Proves hosting before touching data.

- `apphosting.yaml` (repo root):
  - `runConfig`: `minInstances: 1`, capped `maxInstances`,
    `cpuAlwaysAllocated: true` (default `false` can cut off the `after()` work in
    `src/app/api/app/load/route.ts`).
  - `scripts.buildCommand`: `node scripts/copy-maplibre-worker.mjs && node
    scripts/build-storefront-script.mjs && next build` (skips `vitest run`, which
    the default `build` script runs).
  - Plain env available at **BUILD and RUNTIME** (the default; do not narrow
    with `availability`): `CREDENTIALS_STORE_DRIVER`, `APP_ORIGIN`.
    `next.config.ts` reads both at build time and aliases `pg` to a stub unless
    the driver is `POSTGRES`.
  - Secrets (`firebase apphosting:secrets:set`, RUNTIME only):
    `BIGCOMMERCE_CLIENT_SECRET`, `SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`,
    `DATABASE_URL`. Secrets pin to the latest version at build time, so redeploy
    after rotating.
- **IAM**: the deployed app runs as the App Hosting backend's service account.
  Grant it `roles/datastore.user` on the Firestore project (least privilege)
  before the Firestore phases, or every call fails with PERMISSION_DENIED. Add a
  post-deploy smoke test that does a Firestore read and write.
- `APP_ORIGIN` chicken-and-egg: the `*.hosted.app` URL exists only after the
  backend is created, and `APP_ORIGIN` is baked in at build. Create the
  backend, set it, roll out again.
- Update BigCommerce callback URLs (`/api/app/{auth,load,uninstall,remove_user}`)
  and re-open the app on each store so webhooks and the storefront script
  re-point (`register-webhooks.ts`, `register-storefront-script.ts`).
- **Blocker to verify first**: this repo needs Node >=24 (`package.json`
  `engines`, `.nvmrc`) and `get-db.ts` imports `node:sqlite` unconditionally.
  The App Hosting docs do not say how to set the Node version. Confirm with a
  test rollout.
- Start with `CACHE_ENABLED=false`; `use cache: remote` across instances needs
  a shared handler.

### Phase 1: repository seam, no behaviour change  [x]

Implemented on branch `firebase-phase1-repository-seam` (not yet merged). What
actually shipped, where it differs from the bullets below:

- **Facade stays.** Each `*-api.ts` keeps its exports, MOCK branch, `use cache`
  directives and pure helpers (tests mock these modules by path). The
  repository (`src/lib/huntry/repository/`: `types.ts`,
  `get-huntry-repository.ts`, `sql/*.ts`) holds only the uncached, store-scoped
  DB primitives. `getHuntryDb()` has no callers outside `repository/sql/` and
  `db/`.
- **Unique-violation errors stay raw.** `EventsRepository.create` and
  `RewardsRepository.create` still throw the driver's raw unique error: the
  events slug retry loop and the Server Actions
  (`isUniqueSlugConstraintError`, `isUniqueCouponCodeConstraintError`) depend on
  it. A Firestore implementation must throw an error those helpers recognise,
  or Phase 3 changes the contract to a typed result and updates both callers.
- **Player claim** takes `PlayerClaimHooks` (`evaluate`, `issueCode`) from the
  facade, so the repository only orders them around its own transaction. The
  Phase 3 reserve/finalize flow plugs into the same hooks.
- **Resolver** is `src/lib/huntry/db/resolve-driver.ts`
  (`resolveCredentialsStoreDriver`), tested by
  `tests/lib/huntry/db/resolve-driver.test.ts`. `next.config.ts` normalises with
  the same trim + uppercase.
- **Test edits**: two test files got type-only edits (`redemption.test.ts`,
  `cart-coupon-enforcement.test.ts`: `Promise<number>` became
  `Promise<number | string>` because `ClaimId` is now a union). No runtime test
  change.
- Verified: `tsc --noEmit`, `pnpm test` (517 pass), `pnpm build`. Lint's 9
  errors are pre-existing, in `huntry/` legacy reference code.

- Define a `HuntryRepository` interface per concept (events, rewards, eggs,
  sponsors, featured, claims, redemption, rate-limit, leaderboard, activity).
  The existing exported signatures of the `*-api.ts` functions are the
  contract.
- Move the current SQLite/Postgres SQL into a `sql/` implementation; select the
  implementation in a new `get-huntry-repository.ts` by
  `CREDENTIALS_STORE_DRIVER`.
- **Shared driver resolver, fail closed.** Today
  `getConfiguredDriver()` (`credentials-store/get-credentials-store.ts`) and
  `getHuntryDbDriver()` (`huntry/db/get-db.ts`) each default to `SQLITE` for
  anything unrecognized. Once `FIRESTORE` exists only on the credentials side,
  a deployment would send credentials to Firestore while Huntry data opened a
  per-instance, ephemeral SQLite file (split brain). Replace both with one
  resolver module so a single value governs both:
  - A non-empty unrecognized value throws everywhere (typo protection). Unset
    still means `SQLITE`, so local dev and the existing tests (which delete the
    var) are unaffected.
  - `SQLITE` (including by default) throws on Cloud Run, detected by the
    runtime-only `K_SERVICE` env var, unless `HUNTRY_ALLOW_EPHEMERAL_SQLITE=1`.
    Do not key this on `NODE_ENV=production`: it would break a local
    `next start` with SQLite and could trip during `next build`. `K_SERVICE` is
    not set in the Cloud Build step. Verify it is present on App Hosting.
  - `FIRESTORE` makes `getHuntryDb()` throw a clear error: Huntry data goes
    through the repository, never a raw handle.
  - Test with an env matrix for the resolver.
- **Claim id type.** Add an opaque `ClaimId = number | string` in
  `claims/types.ts` for `HuntryClaim.id`, `RedemptionCandidate.id` and
  `RedemptionUpdate.claimId` (consumers only compare it or pass it back). The
  SQL implementation keeps returning numbers and Firestore returns the string
  doc id, so Phase 1 needs no test edits. Tighten to `string` once the SQL path
  is retired.
- Existing tests pass unchanged. `getHuntryDb()` must have no callers outside
  `sql/` (grep).

### Phase 2: Firestore credentials store  [~]

Implemented on branch `firebase-phase2-credentials-store` (off Phase 1). The
contract suite passes against SQLite and against the **Firestore emulator**
(`pnpm test:firestore`, 43 tests). **Not yet verified against the hosted
`huntry-bc` database**: that needs the scoped IAM setup below.

`pnpm test:firestore` needs JDK 21+ (firebase-tools 15 refuses older Java). If
your default `JAVA_HOME` is older, point it at a newer JDK for that command
only, for example in bash: `JAVA_HOME="/c/Program Files/Java/jdk-25.0.2"
PATH="$JAVA_HOME/bin:$PATH" pnpm test:firestore`. CI needs JDK 21+ too.

- `src/lib/credentials-store/firestore-driver/firestore-credentials-store.ts`
  implements all 15 methods. `FIRESTORE` is in `CredentialsStoreDriver`, the
  shared resolver and `get-credentials-store.ts`; `firestore-driver-loader.ts` +
  `.unavailable.ts` are aliased in `next.config.ts` unless the driver is
  `FIRESTORE`, same as Postgres. The token still goes through `encryption.ts`.
- Layout (credentials only):
  - `stores/{storeHash}`: `accessToken` (encrypted), `scope`, `adminUserId`,
    `extensionId`, `scriptId`, `storefrontPage {pageId, createdByApp}`,
    `webhooks {scope: hookId}`.
  - `stores/{storeHash}/storeUsers/{userId}`: the link; `isStoreUserLinked` (hot,
    every authorization) is one get-by-id, no index.
  - `users/{userId}`: `email`, `storeHashes[]`, which answers "does this user
    have any store left" with no collection-group query.
- **`deleteStore` is not `recursiveDelete`** (this corrects the earlier text).
  The SQL drivers delete credentials rows only, and Huntry data outlives an
  uninstall. Phase 3 puts Huntry data in subcollections of the same
  `stores/{hash}` document, so the driver deletes the store document and its
  `storeUsers` docs explicitly: deleting a document never deletes its other
  subcollections. A contract test pins this.
- Setters merge and touch only their own fields (a re-install keeps the
  extension, script, page and webhook ids). `deleteUser` removes the user when no
  store links them any more, whether or not the link existed, as the SQL drivers
  do.
- **Malformed store hashes are "no such store".** Public routes pass URL
  segments to `getStoreToken`/`isStoreUserLinked`; a Firestore document id is far
  stricter than a SQL bind parameter, so the driver validates
  `/^[A-Za-z0-9_-]{1,64}$/` (getters return `undefined`/`false`, deletes no-op,
  setters throw) instead of turning a 404 into a 500 or reading a nested path.
- **SDK init** (`src/lib/firebase/admin.ts`): `FIRESTORE_DATABASE_ID` required;
  optional `FIREBASE_PROJECT_ID`; `ignoreUndefinedProperties: true`; guarded
  `initializeApp`; one `globalThis` client with `settings()` applied once; throws
  if `FIRESTORE_EMULATOR_HOST` is set on Cloud Run (`K_SERVICE`).
- **Fail closed for Huntry data**: with `CREDENTIALS_STORE_DRIVER=FIRESTORE`,
  `getHuntryDb()` and `getHuntryRepository()` throw until Phase 3 rather than
  falling back to SQLite.
- Config: `.firebaserc`, `firebase.json` (database `huntry-bc`), deny-all
  `firestore.rules` (the Admin SDK bypasses rules; no client reads this
  database), empty `firestore.indexes.json` (no composite index needed yet).
  Deploy rules only with an explicit target:
  `firebase deploy --only firestore:huntry-bc --project evms-demo-d1477`.
- Tests: `tests/lib/credentials-store/credentials-store.contract.test.ts` runs
  one suite against SQLite always, and against Firestore under the emulator
  (`pnpm test:firestore`) or with `FIRESTORE_TEST_LIVE=1` (hosted database,
  unique ids, cleaned up). It is skipped otherwise because `pnpm build` runs
  `vitest run`.
- **Lazy-load SQLite** is not done (option): `get-credentials-store.ts` still
  imports `SqliteCredentialsStore`, and so `node:sqlite`, eagerly. Revisit with
  the Node version question in Phase 0.

#### Phase 2 setup: scoped IAM (you run these)

The project is shared, so the app must not get project-wide Firestore access.
Grant a dedicated service account `roles/datastore.user` with an IAM condition
that limits it to `huntry-bc`, and have dev and the deployed backend run as it:

```shell
gcloud iam service-accounts create huntry-bc-app --project evms-demo-d1477

gcloud projects add-iam-policy-binding evms-demo-d1477   --member="serviceAccount:huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com"   --role="roles/datastore.user"   --condition='expression=resource.name == "projects/evms-demo-d1477/databases/huntry-bc",title=huntry-bc-only'

# Dev: run the app as that account without a key file.
gcloud auth application-default login   --impersonate-service-account=huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com
```

The impersonating user also needs `roles/iam.serviceAccountTokenCreator` on that
account (Owner does not include it; allow a minute or two to propagate):
`gcloud iam service-accounts add-iam-policy-binding huntry-bc-app@evms-demo-d1477.iam.gserviceaccount.com --member="user:<you>" --role="roles/iam.serviceAccountTokenCreator"`

Verified 2026-10-14: live contract suite (`FIRESTORE_TEST_LIVE=1`,
`FIRESTORE_DATABASE_ID=huntry-bc`, `FIREBASE_PROJECT_ID=evms-demo-d1477`,
`npx vitest run tests/lib/credentials-store`) passed 43/43 as the impersonated
account; it read `huntry-bc` and got `PERMISSION_DENIED` on `(default)` and `huntry`.

Verify: the account reads and writes `huntry-bc` and gets `PERMISSION_DENIED` on
`(default)` and `huntry`. If it does not, another broader binding is overriding
it: `gcloud projects get-iam-policy evms-demo-d1477` and remove that one. Your
own (Owner) account is unscoped and should only be used for `firebase deploy` and
console work.

### Phase 3: Firestore Huntry repository  [x]

Implemented on branch `firebase-phase2-credentials-store` (not committed). Where it
differs from or settles the design below:

- Code: `src/lib/huntry/repository/firestore/*` (one file per concern, factories
  take `getDb` like the credentials driver; `index.ts` assembles it). Selected by
  `getHuntryRepository()` for `FIRESTORE` through
  `firestore-repository-loader.ts` / `.unavailable.ts`, aliased in `next.config.ts`
  like the credentials driver. `getHuntryDb()` still throws for `FIRESTORE`.
- **Layout** (all under `stores/{hash}/`): `events`, `sponsors`, `rewards`
  (`productIds` array), `eggs`, `claims` (id `${eggId}_${customerId}`),
  `customers/{id}`, `counters/{ids | egg_{id} | reward_{id}}`, `settings/storefront`,
  `slugs/{sha256}`, `couponCodes/{sha256 of normalized code}`.
- **Unique errors** are `UniqueConstraintError` (message contains `UNIQUE constraint
  failed`), which `isUniqueSlugConstraintError` / `isUniqueCouponCodeConstraintError`
  already recognise: no caller changed.
- **Deletes never touch claims** (SQL claims are denormalized with no FK). Event and
  reward delete cascade to eggs and their `egg_*` counters, as the SQL FKs do.
- **`status: "issued" | "pending"`** on every claim; readers filter by equality, never
  `!=`. `claim_in_progress` (503) is a new `CreatePlayerClaimResult`, handled in the
  claims route and, like `lock_timeout`, shown by the storefront as "retry later".
- **Player claim**: reserve (pending doc, both counters, customer doc) -> `issueCode`
  outside any transaction -> finalize; release restores the customer's last
  position/time, so a failed issue leaves no cooldown. `PENDING_TTL_MS` is 60s.
  An expired reservation is released lazily (same customer: taken over; capacity
  full: one sweep then retry). No BigCommerce "delete code" call exists, so an
  expired reservation that had already issued a code is released and the code is
  left unused (single-use, never shown).
- **Clock**: Firestore uses the app clock for `claimedAt` and rate-limit ages (the
  SQL implementations use the DB clock; `ClaimRateLimitRepository` comment updated).
- **Coupon codes are case-insensitive on Firestore** (reservation on the trimmed,
  uppercased code), stricter than SQL; pinned by a Firestore-only test.
- `createMany` is one batch (<=500); the 30-egg caps keep it far below that, and a
  larger request is rejected rather than split.
- Indexes: `firestore.indexes.json` holds the two composite indexes the claim
  readers need (rate limiter; activity feed), deployed to `huntry-bc` 2026-10-14.
  Everything else uses equality filters and in-memory sorting.
- `scripts/reconcile-huntry-counters.mjs <storeHash | --all> [--fix]` compares the
  counters with the claims (drift exits 1; `--fix` rewrites). Run it after any import.
- Tests: `tests/lib/huntry/repository/{catalog,claims,featured}.contract.test.ts`
  run each suite on SQL and Firestore (`pnpm test:firestore` now includes them; live
  with `FIRESTORE_TEST_LIVE=1`). They include N-claims-on-capacity-K and the
  one-customer-two-eggs cooldown race. Verified: emulator, live `huntry-bc`,
  `pnpm test` (560 pass), `pnpm build` (default driver and `FIRESTORE`).
- **Not done**: rules were released to `huntry-bc` as a side effect of the index
  deploy (see note in the Phase 2 section); no end-to-end `next dev` run with
  `FIRESTORE`; Phase 4 CI and Phase 5 cutover.

Original design notes:

Layout, scoped per store: `stores/{hash}/events/{id}`, `/sponsors/{id}`,
`/rewards/{id}` (`productIds` array replaces `huntry_reward_products`),
`/eggs/{uuid}`, `/claims/{id}`, plus `settings/storefront`, `settings/featured`.

- **Ids**:
  - Events, sponsors and rewards keep numeric ids (URLs, cache tags, BC
    references), allocated from a per-store counter doc in the creating
    transaction. These are created rarely. Ids become unique per store, so every
    lookup must stay scoped by `store_hash`; confirm per module.
  - **Claims must not use a counter**: a counter written on every claim would
    cap a whole store at about 1 claim/s, and it contradicts the deterministic
    claim doc id below. Claims use the string doc id as `HuntryClaim.id`
    (via the `ClaimId` union from Phase 1; also `RedemptionUpdate.claimId` in
    `claims/redemption.ts`). Replace the `ORDER BY claimed_at DESC, id DESC`
    tiebreak with `claimedAt`, then doc id.
- **Uniqueness**: reservation docs (`slugs/{hash}`, `couponCodes/{hash}`)
  written in the same transaction, released on slug/code change and on
  reward/event delete. Use a sha256 hex of the value as the doc id: slugs and
  coupon codes can hold characters invalid in doc ids (`/`, `.`/`..`) or be
  long. Coupon reservations hash the **normalized uppercase** code, which is
  deliberately stricter than today's case-sensitive
  `UNIQUE(store_hash, coupon_code)` and correct because BigCommerce codes are
  case-insensitive. NULL coupon codes get no reservation.
  `UNIQUE(egg_id, bc_customer_id)` becomes the deterministic claim doc id
  `${eggId}_${customerId}` with `create()`.
- **Database setup**: enable Firestore (Native mode); the location is immutable,
  so match the App Hosting region (EVMS uses `europe-west1`). Use one clock
  source for `claimed_at` (cooldown and speed checks compare them).
- **Claim transaction** (`claims/player-claim.ts` `runClaim` / `loadContext`,
  ~133-323; replaces `pg_advisory_xact_lock` + `FOR UPDATE`):
  - Serialize on documents, not on `count()` queries (a count inside a
    transaction does not reliably block a concurrent insert, so two claims could
    both see K-1).
  - **Counters live in separate docs**, not on admin-edited docs:
    `stores/{hash}/counters/egg_{id}` and `reward_{id}`, created lazily inside
    the transaction. If they sat on the reward/egg doc, a `set()` from
    `rewards-api.ts` / `eggs-api.ts` would reset capacity. Keep them correct on
    forced claims (`createForcedClaim`: counts toward capacity, skips checks),
    claim deletion, and event/reward deletion (delete the counters too). Add a
    reconcile script (counters vs `count()` aggregates over claims) and run it
    as the backfill step after any import.
  - **Counter doc fields and forced claims.** Egg counters hold `eventId`,
    `count` and `forced`. `fetchEggClaimCounts` (`claims-api.ts`) becomes one
    query by `eventId`, and `fetchFullEggIds` queries by `eventId` and filters
    `count >= capacity` in memory (no composite index). Counts include `pending`
    reservations, because reserved capacity is capacity. Port forced claims
    faithfully (so the shared contract suite can assert parity): today they
    count toward egg and reward capacity and `customer_in_event`, and the
    cooldown's last-claim lookup has no `is_forced` filter; they are excluded
    only from the rate limiter and leaderboard. `createForcedClaim` is one
    transaction: `create()` the claim doc (`duplicate` if it exists, including a
    pending one), update the egg and reward counters, and update the customer doc
    (`eventCounts`, and `lastClaimAt` with `lastLat`/`lastLng` null, which skips
    the speed check exactly as today).
  - **Per-(store, customer) doc**, `stores/{hash}/customers/{customerId}`, read
    and written by every claim. Today's advisory lock on `store:customer` guards
    the 3s cooldown, the 20 m/s speed check (both read the customer's last claim
    across **all** eggs and events) and `maxGrabCount`. A per-(event, customer)
    counter alone would let one customer claiming two eggs concurrently bypass
    cooldown and speed. The doc holds `lastClaimAt`, `lastLat`, `lastLng` and
    `eventCounts{eventId: n}`, replacing the `lastClaim` and `customerInEvent`
    queries. Use one clock (app server `Date.now()`, with `claimedAt` stamped by
    the same clock) because the cooldown is 3s.
  - Hot docs sustain about 1 write/s; transactions retry, and today's
    `FOR UPDATE` also serializes per reward, so throughput is equivalent.
  - Transactions retry, so `issueClaimCode` must not run inside one. Reserve
    (claim doc status `pending`, counters incremented), call the API, finalize in
    a second transaction. On API failure release the reservation.
  - **Pending semantics (must be defined):**
    - Write the issued code onto the pending doc immediately after
      `issueClaimCode`. The finalize and the expiry sweep both handle "pending
      with a code": finalize it, or delete the BC code before releasing.
    - The finalize transaction verifies the reservation still exists (a sweep
      may have expired it).
    - Every claim reader excludes `pending`: `claims/leaderboard.ts`,
      `claims/game-activity.ts`, `claims-api.ts` (`listClaimsForCustomer`,
      `fetchEggClaimCounts`, `fetchFullEggIds`), `claims/claim-rate-limit.ts`,
      `claims/redemption.ts`. Add a contract test per reader.
    - A re-request while a claim is pending returns a new `claim_in_progress`
      result (today it returns `duplicate` with the code), or waits briefly.
    - Add pending expiry (sweep or lazy cleanup) so crashes do not leak
      capacity.
  - Keep the idempotent "return existing code" path and the `lock_timeout`
    status mapping.
- `claims/redemption.ts` `markRedemptions`: per-claim compare-and-set
  (`unredeemed` to `redeemed`/`flagged_unauthorized_use`) in a transaction.
  `findClaimsByCouponCodes` matches case-insensitively in SQL
  (`UPPER(coupon_code)`) because BigCommerce echoes the code as the shopper
  typed it, and a case-sensitive Firestore `where('couponCode','in',...)` would
  never match lowercase entries. Store `couponCodeNormalized`
  (`normalizeCouponCode`: trim + uppercase) on every claim doc and query `in` on
  that field (max 30 values, so chunk). Query only the store's `claims`
  subcollection, never a collection-group query, so store scoping holds. The
  cart webhook and `validate-coupon` use this same lookup.
- `claims/leaderboard.ts`: aggregate in memory over the event's claims at first.
- Cascades (event to eggs, reward to eggs): `recursiveDelete` or batched
  deletes; reward delete nulls `sponsor_id` on sponsors' rewards via query.
- `firestore.indexes.json`: build a per-query index checklist, one row per
  query. Known ones: the rate limiter (`bcCustomerId`, `isForced`,
  `claimedAt desc`; `claims/claim-rate-limit.ts`), the leaderboard and activity
  queries, `claimedAt` orderings, and the `eventId` / `bcCustomerId` /
  `couponCode` lookups. The emulator does not enforce composite indexes, so run
  the suite once against the live dev database before sign-off.
  `firestore.rules`: deny all client access (server uses the Admin SDK).
- Batched writes and transactions are limited to 500 operations: the egg batch
  insert ("Stop Placing", `eggs/eggs-api.ts`) must chunk, with per-chunk
  idempotency.
- No geospatial queries needed (`src/lib/huntry/eggs/geo.ts` is in-JS).
  `huntry_events.theme` becomes a map; timestamps use Firestore `Timestamp`,
  converted in the row mappers.

### Phase 4: tests  [ ]

- Run the Firestore implementation against the emulator
  (`firebase emulators:start --only firestore`).
- Keep the SQLite tests for the SQL implementation; add a shared contract suite
  run against both.
- Concurrency test: N parallel claims against capacity K, assert exactly K
  succeed (replaces the skipped `player-claim.postgres.test.ts`). Also cover one
  customer claiming two different eggs concurrently (cooldown and speed must
  still hold).
- **Build gating**: `pnpm build` runs `vitest run`, so the emulator suite must
  use `describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)` (same pattern as
  `player-claim.postgres.test.ts`) or the build fails wherever no emulator runs.
- **CI**: Phase 0's `buildCommand` skips `vitest run` and the repo has no CI, so
  deploys would be untested. Add a CI job (GitHub Actions or Cloud Build) that
  starts the emulator, runs the full suite, and gates the rollout.

### Phase 5: cutover, data migration and rollback  [ ]

- Decide first whether real merchant data exists (the repo only shows a dev
  store). If not, cut over by reinstalling (the `/api/app/auth` callback re-saves
  tokens) and re-creating events.
- If data exists: write a one-off SQL to Firestore import (reuse
  `CREDENTIALS_ENCRYPTION_KEY` so tokens decrypt), backfill counters and the
  per-customer docs, run the reconcile script, and rehearse against a staging
  copy first.
- Rollback: keep the SQL implementation and the Postgres database (read-only)
  for a stabilization period, so rolling back means flipping
  `CREDENTIALS_STORE_DRIVER`. Drop the SQL path only after that period.

## Where config, credentials and SDK live

**Why the Admin SDK and IAM, not an API key.** Firestore is reached only from
Next.js route handlers, using `firebase-admin`. Admin SDK calls authenticate as
a service account, are authorized by IAM roles, and bypass Firestore security
rules. The client `firebaseConfig` / API key (EVMS keeps it in
`lib/firebase_options_*.dart`) is only a project identifier for client SDKs
running on a user's device; this app has no such client. It also has no
Firebase Auth users to evaluate rules against: merchants authenticate via the
BigCommerce signed payload and the app session (`src/lib/session/`), and
shoppers are anonymous or BigCommerce customers. Capacity checks, coupon
issuing (needs the BC secret) and webhook handling must run server-side
anyway. EVMS already uses this same Admin SDK + IAM pattern in
`functions/index.js` (`autoFlipEventStatus`).

Browser-direct Firestore (e.g. live map updates) is not in this plan and nothing
in `src/` needs it: the storefront script only calls this app's own routes. The
consequence is that map freshness is bounded by HTTP caching, not Firestore:
`map-data` and `cta-data` send `s-maxage=30, stale-while-revalidate=60`
(`src/app/api/public/huntry/[storeHash]/`), so a filled egg can look available for
up to about 90s; tapping it ends in `capacity_full`, which `claim-outcome.ts`
shows as "full". `revalidateTag` in the claim route is per-instance on Cloud Run
(see Phase 0).

If fresher data is wanted, in order of preference:

1. Leave it as is (a stale egg fails gracefully).
2. Shorten `s-maxage` or add an `ETag`, and re-fetch `map-data` on
   `visibilitychange` or a timer while the map is open. Server-only; no new auth.
3. Only for sub-second push: the Firebase client SDK in the storefront script.
   That needs client config, Firebase Auth tokens minted from the verified
   BigCommerce customer JWT (`storefront-auth/verify-customer-jwt.ts`), real
   security rules (the deny-all `firestore.rules` would block it) over a separate
   public mirror collection (egg positions and full/not-full only, since the
   current docs also hold admin fields), and SDK weight on merchant storefronts.
   Not recommended.

| Item | Where |
|---|---|
| SDK | `firebase-admin` in `package.json`; initialised in a new `src/lib/firebase/admin.ts` (not built yet) |
| Project ID, database name | New env vars (names TBD): `.env.local` locally, `apphosting.yaml` deployed |
| Credentials, emulator | None: `FIRESTORE_EMULATOR_HOST` + `GCLOUD_PROJECT` |
| Credentials, real project locally | `gcloud auth application-default login`, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON (gitignored, never committed; same rule as `.env.local` in `AGENTS.md`) |
| Credentials, deployed | None stored; the App Hosting backend's service account (ADC), which needs `roles/datastore.user` (see Phase 0 IAM) |

### Dev only vs deploy only

- **Dev only (emulator)**: `firebase-admin`, `src/lib/firebase/admin.ts`,
  `.env.local` (driver, project ID, emulator host), `firebase.json`,
  `.firebaserc`, `firestore.indexes.json`, `firestore.rules`.
  `firebase emulators:start` reads `firebase.json`.
- **Deploy only (Phase 0 onward)**: `apphosting.yaml` (runConfig,
  buildCommand, env, secrets). Only App Hosting reads it; local dev runs from
  `.env.local` and does not need it.

## Live Firestore for dev (not the emulator)

The emulator is a local, throwaway simulation. Live dev uses a real Firestore
database.

- **Where**: prefer a separate dev Firebase project, or at least a separate
  named database (e.g. `huntry-dev`) in the same project. Never point dev at
  production data. Create it in the console: Firestore Database, Native mode,
  location (immutable; match the App Hosting region).
- **Config**: project ID and database name in `.env.local` (env var names TBD).
  No `firebaseConfig` / API key anywhere.
- **Credentials**: Application Default Credentials
  (`gcloud auth application-default login`; the account needs
  `roles/datastore.user` on the project), or a gitignored service-account JSON
  via `GOOGLE_APPLICATION_CREDENTIALS`. Organizations often block key creation,
  so start with ADC.
- **Not set up yet**: `firebase-admin`, `src/lib/firebase/admin.ts` and the
  `FIRESTORE` driver are Phases 1-3. Creating the project and database early is
  fine, but nothing reads them until then.
- **Differences from the emulator**:
  - Live rejects queries that need a composite index that does not exist; the
    emulator does not enforce this. Deploy `firestore.indexes.json` first:
    `firebase deploy --only firestore:indexes --project <dev-project>`.
  - Deploy the deny-all `firestore.rules` too.
  - Reads and writes count against quota. Keep claim concurrency tests on the
    emulator; use live for manual and end-to-end checks.

## Toggling Firebase vs local SQLite

Env only; `CREDENTIALS_STORE_DRIVER` selects the implementation.

- **Deployed**: `apphosting.yaml` sets `FIRESTORE`. The Admin SDK uses
  Application Default Credentials on Cloud Run (no key file). Use a named
  database via `getFirestore(app, "<name>")`.
- **Local SQLite**: unset or `SQLITE` in `.env.local` (data in `./data/*.sqlite`).
  The shared resolver (Phase 1) fails closed: an unrecognized value throws, and
  `SQLITE` throws on Cloud Run (`K_SERVICE`) unless
  `HUNTRY_ALLOW_EPHEMERAL_SQLITE=1`, so a misconfigured deploy cannot silently
  run on a per-instance SQLite file.
- **Local Firestore**: `CREDENTIALS_STORE_DRIVER=FIRESTORE`,
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `GCLOUD_PROJECT=<project id>`; or a
  separate dev database in the real project via
  `gcloud auth application-default login`. Restart `next dev` after switching
  (`next.config.ts` aliases drivers at startup/build).
- Data stores are separate and not synced. A BigCommerce app has one callback
  URL, so use a second app registration (own client ID, secret, tunnel
  `APP_ORIGIN`) and a dev store for local. Use distinct `SESSION_SECRET`s and
  a separate `CREDENTIALS_ENCRYPTION_KEY` unless data is shared.

## Risks

- Scope: multi-week. Phase 0 and Phases 1-2 each ship independently.
- Node version on App Hosting (Phase 0 blocker).
- Claim correctness under retries (Phase 3: counters on documents; external call
  outside the transaction).
- Existing data is not auto-migrated; see Phase 5 (reinstall, or import with
  `CREDENTIALS_ENCRYPTION_KEY` reused, plus rollback).
- Counter drift: counters are the capacity authority, so the reconcile script
  (Phase 3) must exist before any real traffic.
- Missing composite indexes only fail on the live database, not the emulator.
- Split brain if the driver is misconfigured (mitigated by the Phase 1 fail-closed
  resolver; keep its tests).
- Cost: `fetchFullEggIds` runs per public map request. With counter docs it is
  one query by `eventId`, bounded by the route's `s-maxage`.
- Env var names for the project ID and database name are still TBD; settle them
  in Phase 2 and record them here.
- Cost: Firestore bills per read/write; leaderboard and activity queries read
  many docs.

## Verification

1. Phase 0: roll out, hit `/api/public/huntry/<storeHash>/map-data`, install on
   the dev store, confirm `after()` provisioning finished.
2. Phase 1: `pnpm test` green with no test edits.
3. Phases 2-4: contract suite on SQLite and the emulator; concurrency test.
4. End to end: a test order fires `/api/webhooks/huntry/order` and marks the
   redemption; check Cloud Run logs for Firestore errors; run both local toggle
   modes.
