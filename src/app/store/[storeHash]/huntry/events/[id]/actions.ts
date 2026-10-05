"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { fetchRewardIdsForEventUncached } from "@/lib/huntry/eggs/eggs-api";
import { deleteEvent, fetchEventUncached, updateEvent } from "@/lib/huntry/events/events-api";
import { recomputeRewardsUsageLimits, withUsageLimitWarning } from "@/lib/huntry/rewards/coupon-sync";
import { eventFormSchema, EventFormInput } from "@/lib/huntry/events/event-form-schema";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const EVENT_NOT_FOUND_MESSAGE =
  "That event no longer exists. It may have been deleted — reload the page to see the current list.";

// headerBannerUrl/isFeatured/featuredOrder aren't edit-form fields (no
// upload UI yet; featuring is a separate ticket's territory) — re-fetching
// fresh (not fetchEvent's cached read) before writing preserves them
// instead of resetting them to defaults, the same reasoning
// gift-certs/[id]/actions.ts's own re-fetch-before-mutate pattern
// documents.
export async function updateHuntryEvent(id: number, input: EventFormInput, storeHash: string | undefined): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const parsed = eventFormSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid event details." };
  }

  const {
    name,
    startsAt,
    endsAt,
    description,
    markerRadiusMeters,
    maxGrabCount,
    eggClaimCapacity,
    itemMarker,
    locationMarker,
    themeColors,
  } = parsed.data;

  try {
    const existing = await fetchEventUncached(id, storeHash);

    if (!existing) {
      return { success: false, message: EVENT_NOT_FOUND_MESSAGE };
    }

    const updated = await updateEvent(
      id,
      {
        name,
        description,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        headerBannerUrl: existing.headerBannerUrl,
        markerRadiusMeters,
        maxGrabCount,
        eggClaimCapacity,
        theme: { colors: themeColors, itemMarker, locationMarker },
        isFeatured: existing.isFeatured,
        featuredOrder: existing.featuredOrder,
      },
      storeHash,
    );

    if (!updated) {
      return { success: false, message: EVENT_NOT_FOUND_MESSAGE };
    }

    updateTag(EVENTS_LIST_TAG);
    updateTag(eventTag(id));

    // Every reward with an egg in this event draws its coupon max_uses from
    // eggClaimCapacity, so a change fans out across all of them
    // (recomputeRewardsUsageLimits bounds the concurrency). Other edits
    // can't move any coupon's limit.
    const recompute =
      eggClaimCapacity !== existing.eggClaimCapacity
        ? await recomputeRewardsUsageLimits(await fetchRewardIdsForEventUncached(id, storeHash), storeHash)
        : { updated: 0, failed: [] };

    return { success: true, message: withUsageLimitWarning(`Event "${updated.name}" updated.`, recompute) };
  } catch (error) {
    logError(`updateHuntryEvent: event ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to update the event.") };
  }
}

// A genuine hard delete — huntry_events has no soft-delete/archive column
// (unlike huntry_rewards' status), per the user's explicit direction. See
// events-api.ts's deleteEvent for the cascade note.
export async function deleteHuntryEvent(id: number, storeHash: string | undefined): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  let rewardIds: number[] = [];

  try {
    // Deleting the event cascades to its eggs, so capture the affected
    // rewards first — afterwards there's no way to tell which coupons lost
    // egg capacity.
    rewardIds = await fetchRewardIdsForEventUncached(id, storeHash);

    const deleted = await deleteEvent(id, storeHash);

    if (!deleted) {
      return { success: false, message: EVENT_NOT_FOUND_MESSAGE };
    }
  } catch (error) {
    logError(`deleteHuntryEvent: event ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to delete the event.") };
  }

  updateTag(EVENTS_LIST_TAG);
  updateTag(eventTag(id));

  const recompute = await recomputeRewardsUsageLimits(rewardIds, storeHash);

  return { success: true, message: withUsageLimitWarning("Event deleted.", recompute) };
}
