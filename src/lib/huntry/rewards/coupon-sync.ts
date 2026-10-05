import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { fetchPlacedEggCapacitiesUncached } from "@/lib/huntry/eggs/eggs-api";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { PlacedEggClaimCapacity } from "@/lib/huntry/eggs/types";
import { fetchRewardUncached } from "@/lib/huntry/rewards/rewards-api";
import { HuntryReward, RewardCouponFields } from "@/lib/huntry/rewards/types";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

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
// own admin UI, not guessed. BigCommerce's docs list only POST for a coupon
// code (no PUT/update endpoint), so syncCouponCode's PUT always throws and
// the delete+recreate fallback is the real rename path. The redemption
// limit is set on the Promotion's own max_uses, which overrides the code's.

export type CouponSyncResult = RewardCouponFields;

// A reward's redemption budget = how many eggs it may have (egg_capacity) x
// how many different players can claim each one (the event's claim
// capacity), independent of how many eggs are placed yet. Deliberately NOT
// a port of huntry_calculate_reward_usage_limit() (huntry/includes/rewards/
// coupon-sync.php:76), which sums the claim capacity of each *placed* egg
// and so only reaches eggs x claims once every egg is placed — a user-
// directed departure so the coupon is sized for the reward's full capacity
// from the start. A reward whose eggs span events uses the highest claim
// capacity among them; with none placed (or no parent event) it counts as 1.
// egg_capacity <= 0 keeps the MAX_EGGS_PER_REWARD fallback. Parameterized so
// recomputeRewardUsageLimit (BC-HUN-028) can pass real placed-egg data.
export function computeRewardUsageLimit(
  reward: Pick<HuntryReward, "eggCapacity">,
  placedEggs: PlacedEggClaimCapacity[],
): number {
  const eggs = reward.eggCapacity > 0 ? reward.eggCapacity : MAX_EGGS_PER_REWARD;
  const claimCapacity = Math.max(1, ...placedEggs.map((egg) => egg.eventClaimCapacity ?? 1));

  return eggs * claimCapacity;
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

// Confirmed live (docs/MIGRATION.md §8) as a top-level field on the
// Promotion resource, not nested under rules[].condition. group_ids taking
// BigCommerce's v2 Customer Group id directly is also confirmed live — a
// real promotion created this way echoes it straight back in the response.
interface PromotionCustomerCondition {
  group_ids: number[];
}

interface PromotionRequestBody {
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

interface PromotionResource {
  id: number | string;
}

interface V3SingleResponse<T> {
  data: T;
}

// BigCommerce's Customer Groups API is v2, not v3 (GET /v3/customer_groups
// 404s "route not found"; GET /v2/customer_groups works — confirmed live,
// docs/MIGRATION.md §8). v2 responses are bare resources, unlike v3's
// { data: T } envelope.
interface CustomerGroupResource {
  id: number;
}

// v2 Customer Groups create/update body — confirmed live (docs/MIGRATION.md
// §8): returns a bare resource, not a { data } envelope like v3.
interface CustomerGroupRequestBody {
  name: string;
  is_default: boolean;
  category_access: { type: "all" };
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
  };

  if (reward.bcCustomerGroupId) {
    body.customer = { group_ids: [Number(reward.bcCustomerGroupId)] };
  }

  if (maxUses !== undefined) {
    body.max_uses = maxUses;
  }

  return body;
}

// BC-HUN-021: one Customer Group per reward, the primary preventive
// mechanism replacing the legacy plugin's per-request
// woocommerce_coupon_is_valid account-ownership check (docs/MIGRATION.md
// §2) — BigCommerce refuses the coupon for anyone not a member, rather
// than this app policing it after the fact. Lookup-or-create by
// reward.bcCustomerGroupId, same shape as syncPromotion/syncCouponCode.
// Request/response shape confirmed live (docs/MIGRATION.md §8). Exported
// (like buildPromotionRequestBody) so it's unit-testable without a REST
// client.
export function buildCustomerGroupRequestBody(reward: HuntryReward): CustomerGroupRequestBody {
  return {
    name: `Huntry Reward #${reward.id}: ${reward.name}`,
    is_default: false,
    category_access: { type: "all" },
  };
}

async function syncCustomerGroup(
  reward: HuntryReward,
  storeHash: string | undefined,
): Promise<CustomerGroupResource> {
  const apiClient = await getRestApiClient(storeHash);
  const body = buildCustomerGroupRequestBody(reward);

  if (reward.bcCustomerGroupId) {
    const response = await apiClient.put<CustomerGroupResource>(
      `/v2/customer_groups/${reward.bcCustomerGroupId}`,
      { body },
    );

    return response.data;
  }

  const response = await apiClient.post<CustomerGroupResource>("/v2/customer_groups", { body });

  return response.data;
}

async function computeUsageLimitForReward(reward: HuntryReward, storeHash: string | undefined): Promise<number> {
  return computeRewardUsageLimit(reward, await fetchPlacedEggCapacitiesUncached(reward.id, storeHash));
}

async function syncPromotion(
  reward: HuntryReward,
  maxUses: number,
  storeHash: string | undefined,
): Promise<PromotionResource> {
  const apiClient = await getRestApiClient(storeHash);
  const body = buildPromotionRequestBody(reward, maxUses);

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
  maxUses: number,
  storeHash: string | undefined,
): Promise<CouponCodeResource> {
  const apiClient = await getRestApiClient(storeHash);
  const codeBody: CouponCodeRequestBody = {
    code: reward.couponCode as string,
    max_uses: maxUses,
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
      bcCustomerGroupId: reward.bcCustomerGroupId ?? `mock-customer-group-${reward.id}`,
    };
  }

  // Group first: the Promotion's customer.group_ids field needs the
  // group's id at build time. Threaded through a shallow copy rather than
  // mutating the caller's reward, since buildPromotionRequestBody only
  // reads bcCustomerGroupId off it.
  const customerGroup = await syncCustomerGroup(reward, storeHash);
  const rewardWithGroup: HuntryReward = { ...reward, bcCustomerGroupId: String(customerGroup.id) };

  const maxUses = await computeUsageLimitForReward(reward, storeHash);
  const promotion = await syncPromotion(rewardWithGroup, maxUses, storeHash);
  const couponCode = await syncCouponCode(rewardWithGroup, String(promotion.id), maxUses, storeHash);

  return {
    bcPromotionId: String(promotion.id),
    bcCouponCodeId: String(couponCode.id),
    bcCustomerGroupId: String(customerGroup.id),
  };
}

