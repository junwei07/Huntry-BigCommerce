import { describe, expect, it } from "vitest";
import { formatRewardHeadline, isRewardWindowOpen, safeStorefrontPath } from "@/lib/huntry/rewards/reward-display";

const NOW = new Date("2026-10-10T00:00:00.000Z");
const past = new Date("2026-10-01T00:00:00.000Z");
const future = new Date("2026-10-20T00:00:00.000Z");

describe("isRewardWindowOpen", () => {
  it("is open for an active reward inside (or without) a window", () => {
    expect(isRewardWindowOpen({ status: "active", startsAt: null, expiresAt: null }, NOW)).toBe(true);
    expect(isRewardWindowOpen({ status: "active", startsAt: past, expiresAt: future }, NOW)).toBe(true);
  });

  it("is closed when archived, not started or expired", () => {
    expect(isRewardWindowOpen({ status: "archived", startsAt: null, expiresAt: null }, NOW)).toBe(false);
    expect(isRewardWindowOpen({ status: "active", startsAt: future, expiresAt: null }, NOW)).toBe(false);
    expect(isRewardWindowOpen({ status: "active", startsAt: null, expiresAt: past }, NOW)).toBe(false);
  });
});

describe("formatRewardHeadline", () => {
  it("formats percent and fixed discounts like the plugin", () => {
    expect(formatRewardHeadline("percent", 10)).toBe("Get 10% OFF");
    expect(formatRewardHeadline("fixed_cart", 5)).toBe("Get $5 OFF");
    expect(formatRewardHeadline("fixed_cart", 2.5)).toBe("Get $2.50 OFF");
  });
});

describe("safeStorefrontPath", () => {
  it("keeps same-origin paths and drops everything else", () => {
    expect(safeStorefrontPath("/coffee-beans/")).toBe("/coffee-beans/");
    expect(safeStorefrontPath("//evil.example/x")).toBeNull();
    expect(safeStorefrontPath("https://evil.example/x")).toBeNull();
    expect(safeStorefrontPath("javascript:alert(1)")).toBeNull();
    expect(safeStorefrontPath("/a b")).toBeNull();
    expect(safeStorefrontPath(undefined)).toBeNull();
  });
});
