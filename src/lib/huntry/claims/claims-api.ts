import { DatabaseSync } from "node:sqlite";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { addMockForcedClaim, MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { CreateForcedClaimInput, CreateForcedClaimResult, HuntryClaim } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

// Raw row shape as node-postgres returns it: BOOLEAN is a real boolean,
// TIMESTAMPTZ a Date.
interface PostgresClaimRow {
  id: number;
  store_hash: string;
  egg_id: string;
  reward_id: number;
  event_id: number;
  reward_name_snapshot: string;
  bc_customer_id: number;
  coupon_code: string;
  claimed_at: Date;
  is_forced: boolean;
  forced_by_user_id: number | null;
}

// Raw row shape as node:sqlite returns it: BOOLEAN is 0/1, timestamps TEXT.
interface SqliteClaimRow extends Omit<PostgresClaimRow, "claimed_at" | "is_forced"> {
  claimed_at: string;
  is_forced: number;
}

function normalizeRow(row: PostgresClaimRow | SqliteClaimRow): HuntryClaim {
  return {
    id: row.id,
    storeHash: row.store_hash,
    eggId: row.egg_id,
    rewardId: row.reward_id,
    eventId: row.event_id,
    rewardNameSnapshot: row.reward_name_snapshot,
    bcCustomerId: row.bc_customer_id,
    couponCode: row.coupon_code,
    claimedAt: new Date(row.claimed_at),
    isForced: Boolean(row.is_forced),
    forcedByUserId: row.forced_by_user_id,
  };
}

const INSERT_COLUMNS =
  "store_hash, egg_id, reward_id, event_id, reward_name_snapshot, bc_customer_id, coupon_code, is_forced, forced_by_user_id";

function isUniqueViolation(error: unknown): boolean {
  // pg: SQLSTATE 23505; node:sqlite: message "UNIQUE constraint failed: ...".
  return (
    (error as { code?: string }).code === "23505" ||
    (error instanceof Error && error.message.includes("UNIQUE constraint failed"))
  );
}

// BC-HUN-029: the admin override. Inserts directly with is_forced = true and
// deliberately runs none of the player-claim checks (live status, geofence,
// capacity, per-player limit) — those live in BC-HUN-032's claim transaction.
// The leaderboard's `WHERE is_forced = FALSE` belongs to BC-HUN-039's query,
// not this insert. The (egg_id, bc_customer_id) UNIQUE constraint still
// applies, surfaced as "duplicate".
export async function createForcedClaim(
  input: CreateForcedClaimInput,
  storeHash: string | undefined,
): Promise<CreateForcedClaimResult> {
  if (getDataMode() === "MOCK") {
    return addMockForcedClaim(input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create a claim.");
  }

  const db = getHuntryDb();

  try {
    if (db instanceof DatabaseSync) {
      const row = db
        .prepare(
          `INSERT INTO huntry_claims (${INSERT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING *`,
        )
        .get(
          resolvedStoreHash,
          input.eggId,
          input.rewardId,
          input.eventId,
          input.rewardNameSnapshot,
          input.bcCustomerId,
          input.couponCode,
          input.forcedByUserId,
        ) as unknown as SqliteClaimRow;

      return { status: "created", claim: normalizeRow(row) };
    }

    const result = await db.query<PostgresClaimRow>(
      `INSERT INTO huntry_claims (${INSERT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8) RETURNING *`,
      [
        resolvedStoreHash,
        input.eggId,
        input.rewardId,
        input.eventId,
        input.rewardNameSnapshot,
        input.bcCustomerId,
        input.couponCode,
        input.forcedByUserId,
      ],
    );

    return { status: "created", claim: normalizeRow(result.rows[0]) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: "duplicate" };
    }

    throw error;
  }
}

// Ids of this event's eggs that have reached `capacity` claims — the public
// map's "fully claimed" marker state (BC-HUN-031). Forced claims count, since
// they count toward capacity (docs/MIGRATION.md §7). Not cached: it changes on
// every claim; the map-data route's short s-maxage bounds the query rate.
export async function fetchFullEggIds(
  eventId: number,
  capacity: number,
  storeHash: string | undefined,
): Promise<Set<string>> {
  if (getDataMode() === "MOCK") {
    const counts = new Map<string, number>();

    for (const claim of MOCK_CLAIMS.filter((item) => item.eventId === eventId)) {
      counts.set(claim.eggId, (counts.get(claim.eggId) ?? 0) + 1);
    }

    return new Set([...counts].filter(([, count]) => count >= capacity).map(([eggId]) => eggId));
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return new Set();
  }

  const db = getHuntryDb();
  let rows: { egg_id: string }[];

  if (db instanceof DatabaseSync) {
    rows = db
      .prepare(
        "SELECT egg_id FROM huntry_claims WHERE store_hash = ? AND event_id = ? GROUP BY egg_id HAVING COUNT(*) >= ?",
      )
      .all(resolvedStoreHash, eventId, capacity) as unknown as { egg_id: string }[];
  } else {
    rows = (
      await db.query<{ egg_id: string }>(
        "SELECT egg_id FROM huntry_claims WHERE store_hash = $1 AND event_id = $2 GROUP BY egg_id HAVING COUNT(*) >= $3",
        [resolvedStoreHash, eventId, capacity],
      )
    ).rows;
  }

  return new Set(rows.map((row) => row.egg_id));
}
