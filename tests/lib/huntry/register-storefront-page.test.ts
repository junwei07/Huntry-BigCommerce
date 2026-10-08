import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BcRestApiClient } from "@/lib/bc-api-client/rest-client/types";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

let dataMode = "MULTITENANT";

vi.mock("@/lib/bc-api-client/resolve-store-credentials", () => ({ getDataMode: () => dataMode }));

const getRestApiClientMock = vi.fn();

vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({
  getRestApiClient: (...args: unknown[]) => getRestApiClientMock(...args),
}));

const records = new Map<string, { storeHash: string; pageId: number; createdByApp: boolean }>();
const credentialsStore = {
  getStoreStorefrontPage: vi.fn(async (storeHash: string) => records.get(storeHash)),
  setStoreStorefrontPage: vi.fn(async (record: { storeHash: string; pageId: number; createdByApp: boolean }) => {
    records.set(record.storeHash, record);
  }),
};

vi.mock("@/lib/credentials-store/get-credentials-store", () => ({ getCredentialsStore: () => credentialsStore }));

const { logError } = await import("@/lib/errors/logger");
const { STOREFRONT_PAGE_BODY, findOrCreateStorefrontPage, provisionStorefrontPage, removeStorefrontPage } =
  await import("@/lib/huntry/register-storefront-page");

interface FakePage {
  id: number;
  url: string;
  body?: string;
}

// A tiny in-memory Pages API: lists with real pagination metadata, returns the
// body only for the single-page read, and rejects a duplicate URL like
// BigCommerce does.
function fakeClient(initialPages: FakePage[], options: { pageSize?: number; failPostWith?: Error; raceOnPost?: FakePage } = {}) {
  const pages = [...initialPages];
  const pageSize = options.pageSize ?? 250;
  const calls: { method: string; path: string; params?: unknown; body?: unknown }[] = [];

  const client: BcRestApiClient = {
    async get(path: string, requestOptions) {
      calls.push({ method: "GET", path, params: requestOptions?.params });

      if (path === "/v3/content/pages") {
        const page = Number(requestOptions?.params?.page ?? 1);
        const limit = Number(requestOptions?.params?.limit ?? pageSize);
        const effective = Math.min(limit, pageSize);
        const slice = pages.slice((page - 1) * effective, page * effective).map(({ id, url }) => ({ id, url }));

        return {
          data: { data: slice, meta: { pagination: { total_pages: Math.max(1, Math.ceil(pages.length / effective)) } } },
          headers: new Headers(),
        } as never;
      }

      const id = Number(path.split("/").pop());

      return { data: { data: pages.find((p) => p.id === id) }, headers: new Headers() } as never;
    },
    async post(path: string, mutation) {
      calls.push({ method: "POST", path, body: mutation?.body });

      if (options.raceOnPost) {
        pages.push(options.raceOnPost);
        throw new Error("422 duplicate url");
      }

      if (options.failPostWith) {
        throw options.failPostWith;
      }

      const body = mutation?.body as { url: string; body: string };
      const created = { id: 900, url: body.url, body: body.body };

      pages.push(created);

      return { data: { data: created }, headers: new Headers() } as never;
    },
    async put() {
      throw new Error("not used");
    },
    async delete(path: string) {
      calls.push({ method: "DELETE", path });

      return { data: {}, headers: new Headers() } as never;
    },
  };

  return { client, calls, pages };
}

beforeEach(() => {
  dataMode = "MULTITENANT";
  records.clear();
  vi.clearAllMocks();
});

