import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirestoreCredentialsStore } from "@/lib/credentials-store/firestore-driver/firestore-credentials-store";
import { SqliteCredentialsStore } from "@/lib/credentials-store/sqlite-driver/sqlite-credentials-store";
import { CredentialsStore } from "@/lib/credentials-store/types";
import { getFirestoreDb } from "@/lib/firebase/admin";

// One behavioural suite run against every driver that is available here. SQLite
// always runs. Firestore runs only against the emulator (`pnpm test:firestore`)
// or, deliberately opted in with FIRESTORE_TEST_LIVE=1, against the hosted
// database named by FIRESTORE_DATABASE_ID: `pnpm build` runs `vitest run`, so it
// must never reach for a database on its own.
const useFirestore = Boolean(process.env.FIRESTORE_EMULATOR_HOST) || process.env.FIRESTORE_TEST_LIVE === "1";

// The Firestore client is a process singleton and nothing resets the database
// between tests, so every test works on ids no other test (or earlier run) uses.
const randomId = () => Math.floor(Math.random() * 1_000_000_000) + 1;
const randomHash = () => `t${randomId().toString(36)}${randomId().toString(36)}`;

const createdStoreHashes = new Set<string>();
const createdUserIds = new Set<number>();

function newStoreHash(): string {
  const storeHash = randomHash();

  createdStoreHashes.add(storeHash);

  return storeHash;
}

function newUserId(): number {
  const userId = randomId();

  createdUserIds.add(userId);

  return userId;
}

const drivers: { name: string; create: () => CredentialsStore }[] = [
  { name: "SqliteCredentialsStore", create: () => new SqliteCredentialsStore(":memory:") },
  ...(useFirestore ? [{ name: "FirestoreCredentialsStore", create: () => new FirestoreCredentialsStore() }] : []),
];

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = "contract-test-encryption-key";

  if (useFirestore) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_DATABASE_ID ??= "(default)";
      process.env.GCLOUD_PROJECT ??= "demo-huntry";
    }
  }
});

afterAll(async () => {
  if (!useFirestore) {
    return;
  }

  const db = getFirestoreDb();

  for (const storeHash of createdStoreHashes) {
    await db.recursiveDelete(db.collection("stores").doc(storeHash));
  }

  for (const userId of createdUserIds) {
    await db.collection("users").doc(String(userId)).delete();
  }
});

