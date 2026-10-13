import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({ getRestApiClient: vi.fn() }));
vi.mock("@/lib/credentials-store/get-credentials-store", () => ({ getCredentialsStore: vi.fn() }));
vi.mock("@/lib/huntry/claims/cart-coupon-enforcement", () => ({ enforceCartCoupons: vi.fn() }));

const { logError } = await import("@/lib/errors/logger");
const { getRestApiClient } = await import("@/lib/bc-api-client/get-rest-api-client");
const { getCredentialsStore } = await import("@/lib/credentials-store/get-credentials-store");
const { enforceCartCoupons } = await import("@/lib/huntry/claims/cart-coupon-enforcement");
const { POST } = await import("@/app/api/webhooks/huntry/cart/route");

function webhookRequest(body: unknown): NextRequest {
  return new NextRequest("https://huntry-app.example.com/api/webhooks/huntry/cart", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// couponApplied carries an extra couponId in `data`.
const payload = {
  scope: "store/cart/couponApplied",
  producer: "stores/abc123",
  data: { type: "cart", id: "0c2e6f7a-1111-4222-8333-444455556666", couponId: 7 },
};

const client = { get: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRestApiClient).mockResolvedValue(client as never);
  vi.mocked(enforceCartCoupons).mockResolvedValue({ removed: [] });
  vi.mocked(getCredentialsStore).mockReturnValue({ getStoreToken: vi.fn().mockResolvedValue("token") } as never);
});

describe("POST /api/webhooks/huntry/cart", () => {
  it("passes only the cart id to the enforcer, using the stored token", async () => {
    const response = await POST(webhookRequest(payload));

    expect(response.status).toBe(200);
    expect(getRestApiClient).toHaveBeenCalledWith("abc123", "token");
    expect(enforceCartCoupons).toHaveBeenCalledWith("abc123", payload.data.id, client);
  });

  it("acknowledges but ignores a malformed body or a numeric cart id", async () => {
    expect((await POST(webhookRequest({ nope: true }))).status).toBe(200);
    expect((await POST(webhookRequest({ ...payload, data: { type: "cart", id: 5 } }))).status).toBe(200);
    expect(enforceCartCoupons).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it("acknowledges but ignores any scope other than store/cart/couponApplied", async () => {
    const response = await POST(webhookRequest({ ...payload, scope: "store/cart/updated" }));

    expect(response.status).toBe(200);
    expect(enforceCartCoupons).not.toHaveBeenCalled();
  });

  it("acknowledges and logs when the store has no stored token", async () => {
    vi.mocked(getCredentialsStore).mockReturnValue({ getStoreToken: vi.fn().mockResolvedValue(null) } as never);

    const response = await POST(webhookRequest(payload));

    expect(response.status).toBe(200);
    expect(enforceCartCoupons).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalled();
  });

  it("acknowledges and logs when the enforcer throws", async () => {
    vi.mocked(enforceCartCoupons).mockRejectedValue(new Error("boom"));

    const response = await POST(webhookRequest(payload));

    expect(response.status).toBe(200);
    expect(logError).toHaveBeenCalled();
  });
});
