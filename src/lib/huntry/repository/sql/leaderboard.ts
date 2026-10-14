import { DatabaseSync } from "node:sqlite";
import { toDate } from "@/lib/huntry/claims/dates";
import { LeaderboardEntry } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { LeaderboardRepository } from "@/lib/huntry/repository/types";

interface LeaderboardDbRow {
  bc_customer_id: number;
  claim_count: number | string;
  last_claimed_at: Date | string;
}

// `is_forced = FALSE` lives here, not in the Force Claim insert
// (docs/MIGRATION.md §7) — forced claims count toward capacity and show in game
// activity, but never rank. Ties go to whoever reached the count first
// (earliest last claim).
async function selectLeaderboard(storeHash: string, eventId: number, limit: number): Promise<LeaderboardEntry[]> {
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
      .all(storeHash, eventId, limit) as unknown as LeaderboardDbRow[];
  } else {
    rows = (
      await db.query<LeaderboardDbRow>(
        `SELECT bc_customer_id, COUNT(*) AS claim_count, MAX(claimed_at) AS last_claimed_at
         FROM huntry_claims
         WHERE store_hash = $1 AND event_id = $2 AND is_forced = FALSE
         GROUP BY bc_customer_id
         ORDER BY claim_count DESC, last_claimed_at ASC, bc_customer_id ASC
         LIMIT $3`,
        [storeHash, eventId, limit],
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

export const sqlLeaderboardRepository: LeaderboardRepository = {
  getLeaderboard: selectLeaderboard,
};
