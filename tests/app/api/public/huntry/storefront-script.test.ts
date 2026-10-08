import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/public/huntry/[storeHash]/storefront-script.js/route";

const call = (storeHash = "abc123") =>
  GET(new Request(`https://huntry-app.example.com/api/public/huntry/${storeHash}/storefront-script.js`), {
    params: Promise.resolve({ storeHash }),
  });

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
  process.env.APP_ORIGIN = "https://huntry-app.example.com";
  process.env.BIGCOMMERCE_CLIENT_ID = "client-1";
});

afterEach(() => {
  delete process.env.DATA_MODE;
  delete process.env.APP_ORIGIN;
  delete process.env.BIGCOMMERCE_CLIENT_ID;
});

describe("GET storefront-script.js (MOCK mode)", () => {
  it("serves JavaScript with the config prelude ahead of the bundle", async () => {
    const response = await call();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=300");
    expect(text.startsWith("window.__HUNTRY_STOREFRONT__=")).toBe(true);
    expect(text).toContain('"appOrigin":"https://huntry-app.example.com"');
    expect(text).toContain('"storeHash":"abc123"');
    expect(text).toContain('"clientId":"client-1"');
    expect(text.length).toBeGreaterThan(500);
  });

  it("emits a null config (bundle no-ops) when the client id is unset", async () => {
    delete process.env.BIGCOMMERCE_CLIENT_ID;

    const text = await (await call()).text();

    expect(text.startsWith("window.__HUNTRY_STOREFRONT__=null;")).toBe(true);
  });

  it("404s a malformed store hash", async () => {
    const response = await call("BAD/hash");

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
