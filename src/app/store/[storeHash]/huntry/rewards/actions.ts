"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { rewardTag, REWARDS_LIST_TAG } from "@/lib/huntry/rewards/cache-tags";
import { createReward, fetchBcProductsForPicker } from "@/lib/huntry/rewards/rewards-api";
import { rewardFormSchema, RewardFormInput } from "@/lib/huntry/rewards/reward-form-schema";
import { BcProductSummary } from "@/lib/huntry/rewards/types";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

export async function createHuntryReward(input: RewardFormInput, storeHash: string | undefined): Promise<ActionResult> {
  // A page/layout-level auth check does not extend to Server Actions, since
  // they're directly POST-able independent of any page render — see
  // isAuthorizedForStore.
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
    const reward = await createReward(
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
        // Defensive — rewardFormSchema already requires at least one entry
        // when discountScope is "specific", and ProductPicker is unmounted
        // (so never adds to productIds) when scope is "all". Clearing it
        // here too matches createRewardInDb's own defensive re-derivation.
        productIds: discountScope === "specific" ? productIds : [],
      },
      storeHash,
    );

    updateTag(REWARDS_LIST_TAG);
    updateTag(rewardTag(reward.id));

    return { success: true, message: `Reward "${reward.name}" created.` };
  } catch (error) {
    logError(`createHuntryReward: store "${storeHash}"`, error);

    return { success: false, message: toSafeMessage(error, "Failed to create the reward.") };
  }
}

// Thin Server Action wrapper around fetchBcProductsForPicker — that DAL
// function isn't itself a "use server" entry point, and ProductPicker (a
// Client Component) needs one to call. Gated the same way every other
// Huntry Server Action is, even though this one is read-only: a Server
// Action is directly POST-able independent of any page render, so it needs
// its own auth check regardless of whether it mutates anything.
export async function searchRewardProducts(
  searchTerm: string,
  storeHash: string | undefined,
): Promise<BcProductSummary[]> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return [];
  }

  return fetchBcProductsForPicker(storeHash, searchTerm);
}