describe("findOrCreateStorefrontPage", () => {
  it("creates the page with the managed container when none exists", async () => {
    const { client, calls } = fakeClient([{ id: 1, url: "/contact-us/" }]);

    expect(await findOrCreateStorefrontPage(client)).toEqual({ pageId: 900, createdByApp: true });

    const post = calls.find((call) => call.method === "POST");

    expect(post?.path).toBe("/v3/content/pages");
    expect(post?.body).toMatchObject({ type: "page", name: "Huntry", url: "/huntry/", is_visible: true });
    expect((post?.body as { body: string }).body).toBe(STOREFRONT_PAGE_BODY);
    expect(STOREFRONT_PAGE_BODY).toContain("data-huntry-map");
    expect(STOREFRONT_PAGE_BODY).toContain("data-huntry-managed");
  });

  it("adopts an existing managed page without writing anything", async () => {
    const { client, calls } = fakeClient([{ id: 7, url: "/huntry/", body: STOREFRONT_PAGE_BODY }]);

    expect(await findOrCreateStorefrontPage(client)).toEqual({ pageId: 7, createdByApp: true });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("leaves a merchant-owned /huntry/ page alone and says it isn't ours", async () => {
    const { client, calls } = fakeClient([{ id: 7, url: "/huntry/", body: "<p>my own page</p>" }]);

    expect(await findOrCreateStorefrontPage(client)).toEqual({ pageId: 7, createdByApp: false });
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(logError).toHaveBeenCalled();
  });

  it("finds the page on a later list page instead of creating a duplicate", async () => {
    const filler = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, url: `/p${index}/` }));
    const { client, calls } = fakeClient([...filler, { id: 77, url: "/huntry/", body: STOREFRONT_PAGE_BODY }], {
      pageSize: 2,
    });

    expect(await findOrCreateStorefrontPage(client)).toEqual({ pageId: 77, createdByApp: true });
    expect(calls.filter((call) => call.path === "/v3/content/pages").length).toBeGreaterThan(1);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("adopts the page a concurrent call created when its own create is rejected", async () => {
    const { client } = fakeClient([], { raceOnPost: { id: 55, url: "/huntry/", body: STOREFRONT_PAGE_BODY } });

    expect(await findOrCreateStorefrontPage(client)).toEqual({ pageId: 55, createdByApp: true });
  });

  it("rethrows when the create fails and no page appeared", async () => {
    const { client } = fakeClient([], { failPostWith: new Error("403 forbidden") });

    await expect(findOrCreateStorefrontPage(client)).rejects.toThrow("403 forbidden");
  });
});

describe("provisionStorefrontPage", () => {
  it("creates once, records it, and then makes no API call at all", async () => {
    const { client } = fakeClient([]);

    getRestApiClientMock.mockResolvedValue(client);

    await provisionStorefrontPage("abc123", "install-token");

    expect(getRestApiClientMock).toHaveBeenCalledWith("abc123", "install-token");
    expect(records.get("abc123")).toEqual({ storeHash: "abc123", pageId: 900, createdByApp: true });

    getRestApiClientMock.mockClear();
    await provisionStorefrontPage("abc123");

    expect(getRestApiClientMock).not.toHaveBeenCalled();
  });

  it("does not recreate a page the merchant deleted once a record exists", async () => {
    records.set("abc123", { storeHash: "abc123", pageId: 900, createdByApp: true });

    await provisionStorefrontPage("abc123");

    expect(getRestApiClientMock).not.toHaveBeenCalled();
  });

  it("records a merchant-owned page as not created by the app", async () => {
    getRestApiClientMock.mockResolvedValue(fakeClient([{ id: 7, url: "/huntry/", body: "<p>mine</p>" }]).client);

    await provisionStorefrontPage("abc123");

    expect(records.get("abc123")).toEqual({ storeHash: "abc123", pageId: 7, createdByApp: false });
  });

  it("never throws and writes no record when the API fails, so the next load retries", async () => {
    getRestApiClientMock.mockResolvedValue(fakeClient([], { failPostWith: new Error("boom") }).client);

    await expect(provisionStorefrontPage("abc123")).resolves.toBeUndefined();

    expect(records.size).toBe(0);
    expect(logError).toHaveBeenCalled();
  });

  it("does nothing outside MULTITENANT mode", async () => {
    dataMode = "MOCK";

    await provisionStorefrontPage("abc123");

    expect(credentialsStore.getStoreStorefrontPage).not.toHaveBeenCalled();
    expect(getRestApiClientMock).not.toHaveBeenCalled();
  });
});

describe("removeStorefrontPage", () => {
  it("deletes the recorded page when the app created it", async () => {
    const { client, calls } = fakeClient([]);

    records.set("abc123", { storeHash: "abc123", pageId: 900, createdByApp: true });
    getRestApiClientMock.mockResolvedValue(client);

    await removeStorefrontPage("abc123");

    expect(calls).toContainEqual({ method: "DELETE", path: "/v3/content/pages/900" });
  });

  it("never deletes a page the app did not create, or when there is no record", async () => {
    const { client, calls } = fakeClient([]);

    getRestApiClientMock.mockResolvedValue(client);
    records.set("abc123", { storeHash: "abc123", pageId: 7, createdByApp: false });

    await removeStorefrontPage("abc123");
    await removeStorefrontPage("other");

    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("swallows a failed delete (revoked token) instead of failing the uninstall", async () => {
    records.set("abc123", { storeHash: "abc123", pageId: 900, createdByApp: true });
    getRestApiClientMock.mockRejectedValue(new Error("401 token revoked"));

    await expect(removeStorefrontPage("abc123")).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });
});
