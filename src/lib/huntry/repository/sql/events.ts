import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { CreateEventInput, EventFields, EventSort, EventTheme, UpdateEventInput } from "@/lib/huntry/events/types";
import type { EventsRepository } from "@/lib/huntry/repository/types";

// Raw row shape as node-postgres actually returns it: JSONB is already a
// parsed object, BOOLEAN is a real boolean, TIMESTAMPTZ columns are Date
// instances.
interface PostgresEventRow {
  id: number;
  store_hash: string;
  name: string;
  slug: string;
  description: string;
  starts_at: Date | null;
  ends_at: Date | null;
  header_banner_url: string | null;
  marker_radius_meters: number;
  max_grab_count: number;
  egg_claim_capacity: number;
  theme: EventTheme;
  is_featured: boolean;
  featured_order: number | null;
  created_at: Date;
  updated_at: Date;
}

// Raw row shape as node:sqlite actually returns it: no native
// boolean/timestamp/json type, so is_featured is 0/1, the timestamp columns
// are the TEXT strings datetime('now')/the app itself wrote, and theme is a
// JSON-encoded string.
interface SqliteEventRow {
  id: number;
  store_hash: string;
  name: string;
  slug: string;
  description: string;
  starts_at: string | null;
  ends_at: string | null;
  header_banner_url: string | null;
  marker_radius_meters: number;
  max_grab_count: number;
  egg_claim_capacity: number;
  theme: string;
  is_featured: number;
  featured_order: number | null;
  created_at: string;
  updated_at: string;
}

function normalizePostgresRow(row: PostgresEventRow): EventFields {
  return {
    id: row.id,
    storeHash: row.store_hash,
    name: row.name,
    slug: row.slug,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    headerBannerUrl: row.header_banner_url,
    markerRadiusMeters: row.marker_radius_meters,
    maxGrabCount: row.max_grab_count,
    eggClaimCapacity: row.egg_claim_capacity,
    theme: row.theme,
    isFeatured: row.is_featured,
    featuredOrder: row.featured_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeSqliteRow(row: SqliteEventRow): EventFields {
  return {
    id: row.id,
    storeHash: row.store_hash,
    name: row.name,
    slug: row.slug,
    description: row.description,
    startsAt: row.starts_at ? new Date(row.starts_at) : null,
    endsAt: row.ends_at ? new Date(row.ends_at) : null,
    headerBannerUrl: row.header_banner_url,
    markerRadiusMeters: row.marker_radius_meters,
    maxGrabCount: row.max_grab_count,
    eggClaimCapacity: row.egg_claim_capacity,
    theme: JSON.parse(row.theme) as EventTheme,
    isFeatured: row.is_featured === 1,
    featuredOrder: row.featured_order,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Maps the query's sort field to a fixed ORDER BY fragment rather than
// interpolating it directly, even though EventsQuery's type already
// restricts it to "name" | "time" — defense in depth against ever
// interpolating an unvalidated value into the ORDER BY clause below (the
// only place in this file that can't use a parameterized placeholder).
function orderBySql(sort: EventSort): string {
  return sort === "name" ? "name ASC" : "starts_at IS NULL, starts_at ASC, name ASC";
}

async function selectEventRows(storeHash: string, sort: EventSort): Promise<EventFields[]> {
  const db = getHuntryDb();
  const orderBy = orderBySql(sort);

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare(`SELECT * FROM huntry_events WHERE store_hash = ? ORDER BY ${orderBy}`)
      .all(storeHash) as unknown as SqliteEventRow[];

    return rows.map(normalizeSqliteRow);
  }

  const result = await db.query<PostgresEventRow>(
    `SELECT * FROM huntry_events WHERE store_hash = $1 ORDER BY ${orderBy}`,
    [storeHash],
  );

  return result.rows.map(normalizePostgresRow);
}

async function selectEventRow(storeHash: string, id: number): Promise<EventFields | undefined> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT * FROM huntry_events WHERE id = ? AND store_hash = ?").get(id, storeHash) as
      | SqliteEventRow
      | undefined;

    return row ? normalizeSqliteRow(row) : undefined;
  }

  const result = await db.query<PostgresEventRow>("SELECT * FROM huntry_events WHERE id = $1 AND store_hash = $2", [
    id,
    storeHash,
  ]);
  const row = result.rows[0];

  return row ? normalizePostgresRow(row) : undefined;
}

async function selectEventCount(storeHash: string): Promise<number> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT COUNT(*) AS count FROM huntry_events WHERE store_hash = ?").get(storeHash) as unknown as {
      count: number;
    };

    return Number(row.count);
  }

  const result = await db.query<{ count: string }>("SELECT COUNT(*) AS count FROM huntry_events WHERE store_hash = $1", [
    storeHash,
  ]);

  return Number(result.rows[0]?.count ?? 0);
}

