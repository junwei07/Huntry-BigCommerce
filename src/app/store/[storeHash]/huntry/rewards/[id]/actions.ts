"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
import { deleteReward, fetchRewardUncached, updateReward } from "@/lib/huntry/rewards/rewards-api";
import { rewardFormSchema, RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const REWARD_NOT_FOUND_MESSAGE =
  "That reward no longer exists. It may have been deleted — reload the page to see the current list.";

// couponCode/bcPromotionId/bcCouponCodeId/bcCustomerGroupId/status aren't
// edit-form fields (BC-HUN-020/021's coupon-sync owns them) — unlike
// updateHuntryEvent/updateHuntrySponsor, rewards-api.ts's UPDATE statement
// never references those columns at all, so updateReward can't clobber them
// regardless. The uncached re-fetch here is still worth doing first: it
// gives a cleaner "no longer exists" message before attempting the write,
// the same shape every other Huntry update action uses.
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
    rewardStartsAt,
    rewardExpiresAt,
    eggCapacity,
    discountType,
    discountValue,
    discountScope,
    productIds,
  } = parsed.data;

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
