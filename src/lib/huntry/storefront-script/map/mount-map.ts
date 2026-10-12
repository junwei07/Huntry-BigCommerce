import * as maplibregl from "maplibre-gl";
import type { HuntryStorefrontApi } from "../index";
import { persistFlag } from "../local-state";
import { nearestUnclaimedDistance } from "../proximity";
import { MutableEggFlags, StorefrontEgg, StorefrontEvent } from "../types";
import { enterFullscreen } from "./chrome";
import { createNearbyTracker, evaluateNearby } from "./egg-nearby";
import { describeGeolocationError } from "./geolocation";
import { HUNTRY_MAP_CSS, MAPLIBRE_CSS, WORKER_SOURCE } from "./map-assets.generated";
import { markerAppearance } from "./marker-state";
import { initialView, pickEvent } from "./view";

// Same keyless OpenFreeMap style the admin map and the legacy plugin use. The
// merchant's CSP must allow tiles.openfreemap.org and blob: workers.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

export interface HuntryMapApi {
  // The live flag sets the map's proximity checks read; mutate these, not a copy.
  flags: MutableEggFlags;
  markEggClaimed: (eggId: string) => void;
  // Rebuilds one egg's marker from its current state (e.g. after it turned out full).
  refreshMarker: (eggId: string) => void;
  rearm: () => void;
  // Latest geolocation fix, so a claim sends where the player is now rather
  // than where they were when the egg-nearby event fired.
  position: () => { lat: number; lng: number } | null;
  // Adds a control to the top-right stack (the claim UI's notification bell).
  addControl: (element: HTMLElement) => void;
  // Stops the nearest-egg readout once the player has no claims left.
  setClaimLimitReached: () => void;
  // Tears the map down and puts the container back where the theme had it.
  leave: () => void;
}

// Everything below is DOM + maplibre glue; the decisions it makes live in the
// pure modules next to it (view, marker-state, egg-nearby, geolocation).
// Text from the API is only ever set with textContent / setText, never innerHTML.
function injectStyles(): void {
  if (document.querySelector("style[data-huntry-map-css]")) return;

  const style = document.createElement("style");

  style.dataset.huntryMapCss = "";
  style.textContent = `${MAPLIBRE_CSS}\n${HUNTRY_MAP_CSS}`;
  document.head.appendChild(style);
}

// maplibre's worker is a module worker and a cross-origin URL can't be started
// directly, so the worker source is embedded in this bundle and started from a
// same-origin blob URL (see scripts/build-storefront-script.mjs).
function configureWorker(): void {
  const blob = new Blob([WORKER_SOURCE], { type: "text/javascript" });

  maplibregl.setWorkerUrl(URL.createObjectURL(blob));
}

function eggMarkerElement(iconUrl: string | null): HTMLElement | null {
  if (!iconUrl) return null;

  const element = document.createElement("div");
  const image = document.createElement("img");

  element.className = "huntry-map-pin";
  image.src = iconUrl;
  image.alt = "";
  image.draggable = false;
  element.appendChild(image);

  return element;
}

function locationMarkerElement(iconUrl: string): HTMLElement {
  const element = document.createElement("div");
  const image = document.createElement("img");

  element.className = "huntry-map-location";
  image.src = iconUrl;
  image.alt = "";
  image.draggable = false;
  element.appendChild(image);

  return element;
}

