import { StorefrontCtaData, StorefrontCtaEvent } from "../types";

// Pure logic behind the header banner and product CTA (BC-HUN-038), kept apart
// from the DOM code so it can be unit-tested in node. Layout and copy are a
// port of the WordPress plugin's huntry/includes/frontend/cta.php.

// The Huntry page the CTAs link to; must equal STOREFRONT_PAGE_URL in
// register-storefront-page.ts (the bundle can't import server modules; a test
// pins that they match).
export const HUNTRY_PAGE_PATH = "/huntry/";

export const DEFAULT_BANNER_TEXT = "Unlock exclusive discounts with ";
export const BRAND_WORD = "Huntry.";
export const DEFAULT_PRODUCT_TITLE = "Hunt rewards with ";
export const DEFAULT_PRODUCT_DESCRIPTION = "Play Huntry and unlock exclusive discounts for this product.";

const DARK_BASE = [0x0f, 0x13, 0x22] as const;
const HEX_COLOR = /^#([0-9a-f]{6})$/i;

export interface HeaderSlide {
  name: string;
  href: string;
  // A pure hex colour or null, for the orange brand word.
  accent: string | null;
  // A mix of the event colour into the banner's dark base, or null.
  background: string | null;
  imageUrl: string | null;
  endsAt: number | null;
}

function toTime(value: string | null): number | null {
  if (!value) return null;

  const time = new Date(value).getTime();

  return Number.isNaN(time) ? null : time;
}

export function eventHref(slug: string): string {
  return `${HUNTRY_PAGE_PATH}?event=${encodeURIComponent(slug)}`;
}

// Only plain #rrggbb colours are used (the same rule as the map chrome's
// safeColor), since they end up in an inline style.
export function toAccent(value: string | null | undefined): string | null {
  return value && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

// The event colour at 25% over the banner's dark base: the plugin derives a
// per-event "primary dark" for the slide background the same way.
export function darkenAccent(accent: string | null): string | null {
  const match = accent ? HEX_COLOR.exec(accent) : null;

  if (!match) return null;

  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  const mixed = channels.map((channel, index) => Math.round(channel * 0.25 + DARK_BASE[index] * 0.75));

  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

// One slide per live event that has not ended yet (the data is up to 30 s
// stale, and the shopper's clock may differ). Server order is kept.
export function buildSlides(data: StorefrontCtaData, now: number): HeaderSlide[] {
  return data.events
    .filter((event) => {
      const end = toTime(event.endsAt);

      return end === null || end > now;
    })
    .map((event: StorefrontCtaEvent) => {
      const accent = toAccent(event.primaryColor);

      return {
        name: event.name,
        href: eventHref(event.slug),
        accent,
        background: darkenAccent(accent),
        imageUrl: event.headerBannerUrl || data.banner.imageUrl,
        endsAt: toTime(event.endsAt),
      };
    });
}

export interface SlideState {
  // Text of the "Ends in" countdown, or null when the event has no end date.
  endsText: string | null;
  ended: boolean;
}

export function slideState(slide: HeaderSlide, now: number, format: (ms: number) => string): SlideState {
  if (slide.endsAt === null) return { endsText: null, ended: false };
  if (slide.endsAt <= now) return { endsText: null, ended: true };

  return { endsText: format(slide.endsAt - now), ended: false };
}

// A positive integer product id, or null (a malformed value must show nothing).
export function parseProductId(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;

  const id = Number(value.trim());

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// The plugin's huntry_product_has_active_reward: the store-wide reward case or
// the product being named by a reward on a live hunt.
export function productHasActiveReward(data: StorefrontCtaData, productId: number): boolean {
  if (data.events.length === 0) return false;

  return data.allProducts || data.productIds.includes(productId);
}

// CSS value for the --huntry-header-banner custom property. The URL comes from
// the server as http(s) only, but it is still escaped so a quote or bracket
// can't end the url("...") early.
export function cssUrl(url: string): string {
  return `url("${encodeURI(url).replace(/["'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}")`;
}
