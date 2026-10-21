import { DatabaseSync } from "node:sqlite";
import { getHuntryDb } from "@/lib/huntry/db/get-db";
import { DEFAULT_STOREFRONT_SETTINGS, StorefrontSettings } from "@/lib/huntry/featured/types";
import type { FeaturedRepository } from "@/lib/huntry/repository/types";

interface SettingsRow {
  banner_description: string;
  product_cta_title: string;
  product_cta_description: string;
  banner_logo_url: string;
  banner_image_url: string;
}

function normalizeRow(row: SettingsRow | undefined): StorefrontSettings {
  if (!row) {
    return { ...DEFAULT_STOREFRONT_SETTINGS };
  }

  return {
    bannerDescription: row.banner_description,
    productCtaTitle: row.product_cta_title,
    productCtaDescription: row.product_cta_description,
    bannerLogoUrl: row.banner_logo_url,
    bannerImageUrl: row.banner_image_url,
  };
}

async function selectSettingsRow(storeHash: string): Promise<StorefrontSettings> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    const row = db
      .prepare(
        "SELECT banner_description, product_cta_title, product_cta_description, banner_logo_url, banner_image_url FROM huntry_storefront_settings WHERE store_hash = ?",
      )
      .get(storeHash) as SettingsRow | undefined;

    return normalizeRow(row);
  }

  const result = await db.query<SettingsRow>(
    "SELECT banner_description, product_cta_title, product_cta_description, banner_logo_url, banner_image_url FROM huntry_storefront_settings WHERE store_hash = $1",
    [storeHash],
  );

  return normalizeRow(result.rows[0]);
}

async function upsertSettingsRow(settings: StorefrontSettings, storeHash: string): Promise<void> {
  const db = getHuntryDb();

  if (db instanceof DatabaseSync) {
    db.prepare(
      `INSERT INTO huntry_storefront_settings
        (store_hash, banner_description, product_cta_title, product_cta_description, banner_logo_url, banner_image_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (store_hash) DO UPDATE SET
         banner_description = excluded.banner_description,
         product_cta_title = excluded.product_cta_title,
         product_cta_description = excluded.product_cta_description,
         banner_logo_url = excluded.banner_logo_url,
         banner_image_url = excluded.banner_image_url,
         updated_at = excluded.updated_at`,
    ).run(
      storeHash,
      settings.bannerDescription,
      settings.productCtaTitle,
      settings.productCtaDescription,
      settings.bannerLogoUrl,
      settings.bannerImageUrl,
    );

    return;
  }

  await db.query(
    `INSERT INTO huntry_storefront_settings
      (store_hash, banner_description, product_cta_title, product_cta_description, banner_logo_url, banner_image_url, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (store_hash) DO UPDATE SET
       banner_description = EXCLUDED.banner_description,
       product_cta_title = EXCLUDED.product_cta_title,
       product_cta_description = EXCLUDED.product_cta_description,
       banner_logo_url = EXCLUDED.banner_logo_url,
       banner_image_url = EXCLUDED.banner_image_url,
       updated_at = EXCLUDED.updated_at`,
    [
      storeHash,
      settings.bannerDescription,
      settings.productCtaTitle,
      settings.productCtaDescription,
      settings.bannerLogoUrl,
      settings.bannerImageUrl,
    ],
  );
}

export const sqlFeaturedRepository: FeaturedRepository = {
  getStorefrontSettings: selectSettingsRow,
  saveStorefrontSettings: (storeHash, settings) => upsertSettingsRow(settings, storeHash),
};