describe.each(drivers)("$name", ({ create }) => {
  it("reports nothing for a store that was never installed", async () => {
    const store = create();
    const storeHash = newStoreHash();

    expect(await store.getStoreToken(storeHash)).toBeUndefined();
    expect(await store.getStoreExtension(storeHash)).toBeUndefined();
    expect(await store.getStoreStorefrontScript(storeHash)).toBeUndefined();
    expect(await store.getStoreStorefrontPage(storeHash)).toBeUndefined();
    expect(await store.getStoreWebhook(storeHash, "store/order/created")).toBeUndefined();
    expect(await store.isStoreUserLinked(storeHash, newUserId())).toBe(false);
  });

  it("round-trips the token and replaces it on a repeat setStore", async () => {
    const store = create();
    const storeHash = newStoreHash();
    const adminUserId = newUserId();

    await store.setStore({ storeHash, accessToken: "token-1", scope: "scope-1", adminUserId });

    expect(await store.getStoreToken(storeHash)).toBe("token-1");

    await store.setStore({ storeHash, accessToken: "token-2", scope: "scope-2", adminUserId });

    expect(await store.getStoreToken(storeHash)).toBe("token-2");
  });

  it("keeps the per-store child records when setStore runs again", async () => {
    const store = create();
    const storeHash = newStoreHash();
    const adminUserId = newUserId();

    await store.setStore({ storeHash, accessToken: "token-1", scope: "s", adminUserId });
    await store.setStoreExtension({ storeHash, extensionId: "ext-1" });
    await store.setStoreStorefrontScript({ storeHash, scriptId: "script-1" });
    await store.setStoreStorefrontPage({ storeHash, pageId: 42, createdByApp: true });
    await store.setStoreWebhook({ storeHash, scope: "store/order/created", hookId: "hook-1" });

    await store.setStore({ storeHash, accessToken: "token-2", scope: "s", adminUserId });

    expect(await store.getStoreExtension(storeHash)).toBe("ext-1");
    expect(await store.getStoreStorefrontScript(storeHash)).toBe("script-1");
    expect(await store.getStoreStorefrontPage(storeHash)).toEqual({ storeHash, pageId: 42, createdByApp: true });
    expect(await store.getStoreWebhook(storeHash, "store/order/created")).toBe("hook-1");
  });

  it("round-trips the storefront page flag both ways and replaces it", async () => {
    const store = create();
    const storeHash = newStoreHash();

    await store.setStoreStorefrontPage({ storeHash, pageId: 7, createdByApp: false });

    expect(await store.getStoreStorefrontPage(storeHash)).toEqual({ storeHash, pageId: 7, createdByApp: false });

    await store.setStoreStorefrontPage({ storeHash, pageId: 8, createdByApp: true });

    expect(await store.getStoreStorefrontPage(storeHash)).toEqual({ storeHash, pageId: 8, createdByApp: true });
  });

  it("keeps webhook scopes apart, including scopes with slashes and dots", async () => {
    const store = create();
    const storeHash = newStoreHash();

    await store.setStoreWebhook({ storeHash, scope: "store/order/created", hookId: "a" });
    await store.setStoreWebhook({ storeHash, scope: "store/cart.v2/created", hookId: "b" });
    await store.setStoreWebhook({ storeHash, scope: "store/order/created", hookId: "c" });

    expect(await store.getStoreWebhook(storeHash, "store/order/created")).toBe("c");
    expect(await store.getStoreWebhook(storeHash, "store/cart.v2/created")).toBe("b");
    expect(await store.getStoreWebhook(storeHash, "store/other")).toBeUndefined();
  });

  it("links users to stores idempotently and per store", async () => {
    const store = create();
    const storeA = newStoreHash();
    const storeB = newStoreHash();
    const userId = newUserId();

    await store.setUser({ userId, email: "a@example.com" });
    await store.setStoreUser({ storeHash: storeA, userId });
    await store.setStoreUser({ storeHash: storeA, userId });

    expect(await store.isStoreUserLinked(storeA, userId)).toBe(true);
    expect(await store.isStoreUserLinked(storeB, userId)).toBe(false);
  });

  it("deleteStore removes that store and its links but leaves other stores alone", async () => {
    const store = create();
    const storeA = newStoreHash();
    const storeB = newStoreHash();
    const userA = newUserId();
    const userB = newUserId();

    for (const [storeHash, userId] of [
      [storeA, userA],
      [storeB, userB],
    ] as const) {
      await store.setUser({ userId, email: `${userId}@example.com` });
      await store.setStore({ storeHash, accessToken: `token-${storeHash}`, scope: "s", adminUserId: userId });
      await store.setStoreUser({ storeHash, userId });
      await store.setStoreExtension({ storeHash, extensionId: "ext" });
      await store.setStoreWebhook({ storeHash, scope: "store/order/created", hookId: "hook" });
    }

    await store.deleteStore(storeA);

    expect(await store.getStoreToken(storeA)).toBeUndefined();
    expect(await store.getStoreExtension(storeA)).toBeUndefined();
    expect(await store.getStoreWebhook(storeA, "store/order/created")).toBeUndefined();
    expect(await store.isStoreUserLinked(storeA, userA)).toBe(false);

    expect(await store.getStoreToken(storeB)).toBe(`token-${storeB}`);
    expect(await store.getStoreExtension(storeB)).toBe("ext");
    expect(await store.isStoreUserLinked(storeB, userB)).toBe(true);
  });

  it("deleteStore keeps a user who is still linked to another store", async () => {
    const store = create();
    const storeA = newStoreHash();
    const storeB = newStoreHash();
    const shared = newUserId();

    await store.setUser({ userId: shared, email: "shared@example.com" });

    for (const storeHash of [storeA, storeB]) {
      await store.setStore({ storeHash, accessToken: "t", scope: "s", adminUserId: shared });
      await store.setStoreUser({ storeHash, userId: shared });
    }

    await store.deleteStore(storeA);

    expect(await store.isStoreUserLinked(storeA, shared)).toBe(false);
    expect(await store.isStoreUserLinked(storeB, shared)).toBe(true);
  });

  it("deleteStore and deleteUser are no-ops for things that do not exist", async () => {
    const store = create();

    await expect(store.deleteStore(newStoreHash())).resolves.toBeUndefined();
    await expect(store.deleteUser(newStoreHash(), newUserId())).resolves.toBeUndefined();
  });

  it("deleteUser unlinks one user without touching the store or other users", async () => {
    const store = create();
    const storeHash = newStoreHash();
    const leaving = newUserId();
    const staying = newUserId();

    await store.setStore({ storeHash, accessToken: "token", scope: "s", adminUserId: staying });

    for (const userId of [leaving, staying]) {
      await store.setUser({ userId, email: `${userId}@example.com` });
      await store.setStoreUser({ storeHash, userId });
    }

    await store.deleteUser(storeHash, leaving);

    expect(await store.isStoreUserLinked(storeHash, leaving)).toBe(false);
    expect(await store.isStoreUserLinked(storeHash, staying)).toBe(true);
    expect(await store.getStoreToken(storeHash)).toBe("token");
  });

  it.each(["", "a/b", "..", ".", "__x__/y", "a b", "x".repeat(65)])(
    "treats the malformed store hash %j as a store that does not exist",
    async (storeHash) => {
      const store = create();

      expect(await store.getStoreToken(storeHash)).toBeUndefined();
      expect(await store.getStoreExtension(storeHash)).toBeUndefined();
      expect(await store.getStoreStorefrontScript(storeHash)).toBeUndefined();
      expect(await store.getStoreStorefrontPage(storeHash)).toBeUndefined();
      expect(await store.getStoreWebhook(storeHash, "store/order/created")).toBeUndefined();
      expect(await store.isStoreUserLinked(storeHash, 1)).toBe(false);
      await expect(store.deleteStore(storeHash)).resolves.toBeUndefined();
    },
  );
});

