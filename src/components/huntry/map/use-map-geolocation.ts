import { RefObject, useCallback, useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import { showErrorAlert } from "@/components/ui/action-alerts";
import type { HuntryGeolocateControl } from "@/components/huntry/map/geolocate-control";
import {
  isGeolocateRelayMessage,
  isGeolocationAllowedInFrame,
  isGeolocationPolicyError,
} from "@/lib/huntry/map/geolocate-relay";
import type { locationMarkerAnchor } from "@/lib/huntry/events/marker-urls";

function locationMarkerElement(url: string): HTMLImageElement {
  const image = document.createElement("img");

  image.src = url;
  image.alt = "";
  image.draggable = false;
  image.style.cssText = "width:36px;height:36px;object-fit:contain;display:block";

  return image;
}

// The admin's own location: the crosshair control, the in-frame geolocation
// attempt, the popup relay fallback and the location marker. mapRef and
// geolocateControlRef are owned by the caller because the map-creation effect
// (useMapInstance) needs triggerLocate while this hook needs the map.
export function useMapGeolocation({
  mapRef,
  geolocateControlRef,
  locationMarkerUrl,
  locationAnchor,
}: {
  mapRef: RefObject<maplibregl.Map | null>;
  geolocateControlRef: RefObject<HuntryGeolocateControl | null>;
  locationMarkerUrl: string | null;
  locationAnchor: ReturnType<typeof locationMarkerAnchor>;
}) {
  const locationMarkerRef = useRef<maplibregl.Marker | null>(null);
  // showLocation is called from long-lived listeners, so it reads the current
  // icon through a ref instead of closing over a stale one.
  const locationIconRef = useRef({ url: locationMarkerUrl, anchor: locationAnchor });
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
  }, [mapRef, geolocateControlRef]);

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
  }, [mapRef, locationMarkerUrl, locationAnchor]);

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
  }, [resetLocating, geolocateControlRef]);

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
    [openRelayPopup, showLocation, geolocateControlRef],
  );

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
  }, [resetLocating, showLocation, geolocateControlRef]);

  // Cleans up the popup-closed poll below if this component unmounts
  // mid-flight (e.g. the admin navigates away before answering the prompt).
  useEffect(() => resetLocating, [resetLocating]);

  return { triggerLocate };
}
