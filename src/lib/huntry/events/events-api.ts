import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { addMockEvent, deleteMockEvent, MOCK_EVENTS, updateMockEvent } from "@/lib/huntry/events/mock/mock-events";
import { buildCandidateSlug, slugify } from "@/lib/huntry/events/slug";
import {
  CreateEventInput,
  EventFields,
  EventsQuery,
  EventStatus,
  EventTheme,
  HuntryEvent,
  SortDirection,
  UpdateEventInput,
} from "@/lib/huntry/events/types";

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
    theme: JSON.parse(row.theme) as EventTheme,
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

async function selectEventRow(id: number, storeHash: string): Promise<HuntryEvent | undefined> {
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

async function fetchEventFromDb(id: number, storeHash: string): Promise<HuntryEvent | undefined> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(eventTag(id));
  // @cache-components-only:end

  return selectEventRow(id, storeHash);
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

// Uncached counterpart to fetchEvent — used by updateHuntryEvent to read
// the current headerBannerUrl/isFeatured/featuredOrder (none of which are
// edit-form fields) right before writing, the same reasoning
// gift-certificates-api.ts's fetchGiftCertificateUncached documents: a
// Server Action about to mutate a record should never trust a cached read.
export async function fetchEventUncached(id: number, storeHash: string | undefined): Promise<HuntryEvent | undefined> {
  if (getDataMode() === "MOCK") {
    const fields = MOCK_EVENTS.find((event) => event.id === id);

    return fields ? buildHuntryEvent(fields) : undefined;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return selectEventRow(id, resolvedStoreHash);
}

// True when an error means "the (store_hash, slug) UNIQUE constraint was
// violated," as opposed to any other write failure — Postgres reports this
// via its own SQLSTATE code, node:sqlite via a message substring (it has no
// structured error code for this). No shared cross-driver error helper
// exists yet for this app's own DB (unlike isNotFoundError, which covers
// BigCommerce API errors) — this is a fresh, local design.
export function isUniqueSlugConstraintError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505") {
    return true;
  }

  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

// There's no slug form field — see docs/HUNTRY-UI-REFERENCE.md: the WP
// plugin has none either, deriving post_name from the Title invisibly, with
// WordPress's own post_name uniqueness handling deduping silently behind
// the scenes. This caps how many "-2", "-3", ... suffixes are tried before
// giving up, so a pathological run of collisions can't loop forever.
const MAX_SLUG_ATTEMPTS = 20;

async function insertEventRow(input: CreateEventInput, slug: string, storeHash: string): Promise<HuntryEvent> {
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

    return buildHuntryEvent(normalizeSqliteRow(row));
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

  return buildHuntryEvent(normalizePostgresRow(result.rows[0]));
}

async function createEventInDb(input: CreateEventInput, storeHash: string): Promise<HuntryEvent> {
  const baseSlug = slugify(input.name);

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      return await insertEventRow(input, buildCandidateSlug(baseSlug, attempt), storeHash);
    } catch (error) {
      if (!isUniqueSlugConstraintError(error) || attempt === MAX_SLUG_ATTEMPTS) {
        throw error;
      }
    }
  }

  // Unreachable — the loop above always either returns or throws on its
  // last attempt — but satisfies the function's return type.
  throw new Error("Failed to generate a unique event slug.");
}

// MOCK mode pushes into the in-memory fixture array instead of throwing —
// unlike gift-certs' mutations, which have no MOCK support at all, Huntry's
// own concepts need creation to actually work in MOCK mode (see
// docs/MIGRATION.md §6 Phase 1: "MOCK-mode testable: Yes"). See
// docs/HUNTRY-UI-REFERENCE.md for the full rationale.
export async function createEvent(input: CreateEventInput, storeHash: string | undefined): Promise<HuntryEvent> {
  if (getDataMode() === "MOCK") {
    const baseSlug = slugify(input.name);
    const existingSlugs = new Set(MOCK_EVENTS.map((event) => event.slug));

    let slug: string | undefined;

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      const candidate = buildCandidateSlug(baseSlug, attempt);

      if (!existingSlugs.has(candidate)) {
        slug = candidate;
        break;
      }
    }

    if (!slug) {
      throw new Error("Failed to generate a unique event slug.");
    }

    return buildHuntryEvent(addMockEvent({ ...input, slug }));
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create an event.");
  }

  return createEventInDb(input, resolvedStoreHash);
}

// slug is deliberately excluded from UpdateEventInput's writable set (it's
// an alias of CreateEventInput, which already omits slug) — it never
// changes on edit, since it's an internal identifier, not user-facing
// either way (see docs/HUNTRY-UI-REFERENCE.md).
async function updateEventRow(id: number, input: UpdateEventInput, storeHash: string): Promise<HuntryEvent | undefined> {
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

    return buildHuntryEvent(normalizeSqliteRow(row));
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

  return row ? buildHuntryEvent(normalizePostgresRow(row)) : undefined;
}

// Returns undefined if no row matched (already deleted, or belongs to a
// different store) — the Server Action reports that as "no longer exists"
// rather than treating it as an unexpected error.
export async function updateEvent(
  id: number,
  input: UpdateEventInput,
  storeHash: string | undefined,
): Promise<HuntryEvent | undefined> {
  if (getDataMode() === "MOCK") {
    const updated = updateMockEvent(id, input);

    return updated ? buildHuntryEvent(updated) : undefined;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return updateEventRow(id, input, resolvedStoreHash);
}

async function deleteEventRow(id: number, storeHash: string): Promise<boolean> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const result = db.prepare("DELETE FROM huntry_events WHERE id = ? AND store_hash = ?").run(id, storeHash);

    return result.changes > 0;
  }

  const result = await db.query("DELETE FROM huntry_events WHERE id = $1 AND store_hash = $2", [id, storeHash]);

  return (result.rowCount ?? 0) > 0;
}

// A genuine hard delete — huntry_events has no soft-delete/archive column
// (unlike huntry_rewards' status), per the user's explicit direction. This
// cascades to the event's eggs (ON DELETE CASCADE in the schema), harmless
// today since no eggs exist yet (BC-HUN-024+). Returns whether a row was
// actually deleted, so the caller can distinguish "gone" from "already
// wasn't there."
export async function deleteEvent(id: number, storeHash: string | undefined): Promise<boolean> {
  if (getDataMode() === "MOCK") {
    return deleteMockEvent(id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return false;
  }

  return deleteEventRow(id, resolvedStoreHash);
}
