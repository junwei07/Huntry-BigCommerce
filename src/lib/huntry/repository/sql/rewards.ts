import { DatabaseSync } from "node:sqlite";
import type { Pool, PoolClient } from "pg";
import { getHuntryDb, HuntryDb } from "@/lib/huntry/db/get-db";
import type { RewardsRepository } from "@/lib/huntry/repository/types";
import {
  CreateRewardInput,
  DiscountScope,
  DiscountType,
  HuntryReward,
  RewardCouponFields,
  RewardFields,
  RewardSort,
  RewardStatus,
  UpdateRewardInput,
} from "@/lib/huntry/rewards/types";

// Raw row shape as node-postgres actually returns it: TIMESTAMPTZ columns
// are Date instances. discount_value is NUMERIC(10, 2) — node-postgres has
// no built-in NUMERIC->number type parser registered anywhere in this
// codebase, so it comes back as a string; normalizePostgresRow converts it.
interface PostgresRewardRow {
  id: number;
  store_hash: string;
  name: string;
  description: string;
  sponsor_id: number | null;
  egg_capacity: number;
  reward_starts_at: Date | null;
  reward_expires_at: Date | null;
  discount_type: DiscountType;
  discount_value: string;
  discount_scope: DiscountScope;
  coupon_code: string | null;
  bc_promotion_id: string | null;
  bc_coupon_code_id: string | null;
  bc_customer_group_id: string | null;
  status: RewardStatus;
  created_at: Date;
  updated_at: Date;
}

// Raw row shape as node:sqlite actually returns it: no native timestamp
// type, so created_at/updated_at/reward_starts_at/reward_expires_at are the
// TEXT strings the app itself wrote; discount_value round-trips as a real
// number (SQLite's NUMERIC affinity), unlike Postgres's string return.
interface SqliteRewardRow {
  id: number;
  store_hash: string;
  name: string;
  description: string;
  sponsor_id: number | null;
  egg_capacity: number;
  reward_starts_at: string | null;
  reward_expires_at: string | null;
  discount_type: DiscountType;
  discount_value: number;
  discount_scope: DiscountScope;
  coupon_code: string | null;
  bc_promotion_id: string | null;
  bc_coupon_code_id: string | null;
  bc_customer_group_id: string | null;
  status: RewardStatus;
  created_at: string;
  updated_at: string;
}

