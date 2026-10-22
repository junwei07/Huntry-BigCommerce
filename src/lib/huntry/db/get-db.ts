import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Pool } from "pg";
import { CREATE_HUNTRY_SCHEMA } from "@/lib/huntry/db/sqlite-schema";
import { getPool } from "@/lib/huntry/db/postgres-pool-loader";
import { resolveCredentialsStoreDriver } from "@/lib/huntry/db/resolve-driver";

// Huntry's own data (events/sponsors/rewards/eggs/claims) isn't shaped like
// credentials-store's key-value store lookups, so it doesn't go through the
// CredentialsStore interface — each concept's own `-api.ts` writes its own
// SQL against whichever raw handle this returns, the same spirit as
// getRestApiClient for a different backend. Reuses CREDENTIALS_STORE_DRIVER
// rather than introducing a separate env var, since Huntry's data lives in
// the same Postgres database as credentials-store (see docs/MIGRATION.md
// §1) — one driver choice governs both.
export type HuntryDb = Pool | DatabaseSync;

const DEFAULT_SQLITE_DB_PATH = "./data/huntry.sqlite";

function getSqliteDbPath(): string {
  return process.env.HUNTRY_SQLITE_PATH ?? DEFAULT_SQLITE_DB_PATH;
}

// DatabaseSync creates the database file itself if missing, but not any
// missing parent directory (the gitignored ./data/) — without this, a first
// run fails with a raw SQLITE_CANTOPEN.
function openSqliteDb(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);

  db.exec(CREATE_HUNTRY_SCHEMA);

  return db;
}

// One connection per warm serverless instance (module-level singleton, not
// per-request/per-call) — mirrors getPool()'s own caching.
let sqliteDb: DatabaseSync | undefined;

function getSqliteDb(): DatabaseSync {
  if (!sqliteDb) {
    sqliteDb = openSqliteDb(getSqliteDbPath());
  }

  return sqliteDb;
}

// Unrecognized driver values throw in the shared resolver.
function getHuntryDbDriver(): "SQLITE" | "POSTGRES" {
  const configuredDriver = resolveCredentialsStoreDriver();

  if (configuredDriver === "POSTGRES") {
    return "POSTGRES";
  }

  // Huntry's own data on Firestore goes through getHuntryRepository(), never a raw
  // SQL handle. Falling back to SQLite here would split the app across two
  // backends, so fail instead.
  if (configuredDriver === "FIRESTORE") {
    throw new Error(
      "getHuntryDb: CREDENTIALS_STORE_DRIVER=FIRESTORE keeps Huntry's data in Firestore, which has no " +
        "SQL handle: go through getHuntryRepository() (docs/FIREBASE-MIGRATION.md, Phase 3).",
    );
  }

  return "SQLITE";
}

export function getHuntryDb(): HuntryDb {
  return getHuntryDbDriver() === "POSTGRES" ? getPool() : getSqliteDb();
}
