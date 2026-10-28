import { RefObject, useEffect } from "react";
import * as maplibregl from "maplibre-gl";
import { HuntryEgg, PendingEgg } from "@/lib/huntry/eggs/types";
import { buildRadiusFeatureCollection } from "@/lib/huntry/map/radius-overlay";
import { HUNTRY_COLORS } from "@/lib/huntry/theme";

const RADIUS_SOURCE_ID = "huntry-egg-radius";

export function useRadiusOverlay({
  mapRef,
  eggs,
  pending,
  isFullscreen,
  editingEgg,
  editLat,
  editLng,
  markerRadiusMeters,
}: {
  mapRef: RefObject<maplibregl.Map | null>;
  eggs: HuntryEgg[];
  pending: PendingEgg[];
  isFullscreen: boolean;
  editingEgg: HuntryEgg | null;
  editLat: number | undefined;
  editLng: number | undefined;
  markerRadiusMeters: number;
}) {
  // Keep-out circles around every egg while placing/relocating, so the admin
  // can see where a new egg won't fit. Drawn at half the marker radius (as in
  // huntry-admin-map.js): eggs must be a full radius apart, so valid
  // neighbors' circles touch instead of overlapping.
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
      const data = buildRadiusFeatureCollection(centers, markerRadiusMeters);
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
  }, [mapRef, eggs, pending, isFullscreen, editingEgg, editLat, editLng, markerRadiusMeters]);
}
