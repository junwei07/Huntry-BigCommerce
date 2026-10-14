import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { createFirestoreClaimsRepository } from "@/lib/huntry/repository/firestore/claims";
import { createFirestoreEggsRepository } from "@/lib/huntry/repository/firestore/eggs";
import { createFirestoreEventsRepository } from "@/lib/huntry/repository/firestore/events";
import { createFirestoreFeaturedRepository } from "@/lib/huntry/repository/firestore/featured";
import { storeRef } from "@/lib/huntry/repository/firestore/paths";
import { createFirestoreRewardsRepository } from "@/lib/huntry/repository/firestore/rewards";
import { createFirestoreSponsorsRepository } from "@/lib/huntry/repository/firestore/sponsors";
import type {
  ClaimsRepository,
  EggsRepository,
  EventsRepository,
  FeaturedRepository,
  RewardsRepository,
  SponsorsRepository,
} from "@/lib/huntry/repository/types";

// Shared setup for the repository contract suites. Every suite runs once against
// the SQL implementation (always) and once against Firestore, but only against
// the emulator (`pnpm test:firestore`) or with FIRESTORE_TEST_LIVE=1: `pnpm
// build` runs `vitest run`, so it must never reach for a database on its own.
export const useFirestore = Boolean(process.env.FIRESTORE_EMULATOR_HOST) || process.env.FIRESTORE_TEST_LIVE === "1";

export interface TestRepositories {
  featured: FeaturedRepository;
  sponsors: SponsorsRepository;
  events: EventsRepository;
  rewards: RewardsRepository;
  eggs: EggsRepository;
  claims: ClaimsRepository;
}

const randomHash = () => `t${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`;
const createdStoreHashes = new Set<string>();

// A store hash no other test (or earlier run) uses; Firestore data under it is
// removed after the file's tests.
export function newStoreHash(): string {
  const storeHash = randomHash();

  createdStoreHashes.add(storeHash);

  return storeHash;
}

let tempDir: string | undefined;

// Registers the SQLite temp database and the Firestore cleanup for one test file.
export function useRepositoryHarness(): void {
  beforeAll(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "huntry-repository-contract-"));
    process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
    // Resolved per call: the SQL side needs the SQLITE default even if the shell sets the driver.
    delete process.env.CREDENTIALS_STORE_DRIVER;

    // The emulator has no real databases, so the required id may be anything.
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_DATABASE_ID ??= "(default)";
      process.env.GCLOUD_PROJECT ??= "demo-huntry";
    }
  });

  afterAll(async () => {
    if (useFirestore) {
      const db = getFirestoreDb();

      await Promise.all([...createdStoreHashes].map((hash) => db.recursiveDelete(storeRef(db, hash))));
    }

    try {
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // The SQLite handle can lock the directory on Windows; best effort.
    }
  });
}

async function sqlRepositories(): Promise<TestRepositories> {
  return {
    featured: (await import("@/lib/huntry/repository/sql/featured")).sqlFeaturedRepository,
    sponsors: (await import("@/lib/huntry/repository/sql/sponsors")).sqlSponsorsRepository,
    events: (await import("@/lib/huntry/repository/sql/events")).sqlEventsRepository,
    rewards: (await import("@/lib/huntry/repository/sql/rewards")).sqlRewardsRepository,
    eggs: (await import("@/lib/huntry/repository/sql/eggs")).sqlEggsRepository,
    claims: (await import("@/lib/huntry/repository/sql/claims")).sqlClaimsRepository,
  };
}

async function firestoreRepositories(): Promise<TestRepositories> {
  return {
    featured: createFirestoreFeaturedRepository(),
    sponsors: createFirestoreSponsorsRepository(),
    events: createFirestoreEventsRepository(),
    rewards: createFirestoreRewardsRepository(),
    eggs: createFirestoreEggsRepository(),
    claims: createFirestoreClaimsRepository(),
  };
}

export const implementations: { name: "sql" | "firestore"; create: () => Promise<TestRepositories> }[] = [
  { name: "sql", create: sqlRepositories },
  ...(useFirestore ? [{ name: "firestore" as const, create: firestoreRepositories }] : []),
];
