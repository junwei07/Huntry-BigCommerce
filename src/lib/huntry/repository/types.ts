import type { ClaimContext, ClaimEvaluation } from "@/lib/huntry/claims/player-claim";
import type { RedemptionCandidate, RedemptionUpdate } from "@/lib/huntry/claims/redemption";
import type {
  CreateForcedClaimInput,
  CreateForcedClaimResult,
  CreatePlayerClaimInput,
  CreatePlayerClaimResult,
  EggClaimCount,
  HuntryClaim,
  LeaderboardEntry,
} from "@/lib/huntry/claims/types";
import type { CreateEggInput, HuntryEgg, PlacedEggClaimCapacity, UpdateEggInput } from "@/lib/huntry/eggs/types";
import type { CreateEventInput, EventFields, EventSort, UpdateEventInput } from "@/lib/huntry/events/types";
import type {
  CreateRewardInput,
  HuntryReward,
  RewardCouponFields,
  RewardSort,
  UpdateRewardInput,
} from "@/lib/huntry/rewards/types";
import type { StorefrontSettings } from "@/lib/huntry/featured/types";
import type { CreateSponsorInput, HuntrySponsor, SortDirection, UpdateSponsorInput } from "@/lib/huntry/sponsors/types";

// The storage seam for Huntry's own data. Each `*-api.ts` module stays the
// public facade (MOCK mode, cache directives, mapping to public types); these
// interfaces are only the uncached, store-scoped primitives behind it, so the
// SQL implementation (repository/sql/) and a Firestore one can be swapped by
// CREDENTIALS_STORE_DRIVER. Every method takes an already-resolved storeHash.

export interface FeaturedRepository {
  // Defaults when the store has no saved row.
  getStorefrontSettings(storeHash: string): Promise<StorefrontSettings>;
  saveStorefrontSettings(storeHash: string, settings: StorefrontSettings): Promise<void>;
}

export interface SponsorsRepository {
  list(storeHash: string, direction: SortDirection): Promise<HuntrySponsor[]>;
  get(storeHash: string, id: number): Promise<HuntrySponsor | undefined>;
  create(storeHash: string, input: CreateSponsorInput): Promise<HuntrySponsor>;
  // undefined when no row matched (gone, or another store's).
  update(storeHash: string, id: number, input: UpdateSponsorInput): Promise<HuntrySponsor | undefined>;
  // Also detaches the sponsor from its rewards. Whether a row was deleted.
  delete(storeHash: string, id: number): Promise<boolean>;
}

export interface EggsRepository {
  // Oldest first.
  listByEvent(storeHash: string, eventId: number): Promise<HuntryEgg[]>;
  // reward id -> how many eggs it has across every event.
  countsByReward(storeHash: string): Promise<Map<number, number>>;
  get(storeHash: string, id: string): Promise<HuntryEgg | undefined>;
  // Every egg placed for a reward, as its parent event's claim capacity.
  listPlacedCapacities(storeHash: string, rewardId: number): Promise<PlacedEggClaimCapacity[]>;
  // The distinct rewards with at least one egg in the event.
  listRewardIdsForEvent(storeHash: string, eventId: number): Promise<number[]>;
  // One atomic batch; ids are generated here. `inputs` is non-empty.
  createMany(storeHash: string, inputs: CreateEggInput[]): Promise<HuntryEgg[]>;
  // undefined when no row matched.
  update(storeHash: string, id: string, input: UpdateEggInput): Promise<HuntryEgg | undefined>;
  delete(storeHash: string, id: string): Promise<boolean>;
}

// Events come back as stored fields; the facade derives `status` from the
// schedule at read time.
export interface EventsRepository {
  list(storeHash: string, sort: EventSort): Promise<EventFields[]>;
  get(storeHash: string, id: number): Promise<EventFields | undefined>;
  count(storeHash: string): Promise<number>;
  // Throws the backend's raw unique-violation error when (store, slug) is
  // taken: events-api.ts retries with the next candidate slug, and the Server
  // Action maps the final failure through isUniqueSlugConstraintError.
  create(storeHash: string, input: CreateEventInput, slug: string): Promise<EventFields>;
  // undefined when no row matched.
  update(storeHash: string, id: number, input: UpdateEventInput): Promise<EventFields | undefined>;
  delete(storeHash: string, id: number): Promise<boolean>;
}

