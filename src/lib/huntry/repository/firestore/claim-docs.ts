import type { DocumentData, DocumentReference, Firestore } from "firebase-admin/firestore";
import { normalizeCouponCode } from "@/lib/huntry/claims/coupon-code";
import type { HuntryClaim, RedemptionStatus } from "@/lib/huntry/claims/types";
import { readRequiredDate } from "@/lib/huntry/repository/firestore/convert";
import { storeDoc } from "@/lib/huntry/repository/firestore/paths";

// Shared shapes for the claim documents and the three bookkeeping docs every
// claim touches (docs/FIREBASE-MIGRATION.md, Phase 3):
//
//   claims/{eggId}_{customerId}   the claim. The deterministic id replaces
//                                 UNIQUE(egg_id, bc_customer_id): create() fails
//                                 with ALREADY_EXISTS for a second claim.
//   counters/egg_{eggId}          {eventId, count, forced}   capacity authority
//   counters/reward_{rewardId}    {count}                    capacity authority
//   customers/{customerId}        {lastClaimAt, lastLat, lastLng, eventCounts}
//
// Counters sit in their own docs, not on the admin-edited egg/reward docs, so an
// admin `set()` can never reset capacity. They count `pending` reservations too:
// reserved capacity is capacity.

// A claim is `pending` between the reserve and finalize transactions of a player
// claim (the external code-issue call happens in between). Every reader filters
// on `status == "issued"` by equality, never `!=` (which would drop documents
// without the field and force status-first ordering).
export type ClaimStatus = "issued" | "pending";

export function claimId(eggId: string, customerId: number): string {
  return `${eggId}_${customerId}`;
}

export function claimRef(db: Firestore, storeHash: string, eggId: string, customerId: number): DocumentReference {
  return storeDoc(db, storeHash, "claims", claimId(eggId, customerId));
}

export function eggCounterRef(db: Firestore, storeHash: string, eggId: string): DocumentReference {
  return storeDoc(db, storeHash, "counters", `egg_${eggId}`);
}

export function rewardCounterRef(db: Firestore, storeHash: string, rewardId: number): DocumentReference {
  return storeDoc(db, storeHash, "counters", `reward_${rewardId}`);
}

// Distinct players (customers with a claim, forced or not) in one event —
// maintained on each customer's 0 -> 1 per-event transition (and its reverse on
// release), since a distinct count cannot be read inside a transaction.
export function eventPlayersCounterRef(db: Firestore, storeHash: string, eventId: number): DocumentReference {
  return storeDoc(db, storeHash, "counters", `event_players_${eventId}`);
}

export function customerRef(db: Firestore, storeHash: string, customerId: number): DocumentReference {
  return storeDoc(db, storeHash, "customers", customerId);
}

export const EGG_COUNTER_PREFIX = "egg_";

export interface CustomerState {
  lastClaimAt: Date | null;
  lastLat: number | null;
  lastLng: number | null;
  // Claims per event, keyed by the event id as a string (Firestore map keys).
  eventCounts: Record<string, number>;
}

export function readCustomer(data: DocumentData | undefined): CustomerState {
  return {
    lastClaimAt: data?.lastClaimAt ? readRequiredDate(data.lastClaimAt) : null,
    lastLat: data?.lastLat ?? null,
    lastLng: data?.lastLng ?? null,
    eventCounts: { ...(data?.eventCounts ?? {}) },
  };
}

export function readCount(data: DocumentData | undefined, field: "count" | "forced" = "count"): number {
  const value = data?.[field];

  return typeof value === "number" ? value : 0;
}

export interface NewClaimData {
  storeHash: string;
  eggId: string;
  rewardId: number;
  eventId: number;
  rewardNameSnapshot: string;
  bcCustomerId: number;
  // Null while the claim is pending and no code has been issued yet.
  couponCode: string | null;
  claimedAt: Date;
  isForced: boolean;
  forcedByUserId: number | null;
  status: ClaimStatus;
}

export function claimDocData(claim: NewClaimData): DocumentData {
  return {
    id: claimId(claim.eggId, claim.bcCustomerId),
    storeHash: claim.storeHash,
    eggId: claim.eggId,
    rewardId: claim.rewardId,
    eventId: claim.eventId,
    rewardNameSnapshot: claim.rewardNameSnapshot,
    bcCustomerId: claim.bcCustomerId,
    couponCode: claim.couponCode,
    couponCodeNormalized: claim.couponCode === null ? null : normalizeCouponCode(claim.couponCode),
    claimedAt: claim.claimedAt,
    isForced: claim.isForced,
    forcedByUserId: claim.forcedByUserId,
    orderId: null,
    redemptionStatus: "unredeemed" satisfies RedemptionStatus,
    status: claim.status,
  };
}

// Only issued claims are ever mapped for callers; a pending one has no code.
export function toClaim(data: DocumentData): HuntryClaim {
  return {
    id: data.id,
    storeHash: data.storeHash,
    eggId: data.eggId,
    rewardId: data.rewardId,
    eventId: data.eventId,
    rewardNameSnapshot: data.rewardNameSnapshot,
    bcCustomerId: data.bcCustomerId,
    couponCode: data.couponCode ?? "",
    claimedAt: readRequiredDate(data.claimedAt),
    isForced: Boolean(data.isForced),
    forcedByUserId: data.forcedByUserId ?? null,
    orderId: data.orderId ?? null,
    redemptionStatus: data.redemptionStatus,
  };
}
