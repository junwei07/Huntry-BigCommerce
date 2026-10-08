import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

// `after` only works inside a real Next request scope. Run the callback
// straight away so the test can observe what the route schedules.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((callback: () => unknown) => {
    void callback();
  }),
}));

const loadStoreMock = vi.fn();

vi.mock("@/lib/bc-auth/load-store", () => ({ loadStore: (...args: unknown[]) => loadStoreMock(...args) }));

const provisionMock = vi.fn(async (_storeHash: string) => {});
const removeMock = vi.fn(async (_storeHash: string) => {});

vi.mock("@/lib/huntry/register-storefront-page", () => ({
  provisionStorefrontPage: (storeHash: string) => provisionMock(storeHash),
  removeStorefrontPage: (storeHash: string) => removeMock(storeHash),
}));

const order: string[] = [];
const deleteStoreMock = vi.fn(async () => {
  order.push("deleteStore");
});

vi.mock("@/lib/credentials-store/get-credentials-store", () => ({
  getCredentialsStore: () => ({ deleteStore: deleteStoreMock }),
}));

vi.mock("@/lib/bc-auth/verify-signed-payload", () => ({
  verifySignedPayload: vi.fn(async () => ({ sub: "stores/abc123" })),
  parseStoreHash: (sub: string) => sub.replace("stores/", ""),
}));

beforeEach(() => {
  process.env.APP_ORIGIN = "https://huntry-app.example.com";
  order.length = 0;
  vi.clearAllMocks();
  removeMock.mockImplementation(async () => {
    order.push("removeStorefrontPage");
  });
});

describe("GET /api/app/load", () => {
  it("redirects into the app and provisions the Huntry page after the response", async () => {
    loadStoreMock.mockResolvedValue({ storeHash: "abc123", url: "/" });

    const { GET } = await import("@/app/api/app/load/route");
    const { NextRequest } = await import("next/server");
    const response = await GET(new NextRequest("https://huntry-app.example.com/api/app/load?signed_payload_jwt=jwt"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/store/abc123");
    expect(provisionMock).toHaveBeenCalledWith("abc123");
  });

  it("does not provision when the load itself fails", async () => {
    loadStoreMock.mockRejectedValue(new Error("db down"));

    const { GET } = await import("@/app/api/app/load/route");
    const { NextRequest } = await import("next/server");
    const response = await GET(new NextRequest("https://huntry-app.example.com/api/app/load?signed_payload_jwt=jwt"));

    expect(response.status).toBe(307);
    expect(provisionMock).not.toHaveBeenCalled();
  });
});

describe("uninstallStore", () => {
  it("removes the Huntry page before the store row (and token) is deleted", async () => {
    const { uninstallStore } = await import("@/lib/bc-auth/uninstall-store");

    await uninstallStore("jwt");

    expect(removeMock).toHaveBeenCalledWith("abc123");
    expect(order).toEqual(["removeStorefrontPage", "deleteStore"]);
  });
});
