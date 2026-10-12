import { fetchCtaData } from "../api";
import { StorefrontConfig } from "../types";
import { mountHeaderBanner } from "./header-banner";
import { mountProductCta } from "./product-cta";

// BC-HUN-038: the header banner and product-page CTA, run on every storefront
// page except a hunt map (the Huntry listing and My Rewards keep them). Decoration
// only, so it never throws and never touches the Huntry container (no
// showLoadError path).
export async function startCtas(config: StorefrontConfig): Promise<void> {
  try {
    const data = await fetchCtaData(config);

    if (!data || data.events.length === 0) return;

    mountHeaderBanner(data);
    mountProductCta(data);
  } catch (error) {
    console.error("[Huntry] Banner/CTA failed to start.", error);
  }
}