describe.skipIf(!useFirestore)("FirestoreCredentialsStore specifics", () => {
  const store = () => new FirestoreCredentialsStore();

  it("encrypts the access token at rest", async () => {
    const storeHash = newStoreHash();

    await store().setStore({ storeHash, accessToken: "plain-token", scope: "s", adminUserId: newUserId() });

    const stored = (await getFirestoreDb().collection("stores").doc(storeHash).get()).get("accessToken");

    expect(typeof stored).toBe("string");
    expect(stored).not.toContain("plain-token");
  });

  it("does not treat a child record written before setStore as an installed store", async () => {
    const storeHash = newStoreHash();

    await store().setStoreExtension({ storeHash, extensionId: "ext" });

    expect(await store().getStoreToken(storeHash)).toBeUndefined();
    expect(await store().getStoreExtension(storeHash)).toBe("ext");
  });

  it("rejects writes for a malformed store hash or user id", async () => {
    await expect(store().setStore({ storeHash: "a/b", accessToken: "t", scope: "s", adminUserId: 1 })).rejects.toThrow();
    await expect(store().setUser({ userId: 0, email: "x@example.com" })).rejects.toThrow();
  });

  it("deletes a user who loses their last store, and keeps one with stores left", async () => {
    const storeA = newStoreHash();
    const storeB = newStoreHash();
    const solo = newUserId();
    const shared = newUserId();
    const users = getFirestoreDb().collection("users");

    await store().setStore({ storeHash: storeA, accessToken: "t", scope: "s", adminUserId: solo });
    await store().setStore({ storeHash: storeB, accessToken: "t", scope: "s", adminUserId: shared });

    for (const [storeHash, userId] of [
      [storeA, solo],
      [storeA, shared],
      [storeB, shared],
    ] as const) {
      await store().setUser({ userId, email: `${userId}@example.com` });
      await store().setStoreUser({ storeHash, userId });
    }

    await store().deleteStore(storeA);

    expect((await users.doc(String(solo)).get()).exists).toBe(false);
    expect((await users.doc(String(shared)).get()).exists).toBe(true);
  });

  it("deleteUser deletes a user nobody links, even when the link being removed never existed", async () => {
    const storeHash = newStoreHash();
    const userId = newUserId();
    const users = getFirestoreDb().collection("users");

    await store().setUser({ userId, email: "orphan@example.com" });

    expect((await users.doc(String(userId)).get()).exists).toBe(true);

    await store().deleteUser(storeHash, userId);

    expect((await users.doc(String(userId)).get()).exists).toBe(false);
  });

  it("deleteStore leaves the store's other subcollections (Huntry data) in place", async () => {
    const storeHash = newStoreHash();
    const event = getFirestoreDb().collection("stores").doc(storeHash).collection("events").doc("1");

    await store().setStore({ storeHash, accessToken: "t", scope: "s", adminUserId: newUserId() });
    await event.set({ name: "survives an uninstall" });

    await store().deleteStore(storeHash);

    expect(await store().getStoreToken(storeHash)).toBeUndefined();
    expect((await event.get()).exists).toBe(true);
  });
});
