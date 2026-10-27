import { fetchMapData, fetchMyRewards, fetchPlayerStatus, isLoggedIn, submitClaim } from "./api";
import { isCartPage, startCartGuard } from "./cart-guard";
import { isCheckoutArea, isCheckoutPage, startCheckoutGuard } from "./checkout-guard";
import { listingUrl, renderListing, renderNotFound } from "./cards-view";
import { startClaimUi } from "./claim-ui";
import { startCtas } from "./cta";
import { showHuntFullPrompt, showJoinPrompt } from "./claim-ui/dom-ui";
import { loadEggFlags } from "./local-state";
import { enterFullscreen } from "./map/chrome";
import type { HuntryMapApi } from "./map/mount-map";
import { decideMode, readView } from "./page-mode";
import { renderRewards } from "./rewards-view";
import { StorefrontConfig, StorefrontEvent } from "./types";

// Entry point of the storefront bundle (served by storefront-script.js/
// route.ts, which prepends window.__HUNTRY_STOREFRONT__). This loads on every
// storefront page, so it must never throw: with no config or no Huntry
// container it does nothing.
//
// The map and geolocation live in a separate, lazily loaded bundle (map/). The
// claim dialogs (claim-ui/, BC-HUN-037) are part of this loader and plug in
// through window.HuntryStorefront.map and the map's "huntry:egg-nearby" /
// "huntry:map-ready" events. Any API-sourced text they render must use
// textContent, never innerHTML — it is admin-authored and runs on the
// merchant's origin.
const CONTAINER_SELECTOR = "[data-huntry-map], #huntry-map";

export interface HuntryStorefrontApi {
  config: StorefrontConfig;
  container: HTMLElement;
  events: StorefrontEvent[];
  loadEggFlags: (eventId: number) => ReturnType<typeof loadEggFlags>;
  submitClaim: (eggId: string, lat: number, lng: number) => ReturnType<typeof submitClaim>;
  fetchMyRewards: () => ReturnType<typeof fetchMyRewards>;
  // Set by the map bundle (map/entry.ts) once the map is mounted.
  map?: HuntryMapApi;
}

// maplibre is ~1 MB, so the map is its own script: pages without a Huntry
// container, or with no live events, never download it. Idempotent so a
// double-loaded loader can't mount two maps.
function loadMapScript(config: StorefrontConfig): void {
  if (document.querySelector("script[data-huntry-map-script]")) return;

  const script = document.createElement("script");

  script.src = `${config.appOrigin}/api/public/huntry/${encodeURIComponent(config.storeHash)}/storefront-map.js`;
  script.async = true;
  script.dataset.huntryMapScript = "";
  document.head.appendChild(script);
}

declare global {
  interface Window {
    __HUNTRY_STOREFRONT__?: Partial<StorefrontConfig> | null;
    HuntryStorefront?: HuntryStorefrontApi;
  }
}

// `warn` is off for the pages without a Huntry container, which would
// otherwise log the same warning on every storefront page of an unconfigured
// store.
function readConfig(warn = true): StorefrontConfig | null {
  const raw = window.__HUNTRY_STOREFRONT__;

  if (!raw?.appOrigin || !raw.storeHash || !raw.clientId) {
    if (warn) console.warn("[Huntry] Storefront script is not configured; skipping.");

    return null;
  }

  return { appOrigin: raw.appOrigin, storeHash: raw.storeHash, clientId: raw.clientId };
}

