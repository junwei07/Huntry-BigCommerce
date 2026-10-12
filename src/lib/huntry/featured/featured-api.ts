import { DatabaseSync } from "node:sqlite";
import { getDataMode, resolveStoreHash } from "@/lib/bc-api-client/resolve-store-credentials";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { storefrontSettingsTag } from "@/lib/huntry/featured/cache-tags";
import { DEFAULT_STOREFRONT_SETTINGS, StorefrontSettings } from "@/lib/huntry/featured/types";

// @cache-components-only:drop-specifier cacheProfile
import { cacheProfile, CACHE_PROFILE_STANDARD } from "@/lib/cache/cache-profiles";

// @cache-components-only:start
import { cacheLife, cacheTag } from "next/cache";
// @cache-components-only:end

interface SettingsRow {
  banner_description: string;
  product_cta_title: string;
  product_cta_description: string;
}

function normalizeRow(row: SettingsRow | undefined): StorefrontSettings {
  if (!row) {
    return { ...DEFAULT_STOREFRONT_SETTINGS };
  }

  return {
    bannerDescription: row.banner_description,
    productCtaTitle: row.product_cta_title,
    productCtaDescription: row.product_cta_description,
  };
}

async function selectSettingsRow(storeHash: string): Promise<StorefrontSettings> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db
      .prepare(
        "SELECT banner_description, product_cta_title, product_cta_description FROM huntry_storefront_settings WHERE store_hash = ?",
      )
      .get(storeHash) as SettingsRow | undefined;

    return normalizeRow(row);
  }

  const result = await db.query<SettingsRow>(
    "SELECT banner_description, product_cta_title, product_cta_description FROM huntry_storefront_settings WHERE store_hash = $1",
    [storeHash],
  );

  return normalizeRow(result.rows[0]);
}

async function fetchSettingsFromDb(storeHash: string): Promise<StorefrontSettings> {
  // @cache-components-only:start
  "use cache: remote";
  cacheLife(cacheProfile(CACHE_PROFILE_STANDARD));
  cacheTag(storefrontSettingsTag(storeHash));
  // @cache-components-only:end

  return selectSettingsRow(storeHash);
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

  return resolvedStoreHash ? selectSettingsRow(resolvedStoreHash) : { ...DEFAULT_STOREFRONT_SETTINGS };
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

async function upsertSettingsRow(settings: StorefrontSettings, storeHash: string): Promise<void> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    db.prepare(
      `INSERT INTO huntry_storefront_settings
        (store_hash, banner_description, product_cta_title, product_cta_description, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (store_hash) DO UPDATE SET
         banner_description = excluded.banner_description,
         product_cta_title = excluded.product_cta_title,
         product_cta_description = excluded.product_cta_description,
         updated_at = excluded.updated_at`,
    ).run(storeHash, settings.bannerDescription, settings.productCtaTitle, settings.productCtaDescription);

    return;
  }

  await db.query(
    `INSERT INTO huntry_storefront_settings
      (store_hash, banner_description, product_cta_title, product_cta_description, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (store_hash) DO UPDATE SET
       banner_description = EXCLUDED.banner_description,
       product_cta_title = EXCLUDED.product_cta_title,
       product_cta_description = EXCLUDED.product_cta_description,
       updated_at = EXCLUDED.updated_at`,
    [storeHash, settings.bannerDescription, settings.productCtaTitle, settings.productCtaDescription],
  );
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

  await upsertSettingsRow(settings, resolvedStoreHash);
}
