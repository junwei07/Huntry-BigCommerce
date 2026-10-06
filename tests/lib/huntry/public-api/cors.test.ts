import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCorsHeaders, resetStorefrontOriginsCache, toOrigin } from "@/lib/huntry/public-api/cors";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({
  getRestApiClient: vi.fn(async () => ({ get: mocks.get })),
}));

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

const SHOP = "https://shop.example.com";

// GET /v2/store returns the store object directly (not wrapped in `data`).
function stubStoreInformation(info: { domain?: string; secure_url?: string }) {
  mocks.get.mockImplementation(async (path: string) => {
    if (path !== "/v2/store") {
      throw new Error(`unexpected BigCommerce call: ${path}`);
    }

    return { data: info };
  });
}

beforeEach(() => {
  process.env.DATA_MODE = "MULTITENANT";
  resetStorefrontOriginsCache();
  mocks.get.mockReset();
});

afterEach(() => {
  delete process.env.DATA_MODE;
  vi.useRealTimers();
});

describe("toOrigin", () => {
  it("normalizes case, default ports and paths", () => {
    expect(toOrigin("https://Shop.Example.com:443/some/path?x=1")).toBe(SHOP);
  });

  it("rejects non-http(s) values, including the literal 'null' origin", () => {
    expect(toOrigin("null")).toBeNull();
    expect(toOrigin("javascript:alert(1)")).toBeNull();
    expect(toOrigin("not a url")).toBeNull();
  });
});

describe("buildCorsHeaders", () => {
  it("reflects the store's domain and always varies on Origin", async () => {
    stubStoreInformation({ domain: "shop.example.com", secure_url: SHOP });

    expect(await buildCorsHeaders(SHOP, "abc")).toEqual({ Vary: "Origin", "Access-Control-Allow-Origin": SHOP });
  });

  it("recognizes both the domain and a different secure_url host", async () => {
    stubStoreInformation({ domain: "shop.example.com", secure_url: "https://store-abc.mybigcommerce.com" });

    expect((await buildCorsHeaders(SHOP, "abc"))["Access-Control-Allow-Origin"]).toBe(SHOP);
    expect((await buildCorsHeaders("https://store-abc.mybigcommerce.com", "abc"))["Access-Control-Allow-Origin"]).toBe(
      "https://store-abc.mybigcommerce.com",
    );
  });

  it("never sends a wildcard or credentials header", async () => {
    stubStoreInformation({ domain: "shop.example.com" });

    const headers = await buildCorsHeaders(SHOP, "abc");

    expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });

  it.each([
    ["a different host", "https://evil.example.com"],
    ["a lookalike host", "https://shop.example.com.evil.com"],
    ["a different scheme", "http://shop.example.com"],
    ["a different port", "https://shop.example.com:8443"],
    ["the literal null origin", "null"],
  ])("sends no ACAO for %s", async (_label, origin) => {
    stubStoreInformation({ domain: "shop.example.com", secure_url: SHOP });

    expect(await buildCorsHeaders(origin, "abc")).toEqual({ Vary: "Origin" });
  });

  it("recognizes nothing when the store reports no usable domain", async () => {
    stubStoreInformation({});

    expect(await buildCorsHeaders(SHOP, "abc")).toEqual({ Vary: "Origin" });
  });

  it("skips the BigCommerce lookup when there is no Origin header", async () => {
    expect(await buildCorsHeaders(null, "abc")).toEqual({ Vary: "Origin" });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("memoizes a successful lookup", async () => {
    stubStoreInformation({ domain: "shop.example.com" });

    await buildCorsHeaders(SHOP, "abc");
    await buildCorsHeaders(SHOP, "abc");

    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent lookups for the same store", async () => {
    stubStoreInformation({ domain: "shop.example.com" });

    await Promise.all([buildCorsHeaders(SHOP, "abc"), buildCorsHeaders(SHOP, "abc"), buildCorsHeaders(SHOP, "abc")]);

    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it("looks up each store separately", async () => {
    stubStoreInformation({ domain: "shop.example.com" });

    await buildCorsHeaders(SHOP, "abc");
    await buildCorsHeaders(SHOP, "def");

    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the lookup throws, and retries after the short failure TTL", async () => {
    vi.useFakeTimers();
    mocks.get.mockRejectedValue(new Error("BigCommerce down"));

    expect(await buildCorsHeaders(SHOP, "abc")).toEqual({ Vary: "Origin" });

    // Within the failure TTL: no hammering.
    mocks.get.mockClear();
    await buildCorsHeaders(SHOP, "abc");
    expect(mocks.get).not.toHaveBeenCalled();

    // After it: recovers, long before the 10-minute success TTL would have.
    vi.advanceTimersByTime(31_000);
    stubStoreInformation({ domain: "shop.example.com" });

    expect((await buildCorsHeaders(SHOP, "abc"))["Access-Control-Allow-Origin"]).toBe(SHOP);
  });

  it("keeps serving the last known origins when a refresh fails", async () => {
    vi.useFakeTimers();
    stubStoreInformation({ domain: "shop.example.com" });
    await buildCorsHeaders(SHOP, "abc");

    vi.advanceTimersByTime(11 * 60 * 1000);
    mocks.get.mockRejectedValue(new Error("BigCommerce down"));

    expect((await buildCorsHeaders(SHOP, "abc"))["Access-Control-Allow-Origin"]).toBe(SHOP);
  });
});