async function start(): Promise<void> {
  // The script is registered for all pages (BC-HUN-051), so it also loads on the
  // checkout and the order confirmation. There it only runs the coupon guard on
  // the checkout itself — never the map, banner or CTAs.
  if (isCheckoutArea(window.location.pathname)) {
    const checkoutConfig = isCheckoutPage(window.location.pathname) ? readConfig(false) : null;

    if (checkoutConfig) startCheckoutGuard(checkoutConfig);

    return;
  }

  const container = document.querySelector<HTMLElement>(CONTAINER_SELECTOR);
  const config = readConfig(Boolean(container));

  if (!config) return;

  // Pages without a Huntry container get the header banner and product CTA
  // (BC-HUN-038). The Huntry page gets the banner too, except on a hunt map
  // (see the end of this function), like the plugin.
  if (!container) {
    // The cart page also gets the coupon-ownership guard (BC-HUN-050).
    if (isCartPage(window.location.pathname)) startCartGuard(config);

    await startCtas(config);

    return;
  }

  const params = new URLSearchParams(window.location.search);
  const slug = params.get("event")?.trim() || undefined;
  const view = readView(window.location.search, window.location.hash);

  // Always the full live list, never narrowed by ?event=: the server would
  // return just that one event (or none), so the listing could not be built and
  // a mistyped slug would look like "no hunts are live". The mode is decided
  // here from the whole list instead.
  const { events } = await fetchMapData(config);
  const mode = decideMode(events, slug, view);

  window.HuntryStorefront = {
    config,
    container,
    events,
    loadEggFlags: (eventId) => loadEggFlags(config.storeHash, eventId),
    submitClaim: (eggId, lat, lng) => submitClaim(config, eggId, lat, lng),
    fetchMyRewards: () => fetchMyRewards(config),
  };

  window.dispatchEvent(new CustomEvent("huntry:ready", { detail: { events } }));

  switch (mode.kind) {
    case "listing":
      renderListing(container, mode.events);
      break;
    case "map":
      // A live event's map is for signed-in customers only. Guests get the
      // fullscreen hunt shell (title bar, back link, countdown) with the login
      // prompt on top, and never download maplibre. Client-side only, like the
      // plugin: the coordinates are still in the public map-data.
      if (!(await isLoggedIn(config))) {
        enterFullscreen(container, {
          title: mode.event.name,
          backHref: listingUrl(),
          endsAt: mode.event.endsAt,
          primaryColor: mode.event.colors?.primaryColor ?? null,
        });
        showJoinPrompt(mode.event.colors?.successColor ?? null);
        break;
      }

      // A full hunt is closed to customers who hold no claim yet (the claims
      // route enforces the same cap). Block before the map downloads.
      if ((await fetchPlayerStatus(config, mode.event.id)).full) {
        enterFullscreen(container, {
          title: mode.event.name,
          backHref: listingUrl(),
          endsAt: mode.event.endsAt,
          primaryColor: mode.event.colors?.primaryColor ?? null,
        });
        showHuntFullPrompt(listingUrl(), mode.event.colors?.successColor ?? null);
        break;
      }

      loadMapScript(config);

      // The dialogs are an add-on to the map: if they fail to start the map
      // must still work.
      try {
        startClaimUi(window.HuntryStorefront);
      } catch (error) {
        console.error("[Huntry] Claim dialogs failed to start.", error);
      }

      break;
    case "rewards":
      renderRewards(container, await fetchMyRewards(config));
      break;
    case "not-found":
      renderNotFound(container);
      break;
  }

  // The hunts list, My Rewards and the not-found message are ordinary theme
  // pages and keep the banner; only the hunt map, a fullscreen takeover that
  // covers the theme header, goes without (huntry/includes/frontend/cta.php:80-85,
  // map.php:80-86). After the page has rendered so the extra request never
  // delays it.
  if (mode.kind !== "map") await startCtas(config);
}

function showLoadError(): void {
  const container = document.querySelector<HTMLElement>(CONTAINER_SELECTOR);

  if (container && !container.dataset.huntryMapMounted) {
    container.textContent = "Huntry couldn't load right now. Please try again later.";
  }
}

function run(): void {
  start().catch((error) => {
    console.error("[Huntry] Storefront script failed to start.", error);
    showLoadError();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", run);
} else {
  run();
}
