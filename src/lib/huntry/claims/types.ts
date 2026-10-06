// A claim is deliberately denormalized (no FKs to egg/reward/event — see
// 0001_huntry_schema.sql), so reward name/coupon are snapshots.
export interface HuntryClaim {
  id: number;
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
