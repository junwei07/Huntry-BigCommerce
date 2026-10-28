import type { GeoJSONSource } from "maplibre-gl";
import { circleRing } from "@/lib/huntry/eggs/geo";

type RadiusData = Parameters<GeoJSONSource["setData"]>[0];

// The keep-out circles drawn around every egg while placing or relocating, so
// the admin can see where a new egg won't fit. Drawn at half the marker radius
// (as in huntry-admin-map.js): eggs must be a full radius apart, so valid
// neighbors' circles touch instead of overlapping.
export function buildRadiusFeatureCollection(
  centers: { lat: number; lng: number }[],
  markerRadiusMeters: number,
): RadiusData {
  return {
    type: "FeatureCollection",
    features: centers.map((center) => ({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [circleRing(center, markerRadiusMeters / 2)] },
    })),
  };
}
