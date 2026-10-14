import { DatabaseSync } from "node:sqlite";
import { toDate } from "@/lib/huntry/claims/dates";
import { HuntryClaim, RedemptionStatus } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { GameActivityRepository } from "@/lib/huntry/repository/types";

interface ActivityDbRow {
  id: number;
  store_hash: string;
  egg_id: string;
  reward_id: number;
  event_id: number;
  reward_name_snapshot: string;
  bc_customer_id: number;
  coupon_code: string;
  claimed_at: Date | string;
  is_forced: boolean | number;
  forced_by_user_id: number | null;
  order_id: number | null;
  redemption_status: RedemptionStatus;
}

async function selectRecentClaims(storeHash: string, eventId: number, limit: number): Promise<HuntryClaim[]> {
  const db = getHuntryDb();
  let rows: ActivityDbRow[];

  if (db instanceof DatabaseSync) {
    rows = db
      .prepare(
        "SELECT * FROM huntry_claims WHERE store_hash = ? AND event_id = ? ORDER BY claimed_at DESC, id DESC LIMIT ?",
      )
      .all(storeHash, eventId, limit) as unknown as ActivityDbRow[];
  } else {
    rows = (
      await db.query<ActivityDbRow>(
        "SELECT * FROM huntry_claims WHERE store_hash = $1 AND event_id = $2 ORDER BY claimed_at DESC, id DESC LIMIT $3",
        [storeHash, eventId, limit],
      )
    ).rows;
  }

  return rows.map((row) => ({
    id: row.id,
    storeHash: row.store_hash,
    eggId: row.egg_id,
    rewardId: row.reward_id,
    eventId: row.event_id,
    rewardNameSnapshot: row.reward_name_snapshot,
    bcCustomerId: row.bc_customer_id,
    couponCode: row.coupon_code,
    claimedAt: toDate(row.claimed_at) ?? new Date(),
    isForced: Boolean(row.is_forced),
    forcedByUserId: row.forced_by_user_id,
    orderId: row.order_id,
    redemptionStatus: row.redemption_status,
  }));
}

export const sqlGameActivityRepository: GameActivityRepository = {
  listRecentClaims: selectRecentClaims,
};
