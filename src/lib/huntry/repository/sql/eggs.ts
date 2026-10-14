import { DatabaseSync } from "node:sqlite";
import { CreateEggInput, HuntryEgg, PlacedEggClaimCapacity, UpdateEggInput } from "@/lib/huntry/eggs/types";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { EggsRepository } from "@/lib/huntry/repository/types";

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

async function selectEggs(storeHash: string, eventId: number): Promise<HuntryEgg[]> {
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

async function selectEgg(storeHash: string, id: string): Promise<HuntryEgg | undefined> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT * FROM huntry_eggs WHERE id = ? AND store_hash = ?").get(id, storeHash) as
      | SqliteEggRow
      | undefined;

    return row ? normalizeSqliteRow(row) : undefined;
  }

  const result = await db.query<PostgresEggRow>("SELECT * FROM huntry_eggs WHERE id = $1 AND store_hash = $2", [
    id,
    storeHash,
  ]);

  return result.rows[0] ? normalizePostgresRow(result.rows[0]) : undefined;
}

async function selectPlacedEggCapacities(storeHash: string, rewardId: number): Promise<PlacedEggClaimCapacity[]> {
  const db = getHuntryDb();
  let rows: { egg_claim_capacity: number | null }[];

  if (db instanceof DatabaseSync) {
    rows = db
      .prepare(
        `SELECT e.egg_claim_capacity FROM huntry_eggs g
         LEFT JOIN huntry_events e ON e.id = g.event_id AND e.store_hash = g.store_hash
         WHERE g.reward_id = ? AND g.store_hash = ?`,
      )
      .all(rewardId, storeHash) as unknown as typeof rows;
  } else {
    rows = (
      await db.query<(typeof rows)[number]>(
        `SELECT e.egg_claim_capacity FROM huntry_eggs g
         LEFT JOIN huntry_events e ON e.id = g.event_id AND e.store_hash = g.store_hash
         WHERE g.reward_id = $1 AND g.store_hash = $2`,
        [rewardId, storeHash],
      )
    ).rows;
  }

  return rows.map((row) => ({ eventClaimCapacity: row.egg_claim_capacity }));
}

async function selectRewardIdsForEvent(storeHash: string, eventId: number): Promise<number[]> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare("SELECT DISTINCT reward_id FROM huntry_eggs WHERE event_id = ? AND store_hash = ?")
      .all(eventId, storeHash) as unknown as { reward_id: number }[];

    return rows.map((row) => row.reward_id);
  }

  const result = await db.query<{ reward_id: number }>(
    "SELECT DISTINCT reward_id FROM huntry_eggs WHERE event_id = $1 AND store_hash = $2",
    [eventId, storeHash],
  );

  return result.rows.map((row) => row.reward_id);
}

// Inserts every egg in one transaction (the Stop Placing batch commits or
// fails as a unit). ids are app-generated UUIDs — see eggs/types.ts.
async function insertEggs(storeHash: string, inputs: CreateEggInput[]): Promise<HuntryEgg[]> {
  const db = getHuntryDb();
  const ids = inputs.map(() => crypto.randomUUID());

  if (db instanceof DatabaseSync) {
    db.exec("BEGIN");

    try {
      const insert = db.prepare(
        "INSERT INTO huntry_eggs (id, store_hash, reward_id, event_id, name, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );

      inputs.forEach((input, index) => {
        insert.run(ids[index], storeHash, input.rewardId, input.eventId, input.name, input.lat, input.lng);
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
        [ids[index], storeHash, input.rewardId, input.eventId, input.name, input.lat, input.lng],
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
async function updateEggRow(storeHash: string, id: string, input: UpdateEggInput): Promise<HuntryEgg | undefined> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db
      .prepare(
        `UPDATE huntry_eggs SET reward_id = ?, name = ?, lat = ?, lng = ?, updated_at = datetime('now')
         WHERE id = ? AND store_hash = ?`,
      )
      .run(input.rewardId, input.name, input.lat, input.lng, id, storeHash);

    if (result.changes === 0) {
      return undefined;
    }

    return normalizeSqliteRow(db.prepare("SELECT * FROM huntry_eggs WHERE id = ?").get(id) as unknown as SqliteEggRow);
  }

  const result = await db.query<PostgresEggRow>(
    `UPDATE huntry_eggs SET reward_id = $1, name = $2, lat = $3, lng = $4, updated_at = now()
     WHERE id = $5 AND store_hash = $6 RETURNING *`,
    [input.rewardId, input.name, input.lat, input.lng, id, storeHash],
  );

  return result.rows[0] ? normalizePostgresRow(result.rows[0]) : undefined;
}

// A hard delete — eggs, unlike rewards, have no archive state. Never touches
// huntry_claims (denormalized, no FK, by schema design).
async function deleteEggRow(storeHash: string, id: string): Promise<boolean> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    return db.prepare("DELETE FROM huntry_eggs WHERE id = ? AND store_hash = ?").run(id, storeHash).changes > 0;
  }

  const result = await db.query("DELETE FROM huntry_eggs WHERE id = $1 AND store_hash = $2", [id, storeHash]);

  return (result.rowCount ?? 0) > 0;
}

export const sqlEggsRepository: EggsRepository = {
  listByEvent: selectEggs,
  countsByReward: selectRewardEggCounts,
  get: selectEgg,
  listPlacedCapacities: selectPlacedEggCapacities,
  listRewardIdsForEvent: selectRewardIdsForEvent,
  createMany: insertEggs,
  update: updateEggRow,
  delete: deleteEggRow,
};
