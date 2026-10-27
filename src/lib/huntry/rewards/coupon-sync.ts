import { getDataMode } from "@/lib/bc-api-client/resolve-store-credentials";
import { getRestApiClient } from "@/lib/bc-api-client/get-rest-api-client";
import { fetchPlacedEggCapacitiesUncached } from "@/lib/huntry/eggs/eggs-api";
import { buildPromotionRequestBody } from "@/lib/huntry/rewards/promotion-payload";
import { fetchRewardUncached } from "@/lib/huntry/rewards/rewards-api";
import { HuntryReward, RewardCouponFields } from "@/lib/huntry/rewards/types";
import { computeRewardUsageLimit } from "@/lib/huntry/rewards/usage-limit";
import { AppError, toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

// The pure pieces live in usage-limit.ts and promotion-payload.ts; re-exported
// so existing importers (and the actions' test mocks of this module) are unchanged.
export { buildPromotionRequestBody, computeRewardUsageLimit };

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

// BC-HUN-032 redesign: eligibility is per-claim single-use codes (claim-codes.ts),
// not a shared code scoped by a Customer Group. This file therefore syncs only
// the Promotion (discount rule + redemption budget); it no longer creates a
// Customer Group or a shared coupon code, and it removes the shared code a
// reward created before the redesign still carries — otherwise anyone who knew
// it (e.g. COOKIE100) could keep using it. See docs/MIGRATION.md §2/§8.
export type CouponSyncResult = RewardCouponFields;

interface PromotionResource {
  id: number | string;
}

interface V3SingleResponse<T> {
  data: T;
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

// Called with the just-written HuntryReward (post createReward/
// updateReward, so reward.couponCode is already the admin's current,
// already-persisted value). Never touches huntry_rewards itself — pure
// "talk to BigCommerce", keeping it separate from the Server Actions. Throws rather than swallowing errors —
// apiClient.post/.put already throw AppError("UPSTREAM_API", ...) on
// failure (rest-client.ts); the calling Server Action decides what to
// report, rather than a never-throw/log-only pattern, since a
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
      bcCouponCodeId: null,
      bcCustomerGroupId: null,
    };
  }

  const maxUses = await computeUsageLimitForReward(reward, storeHash);
  const promotion = await syncPromotion(reward, maxUses, storeHash);

  await deleteLegacySharedCode(reward, String(promotion.id), storeHash);

  return { bcPromotionId: String(promotion.id), bcCouponCodeId: null, bcCustomerGroupId: null };
}

// A reward synced before the per-claim-code redesign still has its shared
// admin-typed code on the promotion. Deleting it is what actually retires it;
// an already-gone code (404) is the goal state, not a failure.
async function deleteLegacySharedCode(
  reward: HuntryReward,
  promotionId: string,
  storeHash: string | undefined,
): Promise<void> {
  if (!reward.bcCouponCodeId) {
    return;
  }

  const apiClient = await getRestApiClient(storeHash);

  try {
    await apiClient.delete(`/v3/promotions/${promotionId}/codes/${reward.bcCouponCodeId}`);
  } catch (error) {
    if (!(error instanceof AppError && error.status === 404)) {
      throw error;
    }
  }
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
