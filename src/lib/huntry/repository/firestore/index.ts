import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { createFirestoreClaimsRepository } from "@/lib/huntry/repository/firestore/claims";
import { createFirestoreEggsRepository } from "@/lib/huntry/repository/firestore/eggs";
import { createFirestoreEventsRepository } from "@/lib/huntry/repository/firestore/events";
import { createFirestoreFeaturedRepository } from "@/lib/huntry/repository/firestore/featured";
import { createFirestoreRewardsRepository } from "@/lib/huntry/repository/firestore/rewards";
import { createFirestoreSponsorsRepository } from "@/lib/huntry/repository/firestore/sponsors";
import type { HuntryRepository } from "@/lib/huntry/repository/types";

// Huntry's own data on Firestore: `stores/{storeHash}/{events,sponsors,rewards,
// eggs,claims,customers,counters,settings,slugs,couponCodes}` (see paths.ts and
// docs/FIREBASE-MIGRATION.md, Phase 3). The client resolves lazily on first use.
export function createFirestoreHuntryRepository(getDb: () => Firestore = getFirestoreDb): HuntryRepository {
  return {
    featured: createFirestoreFeaturedRepository(getDb),
    sponsors: createFirestoreSponsorsRepository(getDb),
    eggs: createFirestoreEggsRepository(getDb),
    events: createFirestoreEventsRepository(getDb),
    rewards: createFirestoreRewardsRepository(getDb),
    claims: createFirestoreClaimsRepository(getDb),
  };
}