function normalizePostgresRow(row: PostgresRewardRow): RewardFields {
  return {
    id: row.id,
    storeHash: row.store_hash,
    name: row.name,
    description: row.description,
    sponsorId: row.sponsor_id,
    eggCapacity: row.egg_capacity,
    rewardStartsAt: row.reward_starts_at,
    rewardExpiresAt: row.reward_expires_at,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value),
    discountScope: row.discount_scope,
    couponCode: row.coupon_code,
    bcPromotionId: row.bc_promotion_id,
    bcCouponCodeId: row.bc_coupon_code_id,
    bcCustomerGroupId: row.bc_customer_group_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSqliteRow(row: SqliteRewardRow): RewardFields {
  return {
    id: row.id,
    storeHash: row.store_hash,
    name: row.name,
    description: row.description,
    sponsorId: row.sponsor_id,
    eggCapacity: row.egg_capacity,
    rewardStartsAt: row.reward_starts_at ? new Date(row.reward_starts_at) : null,
    rewardExpiresAt: row.reward_expires_at ? new Date(row.reward_expires_at) : null,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    discountScope: row.discount_scope,
    couponCode: row.coupon_code,
    bcPromotionId: row.bc_promotion_id,
    bcCouponCodeId: row.bc_coupon_code_id,
    bcCustomerGroupId: row.bc_customer_group_id,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Maps the query's sort field to a fixed ORDER BY fragment rather than
// interpolating it directly — defense in depth against ever interpolating an
// unvalidated value into the ORDER BY clause below, mirroring
// events' own orderBySql.
function orderBySql(sort: RewardSort): string {
  return sort === "time" ? "reward_starts_at IS NULL, reward_starts_at ASC, name ASC" : "name ASC";
}

// huntry_reward_products is only populated when discountScope === "specific"
// (enforced by every caller, not this helper) — reading it unconditionally
// here would just always return [] for an "all"-scope reward, so callers
// skip the query entirely in that case rather than relying on this to no-op.
async function selectRewardProductIds(db: HuntryDb, rewardId: number): Promise<number[]> {
  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare("SELECT bc_product_id FROM huntry_reward_products WHERE reward_id = ?")
      .all(rewardId) as unknown as { bc_product_id: number }[];

    return rows.map((row) => row.bc_product_id);
  }

  const result = await db.query<{ bc_product_id: number }>(
    "SELECT bc_product_id FROM huntry_reward_products WHERE reward_id = $1",
    [rewardId],
  );

  return result.rows.map((row) => row.bc_product_id);
}

async function buildHuntryReward(db: HuntryDb, fields: RewardFields): Promise<HuntryReward> {
  const productIds = fields.discountScope === "specific" ? await selectRewardProductIds(db, fields.id) : [];

  return { ...fields, productIds };
}

async function selectRewards(storeHash: string, sort: RewardSort): Promise<HuntryReward[]> {
  const db = getHuntryDb();
  const orderBy = orderBySql(sort);
  let rewardFields: RewardFields[];

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare(`SELECT * FROM huntry_rewards WHERE store_hash = ? ORDER BY ${orderBy}`)
      .all(storeHash) as unknown as SqliteRewardRow[];

    rewardFields = rows.map(normalizeSqliteRow);
  } else {
    const result = await db.query<PostgresRewardRow>(
      `SELECT * FROM huntry_rewards WHERE store_hash = $1 ORDER BY ${orderBy}`,
      [storeHash],
    );

    rewardFields = result.rows.map(normalizePostgresRow);
  }

  return Promise.all(rewardFields.map((fields) => buildHuntryReward(db, fields)));
}

async function selectRewardRow(storeHash: string, id: number): Promise<HuntryReward | undefined> {
  const db = getHuntryDb();
  let fields: RewardFields | undefined;

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT * FROM huntry_rewards WHERE id = ? AND store_hash = ?").get(id, storeHash) as
      | SqliteRewardRow
      | undefined;

    fields = row ? normalizeSqliteRow(row) : undefined;
  } else {
    const result = await db.query<PostgresRewardRow>(
      "SELECT * FROM huntry_rewards WHERE id = $1 AND store_hash = $2",
      [id, storeHash],
    );
    const row = result.rows[0];

    fields = row ? normalizePostgresRow(row) : undefined;
  }

  return fields ? buildHuntryReward(db, fields) : undefined;
}

async function selectCouponCodeTaken(storeHash: string, couponCode: string, excludeId?: number): Promise<boolean> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db
      .prepare("SELECT 1 FROM huntry_rewards WHERE store_hash = ? AND coupon_code = ? AND id != ? LIMIT 1")
      .get(storeHash, couponCode, excludeId ?? -1);

    return row !== undefined;
  }

  const result = await db.query(
    "SELECT 1 FROM huntry_rewards WHERE store_hash = $1 AND coupon_code = $2 AND id != $3 LIMIT 1",
    [storeHash, couponCode, excludeId ?? -1],
  );

  return (result.rowCount ?? 0) > 0;
}

async function replaceRewardProductsPg(client: PoolClient, rewardId: number, productIds: number[]): Promise<void> {
  await client.query("DELETE FROM huntry_reward_products WHERE reward_id = $1", [rewardId]);

  for (const productId of productIds) {
    await client.query("INSERT INTO huntry_reward_products (reward_id, bc_product_id) VALUES ($1, $2)", [
      rewardId,
      productId,
    ]);
  }
}

function replaceRewardProductsSqlite(db: DatabaseSync, rewardId: number, productIds: number[]): void {
  db.prepare("DELETE FROM huntry_reward_products WHERE reward_id = ?").run(rewardId);

  const insert = db.prepare("INSERT INTO huntry_reward_products (reward_id, bc_product_id) VALUES (?, ?)");

  for (const productId of productIds) {
    insert.run(rewardId, productId);
  }
}

