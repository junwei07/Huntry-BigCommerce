import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { HuntryClaim } from "@/lib/huntry/claims/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

export const GAME_ACTIVITY_LIMIT = 200;

// BC-HUN-039: the newest claims for one event, forced ones included (they are
// audit-relevant: is_forced + forced_by_user_id say who overrode what).
export async function fetchGameActivity(
  eventId: number,
  storeHash: string | undefined,
  limit: number = GAME_ACTIVITY_LIMIT,
): Promise<HuntryClaim[]> {
  if (getDataMode() === "MOCK") {
    return MOCK_CLAIMS.filter((claim) => claim.eventId === eventId)
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime() || Number(b.id) - Number(a.id))
      .slice(0, limit);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return getHuntryRepository().claims.listRecentClaims(resolvedStoreHash, eventId, limit);
}
