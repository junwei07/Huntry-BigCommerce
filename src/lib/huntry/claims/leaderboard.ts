import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { LeaderboardEntry } from "@/lib/huntry/claims/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

export const LEADERBOARD_LIMIT = 10;

// BC-HUN-039: top customers by claim count for one event. `is_forced = FALSE`
// lives here, not in the Force Claim insert (docs/MIGRATION.md §7) — forced
// claims count toward capacity and show in game activity, but never rank.
// Ties go to whoever reached the count first (earliest last claim).
export async function fetchLeaderboard(
  eventId: number,
  storeHash: string | undefined,
  limit: number = LEADERBOARD_LIMIT,
): Promise<LeaderboardEntry[]> {
  if (getDataMode() === "MOCK") {
    const totals = new Map<number, LeaderboardEntry>();

    for (const claim of MOCK_CLAIMS.filter((item) => item.eventId === eventId && !item.isForced)) {
      const current = totals.get(claim.bcCustomerId);

      totals.set(claim.bcCustomerId, {
        bcCustomerId: claim.bcCustomerId,
        claimCount: (current?.claimCount ?? 0) + 1,
        lastClaimedAt: current && current.lastClaimedAt > claim.claimedAt ? current.lastClaimedAt : claim.claimedAt,
      });
    }

    return [...totals.values()]
      .sort(
        (a, b) =>
          b.claimCount - a.claimCount ||
          a.lastClaimedAt.getTime() - b.lastClaimedAt.getTime() ||
          a.bcCustomerId - b.bcCustomerId,
      )
      .slice(0, limit);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return getHuntryRepository().claims.getLeaderboard(resolvedStoreHash, eventId, limit);
}
