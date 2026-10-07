import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import { generateClaimCode, issueClaimCode, sanitizeCodePrefix } from "@/lib/huntry/rewards/claim-codes";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock("@/lib/bc-api-client/get-rest-api-client", () => ({
  getRestApiClient: vi.fn(async () => ({ post: mocks.post })),
}));

// What BigCommerce accepts for a coupon code (confirmed live,
// docs/MIGRATION.md §8): 1-50 chars of [a-zA-Z0-9_ -].
const BC_CODE = /^[a-zA-Z0-9_ -]{1,50}$/;

describe("generateClaimCode", () => {
  it("is prefix-SUFFIX with an unambiguous 8-char suffix", () => {
    expect(generateClaimCode("COOKIE")).toMatch(/^COOKIE-[A-HJKMNP-Z2-9]{8}$/);
  });

  it("never exceeds 50 chars, truncating a long prefix", () => {
    const code = generateClaimCode("X".repeat(200));

    expect(code.length).toBe(50);
    expect(code).toMatch(BC_CODE);
  });

  it("drops characters BigCommerce rejects and falls back when nothing is left", () => {
    expect(sanitizeCodePrefix("sum mer!%2026")).toBe("summer2026");
    expect(generateClaimCode("!!!")).toMatch(/^HUNTRY-/);
    expect(generateClaimCode(null)).toMatch(BC_CODE);
  });

  it("produces distinct codes", () => {
    expect(new Set(Array.from({ length: 200 }, () => generateClaimCode("A"))).size).toBe(200);
  });
});

describe("issueClaimCode", () => {
  const reward = { id: 1, bcPromotionId: "promo-9", couponCode: "COOKIE" };
  const originalMode = process.env.DATA_MODE;

  beforeEach(() => {
    process.env.DATA_MODE = "MULTITENANT";
    mocks.post.mockReset().mockResolvedValue({ data: { data: { code: "x" } } });
  });

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.DATA_MODE;
    } else {
      process.env.DATA_MODE = originalMode;
    }
  });

  it("creates a single-use code under the reward's promotion and returns it", async () => {
    const code = await issueClaimCode(reward, "store1");

    expect(mocks.post).toHaveBeenCalledWith("/v3/promotions/promo-9/codes", {
      body: { code, max_uses: 1, max_uses_per_customer: 1 },
    });
    expect(code).toMatch(/^COOKIE-/);
  });

  it("retries with a fresh code when BigCommerce reports a duplicate", async () => {
    mocks.post
      .mockRejectedValueOnce(
        new AppError("UPSTREAM_API", "failed", {
          status: 422,
          cause: 'POST "/x" failed with status 422: The code(s) you are trying to create already exist',
        }),
      )
      .mockResolvedValueOnce({ data: { data: { code: "x" } } });

    await issueClaimCode(reward, "store1");

    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[0][1].body.code).not.toBe(mocks.post.mock.calls[1][1].body.code);
  });

  it("gives up after three duplicate collisions", async () => {
    mocks.post.mockRejectedValue(new AppError("UPSTREAM_API", "failed", { status: 422, cause: "status 422: already exist" }));

    await expect(issueClaimCode(reward, "store1")).rejects.toThrow();
    expect(mocks.post).toHaveBeenCalledTimes(3);
  });

  it("does not retry other upstream errors", async () => {
    mocks.post.mockRejectedValue(new AppError("UPSTREAM_API", "failed", { status: 500, cause: "status 500" }));

    await expect(issueClaimCode(reward, "store1")).rejects.toThrow();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("refuses a reward with no promotion", async () => {
    await expect(issueClaimCode({ ...reward, bcPromotionId: null }, "store1")).rejects.toThrow(/isn't synced/);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("returns a generated code without calling BigCommerce in MOCK mode", async () => {
    process.env.DATA_MODE = "MOCK";

    expect(await issueClaimCode(reward, undefined)).toMatch(/^COOKIE-/);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
