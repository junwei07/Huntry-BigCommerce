"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import * as maplibregl from "maplibre-gl";
import { Box, Select, Text } from "@bigcommerce/big-design";
import { showErrorAlert } from "@/components/ui/action-alerts";
import { useGlobalTransition } from "@/components/ui/global-loading";
import { buildMapSearchParams } from "@/lib/huntry/map/query";
import {
  isGeolocateRelayMessage,
  isGeolocationAllowedInFrame,
  isGeolocationPolicyError,
} from "@/lib/huntry/map/geolocate-relay";
import { HuntryGeolocateControl } from "@/components/huntry/map/geolocate-control";
import { HuntryEvent } from "@/lib/huntry/events/types";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

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
// Placeholder until BC-HUN-024 teaches this effect to fly to/fit the
// selected event's actual egg placements — no event-level location exists
// yet (docs/MIGRATION.md §1 has no geo field on huntry_events).
const DEFAULT_MAP_CENTER: [number, number] = [18.0686, 59.3293];
const DEFAULT_MAP_ZOOM = 11;

export function MapPlacementView({
  events,
  selectedEventId,
}: {
  events: HuntryEvent[];
  selectedEventId: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useGlobalTransition();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const locationMarkerRef = useRef<maplibregl.Marker | null>(null);
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
      locationMarkerRef.current = new maplibregl.Marker().setLngLat([lng, lat]).addTo(map);
    }
  }, []);

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

  // Cleans up the popup-closed poll below if this component unmounts
  // mid-flight (e.g. the admin navigates away before answering the prompt).
  useEffect(() => resetLocating, [resetLocating]);

  const eventOptions = events.map((event) => ({ value: String(event.id), content: event.name }));

  const selectEvent = (eventId: string | number | null) => {
    const parsedEventId = eventId === null ? null : Number(eventId);
    const params = buildMapSearchParams(parsedEventId);
    const queryString = params.toString();

    startTransition(() => {
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    });
  };

  return (
    <Box>
      <Box marginBottom="medium" style={{ maxWidth: "20rem" }}>
        <Select
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

      <div ref={mapContainerRef} style={{ height: "600px", width: "100%" }} />
    </Box>
  );
}