// Inserting the reward row and its product associations is a single logical
// write — a failure partway through must not leave a reward with stale/
// missing huntry_reward_products rows. Wrapped in a real transaction (one
// checked-out client for Postgres, BEGIN/COMMIT/ROLLBACK for SQLite's single
// connection), mirroring postgres-credentials-store.ts's deleteStore
// precedent — the first multi-statement write in any Huntry DAL so far
// (sponsors/events never needed one).
async function insertRewardRowPg(pool: Pool, input: CreateRewardInput, storeHash: string): Promise<HuntryReward> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<PostgresRewardRow>(
      `INSERT INTO huntry_rewards
        (store_hash, name, description, sponsor_id, egg_capacity, reward_starts_at, reward_expires_at,
         discount_type, discount_value, discount_scope, coupon_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        storeHash,
        input.name,
        input.description,
        input.sponsorId,
        input.eggCapacity,
        input.rewardStartsAt,
        input.rewardExpiresAt,
        input.discountType,
        input.discountValue,
        input.discountScope,
        input.couponCode,
      ],
    );

    const row = result.rows[0];
    const productIds = input.discountScope === "specific" ? input.productIds : [];

    await replaceRewardProductsPg(client, row.id, productIds);
    await client.query("COMMIT");

    return { ...normalizePostgresRow(row), productIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function insertRewardRowSqlite(db: DatabaseSync, input: CreateRewardInput, storeHash: string): HuntryReward {
  db.exec("BEGIN");

  try {
    const result = db
      .prepare(
        `INSERT INTO huntry_rewards
          (store_hash, name, description, sponsor_id, egg_capacity, reward_starts_at, reward_expires_at,
           discount_type, discount_value, discount_scope, coupon_code)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        storeHash,
        input.name,
        input.description,
        input.sponsorId,
        input.eggCapacity,
        input.rewardStartsAt ? input.rewardStartsAt.toISOString() : null,
        input.rewardExpiresAt ? input.rewardExpiresAt.toISOString() : null,
        input.discountType,
        input.discountValue,
        input.discountScope,
        input.couponCode,
      );

    const row = db
      .prepare("SELECT * FROM huntry_rewards WHERE id = ?")
      .get(result.lastInsertRowid) as unknown as SqliteRewardRow;
    const productIds = input.discountScope === "specific" ? input.productIds : [];

    replaceRewardProductsSqlite(db, row.id, productIds);
    db.exec("COMMIT");

    return { ...normalizeSqliteRow(row), productIds };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// Throws the driver's raw unique-violation error when (store_hash,
// coupon_code) is taken; the Server Action maps it via
// isUniqueCouponCodeConstraintError (rewards-api.ts).
async function insertRewardRow(storeHash: string, input: CreateRewardInput): Promise<HuntryReward> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    return insertRewardRowSqlite(db, input, storeHash);
  }

  return insertRewardRowPg(db, input, storeHash);
}

