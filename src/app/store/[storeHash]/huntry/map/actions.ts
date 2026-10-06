"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { ActionResult } from "@/lib/actions/action-result";
import {
  eggPlacementSchema,
  eggUpdateSchema,
  forceClaimEmailSchema,
  EggPlacementInput,
  EggUpdateInput,
} from "@/lib/huntry/eggs/egg-form-schema";
import { CLAIMS_LIST_TAG } from "@/lib/huntry/claims/cache-tags";
import { createForcedClaim } from "@/lib/huntry/claims/claims-api";
import { fetchCustomersByEmailUncached } from "@/lib/gift-certs-manager/customers/customers-api";
import { getSessionUserId } from "@/lib/session/get-session-user-id";
import { eggTag, EGGS_LIST_TAG, eventEggsTag } from "@/lib/huntry/eggs/cache-tags";
import {
  createEggs,
  deleteEgg,
  fetchEggsUncached,
  fetchEggUncached,
  fetchRewardEggCountsUncached,
  updateEgg,
} from "@/lib/huntry/eggs/eggs-api";
import { isFarEnough } from "@/lib/huntry/eggs/geo";
import { MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { planEggPlacements } from "@/lib/huntry/eggs/placement";
import { fetchEventUncached } from "@/lib/huntry/events/events-api";
import { recomputeRewardsUsageLimits, withUsageLimitWarning } from "@/lib/huntry/rewards/coupon-sync";
import { fetchRewardUncached } from "@/lib/huntry/rewards/rewards-api";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const EVENT_NOT_FOUND_MESSAGE = "That event no longer exists. Reload the page to see the current list.";
const EGG_NOT_FOUND_MESSAGE =
  "That egg no longer exists. It may have been deleted — reload the page to see the current eggs.";

function invalidateEggs(eventId: number, eggId?: string): void {
  updateTag(EGGS_LIST_TAG);
  updateTag(eventEggsTag(eventId));

  if (eggId) {
    updateTag(eggTag(eggId));
  }
}

// Commits the placements queued while "placing" in one batch (the admin
// clicking Stop Placing) — port of the plugin's huntry_save_map_changes.
// The client already pre-checks caps/proximity for UX; everything is
// re-validated here against uncached data (planEggPlacements) and anything
// that no longer fits is skipped rather than failing the whole batch.
export async function saveHuntryEggPlacements(
  eventId: number,
  adds: EggPlacementInput[],
  storeHash: string | undefined,
): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const parsed = z.array(eggPlacementSchema).safeParse(adds);

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid egg placement." };
  }

  try {
    const event = await fetchEventUncached(eventId, storeHash);

    if (!event) {
      return { success: false, message: EVENT_NOT_FOUND_MESSAGE };
    }

    const rewardIds = [...new Set(parsed.data.map((add) => add.rewardId))];
    const rewards = await Promise.all(rewardIds.map((rewardId) => fetchRewardUncached(rewardId, storeHash)));
    const rewardCapacities = new Map<number, number>();

    for (const reward of rewards) {
      if (reward) {
        rewardCapacities.set(reward.id, reward.eggCapacity);
      }
    }

    const [existingEggs, rewardEggCounts] = await Promise.all([
      fetchEggsUncached(eventId, storeHash),
      fetchRewardEggCountsUncached(storeHash),
    ]);

    const plan = planEggPlacements({
      eventName: event.name,
      markerRadiusMeters: event.markerRadiusMeters,
      existingEggs,
      rewardCapacities,
      rewardEggCounts,
      adds: parsed.data,
    });

    await createEggs(
      plan.accepted.map((egg) => ({ eventId, rewardId: egg.rewardId, name: egg.name, lat: egg.lat, lng: egg.lng })),
      storeHash,
    );

    invalidateEggs(eventId);

    const recompute = await recomputeRewardsUsageLimits(
      plan.accepted.map((egg) => egg.rewardId),
      storeHash,
    );
    const skipped = plan.skippedTooClose + plan.skippedNoCapacity;
    const placedMessage = withUsageLimitWarning(
      `${plan.accepted.length} egg${plan.accepted.length === 1 ? "" : "s"} placed.`,
      recompute,
    );

    if (skipped === 0) {
      return { success: true, message: placedMessage };
    }

    const reasons = [
      plan.skippedTooClose > 0 ? `${plan.skippedTooClose} too close to another egg` : null,
      plan.skippedNoCapacity > 0 ? `${plan.skippedNoCapacity} over a reward or event egg limit` : null,
    ].filter(Boolean);

    // A fully-skipped batch is a failure the admin must see; a partial one is
    // still a success, with the skips called out (the plugin's warning notice).
    return {
      success: plan.accepted.length > 0,
      message: `${placedMessage} ${skipped} skipped — ${reasons.join(", ")}.`,
    };
  } catch (error) {
    logError(`saveHuntryEggPlacements: event ${eventId}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to save the egg placements.") };
  }
}

// Port of the plugin's huntry_update_map_egg. Preserves the egg's id (claims
// key off it); a blank name keeps the existing one; a reward change must fit
// the target reward's capacity; a location change must keep the event's
// minimum spacing from every *other* egg (re-checked here, since the client's
// view can be stale).
export async function updateHuntryEgg(
  id: string,
  input: EggUpdateInput,
  storeHash: string | undefined,
): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const parsed = eggUpdateSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid egg details." };
  }

  try {
    const egg = await fetchEggUncached(id, storeHash);

    if (!egg) {
      return { success: false, message: EGG_NOT_FOUND_MESSAGE };
    }

    const { rewardId, name, lat, lng } = parsed.data;
    const reward = await fetchRewardUncached(rewardId, storeHash);

    if (!reward) {
      return { success: false, message: "That reward no longer exists. Pick another reward." };
    }

    if (rewardId !== egg.rewardId) {
      const counts = await fetchRewardEggCountsUncached(storeHash);

      if ((counts.get(rewardId) ?? 0) >= Math.min(reward.eggCapacity, MAX_EGGS_PER_REWARD)) {
        return { success: false, message: `"${reward.name}" has no room for another egg.` };
      }
    }

    const moved = lat !== undefined && lng !== undefined && (lat !== egg.lat || lng !== egg.lng);

    if (moved) {
      const event = await fetchEventUncached(egg.eventId, storeHash);

      if (!event) {
        return { success: false, message: EVENT_NOT_FOUND_MESSAGE };
      }

      const others = (await fetchEggsUncached(egg.eventId, storeHash)).filter((other) => other.id !== id);

      if (!isFarEnough({ lat, lng }, others, event.markerRadiusMeters)) {
        return {
          success: false,
          message: `Too close to another egg — move at least ${event.markerRadiusMeters}m away.`,
        };
      }
    }

    const updated = await updateEgg(
      id,
      {
        rewardId,
        name: name || egg.name,
        lat: moved ? lat : egg.lat,
        lng: moved ? lng : egg.lng,
      },
      storeHash,
    );

    if (!updated) {
      return { success: false, message: EGG_NOT_FOUND_MESSAGE };
    }

    invalidateEggs(egg.eventId, id);

    // A reward change moves one egg between two coupons' budgets; a rename or
    // relocation leaves both unchanged, so there's nothing to recompute.
    const recompute =
      rewardId !== egg.rewardId
        ? await recomputeRewardsUsageLimits([egg.rewardId, rewardId], storeHash)
        : { updated: 0, failed: [] };

    return { success: true, message: withUsageLimitWarning("Egg updated.", recompute) };
  } catch (error) {
    logError(`updateHuntryEgg: egg ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to update the egg.") };
  }
}

