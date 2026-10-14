import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";
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

async function fetchSponsorsFromDb(query: SponsorsQuery, storeHash: string): Promise<HuntrySponsor[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(SPONSORS_LIST_TAG);
  // @cache-components-only:end

  const sponsors = await getHuntryRepository().sponsors.list(storeHash, query.direction);

  // @cache-components-only:start
  for (const sponsor of sponsors) {
    cacheTag(sponsorTag(sponsor.id));
  }
  // @cache-components-only:end

  return sponsors;
}

async function fetchSponsorFromDb(id: number, storeHash: string): Promise<HuntrySponsor | undefined> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(sponsorTag(id));
  // @cache-components-only:end

  return getHuntryRepository().sponsors.get(storeHash, id);
}

function sortMockSponsors(sponsors: HuntrySponsor[], direction: SortDirection): HuntrySponsor[] {
  return [...sponsors].sort((a, b) => {
    const diff = a.name.localeCompare(b.name);

    return direction === "DESC" ? -diff : diff;
  });
}

// MOCK mode never touches the repository — it returns deterministic fixture
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

  return getHuntryRepository().sponsors.get(resolvedStoreHash, id);
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

  return getHuntryRepository().sponsors.create(resolvedStoreHash, input);
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

  return getHuntryRepository().sponsors.update(resolvedStoreHash, id, input);
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

  return getHuntryRepository().sponsors.delete(resolvedStoreHash, id);
}
