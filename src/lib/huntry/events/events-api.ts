import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { MOCK_EVENTS } from "@/lib/huntry/events/mock/mock-events";
import { EventFields, EventsQuery, EventStatus, HuntryEvent, SortDirection } from "@/lib/huntry/events/types";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

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
  theme: Record<string, unknown>;
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

// Derived from starts_at/ends_at at read time — huntry_events has no status
// column, exactly like the plugin's huntry_compute_event_status(). now is an
// optional parameter (not an inline `new Date()`) so tests can pass a fixed
// date deterministically.
export function computeEventStatus(startsAt: Date | null, endsAt: Date | null, now: Date = new Date()): EventStatus {
  if (!startsAt) {
    return "not-scheduled";
  }

  if (now < startsAt) {
    return "upcoming";
  }

  if (endsAt && now >= endsAt) {
    return "ended";
  }

  return "live";
}

function buildHuntryEvent(fields: EventFields, now?: Date): HuntryEvent {
  return { ...fields, status: computeEventStatus(fields.startsAt, fields.endsAt, now) };
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
    theme: JSON.parse(row.theme) as Record<string, unknown>,
    isFeatured: row.is_featured === 1,
    featuredOrder: row.featured_order,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// Coerces to a known SQL keyword rather than interpolating the query's
// direction field directly, even though EventsQuery's type already
// restricts it to "ASC" | "DESC" — defense in depth against ever
// interpolating an unvalidated value into the ORDER BY clause below (the
// only place in this file that can't use a parameterized placeholder).
function directionSql(direction: SortDirection): "ASC" | "DESC" {
  return direction === "DESC" ? "DESC" : "ASC";
}

async function fetchEventsFromDb(query: EventsQuery, storeHash: string): Promise<HuntryEvent[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EVENTS_LIST_TAG);
  // @cache-components-only:end

  const db = getHuntryDb();
  const direction = directionSql(query.direction);
  let eventFields: EventFields[];

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare(`SELECT * FROM huntry_events WHERE store_hash = ? ORDER BY starts_at IS NULL, starts_at ${direction}`)
      .all(storeHash) as unknown as SqliteEventRow[];

    eventFields = rows.map(normalizeSqliteRow);
  } else {
    const result = await db.query<PostgresEventRow>(
      `SELECT * FROM huntry_events WHERE store_hash = $1 ORDER BY starts_at IS NULL, starts_at ${direction}`,
      [storeHash],
    );

    eventFields = result.rows.map(normalizePostgresRow);
  }

  const events = eventFields.map((fields) => buildHuntryEvent(fields));

  // @cache-components-only:start
  for (const event of events) {
    cacheTag(eventTag(event.id));
  }
  // @cache-components-only:end

  return events;
}

async function fetchEventFromDb(id: number, storeHash: string): Promise<HuntryEvent | undefined> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(eventTag(id));
  // @cache-components-only:end

  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db.prepare("SELECT * FROM huntry_events WHERE id = ? AND store_hash = ?").get(id, storeHash) as
      | SqliteEventRow
      | undefined;

    return row ? buildHuntryEvent(normalizeSqliteRow(row)) : undefined;
  }

  const result = await db.query<PostgresEventRow>("SELECT * FROM huntry_events WHERE id = $1 AND store_hash = $2", [
    id,
    storeHash,
  ]);
  const row = result.rows[0];

  return row ? buildHuntryEvent(normalizePostgresRow(row)) : undefined;
}

// Nulls-last ordering, matching fetchEventsFromDb's
// "starts_at IS NULL, starts_at <direction>" SQL — an unscheduled event has
// nothing to compare, so it sorts last regardless of direction.
function sortMockEvents(events: HuntryEvent[], direction: SortDirection): HuntryEvent[] {
  return [...events].sort((a, b) => {
    if (!a.startsAt) {
      return 1;
    }

    if (!b.startsAt) {
      return -1;
    }

    const diff = a.startsAt.getTime() - b.startsAt.getTime();

    return direction === "DESC" ? -diff : diff;
  });
}

// MOCK mode never touches getHuntryDb() — it returns deterministic fixture
// data instead, matching gift-certificates-api.ts's own MOCK behavior and
// the app's DATA_MODE philosophy ("no real API calls; in-memory mock
// data"), rather than letting a contributor's local SQLite file silently
// accumulate real state across dev sessions.
export async function fetchEvents(query: EventsQuery, storeHash: string | undefined): Promise<HuntryEvent[]> {
  if (getDataMode() === "MOCK") {
    return sortMockEvents(
      MOCK_EVENTS.map((fields) => buildHuntryEvent(fields)),
      query.direction,
    );
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return fetchEventsFromDb(query, resolvedStoreHash);
}

export async function fetchEvent(id: number, storeHash: string | undefined): Promise<HuntryEvent | undefined> {
  if (getDataMode() === "MOCK") {
    const fields = MOCK_EVENTS.find((event) => event.id === id);

    return fields ? buildHuntryEvent(fields) : undefined;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return fetchEventFromDb(id, resolvedStoreHash);
}
