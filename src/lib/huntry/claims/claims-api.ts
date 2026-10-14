import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { addMockForcedClaim, MOCK_CLAIMS } from "@/lib/huntry/claims/mock/mock-claims";
import {
  CreateForcedClaimInput,
  CreateForcedClaimResult,
  EggClaimCount,
  HuntryClaim,
} from "@/lib/huntry/claims/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

// BC-HUN-029: the admin override. Inserts directly with is_forced = true and
// deliberately runs none of the player-claim checks (live status, geofence,
// capacity, per-player limit) — those live in BC-HUN-032's claim transaction.
// The leaderboard's `WHERE is_forced = FALSE` belongs to BC-HUN-039's query,
// not this insert. The (egg_id, bc_customer_id) UNIQUE constraint still
// applies, surfaced as "duplicate".
export async function createForcedClaim(
  input: CreateForcedClaimInput,
  storeHash: string | undefined,
): Promise<CreateForcedClaimResult> {
  if (getDataMode() === "MOCK") {
    return addMockForcedClaim(input);
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("A store hash is required to create a claim.");
  }

  return getHuntryRepository().claims.createForcedClaim(resolvedStoreHash, input);
}

// Ids of this event's eggs that have reached `capacity` claims — the public
// map's "fully claimed" marker state (BC-HUN-031). Forced claims count, since
// they count toward capacity (docs/MIGRATION.md §7). Not cached: it changes on
// every claim; the map-data route's short s-maxage bounds the query rate.
export async function fetchFullEggIds(
  eventId: number,
  capacity: number,
  storeHash: string | undefined,
): Promise<Set<string>> {
  if (getDataMode() === "MOCK") {
    const counts = new Map<string, number>();

    for (const claim of MOCK_CLAIMS.filter((item) => item.eventId === eventId)) {
      counts.set(claim.eggId, (counts.get(claim.eggId) ?? 0) + 1);
    }

    return new Set([...counts].filter(([, count]) => count >= capacity).map(([eggId]) => eggId));
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return new Set();
  }

  return getHuntryRepository().claims.listFullEggIds(resolvedStoreHash, eventId, capacity);
}

// BC-HUN-046: every claim a customer holds in this store, newest first, for the
// storefront's "My rewards" page. Rows are scoped by store and customer, so one
// shopper can never see another's codes.
export async function listClaimsForCustomer(
  storeHash: string | undefined,
  bcCustomerId: number,
): Promise<HuntryClaim[]> {
  if (getDataMode() === "MOCK") {
    return MOCK_CLAIMS.filter((claim) => claim.bcCustomerId === bcCustomerId).sort(
      (a, b) => b.claimedAt.getTime() - a.claimedAt.getTime(),
    );
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return [];
  }

  return getHuntryRepository().claims.listClaimsForCustomer(resolvedStoreHash, bcCustomerId);
}

// Per-egg claim counts for one event, for the admin Map tab's egg panel and
// hover popup. Keyed by egg id (huntry_claims.egg_id = huntry_eggs.id); eggs
// with no claims are absent.
export async function fetchEggClaimCounts(
  eventId: number,
  storeHash: string | undefined,
): Promise<Map<string, EggClaimCount>> {
  const counts = new Map<string, EggClaimCount>();

  if (getDataMode() === "MOCK") {
    for (const claim of MOCK_CLAIMS.filter((item) => item.eventId === eventId)) {
      const current = counts.get(claim.eggId) ?? { count: 0, forced: 0 };

      counts.set(claim.eggId, { count: current.count + 1, forced: current.forced + (claim.isForced ? 1 : 0) });
    }

    return counts;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return counts;
  }

  return getHuntryRepository().claims.getEggClaimCounts(resolvedStoreHash, eventId);
}
