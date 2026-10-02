"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
import { syncRewardCoupon } from "@/lib/huntry/rewards/coupon-sync";
import {
  deleteReward,
  fetchRewardUncached,
  isRewardCouponCodeTaken,
  updateReward,
  updateRewardCouponFields,
} from "@/lib/huntry/rewards/rewards-api";
import { rewardFormSchema, RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const REWARD_NOT_FOUND_MESSAGE =
  "That reward no longer exists. It may have been deleted — reload the page to see the current list.";

// bcPromotionId/bcCouponCodeId/bcCustomerGroupId/status aren't edit-form
// fields (coupon-sync.ts/BC-HUN-021 own them) — unlike updateHuntryEvent/
// updateHuntrySponsor, rewards-api.ts's UPDATE statement never references
// those columns at all, so updateReward can't clobber them regardless.
// couponCode *is* a normal edit-form field now (BC-HUN-020: admin-typed,
// can change on edit, re-syncs the existing Promotion's coupon rather than
// creating a second one — see coupon-sync.ts). The uncached re-fetch here
// is still worth doing first: it gives a cleaner "no longer exists" message
// before attempting the write, the same shape every other Huntry update
// action uses.
export async function updateHuntryReward(
  id: number,
  input: RewardFormInput,
  storeHash: string | undefined,
): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const parsed = rewardFormSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid reward details." };
  }

  const {
    name,
    description,
    sponsorId,
    couponCode,
    rewardStartsAt,
    rewardExpiresAt,
    eggCapacity,
    discountType,
    discountValue,
    discountScope,
    productIds,
  } = parsed.data;

  // Same primary uniqueness check as createHuntryReward — excludeId so a
  // reward doesn't collide with its own current code.
  if (await isRewardCouponCodeTaken(storeHash, couponCode, id)) {
    return { success: false, message: "That coupon code is already used by another reward." };
  }

  try {
    const existing = await fetchRewardUncached(id, storeHash);

    if (!existing) {
      return { success: false, message: REWARD_NOT_FOUND_MESSAGE };
    }

    const updated = await updateReward(
      id,
      {
        name,
        description,
        sponsorId: sponsorId === "" ? null : Number(sponsorId),
        couponCode,
        eggCapacity,
        rewardStartsAt: new Date(rewardStartsAt),
        rewardExpiresAt: new Date(rewardExpiresAt),
        discountType,
        discountValue,
        discountScope,
        productIds: discountScope === "specific" ? productIds : [],
      },
      storeHash,
    );

    if (!updated) {
      return { success: false, message: REWARD_NOT_FOUND_MESSAGE };
    }

    // BC-HUN-020: re-sync the BigCommerce Promotion + coupon code using the
    // just-updated row (carries the current bcPromotionId/bcCouponCodeId
    // for syncRewardCoupon's lookup-or-create/rename branch). See
    // createHuntryReward's identical comment for why there's no
    // compensating rollback of the reward row on failure here.
    try {
      const coupon = await syncRewardCoupon(updated, storeHash);

      await updateRewardCouponFields(id, storeHash, coupon);
    } catch (couponError) {
      logError(`updateHuntryReward: coupon sync for reward ${id}`, couponError);

      updateTag(REWARDS_LIST_TAG);
      updateTag(rewardTag(id));

      return {
        success: false,
        message: `Reward "${updated.name}" was updated, but syncing its BigCommerce coupon failed: ${toSafeMessage(
          couponError,
          "an unexpected error occurred",
        )}. Edit and save again to retry.`,
      };
    }

    updateTag(REWARDS_LIST_TAG);
    updateTag(rewardTag(id));

    return { success: true, message: `Reward "${updated.name}" updated.` };
  } catch (error) {
    logError(`updateHuntryReward: reward ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to update the reward.") };
  }
}

// A genuine hard delete — rewards-api.ts's deleteReward never writes
// status: 'archived' per the user's explicit direction (see
// rewards/types.ts's RewardStatus comment), matching deleteHuntryEvent/
// deleteHuntrySponsor's precedent. Cascades huntry_reward_products/
// huntry_eggs via FK; never touches huntry_claims (denormalized, by
// schema design).
export async function deleteHuntryReward(id: number, storeHash: string | undefined): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  try {
    const deleted = await deleteReward(id, storeHash);

    if (!deleted) {
      return { success: false, message: REWARD_NOT_FOUND_MESSAGE };
    }
  } catch (error) {
    logError(`deleteHuntryReward: reward ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to delete the reward.") };
  }

  updateTag(REWARDS_LIST_TAG);
  updateTag(rewardTag(id));

  return { success: true, message: "Reward deleted." };
}
