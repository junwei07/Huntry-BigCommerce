"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { sponsorTag, SPONSORS_LIST_TAG } from "@/lib/huntry/sponsors/cache-tags";
import { createSponsor } from "@/lib/huntry/sponsors/sponsors-api";
import { sponsorFormSchema, SponsorFormInput } from "@/lib/huntry/sponsors/sponsor-form-schema";
import { DEFAULT_SPONSOR_LOGO_URL } from "@/lib/huntry/sponsors/types";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

export async function createHuntrySponsor(input: SponsorFormInput, storeHash: string | undefined): Promise<ActionResult> {
  // A page/layout-level auth check does not extend to Server Actions, since
  // they're directly POST-able independent of any page render — see
  // isAuthorizedForStore.
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const parsed = sponsorFormSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid sponsor details." };
  }

  const { name, instagramUrl, facebookUrl, websiteUrl, location } = parsed.data;

  try {
    // No image upload storage exists yet (BC-HUN-044) — every sponsor
    // created here gets this fixed placeholder, matching
    // DEFAULT_EVENT_BANNER_URL's precedent in events/actions.ts. Unlike
    // that field, the create form does show a real upload control
    // (LogoUploadField) for the logo, but it has nowhere to send a picked
    // file yet — see docs/HUNTRY-UI-REFERENCE.md.
    const sponsor = await createSponsor(
      {
        name,
        logoUrl: DEFAULT_SPONSOR_LOGO_URL,
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
    logError(`createHuntrySponsor: store "${storeHash}"`, error);

    return { success: false, message: toSafeMessage(error, "Failed to create the sponsor.") };
  }
}
