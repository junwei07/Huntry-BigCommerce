import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPTIONS, POST } from "@/app/api/public/huntry/[storeHash]/rewards/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), reward: vi.fn(), links: vi.fn() }));

vi.mock("@/lib/errors/logger", () => ({ logError: vi.fn() }));
vi.mock("@/lib/huntry/storefront-auth/is-authorized-for-storefront-customer", () => ({
  isAuthorizedForStorefrontCustomer: mocks.auth,
}));
vi.mock("@/lib/huntry/claims/claims-api", () => ({ listClaimsForCustomer: mocks.list }));
vi.mock("@/lib/huntry/rewards/rewards-api", () => ({
  fetchRewardUncached: mocks.reward,
  fetchBcProductLinks: mocks.links,
}));

const LIVE_REWARD = {
  status: "active",
  rewardStartsAt: null,
  rewardExpiresAt: null,
  discountType: "percent",
  discountValue: 10,
  discountScope: "all",
  productIds: [] as number[],
};

const claim = (overrides: Record<string, unknown> = {}) => ({
  rewardId: 5,
  rewardNameSnapshot: "Free coffee",
  couponCode: "COFFEE",
  claimedAt: new Date("2026-10-01T10:00:00.000Z"),
  eventId: 7,
  bcCustomerId: 42,
  ...overrides,
});

function post(body: unknown, storeHash = "abc123") {
  return POST(
    new Request(`https://app.example.com/api/public/huntry/${storeHash}/rewards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ storeHash }) },
  );
}

beforeEach(() => {
  process.env.DATA_MODE = "MOCK";
  mocks.auth.mockReset().mockResolvedValue({ ok: true, customerId: 42 });
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.reward.mockReset().mockResolvedValue(LIVE_REWARD);
  mocks.links.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.DATA_MODE;
});

describe("POST rewards", () => {
  it("lists the JWT customer's claims, never cached", async () => {
    mocks.list.mockResolvedValue([claim()]);

    const response = await post({ jwt: "token" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      claims: [
        {
          rewardName: "Free coffee",
          couponCode: "COFFEE",
          claimedAt: "2026-10-01T10:00:00.000Z",
          eventId: 7,
          expired: false,
          headline: "Get 10% OFF",
          products: [],
        },
      ],
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    // The customer id comes from the JWT, never from the body.
    expect(mocks.list).toHaveBeenCalledWith("abc123", 42);
  });

  it("rejects an invalid body with 400 before checking the JWT", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("returns 401 for a bad token and never lists", async () => {
    mocks.auth.mockResolvedValue({ ok: false });

    expect((await post({ jwt: "token" })).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed store hash", async () => {
    expect((await post({ jwt: "token" }, "BAD HASH")).status).toBe(404);
  });

  it("answers 500 when the lookup fails", async () => {
    mocks.list.mockRejectedValue(new Error("db down"));

    expect((await post({ jwt: "token" })).status).toBe(500);
  });
});

describe("POST rewards: live reward state", () => {
  const firstClaim = async () => ((await (await post({ jwt: "token" })).json()) as { claims: Record<string, unknown>[] }).claims[0];

  it("marks a claim expired when its reward was deleted", async () => {
    mocks.list.mockResolvedValue([claim()]);
    mocks.reward.mockResolvedValue(undefined);

    expect(await firstClaim()).toMatchObject({ expired: true, headline: null, products: [] });
  });

  it("marks a claim expired for an archived reward or one past its expiry", async () => {
    mocks.list.mockResolvedValue([claim()]);
    mocks.reward.mockResolvedValue({ ...LIVE_REWARD, status: "archived" });
    expect(await firstClaim()).toMatchObject({ expired: true });

    mocks.reward.mockResolvedValue({ ...LIVE_REWARD, rewardExpiresAt: new Date("2000-01-01T00:00:00.000Z") });
    expect(await firstClaim()).toMatchObject({ expired: true });
  });

  it("adds product links only for a specific-scope, open reward", async () => {
    mocks.list.mockResolvedValue([claim()]);
    mocks.reward.mockResolvedValue({ ...LIVE_REWARD, discountScope: "specific", productIds: [3, 4] });
    mocks.links.mockResolvedValue([{ name: "Beans", url: "/beans/" }]);

    expect(await firstClaim()).toMatchObject({ expired: false, products: [{ name: "Beans", url: "/beans/" }] });
    expect(mocks.links).toHaveBeenCalledWith("abc123", [3, 4]);

    mocks.links.mockClear();
    mocks.reward.mockResolvedValue({ ...LIVE_REWARD, discountScope: "all" });
    expect(await firstClaim()).toMatchObject({ products: [] });
    expect(mocks.links).not.toHaveBeenCalled();
  });

  it("formats a fixed-amount headline", async () => {
    mocks.list.mockResolvedValue([claim()]);
    mocks.reward.mockResolvedValue({ ...LIVE_REWARD, discountType: "fixed_cart", discountValue: 5 });

    expect(await firstClaim()).toMatchObject({ headline: "Get $5 OFF" });
  });

  it("does not mark a claim expired, or fail the list, when the reward lookup throws", async () => {
    mocks.list.mockResolvedValue([claim()]);
    mocks.reward.mockRejectedValue(new Error("db down"));

    expect(await firstClaim()).toMatchObject({ expired: false, headline: null, products: [] });
  });

  it("looks each reward up once however many claims share it", async () => {
    mocks.list.mockResolvedValue([claim(), claim({ couponCode: "B" })]);

    await post({ jwt: "token" });

    expect(mocks.reward).toHaveBeenCalledTimes(1);
  });
});

describe("OPTIONS rewards", () => {
  it("answers the preflight with 204", async () => {
    const response = await OPTIONS(
      new Request("https://app.example.com/api/public/huntry/abc123/rewards", {
        method: "OPTIONS",
        headers: { Origin: "https://shop.example.com" },
      }),
      { params: Promise.resolve({ storeHash: "abc123" }) },
    );

    expect(response.status).toBe(204);
  });
});
