import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteCredentialsStore } from "@/lib/credentials-store/sqlite-driver/sqlite-credentials-store";

let store: SqliteCredentialsStore;

beforeEach(async () => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = "test-encryption-key-for-storefront-page";
  // In-memory database: nothing to clean up (an open file handle blocks
  // deleting a temp file on Windows).
  store = new SqliteCredentialsStore(":memory:");

  await store.setStore({ storeHash: "abc123", accessToken: "token", scope: "s", adminUserId: 1 });
});

afterEach(() => {
  delete process.env.CREDENTIALS_ENCRYPTION_KEY;
});

describe("SqliteCredentialsStore storefront page record", () => {
  it("is empty until the page is provisioned", async () => {
    expect(await store.getStoreStorefrontPage("abc123")).toBeUndefined();
  });

  it("round-trips the page id and the created-by-app flag, both ways", async () => {
    await store.setStoreStorefrontPage({ storeHash: "abc123", pageId: 5, createdByApp: true });

    expect(await store.getStoreStorefrontPage("abc123")).toEqual({ storeHash: "abc123", pageId: 5, createdByApp: true });

    await store.setStoreStorefrontPage({ storeHash: "abc123", pageId: 9, createdByApp: false });

    expect(await store.getStoreStorefrontPage("abc123")).toEqual({ storeHash: "abc123", pageId: 9, createdByApp: false });
  });

  it("is per store and is removed by deleteStore", async () => {
    await store.setStore({ storeHash: "other", accessToken: "token", scope: "s", adminUserId: 2 });
    await store.setStoreStorefrontPage({ storeHash: "abc123", pageId: 5, createdByApp: true });
    await store.setStoreStorefrontPage({ storeHash: "other", pageId: 6, createdByApp: true });

    await store.deleteStore("abc123");

    expect(await store.getStoreStorefrontPage("abc123")).toBeUndefined();
    expect((await store.getStoreStorefrontPage("other"))?.pageId).toBe(6);
  });
});
