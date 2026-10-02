import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { HuntryReward, RewardCouponFields } from "@/lib/huntry/rewards/types";

// Direct port of the legacy WP plugin's coupon-sync.php
// (huntry_sync_reward_coupon()), called from the reward create/edit Server
// Actions (BC-HUN-020) rather than a WP save-hook — see docs/MIGRATION.md
// §2/§3 and tickets.md's BC-HUN-020 entry.
//
// Field-name/request-shape status: channels and the discount action shape
// were corrected against real live-sandbox data (see docs/MIGRATION.md §8's
// "Resolved (BC-HUN-020, live sandbox)" entry) — channels must be a
// collection of objects ({ id }), not raw numbers. Product restriction has
// no separate "condition" field at all: BigCommerce uses a different action
// *type* depending on scope — cart_value for store-wide, cart_items (with
// the restricted product ids embedded directly as items.products, a plain
// array — one rule covers every selected product) for product-restricted.
// Confirmed by reading back a real promotion created through BigCommerce's
// own admin UI, not guessed. The coupon-codes sub-resource body (max_uses/
// max_uses_per_customer) and the PUT-rename-then-fallback behavior in
// syncCouponCode are still unconfirmed live — adjust if a future save
// surfaces another validation error there.

export type CouponSyncResult = RewardCouponFields;

interface PlacedEggClaimCapacity {
  // null when the egg has no parent event — the legacy
  // huntry_calculate_reward_usage_limit() counts that case as 1.
  eventClaimCapacity: number | null;
}

// Direct port of huntry_calculate_reward_usage_limit(): if no eggs are
// placed yet, fall back to the reward's own flat egg_capacity field (or
// MAX_EGGS_PER_REWARD if that's <= 0); otherwise sum each placed egg's
// parent event's claim capacity (or 1 with no parent event). Parameterized
// so BC-HUN-028 (usage-limit recompute on egg/event changes) can reuse it
// with real placed-egg data without duplicating the algorithm — BC-HUN-020
// always calls this with an empty array, since no huntry_eggs query exists
// yet (BC-HUN-024/025 land eggs in Week 3).
export function computeRewardUsageLimit(
  reward: Pick<HuntryReward, "eggCapacity">,
  placedEggs: PlacedEggClaimCapacity[],
): number {
  if (placedEggs.length === 0) {
    return reward.eggCapacity > 0 ? reward.eggCapacity : MAX_EGGS_PER_REWARD;
  }

  const usageLimit = placedEggs.reduce((sum, egg) => sum + (egg.eventClaimCapacity ?? 1), 0);

  return usageLimit > 0 ? usageLimit : MAX_EGGS_PER_REWARD;
}

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

interface PromotionRequestBody {
  name: string;
  redemption_type: "COUPON";
  status: "ENABLED" | "DISABLED";
  // Confirmed against a live 422: BigCommerce wants "a collection of
  // objects," not raw channel ids.
  channels: { id: number }[];
  rules: PromotionRule[];
}

interface PromotionResource {
  id: number | string;
}

interface V3SingleResponse<T> {
  data: T;
}

interface CouponCodeResource {
  id: number | string;
}

