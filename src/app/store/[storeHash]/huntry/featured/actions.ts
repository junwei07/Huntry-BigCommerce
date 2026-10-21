"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { storefrontSettingsTag } from "@/lib/huntry/featured/cache-tags";
import { fetchStorefrontSettingsUncached, saveStorefrontSettings } from "@/lib/huntry/featured/featured-api";
import { featuredFormSchema, FeaturedFormInput } from "@/lib/huntry/featured/featured-form-schema";
import { deleteImageByUrl } from "@/lib/huntry/storage/image-storage";
import { INVALID_IMAGE_MESSAGE, resolveImageField } from "@/lib/huntry/storage/resolve-image-field";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";

// Saves the storefront banner / product CTA copy and the two banner images.
// Image URLs come from the client, so each is accepted only if it is blank,
// unchanged, a bundled asset, or an object under this store's own storage
// prefix (resolveImageField). A replaced image is deleted afterwards.
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
    const existing = await fetchStorefrontSettingsUncached(storeHash);
    const resolvedStoreHash = resolveStoreHash(storeHash);
    const logo = resolveImageField({
      submitted: parsed.data.bannerLogoUrl,
      current: existing.bannerLogoUrl || null,
      fallback: "",
      storeHash,
    });
    const image = resolveImageField({
      submitted: parsed.data.bannerImageUrl,
      current: existing.bannerImageUrl || null,
      fallback: "",
      storeHash,
    });

    if (!logo.ok || !image.ok) {
      return { success: false, message: INVALID_IMAGE_MESSAGE };
    }

    await saveStorefrontSettings({ ...parsed.data, bannerLogoUrl: logo.url, bannerImageUrl: image.url }, storeHash);

    if (existing.bannerLogoUrl !== logo.url) {
      await deleteImageByUrl(existing.bannerLogoUrl, resolvedStoreHash);
    }

    if (existing.bannerImageUrl !== image.url) {
      await deleteImageByUrl(existing.bannerImageUrl, resolvedStoreHash);
    }

    if (resolvedStoreHash) {
      updateTag(storefrontSettingsTag(resolvedStoreHash));
    }

    return { success: true, message: "Storefront banner settings saved." };
  } catch (error) {
    logError(`saveHuntryFeaturedSettings: store "${storeHash}"`, error);

    return { success: false, message: toSafeMessage(error, "Failed to save the storefront banner settings.") };
  }
}
