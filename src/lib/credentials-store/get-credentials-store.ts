// Postgres and Firestore come from their *-driver-loader.ts files rather than directly from
// the implementation, so a build-time alias can swap in a stub. See both loader files.
import { cache } from "react";
import { FirestoreCredentialsStore } from "@/lib/credentials-store/firestore-driver-loader";
import { PostgresCredentialsStore } from "@/lib/credentials-store/postgres-driver-loader";
import { SqliteCredentialsStore } from "@/lib/credentials-store/sqlite-driver/sqlite-credentials-store";
import { CredentialsStore, CredentialsStoreDriver } from "@/lib/credentials-store/types";
import { resolveCredentialsStoreDriver } from "@/lib/huntry/db/resolve-driver";

// Memoized per request so every call shares one instance (and, for
// SqliteCredentialsStore, one open DB connection).
const getCachedCredentialsStore = cache((driver: CredentialsStoreDriver): CredentialsStore => {
  switch (driver) {
    case "SQLITE":
      return new SqliteCredentialsStore();
    case "POSTGRES":
      return new PostgresCredentialsStore();
    case "FIRESTORE":
      return new FirestoreCredentialsStore();
  }
});

// Selects the CredentialsStore implementation, based on
// CREDENTIALS_STORE_DRIVER (see huntry/db/resolve-driver.ts: unrecognized
// values throw rather than fall back). SQLITE is for local development and
// single-instance use; the other two are for multi-instance deployments, and
// the choice between them is a hosting decision — POSTGRES for a Node host
// such as Vercel + Neon, FIRESTORE for Firebase.
export function getCredentialsStore(): CredentialsStore {
  return getCachedCredentialsStore(resolveCredentialsStoreDriver());
}
