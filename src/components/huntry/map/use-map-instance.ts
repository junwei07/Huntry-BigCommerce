import { RefObject, useEffect } from "react";
import * as maplibregl from "maplibre-gl";
import { HuntryGeolocateControl } from "@/components/huntry/map/geolocate-control";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, MAP_STYLE_URL, MAP_WORKER_URL } from "@/components/huntry/map/map-shared";

// Creates the MapLibre map once (re-created only if triggerLocate changes
// identity, which is why it must stay stable) and keeps it sized to its
// container. Must be called before the hooks that read mapRef in effects.
export function useMapInstance({
  mapContainerRef,
  mapRef,
  geolocateControlRef,
  mapClickRef,
  triggerLocate,
  isFullscreen,
}: {
  mapContainerRef: RefObject<HTMLDivElement | null>;
  mapRef: RefObject<maplibregl.Map | null>;
  geolocateControlRef: RefObject<HuntryGeolocateControl | null>;
  mapClickRef: RefObject<(event: maplibregl.MapMouseEvent) => void>;
  triggerLocate: (userInitiated: boolean) => void;
  isFullscreen: boolean;
}) {
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
  }, [mapContainerRef, mapRef, geolocateControlRef, mapClickRef, triggerLocate]);

  // The map container changes size when full-screen mode toggles.
  useEffect(() => {
    mapRef.current?.resize();
  }, [mapRef, isFullscreen]);
}