export interface RewardsRepository {
  // Each reward comes back with its `productIds` (empty unless the scope is
  // "specific").
  list(storeHash: string, sort: RewardSort): Promise<HuntryReward[]>;
  get(storeHash: string, id: number): Promise<HuntryReward | undefined>;
  count(storeHash: string): Promise<number>;
  // Whether another reward in the store already uses the code.
  isCouponCodeTaken(storeHash: string, couponCode: string, excludeId?: number): Promise<boolean>;
  // Atomic with the reward's product ids. Throws the backend's raw
  // unique-violation error when (store, couponCode) is taken: the Server Action
  // maps it through isUniqueCouponCodeConstraintError (rewards-api.ts).
  create(storeHash: string, input: CreateRewardInput): Promise<HuntryReward>;
  // undefined when no row matched.
  update(storeHash: string, id: number, input: UpdateRewardInput): Promise<HuntryReward | undefined>;
  // The sole writer of the BigCommerce promotion/coupon/group id columns.
  updateCouponFields(storeHash: string, id: number, fields: RewardCouponFields): Promise<void>;
  delete(storeHash: string, id: number): Promise<boolean>;
}

export interface GameActivityRepository {
  // Newest first, forced claims included.
  listRecentClaims(storeHash: string, eventId: number, limit: number): Promise<HuntryClaim[]>;
}

export interface LeaderboardRepository {
  // Excludes forced claims; ties go to the earliest last claim.
  getLeaderboard(storeHash: string, eventId: number, limit: number): Promise<LeaderboardEntry[]>;
  // Distinct customers with a non-forced claim in the event: the full ranking
  // size, which `getLeaderboard`'s limit hides.
  countPlayers(storeHash: string, eventId: number): Promise<number>;
}

export interface ClaimRateLimitRepository {
  // Whether this customer already holds a claim on this egg.
  hasClaimedEgg(storeHash: string, eggId: string, customerId: number): Promise<boolean>;
  // Seconds since each of the customer's non-forced claims inside the window,
  // newest first, at most `maxClaims` of them. Ages are measured by the
  // database clock in the SQL implementations; Firestore has no server-side
  // clock arithmetic, so it uses the app clock, which also stamps claimedAt.
  listRecentClaimAges(storeHash: string, customerId: number, windowSeconds: number, maxClaims: number): Promise<number[]>;
}

export interface RedemptionRepository {
  // `normalizedCodes` are trimmed + uppercased and non-empty; matching is
  // case-insensitive against the stored code, scoped to the store.
  findClaimsByNormalizedCouponCodes(storeHash: string, normalizedCodes: string[]): Promise<RedemptionCandidate[]>;
  // Compare-and-set: only a claim still `unredeemed` is written. Returns how
  // many claims actually changed.
  markRedemptions(storeHash: string, orderId: number, updates: RedemptionUpdate[]): Promise<number>;
}

export interface ClaimRecordsRepository {
  createForcedClaim(storeHash: string, input: CreateForcedClaimInput): Promise<CreateForcedClaimResult>;
  // Ids of the event's eggs that have reached `capacity` claims (forced included).
  listFullEggIds(storeHash: string, eventId: number, capacity: number): Promise<Set<string>>;
  // Newest first.
  listClaimsForCustomer(storeHash: string, bcCustomerId: number): Promise<HuntryClaim[]>;
  // Keyed by egg id; eggs with no claims are absent.
  getEggClaimCounts(storeHash: string, eventId: number): Promise<Map<string, EggClaimCount>>;
}

// What the player-claim transaction needs from the facade, which owns every
// decision and the external call: the repository only orders them relative to
// its own locking/transaction boundaries.
export interface PlayerClaimHooks {
  // Pure rules (evaluateClaim) over the context the repository loaded.
  evaluate(context: ClaimContext): ClaimEvaluation;
  // Issues the per-claim coupon code. Resolves undefined (never throws) when
  // issuing fails or times out, which the repository reports as
  // `code_issue_failed` after releasing everything it holds.
  issueCode(reward: ClaimContext["reward"]): Promise<string | undefined>;
}

export interface PlayerClaimRepository {
  // The atomic, capacity-validated claim: serialises per customer/reward/egg,
  // loads the context, calls hooks.evaluate, then hooks.issueCode, then writes
  // the claim. Maps a lock timeout to `lock_timeout`.
  createPlayerClaim(
    storeHash: string,
    input: CreatePlayerClaimInput,
    hooks: PlayerClaimHooks,
  ): Promise<CreatePlayerClaimResult>;
}

// Everything that reads or writes claims. Composed from per-concern parts so
// each implementation file stays small.
export interface ClaimsRepository
  extends GameActivityRepository,
    LeaderboardRepository,
    ClaimRateLimitRepository,
    RedemptionRepository,
    ClaimRecordsRepository,
    PlayerClaimRepository {}

export interface HuntryRepository {
  featured: FeaturedRepository;
  sponsors: SponsorsRepository;
  eggs: EggsRepository;
  events: EventsRepository;
  rewards: RewardsRepository;
  claims: ClaimsRepository;
}
