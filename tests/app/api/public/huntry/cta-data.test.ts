import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/public/huntry/[storeHash]/cta-data/route";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));

const APP_ORIGIN = "https://huntry-app.example.com";

function call(headers: Record<string, string> = {}, storeHash = "abc123") {
  return GET(new Request(`${APP_ORIGIN}/api/public/huntry/${storeHash}/cta-data`, { headers }), {
    params: Promise.resolve({ storeHash }),
  });
}

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
  process.env.APP_ORIGIN = APP_ORIGIN;
});

afterEach(() => {
  delete process.env.DATA_MODE;
  delete process.env.APP_ORIGIN;
});

describe("GET cta-data (MOCK mode)", () => {
  it("returns only live events, without eggs", async () => {
    const body = await (await call()).json();

    // MOCK_EVENTS id 3 is the one live event (see mock-events.ts).
    expect(body.events).toHaveLength(1);
    expect(Object.keys(body.events[0]).sort()).toEqual(
      ["endsAt", "headerBannerUrl", "name", "primaryColor", "slug", "startsAt"].sort(),
    );
  });

  it("covers the whole store and lists the specific products of live-event rewards", async () => {
    const body = await (await call()).json();

    // The live event has an egg for reward 3 (scope "all") and reward 2
    // (specific products 101 and 102).
    expect(body.allProducts).toBe(true);
    expect(body.productIds.sort()).toEqual([101, 102]);
  });

  it("serves default images from this app's origin and blank custom text", async () => {
    const body = await (await call()).json();

    expect(body.banner).toEqual({
      description: "",
      logoUrl: `${APP_ORIGIN}/huntry-logo.png`,
      imageUrl: `${APP_ORIGIN}/huntry/cookies-banner.png`,
    });
    expect(body.productCta).toEqual({ title: "", description: "" });
  });

  it("returns saved custom text", async () => {
    const { saveStorefrontSettings } = await import("@/lib/huntry/featured/featured-api");

    await saveStorefrontSettings(
      { bannerDescription: "Hunt with us", productCtaTitle: "Rewards", productCtaDescription: "Find the egg" },
      "abc123",
    );

    try {
      const body = await (await call()).json();

      expect(body.banner.description).toBe("Hunt with us");
      expect(body.productCta).toEqual({ title: "Rewards", description: "Find the egg" });
    } finally {
      await saveStorefrontSettings({ bannerDescription: "", productCtaTitle: "", productCtaDescription: "" }, "abc123");
    }
  });

  it("never leaks internal fields", async () => {
    const text = JSON.stringify(await (await call()).json());

    for (const forbidden of ["storeHash", "couponCode", "coupon_code", "bc_", "bcCustomerGroupId", "discountValue", "eggs"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("sends a short shared-cache lifetime and Vary: Origin", async () => {
    const response = await call();

    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("404s a malformed store hash without touching CORS resolution", async () => {
    const response = await call({ Origin: "http://localhost:3000" }, "BAD/hash");

    expect(response.status).toBe(404);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