interface CouponCodeRequestBody {
  code: string;
  max_uses: number;
  max_uses_per_customer: number;
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
// promotion's own top-level `customer` field (confirmed live), not here,
// and is BC-HUN-021's addition, not this ticket's.
function buildDiscountAction(reward: HuntryReward): PromotionRuleAction {
  const discount = buildDiscountAmount(reward);

  if (reward.discountScope === "specific" && reward.productIds.length > 0) {
    return { cart_items: { discount, items: { products: reward.productIds }, quantity: 1 } };
  }

  return { cart_value: { discount } };
}

function buildPromotionRequestBody(reward: HuntryReward): PromotionRequestBody {
  return {
    name: reward.name,
    redemption_type: "COUPON",
    status: "ENABLED",
    channels: [{ id: 1 }],
    rules: [{ action: buildDiscountAction(reward) }],
  };
}

async function syncPromotion(
  reward: HuntryReward,
  storeHash: string | undefined,
): Promise<PromotionResource> {
  const apiClient = await getRestApiClient(storeHash);
  const body = buildPromotionRequestBody(reward);

  if (reward.bcPromotionId) {
    const response = await apiClient.put<V3SingleResponse<PromotionResource>>(
      `/v3/promotions/${reward.bcPromotionId}`,
      { body },
    );

    return response.data.data;
  }

  const response = await apiClient.post<V3SingleResponse<PromotionResource>>("/v3/promotions", { body });

  return response.data.data;
}

// Creates the coupon-codes sub-resource if none exists yet. If one already
// exists, attempts PUT first (in case the live API supports renaming a
// code in place — unconfirmed, see this file's header caveat); if that
// throws, falls back to DELETE + POST, which works regardless of whether
// PUT-based renaming turns out to be supported. The old code becomes
// invalid either way once the admin changes it — an accepted, inherent
// consequence of making the coupon code editable (decision 3,
// docs/MIGRATION.md's BC-HUN-020 plan notes), not a bug to engineer around.
async function syncCouponCode(
  reward: HuntryReward,
  promotionId: string,
  storeHash: string | undefined,
): Promise<CouponCodeResource> {
  const apiClient = await getRestApiClient(storeHash);
  const codeBody: CouponCodeRequestBody = {
    code: reward.couponCode as string,
    max_uses: computeRewardUsageLimit(reward, []),
    max_uses_per_customer: 1,
  };

  if (!reward.bcCouponCodeId) {
    const response = await apiClient.post<V3SingleResponse<CouponCodeResource>>(
      `/v3/promotions/${promotionId}/codes`,
      { body: codeBody },
    );

    return response.data.data;
  }

  try {
    const response = await apiClient.put<V3SingleResponse<CouponCodeResource>>(
      `/v3/promotions/${promotionId}/codes/${reward.bcCouponCodeId}`,
      { body: codeBody },
    );

    return response.data.data;
  } catch {
    await apiClient.delete(`/v3/promotions/${promotionId}/codes/${reward.bcCouponCodeId}`);

    const response = await apiClient.post<V3SingleResponse<CouponCodeResource>>(
      `/v3/promotions/${promotionId}/codes`,
      { body: codeBody },
    );

    return response.data.data;
  }
}

// Called with the just-written HuntryReward (post createReward/
// updateReward, so reward.couponCode is already the admin's current,
// already-persisted value). Never touches huntry_rewards itself — pure
// "talk to BigCommerce", mirroring gift-certificates-api.ts's separation
// from its own Server Actions. Throws rather than swallowing errors —
// apiClient.post/.put already throw AppError("UPSTREAM_API", ...) on
// failure (rest-client.ts); the calling Server Action decides what to
// report, following the gift-certs compensating-rollback precedent rather
// than register-app-extension.ts's never-throw/log-only pattern, since a
// reward with a broken coupon is a real bug, not an acceptable degraded
// state. Deliberately doesn't port the legacy re-entrancy lock
// (coupon-sync.php's huntry_reward_coupon_sync_lock()) — BigCommerce has no
// save-hook mechanism that could trigger a reverse sync back into this app.
export async function syncRewardCoupon(
  reward: HuntryReward,
  storeHash: string | undefined,
): Promise<CouponSyncResult> {
  if (getDataMode() === "MOCK") {
    return {
      bcPromotionId: reward.bcPromotionId ?? `mock-promotion-${reward.id}`,
      bcCouponCodeId: reward.bcCouponCodeId ?? `mock-coupon-${reward.id}`,
    };
  }

  const promotion = await syncPromotion(reward, storeHash);
  const couponCode = await syncCouponCode(reward, String(promotion.id), storeHash);

  return {
    bcPromotionId: String(promotion.id),
    bcCouponCodeId: String(couponCode.id),
  };
}
