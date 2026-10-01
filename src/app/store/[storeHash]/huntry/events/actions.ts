"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { eventTag, EVENTS_LIST_TAG } from "@/lib/huntry/events/cache-tags";
import { createEvent, isUniqueSlugConstraintError } from "@/lib/huntry/events/events-api";
import { eventFormSchema, EventFormInput } from "@/lib/huntry/events/event-form-schema";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

// No image upload exists in this starter yet (same gap BC-HUN-017 already
// flagged for sponsor logos) — every event created here gets this fixed
// placeholder instead of exposing a banner field in the form. See
// docs/HUNTRY-UI-REFERENCE.md.
const DEFAULT_EVENT_BANNER_URL = "/huntry/cookies-banner.png";

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

  try {
    const event = await createEvent(
      {
        name,
        description,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
        headerBannerUrl: DEFAULT_EVENT_BANNER_URL,
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
