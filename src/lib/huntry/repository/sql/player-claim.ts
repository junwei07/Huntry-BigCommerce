import { DatabaseSync } from "node:sqlite";
import type { PoolClient } from "pg";
import type { ClaimContext } from "@/lib/huntry/claims/player-claim";
import { toDate } from "@/lib/huntry/claims/dates";
import { CreatePlayerClaimInput, CreatePlayerClaimResult, HuntryClaim } from "@/lib/huntry/claims/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { PlayerClaimHooks, PlayerClaimRepository } from "@/lib/huntry/repository/types";

// BC-HUN-032: the atomic, capacity-validated player claim. Locking and
// loading are per-driver; every decision lives in the facade's evaluateClaim
// (passed in as a hook) so the two drivers cannot drift
// (docs/MIGRATION.md §1, §7).

const LOCK_TIMEOUT_MS = 5000;

// A minimal query seam over the two drivers. SQL is written with `$n`
// placeholders; the SQLite adapter rewrites them to `?n`. `dialect` lets the
// few non-portable fragments (time math) differ.
interface ClaimTx {
  dialect: "pg" | "sqlite";
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
}

interface EggRow {
  lat: number;
  lng: number;
  event_id: number;
  reward_id: number;
}

// Driver-dependent column types (pg returns bigint/numeric as strings, SQLite
// returns dates as text), so the raw rows stay `unknown` until toClaimContext.
interface EventRow {
  starts_at: unknown;
  ends_at: unknown;
  marker_radius_meters: unknown;
  max_grab_count: unknown;
  egg_claim_capacity: unknown;
}

interface RewardRow {
  id: unknown;
  name: unknown;
  status: unknown;
  coupon_code: string | null;
  bc_promotion_id: string | null;
  egg_capacity: unknown;
  reward_starts_at: unknown;
  reward_expires_at: unknown;
}

interface CountsRow {
  egg: unknown;
  reward: unknown;
  customer_in_event: unknown;
  players_in_event: unknown;
}

interface LastClaimRow {
  claim_lat: number | null;
  claim_lng: number | null;
  elapsed: number | string;
}

interface ClaimRows {
  event: EventRow;
  reward: RewardRow;
  placed: { egg_claim_capacity: number | null }[];
  counts: CountsRow;
  existing: { coupon_code: string } | undefined;
  last: LastClaimRow | undefined;
}

// Runs the six reads evaluateClaim's context needs. Locks are taken by the
// caller first. Undefined when the event or reward row is gone.
async function queryClaimRows(
  tx: ClaimTx,
  storeHash: string,
  egg: EggRow,
  eggId: string,
  customerId: number,
): Promise<ClaimRows | undefined> {
  const elapsed =
    tx.dialect === "pg"
      ? "EXTRACT(EPOCH FROM (clock_timestamp() - claimed_at))"
      : "(CAST(strftime('%s', 'now') AS INTEGER) - CAST(strftime('%s', claimed_at) AS INTEGER))";

  const [event] = await tx.query<EventRow>(
    "SELECT starts_at, ends_at, marker_radius_meters, max_grab_count, egg_claim_capacity FROM huntry_events WHERE id = $1 AND store_hash = $2",
    [egg.event_id, storeHash],
  );
  const [reward] = await tx.query<RewardRow>(
    `SELECT id, name, status, coupon_code, bc_promotion_id, egg_capacity, reward_starts_at, reward_expires_at
     FROM huntry_rewards WHERE id = $1 AND store_hash = $2`,
    [egg.reward_id, storeHash],
  );

  if (!event || !reward) {
    return undefined;
  }

  const placed = await tx.query<{ egg_claim_capacity: number | null }>(
    `SELECT e.egg_claim_capacity FROM huntry_eggs g
     LEFT JOIN huntry_events e ON e.id = g.event_id AND e.store_hash = g.store_hash
     WHERE g.reward_id = $1 AND g.store_hash = $2`,
    [egg.reward_id, storeHash],
  );
  const [counts] = await tx.query<CountsRow>(
    `SELECT
       (SELECT COUNT(*) FROM huntry_claims WHERE store_hash = $1 AND egg_id = $2) AS egg,
       (SELECT COUNT(*) FROM huntry_claims WHERE store_hash = $1 AND reward_id = $3) AS reward,
       (SELECT COUNT(*) FROM huntry_claims WHERE store_hash = $1 AND event_id = $4 AND bc_customer_id = $5) AS customer_in_event,
       (SELECT COUNT(DISTINCT bc_customer_id) FROM huntry_claims WHERE store_hash = $1 AND event_id = $4) AS players_in_event`,
    [storeHash, eggId, egg.reward_id, egg.event_id, customerId],
  );
  const [existing] = await tx.query<{ coupon_code: string }>(
    "SELECT coupon_code FROM huntry_claims WHERE store_hash = $1 AND egg_id = $2 AND bc_customer_id = $3",
    [storeHash, eggId, customerId],
  );
  const [last] = await tx.query<LastClaimRow>(
    `SELECT claim_lat, claim_lng, ${elapsed} AS elapsed FROM huntry_claims
     WHERE store_hash = $1 AND bc_customer_id = $2 ORDER BY claimed_at DESC, id DESC LIMIT 1`,
    [storeHash, customerId],
  );

  return { event, reward, placed, counts, existing, last };
}

