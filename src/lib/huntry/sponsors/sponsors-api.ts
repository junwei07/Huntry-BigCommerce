import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { sponsorTag, SPONSORS_LIST_TAG } from "@/lib/huntry/sponsors/cache-tags";
import {
  addMockSponsor,
  deleteMockSponsor,
  MOCK_SPONSORS,
  updateMockSponsor,
} from "@/lib/huntry/sponsors/mock/mock-sponsors";
import { CreateSponsorInput, HuntrySponsor, SponsorsQuery, SortDirection, UpdateSponsorInput } from "@/lib/huntry/sponsors/types";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

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

async function fetchSponsorsFromDb(query: SponsorsQuery, storeHash: string): Promise<HuntrySponsor[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(SPONSORS_LIST_TAG);
  // @cache-components-only:end

  const db = getHuntryDb();
  const direction = directionSql(query.direction);
  let sponsors: HuntrySponsor[];

  if (db instanceof DatabaseSync) {
    const rows = db
      .prepare(`SELECT * FROM huntry_sponsors WHERE store_hash = ? ORDER BY name ${direction}`)
      .all(storeHash) as unknown as SqliteSponsorRow[];

    sponsors = rows.map(normalizeSqliteRow);
  } else {
    const result = await db.query<PostgresSponsorRow>(
      `SELECT * FROM huntry_sponsors WHERE store_hash = $1 ORDER BY name ${direction}`,
      [storeHash],
    );

    sponsors = result.rows.map(normalizePostgresRow);
  }

  // @cache-components-only:start
  for (const sponsor of sponsors) {
    cacheTag(sponsorTag(sponsor.id));
  }
  // @cache-components-only:end

  return sponsors;
}

async function selectSponsorRow(id: number, storeHash: string): Promise<HuntrySponsor | undefined> {
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

async function fetchSponsorFromDb(id: number, storeHash: string): Promise<HuntrySponsor | undefined> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(sponsorTag(id));
  // @cache-components-only:end

  return selectSponsorRow(id, storeHash);
}

function sortMockSponsors(sponsors: HuntrySponsor[], direction: SortDirection): HuntrySponsor[] {
  return [...sponsors].sort((a, b) => {
    const diff = a.name.localeCompare(b.name);

    return direction === "DESC" ? -diff : diff;
  });
}

// MOCK mode never touches getHuntryDb() — it returns deterministic fixture
// data instead, matching fetchEvents's own MOCK behavior and the app's
// DATA_MODE philosophy.
export async function fetchSponsors(query: SponsorsQuery, storeHash: string | undefined): Promise<HuntrySponsor[]> {
  if (getDataMode() === "MOCK") {
    return sortMockSponsors(MOCK_SPONSORS, query.direction);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return fetchSponsorsFromDb(query, resolvedStoreHash);
}

export async function fetchSponsor(id: number, storeHash: string | undefined): Promise<HuntrySponsor | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_SPONSORS.find((sponsor) => sponsor.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return fetchSponsorFromDb(id, resolvedStoreHash);
}

// Uncached counterpart to fetchSponsor — used by updateHuntrySponsor to
// read the current logoUrl (not an edit-form field — see
// LogoUploadField/sponsor-form-schema.ts) right before writing, the same
// reasoning fetchEventUncached documents: a Server Action about to mutate a
// record should never trust a cached read.
export async function fetchSponsorUncached(id: number, storeHash: string | undefined): Promise<HuntrySponsor | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_SPONSORS.find((sponsor) => sponsor.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return selectSponsorRow(id, resolvedStoreHash);
}

async function insertSponsorRow(input: CreateSponsorInput, storeHash: string): Promise<HuntrySponsor> {
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

// MOCK mode pushes into the in-memory fixture array instead of throwing,
// matching createEvent's precedent — Huntry's own concepts are
// "MOCK-mode testable: Yes" per docs/MIGRATION.md §6.
export async function createSponsor(input: CreateSponsorInput, storeHash: string | undefined): Promise<HuntrySponsor> {
  if (getDataMode() === "MOCK") {
    return addMockSponsor(input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create a sponsor.");
  }

  return insertSponsorRow(input, resolvedStoreHash);
}

async function updateSponsorRow(id: number, input: UpdateSponsorInput, storeHash: string): Promise<HuntrySponsor | undefined> {
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

// Returns undefined if no row matched (already deleted, or belongs to a
// different store) — the caller reports that as "no longer exists" rather
// than treating it as an unexpected error, mirroring updateEvent.
export async function updateSponsor(
  id: number,
  input: UpdateSponsorInput,
  storeHash: string | undefined,
): Promise<HuntrySponsor | undefined> {
  if (getDataMode() === "MOCK") {
    return updateMockSponsor(id, input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return updateSponsorRow(id, input, resolvedStoreHash);
}

async function deleteSponsorRow(id: number, storeHash: string): Promise<boolean> {
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

// A genuine hard delete — huntry_sponsors has no status/archive column.
// Checked both reference apps before deciding this: EVMS models sponsors
// ("Company") with no status field at all (hard Firestore delete); the WP
// plugin's sponsor CPT has no Huntry-specific status logic either — the only
// thing that looks like archiving (huntry_get_sponsors()'s
// `post_status = 'publish'` filter) is generic WordPress trash behavior, not
// a feature Huntry built. Confirmed with the user. Returns whether a row was
// actually deleted, so the caller can distinguish "gone" from "already
// wasn't there."
export async function deleteSponsor(id: number, storeHash: string | undefined): Promise<boolean> {
  if (getDataMode() === "MOCK") {
    return deleteMockSponsor(id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return false;
  }

  return deleteSponsorRow(id, resolvedStoreHash);
}
