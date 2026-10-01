import { DatabaseSync } from "node:sqlite";
import type { Pool, PoolClient } from "pg";
import { getHuntryDb, HuntryDb } from "@/lib/huntry/db/get-db";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { ApiRequestParams, V3ListResponse } from "@/lib/bc-api-client/rest-client/types";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
import { addMockReward, deleteMockReward, MOCK_REWARDS, updateMockReward } from "@/lib/huntry/rewards/mock/mock-rewards";
import {
  BcProductSummary,
  CreateRewardInput,
  DiscountScope,
  DiscountType,
  HuntryReward,
  PRODUCTS_PATH,
  RewardFields,
  RewardsQuery,
  RewardStatus,
  SortDirection,
  UpdateRewardInput,
} from "@/lib/huntry/rewards/types";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

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

// Coerces to a known SQL keyword rather than interpolating the query's
// direction field directly — defense in depth against ever interpolating an
// unvalidated value into the ORDER BY clause below, mirroring
// events-api.ts/sponsors-api.ts's own directionSql.
function directionSql(direction: SortDirection): "ASC" | "DESC" {
  return direction === "DESC" ? "DESC" : "ASC";
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

async function fetchRewardsFromDb(query: RewardsQuery, storeHash: string): Promise<HuntryReward[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(REWARDS_LIST_TAG);
  // @cache-components-only:end

  const db = getHuntryDb();
  const direction = directionSql(query.direction);
  let rewardFields: RewardFields[];

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare(`SELECT * FROM huntry_rewards WHERE store_hash = ? ORDER BY name ${direction}`)
      .all(storeHash) as unknown as SqliteRewardRow[];

    rewardFields = rows.map(normalizeSqliteRow);
  } else {
    const result = await db.query<PostgresRewardRow>(
      `SELECT * FROM huntry_rewards WHERE store_hash = $1 ORDER BY name ${direction}`,
      [storeHash],
    );

    rewardFields = result.rows.map(normalizePostgresRow);
  }

  const rewards = await Promise.all(rewardFields.map((fields) => buildHuntryReward(db, fields)));

  // @cache-components-only:start
  for (const reward of rewards) {
    cacheTag(rewardTag(reward.id));
  }
  // @cache-components-only:end

  return rewards;
}

async function selectRewardRow(id: number, storeHash: string): Promise<HuntryReward | undefined> {
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

async function fetchRewardFromDb(id: number, storeHash: string): Promise<HuntryReward | undefined> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(rewardTag(id));
  // @cache-components-only:end

  return selectRewardRow(id, storeHash);
}

function sortMockRewards(rewards: HuntryReward[], direction: SortDirection): HuntryReward[] {
  return [...rewards].sort((a, b) => {
    const diff = a.name.localeCompare(b.name);

    return direction === "DESC" ? -diff : diff;
  });
}

// MOCK mode never touches getHuntryDb() — it returns deterministic fixture
// data instead, matching fetchSponsors/fetchEvents's own MOCK behavior and
// the app's DATA_MODE philosophy.
export async function fetchRewards(query: RewardsQuery, storeHash: string | undefined): Promise<HuntryReward[]> {
  if (getDataMode() === "MOCK") {
    return sortMockRewards(MOCK_REWARDS, query.direction);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return fetchRewardsFromDb(query, resolvedStoreHash);
}

export async function fetchReward(id: number, storeHash: string | undefined): Promise<HuntryReward | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_REWARDS.find((reward) => reward.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return fetchRewardFromDb(id, resolvedStoreHash);
}

// Uncached counterpart to fetchReward — not consumed by this ticket (no
// Server Action exists yet), but BC-HUN-019's update action will need it to
// preserve couponCode/bc*Id/status (none of which are edit-form fields)
// right before writing, the same reasoning fetchEventUncached/
// fetchSponsorUncached document: a Server Action about to mutate a record
// should never trust a cached read.
export async function fetchRewardUncached(id: number, storeHash: string | undefined): Promise<HuntryReward | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_REWARDS.find((reward) => reward.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return selectRewardRow(id, resolvedStoreHash);
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
         discount_type, discount_value, discount_scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
           discount_type, discount_value, discount_scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

async function createRewardInDb(input: CreateRewardInput, storeHash: string): Promise<HuntryReward> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    return insertRewardRowSqlite(db, input, storeHash);
  }

  return insertRewardRowPg(db, input, storeHash);
}

