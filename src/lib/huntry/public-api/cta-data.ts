import { fetchEggs } from "@/lib/huntry/eggs/eggs-api";
import { fetchEvents } from "@/lib/huntry/events/events-api";
import { fetchStorefrontSettingsOrDefaults } from "@/lib/huntry/featured/featured-api";
import { DEFAULT_BANNER_IMAGE_URL, DEFAULT_BANNER_LOGO_URL } from "@/lib/huntry/featured/types";
import { toPublicAssetUrl } from "@/lib/huntry/public-api/map-data";
import { fetchReward } from "@/lib/huntry/rewards/rewards-api";

// The public, unauthenticated shape of GET .../cta-data: what the storefront
// loader needs on every page except a hunt map to draw the header banner and the
// product-page CTA (BC-HUN-038). Built field by field from an explicit
// whitelist, like map-data. It exists separately from map-data because that
// payload carries every egg and deliberately withholds product ids, while this
// one is small enough to fetch on every page and exposes only the ids of
// products a live hunt discounts (public on the storefront anyway) — never
// coupon codes or discount details.
export interface PublicCtaEvent {
  name: string;
  slug: string;
  startsAt: Date | null;
  endsAt: Date | null;
  headerBannerUrl: string | null;
  primaryColor: string;
}

export interface PublicCtaData {
  events: PublicCtaEvent[];
  // Some reward with an egg on a live event covers the whole store.
  allProducts: boolean;
  // Products named by "specific" rewards with an egg on a live event.
  productIds: number[];
  banner: { description: string; logoUrl: string | null; imageUrl: string | null };
  productCta: { title: string; description: string };
}

export async function buildPublicCtaData(storeHash: string): Promise<PublicCtaData> {
  const [allEvents, settings] = await Promise.all([
    fetchEvents({ sort: "time" }, storeHash),
    fetchStorefrontSettingsOrDefaults(storeHash),
  ]);
  const live = allEvents.filter((event) => event.status === "live");

  const eggLists = await Promise.all(live.map((event) => fetchEggs(event.id, storeHash)));
  const rewardIds = [...new Set(eggLists.flat().map((egg) => egg.rewardId))];
  const rewards = (await Promise.all(rewardIds.map((rewardId) => fetchReward(rewardId, storeHash)))).flatMap(
    (reward) => (reward ? [reward] : []),
  );

  // Anything other than "specific" counts as "all", the plugin's own fallback
  // (huntry_product_has_active_reward).
  const allProducts = rewards.some((reward) => reward.discountScope !== "specific");
  const productIds = [
    ...new Set(rewards.filter((reward) => reward.discountScope === "specific").flatMap((reward) => reward.productIds)),
  ];

  return {
    events: live.map((event) => ({
      name: event.name,
      slug: event.slug,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      headerBannerUrl: toPublicAssetUrl(event.headerBannerUrl),
      primaryColor: event.theme.colors.primaryColor,
    })),
    allProducts,
    productIds,
    banner: {
      description: settings.bannerDescription,
      logoUrl: toPublicAssetUrl(settings.bannerLogoUrl || DEFAULT_BANNER_LOGO_URL),
      imageUrl: toPublicAssetUrl(settings.bannerImageUrl || DEFAULT_BANNER_IMAGE_URL),
    },
    productCta: { title: settings.productCtaTitle, description: settings.productCtaDescription },
  };
}