// Port of the plugin's huntry_force_claim_egg (BC-HUN-029). An audited admin
// override: credits the customer with the given email and records the acting
// admin in forced_by_user_id. Deliberately skips the player-claim rules (live
// status, geofence, capacity, per-player limit — BC-HUN-032's concern).
export async function forceClaimHuntryEgg(
  eggId: string,
  customerEmail: string,
  storeHash: string | undefined,
): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const email = forceClaimEmailSchema.safeParse(customerEmail);

  if (!email.success) {
    return { success: false, message: email.error.issues[0]?.message ?? "Enter a valid customer email." };
  }

  try {
    const egg = await fetchEggUncached(eggId, storeHash);

    if (!egg) {
      return { success: false, message: EGG_NOT_FOUND_MESSAGE };
    }

    const reward = await fetchRewardUncached(egg.rewardId, storeHash);

    if (!reward) {
      return { success: false, message: "This egg's reward no longer exists. Edit the egg to pick another reward." };
    }

    const { items } = await fetchCustomersByEmailUncached([email.data], storeHash);
    const customer = items.find((item) => item.email.toLowerCase() === email.data.toLowerCase());

    if (!customer) {
      return { success: false, message: "No customer account found with that email." };
    }

    const result = await createForcedClaim(
      {
        eggId: egg.id,
        rewardId: reward.id,
        eventId: egg.eventId,
        rewardNameSnapshot: reward.name,
        bcCustomerId: customer.id,
        couponCode: reward.couponCode ?? "",
        forcedByUserId: await getSessionUserId(),
      },
      storeHash,
    );

    if (result.status === "duplicate") {
      return { success: false, message: "That customer has already claimed this egg." };
    }

    updateTag(CLAIMS_LIST_TAG);

    return { success: true, message: `Egg force-claimed for ${customer.email}.` };
  } catch (error) {
    logError(`forceClaimHuntryEgg: egg ${eggId}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to force claim the egg.") };
  }
}

// A genuine hard delete — eggs have no archive state. Never touches
// huntry_claims, so a claimed egg's player keeps their reward.
export async function deleteHuntryEgg(id: string, storeHash: string | undefined): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  try {
    const egg = await fetchEggUncached(id, storeHash);

    if (!egg || !(await deleteEgg(id, storeHash))) {
      return { success: false, message: EGG_NOT_FOUND_MESSAGE };
    }

    invalidateEggs(egg.eventId, id);

    const recompute = await recomputeRewardsUsageLimits([egg.rewardId], storeHash);

    return { success: true, message: withUsageLimitWarning("Egg deleted.", recompute) };
  } catch (error) {
    logError(`deleteHuntryEgg: egg ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to delete the egg.") };
  }
}
