import { describe, expect, it } from "vitest";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { RewardFormInput, rewardFormSchema } from "@/lib/huntry/rewards/reward-form-schema";

// Every test below starts from a fully valid input and changes exactly one
// field, so the refine chain's other conditions stay true and
// issues[0] is unambiguous — matching how the Server Actions themselves read
// parsed.error.issues[0]?.message.
const VALID_INPUT: RewardFormInput = {
  name: "Test Reward",
  description: "A test reward",
  sponsorId: "",
  couponCode: "TESTCODE",
  rewardStartsAt: "2026-01-01",
  rewardExpiresAt: "2026-02-01",
  eggCapacity: "5",
  discountType: "percent",
  discountValue: "10",
  discountScope: "all",
  productIds: [],
};

function firstMessage(input: RewardFormInput): string | undefined {
  const result = rewardFormSchema.safeParse(input);

  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("rewardFormSchema", () => {
  it("accepts a fully valid input", () => {
    expect(rewardFormSchema.safeParse(VALID_INPUT).success).toBe(true);
  });

  it("requires a name", () => {
    expect(firstMessage({ ...VALID_INPUT, name: "" })).toBe("Name is required.");
  });

  it("requires a description", () => {
    expect(firstMessage({ ...VALID_INPUT, description: "" })).toBe("Description is required.");
  });

  it("requires a coupon code", () => {
    expect(firstMessage({ ...VALID_INPUT, couponCode: "" })).toBe("Coupon code is required.");
  });

  it("requires a start date", () => {
    expect(firstMessage({ ...VALID_INPUT, rewardStartsAt: "" })).toBe("Start date is required.");
  });

  it("requires an expiry date", () => {
    expect(firstMessage({ ...VALID_INPUT, rewardExpiresAt: "" })).toBe("Expiry date is required.");
  });

  it("rejects a non-integer egg capacity", () => {
    expect(firstMessage({ ...VALID_INPUT, eggCapacity: "2.5" })).toBe("Number of eggs must be a whole number.");
  });

  it("rejects an egg capacity below 1", () => {
    expect(firstMessage({ ...VALID_INPUT, eggCapacity: "0" })).toBe("Number of eggs must be at least 1.");
  });

  it("rejects an egg capacity above MAX_EGGS_PER_REWARD", () => {
    expect(firstMessage({ ...VALID_INPUT, eggCapacity: String(MAX_EGGS_PER_REWARD + 1) })).toBe(
      `Number of eggs must be ${MAX_EGGS_PER_REWARD} or fewer.`,
    );
  });

  it("caps a percent discount at 100", () => {
    expect(firstMessage({ ...VALID_INPUT, discountType: "percent", discountValue: "150" })).toBe(
      "Percent discounts cannot exceed 100.",
    );
  });

  it("leaves a fixed_cart discount uncapped above 100", () => {
    const result = rewardFormSchema.safeParse({ ...VALID_INPUT, discountType: "fixed_cart", discountValue: "150" });

    expect(result.success).toBe(true);
  });

  it("requires the expiry date to be after the start date", () => {
    expect(
      firstMessage({ ...VALID_INPUT, rewardStartsAt: "2026-02-01", rewardExpiresAt: "2026-01-01" }),
    ).toBe("Expiry date must be after the start date.");
  });

  it("requires at least one product when discountScope is 'specific'", () => {
    expect(firstMessage({ ...VALID_INPUT, discountScope: "specific", productIds: [] })).toBe(
      "Select at least one product for a product-specific reward.",
    );
  });

  it("accepts a 'specific' scope with at least one product", () => {
    const result = rewardFormSchema.safeParse({ ...VALID_INPUT, discountScope: "specific", productIds: [101] });

    expect(result.success).toBe(true);
  });
});
