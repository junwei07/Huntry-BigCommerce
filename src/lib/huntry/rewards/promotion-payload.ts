import { HuntryReward } from "@/lib/huntry/rewards/types";

// Pure request-body builders for BigCommerce's Promotions API, split out of
// coupon-sync.ts so the request shape is unit-testable without a REST client.

type DiscountAmount = { percentage_amount: string } | { fixed_amount: string };

// Confirmed against a real promotion read back from the live sandbox store
// (docs/MIGRATION.md §8): store-wide discounts use cart_value; a
// product-restricted discount uses a *different action type*, cart_items,
// with the restricted product ids embedded directly in the action as
// items.products — a plain array, so one rule/action covers every selected
// product. There's no separate "condition" field for this at all.
type PromotionRuleAction =
  | { cart_value: { discount: DiscountAmount } }
  | { cart_items: { discount: DiscountAmount; items: { products: number[] }; quantity: number } };

interface PromotionRule {
  action: PromotionRuleAction;
}

// Confirmed live (docs/MIGRATION.md §8) as a top-level field on the
// Promotion resource, not nested under rules[].condition. group_ids taking
// BigCommerce's v2 Customer Group id directly is also confirmed live — a
// real promotion created this way echoes it straight back in the response.
interface PromotionCustomerCondition {
  group_ids: number[];
}

export interface PromotionRequestBody {
  name: string;
  redemption_type: "COUPON";
  status: "ENABLED" | "DISABLED";
  // Confirmed against a live 422: BigCommerce wants "a collection of
  // objects," not raw channel ids.
  channels: { id: number }[];
  rules: PromotionRule[];
  // Present only once a reward has a synced Customer Group — BC-HUN-021.
  customer?: PromotionCustomerCondition;
  // The reward's total redemption budget (computeRewardUsageLimit). Lives on
  // the Promotion, not just the coupon code: BigCommerce documents that the
  // parent promotion's max_uses overrides the code's, and the coupon list's
  // "0/Unlimited" reads this one. There is no PUT for an existing coupon
  // code at all (only POST), so this is also the only updatable place.
  max_uses?: number;
}

// discountType === "percent" -> percentage discount amount; "fixed_cart" ->
// fixed-amount discount amount. Shared between both action types below.
function buildDiscountAmount(reward: HuntryReward): DiscountAmount {
  if (reward.discountType === "percent") {
    return { percentage_amount: reward.discountValue.toFixed(2) };
  }

  return { fixed_amount: reward.discountValue.toFixed(2) };
}

// discountScope === "specific" with productIds -> cart_items action
// (product-restricted, every selected product in one items.products
// array); otherwise -> cart_value (store-wide). Deliberately has no
// awareness of bcCustomerGroupId — group-scoped eligibility lives on the
// promotion's own top-level `customer` field (buildPromotionRequestBody),
// a separate top-level field rather than another rule condition.
function buildDiscountAction(reward: HuntryReward): PromotionRuleAction {
  const discount = buildDiscountAmount(reward);

  if (reward.discountScope === "specific" && reward.productIds.length > 0) {
    return { cart_items: { discount, items: { products: reward.productIds }, quantity: 1 } };
  }

  return { cart_value: { discount } };
}

// Exported (like computeRewardUsageLimit) so the request shape is
// unit-testable without a REST client. Only includes `customer` once a
// Customer Group has actually been synced (bcCustomerGroupId set) —
// syncRewardCoupon always calls this with that already threaded through.
export function buildPromotionRequestBody(reward: HuntryReward, maxUses?: number): PromotionRequestBody {
  const body: PromotionRequestBody = {
    name: reward.name,
    redemption_type: "COUPON",
    status: "ENABLED",
    channels: [{ id: 1 }],
    rules: [{ action: buildDiscountAction(reward) }],
    customer: { group_ids: [] },
  };

  if (maxUses !== undefined) {
    body.max_uses = maxUses;
  }

  return body;
}
