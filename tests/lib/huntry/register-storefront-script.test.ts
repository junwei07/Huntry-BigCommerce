import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";

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
