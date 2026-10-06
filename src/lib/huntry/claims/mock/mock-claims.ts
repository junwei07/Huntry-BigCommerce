import { CreateForcedClaimInput, CreateForcedClaimResult, HuntryClaim } from "@/lib/huntry/claims/types";

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
  };

  MOCK_CLAIMS = [...MOCK_CLAIMS, claim];

  return { status: "created", claim };
}
