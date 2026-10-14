import { DatabaseSync } from "node:sqlite";
import type { RedemptionCandidate, RedemptionUpdate } from "@/lib/huntry/claims/redemption";
import { RedemptionStatus } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { RedemptionRepository } from "@/lib/huntry/repository/types";

interface CandidateDbRow {
  id: number;
  event_id: number;
  bc_customer_id: number;
  coupon_code: string;
  redemption_status: RedemptionStatus;
}

// Scoped by store: a code from another store's order can never touch this
// store's claims. `normalizedCodes` are already trimmed + uppercased by the
// caller; the match is case-insensitive via UPPER() on the stored code.
async function selectClaimsByNormalizedCouponCodes(
  storeHash: string,
  normalizedCodes: string[],
): Promise<RedemptionCandidate[]> {
  const db = getHuntryDb();
  let rows: CandidateDbRow[];

  if (db instanceof DatabaseSync) {
    const placeholders = normalizedCodes.map(() => "?").join(", ");

    rows = db
      .prepare(
        `SELECT id, event_id, bc_customer_id, coupon_code, redemption_status FROM huntry_claims WHERE store_hash = ? AND UPPER(coupon_code) IN (${placeholders})`,
      )
      .all(storeHash, ...normalizedCodes) as unknown as CandidateDbRow[];
  } else {
    rows = (
      await db.query<CandidateDbRow>(
        "SELECT id, event_id, bc_customer_id, coupon_code, redemption_status FROM huntry_claims WHERE store_hash = $1 AND UPPER(coupon_code) = ANY($2::text[])",
        [storeHash, normalizedCodes],
      )
    ).rows;
  }

  return rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    bcCustomerId: row.bc_customer_id,
    couponCode: row.coupon_code,
    redemptionStatus: row.redemption_status,
  }));
}

// Idempotent: only a claim still `unredeemed` is written, so a redelivered
// webhook (or a second order carrying the same code) can never flip an
// already-decided claim. Returns how many rows actually changed.
async function updateRedemptions(storeHash: string, orderId: number, updates: RedemptionUpdate[]): Promise<number> {
  const db = getHuntryDb();
  let changed = 0;

  for (const update of updates) {
    if (db instanceof DatabaseSync) {
      const result = db
        .prepare(
          "UPDATE huntry_claims SET redemption_status = ?, order_id = ? WHERE store_hash = ? AND id = ? AND redemption_status = 'unredeemed'",
        )
        .run(update.status, orderId, storeHash, update.claimId);

      changed += Number(result.changes);
    } else {
      const result = await db.query(
        "UPDATE huntry_claims SET redemption_status = $1, order_id = $2 WHERE store_hash = $3 AND id = $4 AND redemption_status = 'unredeemed'",
        [update.status, orderId, storeHash, update.claimId],
      );

      changed += result.rowCount ?? 0;
    }
  }

  return changed;
}

export const sqlRedemptionRepository: RedemptionRepository = {
  findClaimsByNormalizedCouponCodes: selectClaimsByNormalizedCouponCodes,
  markRedemptions: updateRedemptions,
};
