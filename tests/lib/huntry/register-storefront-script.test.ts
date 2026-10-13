import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";
import { AppError } from "@/lib/errors/app-error";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({ getRestApiClient: vi.fn() }));
vi.mock("@/lib/credentials-store/get-credentials-store", () => ({ getCredentialsStore: vi.fn() }));

const { logError } = await import("@/lib/errors/logger");
const { STOREFRONT_SCRIPT_CONSENT_CATEGORY, findOrCreateStorefrontScript } = await import(
  "@/lib/huntry/register-storefront-script"
);

const CLIENT_ID = "client-1";

function fakeClient(existing: { uuid: string; consent_category?: string; src?: string }[], options: { failPut?: boolean } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: BcRestApiClient = {
    async get() {
      return { data: { data: existing.map((script) => ({ ...script, api_client_id: CLIENT_ID })) }, headers: new Headers() } as never;
    },
    async post(path, mutation) {
      calls.push({ method: "POST", path, body: mutation?.body });

      return { data: { data: { uuid: "new-uuid" } }, headers: new Headers() } as never;
    },
    async put(path, mutation) {
      calls.push({ method: "PUT", path, body: mutation?.body });

      if (options.failPut) {
        throw new Error("403");
      }

      return { data: {}, headers: new Headers() } as never;
    },
    async delete() {
      throw new Error("not used");
    },
  };

  return { client, calls };
}

beforeEach(() => {
  process.env.APP_ORIGIN = "https://huntry-app.example.com";
  process.env.BIGCOMMERCE_CLIENT_ID = CLIENT_ID;
  vi.clearAllMocks();
});

const SRC = "https://huntry-app.example.com/api/public/huntry/abc123/storefront-script.js";

describe("findOrCreateStorefrontScript consent category", () => {
  it("registers a new script as essential so the cookie banner can't hold it back", async () => {
    const { client, calls } = fakeClient([]);

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("new-uuid");
    expect(STOREFRONT_SCRIPT_CONSENT_CATEGORY).toBe("essential");
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/v3/content/scripts",
        body: expect.objectContaining({ consent_category: "essential", kind: "src", auto_uninstall: true }),
      },
    ]);
  });

  it("adopts an up-to-date script without writing", async () => {
    const { client, calls } = fakeClient([{ uuid: "s1", consent_category: "essential", src: SRC }]);

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("s1");
    expect(calls).toEqual([]);
  });

  it("brings an older functional script up to essential", async () => {
    const { client, calls } = fakeClient([{ uuid: "s1", consent_category: "functional", src: SRC }]);

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("s1");
    expect(calls).toEqual([{ method: "PUT", path: "/v3/content/scripts/s1", body: { consent_category: "essential" } }]);
  });

  it("repoints a script whose src still names the old APP_ORIGIN, changing only what differs", async () => {
    const { client, calls } = fakeClient([
      { uuid: "s1", consent_category: "essential", src: "https://old-tunnel.ngrok-free.dev/api/public/huntry/abc123/storefront-script.js" },
    ]);

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("s1");
    expect(calls).toEqual([{ method: "PUT", path: "/v3/content/scripts/s1", body: { src: SRC } }]);
  });

  it("still adopts the script when the update is rejected, and logs it", async () => {
    const { client } = fakeClient([{ uuid: "s1", consent_category: "functional" }], { failPut: true });

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("s1");
    expect(logError).toHaveBeenCalled();
  });
});

