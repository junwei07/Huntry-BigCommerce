// Indirection point between get-db.ts and the shared Postgres pool — get-db.ts
// imports from here, never directly from credentials-store/postgres-driver/
// get-pool.ts. next.config.ts's turbopack.resolveAlias swaps this specifier
// for postgres-pool-loader.unavailable.ts whenever CREDENTIALS_STORE_DRIVER
// isn't "POSTGRES", the same technique used for
// credentials-store/postgres-driver-loader.ts and for the same reason: it
// keeps `pg` out of builds that would never select it anyway (see that
// file's comment for why `pg` can't be bundled for the Cloudflare Workers
// runtime). Huntry reuses credentials-store's own pool rather than opening a
// second one, so this simply re-exports it under a specifier this app's
// alias can target independently.
export { getPool } from "@/lib/credentials-store/postgres-driver/get-pool";
