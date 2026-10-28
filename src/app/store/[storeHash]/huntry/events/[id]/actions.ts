"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { actionFailure, denyUnlessAuthorized, parseActionInput } from "@/lib/actions/guards";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { fetchRewardIdsForEventUncached } from "@/lib/huntry/eggs/eggs-api";
import { deleteEvent, fetchEventUncached, updateEvent } from "@/lib/huntry/events/events-api";
import { recomputeRewardsUsageLimits, withUsageLimitWarning } from "@/lib/huntry/rewards/coupon-sync";
import { eventFormSchema, EventFormInput } from "@/lib/huntry/events/event-form-schema";
import { resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { DEFAULT_EVENT_BANNER_URL } from "@/lib/huntry/events/types";
import { deleteImageByUrl } from "@/lib/huntry/storage/image-storage";
import { INVALID_IMAGE_MESSAGE, resolveImageField } from "@/lib/huntry/storage/resolve-image-field";

const EVENT_NOT_FOUND_MESSAGE =
  "That event no longer exists. It may have been deleted — reload the page to see the current list.";

// isFeatured/featuredOrder aren't edit-form fields (featuring is a separate
// ticket's territory), and a blank/unchanged headerBannerUrl keeps the
// current banner — re-fetching fresh (not fetchEvent's cached read) before
// writing preserves them instead of resetting them to defaults.
export async function updateHuntryEvent(id: number, input: EventFormInput, storeHash: string | undefined): Promise<ActionResult> {
  const denied = await denyUnlessAuthorized(storeHash);

  if (denied) {
    return denied;
  }

  const parsed = parseActionInput(eventFormSchema, input, "Invalid event details.");

  if (!parsed.ok) {
    return parsed.result;
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

    const banner = resolveImageField({
      submitted: parsed.data.headerBannerUrl,
      current: existing.headerBannerUrl,
      fallback: DEFAULT_EVENT_BANNER_URL,
      storeHash,
    });

    if (!banner.ok) {
      return { success: false, message: INVALID_IMAGE_MESSAGE };
    }

    const updated = await updateEvent(
      id,
      {
        name,
        description,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        headerBannerUrl: banner.url,
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

    if (existing.headerBannerUrl !== banner.url) {
      await deleteImageByUrl(existing.headerBannerUrl, resolveStoreHash(storeHash));
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
    return actionFailure(`updateHuntryEvent: event ${id}`, error, "Failed to update the event.");
  }
}

// A genuine hard delete — huntry_events has no soft-delete/archive column
// (unlike huntry_rewards' status), per the user's explicit direction. See
// events-api.ts's deleteEvent for the cascade note.
export async function deleteHuntryEvent(id: number, storeHash: string | undefined): Promise<ActionResult> {
  const denied = await denyUnlessAuthorized(storeHash);

  if (denied) {
    return denied;
  }

  let rewardIds: number[] = [];

  try {
    // Deleting the event cascades to its eggs, so capture the affected
    // rewards first — afterwards there's no way to tell which coupons lost
    // egg capacity.
    rewardIds = await fetchRewardIdsForEventUncached(id, storeHash);

    const existing = await fetchEventUncached(id, storeHash);
    const deleted = await deleteEvent(id, storeHash);

    if (!deleted) {
      return { success: false, message: EVENT_NOT_FOUND_MESSAGE };
    }

    await deleteImageByUrl(existing?.headerBannerUrl, resolveStoreHash(storeHash));
  } catch (error) {
    return actionFailure(`deleteHuntryEvent: event ${id}`, error, "Failed to delete the event.");
  }

  updateTag(EVENTS_LIST_TAG);
  updateTag(eventTag(id));

  const recompute = await recomputeRewardsUsageLimits(rewardIds, storeHash);

  return { success: true, message: withUsageLimitWarning("Event deleted.", recompute) };
}
