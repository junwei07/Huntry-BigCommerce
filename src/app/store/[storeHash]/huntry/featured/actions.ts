"use server";

import { updateTag } from "next/cache";
import { ActionResult } from "@/lib/actions/action-result";
import { actionFailure, denyUnlessAuthorized, parseActionInput } from "@/lib/actions/guards";
import { resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { storefrontSettingsTag } from "@/lib/huntry/featured/cache-tags";
import { fetchStorefrontSettingsUncached, saveStorefrontSettings } from "@/lib/huntry/featured/featured-api";
import { featuredFormSchema, FeaturedFormInput } from "@/lib/huntry/featured/featured-form-schema";
import { deleteImageByUrl } from "@/lib/huntry/storage/image-storage";
import { INVALID_IMAGE_MESSAGE, resolveImageField } from "@/lib/huntry/storage/resolve-image-field";

// Saves the storefront banner / product CTA copy and the two banner images.
// Image URLs come from the client, so each is accepted only if it is blank,
// unchanged, a bundled asset, or an object under this store's own storage
// prefix (resolveImageField). A replaced image is deleted afterwards.
export async function saveHuntryFeaturedSettings(
  input: FeaturedFormInput,
  storeHash: string | undefined,
): Promise<ActionResult> {
  const denied = await denyUnlessAuthorized(storeHash);

  if (denied) {
    return denied;
  }

  const parsed = parseActionInput(featuredFormSchema, input, "Invalid storefront settings.");

  if (!parsed.ok) {
    return parsed.result;
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
    return actionFailure(`saveHuntryFeaturedSettings: store "${storeHash}"`, error, "Failed to save the storefront banner settings.");
  }
}
