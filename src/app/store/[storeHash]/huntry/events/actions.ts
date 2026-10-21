"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { countEvents, createEvent, isUniqueSlugConstraintError } from "@/lib/huntry/events/events-api";
import { EVENT_LIMIT_MESSAGE, MAX_EVENTS } from "@/lib/huntry/events/limits";
import { eventFormSchema, EventFormInput } from "@/lib/huntry/events/event-form-schema";
import { DEFAULT_EVENT_BANNER_URL } from "@/lib/huntry/events/types";
import { INVALID_IMAGE_MESSAGE, resolveImageField } from "@/lib/huntry/storage/resolve-image-field";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

export async function createHuntryEvent(input: EventFormInput, storeHash: string | undefined): Promise<ActionResult> {
  // A page/layout-level auth check does not extend to Server Actions, since
  // they're directly POST-able independent of any page render — see
  // isAuthorizedForStore.
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

  const banner = resolveImageField({
    submitted: parsed.data.headerBannerUrl,
    current: null,
    fallback: DEFAULT_EVENT_BANNER_URL,
    storeHash,
  });

  if (!banner.ok) {
    return { success: false, message: INVALID_IMAGE_MESSAGE };
  }

  try {
    // The real gate (mirrors huntry_block_extra_event_creation in the WP
    // plugin) — the UI's disabled button/notice is only UX.
    if ((await countEvents(storeHash)) >= MAX_EVENTS) {
      return { success: false, message: EVENT_LIMIT_MESSAGE };
    }

    const event = await createEvent(
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
        // is_featured/featured_order aren't collected by this form at all —
        // they're a separate ticket's territory (editing/archiving/featured).
        isFeatured: false,
        featuredOrder: null,
      },
      storeHash,
    );

    updateTag(EVENTS_LIST_TAG);
    updateTag(eventTag(event.id));

    return { success: true, message: `Event "${event.name}" created.` };
  } catch (error) {
    logError(`createHuntryEvent: store "${storeHash}"`, error);

    // Only reachable if MAX_SLUG_ATTEMPTS is exhausted — createEvent
    // already dedupes the slug internally, so a normal creation never
    // surfaces this.
    if (isUniqueSlugConstraintError(error)) {
      return { success: false, message: "Could not generate a unique identifier for this event. Try a different name." };
    }

    return { success: false, message: toSafeMessage(error, "Failed to create the event.") };
  }
}
