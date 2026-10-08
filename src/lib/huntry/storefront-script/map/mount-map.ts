import * as maplibregl from "maplibre-gl";
import type { HuntryStorefrontApi } from "../index";
import { persistFlag } from "../local-state";
import { nearestUnclaimedDistance } from "../proximity";
import { StorefrontEgg, StorefrontEvent } from "../types";
import { enterFullscreen } from "./chrome";
import { createNearbyTracker, evaluateNearby } from "./egg-nearby";
import { describeGeolocationError } from "./geolocation";
import { MAPLIBRE_CSS, WORKER_SOURCE } from "./map-assets.generated";
import { markerAppearance } from "./marker-state";
import { HUNTRY_MAP_CSS } from "./styles";
import { initialView, pickEvent } from "./view";

// Same keyless OpenFreeMap style the admin map and the legacy plugin use. The
// merchant's CSP must allow tiles.openfreemap.org and blob: workers.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

export interface HuntryMapApi {
  markEggClaimed: (eggId: string) => void;
  rearm: () => void;
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
  const flags = api.loadEggFlags(event.id);
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

  const markEggClaimed = (eggId: string) => {
    const egg = event.eggs.find((item) => item.id === eggId);

    if (!egg) return;

    (flags.mine as Set<string>).add(eggId);
    persistFlag(config.storeHash, event.id, "mine", flags.mine);
    markers.get(eggId)?.remove();

    const marker = buildMarker(egg).addTo(map);

    markers.set(eggId, marker);
  };

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

    locationMarker?.setLngLat([longitude, latitude]).addTo(map);

    const nearest = nearestUnclaimedDistance(event.eggs, latitude, longitude, flags);

    showStatus(nearest === null ? null : `Nearest egg: ${Math.round(nearest)} m away`);

    const nearby = tracker.next(evaluateNearby(event.eggs, latitude, longitude, event.markerRadiusMeters, flags));

    if (nearby) {
      window.dispatchEvent(new CustomEvent("huntry:egg-nearby", { detail: nearby }));
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
    markEggClaimed,
    rearm: () => tracker.rearm(),
    leave: () => {
      map.remove();
      fullscreen.restore();
    },
  };
}
