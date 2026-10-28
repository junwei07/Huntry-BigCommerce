"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { actionFailure, denyUnlessAuthorized, parseActionInput } from "@/lib/actions/guards";
import { sponsorTag, SPONSORS_LIST_TAG } from "@/lib/huntry/sponsors/cache-tags";
import { deleteSponsor, fetchSponsorUncached, updateSponsor } from "@/lib/huntry/sponsors/sponsors-api";
import { sponsorFormSchema, SponsorFormInput } from "@/lib/huntry/sponsors/sponsor-form-schema";
import { DEFAULT_SPONSOR_LOGO_URL } from "@/lib/huntry/sponsors/types";
import { resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { deleteImageByUrl } from "@/lib/huntry/storage/image-storage";
import { INVALID_IMAGE_MESSAGE, resolveImageField } from "@/lib/huntry/storage/resolve-image-field";

const SPONSOR_NOT_FOUND_MESSAGE =
  "That sponsor no longer exists. It may have been deleted — reload the page to see the current list.";

// Re-fetch uncached right before writing: a blank/unchanged submitted logoUrl
// keeps the sponsor's existing logo, and a replaced upload is deleted once
// the row is saved. The same pre-read updateHuntryEvent documents for
// isFeatured/featuredOrder.
export async function updateHuntrySponsor(
  id: number,
  input: SponsorFormInput,
  storeHash: string | undefined,
): Promise<ActionResult> {
  const denied = await denyUnlessAuthorized(storeHash);

  if (denied) {
    return denied;
  }

  const parsed = parseActionInput(sponsorFormSchema, input, "Invalid sponsor details.");

  if (!parsed.ok) {
    return parsed.result;
  }

  const { name, instagramUrl, facebookUrl, websiteUrl, location } = parsed.data;

  try {
    const existing = await fetchSponsorUncached(id, storeHash);

    if (!existing) {
      return { success: false, message: SPONSOR_NOT_FOUND_MESSAGE };
    }

    const logo = resolveImageField({
      submitted: parsed.data.logoUrl,
      current: existing.logoUrl,
      fallback: DEFAULT_SPONSOR_LOGO_URL,
      storeHash,
    });

    if (!logo.ok) {
      return { success: false, message: INVALID_IMAGE_MESSAGE };
    }

    const updated = await updateSponsor(
      id,
      {
        name,
        logoUrl: logo.url,
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

    if (existing.logoUrl !== logo.url) {
      await deleteImageByUrl(existing.logoUrl, resolveStoreHash(storeHash));
    }

    updateTag(SPONSORS_LIST_TAG);
    updateTag(sponsorTag(id));

    return { success: true, message: `Sponsor "${updated.name}" updated.` };
  } catch (error) {
    return actionFailure(`updateHuntrySponsor: sponsor ${id}`, error, "Failed to update the sponsor.");
  }
}

// A genuine hard delete — huntry_sponsors has no status/archive column (see
// sponsors-api.ts's deleteSponsor for why), matching deleteHuntryEvent's
// precedent.
export async function deleteHuntrySponsor(id: number, storeHash: string | undefined): Promise<ActionResult> {
  const denied = await denyUnlessAuthorized(storeHash);

  if (denied) {
    return denied;
  }

  try {
    const existing = await fetchSponsorUncached(id, storeHash);
    const deleted = await deleteSponsor(id, storeHash);

    if (!deleted) {
      return { success: false, message: SPONSOR_NOT_FOUND_MESSAGE };
    }

    await deleteImageByUrl(existing?.logoUrl, resolveStoreHash(storeHash));
  } catch (error) {
    return actionFailure(`deleteHuntrySponsor: sponsor ${id}`, error, "Failed to delete the sponsor.");
  }

  updateTag(SPONSORS_LIST_TAG);
  updateTag(sponsorTag(id));

  return { success: true, message: "Sponsor deleted." };
}
