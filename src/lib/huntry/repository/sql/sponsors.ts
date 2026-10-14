import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import type { SponsorsRepository } from "@/lib/huntry/repository/types";
import { CreateSponsorInput, HuntrySponsor, SortDirection, UpdateSponsorInput } from "@/lib/huntry/sponsors/types";

// Raw row shape as node-postgres actually returns it: TIMESTAMPTZ columns are
// Date instances, every other column is already the right JS primitive.
interface PostgresSponsorRow {
  id: number;
  store_hash: string;
  name: string;
  logo_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
  location: string | null;
  created_at: Date;
  updated_at: Date;
}

// Raw row shape as node:sqlite actually returns it: no native timestamp type,
// so created_at/updated_at are the TEXT strings the app itself wrote.
interface SqliteSponsorRow {
  id: number;
  store_hash: string;
  name: string;
  logo_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  website_url: string | null;
  location: string | null;
  created_at: string;
  updated_at: string;
}

function normalizePostgresRow(row: PostgresSponsorRow): HuntrySponsor {
  return {
    id: row.id,
    storeHash: row.store_hash,
    name: row.name,
    logoUrl: row.logo_url,
    instagramUrl: row.instagram_url,
    facebookUrl: row.facebook_url,
    websiteUrl: row.website_url,
    location: row.location,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSqliteRow(row: SqliteSponsorRow): HuntrySponsor {
  return {
    id: row.id,
    storeHash: row.store_hash,
    name: row.name,
    logoUrl: row.logo_url,
    instagramUrl: row.instagram_url,
    facebookUrl: row.facebook_url,
    websiteUrl: row.website_url,
    location: row.location,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Coerces to a known SQL keyword rather than interpolating the query's
// direction field directly — defense in depth against ever interpolating an
// unvalidated value into the ORDER BY clause below, mirroring
// events-api.ts's directionSql.
function directionSql(direction: SortDirection): "ASC" | "DESC" {
  return direction === "DESC" ? "DESC" : "ASC";
}

async function selectSponsorRows(storeHash: string, sortDirection: SortDirection): Promise<HuntrySponsor[]> {
  const db = getHuntryDb();
  const direction = directionSql(sortDirection);

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare(`SELECT * FROM huntry_sponsors WHERE store_hash = ? ORDER BY name ${direction}`)
      .all(storeHash) as unknown as SqliteSponsorRow[];

    return rows.map(normalizeSqliteRow);
  }

  const result = await db.query<PostgresSponsorRow>(
    `SELECT * FROM huntry_sponsors WHERE store_hash = $1 ORDER BY name ${direction}`,
    [storeHash],
  );

  return result.rows.map(normalizePostgresRow);
}

async function selectSponsorRow(storeHash: string, id: number): Promise<HuntrySponsor | undefined> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT * FROM huntry_sponsors WHERE id = ? AND store_hash = ?").get(id, storeHash) as
      | SqliteSponsorRow
      | undefined;

    return row ? normalizeSqliteRow(row) : undefined;
  }

  const result = await db.query<PostgresSponsorRow>(
    "SELECT * FROM huntry_sponsors WHERE id = $1 AND store_hash = $2",
    [id, storeHash],
  );
  const row = result.rows[0];

  return row ? normalizePostgresRow(row) : undefined;
}

async function insertSponsorRow(storeHash: string, input: CreateSponsorInput): Promise<HuntrySponsor> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db
      .prepare(
        `INSERT INTO huntry_sponsors
          (store_hash, name, logo_url, instagram_url, facebook_url, website_url, location)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(storeHash, input.name, input.logoUrl, input.instagramUrl, input.facebookUrl, input.websiteUrl, input.location);

    const row = db.prepare("SELECT * FROM huntry_sponsors WHERE id = ?").get(result.lastInsertRowid) as unknown as SqliteSponsorRow;

    return normalizeSqliteRow(row);
  }

  const result = await db.query<PostgresSponsorRow>(
    `INSERT INTO huntry_sponsors
      (store_hash, name, logo_url, instagram_url, facebook_url, website_url, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [storeHash, input.name, input.logoUrl, input.instagramUrl, input.facebookUrl, input.websiteUrl, input.location],
  );

  return normalizePostgresRow(result.rows[0]);
}

async function updateSponsorRow(storeHash: string, id: number, input: UpdateSponsorInput): Promise<HuntrySponsor | undefined> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db
      .prepare(
        `UPDATE huntry_sponsors SET
          name = ?, logo_url = ?, instagram_url = ?, facebook_url = ?, website_url = ?, location = ?,
          updated_at = ?
         WHERE id = ? AND store_hash = ?`,
      )
      .run(
        input.name,
        input.logoUrl,
        input.instagramUrl,
        input.facebookUrl,
        input.websiteUrl,
        input.location,
        new Date().toISOString(),
        id,
        storeHash,
      );

    if (result.changes === 0) {
      return undefined;
    }

    const row = db.prepare("SELECT * FROM huntry_sponsors WHERE id = ?").get(id) as unknown as SqliteSponsorRow;

    return normalizeSqliteRow(row);
  }

  const result = await db.query<PostgresSponsorRow>(
    `UPDATE huntry_sponsors SET
      name = $1, logo_url = $2, instagram_url = $3, facebook_url = $4, website_url = $5, location = $6,
      updated_at = now()
     WHERE id = $7 AND store_hash = $8
     RETURNING *`,
    [input.name, input.logoUrl, input.instagramUrl, input.facebookUrl, input.websiteUrl, input.location, id, storeHash],
  );

  const row = result.rows[0];

  return row ? normalizePostgresRow(row) : undefined;
}

async function deleteSponsorRow(storeHash: string, id: number): Promise<boolean> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    // huntry_rewards.sponsor_id's declared `ON DELETE SET NULL` is inert in
    // SQLite — PRAGMA foreign_keys is never enabled anywhere in this
    // codebase, so node:sqlite never actually enforces it. Null the
    // reference out explicitly so SQLite (dev) behaves the same as Postgres
    // (prod), which enforces its own copy of this FK for real. Currently a
    // no-op in practice (no rewards-api.ts exists yet — BC-HUN-018), but
    // getting this right now avoids a silent SQLite-only bug once it does.
    db.prepare("UPDATE huntry_rewards SET sponsor_id = NULL WHERE sponsor_id = ? AND store_hash = ?").run(
      id,
      storeHash,
    );

    const result = db.prepare("DELETE FROM huntry_sponsors WHERE id = ? AND store_hash = ?").run(id, storeHash);

    return result.changes > 0;
  }

  // Postgres enforces this FK for real, but nulling it out explicitly here
  // too keeps both driver branches symmetric rather than silently relying on
  // the DB's own enforcement in one branch and not the other.
  await db.query("UPDATE huntry_rewards SET sponsor_id = NULL WHERE sponsor_id = $1 AND store_hash = $2", [
    id,
    storeHash,
  ]);

  const result = await db.query("DELETE FROM huntry_sponsors WHERE id = $1 AND store_hash = $2", [id, storeHash]);

  return (result.rowCount ?? 0) > 0;
}

export const sqlSponsorsRepository: SponsorsRepository = {
  list: selectSponsorRows,
  get: selectSponsorRow,
  create: insertSponsorRow,
  update: updateSponsorRow,
  delete: deleteSponsorRow,
};
