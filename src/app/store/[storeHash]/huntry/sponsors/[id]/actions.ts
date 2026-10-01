"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { sponsorTag, SPONSORS_LIST_TAG } from "@/lib/huntry/sponsors/cache-tags";
import { deleteSponsor, fetchSponsorUncached, updateSponsor } from "@/lib/huntry/sponsors/sponsors-api";
import { sponsorFormSchema, SponsorFormInput } from "@/lib/huntry/sponsors/sponsor-form-schema";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

const SPONSOR_NOT_FOUND_MESSAGE =
  "That sponsor no longer exists. It may have been deleted — reload the page to see the current list.";

// logoUrl isn't an edit-form field (see LogoUploadField/
// sponsor-form-schema.ts) — re-fetch uncached right before writing to
// preserve the sponsor's existing logo instead of resetting it, the same
// reasoning updateHuntryEvent's fetchEventUncached pre-read documents for
// headerBannerUrl/isFeatured/featuredOrder.
export async function updateHuntrySponsor(
  id: number,
  input: SponsorFormInput,
  storeHash: string | undefined,
): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const parsed = sponsorFormSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid sponsor details." };
  }

  const { name, instagramUrl, facebookUrl, websiteUrl, location } = parsed.data;

  try {
    const existing = await fetchSponsorUncached(id, storeHash);

    if (!existing) {
      return { success: false, message: SPONSOR_NOT_FOUND_MESSAGE };
    }

    const updated = await updateSponsor(
      id,
      {
        name,
        logoUrl: existing.logoUrl,
        instagramUrl: instagramUrl === "" ? null : instagramUrl,
        facebookUrl: facebookUrl === "" ? null : facebookUrl,
        websiteUrl: websiteUrl === "" ? null : websiteUrl,
        location: location === "" ? null : location,
      },
      storeHash,
    );

    if (!updated) {
      return { success: false, message: SPONSOR_NOT_FOUND_MESSAGE };
    }

    updateTag(SPONSORS_LIST_TAG);
    updateTag(sponsorTag(id));

    return { success: true, message: `Sponsor "${updated.name}" updated.` };
  } catch (error) {
    logError(`updateHuntrySponsor: sponsor ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to update the sponsor.") };
  }
}

// A genuine hard delete — huntry_sponsors has no status/archive column (see
// sponsors-api.ts's deleteSponsor for why), matching deleteHuntryEvent's
// precedent.
export async function deleteHuntrySponsor(id: number, storeHash: string | undefined): Promise<ActionResult> {
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  try {
    const deleted = await deleteSponsor(id, storeHash);

    if (!deleted) {
      return { success: false, message: SPONSOR_NOT_FOUND_MESSAGE };
    }
  } catch (error) {
    logError(`deleteHuntrySponsor: sponsor ${id}`, error);

    return { success: false, message: toSafeMessage(error, "Failed to delete the sponsor.") };
  }

  updateTag(SPONSORS_LIST_TAG);
  updateTag(sponsorTag(id));

  return { success: true, message: "Sponsor deleted." };
}
