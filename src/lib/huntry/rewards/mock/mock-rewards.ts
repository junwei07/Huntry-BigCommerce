import { CreateRewardInput, HuntryReward, RewardCouponFields, UpdateRewardInput } from "@/lib/huntry/rewards/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

// Three fixtures covering the variety a form/list will need to render
// correctly in BC-HUN-019: one store-wide ("all") discount tied to a mock
// sponsor, one product-scoped ("specific") discount with multiple
// productIds, and one with no sponsor at all (sponsorId: null, exercising
// the nullable FK). `let`, not `const` — the mutation helpers below push/
// replace fixtures, matching mock-sponsors.ts's precedent for how MOCK mode
// simulates mutation within a process's lifetime.
export let MOCK_REWARDS: HuntryReward[] = [
  {
    id: 1,
    storeHash: "mock-store",
    name: "Free Coffee Combo",
    description: "20% off any order storewide, redeemable once.",
    sponsorId: 1,
    eggCapacity: 10,
    rewardStartsAt: daysFromNow(-5),
    rewardExpiresAt: daysFromNow(25),
    discountType: "percent",
    discountValue: 20,
    discountScope: "all",
    productIds: [],
    couponCode: null,
    bcPromotionId: null,
    bcCouponCodeId: null,
    bcCustomerGroupId: null,
    status: "active",
    createdAt: daysFromNow(-10),
    updatedAt: daysFromNow(-10),
  },
  {
    id: 2,
    storeHash: "mock-store",
    name: "Book Bundle Discount",
    description: "$15 off a qualifying set of featured titles.",
    sponsorId: 2,
    eggCapacity: 5,
    rewardStartsAt: daysFromNow(-1),
    rewardExpiresAt: null,
    discountType: "fixed_cart",
    discountValue: 15,
    discountScope: "specific",
    productIds: [101, 102],
    couponCode: null,
    bcPromotionId: null,
    bcCouponCodeId: null,
    bcCustomerGroupId: null,
    status: "active",
    createdAt: daysFromNow(-3),
    updatedAt: daysFromNow(-3),
  },
  {
    id: 3,
    storeHash: "mock-store",
    name: "Hardware Store Gift",
    description: "10% off storewide, no sponsor tie-in.",
    sponsorId: null,
    eggCapacity: 3,
    rewardStartsAt: null,
    rewardExpiresAt: null,
    discountType: "percent",
    discountValue: 10,
    discountScope: "all",
    productIds: [],
    couponCode: null,
    bcPromotionId: null,
    bcCouponCodeId: null,
    bcCustomerGroupId: null,
    status: "active",
    createdAt: daysFromNow(-1),
    updatedAt: daysFromNow(-1),
  },
];

// Simulates creation in MOCK mode by pushing a new fixture into the
// in-memory array — ephemeral, resets on process restart. Huntry's own
// concepts are "MOCK-mode testable: Yes" per docs/MIGRATION.md §6, matching
// addMockEvent/addMockSponsor's precedent. status always starts "active" —
// this DAL never writes "archived" (see types.ts's RewardStatus comment).
// couponCode comes from input (BC-HUN-020: admin-typed, required) — not
// overridden here, unlike bcPromotionId/bcCouponCodeId/bcCustomerGroupId,
// which stay null until coupon-sync.ts (MOCK branch) populates them.
export function addMockReward(input: CreateRewardInput): HuntryReward {
  const nextId = MOCK_REWARDS.reduce((maxId, reward) => Math.max(maxId, reward.id), 0) + 1;
  const now = new Date();

  const reward: HuntryReward = {
    ...input,
    id: nextId,
    storeHash: "mock-store",
    bcPromotionId: null,
    bcCouponCodeId: null,
    bcCustomerGroupId: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  MOCK_REWARDS = [...MOCK_REWARDS, reward];

  return reward;
}

// id/storeHash/createdAt/bc*Id/status are preserved; every editable field,
// including couponCode (BC-HUN-020: admin-typed, can change on edit), is
// replaced. Returns undefined if no fixture with this id exists, matching
// updateRewardRow's "no row matched" behavior for the DB drivers.
export function updateMockReward(id: number, input: UpdateRewardInput): HuntryReward | undefined {
  const existing = MOCK_REWARDS.find((reward) => reward.id === id);

  if (!existing) {
    return undefined;
  }

  const updated: HuntryReward = { ...existing, ...input, updatedAt: new Date() };

  MOCK_REWARDS = MOCK_REWARDS.map((reward) => (reward.id === id ? updated : reward));

  return updated;
}

// MOCK counterpart to updateRewardCouponFields (rewards-api.ts) — the sole
// writer of bcPromotionId/bcCouponCodeId/bcCustomerGroupId in MOCK mode,
// called only from coupon-sync.ts's MOCK branch. Kept separate from
// updateMockReward rather than overloading its UpdateRewardInput-shaped
// signature. A no-op if the fixture no longer exists (shouldn't happen in
// practice — coupon-sync only ever runs right after create/update on the
// same id). The generic spread below already forwards whatever shape
// RewardCouponFields has — BC-HUN-021 added bcCustomerGroupId to that type
// without needing any edit here.
export function updateMockRewardCouponFields(id: number, fields: RewardCouponFields): void {
  const existing = MOCK_REWARDS.find((reward) => reward.id === id);

  if (!existing) {
    return;
  }

  const updated: HuntryReward = { ...existing, ...fields, updatedAt: new Date() };

  MOCK_REWARDS = MOCK_REWARDS.map((reward) => (reward.id === id ? updated : reward));
}

// A genuine hard delete, matching deleteRewardRow's DB behavior — returns
// whether a fixture was actually removed.
export function deleteMockReward(id: number): boolean {
  const existedBefore = MOCK_REWARDS.some((reward) => reward.id === id);

  MOCK_REWARDS = MOCK_REWARDS.filter((reward) => reward.id !== id);

  return existedBefore;
}
