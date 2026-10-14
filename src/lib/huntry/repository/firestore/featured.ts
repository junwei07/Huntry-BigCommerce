import type { Firestore } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/lib/firebase/admin";
import { DEFAULT_STOREFRONT_SETTINGS, StorefrontSettings } from "@/lib/huntry/featured/types";
import { storeDoc } from "@/lib/huntry/repository/firestore/paths";
import type { FeaturedRepository } from "@/lib/huntry/repository/types";

// `stores/{hash}/settings/storefront`. A missing doc, or a missing/non-string
// field, reads as the blank default, which the storefront treats as "use the
// default copy".
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createFirestoreFeaturedRepository(getDb: () => Firestore = getFirestoreDb): FeaturedRepository {
  return {
    async getStorefrontSettings(storeHash) {
      const snapshot = await storeDoc(getDb(), storeHash, "settings", "storefront").get();

      if (!snapshot.exists) {
        return { ...DEFAULT_STOREFRONT_SETTINGS };
      }

      return {
        bannerDescription: readString(snapshot.get("bannerDescription")),
        productCtaTitle: readString(snapshot.get("productCtaTitle")),
        productCtaDescription: readString(snapshot.get("productCtaDescription")),
      };
    },

    async saveStorefrontSettings(storeHash, settings: StorefrontSettings) {
      await storeDoc(getDb(), storeHash, "settings", "storefront").set({
        bannerDescription: settings.bannerDescription,
        productCtaTitle: settings.productCtaTitle,
        productCtaDescription: settings.productCtaDescription,
        updatedAt: new Date(),
      });
    },
  };
}
