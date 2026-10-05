import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { eggTag, EGGS_LIST_TAG, eventEggsTag } from "@/lib/huntry/eggs/cache-tags";
import { addMockEggs, deleteMockEgg, MOCK_EGGS, updateMockEgg } from "@/lib/huntry/eggs/mock/mock-eggs";
import { CreateEggInput, HuntryEgg, UpdateEggInput } from "@/lib/huntry/eggs/types";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

// Raw row shape as node-postgres actually returns it: TIMESTAMPTZ columns
// are Date instances, DOUBLE PRECISION comes back as a JS number.
interface PostgresEggRow {
  id: string;
  store_hash: string;
  reward_id: number;
  event_id: number;
  name: string;
  lat: number;
  lng: number;
  created_at: Date;
  updated_at: Date;
}

// Raw row shape as node:sqlite actually returns it: timestamps are the TEXT
// strings SQLite's datetime('now') default wrote.
interface SqliteEggRow {
  id: string;
  store_hash: string;
  reward_id: number;
  event_id: number;
  name: string;
  lat: number;
  lng: number;
  created_at: string;
  updated_at: string;
}

function normalizePostgresRow(row: PostgresEggRow): HuntryEgg {
  return {
    id: row.id,
    storeHash: row.store_hash,
    rewardId: row.reward_id,
    eventId: row.event_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSqliteRow(row: SqliteEggRow): HuntryEgg {
  return {
    id: row.id,
    storeHash: row.store_hash,
    rewardId: row.reward_id,
    eventId: row.event_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

async function selectEggs(eventId: number, storeHash: string): Promise<HuntryEgg[]> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare("SELECT * FROM huntry_eggs WHERE store_hash = ? AND event_id = ? ORDER BY created_at, id")
      .all(storeHash, eventId) as unknown as SqliteEggRow[];

    return rows.map(normalizeSqliteRow);
  }

  const result = await db.query<PostgresEggRow>(
    "SELECT * FROM huntry_eggs WHERE store_hash = $1 AND event_id = $2 ORDER BY created_at, id",
    [storeHash, eventId],
  );

  return result.rows.map(normalizePostgresRow);
}

async function fetchEggsFromDb(eventId: number, storeHash: string): Promise<HuntryEgg[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EGGS_LIST_TAG, eventEggsTag(eventId));
  // @cache-components-only:end

  const eggs = await selectEggs(eventId, storeHash);

  // @cache-components-only:start
  for (const egg of eggs) {
    cacheTag(eggTag(egg.id));
  }
  // @cache-components-only:end

  return eggs;
}

// MOCK mode never touches getHuntryDb() — deterministic fixtures instead,
// matching fetchRewards/fetchEvents's own MOCK behavior.
export async function fetchEggs(eventId: number, storeHash: string | undefined): Promise<HuntryEgg[]> {
  if (getDataMode() === "MOCK") {
    return MOCK_EGGS.filter((egg) => egg.eventId === eventId);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return fetchEggsFromDb(eventId, resolvedStoreHash);
}

async function selectRewardEggCounts(storeHash: string): Promise<Map<number, number>> {
  const db = getHuntryDb();
  let rows: { reward_id: number; egg_count: number | string }[];

  if (db instanceof DatabaseSync) {
    rows = db
      .prepare("SELECT reward_id, COUNT(*) AS egg_count FROM huntry_eggs WHERE store_hash = ? GROUP BY reward_id")
      .all(storeHash) as unknown as typeof rows;
  } else {
    // COUNT(*) is a bigint, which node-postgres returns as a string.
    rows = (
      await db.query<(typeof rows)[number]>(
        "SELECT reward_id, COUNT(*) AS egg_count FROM huntry_eggs WHERE store_hash = $1 GROUP BY reward_id",
        [storeHash],
      )
    ).rows;
  }

  return new Map(rows.map((row) => [row.reward_id, Number(row.egg_count)]));
}

async function fetchRewardEggCountsFromDb(storeHash: string): Promise<Map<number, number>> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EGGS_LIST_TAG);
  // @cache-components-only:end

  return selectRewardEggCounts(storeHash);
}

function mockRewardEggCounts(): Map<number, number> {
  const counts = new Map<number, number>();

  for (const egg of MOCK_EGGS) {
    counts.set(egg.rewardId, (counts.get(egg.rewardId) ?? 0) + 1);
  }

  return counts;
}

