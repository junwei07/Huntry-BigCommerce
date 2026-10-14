import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { storefrontSettingsTag } from "@/lib/huntry/featured/cache-tags";
import { DEFAULT_STOREFRONT_SETTINGS, StorefrontSettings } from "@/lib/huntry/featured/types";
import { getHuntryRepository } from "@/lib/huntry/repository/get-huntry-repository";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

async function fetchSettingsFromDb(storeHash: string): Promise<StorefrontSettings> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(storefrontSettingsTag(storeHash));
  // @cache-components-only:end

  return getHuntryRepository().featured.getStorefrontSettings(storeHash);
}

// MOCK mode has no database: it keeps the saved values in memory for the life
// of the process, like the other Huntry mock stores.
let mockSettings: StorefrontSettings = { ...DEFAULT_STOREFRONT_SETTINGS };

export async function fetchStorefrontSettings(storeHash: string | undefined): Promise<StorefrontSettings> {
  if (getDataMode() === "MOCK") {
    return { ...mockSettings };
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    return { ...DEFAULT_STOREFRONT_SETTINGS };
  }

  return fetchSettingsFromDb(resolvedStoreHash);
}

// Uncached counterpart, for code about to act on the saved values (and for
// tests, which don't run under Cache Components).
export async function fetchStorefrontSettingsUncached(storeHash: string | undefined): Promise<StorefrontSettings> {
  if (getDataMode() === "MOCK") {
    return { ...mockSettings };
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  return resolvedStoreHash ? getHuntryRepository().featured.getStorefrontSettings(resolvedStoreHash) : { ...DEFAULT_STOREFRONT_SETTINGS };
}

// For the public cta-data route: a failed read (for example the migration
// hasn't run yet) must degrade to the default copy, never take the storefront
// banner down.
export async function fetchStorefrontSettingsOrDefaults(storeHash: string): Promise<StorefrontSettings> {
  try {
    return await fetchStorefrontSettings(storeHash);
  } catch (error) {
    console.error(`[huntry] storefront settings unavailable for store "${storeHash}"; using defaults.`, error);

    return { ...DEFAULT_STOREFRONT_SETTINGS };
  }
}

export async function saveStorefrontSettings(settings: StorefrontSettings, storeHash: string | undefined): Promise<void> {
  if (getDataMode() === "MOCK") {
    mockSettings = { ...settings };

    return;
  }

  const resolvedStoreHash = resolveStoreHash(storeHash);

  if (!resolvedStoreHash) {
    throw new Error("No store to save the storefront settings for.");
  }

  await getHuntryRepository().featured.saveStorefrontSettings(resolvedStoreHash, settings);
}