// BC-HUN-028: re-derives a reward's redemption budget from its currently
// placed eggs and PUTs it as the Promotion's max_uses. BigCommerce has no
// update endpoint for an existing coupon code (POST only), and the
// promotion-level max_uses overrides the code's anyway — so this never
// touches the code, and the code the customers already hold stays valid. Sends the full promotion
// body (what syncPromotion already sends) rather than a partial one. A
// reward that was never synced has no promotion to update, and MOCK mode
// never talks to BigCommerce. Throws on upstream failure.
export async function recomputeRewardUsageLimit(
  reward: HuntryReward,
  storeHash: string | undefined,
): Promise<void> {
  if (getDataMode() === "MOCK" || !reward.bcPromotionId) {
    return;
  }

  const apiClient = await getRestApiClient(storeHash);
  const maxUses = await computeUsageLimitForReward(reward, storeHash);

  await apiClient.put(`/v3/promotions/${reward.bcPromotionId}`, { body: buildPromotionRequestBody(reward, maxUses) });
}

// Bounds the burst of Promotions API calls an event-capacity edit can fan
// out into (docs/MIGRATION.md §7 "Event-level max_uses fan-out") — a small
// worker pool rather than Promise.all over every reward.
const RECOMPUTE_CONCURRENCY = 4;

export interface UsageLimitRecomputeResult {
  updated: number;
  failed: { rewardId: number; message: string }[];
}

// Recomputes every distinct reward id, isolating failures so one broken
// coupon doesn't stop the rest. Never throws: callers run this after their
// own DB write has committed and only need to report what failed.
export async function recomputeRewardsUsageLimits(
  rewardIds: number[],
  storeHash: string | undefined,
): Promise<UsageLimitRecomputeResult> {
  const queue = [...new Set(rewardIds)];
  const result: UsageLimitRecomputeResult = { updated: 0, failed: [] };

  async function worker(): Promise<void> {
    for (let rewardId = queue.shift(); rewardId !== undefined; rewardId = queue.shift()) {
      try {
        const reward = await fetchRewardUncached(rewardId, storeHash);

        if (reward) {
          await recomputeRewardUsageLimit(reward, storeHash);
        }

        result.updated += 1;
      } catch (error) {
        logError(`recomputeRewardsUsageLimits: reward ${rewardId}`, error);
        result.failed.push({ rewardId, message: toSafeMessage(error, "an unexpected error occurred") });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(RECOMPUTE_CONCURRENCY, queue.length) }, worker));

  return result;
}

// Appends a coupon-limit warning to an action's success message when any
// recompute failed — the egg/event write already committed, so this is a
// "saved, but" notice rather than a failure (matches updateHuntryReward's
// coupon-failure wording).
export function withUsageLimitWarning(message: string, recompute: UsageLimitRecomputeResult): string {
  if (recompute.failed.length === 0) {
    return message;
  }

  return `${message} However, updating the coupon usage limit failed for ${recompute.failed.length} reward${
    recompute.failed.length === 1 ? "" : "s"
  } (${recompute.failed.map((failure) => `#${failure.rewardId}`).join(", ")}). Save the reward again to retry.`;
}
