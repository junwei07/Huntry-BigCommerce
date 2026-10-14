import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { eggTag, EGGS_LIST_TAG, eventEggsTag } from "@/lib/huntry/eggs/cache-tags";
import { addMockEggs, deleteMockEgg, MOCK_EGGS, updateMockEgg } from "@/lib/huntry/eggs/mock/mock-eggs";
import { CreateEggInput, HuntryEgg, PlacedEggClaimCapacity, UpdateEggInput } from "@/lib/huntry/eggs/types";
import { MOCK_EVENTS } from "@/lib/huntry/events/mock/mock-events";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

async function fetchEggsFromDb(eventId: number, storeHash: string): Promise<HuntryEgg[]> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EGGS_LIST_TAG, eventEggsTag(eventId));
  // @cache-components-only:end

  const eggs = await getHuntryRepository().eggs.listByEvent(storeHash, eventId);

  // @cache-components-only:start
  for (const egg of eggs) {
    cacheTag(eggTag(egg.id));
  }
  // @cache-components-only:end

  return eggs;
}

// MOCK mode never touches the repository — deterministic fixtures instead,
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

async function fetchRewardEggCountsFromDb(storeHash: string): Promise<Map<number, number>> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(EGGS_LIST_TAG);
  // @cache-components-only:end

  return getHuntryRepository().eggs.countsByReward(storeHash);
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

  return resolvedStoreHash ? getHuntryRepository().eggs.countsByReward(resolvedStoreHash) : new Map();
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

  return getHuntryRepository().eggs.listByEvent(resolvedStoreHash, eventId);
}

export async function fetchEggUncached(id: string, storeHash: string | undefined): Promise<HuntryEgg | undefined> {
  if (getDataMode() === "MOCK") {
    return MOCK_EGGS.find((egg) => egg.id === id);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return undefined;
  }

  return getHuntryRepository().eggs.get(resolvedStoreHash, id);
}

// BC-HUN-028: every egg currently placed for a reward, as the claim capacity
// of its parent event — the input computeRewardUsageLimit sums. Uncached,
// since it feeds a write to BigCommerce.
export async function fetchPlacedEggCapacitiesUncached(
  rewardId: number,
  storeHash: string | undefined,
): Promise<PlacedEggClaimCapacity[]> {
  if (getDataMode() === "MOCK") {
    return MOCK_EGGS.filter((egg) => egg.rewardId === rewardId).map((egg) => ({
      eventClaimCapacity: MOCK_EVENTS.find((event) => event.id === egg.eventId)?.eggClaimCapacity ?? null,
    }));
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return getHuntryRepository().eggs.listPlacedCapacities(resolvedStoreHash, rewardId);
}

// BC-HUN-028: the distinct rewards with at least one egg in an event — the
// fan-out set when the event's claim capacity changes or the event is deleted.
export async function fetchRewardIdsForEventUncached(
  eventId: number,
  storeHash: string | undefined,
): Promise<number[]> {
  if (getDataMode() === "MOCK") {
    return [...new Set(MOCK_EGGS.filter((egg) => egg.eventId === eventId).map((egg) => egg.rewardId))];
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return getHuntryRepository().eggs.listRewardIdsForEvent(resolvedStoreHash, eventId);
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

  return getHuntryRepository().eggs.createMany(resolvedStoreHash, inputs);
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

  return getHuntryRepository().eggs.update(resolvedStoreHash, id, input);
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

  return getHuntryRepository().eggs.delete(resolvedStoreHash, id);
}
