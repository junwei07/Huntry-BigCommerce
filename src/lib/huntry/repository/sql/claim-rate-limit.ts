import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { ClaimRateLimitRepository } from "@/lib/huntry/repository/types";

// Ages are computed in SQL, never against the app clock, so app/DB skew can't
// shift the window or the retry value (same forms as player-claim.ts).
const PG_ELAPSED = "EXTRACT(EPOCH FROM (clock_timestamp() - claimed_at))";
const SQLITE_ELAPSED = "(CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', claimed_at) AS INTEGER))";

// A customer who already holds this egg is never limited, so a re-request still
// reaches the transaction and gets their existing code back as a duplicate. This
// can't create a claim: UNIQUE (egg_id, bc_customer_id) plus the transaction's
// duplicate check run before any INSERT.
const OWNED_SQL = "SELECT 1 AS owned FROM huntry_claims WHERE store_hash = $1 AND egg_id = $2 AND bc_customer_id = $3";

// Both queries are store-scoped; the window filter is in SQL (see above).
const windowSql = (sqlite: boolean, windowSeconds: number, maxClaims: number) => {
  const elapsed = sqlite ? SQLITE_ELAPSED : PG_ELAPSED;

  return `SELECT ${elapsed} AS elapsed FROM huntry_claims
   WHERE store_hash = $1 AND bc_customer_id = $2 AND is_forced = ${sqlite ? "0" : "FALSE"}
     AND ${elapsed} < ${windowSeconds}
   ORDER BY claimed_at DESC, id DESC LIMIT ${maxClaims}`;
};

// Not routed through player-claim's runExclusive queue: this is a read and
// must not wait behind a claim that is awaiting code issuance.
async function rows<T>(sql: string, params: unknown[]): Promise<T[]> {
  const db = getHuntryDb();

  return db instanceof DatabaseSync
    ? (db.prepare(sql.replace(/\$(\d+)/g, "?$1")).all(...(params as never[])) as unknown as T[])
    : ((await db.query(sql, params)).rows as T[]);
}

async function selectHasClaimedEgg(storeHash: string, eggId: string, customerId: number): Promise<boolean> {
  const owned = await rows(OWNED_SQL, [storeHash, eggId, customerId]);

  return owned.length > 0;
}

async function selectRecentClaimAges(
  storeHash: string,
  customerId: number,
  windowSeconds: number,
  maxClaims: number,
): Promise<number[]> {
  const recent = await rows<{ elapsed: number | string }>(
    windowSql(getHuntryDb() instanceof DatabaseSync, windowSeconds, maxClaims),
    [storeHash, customerId],
  );

  return recent.map((row) => Number(row.elapsed));
}

export const sqlClaimRateLimitRepository: ClaimRateLimitRepository = {
  hasClaimedEgg: selectHasClaimedEgg,
  listRecentClaimAges: selectRecentClaimAges,
};
