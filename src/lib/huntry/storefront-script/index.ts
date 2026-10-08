import { fetchMapData, submitClaim } from "./api";
import { renderListing, renderNotFound } from "./cards-view";
import { loadEggFlags } from "./local-state";
import type { HuntryMapApi } from "./map/mount-map";
import { decideMode } from "./page-mode";
import { StorefrontConfig, StorefrontEvent } from "./types";

// Entry point of the storefront bundle (served by storefront-script.js/
// route.ts, which prepends window.__HUNTRY_STOREFRONT__). This loads on every
// storefront page, so it must never throw: with no config or no Huntry
// container it does nothing.
//
// The map and geolocation live in a separate, lazily loaded bundle (map/). The
// claim dialogs (BC-HUN-037) plug in through window.HuntryStorefront, the
// "huntry:ready" event and the map's "huntry:egg-nearby" event. Any
// API-sourced text they render must use textContent, never innerHTML — it is
// admin-authored and runs on the merchant's origin.
const CONTAINER_SELECTOR = "[data-huntry-map], #huntry-map";

export interface HuntryStorefrontApi {
  config: StorefrontConfig;
  container: HTMLElement;
  events: StorefrontEvent[];
  loadEggFlags: (eventId: number) => ReturnType<typeof loadEggFlags>;
  submitClaim: (eggId: string, lat: number, lng: number) => ReturnType<typeof submitClaim>;
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

function readConfig(): StorefrontConfig | null {
  const raw = window.__HUNTRY_STOREFRONT__;

  if (!raw?.appOrigin || !raw.storeHash || !raw.clientId) {
    console.warn("[Huntry] Storefront script is not configured; skipping.");

    return null;
  }

  return { appOrigin: raw.appOrigin, storeHash: raw.storeHash, clientId: raw.clientId };
}

async function start(): Promise<void> {
  const container = document.querySelector<HTMLElement>(CONTAINER_SELECTOR);

  if (!container) return;

  const config = readConfig();

  if (!config) return;

  const slug = new URLSearchParams(window.location.search).get("event")?.trim() || undefined;

  // Always the full live list, never narrowed by ?event=: the server would
  // return just that one event (or none), so the listing could not be built and
  // a mistyped slug would look like "no hunts are live". The mode is decided
  // here from the whole list instead.
  const { events } = await fetchMapData(config);
  const mode = decideMode(events, slug);

  window.HuntryStorefront = {
    config,
    container,
    events,
    loadEggFlags: (eventId) => loadEggFlags(config.storeHash, eventId),
    submitClaim: (eggId, lat, lng) => submitClaim(config, eggId, lat, lng),
  };

  window.dispatchEvent(new CustomEvent("huntry:ready", { detail: { events } }));

  switch (mode.kind) {
    case "listing":
      renderListing(container, mode.events);
      break;
    case "map":
      loadMapScript(config);
      break;
    case "not-found":
      renderNotFound(container);
      break;
  }
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
