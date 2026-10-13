import * as maplibregl from "maplibre-gl";
import { eggMarkerColor } from "@/lib/huntry/theme";

// Client-only: touches `document` and maplibre-gl, so import from "use client"
// components only. Shared by the admin Map tab and the Overview map preview.

// OpenFreeMap's hosted "bright" style — same keyless choice as the plugin's
// huntry-admin-map.js, no API key to provision/rotate per merchant.
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

// maplibre-gl resolves its Web Worker relative to import.meta.url by
// default, which Turbopack doesn't preserve as a real http(s) URL ("Worker
// failed to load"). scripts/copy-maplibre-worker.mjs copies the worker (and
// its sibling shared chunk, which it imports via a relative specifier) out
// of node_modules into this public path at dev/build time.
export const MAP_WORKER_URL = "/huntry/maplibre-worker/maplibre-gl-worker.mjs";

// Stockholm — same no-eggs-yet fallback as huntry-admin-map.js:593-602.
// Used whenever the selected event has no eggs; otherwise the egg-markers
// effect below fits the map to the placements — no event-level location
// exists (docs/MIGRATION.md §1 has no geo field on huntry_events).
export const DEFAULT_MAP_CENTER: [number, number] = [18.0686, 59.3293];
export const DEFAULT_MAP_ZOOM = 11;

// Hover popup content built as DOM (maplibre's setDOMContent) — port of the
// plugin's openEggInfoPopup: a bold title plus muted meta lines.
export function buildEggInfoContent(title: string, lines: string[]): HTMLElement {
  const root = document.createElement("div");
  const heading = document.createElement("strong");

  root.className = "huntry-map-popup";
  heading.textContent = title;
  root.append(heading);

  for (const line of lines) {
    const meta = document.createElement("div");

    meta.className = "huntry-map-popup__meta";
    meta.textContent = line;
    root.append(meta);
  }

  return root;
}

// Port of buildEggMarkerElement() (huntry-admin-map.js:194-213): the event's
// item icon with a small reward-colored badge. With no icon configured, falls
// back to maplibre's stock pin in the reward color.
export function eggMarkerOptions(itemMarkerUrl: string | null, rewardId: number): maplibregl.MarkerOptions {
  if (!itemMarkerUrl) {
    return { color: eggMarkerColor(rewardId) };
  }

  const element = document.createElement("div");
  const image = document.createElement("img");
  const badge = document.createElement("span");

  // No `position` here: maplibre's .maplibregl-marker is position:absolute and
  // is placed only via transform, so overriding it (e.g. relative) puts the
  // marker in normal flow and offsets it by a fixed number of pixels. The badge
  // below still anchors to this element because absolute is a positioned value.
  element.style.cssText = "width:40px;height:40px;cursor:pointer";
  image.src = itemMarkerUrl;
  image.alt = "";
  image.draggable = false;
  image.style.cssText = "width:100%;height:100%;object-fit:contain;display:block";
  badge.style.cssText = `position:absolute;right:0px;top:-1px;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-sizing:border-box;background:${eggMarkerColor(rewardId)}`;
  element.append(image, badge);

  return { element };
}

// Fits the map to an event's eggs (or the no-eggs fallback view).
export function fitMapToEggs(map: maplibregl.Map, eggs: { lat: number; lng: number }[]): void {
  if (eggs.length === 0) {
    map.jumpTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();

  for (const egg of eggs) {
    bounds.extend([egg.lng, egg.lat]);
  }

  map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
}
