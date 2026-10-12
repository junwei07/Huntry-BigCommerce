import type { HuntryStorefrontApi } from "../index";
import type { EggNearby } from "../map/egg-nearby";
import { pickEvent } from "../map/view";
import { createClaimController } from "./controller";
import { createDomUi } from "./dom-ui";

// Starts the claim dialogs for the one event this page shows. Called by the
// loader in map mode; the map bundle arrives later, so the controller reads
// api.map lazily and the bell is added when the map announces itself with
// "huntry:map-ready" (or immediately if it already has).
export function startClaimUi(api: HuntryStorefrontApi): void {
  const slug = new URLSearchParams(window.location.search).get("event")?.trim() || undefined;
  const event = pickEvent(api.events, slug);

  if (!event) return;

  const controller: { current?: ReturnType<typeof createClaimController> } = {};
  const ui = createDomUi({
    container: api.container,
    successColor: event.colors?.successColor ?? null,
    backHref: window.location.pathname,
    onBellClick: () => controller.current?.openRevisit(),
    addMapControl: (element) => api.map?.addControl(element),
  });

  controller.current = createClaimController(api, event, ui);

  const mountBell = () => {
    if (api.map) ui.mountBell();
  };

  window.addEventListener("huntry:egg-nearby", (domEvent) => {
    mountBell();
    controller.current?.handleNearby((domEvent as CustomEvent<EggNearby | null>).detail);
  });
  window.addEventListener("huntry:map-ready", mountBell);
  mountBell();
}