export function mountMap(api: HuntryStorefrontApi): HuntryMapApi | null {
  const { container, config } = api;

  if (container.dataset.huntryMapMounted) return null;

  const slug = new URLSearchParams(window.location.search).get("event")?.trim() || undefined;
  const event: StorefrontEvent | null = pickEvent(api.events, slug);

  if (!event) return null;

  container.dataset.huntryMapMounted = "1";
  injectStyles();
  configureWorker();

  // The Huntry page shows one event's map as a fullscreen takeover with a
  // title bar, back link and countdown (see chrome.ts); maplibre renders into
  // the map area under that bar.
  const fullscreen = enterFullscreen(container, {
    title: event.name,
    backHref: window.location.pathname,
    endsAt: event.endsAt,
    primaryColor: event.colors?.primaryColor ?? null,
  });
  const mapHost = fullscreen.mapHost;
  const flags = api.loadEggFlags(event.id) as MutableEggFlags;
  const view = initialView(event);
  const map = new maplibregl.Map({ container: mapHost, style: MAP_STYLE_URL, center: view.center, zoom: view.zoom });
  const status = document.createElement("div");
  const markers = new Map<string, maplibregl.Marker>();
  const tracker = createNearbyTracker();

  status.className = "huntry-map-status";
  status.hidden = true;
  mapHost.appendChild(status);

  const showStatus = (text: string | null, problem = false) => {
    status.hidden = text === null;
    status.textContent = text ?? "";
    status.classList.toggle("huntry-map-status--problem", problem);
  };

  const buildMarker = (egg: StorefrontEgg): maplibregl.Marker => {
    const appearance = markerAppearance(egg, event, flags.mine);
    const element = eggMarkerElement(appearance.iconUrl);
    const marker = new maplibregl.Marker(element ? { element } : { color: appearance.fallbackColor });

    marker.setLngLat([egg.lng, egg.lat]);

    if (egg.rewardName) {
      marker.setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setText(egg.rewardName));
    }

    return marker;
  };

  const refreshMarker = (eggId: string) => {
    const egg = event.eggs.find((item) => item.id === eggId);

    if (!egg) return;

    markers.get(eggId)?.remove();
    markers.set(eggId, buildMarker(egg).addTo(map));
  };

  const markEggClaimed = (eggId: string) => {
    if (!event.eggs.some((item) => item.id === eggId)) return;

    flags.mine.add(eggId);
    persistFlag(config.storeHash, event.id, "mine", flags.mine);
    refreshMarker(eggId);
  };

  let lastPosition: { lat: number; lng: number } | null = null;
  let claimLimitReached = false;

  const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showAccuracyCircle: true,
    showUserLocation: !event.locationIconUrl,
  });
  let locationMarker: maplibregl.Marker | null = null;

  map.addControl(new maplibregl.NavigationControl(), "top-right");
  map.addControl(geolocate, "top-right");

  if (event.locationIconUrl) {
    locationMarker = new maplibregl.Marker({
      element: locationMarkerElement(event.locationIconUrl),
      anchor: event.locationAnchor,
    });
  }

  geolocate.on("geolocate", (position) => {
    const { latitude, longitude } = position.coords;

    lastPosition = { lat: latitude, lng: longitude };
    locationMarker?.setLngLat([longitude, latitude]).addTo(map);

    // Out of claims: no readout and no more prompts (legacy returns early here).
    if (claimLimitReached) {
      showStatus(null);

      return;
    }

    const nearest = nearestUnclaimedDistance(event.eggs, latitude, longitude, flags);

    showStatus(nearest === null ? null : `Nearest egg: ${Math.round(nearest)} m away`);

    const change = tracker.next(evaluateNearby(event.eggs, latitude, longitude, event.markerRadiusMeters, flags));

    // `detail: null` means nothing is nearby any more; the bell badge clears on it.
    if (change.changed) {
      window.dispatchEvent(new CustomEvent("huntry:egg-nearby", { detail: change.nearby }));
    }
  });

  // A denied permission is final for this page: report it once and leave the
  // map usable, rather than re-prompting.
  geolocate.on("error", (error) => {
    showStatus(describeGeolocationError(error.code).message, true);
  });

  map.on("load", () => {
    for (const egg of event.eggs) {
      markers.set(egg.id, buildMarker(egg).addTo(map));
    }

    if (navigator.geolocation) {
      geolocate.trigger();
    } else {
      showStatus(describeGeolocationError(null).message, true);
    }
  });

  return {
    flags,
    markEggClaimed,
    refreshMarker,
    rearm: () => tracker.rearm(),
    position: () => lastPosition,
    addControl: (element) => {
      map.addControl({ onAdd: () => element, onRemove: () => element.remove() }, "top-right");
    },
    setClaimLimitReached: () => {
      claimLimitReached = true;
      showStatus(null);
    },
    leave: () => {
      map.remove();
      fullscreen.restore();
    },
  };
}
