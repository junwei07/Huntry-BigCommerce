// Deliberately local rather than imported from events/types.ts or
// sponsors/types.ts — kept independent of its sibling Huntry DALs, the same
// way those two stay independent of each other.
// Both options sort ascending: "name" is A-Z, "time" is soonest
// reward_starts_at first (rewards with no start date last).
export type RewardSort = "name" | "time";

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
// schema, not a wire passthrough. couponCode is admin-typed (BC-HUN-020,
// matching the legacy WP plugin's required "Gift Card Code" field) and
// written by this DAL like any other field; bcPromotionId/bcCouponCodeId/
// bcCustomerGroupId stay nullable placeholders this DAL only ever reads
// back, written exclusively by coupon-sync.ts (BC-HUN-020/021).
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
  sort: RewardSort;
}

// Every field a caller supplies to create/update a reward — still omits
// bc*Id (coupon-sync.ts is their sole writer) and status (never settable
// here — see RewardStatus above). couponCode is admin-typed (BC-HUN-020)
// and required here, narrower than HuntryReward.couponCode's
// `string | null` (a pre-BC-HUN-020 row can still be null until next
// edited, but every write going through this type always supplies one).
export type CreateRewardInput = Omit<
  HuntryReward,
  | "id"
  | "storeHash"
  | "couponCode"
  | "bcPromotionId"
  | "bcCouponCodeId"
  | "bcCustomerGroupId"
  | "status"
  | "createdAt"
  | "updatedAt"
> & { couponCode: string };

// Same editable field set as creation — a plain alias, matching
// UpdateEventInput/UpdateSponsorInput's precedent.
export type UpdateRewardInput = CreateRewardInput;

// The narrow shape updateRewardCouponFields (rewards-api.ts) writes —
// coupon-sync.ts's (BC-HUN-020/021) sole output. Deliberately excludes
// couponCode itself: that's an admin-typed, normal CreateRewardInput/
// UpdateRewardInput field now, not something coupon-sync writes back.
export interface RewardCouponFields {
  bcPromotionId: string;
  // Both always null since the per-claim-code redesign (BC-HUN-032): the
  // shared code and the Customer Group are retired. Kept so the columns and
  // the DAL's write shape stay unchanged.
  bcCouponCodeId: string | null;
  bcCustomerGroupId: string | null;
}

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
