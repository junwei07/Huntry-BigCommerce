import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

// BC-HUN-033: a DB-backed sliding window in front of BC-HUN-032's claim
// transaction. It reads `huntry_claims` only, so it caps *successful claims*
// per customer per window — refused attempts write no row and are bounded only
// by the JWT and the in-transaction cooldown. Deliberately simple per
// docs/MIGRATION.md §8 (revisit per deployment profile in Phase 8).
export const CLAIM_RATE_LIMIT_WINDOW_SECONDS = 600;
export const CLAIM_RATE_LIMIT_MAX_CLAIMS = 10;

export type ClaimRateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

// The limit is reached when MAX rows are in the window; the count drops below
// MAX exactly when the MAX-th newest row expires, even if more than MAX rows
// are in the window (concurrent overshoot, or a lowered constant).
function evaluate(elapsedSecondsNewestFirst: number[]): ClaimRateLimitResult {
  if (elapsedSecondsNewestFirst.length < CLAIM_RATE_LIMIT_MAX_CLAIMS) {
    return { limited: false };
  }

  const elapsed = elapsedSecondsNewestFirst[CLAIM_RATE_LIMIT_MAX_CLAIMS - 1];

  return { limited: true, retryAfterSeconds: Math.max(Math.ceil(CLAIM_RATE_LIMIT_WINDOW_SECONDS - elapsed), 1) };
}

function checkMock(customerId: number, eggId: string): ClaimRateLimitResult {
  if (MOCK_CLAIMS.some((claim) => claim.eggId === eggId && claim.bcCustomerId === customerId)) {
    return { limited: false };
  }

  const now = Date.now();
  const elapsed = MOCK_CLAIMS.filter((claim) => claim.bcCustomerId === customerId && !claim.isForced)
    .map((claim) => (now - claim.claimedAt.getTime()) / 1000)
    .filter((seconds) => seconds < CLAIM_RATE_LIMIT_WINDOW_SECONDS)
    .sort((a, b) => a - b);

  return evaluate(elapsed);
}

// Fails closed: a DB error propagates to the route's 500 rather than skipping
// the limit.
export async function checkClaimRateLimit(
  storeHash: string | undefined,
  customerId: number,
  eggId: string,
): Promise<ClaimRateLimitResult> {
  if (getDataMode() === "MOCK") {
    return checkMock(customerId, eggId);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to check the claim rate limit.");
  }

  const repository = getHuntryRepository().claims;

  // A customer who already holds this egg is never limited, so a re-request still
  // reaches the transaction and gets their existing code back as a duplicate. This
  // can't create a claim: UNIQUE (egg_id, bc_customer_id) plus the transaction's
  // duplicate check run before any INSERT. Not routed through player-claim's
  // runExclusive queue: this is a read and must not wait behind a claim that is
  // awaiting code issuance.
  if (await repository.hasClaimedEgg(resolvedStoreHash, eggId, customerId)) {
    return { limited: false };
  }

  // Ages are measured by the database clock, never the app clock, so app/DB
  // skew can't shift the window or the retry value.
  return evaluate(
    await repository.listRecentClaimAges(
      resolvedStoreHash,
      customerId,
      CLAIM_RATE_LIMIT_WINDOW_SECONDS,
      CLAIM_RATE_LIMIT_MAX_CLAIMS,
    ),
  );
}
