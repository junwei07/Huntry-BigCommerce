"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { actionFailure, denyUnlessAuthorized, parseActionInput } from "@/lib/actions/guards";
import { sponsorTag, SPONSORS_LIST_TAG } from "@/lib/huntry/sponsors/cache-tags";
import { createSponsor } from "@/lib/huntry/sponsors/sponsors-api";
import { sponsorFormSchema, SponsorFormInput } from "@/lib/huntry/sponsors/sponsor-form-schema";
import { DEFAULT_SPONSOR_LOGO_URL } from "@/lib/huntry/sponsors/types";
import { INVALID_IMAGE_MESSAGE, resolveImageField } from "@/lib/huntry/storage/resolve-image-field";

export async function createHuntrySponsor(input: SponsorFormInput, storeHash: string | undefined): Promise<ActionResult> {
  const denied = await denyUnlessAuthorized(storeHash);

  if (denied) {
    return denied;
  }

  const parsed = parseActionInput(sponsorFormSchema, input, "Invalid sponsor details.");

  if (!parsed.ok) {
    return parsed.result;
  }

  const { name, instagramUrl, facebookUrl, websiteUrl, location } = parsed.data;
  const logo = resolveImageField({
    submitted: parsed.data.logoUrl,
    current: null,
    fallback: DEFAULT_SPONSOR_LOGO_URL,
    storeHash,
  });

  if (!logo.ok) {
    return { success: false, message: INVALID_IMAGE_MESSAGE };
  }

  try {
    const sponsor = await createSponsor(
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

    updateTag(SPONSORS_LIST_TAG);
    updateTag(sponsorTag(sponsor.id));

    return { success: true, message: `Sponsor "${sponsor.name}" created.` };
  } catch (error) {
    return actionFailure(`createHuntrySponsor: store "${storeHash}"`, error, "Failed to create the sponsor.");
  }
}
