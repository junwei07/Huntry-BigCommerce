import type { CredentialsStoreDriver } from "@/lib/credentials-store/types";

// One resolver for CREDENTIALS_STORE_DRIVER, shared by get-credentials-store.ts
// and get-db.ts so a single value always governs both credentials and Huntry's
// own data. Fails closed: the old per-module "anything unrecognized means
// SQLITE" fallback would let one half of the app move to another backend while
// the other half silently kept writing to a per-instance SQLite file.
//
// Reads process.env on every call (no caching) so tests and per-request
// callers always see the current value. next.config.ts repeats the trim +
// uppercase normalization for its build-time alias; keep the two in step.
const VALID_DRIVERS: CredentialsStoreDriver[] = ["SQLITE", "POSTGRES", "FIRESTORE"];

export function resolveCredentialsStoreDriver(): CredentialsStoreDriver {
  const raw = process.env.CREDENTIALS_STORE_DRIVER?.trim().toUpperCase();
  const driver = raw ? raw : "SQLITE";

  if (!VALID_DRIVERS.includes(driver as CredentialsStoreDriver)) {
    throw new Error(
      `Unrecognized CREDENTIALS_STORE_DRIVER "${process.env.CREDENTIALS_STORE_DRIVER}". ` +
        `Valid values: ${VALID_DRIVERS.join(", ")} (unset means SQLITE).`,
    );
  }

  // K_SERVICE is set by Cloud Run (and so Firebase App Hosting) at runtime
  // only, never in the build step, so `next build` is unaffected. Not keyed on
  // NODE_ENV: a local `next start` with SQLite is a supported setup.
  if (driver === "SQLITE" && process.env.K_SERVICE && process.env.HUNTRY_ALLOW_EPHEMERAL_SQLITE !== "1") {
    throw new Error(
      "CREDENTIALS_STORE_DRIVER resolves to SQLITE on Cloud Run, where the local file is per-instance and " +
        "ephemeral. Set CREDENTIALS_STORE_DRIVER to a hosted driver, or set HUNTRY_ALLOW_EPHEMERAL_SQLITE=1 " +
        "to run on throwaway data.",
    );
  }

  return driver as CredentialsStoreDriver;
}
