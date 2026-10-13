import {
  CreateForcedClaimInput,
  CreateForcedClaimResult,
  CreatePlayerClaimInput,
  CreatePlayerClaimResult,
  HuntryClaim,
} from "@/lib/huntry/claims/types";

// `let`, not `const` — the mutation helper replaces the array, matching
// mock-eggs.ts.
export let MOCK_CLAIMS: HuntryClaim[] = [];

export function addMockForcedClaim(input: CreateForcedClaimInput): CreateForcedClaimResult {
  if (MOCK_CLAIMS.some((claim) => claim.eggId === input.eggId && claim.bcCustomerId === input.bcCustomerId)) {
    return { status: "duplicate" };
  }

  const claim: HuntryClaim = {
    ...input,
    id: MOCK_CLAIMS.length + 1,
    storeHash: "mock-store",
    claimedAt: new Date(),
    isForced: true,
    orderId: null,
    redemptionStatus: "unredeemed",
  };

  MOCK_CLAIMS = [...MOCK_CLAIMS, claim];

  return { status: "created", claim };
}

// BC-HUN-032 MOCK mode: no DB to validate against, so only the duplicate rule
// applies. Uses the first mock egg's reward/event when the egg is unknown.
export function addMockPlayerClaim(input: CreatePlayerClaimInput): CreatePlayerClaimResult {
  const existing = MOCK_CLAIMS.find((claim) => claim.eggId === input.eggId && claim.bcCustomerId === input.bcCustomerId);

  if (existing) {
    return { status: "duplicate", couponCode: existing.couponCode };
  }

  const claim: HuntryClaim = {
    id: MOCK_CLAIMS.length + 1,
    storeHash: "mock-store",
    eggId: input.eggId,
    rewardId: 1,
    eventId: 1,
    rewardNameSnapshot: "Mock reward",
    bcCustomerId: input.bcCustomerId,
    couponCode: "MOCKCOUPON",
    claimedAt: new Date(),
    isForced: false,
    forcedByUserId: null,
    orderId: null,
    redemptionStatus: "unredeemed",
  };

  MOCK_CLAIMS = [...MOCK_CLAIMS, claim];

  return { status: "created", claim };
}
