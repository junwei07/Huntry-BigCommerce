import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getLoader } from "@/app/api/public/huntry/[storeHash]/storefront-script.js/route";
import { GET as getMap } from "@/app/api/public/huntry/[storeHash]/storefront-map.js/route";
import { STOREFRONT_BUNDLE, STOREFRONT_MAP_BUNDLE } from "@/lib/huntry/storefront-script/bundle.generated";
import { WORKER_SOURCE } from "@/lib/huntry/storefront-script/map/map-assets.generated";

const call = (handler: typeof getMap, storeHash = "abc123") =>
  handler(new Request(`https://huntry-app.example.com/api/public/huntry/${storeHash}/storefront-map.js`), {
    params: Promise.resolve({ storeHash }),
  });

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
});

afterEach(() => {
  delete process.env.DATA_MODE;
});

describe("GET storefront-map.js (MOCK mode)", () => {
  it("serves the map bundle as JavaScript", async () => {
    const response = await call(getMap);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=300");
    expect(text).toBe(STOREFRONT_MAP_BUNDLE);
    expect(text.length).toBeGreaterThan(100_000);
  });

  it("404s a malformed store hash", async () => {
    const response = await call(getMap, "BAD/hash");

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("generated storefront bundles", () => {
  it("embeds the maplibre worker and keeps the loader small", () => {
    expect(WORKER_SOURCE.length).toBeGreaterThan(10_000);
    expect(STOREFRONT_MAP_BUNDLE).toContain("maplibregl");
    expect(STOREFRONT_BUNDLE.length).toBeLessThan(60 * 1024);
    // The loader must not drag maplibre into every storefront page.
    expect(STOREFRONT_BUNDLE).not.toContain("maplibregl");
  });

  it("has the loader inject the map script from the new route, once", async () => {
    expect(STOREFRONT_BUNDLE).toContain("/storefront-map.js");
    expect(STOREFRONT_BUNDLE).toContain("data-huntry-map-script");
    expect((await (await call(getLoader)).text()).startsWith("window.__HUNTRY_STOREFRONT__=")).toBe(true);
  });
});