// Throws the driver's raw unique-violation error when (store_hash, slug) is
// taken; the caller (events-api.ts createEventInDb) retries with a new slug
// and the Server Action maps the final failure via isUniqueSlugConstraintError.
async function insertEventRow(storeHash: string, input: CreateEventInput, slug: string): Promise<EventFields> {
  const db = getHuntryDb();
  const themeJson = JSON.stringify(input.theme);

  if (db instanceof DatabaseSync) {
    const result = db
      .prepare(
        `INSERT INTO huntry_events
          (store_hash, name, slug, description, starts_at, ends_at, header_banner_url,
           marker_radius_meters, max_grab_count, egg_claim_capacity, theme, is_featured, featured_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        storeHash,
        input.name,
        slug,
        input.description,
        input.startsAt ? input.startsAt.toISOString() : null,
        input.endsAt ? input.endsAt.toISOString() : null,
        input.headerBannerUrl,
        input.markerRadiusMeters,
        input.maxGrabCount,
        input.eggClaimCapacity,
        themeJson,
        input.isFeatured ? 1 : 0,
        input.featuredOrder,
      );

    const row = db.prepare("SELECT * FROM huntry_events WHERE id = ?").get(result.lastInsertRowid) as unknown as SqliteEventRow;

    return normalizeSqliteRow(row);
  }

  const result = await db.query<PostgresEventRow>(
    `INSERT INTO huntry_events
      (store_hash, name, slug, description, starts_at, ends_at, header_banner_url,
       marker_radius_meters, max_grab_count, egg_claim_capacity, theme, is_featured, featured_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      storeHash,
      input.name,
      slug,
      input.description,
      input.startsAt,
      input.endsAt,
      input.headerBannerUrl,
      input.markerRadiusMeters,
      input.maxGrabCount,
      input.eggClaimCapacity,
      themeJson,
      input.isFeatured,
      input.featuredOrder,
    ],
  );

  return normalizePostgresRow(result.rows[0]);
}

// slug is deliberately excluded from UpdateEventInput's writable set (it's
// an alias of CreateEventInput, which already omits slug) — it never
// changes on edit, since it's an internal identifier, not user-facing
// either way (see docs/HUNTRY-UI-REFERENCE.md).
async function updateEventRow(storeHash: string, id: number, input: UpdateEventInput): Promise<EventFields | undefined> {
  const db = getHuntryDb();
  const themeJson = JSON.stringify(input.theme);

  if (db instanceof DatabaseSync) {
    const result = db
      .prepare(
        `UPDATE huntry_events SET
          name = ?, description = ?, starts_at = ?, ends_at = ?, header_banner_url = ?,
          marker_radius_meters = ?, max_grab_count = ?, egg_claim_capacity = ?, theme = ?,
          is_featured = ?, featured_order = ?, updated_at = ?
         WHERE id = ? AND store_hash = ?`,
      )
      .run(
        input.name,
        input.description,
        input.startsAt ? input.startsAt.toISOString() : null,
        input.endsAt ? input.endsAt.toISOString() : null,
        input.headerBannerUrl,
        input.markerRadiusMeters,
        input.maxGrabCount,
        input.eggClaimCapacity,
        themeJson,
        input.isFeatured ? 1 : 0,
        input.featuredOrder,
        new Date().toISOString(),
        id,
        storeHash,
      );

    if (result.changes === 0) {
      return undefined;
    }

    const row = db.prepare("SELECT * FROM huntry_events WHERE id = ?").get(id) as unknown as SqliteEventRow;

    return normalizeSqliteRow(row);
  }

  const result = await db.query<PostgresEventRow>(
    `UPDATE huntry_events SET
      name = $1, description = $2, starts_at = $3, ends_at = $4, header_banner_url = $5,
      marker_radius_meters = $6, max_grab_count = $7, egg_claim_capacity = $8, theme = $9,
      is_featured = $10, featured_order = $11, updated_at = now()
     WHERE id = $12 AND store_hash = $13
     RETURNING *`,
    [
      input.name,
      input.description,
      input.startsAt,
      input.endsAt,
      input.headerBannerUrl,
      input.markerRadiusMeters,
      input.maxGrabCount,
      input.eggClaimCapacity,
      themeJson,
      input.isFeatured,
      input.featuredOrder,
      id,
      storeHash,
    ],
  );

  const row = result.rows[0];

  return row ? normalizePostgresRow(row) : undefined;
}

// A genuine hard delete — huntry_events has no soft-delete/archive column.
// Cascades to the event's eggs (ON DELETE CASCADE in the schema).
async function deleteEventRow(storeHash: string, id: number): Promise<boolean> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db.prepare("DELETE FROM huntry_events WHERE id = ? AND store_hash = ?").run(id, storeHash);

    return result.changes > 0;
  }

  const result = await db.query("DELETE FROM huntry_events WHERE id = $1 AND store_hash = $2", [id, storeHash]);

  return (result.rowCount ?? 0) > 0;
}

export const sqlEventsRepository: EventsRepository = {
  list: selectEventRows,
  get: selectEventRow,
  count: selectEventCount,
  create: insertEventRow,
  update: updateEventRow,
  delete: deleteEventRow,
};