// reward id -> how many eggs it has across every event (the quantity
// huntry_rewards.egg_capacity bounds). Backs the picker's "N left" chip.
export async function fetchRewardEggCounts(storeHash: string | undefined): Promise<Map<number, number>> {
  if (getDataMode() === "MOCK") {
    return mockRewardEggCounts();
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  return resolvedStoreHash ? fetchRewardEggCountsFromDb(resolvedStoreHash) : new Map();
}

// Uncached counterpart — what the Server Actions enforce capacity against.
export async function fetchRewardEggCountsUncached(storeHash: string | undefined): Promise<Map<number, number>> {
  if (getDataMode() === "MOCK") {
    return mockRewardEggCounts();
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  return resolvedStoreHash ? selectRewardEggCounts(resolvedStoreHash) : new Map();
}

// Uncached counterpart to fetchEggs — the placement/edit Server Actions
// validate capacity and proximity against this, never a cached read.
export async function fetchEggsUncached(eventId: number, storeHash: string | undefined): Promise<HuntryEgg[]> {
  if (getDataMode() === "MOCK") {
    return MOCK_EGGS.filter((egg) => egg.eventId === eventId);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return selectEggs(eventId, resolvedStoreHash);
}

export async function fetchEggUncached(id: string, storeHash: string | undefined): Promise<HuntryEgg | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_EGGS.find((egg) => egg.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT * FROM huntry_eggs WHERE id = ? AND store_hash = ?").get(id, resolvedStoreHash) as
      | SqliteEggRow
      | undefined;

    return row ? normalizeSqliteRow(row) : undefined;
  }

  const result = await db.query<PostgresEggRow>("SELECT * FROM huntry_eggs WHERE id = $1 AND store_hash = $2", [
    id,
    resolvedStoreHash,
  ]);

  return result.rows[0] ? normalizePostgresRow(result.rows[0]) : undefined;
}

// Inserts every egg in one transaction (the Stop Placing batch commits or
// fails as a unit). ids are app-generated UUIDs — see types.ts.
export async function createEggs(inputs: CreateEggInput[], storeHash: string | undefined): Promise<HuntryEgg[]> {
  if (inputs.length === 0) {
    return [];
  }

  if (getDataMode() === "MOCK") {
    return addMockEggs(inputs);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create eggs.");
  }

  const db = getHuntryDb();
  const ids = inputs.map(() => crypto.randomUUID());

  if (db instanceof DatabaseSync) {
    db.exec("BEGIN");

    try {
      const insert = db.prepare(
        "INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, name, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );

      inputs.forEach((input, index) => {
        insert.run(ids[index], resolvedStoreHash, input.rewardId, input.eventId, input.name, input.lat, input.lng);
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const rows = db
      .prepare(`SELECT * FROM huntry_eggs WHERE id IN (${ids.map(() => "?").join(", ")})`)
      .all(...ids) as unknown as SqliteEggRow[];

    return rows.map(normalizeSqliteRow);
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const created: HuntryEgg[] = [];

    for (const [index, input] of inputs.entries()) {
      const result = await client.query<PostgresEggRow>(
        `INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, name, lat, lng)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [ids[index], resolvedStoreHash, input.rewardId, input.eventId, input.name, input.lat, input.lng],
      );

      created.push(normalizePostgresRow(result.rows[0]));
    }

    await client.query("COMMIT");

    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Updates only reward_id/name/lat/lng + updated_at — id, event_id and
// created_at are never touched, so claims keyed off the id stay linked.
export async function updateEgg(
  id: string,
  input: UpdateEggInput,
  storeHash: string | undefined,
): Promise<HuntryEgg | undefined> {
  if (getDataMode() === "MOCK") {
    return updateMockEgg(id, input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db
      .prepare(
        `UPDATE huntry_eggs SET reward_id = ?, name = ?, lat = ?, lng = ?, updated_at = datetime('now')
         WHERE id = ? AND store_hash = ?`,
      )
      .run(input.rewardId, input.name, input.lat, input.lng, id, resolvedStoreHash);

    if (result.changes === 0) {
      return undefined;
    }

    return normalizeSqliteRow(db.prepare("SELECT * FROM huntry_eggs WHERE id = ?").get(id) as unknown as SqliteEggRow);
  }

  const result = await db.query<PostgresEggRow>(
    `UPDATE huntry_eggs SET reward_id = $1, name = $2, lat = $3, lng = $4, updated_at = now()
     WHERE id = $5 AND store_hash = $6 RETURNING *`,
    [input.rewardId, input.name, input.lat, input.lng, id, resolvedStoreHash],
  );

  return result.rows[0] ? normalizePostgresRow(result.rows[0]) : undefined;
}

// A hard delete — eggs, unlike rewards, have no archive state. Never touches
// huntry_claims (denormalized, no FK, by schema design).
export async function deleteEgg(id: string, storeHash: string | undefined): Promise<boolean> {
  if (getDataMode() === "MOCK") {
    return deleteMockEgg(id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return false;
  }

  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    return db.prepare("DELETE FROM huntry_eggs WHERE id = ? AND store_hash = ?").run(id, resolvedStoreHash).changes > 0;
  }

  const result = await db.query("DELETE FROM huntry_eggs WHERE id = $1 AND store_hash = $2", [id, resolvedStoreHash]);

  return (result.rowCount ?? 0) > 0;
}
