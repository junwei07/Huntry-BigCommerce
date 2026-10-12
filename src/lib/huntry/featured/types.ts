// The storefront banner/CTA copy an admin can customise on the Featured tab
// (the plugin's huntry_banner_description / huntry_product_cta_title /
// huntry_product_cta_description options). An empty string always means "use
// the default copy", so a store that never saved anything and one that saved
// blanks behave identically.
export interface StorefrontSettings {
  bannerDescription: string;
  productCtaTitle: string;
  productCtaDescription: string;
}

export const DEFAULT_STOREFRONT_SETTINGS: StorefrontSettings = {
  bannerDescription: "",
  productCtaTitle: "",
  productCtaDescription: "",
};

// Placeholders shown in the admin form and used by the storefront when a
// field is blank (legacy defaults, huntry/includes/frontend/cta.php).
export const BANNER_DESCRIPTION_PLACEHOLDER = "Unlock exclusive discounts with Huntry.";
export const PRODUCT_CTA_TITLE_PLACEHOLDER = "Hunt rewards with Huntry.";
export const PRODUCT_CTA_DESCRIPTION_PLACEHOLDER = "Play Huntry and unlock exclusive discounts for this product.";

// Not stored: image storage doesn't exist yet (BC-HUN-044), so both banner
// images are fixed defaults served from this app's public/ folder.
export const DEFAULT_BANNER_IMAGE_URL = "/huntry/cookies-banner.png";
export const DEFAULT_BANNER_LOGO_URL = "/huntry-logo.png";
