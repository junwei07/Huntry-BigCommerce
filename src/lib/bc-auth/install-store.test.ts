import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenResponse } from "@/lib/bc-auth/exchange-code-for-token";

// InstallSaveFailedError/TokenExchangeFailedError are deliberately NOT
// statically imported here: after vi.resetModules() (see afterEach), a
// fresh dynamic import of install-store.ts gets its own fresh instance of
// errors.ts, whose class exports are a different identity than a
// module-top-level static import would hold onto — breaking `instanceof`.
// Each test imports errors.ts dynamically instead, in the same
// post-reset module registry state as the code under test.

// install-store.ts's own dependencies that require an actual Next.js
// request context — same rationale/pattern as is-authorized-for-store.test.ts.
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

// The token-exchange HTTP call to BigCommerce itself is a separate concern
// (its own module, not this ticket's target) — mocked directly rather than
// stubbing global fetch, so this test isn't coupled to that function's
// request shape.
const exchangeCodeForTokenMock = vi.fn();

vi.mock("@/lib/bc-auth/exchange-code-for-token", () => ({
  exchangeCodeForToken: (...args: unknown[]) => exchangeCodeForTokenMock(...args),
}));

let tempDir: string;

const VALID_TOKEN_RESPONSE: TokenResponse = {
  access_token: "test-access-token",
  scope: "store_v2_customers",
  user: { id: 7, username: "admin", email: "admin@example.com" },
  context: "stores/abc123",
  account_uuid: "00000000-0000-0000-0000-000000000000",
};

beforeEach(() => {
  cookieJar.clear();
  exchangeCodeForTokenMock.mockReset();
  tempDir = mkdtempSync(path.join(tmpdir(), "huntry-install-test-"));
  process.env.CREDENTIALS_STORE_DRIVER = "SQLITE";
  process.env.CREDENTIALS_SQLITE_PATH = path.join(tempDir, "credentials.sqlite");
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SESSION_SECRET = "test-session-secret-at-least-this-long";
});

afterEach(() => {
  vi.resetModules();

  // See is-authorized-for-store.test.ts's afterEach for why this is
  // best-effort rather than asserted.
  try {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {
    // Ignored.
  }
});

const INSTALL_PARAMS = { code: "auth-code", context: "stores/abc123", scope: "store_v2_customers", redirectUri: "https://app.example.com/api/app/auth" };

describe("installStore", () => {
  it("writes user, store, and store-user in that order, and establishes a session", async () => {
    exchangeCodeForTokenMock.mockResolvedValue(VALID_TOKEN_RESPONSE);

    const { SqliteCredentialsStore } = await import("@/lib/credentials-store/sqlite-driver/sqlite-credentials-store");
    const realStore = new SqliteCredentialsStore();
    const setUserSpy = vi.spyOn(realStore, "setUser");
    const setStoreSpy = vi.spyOn(realStore, "setStore");
    const setStoreUserSpy = vi.spyOn(realStore, "setStoreUser");

    vi.doMock("@/lib/credentials-store/get-credentials-store", () => ({
      getCredentialsStore: () => realStore,
    }));

    const { installStore } = await import("@/lib/bc-auth/install-store");
    const result = await installStore(INSTALL_PARAMS);

    expect(result).toEqual({ storeHash: "abc123", accessToken: "test-access-token" });

    expect(setUserSpy).toHaveBeenCalledWith({ userId: 7, email: "admin@example.com" });
    expect(setStoreSpy).toHaveBeenCalledWith({
      storeHash: "abc123",
      accessToken: "test-access-token",
      scope: "store_v2_customers",
      adminUserId: 7,
    });
    expect(setStoreUserSpy).toHaveBeenCalledWith({ storeHash: "abc123", userId: 7 });

    // The doc comment on installStore says Postgres's FKs require this
    // order — verify it's actually followed, not just documented.
    const userOrder = setUserSpy.mock.invocationCallOrder[0];
    const storeOrder = setStoreSpy.mock.invocationCallOrder[0];
    const storeUserOrder = setStoreUserSpy.mock.invocationCallOrder[0];

    expect(userOrder).toBeLessThan(storeOrder);
    expect(storeOrder).toBeLessThan(storeUserOrder);

    const isLinked = await realStore.isStoreUserLinked("abc123", 7);
    expect(isLinked).toBe(true);

    const { SESSION_COOKIE_NAME } = await import("@/lib/session/types");
    const { verifySession } = await import("@/lib/session/session-jwt");
    const cookie = cookieJar.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();

    const session = await verifySession(cookie!);
    expect(session.userId).toBe(7);
    expect(session.authenticatedStores).toEqual(["abc123"]);
  });

  it("propagates TokenExchangeFailedError unchanged", async () => {
    const { TokenExchangeFailedError } = await import("@/lib/bc-auth/errors");
    const tokenExchangeError = new TokenExchangeFailedError({ cause: "network down" });
    exchangeCodeForTokenMock.mockRejectedValue(tokenExchangeError);

    const { installStore } = await import("@/lib/bc-auth/install-store");

    await expect(installStore(INSTALL_PARAMS)).rejects.toBe(tokenExchangeError);
  });

  it("wraps a credentials-store write failure in InstallSaveFailedError", async () => {
    exchangeCodeForTokenMock.mockResolvedValue(VALID_TOKEN_RESPONSE);

    vi.doMock("@/lib/credentials-store/get-credentials-store", () => ({
      getCredentialsStore: () => ({
        setUser: vi.fn().mockResolvedValue(undefined),
        setStore: vi.fn().mockRejectedValue(new Error("disk full")),
        setStoreUser: vi.fn(),
      }),
    }));

    const { installStore } = await import("@/lib/bc-auth/install-store");
    const { InstallSaveFailedError } = await import("@/lib/bc-auth/errors");

    await expect(installStore(INSTALL_PARAMS)).rejects.toBeInstanceOf(InstallSaveFailedError);
  });
});
