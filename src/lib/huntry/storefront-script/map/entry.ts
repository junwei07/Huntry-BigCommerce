import { mountMap } from "./mount-map";

// Entry of the lazily loaded map bundle (storefront-map.js). The loader
// (../index.ts) injects this script once map-data has arrived, so
// window.HuntryStorefront is normally set already; the huntry:ready listener
// covers the other order. A failure here must never reach the merchant's page.
function boot(): void {
  const api = window.HuntryStorefront;

  if (!api) return;

  try {
    api.map = mountMap(api) ?? undefined;
  } catch (error) {
    console.error("[Huntry] Map failed to start.", error);
  }
}

if (window.HuntryStorefront) {
  boot();
} else {
  window.addEventListener("huntry:ready", boot, { once: true });
}