// Pure mapping from driver rows to the facade's ClaimContext.
function toClaimContext({ event, reward, placed, counts, existing, last }: ClaimRows, egg: EggRow): ClaimContext {
  return {
    egg: { lat: egg.lat, lng: egg.lng },
    event: {
      startsAt: toDate(event.starts_at),
      endsAt: toDate(event.ends_at),
      markerRadiusMeters: Number(event.marker_radius_meters),
      maxGrabCount: Number(event.max_grab_count),
      eggClaimCapacity: Number(event.egg_claim_capacity),
    },
    reward: {
      id: Number(reward.id),
      name: String(reward.name),
      status: String(reward.status),
      couponCode: reward.coupon_code ?? null,
      bcPromotionId: reward.bc_promotion_id ?? null,
      eggCapacity: Number(reward.egg_capacity),
      startsAt: toDate(reward.reward_starts_at),
      expiresAt: toDate(reward.reward_expires_at),
      placedEggClaimCapacities: placed.map((row) => row.egg_claim_capacity),
    },
    counts: {
      egg: Number(counts.egg),
      reward: Number(counts.reward),
      customerInEvent: Number(counts.customer_in_event),
      playersInEvent: Number(counts.players_in_event),
    },
    existingCouponCode: existing?.coupon_code ?? null,
    lastClaim: last
      ? { lat: last.claim_lat, lng: last.claim_lng, elapsedSeconds: Math.max(Number(last.elapsed), 0.001) }
      : null,
  };
}

// Loads everything evaluateClaim needs. Locks are taken by the caller first.
async function loadContext(
  tx: ClaimTx,
  storeHash: string,
  egg: EggRow,
  eggId: string,
  customerId: number,
): Promise<ClaimContext | undefined> {
  const rows = await queryClaimRows(tx, storeHash, egg, eggId, customerId);

  return rows && toClaimContext(rows, egg);
}

// Postgres-only: SQLite's BEGIN IMMEDIATE already serialises writers. Takes
// the customer, event and reward locks in the order documented in runClaim;
// the egg row is re-locked by the caller afterwards.
async function acquirePgLocks(tx: ClaimTx, storeHash: string, egg: EggRow, customerId: number): Promise<void> {
  if (tx.dialect !== "pg") {
    return;
  }

  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${storeHash}:${customerId}`]);
  // Serialises different new customers racing for the last player slots.
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${storeHash}:event:${egg.event_id}`]);
  await tx.query("SELECT id FROM huntry_rewards WHERE id = $1 AND store_hash = $2 FOR UPDATE", [egg.reward_id, storeHash]);
}

