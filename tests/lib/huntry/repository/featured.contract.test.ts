import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { createFirestoreFeaturedRepository } from "@/lib/huntry/repository/firestore/featured";
import { reserveNumericId } from "@/lib/huntry/repository/firestore/counters";
import { storeRef } from "@/lib/huntry/repository/firestore/paths";
import type { FeaturedRepository } from "@/lib/huntry/repository/types";

// One suite for every FeaturedRepository implementation available here. SQLite
// always runs; Firestore only against the emulator (`pnpm test:firestore`) or
// with FIRESTORE_TEST_LIVE=1, because `pnpm build` runs `vitest run`.
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
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-repository-contract-"));
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  // Resolved per call: SQL tests need the SQLITE default even if the shell has the driver set.
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

const implementations: { name: string; create: () => Promise<FeaturedRepository> }[] = [
  {
    name: "sql",
    create: async () => (await import("@/lib/huntry/repository/sql/featured")).sqlFeaturedRepository,
  },
  ...(useFirestore ? [{ name: "firestore", create: async () => createFirestoreFeaturedRepository() }] : []),
];

describe.each(implementations)("FeaturedRepository ($name)", ({ create }) => {
  it("returns blank defaults for a store that never saved", async () => {
    const repository = await create();

    expect(await repository.getStorefrontSettings(newStoreHash())).toEqual({
      bannerDescription: "",
      productCtaTitle: "",
      productCtaDescription: "",
      bannerLogoUrl: "",
      bannerImageUrl: "",
    });
  });

  it("replaces the previous save", async () => {
    const repository = await create();
    const storeHash = newStoreHash();

    await repository.saveStorefrontSettings(storeHash, { bannerDescription: "A", productCtaTitle: "B", productCtaDescription: "C", bannerLogoUrl: "", bannerImageUrl: "" });
    await repository.saveStorefrontSettings(storeHash, { bannerDescription: "A2", productCtaTitle: "", productCtaDescription: "C2", bannerLogoUrl: "https://img.example/l.png", bannerImageUrl: "https://img.example/b.png" });

    expect(await repository.getStorefrontSettings(storeHash)).toEqual({
      bannerDescription: "A2",
      productCtaTitle: "",
      productCtaDescription: "C2",
      bannerLogoUrl: "https://img.example/l.png",
      bannerImageUrl: "https://img.example/b.png",
    });
  });

  it("keeps stores isolated", async () => {
    const repository = await create();
    const mine = newStoreHash();

    await repository.saveStorefrontSettings(mine, { bannerDescription: "mine", productCtaTitle: "", productCtaDescription: "", bannerLogoUrl: "", bannerImageUrl: "" });

    expect((await repository.getStorefrontSettings(newStoreHash())).bannerDescription).toBe("");
  });
});

describe.skipIf(!useFirestore)("Firestore plumbing", () => {
  it("rejects a store hash that is not a plain id", async () => {
    const repository = createFirestoreFeaturedRepository();

    for (const bad of ["", "a/b", "..", "__x__/y"]) {
      await expect(repository.getStorefrontSettings(bad)).rejects.toThrow("Invalid store hash.");
    }
  });

  it("hands out increasing ids per kind and store, never the same id twice under contention", async () => {
    const db = getFirestoreDb();
    const storeHash = newStoreHash();
    const other = newStoreHash();

    const allocate = (hash: string, kind: "events" | "sponsors" | "rewards") =>
      db.runTransaction(async (tx) => {
        const reserved = await reserveNumericId(db, tx, hash, kind);

        reserved.commit();

        return reserved.id;
      });

    const ids = await Promise.all(Array.from({ length: 5 }, () => allocate(storeHash, "events")));

    expect([...ids].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(await allocate(storeHash, "rewards")).toBe(1);
    expect(await allocate(other, "events")).toBe(1);
  }, 30_000);
});
