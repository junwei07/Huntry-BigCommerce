import { describe, expect, it } from "vitest";
import { groupClaimsByNormalizedCode } from "@/lib/huntry/claims/group-claims-by-code";
import type { RedemptionCandidate } from "@/lib/huntry/claims/redemption";

function candidate(id: number, couponCode: string): RedemptionCandidate {
  return { id, eventId: 1, bcCustomerId: 42, couponCode, redemptionStatus: "unredeemed" };
}

describe("groupClaimsByNormalizedCode", () => {
  it("groups case and whitespace variants of a code together", () => {
    const groups = groupClaimsByNormalizedCode([candidate(1, "hunt-aaaa1111"), candidate(2, "  HUNT-AAAA1111 ")]);

    expect([...groups.keys()]).toEqual(["HUNT-AAAA1111"]);
    expect(groups.get("HUNT-AAAA1111")?.map((claim) => claim.id)).toEqual([1, 2]);
  });

  it("keeps first-seen order of codes and of claims within a code", () => {
    const groups = groupClaimsByNormalizedCode([
      candidate(1, "HUNT-BBBB2222"),
      candidate(2, "HUNT-AAAA1111"),
      candidate(3, "hunt-bbbb2222"),
    ]);

    expect([...groups.keys()]).toEqual(["HUNT-BBBB2222", "HUNT-AAAA1111"]);
    expect(groups.get("HUNT-BBBB2222")?.map((claim) => claim.id)).toEqual([1, 3]);
  });

  it("returns an empty map for no claims", () => {
    expect(groupClaimsByNormalizedCode([]).size).toBe(0);
  });
});
