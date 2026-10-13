import { DatabaseSync } from "node:sqlite";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { toDate } from "@/lib/huntry/claims/dates";
import { MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { HuntryClaim, RedemptionStatus } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

export const GAME_ACTIVITY_LIMIT = 200;

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

// BC-HUN-039: the newest claims for one event, forced ones included (they are
// audit-relevant: is_forced + forced_by_user_id say who overrode what).
export async function fetchGameActivity(
  eventId: number,
  storeHash: string | undefined,
  limit: number = GAME_ACTIVITY_LIMIT,
): Promise<HuntryClaim[]> {
  if (getDataMode() === "MOCK") {
    return MOCK_CLAIMS.filter((claim) => claim.eventId === eventId)
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime() || b.id - a.id)
      .slice(0, limit);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  const db = getHuntryDb();
  let rows: ActivityDbRow[];

  if (db instanceof DatabaseSync) {
    rows = db
      .prepare(
        "SELECT * FROM huntry_claims WHERE store_hash = ? AND event_id = ? ORDER BY claimed_at DESC, id DESC LIMIT ?",
      )
      .all(resolvedStoreHash, eventId, limit) as unknown as ActivityDbRow[];
  } else {
    rows = (
      await db.query<ActivityDbRow>(
        "SELECT * FROM huntry_claims WHERE store_hash = $1 AND event_id = $2 ORDER BY claimed_at DESC, id DESC LIMIT $3",
        [resolvedStoreHash, eventId, limit],
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
