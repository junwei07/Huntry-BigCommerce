import { DatabaseSync } from "node:sqlite";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { toDate } from "@/lib/huntry/claims/dates";
import { MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { LeaderboardEntry } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

export const LEADERBOARD_LIMIT = 10;

interface LeaderboardDbRow {
  bc_customer_id: number;
  claim_count: number | string;
  last_claimed_at: Date | string;
}

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

  const db = getHuntryDb();
  let rows: LeaderboardDbRow[];

  if (db instanceof DatabaseSync) {
    rows = db
      .prepare(
        `SELECT bc_customer_id, COUNT(*) AS claim_count, MAX(claimed_at) AS last_claimed_at
         FROM huntry_claims
         WHERE store_hash = ? AND event_id = ? AND is_forced = 0
         GROUP BY bc_customer_id
         ORDER BY claim_count DESC, last_claimed_at ASC, bc_customer_id ASC
         LIMIT ?`,
      )
      .all(resolvedStoreHash, eventId, limit) as unknown as LeaderboardDbRow[];
  } else {
    rows = (
      await db.query<LeaderboardDbRow>(
        `SELECT bc_customer_id, COUNT(*) AS claim_count, MAX(claimed_at) AS last_claimed_at
         FROM huntry_claims
         WHERE store_hash = $1 AND event_id = $2 AND is_forced = FALSE
         GROUP BY bc_customer_id
         ORDER BY claim_count DESC, last_claimed_at ASC, bc_customer_id ASC
         LIMIT $3`,
        [resolvedStoreHash, eventId, limit],
      )
    ).rows;
  }

  // COUNT comes back as a string from node-postgres (bigint).
  return rows.map((row) => ({
    bcCustomerId: Number(row.bc_customer_id),
    claimCount: Number(row.claim_count),
    lastClaimedAt: toDate(row.last_claimed_at) ?? new Date(),
  }));
}
