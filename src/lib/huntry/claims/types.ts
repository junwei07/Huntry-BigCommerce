// Mirrors the huntry_claims.redemption_status CHECK constraint. Written only by
// the order webhook (BC-HUN-041, claims/redemption.ts).
export const REDEMPTION_STATUSES = ["unredeemed", "redeemed", "flagged_unauthorized_use"] as const;

export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

// Opaque claim identifier: a number from the SQL implementations, a string
// doc id from Firestore. Consumers may only compare it or pass it back, never
// do arithmetic on it. Tighten to `string` once the SQL path is retired.
export type ClaimId = number | string;

// A claim is deliberately denormalized (no FKs to egg/reward/event — see
// 0001_huntry_schema.sql), so reward name/coupon are snapshots.
export interface HuntryClaim {
  id: ClaimId;
  storeHash: string;
  eggId: string;
  rewardId: number;
  eventId: number;
  rewardNameSnapshot: string;
  bcCustomerId: number;
  couponCode: string;
  claimedAt: Date;
  isForced: boolean;
  forcedByUserId: number | null;
  // The BigCommerce order the code was used on; null until the webhook sees it.
  orderId: number | null;
  redemptionStatus: RedemptionStatus;
}

export interface CreateForcedClaimInput {
  eggId: string;
  rewardId: number;
  eventId: number;
  rewardNameSnapshot: string;
  bcCustomerId: number;
  couponCode: string;
  // The acting admin's user id; null where there is no session (MOCK/STATIC).
  forcedByUserId: number | null;
}

export type CreateForcedClaimResult =
  | { status: "created"; claim: HuntryClaim }
  | { status: "duplicate" };

// BC-HUN-032: a player's own claim. Only the egg id and the claimed position
// come from the request; event/reward are read off the locked egg row.
export interface CreatePlayerClaimInput {
  eggId: string;
  bcCustomerId: number;
  lat: number;
  lng: number;
}

// Every way a player claim can be refused, in the order the checks run.
export type PlayerClaimRejection =
  | "egg_not_found"
  | "event_not_live"
  | "reward_unavailable"
  | "too_far"
  | "capacity_full"
  | "limit_reached"
  | "cooldown"
  | "too_fast";

export type CreatePlayerClaimResult =
  | { status: "created"; claim: HuntryClaim }
  // Carries the customer's existing code so the UI can re-show it.
  | { status: "duplicate"; couponCode: string }
  | { status: PlayerClaimRejection }
  | { status: "code_issue_failed" }
  | { status: "lock_timeout" }
  // Firestore only: this customer's earlier request for the same egg is still
  // between reserving the claim and getting its code. The storefront treats it
  // like a lock timeout (503, retry shortly).
  | { status: "claim_in_progress" };

export interface EggClaimCount {
  // Every claim on the egg, forced ones included (they count toward capacity).
  count: number;
  forced: number;
}

// BC-HUN-039: one leaderboard row — a customer's non-forced claim count for an
// event. Forced claims are excluded by the query, never filtered afterwards.
export interface LeaderboardEntry {
  bcCustomerId: number;
  claimCount: number;
  lastClaimedAt: Date;
}

// The BigCommerce-side identity shown next to a customer id. No local players
// table, so this is fetched live; undefined when the customer no longer exists.
export interface ClaimCustomer {
  id: number;
  name: string;
  email: string;
}

export interface LeaderboardRow extends LeaderboardEntry {
  rank: number;
  customer: ClaimCustomer | undefined;
}

export interface GameActivityRow extends HuntryClaim {
  customer: ClaimCustomer | undefined;
}
