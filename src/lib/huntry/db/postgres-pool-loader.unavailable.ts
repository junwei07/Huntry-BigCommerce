// Type-only import: erased at compile time, so it never pulls the `pg`
// package into this file's runtime output — that would defeat the point of
// this stub (see comment below).
import type { Pool } from "pg";

// Swapped in for postgres-pool-loader.ts by next.config.ts's
// turbopack.resolveAlias whenever CREDENTIALS_STORE_DRIVER isn't
// "POSTGRES", keeping `pg` out of the compiled output on targets that would
// never select it anyway. Throws rather than no-oping: if this is ever
// actually called, the alias and the runtime driver selection have drifted
// out of sync, and that should fail loudly.
export function getPool(): Pool {
  throw new Error(
    "Huntry's POSTGRES database access is not available in this deployment target's build " +
      "(see next.config.ts's turbopack.resolveAlias) — CREDENTIALS_STORE_DRIVER must not be set " +
      "to POSTGRES here.",
  );
}
