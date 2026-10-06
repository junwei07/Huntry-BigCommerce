"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import "@/components/huntry/map/egg-marker.css";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as maplibregl from "maplibre-gl";
import { Box, Button, Flex, Text } from "@bigcommerce/big-design";
import { FormSelect } from "@/components/ui/form-select";
import {
  deleteHuntryEgg,
  saveHuntryEggPlacements,
  updateHuntryEgg,
} from "@/app/store/[storeHash]/huntry/map/actions";
import { runServerAction, showErrorAlert } from "@/components/ui/action-alerts";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { useStoreHash } from "@/components/ui/store-hash-context";
import { buildMapSearchParams } from "@/lib/huntry/map/query";
import {
  isGeolocateRelayMessage,
  isGeolocationAllowedInFrame,
  isGeolocationPolicyError,
} from "@/lib/huntry/map/geolocate-relay";
import { HuntryGeolocateControl } from "@/components/huntry/map/geolocate-control";
import {
  EggDeleteDialog,
  EggLimitDialog,
  EggProximityDialog,
  UnsavedChangesDialog,
} from "@/components/huntry/map/egg-dialogs";
import { EggItemsPanel } from "@/components/huntry/map/egg-items-panel";
import { EggPlaceDialog, RewardChoice } from "@/components/huntry/map/egg-place-dialog";
import { circleRing, isFarEnough } from "@/lib/huntry/eggs/geo";
import { MAX_EGGS_PER_EVENT, MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import { locationMarkerAnchor, resolveItemMarkerUrl, resolveLocationMarkerUrl } from "@/lib/huntry/events/marker-urls";
import { HuntryEvent } from "@/lib/huntry/events/types";
import { HuntryReward } from "@/lib/huntry/rewards/types";
import { eggMarkerColor, HUNTRY_COLORS } from "@/lib/huntry/theme";

type Dialog =
  | { kind: "place"; lat: number; lng: number }
  | { kind: "edit"; egg: HuntryEgg }
  | { kind: "delete"; egg: HuntryEgg }
  | { kind: "limit" }
  | { kind: "proximity" }
  | { kind: "unsaved"; onLeave: () => void };

// "Edit Location" mode: the egg's own marker becomes draggable on the
// full-screen map; confirm saves lat/lng (plus any name/reward edits carried
// over from the Edit dialog) via updateHuntryEgg, which preserves the egg id.
interface EditLocation {
  egg: HuntryEgg;
  name: string;
  rewardId: number;
  lat: number;
  lng: number;
  valid: boolean;
}

const RADIUS_SOURCE_ID = "huntry-egg-radius";

// How long the marker pulse / panel row highlight lasts (plugin: 2400 ms).
const HIGHLIGHT_MS = 2400;

// Hover popup content built as DOM (maplibre's setDOMContent) — port of the
// plugin's openEggInfoPopup: a bold title plus muted meta lines.
function buildEggInfoContent(title: string, lines: string[]): HTMLElement {
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
function eggMarkerOptions(itemMarkerUrl: string | null, rewardId: number): maplibregl.MarkerOptions {
  if (!itemMarkerUrl) {
    return { color: eggMarkerColor(rewardId) };
  }

  const element = document.createElement("div");
  const image = document.createElement("img");
  const badge = document.createElement("span");

  element.style.cssText = "position:relative;width:40px;height:40px;cursor:pointer";
  image.src = itemMarkerUrl;
  image.alt = "";
  image.draggable = false;
  image.style.cssText = "width:100%;height:100%;object-fit:contain;display:block";
  badge.style.cssText = `position:absolute;right:0px;top:-1px;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-sizing:border-box;background:${eggMarkerColor(rewardId)}`;
  element.append(image, badge);

  return { element };
}

function locationMarkerElement(url: string): HTMLImageElement {
  const image = document.createElement("img");

  image.src = url;
  image.alt = "";
  image.draggable = false;
  image.style.cssText = "width:36px;height:36px;object-fit:contain;display:block";

  return image;
}

// OpenFreeMap's hosted "bright" style — same keyless choice as the plugin's
// huntry-admin-map.js, no API key to provision/rotate per merchant.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";

// maplibre-gl resolves its Web Worker relative to import.meta.url by
// default, which Turbopack doesn't preserve as a real http(s) URL ("Worker
// failed to load"). scripts/copy-maplibre-worker.mjs copies the worker (and
// its sibling shared chunk, which it imports via a relative specifier) out
// of node_modules into this public path at dev/build time.
const MAP_WORKER_URL = "/huntry/maplibre-worker/maplibre-gl-worker.mjs";

// Stockholm — same no-eggs-yet fallback as huntry-admin-map.js:593-602.
// Used whenever the selected event has no eggs; otherwise the egg-markers
// effect below fits the map to the placements — no event-level location
// exists (docs/MIGRATION.md §1 has no geo field on huntry_events).
const DEFAULT_MAP_CENTER: [number, number] = [18.0686, 59.3293];
const DEFAULT_MAP_ZOOM = 11;

export function MapPlacementView({
  events,
  selectedEventId,
  eggs,
  rewards,
  rewardEggCounts,
  sponsorNames,
}: {
  events: HuntryEvent[];
  selectedEventId: number | null;
  eggs: HuntryEgg[];
  rewards: HuntryReward[];
  // reward id -> eggs it has across every event (what egg_capacity bounds).
  rewardEggCounts: Record<number, number>;
  sponsorNames: Record<number, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const storeHash = useStoreHash();
  const [isPending, startTransition] = useGlobalTransition();
  // Plain transition for the egg mutations' own button spinners — the global
  // overlay is reserved for navigation (event switch).
  const [isSaving, startSaving] = useTransition();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const locationMarkerRef = useRef<maplibregl.Marker | null>(null);
  // Full-screen placement mode (huntry-admin-map.js's .is-fullscreen). New
  // placements queue in `pending` and are committed in one Server Action
  // when the admin clicks Stop Placing; edit/delete commit immediately.
  const [isPlacing, setIsPlacing] = useState(false);
  const [pending, setPending] = useState<PendingEgg[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [editLocation, setEditLocation] = useState<EditLocation | null>(null);
  const eggMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const infoPopupRef = useRef<maplibregl.Popup | null>(null);
  const pulsedElementRef = useRef<HTMLElement | null>(null);
  const pulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Marker click -> the egg's row in the panel scrolls into view and highlights.
  const [highlight, setHighlight] = useState<{ eggId: string; token: number } | null>(null);
  // The map's click listener is registered once (in the map-creation effect);
  // it calls through this ref so it always sees the latest state.
  const mapClickRef = useRef<(event: maplibregl.MapMouseEvent) => void>(() => undefined);
  const isFullscreen = isPlacing || editLocation !== null;
  const selectedEvent = events.find((event) => event.id === selectedEventId);
  const markerRadiusMeters = selectedEvent?.markerRadiusMeters ?? 20;
  const claimCapacity = selectedEvent?.eggClaimCapacity ?? 1;
  const itemMarkerUrl = selectedEvent ? resolveItemMarkerUrl(selectedEvent.theme.itemMarker) : null;
  const locationMarkerUrl = selectedEvent ? resolveLocationMarkerUrl(selectedEvent.theme.locationMarker) : null;
  const locationAnchor = selectedEvent ? locationMarkerAnchor(selectedEvent.theme.locationMarker) : "center";
  // showLocation is called from long-lived listeners, so it reads the current
  // icon through a ref instead of closing over a stale one.
  const locationIconRef = useRef({ url: locationMarkerUrl, anchor: locationAnchor });
  const geolocateControlRef = useRef<HuntryGeolocateControl | null>(null);
  const locatePopupRef = useRef<Window | null>(null);
  const locatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const resetLocating = useCallback(() => {
    if (locatePollRef.current) {
      clearInterval(locatePollRef.current);
      locatePollRef.current = null;
    }

    locatePopupRef.current = null;
  }, []);

  const showLocation = useCallback((lat: number, lng: number) => {
    geolocateControlRef.current?.setState("success");

    const map = mapRef.current;

    if (!map) {
      return;
    }

    map.flyTo({ center: [lng, lat], zoom: 15 });

    if (locationMarkerRef.current) {
      locationMarkerRef.current.setLngLat([lng, lat]);
    } else {
      const { url, anchor } = locationIconRef.current;

      locationMarkerRef.current = new maplibregl.Marker(
        url ? { element: locationMarkerElement(url), anchor } : undefined,
      )
        .setLngLat([lng, lat])
        .addTo(map);
    }
  }, []);

  // A different event may use a different icon: drop the old marker so the
  // next location fix recreates it (it's also repositioned by showLocation).
  useEffect(() => {
    locationIconRef.current = { url: locationMarkerUrl, anchor: locationAnchor };

    const previous = locationMarkerRef.current;

    if (!previous) {
      return;
    }

    const { lng, lat } = previous.getLngLat();
    const map = mapRef.current;

    previous.remove();
    locationMarkerRef.current = null;

    if (map) {
      locationMarkerRef.current = new maplibregl.Marker(
        locationMarkerUrl ? { element: locationMarkerElement(locationMarkerUrl), anchor: locationAnchor } : undefined,
      )
        .setLngLat([lng, lat])
        .addTo(map);
    }
  }, [locationMarkerUrl, locationAnchor]);

  // Fallback for when the embedding <iframe> lacks allow="geolocation": opens
  // /geolocate-relay as its own top-level browsing context, which isn't
  // subject to the iframe's Permissions Policy. See geolocate-relay-view.tsx
  // for the popup's side of this.
  //
  // Also attempted automatically on mount: the browser only allows it with
  // transient user activation (e.g. the click on the in-app Map nav item,
  // which lasts a few seconds) or a site-level "allow pop-ups" setting. When
  // it's blocked, an auto attempt fails quietly and the crosshair stays the
  // way in; only a click gets the "allow pop-ups" alert.
  const openRelayPopup = useCallback((userInitiated: boolean) => {
    const popup = window.open("/geolocate-relay", "huntry-geolocate", "width=420,height=280");

    if (!popup) {
      geolocateControlRef.current?.setState("idle");

      if (userInitiated) {
        showErrorAlert("Allow pop-ups for this site to share your location.");
      } else if (process.env.NODE_ENV !== "production") {
        console.info("[map] auto location popup was blocked; waiting for a click on the location button");
      }

      return;
    }

    geolocateControlRef.current?.setState("waiting");
    locatePopupRef.current = popup;

    // The popup carries no session/auth, so the only way to know the admin
    // closed it without answering the browser's permission prompt (no
    // message will ever arrive in that case) is to poll .closed —
    // same-origin popup, so this is allowed.
    locatePollRef.current = setInterval(() => {
      if (locatePopupRef.current?.closed) {
        resetLocating();
        geolocateControlRef.current?.setState("idle");
      }
    }, 500);
  }, [resetLocating]);

  // Tries navigator.geolocation in this frame first so the browser's
  // permission prompt appears right here. Only when the browser reports the
  // frame is blocked (BigCommerce's cross-origin <iframe> lacking
  // allow="geolocation", which we can't set) does it fall back to the popup
  // relay.
  const triggerLocate = useCallback(
    (userInitiated: boolean) => {
      const control = geolocateControlRef.current;

      if (!navigator.geolocation) {
        control?.setState("error");
        return;
      }

      const frameAllowed = isGeolocationAllowedInFrame();

      if (process.env.NODE_ENV !== "production" && !userInitiated) {
        console.info("[map] geolocation allowed in this frame:", frameAllowed);
      }

      if (frameAllowed === false) {
        openRelayPopup(userInitiated);
        return;
      }

      control?.setState("waiting");

      const handleError = (error: GeolocationPositionError) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[map] geolocation failed", { code: error.code, message: error.message, frameAllowed });
        }

        // Frame blocked (no policy API to say so up front, but the browser's
        // message does): only the popup can get a prompt.
        if (isGeolocationPolicyError(error)) {
          openRelayPopup(userInitiated);
          return;
        }

        control?.setState("error");

        if (!userInitiated) {
          return;
        }

        if (error.code === error.PERMISSION_DENIED) {
          showErrorAlert("Location is blocked. Allow it in your browser's site settings and your system's location services.");
        } else if (error.code === error.TIMEOUT) {
          showErrorAlert("Finding your location timed out. Try again.");
        } else {
          showErrorAlert("Your device couldn't determine its location.");
        }
      };

      // Coarse + cached first: fast, and plenty to centre the map. High
      // accuracy with no timeout is what tends to hang or fail on Windows,
      // so it's only the retry for POSITION_UNAVAILABLE/TIMEOUT.
      const locate = (enableHighAccuracy: boolean) => {
        navigator.geolocation.getCurrentPosition(
          (position) => showLocation(position.coords.latitude, position.coords.longitude),
          (error) => {
            if (!enableHighAccuracy && error.code !== error.PERMISSION_DENIED) {
              locate(true);
              return;
            }

            handleError(error);
          },
          enableHighAccuracy
            ? { enableHighAccuracy: true, timeout: 15000 }
            : { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
        );
      };

      locate(false);
    },
    [openRelayPopup, showLocation],
  );

  useEffect(() => {
    if (!mapContainerRef.current) {
      return;
    }

    maplibregl.setWorkerUrl(MAP_WORKER_URL);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl());

    map.on("click", (event) => mapClickRef.current(event));

    const geolocateControl = new HuntryGeolocateControl(() => triggerLocate(true));

    map.addControl(geolocateControl, "top-right");
    geolocateControlRef.current = geolocateControl;

    mapRef.current = map;

    // Attempt the fetch automatically, same as the WP plugin's
    // geolocate.trigger() (huntry-admin-map.js:1706-1733). Fired on mount
    // rather than the map's "load" event: geolocation doesn't need the style
    // loaded, flyTo/Marker work before it, and "load" can be late or lost to
    // an effect re-run. If the frame is blocked this auto-opens the relay
    // popup (see openRelayPopup); the icon above is the fallback when the
    // browser blocks that.
    triggerLocate(false);

    return () => {
      mapRef.current = null;
      geolocateControlRef.current = null;
      map.remove();
    };
  }, [triggerLocate]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== locatePopupRef.current ||
        !isGeolocateRelayMessage(event.data)
      ) {
        return;
      }

      resetLocating();

      if (event.data.status === "error") {
        geolocateControlRef.current?.setState("error");
        showErrorAlert("Couldn't get your location.");
        return;
      }

      showLocation(event.data.lat, event.data.lng);
    };

    window.addEventListener("message", handleMessage);

    return () => window.removeEventListener("message", handleMessage);
  }, [resetLocating, showLocation]);

  const openEdit = useCallback((egg: HuntryEgg) => setDialog({ kind: "edit", egg }), []);
  const openDelete = useCallback((egg: HuntryEgg) => setDialog({ kind: "delete", egg }), []);

  // Latest data for the hover popup, read at hover time through a ref so the
  // marker effect below only re-runs when the eggs themselves change (a
  // re-run would drop a marker that is mid-drag in Edit Location mode).
  const infoContextRef = useRef({
    rewards,
    rewardEggCounts,
    sponsorNames,
    pending,
    claimCapacity,
    isEditingLocation: false,
  });

  useEffect(() => {
    infoContextRef.current = {
      rewards,
      rewardEggCounts,
      sponsorNames,
      pending,
      claimCapacity,
      isEditingLocation: editLocation !== null,
    };
  });

  const closeInfoPopup = useCallback(() => {
    infoPopupRef.current?.remove();
    infoPopupRef.current = null;
  }, []);

  // Port of the plugin's openEggInfoPopup: reward, sponsor, eggs placed,
  // claims (always 0 until BC-HUN-032) and coordinates. No close button — it
  // only ever opens/closes with the marker's mouseenter/mouseleave.
  const showEggInfo = useCallback(
    (egg: HuntryEgg) => {
      const map = mapRef.current;
      const context = infoContextRef.current;

      // Suppressed while repositioning — it would just clutter the drag view.
      if (!map || context.isEditingLocation) {
        return;
      }

      closeInfoPopup();

      const reward = context.rewards.find((item) => item.id === egg.rewardId);
      const queued = context.pending.filter((item) => item.rewardId === egg.rewardId).length;
      const sponsor = reward?.sponsorId == null ? null : (context.sponsorNames[reward.sponsorId] ?? null);
      const lines = [
        `Reward: ${reward?.name ?? "Unknown reward"}`,
        `Sponsor: ${sponsor ?? "-"}`,
        ...(reward ? [`Eggs Placed: ${(context.rewardEggCounts[reward.id] ?? 0) + queued}/${reward.eggCapacity}`] : []),
        `Claims: 0/${context.claimCapacity}`,
        `Lat: ${egg.lat.toFixed(6)}, Lng: ${egg.lng.toFixed(6)}`,
      ];

      infoPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false })
        .setLngLat([egg.lng, egg.lat])
        .setDOMContent(buildEggInfoContent(egg.name || reward?.name || "Unnamed egg", lines))
        .addTo(map);
    },
    [closeInfoPopup],
  );

  // One marker per saved egg, colored per reward (eggMarkerColor) so a reward
  // reads the same on the map, the items panel, and the legend. Hover shows
  // the info popup; click highlights the egg's row in the panel — the panel's
  // ⋯ menu is the only place to edit or delete. Declared after the
  // map-creation effect so mapRef is set by the time this first runs.
  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const markers = new Map<string, maplibregl.Marker>();

    for (const egg of eggs) {
      const marker = new maplibregl.Marker(eggMarkerOptions(itemMarkerUrl, egg.rewardId))
        .setLngLat([egg.lng, egg.lat])
        .addTo(map);
      const element = marker.getElement();

      element.style.cursor = "pointer";
      element.addEventListener("mouseenter", () => showEggInfo(egg));
      element.addEventListener("mouseleave", closeInfoPopup);
      // stopPropagation: while placing, a click that bubbled to the map would
      // otherwise try to open "Place New Egg" at this same spot.
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setHighlight({ eggId: egg.id, token: Date.now() });
      });
      markers.set(egg.id, marker);
    }

    eggMarkersRef.current = markers;

    return () => {
      closeInfoPopup();

      for (const marker of markers.values()) {
        marker.remove();
      }

      eggMarkersRef.current = new Map();
    };
  }, [eggs, itemMarkerUrl, showEggInfo, closeInfoPopup]);

  // Queued (unsaved) placements: same reward color, faded. Like the plugin,
  // clicking one removes it from the queue.
  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const markers = pending.map((egg) => {
      const marker = new maplibregl.Marker(eggMarkerOptions(itemMarkerUrl, egg.rewardId))
        .setLngLat([egg.lng, egg.lat])
        .addTo(map);
      const element = marker.getElement();

      element.style.cursor = "pointer";
      element.style.opacity = "0.6";
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        setPending((current) => current.filter((item) => item.key !== egg.key));
      });

      return marker;
    });

    return () => {
      for (const marker of markers) {
        marker.remove();
      }
    };
  }, [pending, itemMarkerUrl]);

  // The highlight is transient (plugin: 2.4 s) — the panel scrolls to the row
  // when it appears and drops the styling when it clears.
  useEffect(() => {
    if (!highlight) {
      return;
    }

    const timeout = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);

    return () => clearTimeout(timeout);
  }, [highlight]);

  // Fit the map to the selected event's eggs once per event (not on every
  // refresh after an edit/delete, which would yank the view around).
  const fittedEventRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || fittedEventRef.current === selectedEventId) {
      return;
    }

    fittedEventRef.current = selectedEventId;

    if (eggs.length === 0) {
      map.jumpTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM });
      return;
    }

    const bounds = new maplibregl.LngLatBounds();

    for (const egg of eggs) {
      bounds.extend([egg.lng, egg.lat]);
    }

    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
  }, [eggs, selectedEventId]);

  // "Edit Location" (plugin's enterEditLocationMode): the egg's *own* marker
  // becomes draggable with a glow, and a static grey ghost marks where it
  // started. One marker rather than a second stacked copy, so nothing can
  // sit on top of the draggable element and swallow the mousedown.
  const editingEgg = editLocation?.egg ?? null;

  useEffect(() => {
    const map = mapRef.current;
    const marker = editingEgg ? eggMarkersRef.current.get(editingEgg.id) : undefined;

    if (!map || !editingEgg || !marker) {
      return;
    }

    const others = [...eggs.filter((egg) => egg.id !== editingEgg.id), ...pending];
    // The grey ghost only appears once the admin starts dragging, left behind
    // at the original spot; until then there is just the one normal marker.
    let ghost: maplibregl.Marker | null = null;

    const handleDragStart = () => {
      if (ghost) {
        return;
      }

      ghost = new maplibregl.Marker(eggMarkerOptions(itemMarkerUrl, editingEgg.rewardId))
        .setLngLat([editingEgg.lng, editingEgg.lat])
        .addTo(map);
      ghost.getElement().classList.add("huntry-admin-egg-marker--ghost");
      ghost.getElement().style.pointerEvents = "none";
      ghost.getElement().style.zIndex = "0";
    };

    const handleDrag = () => {
      const { lat, lng } = marker.getLngLat();

      setEditLocation((current) =>
        current ? { ...current, lat, lng, valid: isFarEnough({ lat, lng }, others, markerRadiusMeters) } : current,
      );
    };

    marker.setDraggable(true);
    marker.getElement().classList.add("huntry-admin-egg-marker--dragging-active");
    // Keeps the live marker above its own ghost.
    marker.getElement().style.zIndex = "1";
    marker.on("dragstart", handleDragStart);
    marker.on("drag", handleDrag);

    return () => {
      marker.off("dragstart", handleDragStart);
      marker.off("drag", handleDrag);
      marker.setDraggable(false);
      marker.getElement().classList.remove("huntry-admin-egg-marker--dragging-active");
      marker.getElement().style.zIndex = "";
      ghost?.remove();
    };
  }, [editingEgg, eggs, pending, markerRadiusMeters, itemMarkerUrl]);

  // map.resize() has to run before flyTo() so the camera centres against the
  // full-screen size, not the old container — both in the same frame, after
  // the fullscreen wrapper has actually re-laid out.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !editingEgg) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      map.resize();
      map.flyTo({ center: [editingEgg.lng, editingEgg.lat], zoom: Math.max(map.getZoom(), 17), essential: true });
    });

    return () => cancelAnimationFrame(frame);
  }, [editingEgg]);

  // Keep-out circles around every egg while placing/relocating, so the admin
  // can see where a new egg won't fit. Drawn at half the marker radius (as in
  // huntry-admin-map.js): eggs must be a full radius apart, so valid
  // neighbors' circles touch instead of overlapping.
  const editLat = editLocation?.lat;
  const editLng = editLocation?.lng;

  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const centers = isFullscreen
      ? [
          ...eggs.filter((egg) => egg.id !== editingEgg?.id),
          ...pending,
          ...(editLat !== undefined && editLng !== undefined ? [{ lat: editLat, lng: editLng }] : []),
        ]
      : [];

    const apply = () => {
      const data: Parameters<maplibregl.GeoJSONSource["setData"]>[0] = {
        type: "FeatureCollection",
        features: centers.map((center) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [circleRing(center, markerRadiusMeters / 2)] },
        })),
      };
      const source = map.getSource(RADIUS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;

      if (source) {
        source.setData(data);
        return;
      }

      map.addSource(RADIUS_SOURCE_ID, { type: "geojson", data });
      map.addLayer({
        id: `${RADIUS_SOURCE_ID}-fill`,
        type: "fill",
        source: RADIUS_SOURCE_ID,
        paint: { "fill-color": HUNTRY_COLORS.primary, "fill-opacity": 0.12 },
      });
      map.addLayer({
        id: `${RADIUS_SOURCE_ID}-outline`,
        type: "line",
        source: RADIUS_SOURCE_ID,
        paint: { "line-color": HUNTRY_COLORS.primary, "line-opacity": 0.5, "line-width": 1.5 },
      });
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("load", apply);
    }

    return () => {
      map.off("load", apply);
    };
  }, [eggs, pending, isFullscreen, editingEgg, editLat, editLng, markerRadiusMeters]);

  // Clicking the map while placing: enforce the event cap and the minimum
  // spacing up front (the server re-checks both), else open the Place dialog.
  // Re-assigned every render so the listener registered once above never
  // sees stale state.
  useEffect(() => {
    mapClickRef.current = (event) => {
      const target = event.originalEvent.target;

      if (
        !isPlacing ||
        editLocation ||
        dialog ||
        (target instanceof Element && target.closest(".maplibregl-marker, .maplibregl-popup"))
      ) {
        return;
      }

      const point = { lat: event.lngLat.lat, lng: event.lngLat.lng };

      if (eggs.length + pending.length >= MAX_EGGS_PER_EVENT) {
        setDialog({ kind: "limit" });
      } else if (!isFarEnough(point, [...eggs, ...pending], markerRadiusMeters)) {
        setDialog({ kind: "proximity" });
      } else {
        setDialog({ kind: "place", ...point });
      }
    };
  });

  // The map container changes size when full-screen mode toggles.
  useEffect(() => {
    mapRef.current?.resize();
  }, [isFullscreen]);

  // Browser-level guard (tab close / reload) for queued, unsaved placements.
  // In-app navigation is guarded separately in selectEvent.
  useEffect(() => {
    if (pending.length === 0) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pending.length]);

  // Port of the plugin's flyToAndHighlightMarker: flies to a panel row's egg
  // and pulses its marker briefly.
  const flyToEgg = (egg: HuntryEgg) => {
    const element = eggMarkersRef.current.get(egg.id)?.getElement();

    mapRef.current?.flyTo({ center: [egg.lng, egg.lat], zoom: 18, essential: true });

    if (!element) {
      return;
    }

    pulsedElementRef.current?.classList.remove("huntry-admin-egg-marker--highlight");

    if (pulseTimeoutRef.current) {
      clearTimeout(pulseTimeoutRef.current);
    }

    element.classList.add("huntry-admin-egg-marker--highlight");
    pulsedElementRef.current = element;
    pulseTimeoutRef.current = setTimeout(() => {
      element.classList.remove("huntry-admin-egg-marker--highlight");
      pulsedElementRef.current = null;
    }, HIGHLIGHT_MS);
  };

  // Cancel snaps the marker back to where it started; confirm leaves it at the
  // new spot until the revalidated eggs arrive (no flash back to the old one).
  const cancelEditLocation = () => {
    if (editLocation) {
      eggMarkersRef.current.get(editLocation.egg.id)?.setLngLat([editLocation.egg.lng, editLocation.egg.lat]);
    }

    setEditLocation(null);
  };

  // Clears any in-flight pulse timer if the view unmounts.
  useEffect(
    () => () => {
      if (pulseTimeoutRef.current) {
        clearTimeout(pulseTimeoutRef.current);
      }
    },
    [],
  );

  // Reward cards for the Place/Edit dialog. "N left" counts the reward's eggs
  // across every event plus this session's queued ones, against
  // min(egg_capacity, MAX_EGGS_PER_REWARD); an edited egg's own reward stays
  // selectable since it already holds a slot.
  const rewardChoices = (currentRewardId: number | null): RewardChoice[] =>
    rewards.map((reward) => {
      const used =
        (rewardEggCounts[reward.id] ?? 0) + pending.filter((egg) => egg.rewardId === reward.id).length;
      const remaining = Math.max(0, Math.min(reward.eggCapacity, MAX_EGGS_PER_REWARD) - used);

      return {
        reward,
        sponsorName: reward.sponsorId === null ? null : (sponsorNames[reward.sponsorId] ?? null),
        remaining,
        selectable: remaining > 0 || reward.id === currentRewardId,
      };
    });

  const stopPlacing = () => {
    if (pending.length === 0 || selectedEventId === null) {
      setIsPlacing(false);
      return;
    }

    const adds = pending.map(({ rewardId, name, lat, lng }) => ({ rewardId, name, lat, lng }));

    startSaving(async () => {
      const result = await runServerAction(() => saveHuntryEggPlacements(selectedEventId, adds, storeHash));

      // On failure the queue is kept so nothing the admin placed is lost.
      if (result.success) {
        setPending([]);
        setIsPlacing(false);
      }
    });
  };

  const submitPlace = (value: { name: string; rewardId: number }) => {
    if (dialog?.kind !== "place") {
      return;
    }

    const { lat, lng } = dialog;

    setPending((current) => [...current, { key: crypto.randomUUID(), ...value, lat, lng }]);
    setDialog(null);
  };

  const submitEdit = (egg: HuntryEgg, value: { name: string; rewardId: number }) => {
    startSaving(async () => {
      const result = await runServerAction(() => updateHuntryEgg(egg.id, value, storeHash));

      if (result.success) {
        setDialog(null);
      }
    });
  };

  const beginEditLocation = (egg: HuntryEgg, value: { name: string; rewardId: number | null }) => {
    setDialog(null);
    setEditLocation({
      egg,
      name: value.name,
      rewardId: value.rewardId ?? egg.rewardId,
      lat: egg.lat,
      lng: egg.lng,
      valid: true,
    });
  };

  const confirmEditLocation = () => {
    if (!editLocation?.valid) {
      return;
    }

    const { egg, name, rewardId, lat, lng } = editLocation;

    startSaving(async () => {
      const result = await runServerAction(() => updateHuntryEgg(egg.id, { name, rewardId, lat, lng }, storeHash));

      if (result.success) {
        setEditLocation(null);
      }
    });
  };

  const confirmDelete = (egg: HuntryEgg) => {
    startSaving(async () => {
      await runServerAction(() => deleteHuntryEgg(egg.id, storeHash));
      setDialog(null);
    });
  };

  // Cleans up the popup-closed poll below if this component unmounts
  // mid-flight (e.g. the admin navigates away before answering the prompt).
  useEffect(() => resetLocating, [resetLocating]);

  const eventOptions = events.map((event) => ({ value: String(event.id), content: event.name }));

  const selectEvent = (eventId: string | number | null) => {
    const parsedEventId = eventId === null ? null : Number(eventId);
    const params = buildMapSearchParams(parsedEventId);
    const queryString = params.toString();

    const navigate = () => {
      startTransition(() => {
        router.push(queryString ? `${pathname}?${queryString}` : pathname);
      });
    };

    // Switching events would silently drop the queued placements.
    if (pending.length > 0) {
      setDialog({
        kind: "unsaved",
        onLeave: () => {
          setPending([]);
          setIsPlacing(false);
          setDialog(null);
          navigate();
        },
      });
      return;
    }

    navigate();
  };

  const usedRewards = rewards.filter((reward) => eggs.some((egg) => egg.rewardId === reward.id));

  return (
    <Box>
      <Box marginBottom="medium" style={{ maxWidth: "20rem" }}>
        <FormSelect
          disabled={isPending}
          label="Event"
          onOptionChange={selectEvent}
          options={eventOptions}
          value={selectedEventId === null ? "" : String(selectedEventId)}
        />
      </Box>
      <Text style={{ color: HUNTRY_COLORS.textMuted, marginBottom: "small" }}>
        Click on the cross-hair to use precise location.
      </Text>

      <Flex flexDirection="row" alignItems="flex-start" style={{ gap: "1rem" }}>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <div style={{ height: "600px", position: "relative", width: "100%" }}>
            {/* Same element in both modes (maplibre owns its canvas) — only the
                wrapper's positioning changes, mirroring huntry-admin-map.js's
                #huntry-map-fullscreen-wrapper.is-fullscreen. */}
            <div
              style={
                isFullscreen
                  ? { position: "fixed", inset: 0, zIndex: 1000, display: "flex", flexDirection: "column", backgroundColor: "#fff" }
                  : { height: "100%", width: "100%" }
              }
            >
              {isPlacing && !editLocation ? (
                <Flex
                  alignItems="center"
                  flexDirection="row"
                  justifyContent="space-between"
                  padding="small"
                  style={{ backgroundColor: HUNTRY_COLORS.background, borderBottom: "1px solid #E5E5EA" }}
                >
                  <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
                    Click the map to place an egg.{" "}
                    {pending.length > 0 ? `${pending.length} pending — saved when you stop placing.` : ""}
                  </Text>
                  {/* BigDesign's Button drops style/className, so the red is
                      applied to its .bd-button via this wrapper (egg-marker.css). */}
                  <span className="huntry-stop-placing">
                    <Button isLoading={isSaving} onClick={stopPlacing} variant="secondary">
                      Stop Placing
                    </Button>
                  </span>
                </Flex>
              ) : null}
              <div ref={mapContainerRef} style={{ flex: 1, height: "100%", width: "100%" }} />
              {editLocation ? (
                <Flex
                  alignItems="center"
                  flexDirection="row"
                  justifyContent="space-between"
                  padding="small"
                  style={{
                    backgroundColor: editLocation.valid ? HUNTRY_COLORS.background : "#FDECEA",
                    borderTop: "1px solid #E5E5EA",
                  }}
                >
                  <Box>
                    <Text bold margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>
                      Editing location of: {editLocation.name || editLocation.egg.name || "Unnamed egg"}
                    </Text>
                    <Text
                      margin="none"
                      style={{ color: editLocation.valid ? HUNTRY_COLORS.textMuted : HUNTRY_COLORS.destructive }}
                    >
                      {editLocation.valid
                        ? "Drag marker to update the location."
                        : `Too close to another egg! Move at least ${markerRadiusMeters}m away.`}
                    </Text>
                  </Box>
                  <Flex flexDirection="row" style={{ gap: "0.5rem" }}>
                    <Button aria-label="Cancel" onClick={cancelEditLocation} variant="subtle">
                      ✕
                    </Button>
                    <Button
                      aria-label="Confirm new location"
                      disabled={!editLocation.valid}
                      isLoading={isSaving}
                      onClick={confirmEditLocation}
                      variant="primary"
                    >
                      ✓
                    </Button>
                  </Flex>
                </Flex>
              ) : null}
            </div>
          </div>
          {usedRewards.length > 0 ? (
            <Flex flexDirection="row" marginTop="small" style={{ gap: "1rem", flexWrap: "wrap" }}>
              {usedRewards.map((reward) => (
                <Flex alignItems="center" flexDirection="row" key={reward.id} style={{ gap: "0.375rem" }}>
                  <span
                    style={{
                      backgroundColor: eggMarkerColor(reward.id),
                      borderRadius: "50%",
                      display: "inline-block",
                      height: "0.75rem",
                      width: "0.75rem",
                    }}
                  />
                  <Text margin="none" style={{ color: HUNTRY_COLORS.textMuted }}>{reward.name}</Text>
                </Flex>
              ))}
            </Flex>
          ) : null}
        </Box>

        <EggItemsPanel
          eggs={eggs}
          highlight={highlight}
          onDeleteEgg={openDelete}
          onEditEgg={openEdit}
          onPlaceItem={() => setIsPlacing(true)}
          onRemovePending={(key) => setPending((current) => current.filter((egg) => egg.key !== key))}
          onSelectEgg={flyToEgg}
          pending={pending}
          rewards={rewards}
        />
      </Flex>

      {dialog?.kind === "place" ? (
        <EggPlaceDialog
          choices={rewardChoices(null)}
          initialName=""
          initialRewardId={null}
          lat={dialog.lat}
          lng={dialog.lng}
          mode="place"
          onCancel={() => setDialog(null)}
          onSubmit={submitPlace}
        />
      ) : null}
      {dialog?.kind === "edit" ? (
        <EggPlaceDialog
          choices={rewardChoices(dialog.egg.rewardId)}
          initialName={dialog.egg.name}
          initialRewardId={dialog.egg.rewardId}
          isSaving={isSaving}
          lat={dialog.egg.lat}
          lng={dialog.egg.lng}
          mode="edit"
          onCancel={() => setDialog(null)}
          onEditLocation={(value) => beginEditLocation(dialog.egg, value)}
          onSubmit={(value) => submitEdit(dialog.egg, value)}
        />
      ) : null}
      {dialog?.kind === "delete" ? (
        <EggDeleteDialog
          eggName={dialog.egg.name || "Unnamed egg"}
          isClaimed={false}
          isDeleting={isSaving}
          onCancel={() => setDialog(null)}
          onConfirm={() => confirmDelete(dialog.egg)}
        />
      ) : null}
      {dialog?.kind === "limit" ? <EggLimitDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "proximity" ? (
        <EggProximityDialog onClose={() => setDialog(null)} radiusMeters={markerRadiusMeters} />
      ) : null}
      {dialog?.kind === "unsaved" ? (
        <UnsavedChangesDialog onLeave={dialog.onLeave} onStay={() => setDialog(null)} />
      ) : null}
    </Box>
  );
}
