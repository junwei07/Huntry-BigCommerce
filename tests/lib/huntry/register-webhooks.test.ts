import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({ getRestApiClient: vi.fn() }));
vi.mock("@/lib/credentials-store/get-credentials-store", () => ({ getCredentialsStore: vi.fn() }));

const { logError } = await import("@/lib/errors/logger");
const { getRestApiClient } = await import("@/lib/bc-api-client/get-rest-api-client");
const { getCredentialsStore } = await import("@/lib/credentials-store/get-credentials-store");
const { ensureWebhooks, findOrCreateOrderWebhook, registerWebhooks } = await import("@/lib/huntry/register-webhooks");

function fakeClient(existing: { id: number; scope: string }[], options: { failPost?: boolean } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: BcRestApiClient = {
    async get() {
      return { data: { data: existing }, headers: new Headers() } as never;
    },
    async post(path, mutation) {
      calls.push({ method: "POST", path, body: mutation?.body });

      if (options.failPost) {
        throw new Error("403");
      }

      return { data: { data: { id: 77 } }, headers: new Headers() } as never;
    },
    async put() {
      throw new Error("not used");
    },
    async delete() {
      throw new Error("not used");
    },
  };

  return { client, calls };
}

beforeEach(() => {
  process.env.APP_ORIGIN = "https://huntry-app.example.com";
  vi.clearAllMocks();
});

describe("findOrCreateOrderWebhook", () => {
  it("creates an active store/order/created hook pointing at the order route", async () => {
    const { client, calls } = fakeClient([]);

    expect(await findOrCreateOrderWebhook(client)).toBe("77");
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v3/hooks",
        body: {
          scope: "store/order/created",
          destination: "https://huntry-app.example.com/api/webhooks/huntry/order",
          is_active: true,
        },
      },
    ]);
  });

  it("adopts an existing hook for the scope without creating a duplicate", async () => {
    const { client, calls } = fakeClient([
      { id: 5, scope: "store/cart/updated" },
      { id: 9, scope: "store/order/created" },
    ]);

    expect(await findOrCreateOrderWebhook(client)).toBe("9");
    expect(calls).toEqual([]);
  });
});

describe("registerWebhooks", () => {
  it("registers the order and cart-coupon hooks and persists each hook id", async () => {
    const { client, calls } = fakeClient([]);
    const setStoreWebhook = vi.fn();

    vi.mocked(getRestApiClient).mockResolvedValue(client);
    vi.mocked(getCredentialsStore).mockReturnValue({ setStoreWebhook } as never);

    await registerWebhooks("store1", "token");

    expect(getRestApiClient).toHaveBeenCalledWith("store1", "token");
    expect(calls.map((call) => call.body)).toEqual([
      expect.objectContaining({
        scope: "store/order/created",
        destination: "https://huntry-app.example.com/api/webhooks/huntry/order",
      }),
      expect.objectContaining({
        scope: "store/cart/couponApplied",
        destination: "https://huntry-app.example.com/api/webhooks/huntry/cart",
      }),
    ]);
    expect(setStoreWebhook).toHaveBeenCalledWith({ storeHash: "store1", scope: "store/order/created", hookId: "77" });
    expect(setStoreWebhook).toHaveBeenCalledWith({ storeHash: "store1", scope: "store/cart/couponApplied", hookId: "77" });
  });

  it("logs instead of throwing when registration fails", async () => {
    const { client } = fakeClient([], { failPost: true });
    const setStoreWebhook = vi.fn();

    vi.mocked(getRestApiClient).mockResolvedValue(client);
    vi.mocked(getCredentialsStore).mockReturnValue({ setStoreWebhook } as never);

    await expect(registerWebhooks("store1", "token")).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledTimes(2);
    expect(setStoreWebhook).not.toHaveBeenCalled();
  });

  it("still registers the other scope when one fails", async () => {
    const { client } = fakeClient([{ id: 9, scope: "store/order/created" }]);
    const setStoreWebhook = vi.fn().mockRejectedValueOnce(new Error("db down"));

    vi.mocked(getRestApiClient).mockResolvedValue(client);
    vi.mocked(getCredentialsStore).mockReturnValue({ setStoreWebhook } as never);

    await registerWebhooks("store1", "token");

    expect(logError).toHaveBeenCalledTimes(1);
    expect(setStoreWebhook).toHaveBeenCalledWith({ storeHash: "store1", scope: "store/cart/couponApplied", hookId: "77" });
  });
});

describe("ensureWebhooks", () => {
  it("makes no API call when every scope already has a stored record", async () => {
    const getStoreWebhook = vi.fn().mockResolvedValue("5");
    const getStoreToken = vi.fn();

    vi.mocked(getCredentialsStore).mockReturnValue({ getStoreWebhook, getStoreToken } as never);

    await ensureWebhooks("store1");

    expect(getStoreToken).not.toHaveBeenCalled();
    expect(getRestApiClient).not.toHaveBeenCalled();
  });

  it("registers only the missing scope, using the stored token", async () => {
    const { client, calls } = fakeClient([]);
    const getStoreWebhook = vi.fn(async (_hash: string, scope: string) => (scope === "store/order/created" ? "5" : undefined));
    const setStoreWebhook = vi.fn();

    vi.mocked(getRestApiClient).mockResolvedValue(client);
    vi.mocked(getCredentialsStore).mockReturnValue({
      getStoreWebhook,
      getStoreToken: vi.fn().mockResolvedValue("token"),
      setStoreWebhook,
    } as never);

    await ensureWebhooks("store1");

    expect(getRestApiClient).toHaveBeenCalledWith("store1", "token");
    expect(calls).toHaveLength(1);
    expect(setStoreWebhook).toHaveBeenCalledTimes(1);
    expect(setStoreWebhook).toHaveBeenCalledWith({ storeHash: "store1", scope: "store/cart/couponApplied", hookId: "77" });
  });

  it("never throws", async () => {
    vi.mocked(getCredentialsStore).mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(ensureWebhooks("store1")).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });
});
