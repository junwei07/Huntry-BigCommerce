import { describe, expect, it } from "vitest";
import { eggClaimStatus } from "@/lib/huntry/claims/egg-claim-status";

describe("eggClaimStatus", () => {
  it("is Not Claimed with no claims", () => {
    expect(eggClaimStatus(undefined, 3)).toEqual({ claimed: false, label: "Not Claimed", forced: false });
    expect(eggClaimStatus({ count: 0, forced: 0 }, 3).claimed).toBe(false);
  });

  it("is Claimed n/capacity from the first claim, not only at capacity", () => {
    expect(eggClaimStatus({ count: 1, forced: 0 }, 3)).toEqual({ claimed: true, label: "Claimed 1/3", forced: false });
  });

  it("flags force-claimed eggs", () => {
    expect(eggClaimStatus({ count: 2, forced: 1 }, 2)).toEqual({ claimed: true, label: "Claimed 2/2", forced: true });
  });
});
