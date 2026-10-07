import { DatabaseSync } from "node:sqlite";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import { getHuntryDb } from "@/lib/huntry/db/get-db";

// BC-HUN-033: a DB-backed sliding window in front of BC-HUN-032's claim
// transaction. It reads `huntry_claims` only, so it caps *successful claims*
// per customer per window — refused attempts write no row and are bounded only
// by the JWT and the in-transaction cooldown. Deliberately simple per
// docs/MIGRATION.md §8 (revisit per deployment profile in Phase 8).
export const CLAIM_RATE_LIMIT_WINDOW_SECONDS = 600;
export const CLAIM_RATE_LIMIT_MAX_CLAIMS = 10;

export type ClaimRateLimitResult = { limited: false } | { limited: true; retryAfterSeconds: number };

// Ages are computed in SQL, never against the app clock, so app/DB skew can't
// shift the window or the retry value (same forms as player-claim.ts).
const PG_ELAPSED = "EXTRACT(EPOCH FROM (clock_timestamp() - claimed_at))";
const SQLITE_ELAPSED = "(CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', claimed_at) AS INTEGER))";

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

// A customer who already holds this egg is never limited, so a re-request still
// reaches the transaction and gets their existing code back as a duplicate. This
// can't create a claim: UNIQUE (egg_id, bc_customer_id) plus the transaction's
// duplicate check run before any INSERT.
const OWNED_SQL = "SELECT 1 AS owned FROM huntry_claims WHERE store_hash = $1 AND egg_id = $2 AND bc_customer_id = $3";

// Both queries are store-scoped; the window filter is in SQL (see above).
const windowSql = (sqlite: boolean) => {
  const elapsed = sqlite ? SQLITE_ELAPSED : PG_ELAPSED;

  return `SELECT ${elapsed} AS elapsed FROM huntry_claims
   WHERE store_hash = $1 AND bc_customer_id = $2 AND is_forced = ${sqlite ? "0" : "FALSE"}
     AND ${elapsed} < ${CLAIM_RATE_LIMIT_WINDOW_SECONDS}
   ORDER BY claimed_at DESC, id DESC LIMIT ${CLAIM_RATE_LIMIT_MAX_CLAIMS}`;
};

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

  const db = getHuntryDb();

  // Not routed through player-claim's runExclusive queue: this is a read and
  // must not wait behind a claim that is awaiting code issuance.
  const rows = async <T>(sql: string, params: unknown[]): Promise<T[]> =>
    db instanceof DatabaseSync
      ? (db.prepare(sql.replace(/\$(\d+)/g, "?$1")).all(...(params as never[])) as unknown as T[])
      : ((await db.query(sql, params)).rows as T[]);

  const owned = await rows(OWNED_SQL, [resolvedStoreHash, eggId, customerId]);

  if (owned.length > 0) {
    return { limited: false };
  }

  const recent = await rows<{ elapsed: number | string }>(windowSql(db instanceof DatabaseSync), [
    resolvedStoreHash,
    customerId,
  ]);

  return evaluate(recent.map((row) => Number(row.elapsed)));
}