// MOCK mode pushes into the in-memory fixture array instead of throwing,
// matching createEvent/createSponsor's precedent — Huntry's own concepts are
// "MOCK-mode testable: Yes" per docs/MIGRATION.md §6.
export async function createReward(input: CreateRewardInput, storeHash: string | undefined): Promise<HuntryReward> {
  if (getDataMode() === "MOCK") {
    return addMockReward(input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create a reward.");
  }

  return createRewardInDb(input, resolvedStoreHash);
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
        updated_at = now()
       WHERE id = $10 AND store_hash = $11
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
          updated_at = ?
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

async function updateRewardInDb(
  id: number,
  input: UpdateRewardInput,
  storeHash: string,
): Promise<HuntryReward | undefined> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    return updateRewardRowSqlite(db, id, input, storeHash);
  }

  return updateRewardRowPg(db, id, input, storeHash);
}

// Returns undefined if no row matched (already deleted, or belongs to a
// different store) — the caller reports that as "no longer exists" rather
// than treating it as an unexpected error, mirroring updateEvent/
// updateSponsor.
export async function updateReward(
  id: number,
  input: UpdateRewardInput,
  storeHash: string | undefined,
): Promise<HuntryReward | undefined> {
  if (getDataMode() === "MOCK") {
    return updateMockReward(id, input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return updateRewardInDb(id, input, resolvedStoreHash);
}

async function deleteRewardRow(id: number, storeHash: string): Promise<boolean> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db.prepare("DELETE FROM huntry_rewards WHERE id = ? AND store_hash = ?").run(id, storeHash);

    return result.changes > 0;
  }

  const result = await db.query("DELETE FROM huntry_rewards WHERE id = $1 AND store_hash = $2", [id, storeHash]);

  return (result.rowCount ?? 0) > 0;
}

// A genuine hard delete, per the user's explicit direction (EVMS-style, no
// archive workflow — see types.ts's RewardStatus comment; this diverges from
// docs/MIGRATION.md's documented archive-vs-hard-delete split). Cascades
// huntry_reward_products and huntry_eggs via their existing
// `ON DELETE CASCADE` FKs; never touches huntry_claims (denormalized, no FK,
// by schema design — a reward's past claims stay intact after the reward
// row itself is gone).
//
// TODO(BC-HUN-020/021): once coupon-sync.ts exists and a reward can carry a
// live bcPromotionId, extend this to disable (never delete) that Promotion
// before/after removing the row — mirroring the WP plugin's own documented
// caution against a destructive symmetric delete cascade
// (huntry/docs/decisions/0001-coupon-delete-asymmetry.md: even a permanent
// Reward delete there only unlinks its coupon, never deletes it). No
// coupon-sync module exists yet for this ticket to call into.
export async function deleteReward(id: number, storeHash: string | undefined): Promise<boolean> {
  if (getDataMode() === "MOCK") {
    return deleteMockReward(id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return false;
  }

  return deleteRewardRow(id, resolvedStoreHash);
}

// Backs the discountScope === "specific" product picker (BC-HUN-019).
// Reuses this app's existing getRestApiClient — in MOCK mode that resolves
// to MockRestApiClient, routed to mock/products-list-handler.ts's fixture
// data; no new REST client needed (docs/MIGRATION.md §2's own instruction).
export async function fetchBcProductsForPicker(
  storeHash: string | undefined,
  searchTerm?: string,
): Promise<BcProductSummary[]> {
  const apiClient = await getRestApiClient(storeHash);
  const params: ApiRequestParams = { limit: 50 };

  if (searchTerm) {
    params["name:like"] = searchTerm;
  }

  const { data: body } = await apiClient.get<V3ListResponse<BcProductSummary>>(PRODUCTS_PATH, { params });

  return body.data;
}