async function updateRewardRowPg(
  pool: Pool,
  id: number,
  input: UpdateRewardInput,
  storeHash: string,
): Promise<HuntryReward | undefined> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<PostgresRewardRow>(
      `UPDATE huntry_rewards SET
        name = $1, description = $2, sponsor_id = $3, egg_capacity = $4, reward_starts_at = $5,
        reward_expires_at = $6, discount_type = $7, discount_value = $8, discount_scope = $9,
        coupon_code = $10, updated_at = now()
       WHERE id = $11 AND store_hash = $12
       RETURNING *`,
      [
        input.name,
        input.description,
        input.sponsorId,
        input.eggCapacity,
        input.rewardStartsAt,
        input.rewardExpiresAt,
        input.discountType,
        input.discountValue,
        input.discountScope,
        input.couponCode,
        id,
        storeHash,
      ],
    );

    const row = result.rows[0];

    if (!row) {
      await client.query("COMMIT");
      return undefined;
    }

    const productIds = input.discountScope === "specific" ? input.productIds : [];

    await replaceRewardProductsPg(client, id, productIds);
    await client.query("COMMIT");

    return { ...normalizePostgresRow(row), productIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function updateRewardRowSqlite(
  db: DatabaseSync,
  id: number,
  input: UpdateRewardInput,
  storeHash: string,
): HuntryReward | undefined {
  db.exec("BEGIN");

  try {
    const result = db
      .prepare(
        `UPDATE huntry_rewards SET
          name = ?, description = ?, sponsor_id = ?, egg_capacity = ?, reward_starts_at = ?,
          reward_expires_at = ?, discount_type = ?, discount_value = ?, discount_scope = ?,
          coupon_code = ?, updated_at = ?
         WHERE id = ? AND store_hash = ?`,
      )
      .run(
        input.name,
        input.description,
        input.sponsorId,
        input.eggCapacity,
        input.rewardStartsAt ? input.rewardStartsAt.toISOString() : null,
        input.rewardExpiresAt ? input.rewardExpiresAt.toISOString() : null,
        input.discountType,
        input.discountValue,
        input.discountScope,
        input.couponCode,
        new Date().toISOString(),
        id,
        storeHash,
      );

    if (result.changes === 0) {
      db.exec("COMMIT");
      return undefined;
    }

    const row = db.prepare("SELECT * FROM huntry_rewards WHERE id = ?").get(id) as unknown as SqliteRewardRow;
    const productIds = input.discountScope === "specific" ? input.productIds : [];

    replaceRewardProductsSqlite(db, id, productIds);
    db.exec("COMMIT");

    return { ...normalizeSqliteRow(row), productIds };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function updateRewardRow(storeHash: string, id: number, input: UpdateRewardInput): Promise<HuntryReward | undefined> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    return updateRewardRowSqlite(db, id, input, storeHash);
  }

  return updateRewardRowPg(db, id, input, storeHash);
}

// The sole writer of the two BigCommerce-id columns. A single-statement
// write, no transaction needed (no child-table replace, unlike
// create/update).
async function updateRewardCouponFieldsRow(storeHash: string, id: number, fields: RewardCouponFields): Promise<void> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    db.prepare(
      "UPDATE huntry_rewards SET bc_promotion_id = ?, bc_coupon_code_id = ?, bc_customer_group_id = ?, updated_at = ? WHERE id = ? AND store_hash = ?",
    ).run(
      fields.bcPromotionId,
      fields.bcCouponCodeId,
      fields.bcCustomerGroupId,
      new Date().toISOString(),
      id,
      storeHash,
    );
    return;
  }

  await db.query(
    "UPDATE huntry_rewards SET bc_promotion_id = $1, bc_coupon_code_id = $2, bc_customer_group_id = $3, updated_at = now() WHERE id = $4 AND store_hash = $5",
    [fields.bcPromotionId, fields.bcCouponCodeId, fields.bcCustomerGroupId, id, storeHash],
  );
}

// Cascades huntry_reward_products and huntry_eggs via their existing
// `ON DELETE CASCADE` FKs; never touches huntry_claims (denormalized, no FK,
// by schema design — a reward's past claims stay intact after the reward
// row itself is gone).
async function deleteRewardRow(storeHash: string, id: number): Promise<boolean> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db.prepare("DELETE FROM huntry_rewards WHERE id = ? AND store_hash = ?").run(id, storeHash);

    return result.changes > 0;
  }

  const result = await db.query("DELETE FROM huntry_rewards WHERE id = $1 AND store_hash = $2", [id, storeHash]);

  return (result.rowCount ?? 0) > 0;
}

async function selectRewardCount(storeHash: string): Promise<number> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM huntry_rewards WHERE store_hash = ?").get(storeHash) as unknown as {
      count: number;
    };

    return Number(row.count);
  }

  const result = await db.query<{ count: string }>("SELECT COUNT(*) AS count FROM huntry_rewards WHERE store_hash = $1", [
    storeHash,
  ]);

  return Number(result.rows[0]?.count ?? 0);
}

export const sqlRewardsRepository: RewardsRepository = {
  list: selectRewards,
  get: selectRewardRow,
  count: selectRewardCount,
  isCouponCodeTaken: selectCouponCodeTaken,
  create: insertRewardRow,
  update: updateRewardRow,
  updateCouponFields: updateRewardCouponFieldsRow,
  delete: deleteRewardRow,
};
