import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same Next.js request-context mocks as the rewards action tests.
vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/cache", () => ({
  updateTag: vi.fn(),
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined),
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (nameOrOptions: string | { name: string }) => {
      cookieJar.delete(typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name);
    },
  })),
}));

let tempDir: string;

const USER_ID = 1;
const STORE_HASH = "store-a";

const INPUT = { bannerDescription: "Hello", productCtaTitle: "Title", productCtaDescription: "Desc" };

beforeEach(() => {
  cookieJar.clear();
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-featured-actions-test-"));
  process.env.CREDENTIALS_STORE_DRIVER = "SQLITE";
  process.env.CREDENTIALS_SQLITE_PATH = path.join(tempDir, "credentials.sqlite");
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "test-session-secret-at-least-this-long";
  process.env.HUNTRY_SQLITE_PATH = path.join(tempDir, "huntry.sqlite");
  process.env.DATA_MODE = "MULTITENANT";
});

afterEach(() => {
  vi.resetModules();

  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored (Windows file locks), see the rewards action tests.
  }
});

async function authorize(storeHash: string) {
  const { SqliteCredentialsStore } = await import("@/lib/credentials-store/sqlite-driver/sqlite-credentials-store");
  const store = new SqliteCredentialsStore();

  await store.setUser({ userId: USER_ID, email: "admin@example.com" });
  await store.setStore({ storeHash, accessToken: "token", scope: "x", adminUserId: USER_ID });
  await store.setStoreUser({ storeHash, userId: USER_ID });

  const { signSession } = await import("@/lib/session/session-jwt");
  const { SESSION_COOKIE_NAME } = await import("@/lib/session/types");

  cookieJar.set(
    SESSION_COOKIE_NAME,
    await signSession({ userId: USER_ID, authenticatedStores: [storeHash], issuedAt: Math.floor(Date.now() / 1000) }),
  );
}

describe("saveHuntryFeaturedSettings", () => {
  it("rejects an unauthorized store without writing", async () => {
    const { saveHuntryFeaturedSettings } = await import("@/app/store/[storeHash]/huntry/featured/actions");
    const { NOT_AUTHORIZED_FOR_STORE_MESSAGE } = await import("@/lib/session/is-authorized-for-store");
    const { fetchStorefrontSettingsUncached: fetchStorefrontSettings } = await import("@/lib/huntry/featured/featured-api");

    expect(await saveHuntryFeaturedSettings(INPUT, STORE_HASH)).toEqual({
      success: false,
      message: NOT_AUTHORIZED_FOR_STORE_MESSAGE,
    });
    expect((await fetchStorefrontSettings(STORE_HASH)).bannerDescription).toBe("");
  });

  it("saves for an authorized store", async () => {
    await authorize(STORE_HASH);

    const { saveHuntryFeaturedSettings } = await import("@/app/store/[storeHash]/huntry/featured/actions");
    const { fetchStorefrontSettingsUncached: fetchStorefrontSettings } = await import("@/lib/huntry/featured/featured-api");

    expect((await saveHuntryFeaturedSettings(INPUT, STORE_HASH)).success).toBe(true);
    expect(await fetchStorefrontSettings(STORE_HASH)).toEqual(INPUT);
  });

  it("rejects invalid input with the validation message and writes nothing", async () => {
    await authorize(STORE_HASH);

    const { saveHuntryFeaturedSettings } = await import("@/app/store/[storeHash]/huntry/featured/actions");
    const { fetchStorefrontSettingsUncached: fetchStorefrontSettings } = await import("@/lib/huntry/featured/featured-api");
    const result = await saveHuntryFeaturedSettings({ ...INPUT, bannerDescription: "x".repeat(121) }, STORE_HASH);

    expect(result).toEqual({ success: false, message: "Banner description must be 120 characters or fewer." });
    expect((await fetchStorefrontSettings(STORE_HASH)).bannerDescription).toBe("");
  });
});
