import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "@/app/api/public/huntry/[storeHash]/validate-coupon/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn() }));

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer", () => ({
  isAuthorizedForStorefrontCustomer: mocks.auth,
}));
vi.mock("@/lib/huntry/claims/redemption", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/huntry/claims/redemption")>()),
  findClaimsByCouponCodes: mocks.find,
}));

const claim = (id: number, bcCustomerId: number, couponCode: string) => ({
  id,
  eventId: 1,
  bcCustomerId,
  couponCode,
  redemptionStatus: "unredeemed",
});

function post(body: unknown, storeHash = "abc123") {
  return POST(
    new Request(`https://app.example.com/api/public/huntry/${storeHash}/validate-coupon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ storeHash }) },
  );
}

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
  delete process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS;
  mocks.auth.mockReset().mockResolvedValue({ ok: true, customerId: 42 });
  mocks.find.mockReset().mockResolvedValue([claim(1, 41, "HUNT-AAAA1111"), claim(2, 42, "HUNT-BBBB2222")]);
});

afterEach(() => {
  delete process.env.DATA_MODE;
  delete process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS;
});

describe("POST validate-coupon", () => {
  it("returns the codes claimed by someone else, using the JWT's customer, never cached", async () => {
    const response = await post({ jwt: "token", codes: ["HUNT-AAAA1111", "HUNT-BBBB2222", "SUMMER10"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ foreign: ["HUNT-AAAA1111"] });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.auth).toHaveBeenCalledWith("token", "abc123");
    expect(mocks.find).toHaveBeenCalledWith("abc123", ["HUNT-AAAA1111", "HUNT-BBBB2222", "SUMMER10"]);
  });

  it("treats a request with no JWT as a guest and flags a claim code, whatever the webhook's guest setting", async () => {
    const response = await post({ codes: ["HUNT-AAAA1111", "SUMMER10"] });

    expect(await response.json()).toEqual({ foreign: ["HUNT-AAAA1111"] });
    expect(mocks.auth).not.toHaveBeenCalled();

    process.env.HUNTRY_REMOVE_GUEST_CART_COUPONS = "false";

    expect(await (await post({ codes: ["HUNT-AAAA1111"] })).json()).toEqual({ foreign: ["HUNT-AAAA1111"] });
  });

  it("does not flag a guest's non-claim code", async () => {
    expect(await (await post({ codes: ["SUMMER10"] })).json()).toEqual({ foreign: [] });
  });

  it("returns 401 for a bad token — never silently treated as a guest — and looks nothing up", async () => {
    mocks.auth.mockResolvedValue({ ok: false });

    expect((await post({ jwt: "token", codes: ["HUNT-AAAA1111"] })).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("rejects an invalid body, an empty list and an oversized list with 400", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ codes: [] })).status).toBe(400);
    expect((await post({ codes: Array.from({ length: 21 }, (_, i) => `C${i}`) })).status).toBe(400);
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed store hash", async () => {
    expect((await post({ codes: ["A"] }, "BAD HASH")).status).toBe(404);
  });

  it("answers 500 when the lookup fails", async () => {
    mocks.find.mockRejectedValue(new Error("db down"));

    expect((await post({ jwt: "token", codes: ["A"] })).status).toBe(500);
  });
});

describe("OPTIONS validate-coupon", () => {
  it("answers the preflight with 204", async () => {
    const response = await OPTIONS(
      new Request("https://app.example.com/api/public/huntry/abc123/validate-coupon", {
        method: "OPTIONS",
        headers: { Origin: "https://shop.example.com" },
      }),
      { params: Promise.resolve({ storeHash: "abc123" }) },
    );

    expect(response.status).toBe(204);
  });
});
