import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { addMockEvent, deleteMockEvent, MOCK_EVENTS, updateMockEvent } from "@/lib/huntry/events/mock/mock-events";
import { buildCandidateSlug, slugify } from "@/lib/huntry/events/slug";
import {
  CreateEventInput,
  EventFields,
  EventSort,
  EventsQuery,
  EventStatus,
  HuntryEvent,
  UpdateEventInput,
} from "@/lib/huntry/events/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

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

async function fetchEventsFromDb(query: EventsQuery, storeHash: string): Promise<HuntryEvent[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EVENTS_LIST_TAG);
  // @cache-components-only:end

  const eventFields = await getHuntryRepository().events.list(storeHash, query.sort);

  const events = eventFields.map((fields) => buildHuntryEvent(fields));

  // @cache-components-only:start
  for (const event of events) {
    cacheTag(eventTag(event.id));
  }
  // @cache-components-only:end

  return events;
}

async function getEventFromRepository(storeHash: string, id: number): Promise<HuntryEvent | undefined> {
  const fields = await getHuntryRepository().events.get(storeHash, id);

  return fields ? buildHuntryEvent(fields) : undefined;
}

async function fetchEventFromDb(id: number, storeHash: string): Promise<HuntryEvent | undefined> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(eventTag(id));
  // @cache-components-only:end

  return getEventFromRepository(storeHash, id);
}

// Matches orderBySql's two orderings. "time" is nulls-last — an unscheduled
// event has nothing to compare, so it sorts after every scheduled one.
function sortMockEvents(events: HuntryEvent[], sort: EventSort): HuntryEvent[] {
  return [...events].sort((a, b) => {
    if (sort === "name") {
      return a.name.localeCompare(b.name);
    }

    if (!a.startsAt && !b.startsAt) {
      return a.name.localeCompare(b.name);
    }

    if (!a.startsAt) {
      return 1;
    }

    if (!b.startsAt) {
      return -1;
    }

    return a.startsAt.getTime() - b.startsAt.getTime() || a.name.localeCompare(b.name);
  });
}

// MOCK mode never touches the repository — it returns deterministic fixture
// data instead, matching gift-certificates-api.ts's own MOCK behavior and
// the app's DATA_MODE philosophy ("no real API calls; in-memory mock
// data"), rather than letting a contributor's local SQLite file silently
// accumulate real state across dev sessions.
export async function fetchEvents(query: EventsQuery, storeHash: string | undefined): Promise<HuntryEvent[]> {
  if (getDataMode() === "MOCK") {
    return sortMockEvents(
      MOCK_EVENTS.map((fields) => buildHuntryEvent(fields)),
      query.sort,
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

  return getEventFromRepository(resolvedStoreHash, id);
}

// Uncached on purpose — used by createHuntryEvent to enforce MAX_EVENTS
// right before an insert, which must never trust a cached read.
export async function countEvents(storeHash: string | undefined): Promise<number> {
  if (getDataMode() === "MOCK") {
    return MOCK_EVENTS.length;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return 0;
  }

  return getHuntryRepository().events.count(resolvedStoreHash);
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

async function createEventInDb(input: CreateEventInput, storeHash: string): Promise<HuntryEvent> {
  const baseSlug = slugify(input.name);

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      return buildHuntryEvent(
        await getHuntryRepository().events.create(storeHash, input, buildCandidateSlug(baseSlug, attempt)),
      );
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

  const updated = await getHuntryRepository().events.update(resolvedStoreHash, id, input);

  return updated ? buildHuntryEvent(updated) : undefined;
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

  return getHuntryRepository().events.delete(resolvedStoreHash, id);
}
