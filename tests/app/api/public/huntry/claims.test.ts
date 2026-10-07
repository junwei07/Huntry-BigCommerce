import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "@/app/api/public/huntry/[storeHash]/claims/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), claim: vi.fn(), limit: vi.fn() }));

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer", () => ({
  isAuthorizedForStorefrontCustomer: mocks.auth,
}));
vi.mock("@/lib/huntry/claims/player-claim", () => ({ createPlayerClaim: mocks.claim }));
vi.mock("@/lib/huntry/claims/claim-rate-limit", () => ({ checkClaimRateLimit: mocks.limit }));

const EGG_ID = "00000000-0000-4000-8000-00000000000a";
const VALID = { jwt: "token", eggId: EGG_ID, lat: 1.3, lng: 103.8 };

function post(body: unknown, headers: Record<string, string> = {}, storeHash = "abc123") {
  return POST(
    new Request(`https://app.example.com/api/public/huntry/${storeHash}/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ storeHash }) },
  );
}

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
  mocks.auth.mockReset().mockResolvedValue({ ok: true, customerId: 42 });
  mocks.claim.mockReset();
  mocks.limit.mockReset().mockResolvedValue({ limited: false });
});

afterEach(() => {
  delete process.env.DATA_MODE;
});

describe("POST claims", () => {
  it("returns the coupon code on success, never cached", async () => {
    mocks.claim.mockResolvedValue({ status: "created", claim: { couponCode: "COFFEE" } });

    const response = await post(VALID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ couponCode: "COFFEE" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // The customer id comes from the JWT, never from the body.
    expect(mocks.claim).toHaveBeenCalledWith({ eggId: EGG_ID, bcCustomerId: 42, lat: 1.3, lng: 103.8 }, "abc123");
  });

  it("rejects an invalid body with 400 before checking the JWT", async () => {
    expect((await post({ ...VALID, eggId: "nope" })).status).toBe(400);
    expect((await post({ ...VALID, lat: 120 })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("returns 401 for a bad or wrong-store token and never claims", async () => {
    mocks.auth.mockResolvedValue({ ok: false });

    expect((await post(VALID)).status).toBe(401);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed store hash", async () => {
    expect((await post(VALID, {}, "BAD HASH")).status).toBe(404);
  });

  it.each([
    ["egg_not_found", 404],
    ["too_far", 403],
    ["capacity_full", 409],
    ["limit_reached", 409],
    ["event_not_live", 409],
    ["reward_unavailable", 409],
    ["cooldown", 429],
    ["too_fast", 429],
    ["code_issue_failed", 502],
    ["lock_timeout", 503],
  ])("maps %s to %i", async (status, expected) => {
    mocks.claim.mockResolvedValue({ status });

    expect((await post(VALID)).status).toBe(expected);
  });

  it("returns 429 rate_limited with Retry-After and never claims", async () => {
    mocks.limit.mockResolvedValue({ limited: true, retryAfterSeconds: 120 });

    const response = await post(VALID);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(await response.json()).toEqual({ error: "rate_limited", retryAfterSeconds: 120 });
    expect(mocks.claim).not.toHaveBeenCalled();
    // The customer id comes from the JWT, never from the body.
    expect(mocks.limit).toHaveBeenCalledWith("abc123", 42, EGG_ID);
  });

  it("does not rate-limit an unauthenticated request", async () => {
    mocks.auth.mockResolvedValue({ ok: false });

    await post(VALID);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it("returns the existing code with a 409 duplicate", async () => {
    mocks.claim.mockResolvedValue({ status: "duplicate", couponCode: "COFFEE" });

    const response = await post(VALID);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "duplicate", couponCode: "COFFEE" });
  });

  it("returns 500 when the claim throws", async () => {
    mocks.claim.mockRejectedValue(new Error("boom"));

    expect((await post(VALID)).status).toBe(500);
  });
});

describe("OPTIONS claims (preflight)", () => {
  function preflight(origin: string) {
    return OPTIONS(
      new Request("https://app.example.com/api/public/huntry/abc123/claims", {
        method: "OPTIONS",
        headers: { Origin: origin },
      }),
      { params: Promise.resolve({ storeHash: "abc123" }) },
    );
  }

  it("allows POST and Content-Type only for a recognized origin", async () => {
    const allowed = await preflight("http://localhost:3000");
    const denied = await preflight("https://evil.example.com");

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
    expect(allowed.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(denied.headers.get("Access-Control-Allow-Methods")).toBeNull();
    expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});
