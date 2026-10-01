// Deliberately local rather than imported from events/types.ts or
// sponsors/types.ts — kept independent of its sibling Huntry DALs, the same
// way those two stay independent of each other.
export type SortDirection = "ASC" | "DESC";

// Backs the two CHECK constraints on huntry_rewards.
export type DiscountType = "percent" | "fixed_cart";
export type DiscountScope = "all" | "specific";

// huntry_rewards.status's CHECK constraint allows 'active'/'archived', but
// per the user's explicit direction (diverging from docs/MIGRATION.md's
// archive-vs-hard-delete design) this DAL never writes 'archived' — delete
// is a hard delete only, matching EVMS's own RewardDetail model (no status
// field, hard Firestore delete). The column stays in the type (every row
// genuinely has one) and every row this DAL creates/updates keeps it
// 'active'.
export type RewardStatus = "active" | "archived";

// camelCase, matching HuntryEvent/HuntrySponsor's convention — our own
// schema, not a wire passthrough. couponCode/bc*Id fields are nullable
// placeholders populated later by BC-HUN-020/021's coupon-sync — this DAL
// only ever reads them back, never writes them.
export interface HuntryReward {
  id: number;
  storeHash: string;
  name: string;
  description: string;
  sponsorId: number | null;
  eggCapacity: number;
  rewardStartsAt: Date | null;
  rewardExpiresAt: Date | null;
  discountType: DiscountType;
  discountValue: number;
  discountScope: DiscountScope;
  // Populated from huntry_reward_products — only meaningful (non-empty)
  // when discountScope === "specific"; always [] for "all".
  productIds: number[];
  couponCode: string | null;
  bcPromotionId: string | null;
  bcCouponCodeId: string | null;
  bcCustomerGroupId: string | null;
  status: RewardStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Every HuntryReward field except productIds — the shape each driver's row
// normalizer produces directly from huntry_rewards before the separate
// huntry_reward_products join is read and attached. Mirrors EventFields'
// precedent (there, the split is a computed column; here, it's a child
// table), both existing specifically so the DAL has a plain "just the row"
// shape to normalize into before composing the full public type.
export type RewardFields = Omit<HuntryReward, "productIds">;

// Sorted by name (alphabetical) — rewards have no single obvious default
// date field (reward_starts_at is optional, unlike events' starts_at),
// matching sponsors' same reasoning.
export interface RewardsQuery {
  direction: SortDirection;
}

// Every field a caller supplies to create/update a reward — omits
// couponCode/bc*Id (BC-HUN-020/021's coupon-sync populates these, not this
// DAL) and status (never settable here — see RewardStatus above).
export type CreateRewardInput = Omit<
  HuntryReward,
  "id" | "storeHash" | "couponCode" | "bcPromotionId" | "bcCouponCodeId" | "bcCustomerGroupId" | "status" | "createdAt" | "updatedAt"
>;

// Same editable field set as creation — a plain alias, matching
// UpdateEventInput/UpdateSponsorInput's precedent.
export type UpdateRewardInput = CreateRewardInput;

// Mirrors channels/types.ts's CHANNELS_PATH precedent — co-located with the
// type it fetches, shared by both the real fetch (rewards-api.ts) and the
// MOCK handler (mock/products-list-handler.ts).
export const PRODUCTS_PATH = "/v3/catalog/products";

// The simplified shape fetchBcProductsForPicker returns — a subset of the
// BigCommerce v3 catalog product resource, just enough for a picker list
// (name + SKU to disambiguate, id to store in huntry_reward_products).
export interface BcProductSummary {
  id: number;
  name: string;
  sku: string;
}