// BC-HUN-051: the script now loads on checkout too (visibility all_pages), which
// BigCommerce only allows with the Checkout Content scope.
describe("findOrCreateStorefrontScript checkout visibility", () => {
  const forbidden = () => new AppError("UPSTREAM_API", "forbidden", { status: 403 });

  // A client whose POST/PUT can be told to refuse specific bodies.
  function scopedClient(
    existing: { uuid: string; consent_category?: string; src?: string; visibility?: string }[],
    refuse: { post?: (body: Record<string, unknown>) => boolean; put?: (body: Record<string, unknown>) => boolean } = {},
  ) {
    const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
    const client: BcRestApiClient = {
      async get() {
        return { data: { data: existing.map((script) => ({ ...script, api_client_id: CLIENT_ID })) }, headers: new Headers() } as never;
      },
      async post(path, mutation) {
        const body = (mutation?.body ?? {}) as Record<string, unknown>;

        calls.push({ method: "POST", path, body });

        if (refuse.post?.(body)) throw forbidden();

        return { data: { data: { uuid: "new-uuid" } }, headers: new Headers() } as never;
      },
      async put(path, mutation) {
        const body = (mutation?.body ?? {}) as Record<string, unknown>;

        calls.push({ method: "PUT", path, body });

        if (refuse.put?.(body)) throw forbidden();

        return { data: {}, headers: new Headers() } as never;
      },
      async delete() {
        throw new Error("not used");
      },
    };

    return { client, calls };
  }

  it("creates a new script for all pages", async () => {
    const { client, calls } = scopedClient([]);

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("new-uuid");
    expect(calls).toEqual([expect.objectContaining({ method: "POST", body: expect.objectContaining({ visibility: "all_pages" }) })]);
  });

  it("falls back to a storefront-only script when the Checkout Content scope is missing, instead of losing the script", async () => {
    const { client, calls } = scopedClient([], { post: (body) => body.visibility === "all_pages" });

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("new-uuid");
    expect(calls.map((call) => call.body.visibility)).toEqual(["all_pages", "storefront"]);
    expect(logError).toHaveBeenCalled();
  });

  it("does not hide a failure that isn't the missing scope", async () => {
    const client: BcRestApiClient = {
      async get() {
        return { data: { data: [] }, headers: new Headers() } as never;
      },
      async post() {
        throw new Error("500");
      },
      async put() {
        throw new Error("not used");
      },
      async delete() {
        throw new Error("not used");
      },
    };

    await expect(findOrCreateStorefrontScript(client, "abc123")).rejects.toThrow("500");
  });

  it("widens an adopted storefront script to all pages", async () => {
    const { client, calls } = scopedClient([{ uuid: "s1", consent_category: "essential", src: SRC, visibility: "storefront" }]);

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("s1");
    expect(calls).toEqual([{ method: "PUT", path: "/v3/content/scripts/s1", body: { visibility: "all_pages" } }]);
  });

  it("leaves an all-pages script alone", async () => {
    const { client, calls } = scopedClient([{ uuid: "s1", consent_category: "essential", src: SRC, visibility: "all_pages" }]);

    await findOrCreateStorefrontScript(client, "abc123");

    expect(calls).toEqual([]);
  });

  it("still applies the other fixes when only the visibility change is refused", async () => {
    const { client, calls } = scopedClient(
      [{ uuid: "s1", consent_category: "functional", src: SRC, visibility: "storefront" }],
      { put: (body) => "visibility" in body },
    );

    expect(await findOrCreateStorefrontScript(client, "abc123")).toBe("s1");
    expect(calls.map((call) => call.body)).toEqual([
      { consent_category: "essential", visibility: "all_pages" },
      { consent_category: "essential" },
    ]);
  });
});

// BC-HUN-051: an already-installed store is brought up to date on app Load, not
// only at install.
describe("ensureStorefrontScript", () => {
  it("widens the store's script using the stored token, then skips repeat calls inside the throttle window", async () => {
    const { ensureStorefrontScript } = await import("@/lib/huntry/register-storefront-script");
    const { getRestApiClient } = await import("@/lib/bc-api-client/get-rest-api-client");
    const { getCredentialsStore } = await import("@/lib/credentials-store/get-credentials-store");
    const puts: Record<string, unknown>[] = [];
    const client: BcRestApiClient = {
      async get() {
        return {
          data: {
            data: [
              {
                uuid: "s1",
                api_client_id: CLIENT_ID,
                consent_category: "essential",
                src: "https://huntry-app.example.com/api/public/huntry/throttle-store/storefront-script.js",
                visibility: "storefront",
              },
            ],
          },
          headers: new Headers(),
        } as never;
      },
      async post() {
        throw new Error("not used");
      },
      async put(_path, mutation) {
        puts.push((mutation?.body ?? {}) as Record<string, unknown>);

        return { data: {}, headers: new Headers() } as never;
      },
      async delete() {
        throw new Error("not used");
      },
    };
    const setStoreStorefrontScript = vi.fn();

    vi.mocked(getRestApiClient).mockResolvedValue(client);
    vi.mocked(getCredentialsStore).mockReturnValue({
      getStoreToken: vi.fn().mockResolvedValue("token"),
      setStoreStorefrontScript,
    } as never);

    await ensureStorefrontScript("throttle-store");
    await ensureStorefrontScript("throttle-store");

    expect(getRestApiClient).toHaveBeenCalledExactlyOnceWith("throttle-store", "token");
    expect(puts).toEqual([{ visibility: "all_pages" }]);
    expect(setStoreStorefrontScript).toHaveBeenCalledWith({ storeHash: "throttle-store", scriptId: "s1" });
  });

  it("does nothing for a store with no stored token, and never throws", async () => {
    const { ensureStorefrontScript } = await import("@/lib/huntry/register-storefront-script");
    const { getRestApiClient } = await import("@/lib/bc-api-client/get-rest-api-client");
    const { getCredentialsStore } = await import("@/lib/credentials-store/get-credentials-store");

    vi.mocked(getCredentialsStore).mockReturnValue({ getStoreToken: vi.fn().mockResolvedValue(undefined) } as never);
    await expect(ensureStorefrontScript("no-token-store")).resolves.toBeUndefined();
    expect(getRestApiClient).not.toHaveBeenCalled();

    vi.mocked(getCredentialsStore).mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(ensureStorefrontScript("broken-store")).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });
});
