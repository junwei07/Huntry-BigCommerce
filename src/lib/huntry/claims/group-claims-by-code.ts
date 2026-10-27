import { normalizeCouponCode } from "@/lib/huntry/claims/coupon-code";
import type { RedemptionCandidate } from "@/lib/huntry/claims/redemption";

// huntry_claims has no UNIQUE(store_hash, coupon_code), so one code can map to
// several claim rows. Both the order webhook (redemption.ts) and the cart
// webhook (cart-coupon-enforcement.ts) decide per code, so they share this
// grouping. Map order is first-seen code order, and claims keep their input
// order within a code.
export function groupClaimsByNormalizedCode(claims: RedemptionCandidate[]): Map<string, RedemptionCandidate[]> {
  const claimsByCode = new Map<string, RedemptionCandidate[]>();

  for (const claim of claims) {
    const code = normalizeCouponCode(claim.couponCode);

    claimsByCode.set(code, [...(claimsByCode.get(code) ?? []), claim]);
  }

  return claimsByCode;
}