// The shared body, run between BEGIN and COMMIT. Returns the result plus
// whether the transaction should commit.
async function runClaim(
  tx: ClaimTx,
  storeHash: string,
  input: CreatePlayerClaimInput,
  hooks: PlayerClaimHooks,
): Promise<{ result: CreatePlayerClaimResult; commit: boolean }> {
  const forUpdate = tx.dialect === "pg" ? " FOR UPDATE" : "";
  const falseLiteral = tx.dialect === "pg" ? "FALSE" : "0";

  // Lock order (all callers): customer, event, reward, egg — see the ticket plan.
  const [egg] = await tx.query<EggRow & { reward_id: number }>(
    // The reward row is locked next, so first read the egg unlocked just to
    // learn its reward; the egg itself is re-locked below.
    "SELECT lat, lng, event_id, reward_id FROM huntry_eggs WHERE id = $1 AND store_hash = $2",
    [input.eggId, storeHash],
  );

  if (!egg) {
    return { result: { status: "egg_not_found" }, commit: false };
  }

  await acquirePgLocks(tx, storeHash, egg, input.bcCustomerId);

  const locked = await tx.query<EggRow>(
    `SELECT lat, lng, event_id, reward_id FROM huntry_eggs WHERE id = $1 AND store_hash = $2${forUpdate}`,
    [input.eggId, storeHash],
  );

  // Deleted between the unlocked read and the lock, or moved to another reward.
  if (!locked[0] || locked[0].reward_id !== egg.reward_id) {
    return { result: { status: "egg_not_found" }, commit: false };
  }

  const context = await loadContext(tx, storeHash, locked[0], input.eggId, input.bcCustomerId);

  if (!context) {
    return { result: { status: "reward_unavailable" }, commit: false };
  }

  const evaluation = hooks.evaluate(context);

  if (!("ok" in evaluation)) {
    return { result: evaluation, commit: false };
  }

  // Issued inside the lock and before the INSERT, so the row stores the real
  // per-claim code; a failure rolls everything back (no claim, no code shown).
  const claimCode = await hooks.issueCode(context.reward);

  if (claimCode === undefined) {
    return { result: { status: "code_issue_failed" }, commit: false };
  }

  const [row] = await tx.query<Record<string, unknown>>(
    `INSERT INTO huntry_claims
       (store_hash, egg_id, reward_id, event_id, reward_name_snapshot, bc_customer_id, coupon_code, claim_lat, claim_lng, is_forced)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${falseLiteral}) RETURNING *`,
    [
      storeHash,
      input.eggId,
      locked[0].reward_id,
      locked[0].event_id,
      context.reward.name,
      input.bcCustomerId,
      claimCode,
      input.lat,
      input.lng,
    ],
  );

  const claim: HuntryClaim = {
    id: Number(row.id),
    storeHash,
    eggId: String(row.egg_id),
    rewardId: Number(row.reward_id),
    eventId: Number(row.event_id),
    rewardNameSnapshot: String(row.reward_name_snapshot),
    bcCustomerId: Number(row.bc_customer_id),
    couponCode: String(row.coupon_code),
    claimedAt: toDate(row.claimed_at) ?? new Date(),
    isForced: false,
    forcedByUserId: null,
    orderId: null,
    redemptionStatus: "unredeemed",
  };

  return { result: { status: "created", claim }, commit: true };
}

function isLockTimeout(error: unknown): boolean {
  // 55P03 lock_not_available, 57014 query_canceled (statement_timeout).
  const code = (error as { code?: string }).code;

  return code === "55P03" || code === "57014";
}

// node:sqlite has one connection per process and issuing the code is an await inside
// the open transaction, so concurrent claims must queue rather than interleave
// BEGINs on the shared connection.
let sqliteQueue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = sqliteQueue.then(task, task);

  sqliteQueue = run.catch(() => undefined);

  return run;
}

async function claimOnSqlite(
  db: DatabaseSync,
  storeHash: string,
  input: CreatePlayerClaimInput,
  hooks: PlayerClaimHooks,
) {
  const tx: ClaimTx = {
    dialect: "sqlite",
    query: async <T>(sql: string, params: unknown[]) =>
      db.prepare(sql.replace(/\$(\d+)/g, "?$1")).all(...(params as never[])) as unknown as T[],
  };

  return runExclusive(async (): Promise<CreatePlayerClaimResult> => {
    db.exec("BEGIN IMMEDIATE");

    try {
      const { result, commit } = await runClaim(tx, storeHash, input, hooks);

      db.exec(commit ? "COMMIT" : "ROLLBACK");

      return result;
    } catch (error) {
      db.exec("ROLLBACK");

      throw error;
    }
  });
}

async function claimOnPostgres(
  client: PoolClient,
  storeHash: string,
  input: CreatePlayerClaimInput,
  hooks: PlayerClaimHooks,
): Promise<CreatePlayerClaimResult> {
  const tx: ClaimTx = {
    dialect: "pg",
    query: async <T>(sql: string, params: unknown[]) => (await client.query(sql, params)).rows as T[],
  };

  try {
    await client.query("BEGIN");
    // SET LOCAL takes no bind parameters; the values are constants.
    await client.query(`SET LOCAL lock_timeout = ${LOCK_TIMEOUT_MS}`);
    await client.query(`SET LOCAL statement_timeout = ${LOCK_TIMEOUT_MS * 2}`);

    const { result, commit } = await runClaim(tx, storeHash, input, hooks);

    await client.query(commit ? "COMMIT" : "ROLLBACK");

    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (isLockTimeout(error)) {
      return { status: "lock_timeout" };
    }

    throw error;
  }
}

async function createPlayerClaimRow(
  storeHash: string,
  input: CreatePlayerClaimInput,
  hooks: PlayerClaimHooks,
): Promise<CreatePlayerClaimResult> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    return claimOnSqlite(db, storeHash, input, hooks);
  }

  const client = await db.connect();

  try {
    return await claimOnPostgres(client, storeHash, input, hooks);
  } finally {
    client.release();
  }
}

export const sqlPlayerClaimRepository: PlayerClaimRepository = {
  createPlayerClaim: createPlayerClaimRow,
};
