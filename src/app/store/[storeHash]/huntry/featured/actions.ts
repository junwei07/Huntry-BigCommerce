"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { storefrontSettingsTag } from "@/lib/huntry/featured/cache-tags";
import { saveStorefrontSettings } from "@/lib/huntry/featured/featured-api";
import { featuredFormSchema, FeaturedFormInput } from "@/lib/huntry/featured/featured-form-schema";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

// Saves the storefront banner / product CTA copy. The banner images have no
// field: their upload controls are preview-only until image storage exists
// (BC-HUN-044).
export async function saveHuntryFeaturedSettings(
  input: FeaturedFormInput,
  storeHash: string | undefined,
): Promise<ActionResult> {
  // A page/layout-level auth check does not extend to Server Actions, since
  // they're directly POST-able independent of any page render — see
  // isAuthorizedForStore.
  if (!(await isAuthorizedForStore(storeHash))) {
    return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
  }

  const parsed = featuredFormSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Invalid storefront settings." };
  }

  try {
    await saveStorefrontSettings(parsed.data, storeHash);

    const resolvedStoreHash = resolveStoreHash(storeHash);

    if (resolvedStoreHash) {
      updateTag(storefrontSettingsTag(resolvedStoreHash));
    }

    return { success: true, message: "Storefront banner settings saved." };
  } catch (error) {
    logError(`saveHuntryFeaturedSettings: store "${storeHash}"`, error);

    return { success: false, message: toSafeMessage(error, "Failed to save the storefront banner settings.") };
  }
}
