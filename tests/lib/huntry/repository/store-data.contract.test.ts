import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { createFirestoreStoreDataRepository } from "@/lib/huntry/repository/firestore/store-data";
import { storeRef } from "@/lib/huntry/repository/firestore/paths";
import type { StoreDataRepository } from "@/lib/huntry/repository/types";

// Same split as the other repository contract tests: SQLite always runs,
// Firestore only against the emulator (`pnpm test:firestore`) or with
// FIRESTORE_TEST_LIVE=1.
const useFirestore = Boolean(process.env.FIRESTORE_EMULATOR_HOST) || process.env.FIRESTORE_TEST_LIVE === "1";

const randomHash = () => `t${Math.floor(Math.random() * 1e9).toString(36)}${Date.now().toString(36)}`;
const createdStoreHashes = new Set<string>();

function newStoreHash(): string {
  const storeHash = randomHash();

  createdStoreHashes.add(storeHash);

  return storeHash;
}

let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-store-data-contract-"));
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  delete process.env.CREDENTIALS_STORE_DRIVER;
});

afterAll(async () => {
  if (useFirestore) {
    const db = getFirestoreDb();

    await Promise.all([...createdStoreHashes].map((hash) => db.recursiveDelete(storeRef(db, hash))));
  }

  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // The SQLite handle can lock the directory on Windows; best effort.
  }
});

interface Implementation {
  name: string;
  repository: () => Promise<StoreDataRepository>;
  seed: (storeHash: string) => Promise<void>;
  // How many Huntry records the store still has, across every collection/table.
  remaining: (storeHash: string) => Promise<number>;
}

// Every subcollection the app writes under stores/{hash} (paths.ts), so a
// collection added to the app but missed by the wipe fails here.
const FIRESTORE_COLLECTIONS = [
  "events",
  "sponsors",
  "rewards",
  "eggs",
  "claims",
  "customers",
  "counters",
  "settings",
  "slugs",
  "couponCodes",
];

const sqlImplementation: Implementation = {
  name: "sql",
  repository: async () => (await import("@/lib/huntry/repository/sql/store-data")).sqlStoreDataRepository,
  async seed(storeHash) {
    const { getHuntryDb } = await import("@/lib/huntry/db/get-db");
    const db = getHuntryDb() as DatabaseSync;

    db.prepare("INSERT INTO huntry_sponsors (id, store_hash, name) VALUES (?, ?, 'sponsor')").run(
      hashToId(storeHash, 1),
      storeHash,
    );
    db.prepare(
      `INSERT INTO huntry_rewards (id, store_hash, name, sponsor_id, discount_type, discount_value, coupon_code)
       VALUES (?, ?, 'reward', ?, 'percent', 10, 'CODE')`,
    ).run(hashToId(storeHash, 2), storeHash, hashToId(storeHash, 1));
    db.prepare("INSERT INTO huntry_reward_products (reward_id, bc_product_id) VALUES (?, 7)").run(hashToId(storeHash, 2));
    db.prepare("INSERT INTO huntry_events (id, store_hash, name, slug) VALUES (?, ?, 'event', 'event')").run(
      hashToId(storeHash, 3),
      storeHash,
    );
    db.prepare(
      "INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, lat, lng) VALUES (?, ?, ?, ?, 1, 1)",
    ).run(`egg-${storeHash}`, storeHash, hashToId(storeHash, 2), hashToId(storeHash, 3));
    db.prepare(
      `INSERT INTO huntry_claims (store_hash, egg_id, reward_id, event_id, reward_name_snapshot, bc_customer_id, coupon_code)
       VALUES (?, ?, 1, 1, 'reward', 1, 'CODE')`,
    ).run(storeHash, `egg-${storeHash}`);
    db.prepare("INSERT INTO huntry_storefront_settings (store_hash) VALUES (?)").run(storeHash);
  },
  async remaining(storeHash) {
    const { getHuntryDb } = await import("@/lib/huntry/db/get-db");
    const db = getHuntryDb() as DatabaseSync;
    let total = 0;

    for (const table of [
      "huntry_claims",
      "huntry_eggs",
      "huntry_rewards",
      "huntry_events",
      "huntry_sponsors",
      "huntry_storefront_settings",
    ]) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE store_hash = ?`).get(storeHash) as { c: number };

      total += row.c;
    }

    const products = db
      .prepare("SELECT COUNT(*) AS c FROM huntry_reward_products WHERE reward_id = ?")
      .get(hashToId(storeHash, 2)) as { c: number };

    return total + products.c;
  },
};

// SQLite ids are global integers, so derive stable, collision-free ones per test store.
const idCache = new Map<string, number>();
let nextId = 1000;

function hashToId(storeHash: string, slot: number): number {
  const key = `${storeHash}:${slot}`;

  if (!idCache.has(key)) {
    idCache.set(key, nextId++);
  }

  return idCache.get(key)!;
}

const firestoreImplementation: Implementation = {
  name: "firestore",
  repository: async () => createFirestoreStoreDataRepository(getFirestoreDb),
  async seed(storeHash) {
    const db = getFirestoreDb();

    // The credentials driver's own subcollection: deleteAllStoreData must leave it.
    await storeRef(db, storeHash).collection("storeUsers").doc("1").set({ userId: 1 });

    for (const collection of FIRESTORE_COLLECTIONS) {
      await storeRef(db, storeHash).collection(collection).doc("x").set({ seeded: true });
    }

    // A nested document and a collection this repository has never heard of.
    await storeRef(db, storeHash).collection("events").doc("x").collection("nested").doc("y").set({ seeded: true });
    await storeRef(db, storeHash).collection("addedLater").doc("x").set({ seeded: true });
  },
  async remaining(storeHash) {
    const db = getFirestoreDb();
    const collections = await storeRef(db, storeHash).listCollections();
    let total = 0;

    for (const collection of collections) {
      if (collection.id !== "storeUsers") {
        total += (await collection.get()).size;
      }
    }

    return total;
  },
};

const implementations = [sqlImplementation, ...(useFirestore ? [firestoreImplementation] : [])];

describe.each(implementations)("StoreDataRepository ($name)", ({ repository, seed, remaining }) => {
  it("deletes every record the store has and leaves another store untouched", async () => {
    const target = newStoreHash();
    const bystander = newStoreHash();
    const subject = await repository();

    await seed(target);
    await seed(bystander);

    expect(await remaining(target)).toBeGreaterThan(0);

    await subject.deleteAllStoreData(target);

    expect(await remaining(target)).toBe(0);
    expect(await remaining(bystander)).toBeGreaterThan(0);
  });

  it("is idempotent, so a retried uninstall can run it again", async () => {
    const storeHash = newStoreHash();
    const subject = await repository();

    await seed(storeHash);
    await subject.deleteAllStoreData(storeHash);

    await expect(subject.deleteAllStoreData(storeHash)).resolves.toBeUndefined();
    expect(await remaining(storeHash)).toBe(0);
  });

  it("does nothing for a store that never had data", async () => {
    const subject = await repository();

    await expect(subject.deleteAllStoreData(newStoreHash())).resolves.toBeUndefined();
  });
});

if (useFirestore) {
  describe("StoreDataRepository (firestore) credentials boundary", () => {
    it("leaves the storeUsers subcollection for deleteStore to unlink", async () => {
      const storeHash = newStoreHash();
      const subject = await firestoreImplementation.repository();

      await firestoreImplementation.seed(storeHash);
      await subject.deleteAllStoreData(storeHash);

      const links = await storeRef(getFirestoreDb(), storeHash).collection("storeUsers").get();

      expect(links.size).toBe(1);
    });
  });
}
