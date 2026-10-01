import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// isAuthorizedForStore calls connection() directly, and session-cookie.ts
// (which it depends on transitively) calls cookies() — both are Next.js
// request-context-only APIs that throw outside an actual request. These are
// the only two things mocked here; everything else (JWT signing/
// verification, the real SQLite credentials store, isAuthorizedForStore's
// own logic) runs for real.
vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
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

beforeEach(() => {
  cookieJar.clear();
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-authz-test-"));
  process.env.CREDENTIALS_STORE_DRIVER = "SQLITE";
  process.env.CREDENTIALS_SQLITE_PATH = path.join(tempDir, "credentials.sqlite");
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "test-session-secret-at-least-this-long";
  process.env.DATA_MODE = "MULTITENANT";
});

afterEach(() => {
  vi.resetModules();

  // SqliteCredentialsStore keeps its DatabaseSync handle open for the
  // process lifetime (matching production — it's never explicitly closed)
  // and doesn't expose a way to close it from outside, so on Windows the
  // temp directory's file can still be locked here. Best-effort cleanup;
  // a leftover temp dir is harmless, unlike failing the suite over it.
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored — see comment above.
  }
});

const USER_ID = 1;
const LINKED_STORE_HASH = "store-a";
const UNLINKED_STORE_HASH = "store-b";

async function seedLinkedStore() {
  const { SqliteCredentialsStore } = await import("@/lib/credentials-store/sqlite-driver/sqlite-credentials-store");
  const store = new SqliteCredentialsStore();

  await store.setUser({ userId: USER_ID, email: "admin@example.com" });
  await store.setStore({ storeHash: LINKED_STORE_HASH, accessToken: "token", scope: "x", adminUserId: USER_ID });
  await store.setStoreUser({ storeHash: LINKED_STORE_HASH, userId: USER_ID });

  return store;
}

async function signCookieFor(authenticatedStores: string[]) {
  const { signSession } = await import("@/lib/session/session-jwt");
  const { SESSION_COOKIE_NAME } = await import("@/lib/session/types");
  const jwt = await signSession({ userId: USER_ID, authenticatedStores, issuedAt: Math.floor(Date.now() / 1000) });

  cookieJar.set(SESSION_COOKIE_NAME, jwt);
}

describe("isAuthorizedForStore", () => {
  it("authorizes a store the session claims and the DB confirms is linked", async () => {
    await seedLinkedStore();
    await signCookieFor([LINKED_STORE_HASH]);

    const { isAuthorizedForStore } = await import("@/lib/session/is-authorized-for-store");

    await expect(isAuthorizedForStore(LINKED_STORE_HASH)).resolves.toBe(true);
  });

  it("does not authorize a different store the session never claimed (store isolation)", async () => {
    await seedLinkedStore();
    await signCookieFor([LINKED_STORE_HASH]);

    const { isAuthorizedForStore } = await import("@/lib/session/is-authorized-for-store");

    await expect(isAuthorizedForStore(UNLINKED_STORE_HASH)).resolves.toBe(false);
  });

  it("does not authorize a claimed store whose link was revoked in the DB", async () => {
    const store = await seedLinkedStore();
    await signCookieFor([LINKED_STORE_HASH]);

    // Simulate a revoked store-user link after the cookie was issued —
    // proxy.ts's cheap cookie check can't see this; isStoreUserLinked is the
    // authoritative check that must catch it.
    await store.deleteUser(LINKED_STORE_HASH, USER_ID);

    const { isAuthorizedForStore } = await import("@/lib/session/is-authorized-for-store");

    await expect(isAuthorizedForStore(LINKED_STORE_HASH)).resolves.toBe(false);
  });

  it("returns false when no storeHash is given", async () => {
    await seedLinkedStore();
    await signCookieFor([LINKED_STORE_HASH]);

    const { isAuthorizedForStore } = await import("@/lib/session/is-authorized-for-store");

    await expect(isAuthorizedForStore(undefined)).resolves.toBe(false);
  });
});
